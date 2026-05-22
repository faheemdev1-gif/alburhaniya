// server/src/models/Article.ts
import mongoose, { Document, Schema } from 'mongoose';

export interface IArticle extends Document {
  title: string;
  slug: string;
  category: string;
  categoryKey: string;
  date: string;
  dateISO: string;
  author: string;
  authorRole: string;
  authorAvatar: string;
  readTime: string;
  featured: boolean;
  tags: string[];
  excerpt: string;
  image: string;
  content: string;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ArticleSchema = new Schema<IArticle>(
  {
    title:       { type: String, required: true, trim: true },
    slug:        { type: String, required: true, unique: true, lowercase: true },
    category:    { type: String, required: true },
    categoryKey: {
      type: String, required: true,
      enum: ['community', 'youth', 'culture', 'sports', 'seniors', 'arts'],
    },
    date:         { type: String, required: true },   // e.g. "May 28, 2025"
    dateISO:      { type: String, required: true },   // e.g. "2025-05-28"
    author:       { type: String, required: true },
    authorRole:   { type: String, default: '' },
    authorAvatar: { type: String, default: '' },
    readTime:     { type: String, default: '5 min read' },
    featured:     { type: Boolean, default: false },
    tags:         [{ type: String }],
    excerpt:      { type: String, required: true },
    image:        { type: String, required: true },
    content:      { type: String, required: true },
    published:    { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Only one featured article at a time
ArticleSchema.pre('save', async function (next) {
  if (this.featured && this.isModified('featured')) {
    await mongoose.model('Article').updateMany(
      { _id: { $ne: this._id } },
      { featured: false }
    );
  }
  next();
});

export default mongoose.model<IArticle>('Article', ArticleSchema);