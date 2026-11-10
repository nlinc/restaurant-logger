const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_FIELD_MASK = [
    "places.id",
    "places.displayName",
    "places.businessStatus",
    "places.rating",
    "places.formattedAddress",
    "places.currentOpeningHours.openNow",
    "places.location",
    "places.types",
    "places.priceLevel"
].join(",");

const PRICE_LEVELS = [
    "PRICE_LEVEL_INEXPENSIVE",
    "PRICE_LEVEL_MODERATE",
    "PRICE_LEVEL_EXPENSIVE",
    "PRICE_LEVEL_VERY_EXPENSIVE"
];

function priceLevelNumber(value) {
    const index = PRICE_LEVELS.indexOf(value);
    return index === -1 ? null : index + 1;
}

function priceLevelsThrough(maximum) {
    return Number.isInteger(maximum) && maximum > 0
        ? PRICE_LEVELS.slice(0, Math.min(maximum, PRICE_LEVELS.length))
        : undefined;
}

function normalizePlacesNewPlace(place = {}) {
    return {
        place_id: typeof place.id === "string" ? place.id : "",
        name: typeof place.displayName?.text === "string" ? place.displayName.text : "",
        business_status: typeof place.businessStatus === "string" ? place.businessStatus : "",
        google_rating: Number.isFinite(place.rating) ? place.rating : null,
        address: typeof place.formattedAddress === "string" ? place.formattedAddress : "",
        is_open_now: typeof place.currentOpeningHours?.openNow === "boolean"
            ? place.currentOpeningHours.openNow
            : null,
        types: Array.isArray(place.types) ? place.types.filter(type => typeof type === "string") : [],
        price_level: priceLevelNumber(place.priceLevel),
        lat: Number.isFinite(place.location?.latitude) ? place.location.latitude : null,
        lng: Number.isFinite(place.location?.longitude) ? place.location.longitude : null
    };
}

function normalizePlaceName(value) {
    return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : "";
}

function distanceKm(lat1, lng1, lat2, lng2) {
    const toRadians = degrees => degrees * Math.PI / 180;
    const earthRadiusKm = 6371;
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isEligibleRecommendationPlace(place, context) {
    if (!place?.place_id || !place.name || context.seenPlaceIds.has(place.place_id)) return false;
    if (place.business_status === "CLOSED_PERMANENTLY") return false;
    const candidateName = normalizePlaceName(place.name);
    const isVisited = context.visitedIds.has(place.place_id) || context.visitedNames.has(candidateName);
    const isDismissed = context.dismissedIds.has(place.place_id) || context.dismissedNames.has(candidateName);
    const isRecent = context.recentIds.has(place.place_id) || context.recentNames.has(candidateName);
    if (isDismissed || isRecent || (context.lane !== "reliable" && isVisited)) return false;
    if (context.mode === "three_lanes" && place.is_open_now === false) return false;
    const hasLocation = Number.isFinite(context.lat) && Number.isFinite(context.lng);
    if (context.mode === "three_lanes" && hasLocation
        && (!Number.isFinite(place.lat) || !Number.isFinite(place.lng))) return false;
    if (hasLocation && Number.isFinite(place.lat) && Number.isFinite(place.lng)
        && distanceKm(context.lat, context.lng, place.lat, place.lng) > context.maxDistanceKm) return false;
    if (context.mode === "three_lanes" && context.priceLevel
        && Number.isFinite(place.price_level)
        && place.price_level > context.priceLevel) return false;
    return true;
}

async function searchPlacesText({
    apiKey,
    textQuery,
    lat = null,
    lng = null,
    radiusMeters = null,
    openNow = false,
    maximumPriceLevel = null,
    pageSize = 10,
    rankPreference,
    fetcher = fetch
}) {
    if (!apiKey || !textQuery) throw new Error("Places API key and text query are required");

    const body = {
        textQuery,
        includedType: "restaurant",
        pageSize: Math.min(20, Math.max(1, pageSize))
    };
    if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radiusMeters)) {
        body.locationBias = {
            circle: {
                center: { latitude: lat, longitude: lng },
                radius: Math.min(50000, Math.max(1, radiusMeters))
            }
        };
    }
    if (openNow) body.openNow = true;
    const priceLevels = priceLevelsThrough(maximumPriceLevel);
    if (priceLevels) body.priceLevels = priceLevels;
    if (rankPreference) body.rankPreference = rankPreference;

    const response = await fetcher(PLACES_TEXT_SEARCH_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": PLACES_FIELD_MASK
        },
        body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const status = data?.error?.status || response.status;
        throw new Error(`Places Text Search failed (${status})`);
    }
    return (Array.isArray(data.places) ? data.places : []).map(normalizePlacesNewPlace);
}

module.exports = {
    PLACES_FIELD_MASK,
    PLACES_TEXT_SEARCH_URL,
    distanceKm,
    isEligibleRecommendationPlace,
    normalizePlacesNewPlace,
    priceLevelNumber,
    priceLevelsThrough,
    searchPlacesText
};
