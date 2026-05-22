// server/src/routes/auth.ts
import { Router } from 'express';
import {
  login,
  getMe,
  getUsers,
  createUser,
  updateUser,
  changePassword,
  deleteUser,
} from '../controllers/userController';
import { protect, adminOnly } from '../middleware/auth';

const router = Router();

// Public
router.post('/login', login);

// Authenticated
router.get('/me', protect, getMe);

// Admin only — user management
router.get('/',              protect, adminOnly, getUsers);
router.post('/',             protect, adminOnly, createUser);
router.put('/:id',           protect, adminOnly, updateUser);
router.put('/:id/password',  protect,            changePassword);
router.delete('/:id',        protect, adminOnly, deleteUser);

export default router;