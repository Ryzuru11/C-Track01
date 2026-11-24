import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { AppError } from './errorHandler';
import { can } from '../rbac/access';

/** Wajib memiliki SEMUA permission yang disebutkan */
export const requirePermission = (...keys: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }
    if (!keys.every((key) => can(req.user, key))) {
      return next(new AppError('Insufficient permissions', 403));
    }
    next();
  };
};

/** Cukup memiliki SALAH SATU permission yang disebutkan */
export const requireAnyPermission = (...keys: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }
    if (!keys.some((key) => can(req.user, key))) {
      return next(new AppError('Insufficient permissions', 403));
    }
    next();
  };
};

/** Hanya role dengan platform web (bukan employee/mobile) */
export const requireWeb = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401));
  }
  if (req.user.platform !== 'web') {
    return next(new AppError('Web access is not available for this role', 403));
  }
  next();
};
