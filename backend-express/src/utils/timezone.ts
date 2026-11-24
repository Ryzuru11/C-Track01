/**
 * Timezone utility for Jakarta (UTC+7) handling
 */

const JAKARTA_TIMEZONE = 'Asia/Jakarta';
const JAKARTA_UTC_OFFSET = 7 * 60 * 60 * 1000; // 7 hours in milliseconds

/**
 * Get current date/time in Jakarta timezone
 * @returns Current date in Jakarta timezone
 */
export const getJakartaTime = (): Date => {
  const now = new Date();
  return new Date(now.getTime() + JAKARTA_UTC_OFFSET);
};

/**
 * Convert a date to Jakarta timezone
 * @param date The date to convert
 * @returns Date adjusted for Jakarta timezone
 */
export const toJakartaTime = (date: Date): Date => {
  return new Date(date.getTime() + JAKARTA_UTC_OFFSET);
};

/**
 * Format date as Jakarta ISO string (ISO format but with Jakarta offset)
 * @param date The date to format
 * @returns ISO string representation
 */
export const formatJakartaTime = (date?: Date): string => {
  const d = date ? new Date(date) : new Date();
  return d.toISOString();
};

/**
 * Get elapsed time since a given date (in minutes)
 * @param date The past date
 * @returns Minutes elapsed
 */
export const getMinutesElapsed = (date: Date): number => {
  const now = new Date();
  const elapsed = now.getTime() - new Date(date).getTime();
  return Math.floor(elapsed / (1000 * 60));
};

export default {
  getJakartaTime,
  toJakartaTime,
  formatJakartaTime,
  getMinutesElapsed,
};
