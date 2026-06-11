const mongoose = require('mongoose');

const workerSchema = new mongoose.Schema(
  {
    farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      required: [true, 'يجب ربط العامل بمزرعة'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'اسم العامل مطلوب'],
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    national_id: { 
      type: String,
      trim: true,
      default: '',
    },
    base_daily_wage: {
      type: Number,
      required: [true, 'يجب تحديد اليومية الأساسية للعامل'],
      min: [0, 'اليومية لا يمكن أن تكون سالبة'],
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'ON_LEAVE', 'TERMINATED'], 
      default: 'ACTIVE',
    },
    hiring_date: {
      type: Date,
      default: Date.now,
    },
    termination_date: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Worker', workerSchema);