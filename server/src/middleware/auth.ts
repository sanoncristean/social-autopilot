import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { storageService, INITIAL_ADMIN_EMAIL } from '../services/StorageService.js';
import { User } from '../types/index.js';

const JWT_SECRET = process.env.SESSION_SECRET || 'autopilot_jwt_token_secret_key_2026';

export interface AuthenticatedRequest extends Request {
  user?: User;
}

export function generateToken(user: User): string {
  const payload = Buffer.from(
    JSON.stringify({
      userId: user.userId,
      email: user.email,
      role: user.role,
      issuedAt: Date.now(),
    })
  ).toString('base64url');

  const signature = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyToken(token: string): { userId: string; email: string; role: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');

    if (signature !== expectedSig) return null;

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data;
  } catch {
    return null;
  }
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string);
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (authHeader) {
    token = authHeader.trim();
  }

  if (token) {
    const decoded = verifyToken(token);
    if (decoded?.userId) {
      const user = await storageService.getUser(decoded.userId);
      if (user) {
        if (user.disabled) {
          res.status(403).json({ error: 'Your account has been disabled by an administrator.' });
          return;
        }
        req.user = user;
        next();
        return;
      }
    }
  }

  const fallbackUserId = req.headers['x-user-id'] as string;
  if (fallbackUserId) {
    const user = await storageService.getUser(fallbackUserId);
    if (user) {
      if (user.disabled) {
        res.status(403).json({ error: 'Your account has been disabled by an administrator.' });
        return;
      }
      req.user = user;
      next();
      return;
    }
  }

  res.status(401).json({ error: 'Authentication required. Please sign in.' });
}

export function requireUser(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'User authentication required.' });
    return;
  }
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const isAdmin =
    req.user.role === 'admin' ||
    req.user.email.toLowerCase() === INITIAL_ADMIN_EMAIL.toLowerCase();

  if (!isAdmin) {
    res.status(403).json({ error: 'Access denied: Platform Administrator privileges required.' });
    return;
  }

  next();
}
