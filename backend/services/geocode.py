"""Lightweight static geocoder for the launch region — no API key, no cost.

Maps a US locality (ZIP, or city+state) to an approximate centroid so the
Discover "Near me" radius filter can place a storefront. Coordinates are public
city/ZIP centroids — accurate to within a couple miles, which is plenty for a
50-mile radius. Returns None for anything not in the table, so callers degrade
gracefully (the city-name filter still works; the storefront just isn't
distance-rankable until its locality is covered).

Coverage starts with DUM Club's service area (NJ + the NY/PA/CT/DE metros
Topgun serves, per CLAUDE.md §7) and is meant to grow as merchants arrive. For
nationwide street-level precision later, swap _lookup for a Google Geocoding
call — GOOGLE_MAPS_API_KEY_BACKEND is already wired up in external_places.py.
"""

from typing import Optional, Tuple

# (city, state) lowercased -> (lat, lng). Public city centroids.
_CITY_CENTROIDS: dict[Tuple[str, str], Tuple[float, float]] = {
    ("dover", "nj"): (40.8840, -74.5613),
    ("morristown", "nj"): (40.7968, -74.4815),
    ("morris plains", "nj"): (40.8270, -74.4774),
    ("parsippany", "nj"): (40.8579, -74.4260),
    ("denville", "nj"): (40.8923, -74.4815),
    ("rockaway", "nj"): (40.9012, -74.5141),
    ("newark", "nj"): (40.7357, -74.1724),
    ("jersey city", "nj"): (40.7178, -74.0431),
    ("paterson", "nj"): (40.9168, -74.1718),
    ("edison", "nj"): (40.5187, -74.4121),
    ("trenton", "nj"): (40.2171, -74.7429),
    ("new york", "ny"): (40.7128, -74.0060),
    ("brooklyn", "ny"): (40.6782, -73.9442),
    ("philadelphia", "pa"): (39.9526, -75.1652),
    ("allentown", "pa"): (40.6084, -75.4902),
    ("stamford", "ct"): (41.0534, -73.5387),
    ("hartford", "ct"): (41.7658, -72.6734),
    ("wilmington", "de"): (39.7391, -75.5398),
}

# ZIP5 -> (lat, lng). Approx centroids for the core service area.
_ZIP_CENTROIDS: dict[str, Tuple[float, float]] = {
    "07801": (40.8840, -74.5613),  # Dover, NJ
    "07960": (40.7968, -74.4815),  # Morristown, NJ
    "07950": (40.8270, -74.4774),  # Morris Plains, NJ
    "07054": (40.8579, -74.4260),  # Parsippany, NJ
}


def geocode(
    city: Optional[str] = None,
    state: Optional[str] = None,
    postal_code: Optional[str] = None,
) -> Optional[Tuple[float, float]]:
    """Best-effort centroid lookup. Prefers ZIP (tighter), falls back to
    city+state. Returns (lat, lng) or None. Never raises."""
    try:
        if postal_code:
            z = "".join(ch for ch in postal_code if ch.isdigit())[:5]
            if z in _ZIP_CENTROIDS:
                return _ZIP_CENTROIDS[z]
        if city and state:
            key = (city.strip().lower(), state.strip().lower())
            if key in _CITY_CENTROIDS:
                return _CITY_CENTROIDS[key]
    except Exception:
        return None
    return None
