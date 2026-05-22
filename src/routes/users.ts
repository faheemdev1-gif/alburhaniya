// server/src/routes/users.ts
import { Router, Response } from 'express';
import User from '../models/User';
import { protect, adminOnly, AuthRequest } from '../middleware/auth';

const router = Router();

// All user routes require admin
router.use(protect, adminOnly);

// GET /api/users
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

// POST /api/users
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ message: 'Name, email and password are required' });
      return;
    }
    const existing = await User.findOne({ email });
    if (existing) {
      res.status(409).json({ message: 'Email already in use' });
      return;
    }
    const user = await User.create({ name, email, password, role: role || 'editor' });
    const { password: _, ...safe } = user.toObject();
    res.status(201).json(safe);
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
});

// PUT /api/users/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, password, role } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }

    if (name)  user.name  = name;
    if (email) user.email = email;
    if (role)  user.role  = role;
    if (password) user.password = password; // pre-save hook will hash it

    await user.save();
    const { password: _, ...safe } = user.toObject();
    res.json(safe);
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
});

// DELETE /api/users/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

export default router;