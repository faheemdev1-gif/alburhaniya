// server/src/controllers/userController.ts
import { Request, Response } from 'express';
import jwt  from 'jsonwebtoken';
import User from '../models/User';
import { AuthRequest } from '../middleware/auth';

// ── Helper: sign JWT ─────────────────────────────────────────────
function signToken(id: string, role: string): string {
  return jwt.sign(
    { id, role },
    process.env.JWT_SECRET as string,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as jwt.SignOptions
  );
}

// ── POST /api/auth/login ─────────────────────────────────────────
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body as { email: string; password: string };

    if (!email || !password) {
      res.status(400).json({ message: 'Email and password are required' });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await user.comparePassword(password))) {
      res.status(401).json({ message: 'Invalid email or password' });
      return;
    }

    const token = signToken(user._id.toString(), user.role);

    res.json({
      token,
      user: {
        id:    user._id,
        name:  user.name,
        email: user.email,
        role:  user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}

// ── GET /api/auth/me ─────────────────────────────────────────────
export async function getMe(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}

// ── GET /api/users  (admin only) ─────────────────────────────────
export async function getUsers(_req: Request, res: Response): Promise<void> {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}

// ── POST /api/users  (admin only — create editor/admin account) ──
export async function createUser(req: Request, res: Response): Promise<void> {
  try {
    const { name, email, password, role = 'editor' } = req.body as {
      name: string; email: string; password: string; role?: string;
    };

    if (!name || !email || !password) {
      res.status(400).json({ message: 'Name, email, and password are required' });
      return;
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      res.status(409).json({ message: 'A user with that email already exists' });
      return;
    }

    const user = await User.create({ name, email, password, role });
    res.status(201).json({
      id:    user._id,
      name:  user.name,
      email: user.email,
      role:  user.role,
    });
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
}

// ── PUT /api/users/:id  (admin only) ─────────────────────────────
export async function updateUser(req: Request, res: Response): Promise<void> {
  try {
    const { name, email, role } = req.body as {
      name?: string; email?: string; role?: string;
    };

    // Never allow password update via this endpoint — use changePassword
    const update: Record<string, unknown> = {};
    if (name)  update.name  = name;
    if (email) update.email = email.toLowerCase();
    if (role)  update.role  = role;

    const user = await User.findByIdAndUpdate(req.params.id, update, {
      new: true, runValidators: true,
    }).select('-password');

    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
    res.json(user);
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
}

// ── PUT /api/users/:id/password  (admin or self) ─────────────────
export async function changePassword(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string; newPassword: string;
    };

    if (!currentPassword || !newPassword) {
      res.status(400).json({ message: 'currentPassword and newPassword are required' });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ message: 'New password must be at least 8 characters' });
      return;
    }

    const user = await User.findById(req.params.id);
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }

    // Only the user themselves or an admin can change the password
    const isSelf  = req.userId === user._id.toString();
    const isAdmin = req.userRole === 'admin';
    if (!isSelf && !isAdmin) {
      res.status(403).json({ message: 'Not authorised to change this password' });
      return;
    }

    const valid = await user.comparePassword(currentPassword);
    if (!valid) {
      res.status(401).json({ message: 'Current password is incorrect' });
      return;
    }

    user.password = newPassword; // pre-save hook will hash it
    await user.save();
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}

// ── DELETE /api/users/:id  (admin only) ──────────────────────────
export async function deleteUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    // Prevent admin from deleting their own account
    if (req.userId === req.params.id) {
      res.status(400).json({ message: 'You cannot delete your own account' });
      return;
    }

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}