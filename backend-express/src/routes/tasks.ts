import { Router } from 'express';
import {
  getAllTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  getTaskStatistics,
  markAsCompleted,
} from '../controllers/taskController';
import { previewBulkUpload, importBulkUpload, downloadTemplate } from '../controllers/bulkTaskController';
import { authenticate } from '../middleware/auth';
import { requirePermission, requireAnyPermission, requireWeb } from '../middleware/permissions';
import multer from 'multer';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// Configure multer for file upload (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
        file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new AppError('Hanya file Excel (.xlsx, .xls) yang diizinkan.', 400) as any, false);
    }
  },
});

// =============================================================================
// ADMIN ROUTES ONLY (mounted at /admin/tasks)
// =============================================================================

// Task Management - permission based (RBAC v2)
router.get('/', authenticate, requireWeb, requireAnyPermission('tasks.view', 'dashboard.view', 'assignments.create'), getAllTasks); // Get all tasks (index)
router.post('/', authenticate, requireWeb, requirePermission('tasks.create'), createTask); // Create task (store)
router.get('/statistics', authenticate, requireWeb, requireAnyPermission('tasks.view', 'dashboard.view'), getTaskStatistics); // Statistics
router.get('/template', authenticate, requireWeb, requirePermission('tasks.export'), downloadTemplate); // Download template
router.post('/bulk-preview', authenticate, requireWeb, requirePermission('tasks.import'), upload.single('file'), previewBulkUpload); // Preview bulk upload
router.post('/bulk-import', authenticate, requireWeb, requirePermission('tasks.import'), upload.single('file'), importBulkUpload); // Import bulk upload
// TODO: Implement by-location endpoint
// router.get('/by-location', authenticate, requireWeb, requirePermission('tasks.view'), byLocation); // By location

// Task operations
// TODO: Implement reset-auto endpoint
// router.post('/:taskId/reset-auto', authenticate, requireWeb, requirePermission('tasks.update'), resetToAuto); // Reset to auto
router.post('/:taskId/mark-completed', authenticate, requireWeb, requirePermission('tasks.update'), markAsCompleted); // Mark completed
// TODO: Implement assign endpoint
// router.post('/:taskId/assign', authenticate, requireWeb, requirePermission('assignments.create'), assignToUsers); // Assign to users

// CRUD operations
router.get('/:taskId', authenticate, requireWeb, requirePermission('tasks.view'), getTaskById); // Show task
router.put('/:taskId', authenticate, requireWeb, updateTask); // Update task (tasks.update / tasks.toggle_status checked in controller)
router.delete('/:taskId', authenticate, requireWeb, requirePermission('tasks.delete'), deleteTask); // Delete task (destroy)

export default router;
