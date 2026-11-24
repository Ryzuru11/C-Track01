import { Router } from 'express';
import {
  createReport,
  getAllReports,
  getReportById,
  updateReport,
  deleteReport,
  getMyReports,
  getMyStatistics,
  getMyTasksWithReports,
  getReportsForTakenTask,
  finishReport, // 🔥 TAMBAH INI
} from '../controllers/reportController';

import { authenticate } from '../middleware/auth';
import { requirePermission, requireAnyPermission, requireWeb } from '../middleware/permissions';

// =============================================================================
// EMPLOYEE ROUTER (mounted at /api/reports)
// =============================================================================
export const employeeReportRoutes = Router();

// Employee routes
employeeReportRoutes.post('/', authenticate, createReport);
employeeReportRoutes.get('/my', authenticate, getMyReports);
employeeReportRoutes.get('/my-tasks', authenticate, getMyTasksWithReports);
employeeReportRoutes.get('/tasks/:takenTaskId', authenticate, getReportsForTakenTask);
employeeReportRoutes.get('/statistics/my', authenticate, getMyStatistics);
employeeReportRoutes.put('/:reportId', authenticate, updateReport);
employeeReportRoutes.get('/:reportId', authenticate, getReportById);

// =============================================================================
// ADMIN ROUTER (mounted at /api/admin/reports)
// =============================================================================
export const adminReportRoutes = Router();

// Admin routes
adminReportRoutes.get(
  '/',
  authenticate,
  requireWeb,
  requireAnyPermission('monitoring.view_reports', 'dashboard.view', 'analytics.view'),
  getAllReports
);

adminReportRoutes.get(
  '/tasks/:takenTaskId',
  authenticate,
  requireWeb,
  requirePermission('monitoring.view_reports'),
  getReportsForTakenTask
);

adminReportRoutes.delete(
  '/:reportId',
  authenticate,
  requireWeb,
  requirePermission('monitoring.manage_reports'),
  deleteReport
);

// 🔥🔥🔥 TAMBAHAN STEP 2 (SELESAI REPORT)
adminReportRoutes.patch(
  '/:reportId/finish',
  authenticate,
  requireWeb,
  requirePermission('monitoring.manage_reports'),
  finishReport
);

// =============================================================================
// EXPORT
// =============================================================================
export default employeeReportRoutes;