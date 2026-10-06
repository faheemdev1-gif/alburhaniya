import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import nodemailer from 'nodemailer';
import Subscriber from '../models/NewsletterSubscriber';
import { validEmail } from './contactNotification';

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function newsletterSiteUrl(): string {
  const url = new URL(process.env.NEWSLETTER_SITE_URL || 'https://al-burhaniyainternational.co.uk');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid newsletter website URL');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Newsletter website must use HTTPS');
  return url.origin;
}
export function newsletterEmailConfigured(): boolean {
  const port = Number(process.env.SMTP_PORT || 465);
  try {
    newsletterSiteUrl();
    return Boolean(process.env.JWT_SECRET && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS &&
      validEmail(process.env.NEWSLETTER_FROM_EMAIL || process.env.CONTACT_FROM_EMAIL || process.env.SMTP_USER) &&
      Number.isInteger(port) && port > 0 && port <= 65535);
  } catch { return false; }
}
function unsubscribeSignature(id: string): string {
  if (!process.env.JWT_SECRET) throw new Error('Missing signing secret');
  return createHmac('sha256', process.env.JWT_SECRET).update(`newsletter-unsubscribe-v1:${id}`).digest('hex');
}
export function unsubscribeUrl(id: string): string {
  return `${newsletterSiteUrl()}/newsletter/unsubscribe#token=${id}.${unsubscribeSignature(id)}`;
}
export function unsubscribeId(token: unknown): string | null {
  if (typeof token !== 'string' || !/^[a-f0-9]{24}\.[a-f0-9]{64}$/.test(token) || !process.env.JWT_SECRET) return null;
  const [id, signature] = token.split('.');
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(unsubscribeSignature(id), 'hex')) ? id : null;
}

// Atomic claim and a one-minute cooldown prevent concurrent requests sending duplicate emails.
export async function sendNewsletterConfirmation(id: string): Promise<'sent' | 'waiting' | 'failed' | 'disabled' | 'inactive'> {
  if (!newsletterEmailConfigured()) {
    await Subscriber.updateOne({ _id: id, status: 'pending', notificationStatus: { $ne: 'sending' } }, { $set: { notificationStatus: 'disabled' } });
    return 'disabled';
  }
  const token = randomBytes(32).toString('hex');
  const hash = tokenHash(token);
  const record = await Subscriber.findOneAndUpdate({ _id: id, status: 'pending', $or: [
    { notificationAttemptedAt: { $exists: false } },
    { notificationAttemptedAt: { $lt: new Date(Date.now() - 60_000) }, notificationStatus: { $ne: 'sending' } },
    { notificationAttemptedAt: { $lt: new Date(Date.now() - 5 * 60_000) }, notificationStatus: 'sending' },
  ] }, { $set: { notificationStatus: 'sending', notificationAttemptedAt: new Date(), confirmationHash: hash,
    confirmationExpiresAt: new Date(Date.now() + 48 * 60 * 60_000) } }, { new: true });
  if (!record) {
    const existing = await Subscriber.findById(id);
    if (!existing || existing.status !== 'pending') return 'inactive';
    return existing.notificationStatus === 'failed' ? 'failed' : 'waiting';
  }
  let sent = false;
  try {
    const port = Number(process.env.SMTP_PORT || 465);
    const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      requireTLS: port !== 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000, disableFileAccess: true, disableUrlAccess: true });
    try {
      const result = await transport.sendMail({
        from: process.env.NEWSLETTER_FROM_EMAIL || process.env.CONTACT_FROM_EMAIL || process.env.SMTP_USER,
        to: record.email, subject: 'Confirm your Al-Burhaniya newsletter subscription',
        text: `You requested monthly news, events and community updates from Al-Burhaniya International.\n\nConfirm your subscription (link expires in 48 hours):\n${newsletterSiteUrl()}/newsletter/confirm#token=${token}\n\nOpen the link and select Confirm subscription. You will only join the mailing list after confirming.\n\nIf you did not request this, ignore this email. To cancel or unsubscribe:\n${unsubscribeUrl(record.id)}\n\nAl-Burhaniya International\n${newsletterSiteUrl()}`,
      });
      sent = Array.isArray(result.accepted) && result.accepted.length > 0;
    } finally { transport.close(); }
  } catch { console.error('[Newsletter] Confirmation email failed; the request remains saved.'); }
  await Subscriber.updateOne({ _id: id, status: 'pending', confirmationHash: hash }, { $set: { notificationStatus: sent ? 'sent' : 'failed' } });
  return sent ? 'sent' : 'failed';
}
