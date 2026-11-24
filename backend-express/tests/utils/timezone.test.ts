import { describe, it, expect } from 'vitest';
import { getJakartaTime, toJakartaTime, formatJakartaTime, getMinutesElapsed } from '../../src/utils/timezone';

describe('Timezone Utils', () => {
  it('should adjust time by +7 hours for Jakarta timezone', () => {
    const baseDate = new Date('2026-01-01T00:00:00.000Z');
    const jakartaDate = toJakartaTime(baseDate);

    expect(jakartaDate.getTime() - baseDate.getTime()).toBe(7 * 60 * 60 * 1000);
  });

  it('should return valid current Jakarta time', () => {
    const now = new Date();
    const jakartaNow = getJakartaTime();

    // Check that it is approximately 7 hours ahead of UTC now
    const diff = jakartaNow.getTime() - now.getTime();
    const expected = 7 * 60 * 60 * 1000;
    expect(Math.abs(diff - expected)).toBeLessThan(50);
  });

  it('should format date to ISO string', () => {
    const date = new Date('2026-05-10T12:00:00.000Z');
    const formatted = formatJakartaTime(date);
    expect(formatted).toBe('2026-05-10T12:00:00.000Z');
  });

  it('should calculate elapsed minutes correctly', () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const elapsed = getMinutesElapsed(tenMinutesAgo);
    expect(elapsed).toBe(10);
  });
});
