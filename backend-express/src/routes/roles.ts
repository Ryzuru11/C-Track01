/**
 * Tujuan          : Endpoint Role dashboard (RBAC v2) di bawah /api/admin/roles dan /api/admin/permissions.
 * Caller          : routes/index.ts.
 * Akses           : roles.manage (khusus Superadmin), kecuali GET /assignable (users.create / users.update).
 */
import { Router } from 'express';
import {
  createRole,
  deleteRole,
  getAssignableRoles,
  getPermissionCatalogHandler,
  getRole,
  getRoleAudit,
  getRoles,
  reassignRoleMembers,
  updateRole,
  updateRolePermissions,
} from '../controllers/roleController';
import { authenticate } from '../middleware/auth';
import { requireAnyPermission, requirePermission, requireWeb } from '../middleware/permissions';

export const roleRoutes = Router();

const manage = [authenticate, requireWeb, requirePermission('roles.manage')];

// Static paths before /:id
roleRoutes.get('/assignable', authenticate, requireWeb, requireAnyPermission('users.create', 'users.update'), getAssignableRoles);
roleRoutes.get('/audit', ...manage, getRoleAudit);

roleRoutes.get('/', ...manage, getRoles);
roleRoutes.post('/', ...manage, createRole);
roleRoutes.get('/:id', ...manage, getRole);
roleRoutes.put('/:id', ...manage, updateRole);
roleRoutes.put('/:id/permissions', ...manage, updateRolePermissions);
roleRoutes.post('/:id/reassign', ...manage, reassignRoleMembers);
roleRoutes.delete('/:id', ...manage, deleteRole);

export const permissionRoutes = Router();

permissionRoutes.get('/', ...manage, getPermissionCatalogHandler);
