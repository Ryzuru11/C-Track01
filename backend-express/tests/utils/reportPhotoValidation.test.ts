import { describe, expect, it } from 'vitest';
import {
  MAX_REPORT_PHOTOS,
  MAX_TASK_DISTANCE_METERS,
  distanceInMeters,
  isCapturedReportPhoto,
} from '../../src/utils/reportPhotoValidation';

const validCapture = {
  image: 'aGVsbG8=',
  latitude: -6.2,
  longitude: 106.8,
  accuracy: 10,
  capturedAt: new Date().toISOString(),
  mocked: false,
};

describe('report photo validation helpers', () => {
  it('sets the three-photo and 100-meter limits', () => {
    expect(MAX_REPORT_PHOTOS).toBe(3);
    expect(MAX_TASK_DISTANCE_METERS).toBe(100);
  });

  it('measures distance between the capture point and task location', () => {
    expect(distanceInMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 0.001, longitude: 0 },
    )).toBeGreaterThan(100);
    expect(distanceInMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 0.0005, longitude: 0 },
    )).toBeLessThan(100);
  });

  it('accepts complete GPS capture metadata and rejects mocked or incomplete captures', () => {
    expect(isCapturedReportPhoto(validCapture)).toBe(true);
    expect(isCapturedReportPhoto({ ...validCapture, mocked: true })).toBe(false);
    expect(isCapturedReportPhoto({ ...validCapture, accuracy: 101 })).toBe(false);
    expect(isCapturedReportPhoto({ ...validCapture, capturedAt: 'not-a-date' })).toBe(false);
    expect(isCapturedReportPhoto({ image: validCapture.image })).toBe(false);
  });
});
