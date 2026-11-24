import { Router, Request, Response, NextFunction } from 'express';
import {
  saveLocation,
  getLocationsByTakenTask,
  getAllLocations,
  getLatestLocations,
  bulkSaveLocations,
  getCurrentLocationsByTakenTask,
  getTaskRoute,
} from '../controllers/locationController';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, requireAnyPermission, requireWeb } from '../middleware/permissions';
import { requireAssignmentAccess } from '../rbac/assignmentAccess';

const router = Router();

// Check if this is an admin route or employee route
// This router will be mounted at both /locations and /admin/locations
const isAdminRoute = (req: Request) => {
  return req.baseUrl.includes('/admin');
};

// On the /admin/locations mount the shared task routes need web access + monitoring permission.
// On the /locations mount the caller must be assigned to the task (or be staff with the permission,
// since the web Monitoring page also reads these through /locations).
const guardTaskLocations = (...keys: string[]) => {
  const checkPermission = requireAnyPermission(...keys);
  const checkAssignment = requireAssignmentAccess(...keys);
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!isAdminRoute(req)) return checkAssignment(req, res, next);
    requireWeb(req, res, (err?: any) => (err ? next(err) : checkPermission(req, res, next)));
  };
};

// =============================================================================
// EMPLOYEE ROUTES (mounted at /locations)
// =============================================================================

// Employee routes - record locations
router.post('/', authenticate, saveLocation); // Record single location
router.post('/bulk', authenticate, bulkSaveLocations); // Record multiple locations (batch)

// Employee routes - view own locations
// TODO: Implement personal location history
// router.get('/my', authenticate, myLocations); // Get own location history
// router.get('/my/statistics', authenticate, userStatistics); // Get own statistics

// =============================================================================
// SHARED TASK ROUTES (/locations for employees, /admin/locations for monitoring)
// =============================================================================
router.get('/tasks/:takenTaskId', authenticate, guardTaskLocations('monitoring.view_locations'), getLocationsByTakenTask); // Get locations (admin: supports userId query param)
router.get('/tasks/:takenTaskId/route', authenticate, guardTaskLocations('monitoring.view_locations'), getTaskRoute); // Get route + stats

// =============================================================================
// ADMIN ROUTES (mounted at /admin/locations)
// =============================================================================
router.get('/tasks/:takenTaskId/current', authenticate, requireWeb, requirePermission('monitoring.view_locations'), getCurrentLocationsByTakenTask); // Get latest location per user

// Admin monitoring endpoints (also feed Dashboard & Employee Analytics)
router.get('/all', authenticate, requireWeb, requireAnyPermission('monitoring.view_locations', 'dashboard.view', 'analytics.view'), getAllLocations);
router.get('/latest', authenticate, requireWeb, requireAnyPermission('monitoring.view_locations', 'dashboard.view', 'analytics.view'), getLatestLocations);

export default router;
