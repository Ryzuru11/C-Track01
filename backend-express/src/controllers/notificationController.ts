import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';

// 1. Mengambil semua notifikasi milik user yang sedang login
export const getMyNotifications = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }, // Yang paling baru di atas
    });

    res.json(notifications);
  } catch (error) {
    console.error('Error getting notifications:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// 2. Menghitung jumlah notifikasi yang belum dibaca (Unread)
export const getUnreadCount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const count = await prisma.notification.count({
      where: { 
        userId,
        isRead: false 
      },
    });

    res.json({ unreadCount: count });
  } catch (error) {
    console.error('Error counting unread notifications:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// 3. Menandai notifikasi sebagai "Sudah Dibaca"
export const markAsRead = async (req: AuthRequest, res: Response) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user?.userId;

    // Pastikan notifikasi ini benar-benar milik user yang sedang login
    const notification = await prisma.notification.findFirst({
      where: { 
        id: notificationId, 
        userId: userId 
      }
    });

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    const updatedNotification = await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });

    res.json(updatedNotification);
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// 4. Menghapus semua notifikasi milik user
export const deleteAllNotifications = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const result = await prisma.notification.deleteMany({
      where: { userId },
    });

    res.json({ message: 'All notifications deleted successfully', count: result.count });
  } catch (error) {
    console.error('Error deleting notifications:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};