import nodemailer from 'nodemailer';
import ContactMessage from '../models/ContactMessage';

export function contactEmailConfigured(): boolean {
  const port = Number(process.env.SMTP_PORT || 465);
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS &&
    validEmail(process.env.CONTACT_FROM_EMAIL) && validEmail(process.env.CONTACT_TO_EMAIL) &&
    Number.isInteger(port) && port > 0 && port <= 65535);
}
export function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
}

// Claim each attempt in MongoDB so concurrent requests do not send duplicate notifications.
export async function notifyContact(id: string): Promise<void> {
  if (!contactEmailConfigured()) {
    await ContactMessage.updateOne({ _id: id, notificationStatus: { $in: ['pending', 'failed', 'disabled'] } }, { $set: { notificationStatus: 'disabled' } });
    return;
  }
  const record = await ContactMessage.findOneAndUpdate({ _id: id, $or: [
    { notificationStatus: { $in: ['pending', 'failed', 'disabled'] } },
    { notificationStatus: 'sending', notificationAttemptedAt: { $lt: new Date(Date.now() - 5 * 60_000) } },
  ] }, { $set: { notificationStatus: 'sending', notificationAttemptedAt: new Date() } }, { new: true });
  if (!record) return;
  let sent = false;
  try {
    const port = Number(process.env.SMTP_PORT || 465);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      requireTLS: port !== 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
      disableFileAccess: true, disableUrlAccess: true,
    });
    try {
      const result = await transport.sendMail({
        from: process.env.CONTACT_FROM_EMAIL, to: process.env.CONTACT_TO_EMAIL,
        replyTo: record.email,
        subject: `Website enquiry: ${record.interest}`,
        text: `New website contact message\n\nName: ${record.firstName} ${record.lastName}\nEmail: ${record.email}\nInterest: ${record.interest}\nReceived: ${record.createdAt.toISOString()}\n\n${record.message}\n\nManage this message in your website's Admin > Messages inbox.`,
      });
      sent = Array.isArray(result.accepted) && result.accepted.length > 0;
    } finally { transport.close(); }
  } catch {
    console.error('[Contact] Email notification failed; the message remains in the admin inbox.');
  }
  await ContactMessage.updateOne({ _id: id }, { $set: { notificationStatus: sent ? 'sent' : 'failed' } });
}
