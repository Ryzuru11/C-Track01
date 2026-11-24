import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import app from '../../src/app';
import prisma from '../../src/config/database';
import { DEFAULT_ROLE_GRANTS } from '../../src/rbac/permissions';
import { isGoogleMapsShortLink } from '../../src/utils/googleMaps';

// Every prisma model/method is an auto-created mock: findMany → [], everything else → null.
vi.mock('../../src/config/database', () => {
  const models: Record<string, any> = {};
  const model = (name: string) =>
    (models[name] ??= new Proxy({} as Record<string, any>, {
      get: (target, method: string) =>
        (target[method] ??= vi.fn(async () => (method === 'findMany' ? [] : null))),
    }));
  return { default: new Proxy({}, { get: (_t, prop: string) => model(prop) }) };
});

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';
const db = prisma as any;

const MANAGER = {
  id: 'manager-1', email: 'manager@example.com', name: 'Budi', status: 'active',
  modelHasRoles: [{ role: {
    id: 3n, name: 'manager', guardName: 'web', displayName: 'Manager', level: 50, platform: 'web',
    color: null, showTaskBadge: true,
    roleHasPermissions: DEFAULT_ROLE_GRANTS.manager.map((name) => ({ permission: { name } })),
  } }],
};
const auth = { Authorization: `Bearer ${jwt.sign({ userId: MANAGER.id, email: MANAGER.email }, JWT_SECRET)}` };

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAPS = 'https://www.google.com/maps/place/Malioboro/@-7.7926,110.3658,17z';

type Row = Partial<Record<'Title' | 'Description' | 'Location' | 'Link Google Maps' | 'Start Time' | 'End Time', string>>;
const row = (overrides: Row = {}): Row => ({
  Title: 'Inspeksi Tower A',
  Description: 'Cek kabel',
  Location: 'Jl. Malioboro No. 1',
  'Link Google Maps': MAPS,
  'Start Time': '08:00',
  'End Time': '17:00',
  ...overrides,
});

/** Build a real .xlsx file in memory, like a user would upload */
const workbook = (rows: Row[]): Buffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Tasks');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

const upload = (path: string, rows: Row[]) =>
  request(app).post(path).set(auth).attach('file', workbook(rows), { filename: 'tasks.xlsx', contentType: XLSX_MIME });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  db.user.findUnique.mockImplementation(async ({ where }: any) => (where?.id === MANAGER.id ? MANAGER : null));
  db.task.create.mockImplementation(async ({ data }: any) => data);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/admin/tasks/bulk-preview', () => {
  it('returns valid rows with coordinates taken from the Google Maps link', async () => {
    const res = await upload('/api/admin/tasks/bulk-preview', [row(), row({ Title: 'Inspeksi Tower B', 'Start Time': '9:30', 'End Time': '12:00' })]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, valid: 2, errors: [] });
    expect(res.body.validRows[0]).toEqual({
      rowNumber: 2,
      data: {
        title: 'Inspeksi Tower A', description: 'Cek kabel', location: 'Jl. Malioboro No. 1',
        latitude: -7.7926, longitude: 110.3658, startTime: '08:00', endTime: '17:00',
      },
    });
    expect(res.body.validRows[1].data.startTime).toBe('09:30'); // "9:30" normalized
    expect(db.task.create).not.toHaveBeenCalled(); // preview never writes
  });

  it('defaults missing times to 08:00–17:00', async () => {
    const res = await upload('/api/admin/tasks/bulk-preview', [row({ 'Start Time': '', 'End Time': '' })]);
    expect(res.body.validRows[0].data).toMatchObject({ startTime: '08:00', endTime: '17:00' });
  });

  it.each([
    ['missing title', { Title: '' }, 'Title'],
    ['too-short location', { Location: 'ab' }, 'Location'],
    ['non Google Maps link', { 'Link Google Maps': 'https://example.com/@-7.79,110.36,17z' }, 'Link Google Maps'],
    ['invalid start time', { 'Start Time': '25:00' }, 'StartTime'],
    ['end time before start time', { 'Start Time': '17:00', 'End Time': '08:00' }, 'End Time'],
    ['Google Maps link without coordinates', { 'Link Google Maps': 'https://www.google.com/maps/place/Malioboro' }, 'Link Google Maps'],
  ])('reports %s with the Excel row number and column', async (_label, overrides, column) => {
    const res = await upload('/api/admin/tasks/bulk-preview', [row(), row(overrides as Row)]);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.valid).toBe(1);
    expect(res.body.errors[0]).toMatchObject({ row: 3, column });
  });

  it('follows a maps.app.goo.gl short link to read the coordinates', async () => {
    fetchMock.mockResolvedValueOnce({ url: 'https://www.google.com/maps/place/Tugu/@-7.7829,110.3671,17z' });

    const res = await upload('/api/admin/tasks/bulk-preview', [row({ 'Link Google Maps': 'https://maps.app.goo.gl/AbCdEf123' })]);

    expect(fetchMock).toHaveBeenCalledWith('https://maps.app.goo.gl/AbCdEf123', expect.objectContaining({ redirect: 'follow' }));
    expect(res.body.validRows[0].data).toMatchObject({ latitude: -7.7829, longitude: 110.3671 });
  });

  it('reports the row when the short link cannot be resolved', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const res = await upload('/api/admin/tasks/bulk-preview', [row({ 'Link Google Maps': 'https://maps.app.goo.gl/broken' })]);
    expect(res.body.errors[0]).toMatchObject({ row: 2, column: 'Link Google Maps', error: 'Failed to extract coordinates.' });
  });

  it('never fetches a look-alike host (SSRF)', async () => {
    const res = await upload('/api/admin/tasks/bulk-preview', [row({ 'Link Google Maps': 'https://maps.app.goo.gl.attacker.com/x' })]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.body.valid).toBe(0);
  });

  it('rejects an empty sheet, a missing file and a non-Excel file', async () => {
    expect((await upload('/api/admin/tasks/bulk-preview', [])).status).toBe(400);
    expect((await request(app).post('/api/admin/tasks/bulk-preview').set(auth)).status).toBe(400);
    const csv = await request(app).post('/api/admin/tasks/bulk-preview').set(auth)
      .attach('file', Buffer.from('a,b\n1,2'), { filename: 'tasks.csv', contentType: 'text/csv' });
    expect(csv.status).toBe(400);
  });
});

describe('POST /api/admin/tasks/bulk-import', () => {
  it('creates only the valid rows with continuing ticket numbers and the creator badge info', async () => {
    db.task.findMany
      .mockResolvedValueOnce([{ ticketNumber: 'TSK-0005' }, { ticketNumber: 'TSK-0002' }])
      .mockResolvedValueOnce([{ ticketNumber: 'TSK-0005' }, { ticketNumber: 'TSK-0006' }]);

    const res = await upload('/api/admin/tasks/bulk-import', [row(), row({ Title: '' }), row({ Title: 'Inspeksi Tower C' })]);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ total: 2, success: 2, failed: 0, skipped: 1 });
    const created = db.task.create.mock.calls.map(([args]: any[]) => args.data);
    expect(created.map((t: any) => t.ticketNumber)).toEqual(['TSK-0006', 'TSK-0007']);
    expect(created[0]).toMatchObject({
      title: 'Inspeksi Tower A', latitude: -7.7926, longitude: 110.3658, status: 'active',
      createdById: 'manager-1', createdByRoleName: 'manager',
    });
    expect(created[0].startTime.toISOString()).toBe('1970-01-01T08:00:00.000Z');
    expect(created[0].endTime.toISOString()).toBe('1970-01-01T17:00:00.000Z');
  });

  it('keeps going when one row fails to save and reports it', async () => {
    db.task.create
      .mockRejectedValueOnce(new Error('Duplicate ticket'))
      .mockImplementationOnce(async ({ data }: any) => data);

    const res = await upload('/api/admin/tasks/bulk-import', [row(), row({ Title: 'Kedua' })]);

    expect(res.body).toMatchObject({ success: 1, failed: 1 });
    expect(res.body.errors[0]).toMatchObject({ row: 2, title: 'Inspeksi Tower A', error: 'Duplicate ticket' });
  });

  it('refuses to import when no row is valid', async () => {
    const res = await upload('/api/admin/tasks/bulk-import', [row({ Title: '' })]);
    expect(res.status).toBe(400);
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it('notifies everyone with tasks.view once', async () => {
    db.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }, { id: 'manager-1' }]);
    await upload('/api/admin/tasks/bulk-import', [row()]);
    const { data } = db.notification.createMany.mock.calls[0][0];
    expect(data.map((n: any) => n.userId)).toEqual(['admin-1', 'manager-1']);
    expect(data[0]).toMatchObject({ category: 'BULK_UPLOAD_COMPLETE' });
  });
});

describe('GET /api/admin/tasks/template', () => {
  it('returns an .xlsx with the expected columns and time dropdowns', async () => {
    const res = await request(app).get('/api/admin/tasks/template').set(auth)
      .buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(XLSX_MIME);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const sheet = wb.getWorksheet('Task Template')!;
    expect(sheet.getRow(1).values).toEqual([undefined, 'Title', 'Description', 'Location', 'Link Google Maps', 'Start Time', 'End Time']);
    // After a round-trip ExcelJS stores list validations per cell
    const validations = (sheet as any).dataValidations.model;
    for (const cell of ['E2', 'E1000', 'F2', 'F1000']) {
      expect(validations[cell]).toMatchObject({ type: 'list' });
      expect(validations[cell].formulae[0]).toContain('08:00');
    }
  });

  it('the downloaded template passes its own preview', async () => {
    const res = await request(app).get('/api/admin/tasks/template').set(auth)
      .buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });

    const preview = await request(app).post('/api/admin/tasks/bulk-preview').set(auth)
      .attach('file', res.body, { filename: 'task_template.xlsx', contentType: XLSX_MIME });

    expect(preview.body).toMatchObject({ total: 2, valid: 2 });
  });
});

describe('isGoogleMapsShortLink', () => {
  it.each([
    ['https://maps.app.goo.gl/AbC123', true],
    ['https://goo.gl/maps/xyz', true],
    ['https://g.co/maps/abc', true],
    ['https://maps.app.goo.gl.attacker.com/x', false],
    ['https://attacker.com/?next=maps.app.goo.gl', false],
    ['https://g.co/kgs/abc', false],
    ['https://user:pass@maps.app.goo.gl/x', false],
    ['https://maps.app.goo.gl:8443/x', false],
    ['file:///etc/passwd', false],
    ['not a url', false],
  ])('%s → %s', (link, expected) => {
    expect(isGoogleMapsShortLink(link)).toBe(expected);
  });
});
