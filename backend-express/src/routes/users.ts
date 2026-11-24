import { Router } from 'express';
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  updateUserStatus,
  deleteUser,
  uploadAvatar,
  getUserAvatar,
} from '../controllers/userController';
import { authenticate } from '../middleware/auth';
import { requirePermission, requireAnyPermission, requireWeb } from '../middleware/permissions';

const router = Router();

// =============================================================================
// ADMIN ROUTES (mounted at /admin/users)
// =============================================================================

// User management - permission based (RBAC v2)
router.get('/', authenticate, requireWeb, requireAnyPermission('users.view', 'analytics.view', 'dashboard.view', 'teams.view', 'assignments.create', 'assignments.update'), getAllUsers); // Get all users (index)
router.post('/', authenticate, requireWeb, requirePermission('users.create'), createUser); // Create user (store)
router.get('/:userId/avatar', authenticate, getUserAvatar); // Get user avatar (for lazy loading)
router.get('/:userId', authenticate, requireWeb, requirePermission('users.view'), getUserById); // Show user
router.put('/:userId/status', authenticate, requireWeb, requirePermission('users.toggle_status'), updateUserStatus); // Update status (hierarchy checked in controller)
router.delete('/:userId', authenticate, requireWeb, requirePermission('users.delete'), deleteUser); // Delete user (hierarchy checked in controller)

// TODO: Implement departments endpoint
// router.get('/departments', authenticate, requireWeb, requirePermission('users.view'), departments); // Get departments

// =============================================================================
// PROFILE ROUTES (mounted at /profile)
// =============================================================================
// Self: any authenticated user (role/status/email are ignored).
// Other user: users.update + role hierarchy (checked in controller).
router.put('/:userId', authenticate, updateUser); // Update profile
router.post('/:userId/avatar', authenticate, uploadAvatar); // Upload avatar

export default router;
