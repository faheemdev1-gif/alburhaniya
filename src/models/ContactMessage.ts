import mongoose, { Schema } from 'mongoose';

export const CONTACT_INTERESTS = ['Joining as a member', 'Volunteering', 'Partnering / Sponsorship', 'A specific programme', 'General enquiry'];
export const CONTACT_STATUSES = ['new', 'read', 'resolved'];
const schema = new Schema({
  submissionId: { type: String, required: true, unique: true },
  firstName: { type: String, required: true, maxlength: 80 },
  lastName: { type: String, required: true, maxlength: 80 },
  email: { type: String, required: true, maxlength: 254 },
  interest: { type: String, required: true, enum: CONTACT_INTERESTS },
  message: { type: String, required: true, maxlength: 5000 },
  status: { type: String, enum: CONTACT_STATUSES, default: 'new', index: true },
  notificationStatus: { type: String, enum: ['pending', 'sending', 'sent', 'failed', 'disabled'], default: 'pending' },
  notificationAttemptedAt: Date,
}, { timestamps: true });
schema.index({ createdAt: -1 });
export default mongoose.model('ContactMessage', schema);
