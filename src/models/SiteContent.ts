import mongoose, { Schema } from 'mongoose';
const SiteContentSchema = new Schema({ key: { type: String, unique: true, required: true }, content: { type: Schema.Types.Mixed, required: true } }, { timestamps: true });
export default mongoose.model('SiteContent', SiteContentSchema);
