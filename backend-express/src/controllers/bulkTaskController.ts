import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { io } from '../app';
import { findUsersWithPermission } from '../rbac/recipients';
import { isGoogleMapsShortLink } from '../utils/googleMaps';
import {
  taskBulkRowSchema,
  BulkValidationError,
  BulkPreviewResult,
  BulkImportResult,
  BulkExcelRow,
} from '../validations/taskBulkSchema';

interface ExtractedRow {
  title: string;
  description: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  startTime: string;
  endTime: string;
}

interface ProcessedRow {
  rowNumber: number;
  data: ExtractedRow;
  status: 'valid' | 'error';
  errors: BulkValidationError[];
}

/**
 * Extract coordinates from Google Maps URL
 */
const extractFromUrl = (mapsLink: string): { latitude: number; longitude: number } | null => {
  const decodedUrl = decodeURIComponent(mapsLink);

  const patterns = [
    { regex: /@(-?\d+\.\d+),(-?\d+\.\d+)/, name: '@lat,lng decimals' },
    { regex: /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/, name: '!3d!4d format' },
    { regex: /[?&]query=(-?\d+\.?\d*),(-?\d+\.?\d*)/, name: 'query= format' },
    { regex: /center=(-?\d+\.?\d*),(-?\d+\.?\d*)/, name: 'center= format' },
    { regex: /[?&]ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/, name: 'll= format' },
    { regex: /@(-?\d+\.?\d*),(-?\d+\.?\d*),\d+\.?\d*z/, name: '@lat,lng,zoom' },
  ];

  for (const { regex } of patterns) {
    const match = decodedUrl.match(regex);
    if (match && match[1] && match[2]) {
      const latitude = parseFloat(match[1]);
      const longitude = parseFloat(match[2]);

      if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
        return { latitude, longitude };
      }
    }
  }

  return null;
};

/**
 * Extract coordinates supporting both standard and shortened Google Maps URLs
 */
const extractCoordinates = async (mapsLink: string): Promise<{ latitude: number; longitude: number } | null> => {
  if (!mapsLink) return null;

  // 1. Coba ekstraksi langsung via regex
  let result = extractFromUrl(mapsLink);
  if (result) return result;

  // 2. Jika short URL (maps.app.goo.gl, goo.gl, g.co/maps), follow redirect seperti di routes/geocoding.ts.
  //    Hostname dicek persis (bukan substring) supaya server tidak bisa diarahkan ke host lain (SSRF).
  if (isGoogleMapsShortLink(mapsLink)) {
    try {
      const redirectResponse = await fetch(mapsLink, {
        redirect: 'follow',
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
        },
      });
      const finalUrl = redirectResponse.url;
      result = extractFromUrl(finalUrl);
      if (result) return result;
    } catch (err) {
      console.warn('[BulkUpload] Gagal resolve short URL:', mapsLink, err);
    }
  }

  return null;
};

/**
 * Normalisasi format waktu (Date object / angka serial Excel / string HH:mm[:ss]) ke format HH:mm
 */
const normalizeTimeString = (rawVal: any, defaultVal: string): string => {
  if (rawVal === undefined || rawVal === null || rawVal === '') return defaultVal;

  if (rawVal instanceof Date) {
    const hours = String(rawVal.getHours()).padStart(2, '0');
    const minutes = String(rawVal.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  if (typeof rawVal === 'number') {
    const totalMinutes = Math.round((rawVal % 1) * 24 * 60);
    const hours = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
    const minutes = String(totalMinutes % 60).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  const str = String(rawVal).trim();
  if (!str) return defaultVal;

  const match = str.match(/^([01]?[0-9]|2[0-3]):[0-5][0-9]/);
  if (match) {
    const parts = str.split(':');
    return `${parts[0].padStart(2, '0')}:${parts[1]}`;
  }
  return str;
};

/**
 * Convert time string (HH:MM) to DateTime for MySQL TIME field
 */
const convertTimeToDateTime = (timeString: string): Date => {
  if (!timeString) return new Date(Date.UTC(1970, 0, 1, 8, 0, 0));

  const timeParts = timeString.split(':');
  const hours = parseInt(timeParts[0], 10);
  const minutes = timeParts.length > 1 ? parseInt(timeParts[1], 10) : 0;

  return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0));
};

/**
 * Generate ticket number TSK-XXXX
 */
const generateTicketNumber = async (): Promise<string> => {
  const allTickets = await prisma.task.findMany({
    select: { ticketNumber: true },
    where: { ticketNumber: { startsWith: 'TSK-' } },
  });

  let maxNumber = 0;
  for (const t of allTickets) {
    if (t.ticketNumber) {
      const parts = t.ticketNumber.split('-');
      const num = parseInt(parts[1], 10);
      if (!isNaN(num) && num > maxNumber) maxNumber = num;
    }
  }

  return `TSK-${String(maxNumber + 1).padStart(4, '0')}`;
};

/**
 * Parse Excel file and validate rows
 */
const parseAndValidateExcel = async (
  fileBuffer: Buffer
): Promise<{ processedRows: ProcessedRow[]; errors: BulkValidationError[] }> => {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const jsonData: BulkExcelRow[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  if (jsonData.length === 0) {
    throw new AppError('File Excel kosong atau tidak memiliki data.', 400);
  }

  const processedRows: ProcessedRow[] = [];
  const allErrors: BulkValidationError[] = [];

  for (let i = 0; i < jsonData.length; i++) {
    const rowNumber = i + 2;
    const row = jsonData[i];

    const errors: BulkValidationError[] = [];
    let extractedCoords: { latitude: number; longitude: number } | null = null;

    const rawStartTime = row['Start Time'];
    const rawEndTime = row['End Time'];
    const startTime = normalizeTimeString(rawStartTime, '08:00');
    const endTime = normalizeTimeString(rawEndTime, '17:00');

    // Step 1: Validate schema
    const schemaResult = taskBulkRowSchema.safeParse({
      title: (row.Title || '').toString(),
      description: (row.Description || '').toString(),
      location: (row.Location || '').toString(),
      linkGoogleMaps: (row['Link Google Maps'] || '').toString(),
      startTime,
      endTime,
    });

    if (!schemaResult.success) {
      for (const issue of schemaResult.error.issues) {
        const column = issue.path[0] as string;
        let value = '';
        switch (column) {
          case 'title': value = (row.Title || '').toString(); break;
          case 'description': value = (row.Description || '').toString(); break;
          case 'location': value = (row.Location || '').toString(); break;
          case 'linkGoogleMaps': value = (row['Link Google Maps'] || '').toString(); break;
          case 'startTime': value = startTime; break;
          case 'endTime': value = endTime; break;
          default: value = String(issue.path[1] || '');
        }
        errors.push({
          row: rowNumber,
          column: column === 'linkGoogleMaps' ? 'Link Google Maps' : column.charAt(0).toUpperCase() + column.slice(1),
          value,
          error: issue.message,
        });
      }
    }

    // Step 2: Validate End Time > Start Time
    if (errors.length === 0) {
      if (startTime >= endTime) {
        errors.push({
          row: rowNumber,
          column: 'End Time',
          value: endTime,
          error: 'End Time must be later than Start Time.',
        });
      }
    }

    // Step 3: Extract coordinates from Google Maps link
    const mapsLink = (row['Link Google Maps'] || '').toString().trim();
    if (errors.length === 0 && mapsLink) {
      extractedCoords = await extractCoordinates(mapsLink);

      if (!extractedCoords) {
        errors.push({
          row: rowNumber,
          column: 'Link Google Maps',
          value: mapsLink.substring(0, 50) + (mapsLink.length > 50 ? '...' : ''),
          error: 'Failed to extract coordinates.',
        });
      }
    }

    if (errors.length > 0) {
      allErrors.push(...errors);
      processedRows.push({
        rowNumber,
        data: {
          title: (row.Title || '').toString(),
          description: (row.Description || '').toString(),
          location: (row.Location || '').toString(),
          latitude: null,
          longitude: null,
          startTime,
          endTime,
        },
        status: 'error',
        errors,
      });
    } else {
      processedRows.push({
        rowNumber,
        data: {
          title: (row.Title || '').toString().trim(),
          description: (row.Description || '').toString().trim(),
          location: (row.Location || '').toString().trim(),
          latitude: extractedCoords?.latitude || null,
          longitude: extractedCoords?.longitude || null,
          startTime,
          endTime,
        },
        status: 'valid',
        errors: [],
      });
    }
  }

  return { processedRows, errors: allErrors };
};

/**
 * Preview bulk upload - parse and validate without saving to database
 */
export const previewBulkUpload = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.file) {
      throw new AppError('File Excel diperlukan.', 400);
    }

    const fileBuffer = req.file.buffer;
    const { processedRows, errors } = await parseAndValidateExcel(fileBuffer);

    const validRows = processedRows
      .filter(row => row.status === 'valid')
      .map(row => ({
        rowNumber: row.rowNumber,
        data: row.data,
      }));

    const result: BulkPreviewResult = {
      total: processedRows.length,
      valid: validRows.length,
      errors,
      validRows,
    };

    res.json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Import bulk upload - actually save to database
 */
export const importBulkUpload = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.file) {
      throw new AppError('File Excel diperlukan.', 400);
    }

    const fileBuffer = req.file.buffer;
    const { processedRows, errors } = await parseAndValidateExcel(fileBuffer);

    const validRows = processedRows.filter(row => row.status === 'valid');

    if (validRows.length === 0) {
      throw new AppError('Tidak ada data valid untuk diimport.', 400);
    }

    const createdTasks: BulkImportResult['createdTasks'] = [];
    const importErrors: BulkImportResult['errors'] = [];
    let successCount = 0;
    let failedCount = 0;

    for (const row of validRows) {
      try {
        const ticketNumber = await generateTicketNumber();

        const task = await prisma.task.create({
          data: {
            taskId: uuidv4(),
            ticketNumber,
            title: row.data.title,
            description: row.data.description || '',
            location: row.data.location,
            latitude: row.data.latitude,
            longitude: row.data.longitude,
            startTime: convertTimeToDateTime(row.data.startTime || '08:00'),
            endTime: convertTimeToDateTime(row.data.endTime || '17:00'),
            manualOverride: false,
            status: 'active',
            // Pembuat task + snapshot role untuk badge "Dibuat oleh {Role}"
            createdById: req.user?.userId ?? null,
            createdByRoleName: req.user?.role ?? null,
          },
        });

        createdTasks.push({
          taskId: task.taskId,
          ticketNumber: task.ticketNumber || '',
          title: task.title,
        });
        successCount++;
      } catch (taskError: any) {
        failedCount++;
        importErrors.push({
          row: row.rowNumber,
          title: row.data.title,
          error: taskError.message || 'Gagal membuat task.',
        });
      }
    }

    // Send notifications to admins
    if (createdTasks.length > 0) {
      try {
        // Penerima: semua user yang boleh melihat task (RBAC: tasks.view)
        const admins = await findUsersWithPermission('tasks.view', { id: true });

        if (admins.length > 0) {
          const notificationData = admins.map(admin => ({
            userId: admin.id,
            title: 'Bulk Upload Selesai',
            message: `Bulk upload selesai. ${successCount} task berhasil dibuat dari ${validRows.length} data valid.`,
            category: 'BULK_UPLOAD_COMPLETE',
            relatedId: null,
          }));

          await prisma.notification.createMany({ data: notificationData });

          // Real-time socket event ke admin
          admins.forEach((admin) => {
            io.to(`user:${admin.id}`).emit('admin:new_master_task', {
              title: 'Bulk Upload Selesai',
              message: `${successCount} task baru berhasil diimport ke sistem.`,
            });
          });
        }
      } catch (notifError) {
        console.error('[BulkUpload] Failed to send notifications:', notifError);
      }
    }

    const result: BulkImportResult = {
      total: validRows.length,
      success: successCount,
      failed: failedCount,
      // Rows, not error messages: one row can produce several validation errors
      skipped: processedRows.length - validRows.length,
      errors: importErrors,
      createdTasks,
    };

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Download template Excel file (with dropdown for Start Time & End Time)
 */
export const downloadTemplate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'C-Track';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Task Template', {
      properties: { defaultColWidth: 18 },
    });

    // ── Define columns ─────────────────────────────────────────
    worksheet.columns = [
      { header: 'Title', key: 'title', width: 30 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Location', key: 'location', width: 30 },
      { header: 'Link Google Maps', key: 'linkGoogleMaps', width: 50 },
      { header: 'Start Time', key: 'startTime', width: 14 },
      { header: 'End Time', key: 'endTime', width: 14 },
    ];

    // ── Style header row ───────────────────────────────────────
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1A1A1A' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 28;

    // ── Dropdown options for Start Time & End Time ──────────────
    const timeOptions = [
      '06:00', '06:30', '07:00', '07:30', '08:00', '08:30',
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
      '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
      '18:00', '18:30', '19:00', '19:30', '20:00', '20:30',
    ];
    const timeList = timeOptions.join(',');

    // ── Add sample data rows ───────────────────────────────────
    const sampleRows = [
      {
        title: 'Contoh Task 1',
        description: 'Deskripsi task 1',
        location: 'Jl. Raya Contoh No. 1',
        linkGoogleMaps: 'https://maps.google.com/@-7.7956,110.3695,15z',
        startTime: '08:00',
        endTime: '17:00',
      },
      {
        title: 'Contoh Task 2',
        description: 'Deskripsi task 2',
        location: 'Jl. Raya Contoh No. 2',
        linkGoogleMaps: 'https://maps.google.com/@-7.8056,110.3795,15z',
        startTime: '09:00',
        endTime: '18:00',
      },
    ];

    sampleRows.forEach((row) => {
      worksheet.addRow(row);
    });

    // ── Add dropdown validation to Start Time (col E) ──────────
    // Apply to rows 2-1000 so users can add many tasks
    // Note: dataValidations exists at runtime but @types/exceljs is incomplete
    const ws = worksheet as any;
    ws.dataValidations.add('E2:E1000', {
      type: 'list',
      allowBlank: true,
      formulae: [`"${timeList}"`],
      showErrorMessage: true,
      errorTitle: 'Invalid Start Time',
      error: 'Please select a valid time from the dropdown.',
    });

    // ── Add dropdown validation to End Time (col F) ────────────
    ws.dataValidations.add('F2:F1000', {
      type: 'list',
      allowBlank: true,
      formulae: [`"${timeList}"`],
      showErrorMessage: true,
      errorTitle: 'Invalid End Time',
      error: 'Please select a valid time from the dropdown.',
    });

    // ── Style sample data rows ─────────────────────────────────
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE5E5EA' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E5EA' } },
            left: { style: 'thin', color: { argb: 'FFE5E5EA' } },
            right: { style: 'thin', color: { argb: 'FFE5E5EA' } },
          };
        });
      }
    });

    // ── Generate buffer and send ───────────────────────────────
    const excelBuffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=task_template.xlsx');
    res.send(Buffer.from(excelBuffer));
  } catch (error) {
    next(error);
  }
};