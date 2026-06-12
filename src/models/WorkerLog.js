const mongoose = require('mongoose');

const workerLogSchema = new mongoose.Schema(
  {
    local_id: { 
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    //  التطوير المعماري: إضافة الحقل لتوحيد الهيكلة
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      required: true,
    },
    worker_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Worker',
      required: true,
      index: true,
    },
    recorded_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true, 
    },
    log_date: {
      type: Date,
      required: true,
    },
    wage_multiplier: {
      type: Number,
      default: 1.0,
      min: 0,
    },
    earned_amount: {
      type: Number,
      required: true,
      min: 0,
    },
    notes: {
      type: String,
      trim: true,
      default: '', 
    },
  },
  { timestamps: true }
);

workerLogSchema.index({ worker_id: 1, log_date: 1 }, { unique: true });

module.exports = mongoose.model('WorkerLog', workerLogSchema);