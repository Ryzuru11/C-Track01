import { Router } from 'express';
import {
  getAllTakenTasks,
  getTakenTaskById,
  assignTask,
  updateTakenTaskStatus,
  startTracking,
  completeTakenTask, // 🌟 INI YANG DITAMBAHKAN
  deleteTakenTask,
  updateAssignment,
  getUserTasks,
  getMyStatistics,
} from '../controllers/takenTaskController';
import { authenticate } from '../middleware/auth';
import { requirePermission, requireAnyPermission, requireWeb } from '../middleware/permissions';
import { requireAssignmentAccess } from '../rbac/assignmentAccess';

// Employee routes router
const employeeRouter = Router();

// Employee task routes - view and manage own tasks
employeeRouter.get('/', authenticate, getUserTasks); // Get own tasks (myTasks)
employeeRouter.get('/statistics', authenticate, getMyStatistics); // Get own statistics
employeeRouter.get('/:takenTaskId', authenticate, requireAssignmentAccess('assignments.view', 'monitoring.view_reports', 'monitoring.view_locations'), getTakenTaskById); // Get task detail (assigned employees only)

// Start tracking when swipeable button is pressed
employeeRouter.patch('/:takenTaskId/start', authenticate, startTracking); // Start tracking

// 🌟 👇 RUTE BARU UNTUK MENYELESAIKAN TUGAS 👇 🌟
employeeRouter.patch('/:takenTaskId/complete', authenticate, completeTakenTask); // Complete tracking/task

// Update status (employee can update their own)
employeeRouter.patch('/:takenTaskId/status', authenticate, updateTakenTaskStatus);

// Admin routes router
const adminRouter = Router();

// Admin assignment management routes
adminRouter.get('/', authenticate, requireWeb, requireAnyPermission('assignments.view', 'dashboard.view', 'analytics.view'), getAllTakenTasks); // Get all assignments (index)
adminRouter.post('/', authenticate, requireWeb, requirePermission('assignments.create'), assignTask); // Create assignment (store)
adminRouter.get('/:takenTaskId', authenticate, requireWeb, requireAnyPermission('assignments.view', 'monitoring.view_reports', 'monitoring.view_locations'), getTakenTaskById); // Show assignment
adminRouter.put('/:takenTaskId', authenticate, requireWeb, requirePermission('assignments.update'), updateAssignment); // Update assignment
adminRouter.delete('/:takenTaskId', authenticate, requireWeb, requirePermission('assignments.delete'), deleteTakenTask); // Delete assignment (destroy)
// TODO: Implement cancel task
// adminRouter.put('/:takenTaskId/cancel', authenticate, requireWeb, requirePermission('assignments.update'), cancelTask); // Cancel task

// User statistics for admin
adminRouter.get('/user/:userId', authenticate, requireWeb, requirePermission('assignments.view'), getUserTasks); // Get user tasks
// TODO: Implement user statistics
// adminRouter.get('/users/:userId/statistics', authenticate, requireWeb, requirePermission('assignments.view'), userStatistics); // User statistics

// Combine both routers for mounting at different base paths
export { employeeRouter, adminRouter };