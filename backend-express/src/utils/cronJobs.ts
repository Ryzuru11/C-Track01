import cron from 'node-cron';
import prisma from '../config/database';
import { Expo } from 'expo-server-sdk';

const expo = new Expo();

export const initCronJobs = () => {
  console.log('🤖 [Cron Job] Robot Penjadwal siap sedia (Saat ini belum ada jadwal aktif).');

  // 🛑 FITUR LAMA DIMATIKAN:
  // Robot pengecek umur akun 30 hari sudah dinonaktifkan.
  // Sistem notifikasi sekarang menggunakan Event-Driven (achievementHandler.ts).

  /* Nantinya, kalau kamu butuh robot penjadwal untuk fitur lain di masa depan
    (Misalnya: Mengirim rekapan laporan harian ke Super Admin tiap jam 12 malam),
    kamu bisa menaruh kodingan cron.schedule() yang baru di sini!
  */
};