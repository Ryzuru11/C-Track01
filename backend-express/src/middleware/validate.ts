import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from './auth';
import { AppError } from './errorHandler';

export const validate = (schema: z.ZodSchema) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        const messages = error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
        }));
        return next(new AppError(JSON.stringify(messages), 400));
      }
      next(error);
    }
  };
};
