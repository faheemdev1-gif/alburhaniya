// server/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

interface JwtPayload {
  id: string;
  role: string;
  authVersion?: number;
}

export async function protect(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Not authorised — no token' });
    return;
  }

  const token = header.split(' ')[1];
  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET as string, { algorithms: ['HS256'] }) as JwtPayload;
    if (!decoded || typeof decoded.id !== 'string' || !/^[a-f0-9]{24}$/i.test(decoded.id) ||
        (decoded.authVersion !== undefined && (!Number.isSafeInteger(decoded.authVersion) || decoded.authVersion < 0))) throw Error('Invalid claims');
  } catch {
    res.status(401).json({ message: 'Not authorised — invalid token' });
    return;
  }
  try {
    const user = await User.findById(decoded.id).select('role +authVersion').lean();
    // Existing accounts/tokens use version zero until the first password change.
    if (!user || (user.authVersion || 0) !== (decoded.authVersion || 0)) {
      res.status(401).json({ message: 'Your session has expired. Please sign in again.' }); return;
    }
    req.userId = decoded.id;
    req.userRole = user.role;
    next();
  } catch {
    res.status(503).json({ message: 'Sign-in could not be verified. Please try again.' });
  }
}

export function adminOnly(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.userRole !== 'admin') {
    res.status(403).json({ message: 'Admin access required' });
    return;
  }
  next();
}
