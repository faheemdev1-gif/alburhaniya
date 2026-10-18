import { Router } from 'express';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import User from '../models/User';
import { validEmail } from '../services/contactNotification';
import { sendSiteEmail } from '../services/siteEmail';
import { passwordError, passwordResetConfigured, requestPasswordReset, RESET_RECEIPT, resetTokenHash } from '../services/passwordReset';

const router = Router();
const buckets = new Map<string, { count: number; expires: number }>();
function allow(key: string, limit: number): boolean {
  const now = Date.now();
  for (const [k, value] of buckets) if (value.expires <= now) buckets.delete(k);
  const existing = buckets.get(key);
  if (!existing && buckets.size >= 10000) return false;
  const value = existing || { count: 0, expires: now + 15 * 60_000 };
  buckets.set(key, value);
  return ++value.count <= limit;
}

router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
router.post('/forgot-password', (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!validEmail(email)) { res.status(400).json({ message: 'Enter a valid account email address.' }); return; }
  // Use the socket address, never untrusted X-Forwarded-For values.
  const emailKey = createHash('sha256').update(email).digest('hex');
  if (!allow(`forgot-ip:${req.ip}`, 30) || !allow(`forgot-email:${emailKey}`, 3)) {
    res.setHeader('Retry-After', '900'); res.status(429).json({ message: 'Too many reset requests. Please wait 15 minutes and try again.' }); return;
  }
  if (!passwordResetConfigured()) { res.status(503).json({ message: 'Password reset email is temporarily unavailable. Please contact the site administrator.' }); return; }
  res.status(202).json({ message: RESET_RECEIPT });
  // Account lookup and SMTP happen after the identical public response so neither
  // the response body nor delivery time reveals whether an account exists.
  setImmediate(() => { void requestPasswordReset(email).catch(() => console.error('[Password reset] Request could not be completed. Check database and SMTP delivery.')); });
});

router.post('/reset-password', async (req, res) => {
  if (!allow(`reset-ip:${req.ip}`, 15)) {
    res.setHeader('Retry-After', '900'); res.status(429).json({ message: 'Too many attempts. Please wait 15 minutes and try again.' }); return;
  }
  const { token, newPassword, confirmPassword } = req.body || {};
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) { res.status(400).json({ message: 'This reset link is invalid or has expired. Request a new one.' }); return; }
  const invalidPassword = passwordError(newPassword);
  if (invalidPassword || newPassword !== confirmPassword) {
    res.status(400).json({ message: invalidPassword || 'The passwords do not match.' }); return;
  }
  const filter = { passwordResetTokenHash: resetTokenHash(token), passwordResetExpiresAt: { $gt: new Date() } };
  try {
    if (!(await User.exists(filter))) { res.status(400).json({ message: 'This reset link is invalid or has expired. Request a new one.' }); return; }
    const password = await bcrypt.hash(newPassword, 12);
    // Atomic consumption prevents concurrent requests from reusing the same token.
    // Password is hashed explicitly because query updates do not run save hooks.
    const user = await User.findOneAndUpdate({ ...filter, passwordResetExpiresAt: { $gt: new Date() } }, {
      $set: { password }, $inc: { authVersion: 1 },
      $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1, passwordResetRequestedAt: 1 },
    }, { new: true });
    if (!user) { res.status(400).json({ message: 'This reset link is invalid or has expired. Request a new one.' }); return; }
    res.json({ message: 'Your password has been reset. Please sign in with your new password.' });
    setImmediate(() => { void sendSiteEmail(user.email, 'Your Al-Burhaniya admin password was changed',
      'Your Al-Burhaniya admin password has been reset and existing sessions have been signed out. If you did not make this change, contact the site administrator immediately.').catch(() => console.error('[Password reset] Password changed, but confirmation email could not be delivered.')); });
  } catch {
    res.status(503).json({ message: 'Your password could not be reset. Please try again.' });
  }
});

export default router;
