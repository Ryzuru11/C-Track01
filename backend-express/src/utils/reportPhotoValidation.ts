export interface CapturedReportPhoto {
  image: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
  mocked: boolean;
}

export interface TaskCoordinates {
  latitude: number;
  longitude: number;
}

export const MAX_REPORT_PHOTOS = 3;
export const MAX_TASK_DISTANCE_METERS = 100;
export const MAX_LOCATION_ACCURACY_METERS = 100;

export function distanceInMeters(from: TaskCoordinates, to: TaskCoordinates): number {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = ((to.latitude - from.latitude) * Math.PI) / 180;
  const longitudeDelta = ((to.longitude - from.longitude) * Math.PI) / 180;
  const latitudeFrom = (from.latitude * Math.PI) / 180;
  const latitudeTo = (to.latitude * Math.PI) / 180;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeFrom) * Math.cos(latitudeTo) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function isCapturedReportPhoto(value: unknown): value is CapturedReportPhoto {
  if (!value || typeof value !== 'object') return false;
  const photo = value as Record<string, unknown>;

  return (
    typeof photo.image === 'string' &&
    photo.image.length > 0 &&
    typeof photo.latitude === 'number' &&
    Number.isFinite(photo.latitude) &&
    photo.latitude >= -90 &&
    photo.latitude <= 90 &&
    typeof photo.longitude === 'number' &&
    Number.isFinite(photo.longitude) &&
    photo.longitude >= -180 &&
    photo.longitude <= 180 &&
    typeof photo.accuracy === 'number' &&
    Number.isFinite(photo.accuracy) &&
    photo.accuracy >= 0 &&
    photo.accuracy <= MAX_LOCATION_ACCURACY_METERS &&
    typeof photo.capturedAt === 'string' &&
    Number.isFinite(Date.parse(photo.capturedAt)) &&
    typeof photo.mocked === 'boolean' &&
    photo.mocked === false
  );
}
