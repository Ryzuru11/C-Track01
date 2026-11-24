import { Router } from 'express';
import authRoutes from './auth';
import taskRoutes from './tasks';
import { employeeRouter, adminRouter } from './takenTasks';
import locationRoutes from './locations';
import { employeeReportRoutes, adminReportRoutes } from './reports';
import userRoutes from './users';
import chatRoutes from "./chat";
import geocodingRoutes from './geocoding';
import aiRoutes from './ai';
import notificationRoutes from './notifications';
import achievementRoutes from './achievement';
import teamRoutes from './teams';
import { roleRoutes, permissionRoutes } from './roles';

const router = Router();

// Public authentication routes
router.use('/auth', authRoutes);

// Geocoding routes (for map search functionality)
router.use('/geocoding', geocodingRoutes);

// Admin routes (protected by role middleware in individual route files)
router.use('/admin/users', userRoutes);
router.use('/admin/tasks', taskRoutes);
router.use('/admin/assignments', adminRouter);
router.use('/admin/locations', locationRoutes);
router.use('/admin/reports', adminReportRoutes);

// Employee routes (task management)
router.use('/my-tasks', employeeRouter);

// Employee routes (location tracking)
router.use('/locations', locationRoutes);

// Employee routes (reports)
router.use('/reports', employeeReportRoutes);

// User profile routes (authenticated users)
router.use('/profile', userRoutes);

// AI copilot routes (admin analytics assistant)
router.use('/ai', aiRoutes);

router.use("/chat", chatRoutes);

// Notification routes (Employee & Admin)
router.use('/notifications', notificationRoutes);

router.use('/achievement', achievementRoutes);
router.use('/admin/teams', teamRoutes);

// Role dashboard (RBAC v2)
router.use('/admin/roles', roleRoutes);
router.use('/admin/permissions', permissionRoutes);

export default router;
