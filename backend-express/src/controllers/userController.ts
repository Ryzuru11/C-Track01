import { Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { hashPassword } from '../utils/auth';
import { v4 as uuidv4 } from 'uuid';
import {
  can,
  canAssignRole,
  canManageUser,
  getUserLevel,
  resolveRoleAccess,
  toRoleResponseFields,
} from '../rbac/access';
import { GUARD_NAME, SYSTEM_ROLES } from '../rbac/permissions';
import { writeRbacAudit } from '../rbac/audit';
import { notifyRbacUpdated } from '../rbac/notify';

const USER_PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  phoneNumber: true,
  department: true,
  position: true,
  address: true,
  avatar: true,
  status: true,
  createdAt: true,
} as const;

const requireActor = (req: AuthRequest) => {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }
  return req.user;
};

/** Pastikan actor boleh mengelola user target (level lebih rendah, bukan diri sendiri). */
const assertCanManage = async (actor: NonNullable<AuthRequest['user']>, userId: string) => {
  if (actor.userId === userId) {
    throw new AppError('You cannot change your own role or status', 403);
  }
  const target = await getUserLevel(userId);
  if (!target.exists) {
    throw new AppError('User not found', 404);
  }
  if (!canManageUser(actor, { userId, level: target.level })) {
    throw new AppError('You cannot manage this user', 403);
  }
  return target;
};

/** Cari role berdasarkan nama dan pastikan actor boleh meng-assign-nya. */
const findAssignableRole = async (actor: NonNullable<AuthRequest['user']>, roleName: string) => {
  const roleRecord = await prisma.role.findUnique({
    where: { name_guardName: { name: roleName, guardName: GUARD_NAME } },
  });
  if (!roleRecord) {
    throw new AppError('Role not found', 400);
  }
  const resolved = resolveRoleAccess(roleRecord);
  if (!canAssignRole(actor, { name: resolved.role, level: resolved.level })) {
    throw new AppError('You cannot assign this role', 403);
  }
  return roleRecord;
};

/**
 * Get all users
 */
export const getAllUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = requireActor(req);
    const { status, role } = req.query;

    const users = await prisma.user.findMany({
      where: {
        ...(status && { status: status as 'active' | 'inactive' }),
        ...(role && { modelHasRoles: { some: { role: { name: role as string } } } }),
      },
      include: {
        modelHasRoles: {
          include: {
            role: true,
          },
        },
        team: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const canUpdate = can(actor, 'users.update');
    const canDelete = can(actor, 'users.delete');
    const canToggle = can(actor, 'users.toggle_status');

    // Map users with their roles + what the current actor may do with them
    const usersWithRoles = users.map((user) => {
      const roleAccess = resolveRoleAccess(user.modelHasRoles[0]?.role);
      const manageable = canManageUser(actor, { userId: user.id, level: roleAccess.level });
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        department: user.department,
        position: user.position,
        address: user.address,
        avatar: user.avatar,
        status: user.status,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        ...toRoleResponseFields(roleAccess),
        teamId: user.teamId,
        team: user.team ? { id: user.team.id, name: user.team.name } : null,
        can: {
          update: canUpdate && manageable,
          delete: canDelete && manageable,
          toggleStatus: canToggle && manageable,
        },
      };
    });

    res.json({ users: usersWithRoles });
  } catch (error) {
    next(error);
  }
};

/**
 * Get user by ID
 */
export const getUserById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        department: true,
        position: true,
        address: true,
        avatar: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        modelHasRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const roleAccess = resolveRoleAccess(user.modelHasRoles[0]?.role);

    res.json({
      user: {
        ...user,
        ...toRoleResponseFields(roleAccess),
        modelHasRoles: undefined,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create user (users.create). Users are only registered from the dashboard.
 */
export const createUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = requireActor(req);
    const {
      name,
      email,
      password,
      phoneNumber,
      department,
      position,
      address,
      role,
    } = req.body;

    const roleName = role || SYSTEM_ROLES.EMPLOYEE;
    const roleRecord = await findAssignableRole(actor, roleName);

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new AppError('Email already registered', 409);
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        id: uuidv4(),
        name,
        email,
        password: hashedPassword,
        phoneNumber,
        department,
        position,
        address,
        status: 'active',
      },
      select: USER_PUBLIC_SELECT,
    });

    await prisma.modelHasRole.create({
      data: {
        roleId: roleRecord.id,
        modelType: 'App\\Models\\User',
        modelId: user.id,
      },
    });

    res.status(201).json({
      message: 'User created successfully',
      user: {
        ...user,
        ...toRoleResponseFields(resolveRoleAccess(roleRecord)),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update user
 * - Self: only name, phoneNumber, address, avatar (role/status/email/password are ignored;
 *   passwords go through POST /auth/change-password).
 * - Another user: users.update + role hierarchy; status needs users.toggle_status,
 *   role changes need a role the actor may assign.
 */
export const updateUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = requireActor(req);
    const { userId } = req.params;
    const {
      name,
      email,
      phoneNumber,
      department,
      position,
      address,
      avatar,
      status,
      password,
      role,
    } = req.body;

    const isSelf = actor.userId === userId;

    const updateData: any = {
      ...(name && { name }),
      ...(phoneNumber !== undefined && { phoneNumber }),
      ...(address !== undefined && { address }),
      ...(avatar !== undefined && { avatar }),
    };

    let newRoleRecord: Awaited<ReturnType<typeof findAssignableRole>> | null = null;
    let previousRole: string | null = null;

    if (!isSelf) {
      if (!can(actor, 'users.update')) {
        throw new AppError('Insufficient permissions', 403);
      }
      const target = await assertCanManage(actor, userId);
      previousRole = target.role;

      Object.assign(updateData, {
        ...(email && { email }),
        ...(department !== undefined && { department }),
        ...(position !== undefined && { position }),
      });

      const current = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (status && status !== current?.status) {
        if (!can(actor, 'users.toggle_status')) {
          throw new AppError('Insufficient permissions', 403);
        }
        if (!['active', 'inactive'].includes(status)) {
          throw new AppError("Status must be 'active' or 'inactive'", 400);
        }
        updateData.status = status;
      }

      if (password) {
        updateData.password = await hashPassword(password);
      }

      if (role && role !== target.role) {
        newRoleRecord = await findAssignableRole(actor, role);
      }
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: USER_PUBLIC_SELECT,
    });

    // Update role if changed
    if (newRoleRecord) {
      await prisma.$transaction([
        prisma.modelHasRole.deleteMany({ where: { modelId: userId } }),
        prisma.modelHasRole.create({
          data: {
            roleId: newRoleRecord.id,
            modelType: 'App\\Models\\User',
            modelId: userId,
          },
        }),
      ]);

      await writeRbacAudit({
        actorId: actor.userId,
        action: 'user.role_changed',
        targetType: 'user',
        targetId: userId,
        before: { role: previousRole },
        after: { role: newRoleRecord.name },
      });
      await notifyRbacUpdated([userId], 'role_assignment', String(newRoleRecord.id));
    }

    res.json({
      message: 'User updated successfully',
      user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete user (users.delete + hierarchy, never yourself)
 */
export const deleteUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = requireActor(req);
    const { userId } = req.params;

    await assertCanManage(actor, userId);

    await prisma.user.delete({
      where: { id: userId },
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
};

/**
 * Upload or update user avatar
 * Accepts base64 image data and stores it directly in the avatar column.
 * Self, or users.update + hierarchy for another user.
 */
export const uploadAvatar = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = requireActor(req);
    const { userId } = req.params;
    const { avatar } = req.body;

    if (actor.userId !== userId) {
      if (!can(actor, 'users.update')) {
        throw new AppError('Insufficient permissions', 403);
      }
      await assertCanManage(actor, userId);
    }

    if (!avatar) {
      throw new AppError('Avatar data is required', 400);
    }

    // Validate it's a base64 image (checking for data URI format or pure base64)
    const isValidBase64 = avatar.startsWith('data:image') ||
                          /^[A-Za-z0-9+/=]*$/.test(avatar.replace(/^data:image\/[^;]+;base64,/, ''));

    if (!isValidBase64) {
      throw new AppError('Invalid image data format', 400);
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        avatar: avatar,
      },
      select: USER_PUBLIC_SELECT,
    });

    console.log(`Avatar uploaded for user ${userId}`);

    res.json({
      message: 'Avatar uploaded successfully',
      user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update user status (active/inactive) — users.toggle_status + hierarchy, never yourself
 */
export const updateUserStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = requireActor(req);
    const { userId } = req.params;
    const { status } = req.body;

    if (!status || !['active', 'inactive'].includes(status)) {
      throw new AppError("Status must be 'active' or 'inactive '", 400);
    }

    await assertCanManage(actor, userId);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { status },
      select: USER_PUBLIC_SELECT,
    });

    res.json({
      message: `User ${status === 'active' ? 'activated' : 'deactivated'} successfully`,
      user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get user avatar only (for lazy loading)
 * Returns only avatar data to reduce response size
 */
export const getUserAvatar = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        avatar: true,
      },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Set cache headers for avatar (cache for 1 hour)
    res.set('Cache-Control', 'public, max-age=3600');

    res.json({
      userId: user.id,
      name: user.name,
      avatar: user.avatar,
    });
  } catch (error) {
    next(error);
  }
};
