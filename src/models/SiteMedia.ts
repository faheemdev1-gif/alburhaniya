import mongoose, { Schema } from 'mongoose';
// Existing records contain only mime and data; new records include a thumbnail.
const SiteMediaSchema = new Schema({
  mime: { type: String, required: true },
  data: { type: Buffer, required: true },
  thumbData: Buffer,
  width: Number,
  height: Number,
  originalName: String,
}, { timestamps: true });
export default mongoose.model('SiteMedia', SiteMediaSchema);
