import { Router } from 'express';
import { login, me, logout, changePassword, registerPushToken } from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Public routes
// No self-registration: accounts are created from User Management (POST /admin/users)
router.post('/login', login);

// Protected routes
router.get('/me', authenticate, me);
router.post('/logout', authenticate, logout);
router.post('/change-password', authenticate, changePassword);
router.post('/register-push-token', authenticate, registerPushToken);

export default router;
