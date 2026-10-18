import { createHash, randomBytes } from 'crypto';
import User from '../models/User';
import { siteEmailConfigured, sendSiteEmail } from './siteEmail';
import { SITE_URL } from './siteIdentity';

export const RESET_LIFETIME_MS = 15 * 60_000;
export const RESET_RECEIPT = 'If an account exists for that email, a password reset link will be sent. Check your inbox and spam folder.';

export function passwordError(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length < 8) return 'Use a password with at least 8 characters.';
  if (Buffer.byteLength(value, 'utf8') > 72 || value.includes('\0')) return 'Use a password of no more than 72 bytes, without null characters.';
}

export function resetSiteOrigin(): string {
  const url = new URL(process.env.ADMIN_SITE_URL || SITE_URL);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) throw Error('Invalid admin site URL');
  return url.origin;
}

export function passwordResetConfigured(): boolean {
  try { resetSiteOrigin(); return siteEmailConfigured('admin-check@example.com'); }
  catch { return false; }
}

export const resetTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function requestPasswordReset(email: string): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const hash = resetTokenHash(token);
  const now = Date.now();
  // The per-account cooldown is persisted, including across backend restarts.
  const user = await User.findOneAndUpdate({ email, $or: [
    { passwordResetRequestedAt: { $exists: false } },
    { passwordResetRequestedAt: { $lt: new Date(now - 60_000) } },
  ] }, { $set: { passwordResetTokenHash: hash, passwordResetExpiresAt: new Date(now + RESET_LIFETIME_MS), passwordResetRequestedAt: new Date(now) } }, { new: true });
  if (!user) return;
  // Fragment keeps the token out of HTTP request URLs, access logs and referrers.
  const link = `${resetSiteOrigin()}/admin/reset-password#token=${token}`;
  try {
    const sent = await sendSiteEmail(user.email, 'Reset your Al-Burhaniya admin password',
      `A password reset was requested for your Al-Burhaniya admin account.\n\nSet your new password:\n${link}\n\nThis link expires in 15 minutes and can only be used once. If you did not request this, you can ignore this email. Your password has not changed.`);
    if (!sent) throw Error('Mail not accepted');
  } catch {
    // Only clear this failed request; a newer reset must never be removed.
    await User.updateOne({ _id: user._id, passwordResetTokenHash: hash }, { $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1, passwordResetRequestedAt: 1 } });
    throw Error('Password reset email could not be delivered');
  }
}
