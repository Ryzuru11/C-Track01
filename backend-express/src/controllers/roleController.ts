/**
 * Role & hak akses (Role dashboard) — RBAC v2.
 * Semua endpoint membutuhkan `roles.manage` (khusus Superadmin), kecuali
 * `GET /admin/roles/assignable` yang dipakai form User Management.
 */
import { Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { canAssignRole, resolveRoleAccess } from '../rbac/access';
import {
  GUARD_NAME,
  RESERVED_ROLE_NAMES,
  SYSTEM_ROLES,
  getPermissionCatalog,
  isKnownPermission,
  isLockedPermission,
  withRequiredPermissions,
} from '../rbac/permissions';
import { writeRbacAudit } from '../rbac/audit';
import { notifyRbacUpdated } from '../rbac/notify';

const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]{2,49}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_CUSTOM_LEVEL = 40;

const roleInclude = {
  roleHasPermissions: { include: { permission: { select: { name: true } } } },
  _count: { select: { modelHasRoles: true } },
} as const;

const requireActor = (req: AuthRequest) => {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }
  return req.user;
};

const parseRoleId = (raw: string): bigint => {
  if (!/^\d+$/.test(raw)) {
    throw new AppError('Role not found', 404);
  }
  return BigInt(raw);
};

const isLockedRole = (name: string) => name === SYSTEM_ROLES.SUPERADMIN || name === SYSTEM_ROLES.EMPLOYEE;

const serializeRole = (role: any) => {
  const access = resolveRoleAccess(role);
  const userCount: number = role._count?.modelHasRoles ?? 0;
  const locked = isLockedRole(role.name);
  const custom = !role.isSystem;
  return {
    id: String(role.id),
    name: role.name,
    displayName: access.roleDisplayName,
    description: role.description ?? null,
    level: access.level,
    platform: access.platform,
    isSystem: Boolean(role.isSystem),
    color: access.roleColor,
    showTaskBadge: access.showTaskBadge,
    userCount,
    permissions: access.permissions,
    editable: {
      permissions: !locked,
      details: !locked,
      showTaskBadge: !locked,
      name: custom,
      level: custom && userCount === 0,
      delete: custom && userCount === 0,
    },
  };
};

const findRoleOrThrow = async (id: bigint) => {
  const role = await prisma.role.findUnique({ where: { id }, include: roleInclude });
  if (!role || role.guardName !== GUARD_NAME) {
    throw new AppError('Role not found', 404);
  }
  return role;
};

/** Validasi daftar permission dari body: harus dikenal, tidak boleh `roles.manage`, lengkapi `.view`. */
const normalizePermissions = (input: unknown) => {
  if (!Array.isArray(input)) {
    throw new AppError('permissions must be an array', 422);
  }
  const keys = [...new Set(input.map(String))];
  const unknown = keys.filter((k) => !isKnownPermission(k));
  if (unknown.length) {
    throw new AppError(`Unknown permission: ${unknown.join(', ')}`, 422);
  }
  const locked = keys.filter((k) => isLockedPermission(k));
  if (locked.length) {
    throw new AppError(`Permission ${locked.join(', ')} hanya untuk Superadmin`, 422);
  }
  return withRequiredPermissions(keys);
};

const replaceRolePermissions = async (roleId: bigint, keys: string[]) => {
  const permissions = await prisma.permission.findMany({
    where: { name: { in: keys }, guardName: GUARD_NAME },
    select: { id: true, name: true },
  });
  const missing = keys.filter((k) => !permissions.some((p) => p.name === k));
  if (missing.length) {
    throw new AppError(`Permission belum tersinkron: ${missing.join(', ')}. Jalankan npm run rbac:sync.`, 500);
  }
  await prisma.$transaction([
    prisma.roleHasPermission.deleteMany({ where: { roleId } }),
    prisma.roleHasPermission.createMany({
      data: permissions.map((p) => ({ roleId, permissionId: p.id })),
    }),
  ]);
};

const memberIdsOf = async (roleId: bigint) =>
  (await prisma.modelHasRole.findMany({ where: { roleId }, select: { modelId: true } })).map((m) => m.modelId);

const validateDisplayName = (value: unknown) => {
  const displayName = typeof value === 'string' ? value.trim() : '';
  if (displayName.length < 2 || displayName.length > 100) {
    throw new AppError('Nama tampilan harus 2–100 karakter', 422);
  }
  return displayName;
};

const validateLevel = (value: unknown, actorLevel: number) => {
  const level = Number(value);
  if (!Number.isInteger(level) || level < 1 || level > 99) {
    throw new AppError('Level harus bilangan bulat 1–99', 422);
  }
  if (level >= actorLevel) {
    throw new AppError('Level role harus lebih rendah dari level Anda', 422);
  }
  return level;
};

const validateColor = (value: unknown) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) {
    throw new AppError('Warna harus berformat #RRGGBB', 422);
  }
  return value;
};

/**
 * GET /admin/permissions — katalog untuk matriks hak akses
 */
export const getPermissionCatalogHandler = async (_req: AuthRequest, res: Response) => {
  res.json(getPermissionCatalog());
};

/**
 * GET /admin/roles
 */
export const getRoles = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const includeMobile = req.query.includeMobile === 'true';
    const roles = await prisma.role.findMany({
      where: {
        guardName: GUARD_NAME,
        ...(!includeMobile && { platform: 'web' }),
      },
      include: roleInclude,
    });

    const data = roles.map(serializeRole).sort((a, b) => b.level - a.level || a.displayName.localeCompare(b.displayName));
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /admin/roles/assignable — role yang boleh di-assign oleh user saat ini
 */
export const getAssignableRoles = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const actor = requireActor(req);
    const roles = await prisma.role.findMany({ where: { guardName: GUARD_NAME } });

    const data = roles
      .map((role) => ({ role, access: resolveRoleAccess(role) }))
      .filter(({ access }) => canAssignRole(actor, { name: access.role, level: access.level }))
      .sort((a, b) => b.access.level - a.access.level)
      .map(({ role, access }) => ({
        id: String(role.id),
        name: role.name,
        displayName: access.roleDisplayName,
        platform: access.platform,
        color: access.roleColor,
        level: access.level,
      }));

    res.json({ data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /admin/roles/audit?roleId= — riwayat perubahan (tab "Riwayat")
 */
export const getRoleAudit = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const roleId = req.query.roleId ? String(req.query.roleId) : undefined;
    const logs = await prisma.rbacAuditLog.findMany({
      where: roleId ? { targetType: 'role', targetId: roleId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const actorIds = [...new Set(logs.map((l) => l.actorId).filter((id): id is string => Boolean(id)))];
    const actors = actorIds.length
      ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : [];
    const actorName = new Map(actors.map((a) => [a.id, a.name]));

    res.json({
      data: logs.map((log) => ({
        id: String(log.id),
        actorId: log.actorId,
        actorName: log.actorId ? actorName.get(log.actorId) ?? null : null,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        before: log.before,
        after: log.after,
        createdAt: log.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /admin/roles/:id
 */
export const getRole = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const role = await findRoleOrThrow(parseRoleId(req.params.id));
    const members = await prisma.user.findMany({
      where: { modelHasRoles: { some: { roleId: role.id } } },
      select: { id: true, name: true, email: true, status: true, lastLoginAt: true },
      orderBy: { name: 'asc' },
      take: 50,
    });
    res.json({ data: { ...serializeRole(role), users: members } });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /admin/roles
 */
export const createRole = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const actor = requireActor(req);
    const { name, description, color, showTaskBadge, permissions, copyFromRoleId } = req.body;

    const roleName = typeof name === 'string' ? name.trim() : '';
    if (!ROLE_NAME_PATTERN.test(roleName)) {
      throw new AppError('Kode role hanya boleh huruf kecil, angka, dan _ (3–50 karakter, diawali huruf)', 422);
    }
    if (RESERVED_ROLE_NAMES.includes(roleName)) {
      throw new AppError('Kode role ini dipakai oleh role sistem', 422);
    }
    const existing = await prisma.role.findUnique({
      where: { name_guardName: { name: roleName, guardName: GUARD_NAME } },
    });
    if (existing) {
      throw new AppError('Kode role sudah dipakai', 409);
    }

    const displayName = validateDisplayName(req.body.displayName);
    const level = validateLevel(req.body.level ?? DEFAULT_CUSTOM_LEVEL, actor.level);

    // Start from the copied role (minus locked keys), then let `permissions` replace it
    let requested: string[] = [];
    if (copyFromRoleId) {
      const source = await findRoleOrThrow(parseRoleId(String(copyFromRoleId)));
      requested = resolveRoleAccess(source).permissions.filter((k) => !isLockedPermission(k));
    }
    if (permissions !== undefined) {
      requested = permissions;
    }
    const normalized = normalizePermissions(requested);

    const role = await prisma.role.create({
      data: {
        name: roleName,
        guardName: GUARD_NAME,
        displayName,
        description: typeof description === 'string' && description.trim() ? description.trim() : null,
        level,
        platform: 'web',
        isSystem: false,
        color: validateColor(color),
        showTaskBadge: Boolean(showTaskBadge),
      },
    });
    await replaceRolePermissions(role.id, normalized.permissions);

    const created = serializeRole(await findRoleOrThrow(role.id));
    await writeRbacAudit({
      actorId: actor.userId,
      action: 'role.created',
      targetType: 'role',
      targetId: created.id,
      after: created,
    });

    res.status(201).json({ data: created, meta: { autoAdded: normalized.autoAdded } });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /admin/roles/:id — detail role (bukan hak akses)
 */
export const updateRole = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const actor = requireActor(req);
    const role = await findRoleOrThrow(parseRoleId(req.params.id));
    const before = serializeRole(role);
    const { editable } = before;

    const deny = () => {
      throw new AppError('This field cannot be changed for a system role', 403);
    };

    const data: Record<string, unknown> = {};
    const body = req.body || {};

    if (body.displayName !== undefined) {
      if (!editable.details) deny();
      data.displayName = validateDisplayName(body.displayName);
    }
    if (body.description !== undefined) {
      if (!editable.details) deny();
      data.description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;
    }
    if (body.color !== undefined) {
      if (!editable.details) deny();
      data.color = validateColor(body.color);
    }
    if (body.showTaskBadge !== undefined) {
      if (!editable.showTaskBadge) deny();
      data.showTaskBadge = Boolean(body.showTaskBadge);
    }
    if (body.level !== undefined && Number(body.level) !== before.level) {
      if (!role.isSystem && before.userCount > 0) {
        throw new AppError('Level tidak dapat diubah selama role masih dipakai user', 409);
      }
      if (!editable.level) deny();
      data.level = validateLevel(body.level, actor.level);
    }
    if (body.name !== undefined && body.name !== role.name) {
      if (!editable.name) deny();
      const roleName = String(body.name).trim();
      if (!ROLE_NAME_PATTERN.test(roleName) || RESERVED_ROLE_NAMES.includes(roleName)) {
        throw new AppError('Kode role tidak valid', 422);
      }
      const clash = await prisma.role.findUnique({
        where: { name_guardName: { name: roleName, guardName: GUARD_NAME } },
      });
      if (clash) {
        throw new AppError('Kode role sudah dipakai', 409);
      }
      data.name = roleName;
    }

    await prisma.role.update({ where: { id: role.id }, data });
    const after = serializeRole(await findRoleOrThrow(role.id));

    if (Object.keys(data).length > 0) {
      await writeRbacAudit({
        actorId: actor.userId,
        action: 'role.updated',
        targetType: 'role',
        targetId: after.id,
        before: Object.fromEntries(Object.keys(data).map((k) => [k, (before as any)[k]])),
        after: Object.fromEntries(Object.keys(data).map((k) => [k, (after as any)[k]])),
      });
      // Role name / display name / level are part of the logged-in user's session data
      await notifyRbacUpdated(await memberIdsOf(role.id), 'role_permissions', after.id);
    }

    res.json({ data: after });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /admin/roles/:id/permissions — ganti seluruh set hak akses
 */
export const updateRolePermissions = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const actor = requireActor(req);
    const role = await findRoleOrThrow(parseRoleId(req.params.id));
    if (isLockedRole(role.name)) {
      throw new AppError('Hak akses role ini tidak dapat diubah', 403);
    }

    const before = serializeRole(role);
    const normalized = normalizePermissions(req.body?.permissions);
    await replaceRolePermissions(role.id, normalized.permissions);
    const after = serializeRole(await findRoleOrThrow(role.id));

    const added = after.permissions.filter((k) => !before.permissions.includes(k));
    const removed = before.permissions.filter((k) => !after.permissions.includes(k));

    if (added.length || removed.length) {
      await writeRbacAudit({
        actorId: actor.userId,
        action: 'role.permissions_updated',
        targetType: 'role',
        targetId: after.id,
        before: { permissions: before.permissions },
        after: { permissions: after.permissions, added, removed },
      });
      await notifyRbacUpdated(await memberIdsOf(role.id), 'role_permissions', after.id);
    }

    res.json({ data: after, meta: { added, removed, autoAdded: normalized.autoAdded } });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /admin/roles/:id — hanya role custom tanpa user
 */
export const deleteRole = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const actor = requireActor(req);
    const role = await findRoleOrThrow(parseRoleId(req.params.id));
    if (role.isSystem) {
      throw new AppError('Role sistem tidak dapat dihapus', 403);
    }
    const userCount = role._count.modelHasRoles;
    if (userCount > 0) {
      return res.status(409).json({ message: `Role masih dipakai oleh ${userCount} user`, userCount });
    }

    const before = serializeRole(role);
    await prisma.role.delete({ where: { id: role.id } });
    await writeRbacAudit({
      actorId: actor.userId,
      action: 'role.deleted',
      targetType: 'role',
      targetId: before.id,
      before,
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * POST /admin/roles/:id/reassign — pindahkan semua anggota ke role lain
 */
export const reassignRoleMembers = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const actor = requireActor(req);
    const from = await findRoleOrThrow(parseRoleId(req.params.id));
    if (!req.body?.toRoleId) {
      throw new AppError('toRoleId is required', 422);
    }
    const to = await findRoleOrThrow(parseRoleId(String(req.body.toRoleId)));
    if (from.id === to.id) {
      throw new AppError('Role tujuan harus berbeda', 422);
    }
    const target = resolveRoleAccess(to);
    if (!canAssignRole(actor, { name: target.role, level: target.level })) {
      throw new AppError('You cannot assign this role', 403);
    }
    if (from.name === SYSTEM_ROLES.SUPERADMIN) {
      throw new AppError('Anggota role Superadmin tidak dapat dipindahkan', 403);
    }

    const memberIds = await memberIdsOf(from.id);
    if (memberIds.length > 0) {
      await prisma.$transaction([
        prisma.modelHasRole.deleteMany({ where: { roleId: from.id } }),
        prisma.modelHasRole.createMany({
          data: memberIds.map((modelId) => ({ roleId: to.id, modelType: 'App\\Models\\User', modelId })),
          skipDuplicates: true,
        }),
      ]);

      await writeRbacAudit({
        actorId: actor.userId,
        action: 'role.members_reassigned',
        targetType: 'role',
        targetId: String(from.id),
        before: { role: from.name, userIds: memberIds },
        after: { role: to.name },
      });
      await notifyRbacUpdated(memberIds, 'role_assignment', String(to.id));
    }

    res.json({ moved: memberIds.length });
  } catch (error) {
    next(error);
  }
};
