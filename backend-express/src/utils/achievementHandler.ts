import prisma from '../config/database';
import { Expo } from 'expo-server-sdk';
import { io } from '../app';
import { getLeaderboard } from '../services/leaderboard.service';

const expo = new Expo();

// Variabel memori untuk mencatat siapa Peringkat 1 SEBELUMNYA
let previousRankOneUserId: string | null = null;

/**
 * Fungsi ini dipanggil setiap kali ada task yang berhasil diselesaikan (Completed)
 */
export const checkLeaderboardAchievement = async () => {
  console.log("🔥 CHECK LEADERBOARD ACHIEVEMENT DIPANGGIL");
  try {
    console.log(
      '🏆 [Achievement] Menghitung ulang Leaderboard untuk mendeteksi Juara 1...'
    );



    // Ambil leaderboard dari service
    const leaderboard = await getLeaderboard();

    console.log("===== LEADERBOARD =====");
    console.table(
      leaderboard.map((u) => ({
        rank: u.rank,
        userId: u.userId,
        name: u.name,
        score: u.behaviorScore,
      }))
    );

    if (!leaderboard || leaderboard.length === 0) {
      return;
    }

    // Karyawan yang menduduki Peringkat 1 saat ini
    const currentRankOne = leaderboard[0];

    if (previousRankOneUserId === null) {
      previousRankOneUserId = currentRankOne.userId;

      console.log(
        "🔄 Initial Rank #1:",
        currentRankOne.name
      );

      return;
    }

    console.log("🥇 RANK 1:", currentRankOne);

    if (!currentRankOne) {
      return;
    }

    console.log(
      `🥇 Peringkat 1 Saat Ini: ${currentRankOne.name} (ID: ${currentRankOne.userId}) dengan skor ${currentRankOne.behaviorScore}`
    );

    console.log(
      "🔍 previousRankOneUserId:",
      previousRankOneUserId
    );

    console.log(
      "🔍 currentRankOne.userId:",
      currentRankOne.userId
    );

    console.log("🔍 previousRankOneUserId:", previousRankOneUserId);
    console.log("🔍 currentRankOne.userId:", currentRankOne.userId);

    // Cek apakah terjadi PERGANTIAN JUARA 1
    if (
      previousRankOneUserId &&
      previousRankOneUserId !== currentRankOne.userId
    ) {
      console.log(
        `🎉 [NOTIFIKASI] ${currentRankOne.name} mengambil alih Peringkat 1!`
      );

      // A. Simpan Notifikasi In-App ke Database
      await prisma.notification.create({
        data: {
          userId: currentRankOne.userId,
          title: 'Juara 1 Leaderboard!',
          message: `Selamat ${currentRankOne.name}! Kamu baru saja mengambil alih posisi Peringkat 1 di Leaderboard dengan Skor ${currentRankOne.behaviorScore}. Pertahankan prestasimu!`,
          category: 'ACHIEVEMENT',
          relatedId: null,
          isRead: false,
        },
      });

      console.log("✅ ACHIEVEMENT BERHASIL DISIMPAN KE DATABASE");

      // B. Kirim Push Notification via Expo SDK
      console.log(
        "📱 Push Token User:",
        currentRankOne.pushToken
      );

      if (
        currentRankOne.pushToken &&
        Expo.isExpoPushToken(currentRankOne.pushToken)
      ) {
        try {
          const chunks = expo.chunkPushNotifications([
            {
              to: currentRankOne.pushToken,
              sound: 'default',
              title: 'Peringkat 1 Baru! 🥇',
              body: 'Selamat! Kamu sekarang menduduki posisi puncak Leaderboard C-Track. 🚀',
              data: {
                category: 'ACHIEVEMENT',
              },
            },
          ]);

          for (const chunk of chunks) {
            console.log("📤 Mengirim push notification...");

            const ticket = await expo.sendPushNotificationsAsync(chunk);

            console.log("✅ Push notification berhasil:", ticket);
          }
        } catch (expoError) {
          console.error(
            '🛑 Gagal menembak push notification Expo:',
            expoError
          );
        }
      }

      // C. Emit Real-time via Socket.io
      if (io) {
        console.log(
          "🔔 Mengirim socket notification ke:",
          currentRankOne.userId
        );
        io.to(currentRankOne.userId).emit('notification:received', {
          title: 'Juara 1 Leaderboard!',
          category: 'ACHIEVEMENT',
        });
      }
    }

    // Update catatan memori Peringkat 1
    previousRankOneUserId = currentRankOne.userId;
  } catch (error) {
    console.error(
      '🛑 Error saat memeriksa pencapaian leaderboard:',
      error
    );
  }
};