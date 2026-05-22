// server/src/models/Event.ts
import mongoose, { Document, Schema } from 'mongoose';

export interface IScheduleItem {
  time: string;
  item: string;
}

export interface IEvent extends Document {
  title: string;
  slug: string;
  category: string;
  categoryKey: string;
  status: 'upcoming' | 'past';
  featured: boolean;
  dateISO: string;
  dateLabel: string;
  day: string;
  month: string;
  year: string;
  timeStart: string;
  timeEnd: string;
  location: string;
  address: string;
  capacity: number;
  registered: number;
  price: string;
  organiser: string;
  image: string;
  thumbImage: string;
  tags: string[];
  shortDesc: string;
  fullDesc: string;
  schedule: IScheduleItem[];
  highlights: string[];
  createdAt: Date;
  updatedAt: Date;
}

const ScheduleItemSchema = new Schema<IScheduleItem>(
  { time: { type: String, required: true }, item: { type: String, required: true } },
  { _id: false }
);

const EventSchema = new Schema<IEvent>(
  {
    title:       { type: String, required: true, trim: true },
    slug:        { type: String, required: true, unique: true, lowercase: true },
    category:    { type: String, required: true },
    categoryKey: {
      type: String, required: true,
      enum: ['gathering', 'music', 'dance', 'arts', 'sports', 'youth', 'seniors'],
    },
    status:    { type: String, enum: ['upcoming', 'past'], default: 'upcoming' },
    featured:  { type: Boolean, default: false },
    dateISO:   { type: String, required: true },
    dateLabel: { type: String, required: true },
    day:       { type: String, required: true },
    month:     { type: String, required: true },
    year:      { type: String, required: true },
    timeStart: { type: String, required: true },
    timeEnd:   { type: String, required: true },
    location:  { type: String, required: true },
    address:   { type: String, required: true },
    capacity:  { type: Number, default: 0 },
    registered:{ type: Number, default: 0 },
    price:     { type: String, default: 'Free' },
    organiser: { type: String, required: true },
    image:     { type: String, required: true },
    thumbImage:{ type: String, required: true },
    tags:      [{ type: String }],
    shortDesc: { type: String, required: true },
    fullDesc:  { type: String, required: true },
    schedule:  [ScheduleItemSchema],
    highlights:[{ type: String }],
  },
  { timestamps: true }
);

// Auto-update status based on date before saving
EventSchema.pre('save', function (next) {
  const today = new Date().toISOString().split('T')[0];
  if (this.dateISO < today) this.status = 'past';
  else this.status = 'upcoming';
  next();
});

export default mongoose.model<IEvent>('Event', EventSchema);