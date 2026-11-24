import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler';
import { loadAccess, Platform } from '../rbac/access';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
    roleDisplayName: string;
    level: number;
    platform: Platform;
    permissions: string[];
  };
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('No token provided', 401);
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;

    // Verify user still exists and load current role + permissions (never trust the token's role)
    const access = await loadAccess(decoded.userId);

    if (!access || access.status !== 'active') {
      throw new AppError('User not found or inactive', 401);
    }

    req.user = {
      userId: access.userId,
      email: access.email,
      role: access.role,
      roleDisplayName: access.roleDisplayName,
      level: access.level,
      platform: access.platform,
      permissions: access.permissions,
    };

    next();
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError') {
      return next(new AppError('Invalid token', 401));
    }
    if (error.name === 'TokenExpiredError') {
      return next(new AppError('Token expired', 401));
    }
    next(error);
  }
};
