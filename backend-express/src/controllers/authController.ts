import { Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { hashPassword, comparePassword, generateToken } from '../utils/auth';
import { getJakartaTime } from '../utils/timezone';
import { resolveRoleAccess, roleWithPermissionsInclude, toRoleResponseFields } from '../rbac/access';

/**
 * Login user
 */
export const login = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { email, password } = req.body;

    // Find user with role + permissions
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        modelHasRoles: { include: roleWithPermissionsInclude },
      },
    });

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const timestamp = getJakartaTime().toISOString();

    if (!user) {
      console.warn(`[AUTH] ❌ Login failed — email not found | email: ${email} | ip: ${ip} | time: ${timestamp}`);
      throw new AppError('Invalid credentials', 401);
    }

    if (user.status !== 'active') {
      console.warn(`[AUTH] ⛔ Login blocked — account inactive | email: ${email} | ip: ${ip} | time: ${timestamp}`);
      throw new AppError('Account is inactive', 403);
    }

    // Verify password
    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
      console.warn(`[AUTH] ❌ Login failed — wrong password | email: ${email} | ip: ${ip} | time: ${timestamp}`);
      throw new AppError('Invalid credentials', 401);
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: getJakartaTime() },
    });

    // Get role + permissions
    const access = resolveRoleAccess(user.modelHasRoles[0]?.role);
    const role = access.role;

    // Platform rule: mobile app is for mobile roles (employee), web for web roles.
    // A missing header is treated as web (the mobile app always sends X-Client-Type: mobile).
    const clientType = req.headers['x-client-type'] === 'mobile' ? 'mobile' : 'web';
    if (clientType === 'mobile' && access.platform !== 'mobile') {
      console.warn(`[AUTH] ⛔ Mobile login blocked — role not employee | user: ${user.name} (${user.email}) | role: ${role} | ip: ${ip} | time: ${timestamp}`);
      throw new AppError('Mobile app access is restricted to employees only', 403);
    }
    if (clientType === 'web' && access.platform !== 'web') {
      console.warn(`[AUTH] ⛔ Web login blocked — mobile-only role | user: ${user.name} (${user.email}) | role: ${role} | ip: ${ip} | time: ${timestamp}`);
      throw new AppError('Web access is not available for this role', 403);
    }

    console.log(`[AUTH] ✅ Login successful | user: ${user.name} (${user.email}) | role: ${role} | client: ${clientType} | ip: ${ip} | time: ${timestamp}`);

    // Generate token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role,
    });

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        department: user.department,
        position: user.position,
        address: user.address,
        avatar: user.avatar,
        status: user.status,
        ...toRoleResponseFields(access),
        permissions: access.permissions,
      },
      token,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current authenticated user
 */
export const me = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: {
        modelHasRoles: { include: roleWithPermissionsInclude },
      },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const access = resolveRoleAccess(user.modelHasRoles[0]?.role);

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        department: user.department,
        position: user.position,
        address: user.address,
        avatar: user.avatar,
        status: user.status,
        ...toRoleResponseFields(access),
        permissions: access.permissions,
        lastLoginAt: user.lastLoginAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Change password for the authenticated user
 */
export const changePassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new AppError('currentPassword and newPassword are required', 400);
    }

    if (newPassword.length < 6) {
      throw new AppError('Password baru minimal 6 karakter', 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const isCurrentPasswordValid = await comparePassword(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      throw new AppError('Password saat ini salah', 401);
    }

    const hashedNewPassword = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: req.user.userId },
      data: { password: hashedNewPassword },
    });

    res.json({ message: 'Password berhasil diperbarui' });
  } catch (error) {
    next(error);
  }
};

/**
 * Logout (client-side token removal)
 */
export const logout = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    res.json({ message: 'Logout successful' });
  } catch (error) {
    next(error);
  }
};

/**
 * Register push notification token for mobile devices
 */
export const registerPushToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { pushToken } = req.body;

    if (!pushToken) {
      throw new AppError('Push token is required', 400);
    }

    // Update user with push token
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { pushToken },
    });

    console.log(`✅ Push token registered for user ${req.user.userId}`);

    res.json({ message: 'Push token registered successfully' });
  } catch (error) {
    next(error);
  }
};
