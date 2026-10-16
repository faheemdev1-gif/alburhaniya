import nodemailer from 'nodemailer';
import { validEmail } from './contactNotification';

export const mainMailbox = 'info@alburhaniyainternational.org.uk';
export const notificationMailbox = () => process.env.NOTIFICATION_TO_EMAIL || process.env.CONTACT_TO_EMAIL || mainMailbox;
export const eventMailbox = () => process.env.EVENT_TO_EMAIL || notificationMailbox();
export const siteSender = () => process.env.EVENT_FROM_EMAIL || process.env.CONTACT_FROM_EMAIL || process.env.SMTP_USER || mainMailbox;
export function siteEmailConfigured(to = notificationMailbox()): boolean {
  const port = Number(process.env.SMTP_PORT || 465);
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS &&
    validEmail(siteSender()) && validEmail(to) && Number.isInteger(port) && port > 0 && port <= 65535);
}
export async function sendSiteEmail(to: string, subject: string, text: string, replyTo?: string): Promise<boolean> {
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    requireTLS: port !== 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
    disableFileAccess: true, disableUrlAccess: true });
  try {
    const result = await transport.sendMail({ from: siteSender(), to, subject, text, ...(replyTo ? { replyTo } : {}) });
    return Array.isArray(result.accepted) && result.accepted.length > 0;
  } finally { transport.close(); }
}
