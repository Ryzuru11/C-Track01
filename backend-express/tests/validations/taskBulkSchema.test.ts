import { describe, it, expect } from 'vitest';
import { taskBulkRowSchema, taskBulkRowSchemaWithValidation } from '../../src/validations/taskBulkSchema';

describe('taskBulkSchema Validation', () => {
  const validRow = {
    title: 'Perbaikan Jaringan Kantor',
    description: 'Pengecekan kabel LAN dan switch',
    location: 'Gedung A Lantai 2',
    linkGoogleMaps: 'https://maps.google.com/?q=-6.200000,106.816666',
    startTime: '08:30',
    endTime: '16:00',
  };

  it('should pass with valid row data', () => {
    const result = taskBulkRowSchemaWithValidation.safeParse(validRow);
    expect(result.success).toBe(true);
  });

  it('should fail if title is empty or only whitespace', () => {
    const emptyTitle = { ...validRow, title: '   ' };
    const result = taskBulkRowSchemaWithValidation.safeParse(emptyTitle);
    expect(result.success).toBe(false);
  });

  it('should fail if location is shorter than 3 characters', () => {
    const shortLocation = { ...validRow, location: 'ab' };
    const result = taskBulkRowSchemaWithValidation.safeParse(shortLocation);
    expect(result.success).toBe(false);
  });

  it('should fail if linkGoogleMaps is not a valid Google Maps url', () => {
    const invalidUrl = { ...validRow, linkGoogleMaps: 'https://example.com/location' };
    const result = taskBulkRowSchemaWithValidation.safeParse(invalidUrl);
    expect(result.success).toBe(false);
  });

  it('should fail if startTime is after or equal to endTime', () => {
    const invalidTimeOrder = { ...validRow, startTime: '17:00', endTime: '08:00' };
    const result = taskBulkRowSchemaWithValidation.safeParse(invalidTimeOrder);
    expect(result.success).toBe(false);
  });
});
