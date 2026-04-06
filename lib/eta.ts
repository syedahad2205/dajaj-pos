export function calculateEtaMinutes(distanceKm: number, averageSpeedKmH = 22) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    return 0;
  }

  const minutes = Math.round((distanceKm / averageSpeedKmH) * 60);
  return Math.max(3, minutes);
}

