"""
External places adapter.

Provides a clean interface for discovering nearby businesses from external
providers (Google Places, Yelp, etc.). Includes a mock/disabled fallback
so the system degrades gracefully when no API key is configured.

Usage:
    results = await search_nearby(query="pizza", city="Newark", limit=5)
"""

import os
import time
from typing import Optional

import httpx

from api.routes.feature_flags import get_flag

# Prefer a backend-only key (no HTTP referrer restriction). Fall back to the
# shared frontend key only if a dedicated backend key isn't set — this lets
# us keep the frontend-facing key locked to HTTP referrers while still
# reaching Places API (New) from Railway.
_GOOGLE_API_KEY = (
    os.getenv("GOOGLE_MAPS_API_KEY_BACKEND")
    or os.getenv("GOOGLE_MAPS_API_KEY", "")
)
_SEARCH_RADIUS = int(os.getenv("GOOGLE_MAPS_SEARCH_RADIUS", "10000"))  # meters
_TIMEOUT = 4.0  # seconds — fast fail to keep homepage responsive

# ── In-memory TTL cache ──
# The homepage chip grid fires a handful of identical queries all day
# ("pizza", "auto detailing", "flight school", etc.). Every click currently
# bills ~$0.035-$0.04 against Places API (New) at Enterprise tier. A short
# in-process cache collapses bursts of identical queries to a single billed
# call and cuts realistic daily billing by ~90%+.
#
# Caveats:
#   - Per-instance (not shared across Railway replicas). When we scale out,
#     swap this for Redis/Upstash. Until then, one instance is the norm and
#     the win is real.
#   - Only SUCCESSFUL responses are cached (including successful-but-empty).
#     Errors (403, timeout, exception) return None from the underlying
#     fetcher so we retry immediately on the next request rather than
#     pinning a bad state for 10 minutes.
_CACHE_TTL_SECONDS = int(os.getenv("EXTERNAL_PLACES_CACHE_TTL", "600"))  # 10 min
_cache: dict[str, tuple[float, list["ExternalPlace"]]] = {}


def _cache_key(
    query: str,
    city: str,
    latitude: Optional[float],
    longitude: Optional[float],
    limit: int,
) -> str:
    """Stable key for (query, city, coarse lat/lng, limit)."""
    lat_r = round(latitude, 3) if latitude is not None else None
    lng_r = round(longitude, 3) if longitude is not None else None
    return f"{query.lower().strip()}|{city.lower().strip()}|{lat_r}|{lng_r}|{limit}"


class ExternalPlace:
    """Normalised external business result."""

    def __init__(
        self,
        external_source: str,
        external_place_id: str,
        name: str,
        address: str = "",
        city: str = "",
        state: str = "",
        postal_code: str = "",
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        category: str = "",
        rating: Optional[float] = None,
        review_count: int = 0,
        phone: str = "",
        website: str = "",
        raw_data: Optional[dict] = None,
    ):
        self.external_source = external_source
        self.external_place_id = external_place_id
        self.name = name
        self.address = address
        self.city = city
        self.state = state
        self.postal_code = postal_code
        self.latitude = latitude
        self.longitude = longitude
        self.category = category
        self.rating = rating
        self.review_count = review_count
        self.phone = phone
        self.website = website
        self.raw_data = raw_data

    def to_dict(self) -> dict:
        return {
            "external_source": self.external_source,
            "external_place_id": self.external_place_id,
            "name": self.name,
            "address": self.address,
            "city": self.city,
            "state": self.state,
            "postal_code": self.postal_code,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "category": self.category,
            "rating": self.rating,
            "review_count": self.review_count,
            "phone": self.phone,
            "website": self.website,
        }


async def search_nearby(
    query: str,
    city: str = "",
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    limit: int = 5,
) -> list[ExternalPlace]:
    """
    Search for nearby businesses from external providers.

    Returns empty list when:
    - Feature flag is off
    - No API key configured
    - External API call fails or times out

    Successful responses are cached in-process for `_CACHE_TTL_SECONDS`
    to collapse bursts of identical chip-click queries into a single
    billed call. Error responses are NOT cached so retries happen
    immediately.
    """
    if not get_flag("external_local_search_enabled"):
        return []

    if not _GOOGLE_API_KEY:
        print("[external-places] no API key configured, skipping")
        return []

    key = _cache_key(query, city, latitude, longitude, limit)
    now = time.monotonic()

    cached = _cache.get(key)
    if cached is not None:
        stored_at, value = cached
        if now - stored_at < _CACHE_TTL_SECONDS:
            print(f"[external-places] cache hit key=\"{key}\" results={len(value)}")
            return value
        # expired
        _cache.pop(key, None)

    result = await _search_google_places(query, city, latitude, longitude, limit)
    if result is None:
        # Upstream error (403, timeout, exception). Do NOT cache — retry next call.
        return []

    _cache[key] = (now, result)
    return result


async def _search_google_places(
    query: str,
    city: str,
    latitude: Optional[float],
    longitude: Optional[float],
    limit: int,
) -> Optional[list[ExternalPlace]]:
    """
    Search Google Places Text Search (New) API.

    Returns:
        list[ExternalPlace] on HTTP 200 (possibly empty) — caller may cache.
        None on any failure (non-200, timeout, exception) — caller should NOT cache.
    """
    search_text = f"{query} in {city}" if city else query
    t0 = time.monotonic()

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                "https://places.googleapis.com/v1/places:searchText",
                headers={
                    "X-Goog-Api-Key": _GOOGLE_API_KEY,
                    "X-Goog-FieldMask": (
                        "places.id,places.displayName,places.formattedAddress,"
                        "places.location,places.rating,places.userRatingCount,"
                        "places.primaryType,places.nationalPhoneNumber,"
                        "places.websiteUri"
                    ),
                },
                json={
                    "textQuery": search_text,
                    "languageCode": "en",
                    "maxResultCount": min(limit, 20),
                    **({"locationBias": {
                        "circle": {
                            "center": {"latitude": latitude, "longitude": longitude},
                            "radius": float(_SEARCH_RADIUS),
                        }
                    }} if latitude and longitude else {}),
                },
            )

            elapsed = round((time.monotonic() - t0) * 1000)

            if resp.status_code != 200:
                print(f"[external-places] Google API error: {resp.status_code} ({elapsed}ms)")
                return None

            data = resp.json()
            places = data.get("places", [])

            # Sort by rating (highest first), then by review count
            places.sort(key=lambda p: (-(p.get("rating") or 0), -(p.get("userRatingCount") or 0)))

            results = []
            seen_names: set[str] = set()
            for p in places[:limit]:
                name = (p.get("displayName") or {}).get("text", "")
                # Deduplicate by normalised name
                name_key = name.strip().lower()
                if name_key in seen_names:
                    continue
                seen_names.add(name_key)

                loc = p.get("location", {})
                results.append(ExternalPlace(
                    external_source="google_places",
                    external_place_id=p.get("id", ""),
                    name=name,
                    address=p.get("formattedAddress", ""),
                    city=city,
                    latitude=loc.get("latitude"),
                    longitude=loc.get("longitude"),
                    category=p.get("primaryType", ""),
                    rating=p.get("rating"),
                    review_count=p.get("userRatingCount", 0),
                    phone=p.get("nationalPhoneNumber", ""),
                    website=p.get("websiteUri", ""),
                    raw_data=p,
                ))

            print(f"[external-places] query=\"{search_text}\" results={len(results)} ({elapsed}ms)")
            return results

    except httpx.TimeoutException:
        elapsed = round((time.monotonic() - t0) * 1000)
        print(f"[external-places] timeout after {elapsed}ms for query=\"{search_text}\"")
        return None
    except Exception as e:
        elapsed = round((time.monotonic() - t0) * 1000)
        print(f"[external-places] error: {e} ({elapsed}ms)")
        return None
