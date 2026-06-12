const mongoose = require('mongoose');

const workerSchema = new mongoose.Schema(
  {
    //  التطوير المعماري: لدعم تقارير الإدارة العليا
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
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
      match: [/^(01[0125][0-9]{8})?$/, 'رقم الهاتف غير صالح'] // يقبل فارغ أو رقم مصري
    },
    national_id: { 
      type: String,
      trim: true,
      default: '',
      //  التطوير المعماري: ضمان صحة الرقم القومي
      match: [/^(\d{14})?$/, 'الرقم القومي يجب أن يتكون من 14 رقماً']
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

//  منع تكرار تسجيل نفس الرقم القومي داخل نفس المزرعة (إذا تم إدخاله)
workerSchema.index(
  { farm_id: 1, national_id: 1 }, 
  { unique: true, partialFilterExpression: { national_id: { $ne: '' } } }
);

module.exports = mongoose.model('Worker', workerSchema);