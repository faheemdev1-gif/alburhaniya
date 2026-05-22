// server/src/models/Gallery.ts
import mongoose, { Document, Schema } from 'mongoose';

export interface IGalleryItem extends Document {
  title: string;
  category: string;
  imageUrl: string;     // public URL (served from /uploads or CDN)
  filename: string;     // stored filename on disk
  size: 'normal' | 'tall' | 'wide';
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const GallerySchema = new Schema<IGalleryItem>(
  {
    title:    { type: String, required: true, trim: true },
    category: {
      type: String, required: true,
      enum: ['gatherings', 'music', 'sports', 'arts', 'dance', 'general'],
      default: 'general',
    },
    imageUrl: { type: String, required: true },
    filename: { type: String, required: true },
    size:     { type: String, enum: ['normal', 'tall', 'wide'], default: 'normal' },
    order:    { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model<IGalleryItem>('GalleryItem', GallerySchema);