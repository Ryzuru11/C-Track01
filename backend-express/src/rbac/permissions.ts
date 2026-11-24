/**
 * Katalog hak akses (RBAC v2)
 *
 * Satu sumber kebenaran untuk semua permission key. Dipakai oleh:
 * - prisma/rbac-sync.ts  → upsert ke tabel `permissions` & grant default
 * - middleware/permissions.ts, rbac/access.ts → pengecekan saat runtime
 * - GET /admin/permissions → matriks di Role dashboard
 *
 * Format key: `modul.aksi`. Setiap aksi dalam satu modul membutuhkan
 * `<modul>.view` (mengikuti panah "include Read" di diagram use case).
 */

export const SYSTEM_ROLES = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
} as const;

export const RESERVED_ROLE_NAMES: string[] = Object.values(SYSTEM_ROLES);

export const GUARD_NAME = 'web';

export interface PermissionDefinition {
  key: string;
  module: string;
  label: string;
  description: string;
  /** Key lain yang wajib aktif bersama key ini */
  requires?: string[];
  /** Hanya untuk superadmin, tidak bisa diberikan ke role lain */
  locked?: boolean;
}

export interface ModuleDefinition {
  module: string;
  label: string;
}

/** Urutan modul mengikuti diagram use case */
export const MODULES: ModuleDefinition[] = [
  { module: 'dashboard', label: 'Dashboard Overview' },
  { module: 'analytics', label: 'Employee Analytics' },
  { module: 'tasks', label: 'Task Management' },
  { module: 'assignments', label: 'Task Assignment Management' },
  { module: 'monitoring', label: 'Monitoring Karyawan' },
  { module: 'users', label: 'User Management' },
  { module: 'teams', label: 'Tim Management' },
  { module: 'ai', label: 'AI Assistant' },
  { module: 'roles', label: 'Roles & Hak Akses' },
];

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  { key: 'dashboard.view', module: 'dashboard', label: 'Lihat Dashboard Overview', description: 'Membuka halaman Dashboard dan ringkasan operasional.' },

  { key: 'analytics.view', module: 'analytics', label: 'Lihat Employee Analytics', description: 'Membuka halaman analitik performa karyawan.' },

  { key: 'tasks.view', module: 'tasks', label: 'Lihat task', description: 'Melihat daftar dan detail task.' },
  { key: 'tasks.create', module: 'tasks', label: 'Buat task', description: 'Membuat task baru.', requires: ['tasks.view'] },
  { key: 'tasks.update', module: 'tasks', label: 'Ubah task', description: 'Mengubah data task dan menandai task selesai.', requires: ['tasks.view'] },
  { key: 'tasks.delete', module: 'tasks', label: 'Hapus task', description: 'Menghapus task.', requires: ['tasks.view'] },
  { key: 'tasks.toggle_status', module: 'tasks', label: 'Aktifkan / nonaktifkan task', description: 'Mengubah status aktif/nonaktif task.', requires: ['tasks.view'] },
  { key: 'tasks.import', module: 'tasks', label: 'Upload task (bulk Excel)', description: 'Mengunggah banyak task sekaligus dari file Excel.', requires: ['tasks.view'] },
  { key: 'tasks.export', module: 'tasks', label: 'Download template', description: 'Mengunduh template Excel untuk upload task.', requires: ['tasks.view'] },

  { key: 'assignments.view', module: 'assignments', label: 'Lihat penugasan', description: 'Melihat daftar dan detail penugasan.' },
  { key: 'assignments.create', module: 'assignments', label: 'Buat penugasan', description: 'Menugaskan task ke karyawan atau tim.', requires: ['assignments.view'] },
  { key: 'assignments.update', module: 'assignments', label: 'Ubah penugasan', description: 'Mengubah karyawan, tanggal, atau jam penugasan.', requires: ['assignments.view'] },
  { key: 'assignments.delete', module: 'assignments', label: 'Hapus penugasan', description: 'Menghapus penugasan.', requires: ['assignments.view'] },

  { key: 'monitoring.view_reports', module: 'monitoring', label: 'Lihat laporan', description: 'Melihat laporan karyawan dan forum diskusinya.' },
  { key: 'monitoring.view_locations', module: 'monitoring', label: 'Lihat lokasi', description: 'Melihat lokasi dan rute karyawan secara real-time.' },
  { key: 'monitoring.manage_reports', module: 'monitoring', label: 'Selesaikan / hapus laporan', description: 'Menandai laporan selesai atau menghapusnya.', requires: ['monitoring.view_reports'] },

  { key: 'users.view', module: 'users', label: 'Lihat user', description: 'Melihat daftar dan detail user.' },
  { key: 'users.create', module: 'users', label: 'Buat user', description: 'Mendaftarkan user baru.', requires: ['users.view'] },
  { key: 'users.update', module: 'users', label: 'Ubah user', description: 'Mengubah data dan role user dengan level lebih rendah.', requires: ['users.view'] },
  { key: 'users.delete', module: 'users', label: 'Hapus user', description: 'Menghapus user dengan level lebih rendah.', requires: ['users.view'] },
  { key: 'users.toggle_status', module: 'users', label: 'Aktifkan / nonaktifkan user', description: 'Mengubah status aktif/nonaktif user dengan level lebih rendah.', requires: ['users.view'] },

  { key: 'teams.view', module: 'teams', label: 'Lihat tim', description: 'Melihat daftar tim dan anggotanya.' },
  { key: 'teams.create', module: 'teams', label: 'Buat tim', description: 'Membuat tim baru.', requires: ['teams.view'] },
  { key: 'teams.update', module: 'teams', label: 'Ubah tim', description: 'Mengubah data tim dan anggotanya.', requires: ['teams.view'] },
  { key: 'teams.delete', module: 'teams', label: 'Hapus tim', description: 'Menghapus tim.', requires: ['teams.view'] },

  { key: 'ai.use', module: 'ai', label: 'Gunakan AI Assistant', description: 'Menggunakan chatbot AI Assistant.' },

  { key: 'roles.manage', module: 'roles', label: 'Kelola role & hak akses', description: 'Membuat role dan mengatur hak aksesnya. Khusus Superadmin.', locked: true },
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_DEFINITIONS.map((p) => p.key);

const DEFINITION_BY_KEY = new Map(PERMISSION_DEFINITIONS.map((p) => [p.key, p]));

export const isKnownPermission = (key: string): boolean => DEFINITION_BY_KEY.has(key);

export const isLockedPermission = (key: string): boolean => DEFINITION_BY_KEY.get(key)?.locked === true;

/**
 * Tambahkan permission yang diwajibkan (requires) secara otomatis.
 * Mengembalikan set lengkap dan daftar key yang ditambahkan.
 */
export const withRequiredPermissions = (keys: string[]): { permissions: string[]; autoAdded: string[] } => {
  const result = new Set(keys);
  const autoAdded: string[] = [];
  for (const key of keys) {
    for (const required of DEFINITION_BY_KEY.get(key)?.requires || []) {
      if (!result.has(required)) {
        result.add(required);
        autoAdded.push(required);
      }
    }
  }
  // Pertahankan urutan katalog
  return {
    permissions: ALL_PERMISSION_KEYS.filter((k) => result.has(k)),
    autoAdded,
  };
};

const ADMIN_DEFAULTS = ALL_PERMISSION_KEYS.filter(
  (key) => !['analytics.view', 'users.delete', 'roles.manage'].includes(key)
);

/**
 * Hak akses default saat role sistem pertama kali dibuat.
 * Admin tidak punya Employee Analytics; Manager punya (catatan diagram use case).
 * Hapus user hanya Superadmin (perilaku lama dipertahankan).
 */
export const DEFAULT_ROLE_GRANTS: Record<string, string[]> = {
  [SYSTEM_ROLES.SUPERADMIN]: ALL_PERMISSION_KEYS,
  [SYSTEM_ROLES.ADMIN]: ADMIN_DEFAULTS,
  [SYSTEM_ROLES.MANAGER]: [...ADMIN_DEFAULTS, 'analytics.view'],
  [SYSTEM_ROLES.EMPLOYEE]: [],
};

export interface SystemRoleDefinition {
  name: string;
  displayName: string;
  description: string;
  level: number;
  platform: 'web' | 'mobile';
  color: string;
  showTaskBadge: boolean;
}

export const SYSTEM_ROLE_DEFINITIONS: SystemRoleDefinition[] = [
  { name: SYSTEM_ROLES.SUPERADMIN, displayName: 'Superadmin', description: 'Akses penuh, termasuk pengaturan role dan hak akses.', level: 100, platform: 'web', color: '#7c3aed', showTaskBadge: false },
  { name: SYSTEM_ROLES.ADMIN, displayName: 'Admin', description: 'Mengelola task, penugasan, user, dan tim.', level: 50, platform: 'web', color: '#2563eb', showTaskBadge: false },
  { name: SYSTEM_ROLES.MANAGER, displayName: 'Manager', description: 'Seperti Admin, ditambah akses Employee Analytics.', level: 50, platform: 'web', color: '#0891b2', showTaskBadge: true },
  { name: SYSTEM_ROLES.EMPLOYEE, displayName: 'Employee', description: 'Karyawan lapangan. Hanya dapat login di aplikasi mobile.', level: 10, platform: 'mobile', color: '#db2777', showTaskBadge: false },
];

/** Katalog yang dikelompokkan per modul untuk matriks UI */
export const getPermissionCatalog = () => ({
  modules: MODULES.map((m) => ({
    module: m.module,
    label: m.label,
    permissions: PERMISSION_DEFINITIONS.filter((p) => p.module === m.module).map((p) => ({
      key: p.key,
      label: p.label,
      description: p.description,
      ...(p.key === `${p.module}.view` && { isBase: true }),
      ...(p.requires && { requires: p.requires }),
      ...(p.locked && { locked: true }),
    })),
  })),
});
