/**
 * Tujuan          : Definisi endpoint tim (Team) di bawah /api/admin/teams.
 * Caller          : routes/index.ts (mount '/admin/teams').
 * Dependensi      : teamController, authenticate (middleware/auth), requireWeb/requirePermission (middleware/permissions).
 * Main Functions  : GET /, POST /, GET /:teamId, PUT /:teamId, DELETE /:teamId,
 *                  GET /:teamId/members, POST /:teamId/members, DELETE /:teamId/members/:userId.
 * Side Effects    : HTTP routing; delegasi ke controller (DB write/read).
 */

import { Router } from 'express';
import {
  getAllTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  getTeamMembers,
  addTeamMembers,
  removeTeamMember,
} from '../controllers/teamController';
import { authenticate } from '../middleware/auth';
import { requirePermission, requireWeb } from '../middleware/permissions';

const router = Router();

// Permission based (RBAC v2)
router.get('/', authenticate, requireWeb, requirePermission('teams.view'), getAllTeams); // List teams
router.post('/', authenticate, requireWeb, requirePermission('teams.create'), createTeam); // Create team
router.get('/:teamId', authenticate, requireWeb, requirePermission('teams.view'), getTeamById); // Team detail
router.put('/:teamId', authenticate, requireWeb, requirePermission('teams.update'), updateTeam); // Update team
router.delete('/:teamId', authenticate, requireWeb, requirePermission('teams.delete'), deleteTeam); // Delete team
router.get('/:teamId/members', authenticate, requireWeb, requirePermission('teams.view'), getTeamMembers); // List members
router.post('/:teamId/members', authenticate, requireWeb, requirePermission('teams.update'), addTeamMembers); // Add members
router.delete('/:teamId/members/:userId', authenticate, requireWeb, requirePermission('teams.update'), removeTeamMember); // Remove member

export default router;
