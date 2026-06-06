const mongoose = require('mongoose');

const workerLogSchema = new mongoose.Schema(
  {
    local_id: { 
      type: String,
      required: true,
      unique: true,
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
      required: true, // المشرف اللي سجل اليومية
    },
    log_date: {
      type: Date,
      required: true,
    },
    
    // 1 = يوم عادي، 0.5 = خصم نص يوم، 1.5 = عنبر ونص، 2 = مسك عنبرين، 0 = غياب
    wage_multiplier: {
      type: Number,
      default: 1.0,
      min: 0,
    },
    
    // 💰 القيمة المستحقة لهذا اليوم (يتم حسابها: base_daily_wage * wage_multiplier)
    earned_amount: {
      type: Number,
      required: true,
      min: 0,
    },
    notes: {
      type: String,
      trim: true,
      default: '', // مثال: "خصم نص يوم بسبب الإهمال" أو "مسك عنبر رقم 2 مع زميله"
    },
  },
  { timestamps: true }
);

// لا يمكن تسجيل أكثر من يومية لنفس العامل في نفس اليوم
workerLogSchema.index({ worker_id: 1, log_date: 1 }, { unique: true });

module.exports = mongoose.model('WorkerLog', workerLogSchema);