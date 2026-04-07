"""
External places adapter.

Provides a clean interface for discovering nearby businesses from external
providers (Google Places, Yelp, etc.). Includes a mock/disabled fallback
so the system degrades gracefully when no API key is configured.

Usage:
    results = await search_nearby(query="pizza", city="Newark", limit=5)
"""

import os
from typing import Optional

import httpx

from api.routes.feature_flags import get_flag

_GOOGLE_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
_SEARCH_RADIUS = int(os.getenv("GOOGLE_MAPS_SEARCH_RADIUS", "10000"))  # meters


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
    - External API call fails
    """
    if not get_flag("external_local_search_enabled"):
        return []

    if _GOOGLE_API_KEY:
        return await _search_google_places(query, city, latitude, longitude, limit)

    # No provider configured — graceful empty return
    return []


async def _search_google_places(
    query: str,
    city: str,
    latitude: Optional[float],
    longitude: Optional[float],
    limit: int,
) -> list[ExternalPlace]:
    """Search Google Places Text Search API."""
    search_text = f"{query} in {city}" if city else query

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            # Use Text Search (New) API
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
                    "maxResultCount": limit,
                    **({"locationBias": {
                        "circle": {
                            "center": {"latitude": latitude, "longitude": longitude},
                            "radius": float(_SEARCH_RADIUS),
                        }
                    }} if latitude and longitude else {}),
                },
            )

            if resp.status_code != 200:
                print(f"[external-places] Google API error: {resp.status_code}")
                return []

            data = resp.json()
            places = data.get("places", [])

            results = []
            for p in places[:limit]:
                loc = p.get("location", {})
                addr = p.get("formattedAddress", "")
                results.append(ExternalPlace(
                    external_source="google_places",
                    external_place_id=p.get("id", ""),
                    name=(p.get("displayName") or {}).get("text", ""),
                    address=addr,
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

            return results

    except Exception as e:
        print(f"[external-places] error: {e}")
        return []
