import { Router } from 'express';
import { 
    getMyNotifications, 
    getUnreadCount, 
    markAsRead,
    deleteAllNotifications
} from '../controllers/notificationController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Semua rute notifikasi harus login dulu (authenticate)
router.get('/', authenticate, getMyNotifications);
router.get('/unread-count', authenticate, getUnreadCount);
router.patch('/:notificationId/read', authenticate, markAsRead);
router.delete('/all', authenticate, deleteAllNotifications);

export default router;