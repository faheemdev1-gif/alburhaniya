import mongoose, { Schema } from 'mongoose';

export const NEWSLETTER_STATUSES = ['pending', 'confirmed', 'unsubscribed'];
const schema = new Schema({
  email: { type: String, required: true, unique: true, maxlength: 254 },
  status: { type: String, enum: NEWSLETTER_STATUSES, default: 'pending', index: true },
  consentVersion: { type: String, default: 'homepage-newsletter-v1' },
  requestedAt: { type: Date, default: Date.now },
  confirmedAt: Date,
  unsubscribedAt: Date,
  confirmationHash: { type: String, select: false },
  confirmationExpiresAt: { type: Date, select: false },
  notificationStatus: { type: String, enum: ['pending', 'sending', 'sent', 'failed', 'disabled'], default: 'pending' },
  notificationAttemptedAt: Date,
}, { timestamps: true });
schema.index({ createdAt: -1 });
schema.index({ confirmationHash: 1 }, { sparse: true });
export default mongoose.model('NewsletterSubscriber', schema);
