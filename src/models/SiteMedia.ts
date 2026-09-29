import mongoose, { Schema } from 'mongoose';
const SiteMediaSchema = new Schema({ mime: {type:String,required:true}, data: {type:Buffer,required:true} }, {timestamps:true});
export default mongoose.model('SiteMedia', SiteMediaSchema);
