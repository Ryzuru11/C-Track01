import { z } from 'zod';

const googleMapsUrlRegex = /^(https?:\/\/)?(www\.)?(maps\.google\.com|maps\.app\.goo\.gl|www\.google\.com\/maps|google\.com\/maps|goo\.gl|g\.co\/maps)/;

export const taskBulkRowSchema = z.object({
  title: z.string({
    required_error: 'Title is required.',
  }).min(1, 'Title is required.').max(255, 'Title exceeds maximum length (255).')
    .refine(val => val.trim().length > 0, {
      message: 'Title cannot be only whitespace.',
    }),

  description: z.string().optional().default(''),

  location: z.string({
    required_error: 'Location is required.',
  }).min(3, 'Invalid location.').max(255, 'Location exceeds maximum length (255).')
    .refine(val => val.trim().length >= 3, {
      message: 'Invalid location.',
    }),

  linkGoogleMaps: z.string({
    required_error: 'Google Maps link is required.',
  }).min(1, 'Google Maps link is required.')
    .refine((val) => {
      try {
        const url = new URL(val.startsWith('http') ? val : `https://${val}`);
        return googleMapsUrlRegex.test(url.hostname) || googleMapsUrlRegex.test(val);
      } catch {
        return googleMapsUrlRegex.test(val);
      }
    }, {
      message: 'Invalid Google Maps URL.',
    }),

  startTime: z.string()
    .regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid Start Time.')
    .optional()
    .default('08:00'),

  endTime: z.string()
    .regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid End Time.')
    .optional()
    .default('17:00'),
});

export const taskBulkRowSchemaWithValidation = taskBulkRowSchema.refine(
  (data) => {
    const start = data.startTime || '08:00';
    const end = data.endTime || '17:00';
    return start < end;
  },
  {
    message: 'End Time must be later than Start Time.',
    path: ['endTime'],
  }
);

export type TaskBulkRow = z.infer<typeof taskBulkRowSchema>;
export type TaskBulkRowWithValidation = z.infer<typeof taskBulkRowSchemaWithValidation>;

export interface BulkValidationError {
  row: number;
  column: string;
  value: string;
  error: string;
}

export interface BulkPreviewResult {
  total: number;
  valid: number;
  errors: BulkValidationError[];
  validRows: Array<{
    rowNumber: number;
    data: {
      title: string;
      description: string;
      location: string;
      latitude: number | null;
      longitude: number | null;
      startTime: string;
      endTime: string;
    };
  }>;
}

export interface BulkImportResult {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{
    row: number;
    title: string;
    error: string;
  }>;
  createdTasks: Array<{
    taskId: string;
    ticketNumber: string;
    title: string;
  }>;
}

export interface BulkExcelRow {
  Title?: string;
  Description?: string;
  Location?: string;
  'Link Google Maps'?: string;
  'Start Time'?: string;
  'End Time'?: string;
}