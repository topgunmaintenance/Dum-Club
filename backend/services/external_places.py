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
    """
    if not get_flag("external_local_search_enabled"):
        return []

    if _GOOGLE_API_KEY:
        return await _search_google_places(query, city, latitude, longitude, limit)

    print("[external-places] no API key configured, skipping")
    return []


async def _search_google_places(
    query: str,
    city: str,
    latitude: Optional[float],
    longitude: Optional[float],
    limit: int,
) -> list[ExternalPlace]:
    """Search Google Places Text Search (New) API."""
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
                return []

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
        return []
    except Exception as e:
        elapsed = round((time.monotonic() - t0) * 1000)
        print(f"[external-places] error: {e} ({elapsed}ms)")
        return []
