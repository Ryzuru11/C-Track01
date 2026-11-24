import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, 10);
};

export const comparePassword = async (
  password: string,
  hashedPassword: string
): Promise<boolean> => {
  return bcrypt.compare(password, hashedPassword);
};

export const generateToken = (payload: object): string => {
  const secret: jwt.Secret = process.env.JWT_SECRET || 'fallback-secret-key';
  const expiresIn = (process.env.JWT_EXPIRES_IN || '7d') as any;
  const options: jwt.SignOptions = {
    expiresIn,
  };
  return jwt.sign(payload, secret, options);
};
