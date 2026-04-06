export interface DeliveryZone {
  radiusKm: number;
  fee: number;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function calculateDistanceKm(
  userLat: number,
  userLng: number,
  restaurantLat: number,
  restaurantLng: number,
) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(restaurantLat - userLat);
  const dLng = toRadians(restaurantLng - userLng);
  const lat1 = toRadians(userLat);
  const lat2 = toRadians(restaurantLat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export function calculateDeliveryFee(
  userLat: number,
  userLng: number,
  restaurantLat: number,
  restaurantLng: number,
  zones: DeliveryZone[],
) {
  const distanceKm = calculateDistanceKm(userLat, userLng, restaurantLat, restaurantLng);
  const matchingZone = [...zones].sort((a, b) => a.radiusKm - b.radiusKm).find((zone) => distanceKm <= zone.radiusKm);

  if (!matchingZone) {
    return null;
  }

  return {
    fee: matchingZone.fee,
    distanceKm,
    zone: matchingZone,
  };
}
