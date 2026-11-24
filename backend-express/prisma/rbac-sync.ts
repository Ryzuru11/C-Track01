/**
 * CLI: npm run rbac:sync
 * Jalankan setelah `prisma migrate deploy` di setiap deploy. Aman dijalankan berulang kali.
 */
import { PrismaClient } from '@prisma/client';
import { syncRbac } from '../src/rbac/sync';

const prisma = new PrismaClient();

syncRbac(prisma)
  .then((summary) => {
    console.log('🔐 RBAC sync selesai');
    console.log(`  - Permission di-upsert : ${summary.permissionsUpserted}`);
    console.log(`  - Permission dihapus   : ${summary.permissionsDeleted}`);
    console.log(`  - Role dibuat          : ${summary.rolesCreated.join(', ') || '-'}`);
    console.log(`  - Role diinisialisasi  : ${summary.rolesInitialized.join(', ') || '-'}`);
  })
  .catch((error) => {
    console.error('❌ RBAC sync gagal:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
