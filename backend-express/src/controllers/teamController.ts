/**
 * Tujuan          : CRUD tim (Team) + manajemen anggota & leader.
 *                  Tim adalah grouping terstruktur karyawan (terpisah dari User.department).
 *                  leaderId BUKAN anggota otomatis — pemanggil wajib menyertakan leader di memberIds
 *                  jika ingin leader juga menjadi anggota.
 * Caller          : src/routes/teams.ts (mount /api/admin/teams).
 * Dependensi      : prisma (config/database), AppError (middleware/errorHandler),
 *                  uuidv4 (uuid), getJakartaTime (utils/timezone).
 * Main Functions  : getAllTeams, getTeamById, createTeam, updateTeam, deleteTeam,
 *                  getTeamMembers, addTeamMembers, removeTeamMember.
 * Side Effects    : DB write users.teamId (one-team-per-user: memindahkan user dari tim lama),
 *                  DB write/read teams & users.
 * Sinkronisasi    : lihat SYSTEM_MAP.md §6 (data model) & §5.1 (route map).
 */

import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { getJakartaTime } from '../utils/timezone';

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  position: true,
  department: true,
  status: true,
} as const;

/**
 * Get all teams with leader info and member count
 */
export const getAllTeams = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const teams = await prisma.team.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        leader: { select: { id: true, name: true, email: true } },
        users: { select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } },
        _count: { select: { users: true, takenTasks: true } },
      },
    });

    const formatted = teams.map((team) => ({
      id: team.id,
      name: team.name,
      description: team.description,
      status: team.status,
      leader: team.leader,
      members: team.users,
      memberCount: team._count.users,
      taskCount: team._count.takenTasks,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
    }));

    res.json({ teams: formatted });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a single team with full member list
 */
export const getTeamById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { teamId } = req.params;

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        leader: { select: USER_SELECT },
        users: { select: USER_SELECT, orderBy: { name: 'asc' } },
        _count: { select: { takenTasks: true } },
      },
    });

    if (!team) {
      throw new AppError('Team not found', 404);
    }

    res.json({
      team: {
        id: team.id,
        name: team.name,
        description: team.description,
        leader: team.leader,
        members: team.users,
        taskCount: team._count.takenTasks,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a team. Optional leaderId and initial memberIds.
 * memberIds move onto this team (one-team-per-user: off prior team).
 * leader is NOT auto-added as a member.
 */
export const createTeam = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { name, description, leaderId, memberIds, status } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Team name is required', 400);
    }

    const validStatus = status === 'inactive' ? 'inactive' : 'active';

    if (leaderId) {
      const leader = await prisma.user.findUnique({ where: { id: leaderId } });
      if (!leader) {
        throw new AppError('Leader user not found', 404);
      }
    }

    const team = await prisma.team.create({
      data: {
        id: uuidv4(),
        name: name.trim(),
        description: description || null,
        leaderId: leaderId || null,
        status: validStatus,
        createdAt: getJakartaTime(),
      },
    });

    // Assign members (move off any prior team)
    if (Array.isArray(memberIds) && memberIds.length > 0) {
      const validMembers = await prisma.user.findMany({
        where: { id: { in: memberIds } },
        select: { id: true },
      });
      const validIds = validMembers.map((u) => u.id);
      if (validIds.length > 0) {
        await prisma.user.updateMany({
          where: { id: { in: validIds } },
          data: { teamId: team.id },
        });
        console.log(`[createTeam] Moved ${validIds.length} user(s) to team ${team.id}: ${validIds.join(', ')}`);
      }
    }

    const created = await prisma.team.findUnique({
      where: { id: team.id },
      include: {
        leader: { select: USER_SELECT },
        users: { select: USER_SELECT },
        _count: { select: { takenTasks: true } },
      },
    });

    res.status(201).json({
      message: 'Team created successfully',
      team: {
        id: created!.id,
        name: created!.name,
        description: created!.description,
        leader: created!.leader,
        members: created!.users,
        taskCount: created!._count.takenTasks,
        createdAt: created!.createdAt,
        updatedAt: created!.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update team metadata (name, description, leaderId, status) AND reconcile members.
 * memberIds, bila disertakan, digunakan untuk menyelaraskan keanggotaan:
 * - user di dalamnya dipindah ke tim ini (one-team-per-user: lepas dari tim lama),
 * - user yang sedang di tim ini tapi tidak ada di memberIds akan dilepas (teamId = null).
 * leaderId BUKAN anggota otomatis — wajib disertakan di memberIds bila ingin jadi anggota.
 */
export const updateTeam = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { teamId } = req.params;
    const { name, description, leaderId, status, memberIds } = req.body;

    const existing = await prisma.team.findUnique({
      where: { id: teamId },
      include: { users: { select: { id: true } } },
    });
    if (!existing) {
      throw new AppError('Team not found', 404);
    }

    if (leaderId !== undefined) {
      if (leaderId === null) {
        // allow unsetting leader
      } else {
        const leader = await prisma.user.findUnique({ where: { id: leaderId } });
        if (!leader) {
          throw new AppError('Leader user not found', 404);
        }
      }
    }

    const updateData: any = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw new AppError('Team name cannot be empty', 400);
      }
      updateData.name = name.trim();
    }
    if (description !== undefined) updateData.description = description || null;
    if (leaderId !== undefined) updateData.leaderId = leaderId || null;
    if (status !== undefined) updateData.status = status === 'inactive' ? 'inactive' : 'active';

    const hasMemberChange = Array.isArray(memberIds);
    const requestedIds: string[] = hasMemberChange
      ? memberIds.map((id: any) => String(id))
      : [];
    const currentMemberIds: string[] = existing.users.map((u) => u.id);

    await prisma.$transaction(async (tx) => {
      const teamUpdate = await tx.team.update({
        where: { id: teamId },
        data: updateData,
      });

      if (hasMemberChange) {
        const requestedSet = new Set(requestedIds);
        const toAdd = requestedIds.filter((id) => !currentMemberIds.includes(id));
        const toRemove = currentMemberIds.filter((id) => !requestedSet.has(id));

        const validAdded = toAdd.length
          ? (await tx.user.findMany({ where: { id: { in: toAdd } }, select: { id: true } })).map((u) => u.id)
          : [];
        if (validAdded.length) {
          await tx.user.updateMany({
            where: { id: { in: validAdded } },
            data: { teamId: teamId },
          });
          console.log(`[updateTeam] Moved ${validAdded.length} user(s) to team ${teamId}: ${validAdded.join(', ')}`);
        }

        if (toRemove.length) {
          await tx.user.updateMany({
            where: { id: { in: toRemove }, teamId: teamId },
            data: { teamId: null },
          });
          console.log(`[updateTeam] Removed ${toRemove.length} user(s) from team ${teamId}: ${toRemove.join(', ')}`);
        }
      }

      return teamUpdate;
    });

    const updated = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        leader: { select: USER_SELECT },
        users: { select: USER_SELECT, orderBy: { name: 'asc' } },
        _count: { select: { takenTasks: true } },
      },
    });

    res.json({
      message: 'Team updated successfully',
      team: {
        id: updated!.id,
        name: updated!.name,
        description: updated!.description,
        leader: updated!.leader,
        members: updated!.users,
        taskCount: updated!._count.takenTasks,
        createdAt: updated!.createdAt,
        updatedAt: updated!.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a team. Members' teamId reset to null (FK onDelete SetNull also handles this).
 */
export const deleteTeam = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { teamId } = req.params;

    const existing = await prisma.team.findUnique({ where: { id: teamId } });
    if (!existing) {
      throw new AppError('Team not found', 404);
    }

    // Reset members before deleting (traceability)
    const members = await prisma.user.findMany({
      where: { teamId },
      select: { id: true },
    });
    if (members.length > 0) {
      await prisma.user.updateMany({
        where: { teamId },
        data: { teamId: null },
      });
      console.log(`[deleteTeam] Removed ${members.length} user(s) from team ${teamId}`);
    }

    await prisma.team.delete({ where: { id: teamId } });

    res.json({ message: 'Team deleted successfully' });
  } catch (error) {
    next(error);
  }
};

/**
 * List members of a team
 */
export const getTeamMembers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { teamId } = req.params;

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        users: { select: USER_SELECT, orderBy: { name: 'asc' } },
        leader: { select: USER_SELECT },
      },
    });

    if (!team) {
      throw new AppError('Team not found', 404);
    }

    res.json({ members: team.users, leader: team.leader });
  } catch (error) {
    next(error);
  }
};

/**
 * Add members to a team (move onto this team, off prior team)
 */
export const addTeamMembers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { teamId } = req.params;
    const { userIds } = req.body;

    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new AppError('Team not found', 404);
    }

    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new AppError('At least one user must be provided', 400);
    }

    const validMembers = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true },
    });
    const validIds = validMembers.map((u) => u.id);
    if (validIds.length === 0) {
      throw new AppError('No valid users provided', 400);
    }

    // one-team-per-user: silently moves users off prior teams
    await prisma.user.updateMany({
      where: { id: { in: validIds } },
      data: { teamId },
    });
    console.log(`[addTeamMembers] Added ${validIds.length} user(s) to team ${teamId}: ${validIds.join(', ')}`);

    const updated = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        users: { select: USER_SELECT, orderBy: { name: 'asc' } },
        _count: { select: { users: true, takenTasks: true } },
      },
    });

    res.json({
      message: 'Members added successfully',
      members: updated!.users,
      memberCount: updated!._count.users,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Remove a single member from a team (does NOT touch leaderId)
 */
export const removeTeamMember = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { teamId, userId } = req.params;

    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new AppError('Team not found', 404);
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (user.teamId !== teamId) {
      throw new AppError('User is not a member of this team', 400);
    }

    await prisma.user.update({
      where: { id: userId },
      data: { teamId: null },
    });
    console.log(`[removeTeamMember] Removed user ${userId} from team ${teamId}`);

    res.json({ message: 'Member removed successfully' });
  } catch (error) {
    next(error);
  }
};
