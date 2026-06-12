const mongoose = require('mongoose');

const farmSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'يجب ربط المزرعة بشركة (Organization)'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'اسم المزرعة مطلوب (مثال: مزرعة الحمد 1)'],
      trim: true,
    },
    location: {
      type: String,
      required: [true, 'موقع المزرعة مطلوب'],
      trim: true,
    },
    farm_type: { 
      type: String,
      enum: ['BROILER', 'LAYER', 'BREEDER'], 
      default: 'BROILER',
      required: true,
    },
    max_capacity: { 
      type: Number,
      required: [true, 'يجب تحديد السعة القصوى للمزرعة (عدد الطيور)'],
      min: [0, 'السعة لا يمكن أن تكون سالبة'],
    },
    subscription_status: {
      type: String,
      enum: ['TRIAL', 'ACTIVE', 'OVERDUE', 'LOCKED'],
      default: 'TRIAL',
      required: true,
    },
    monthly_fee: {
      type: Number,
      required: [true, 'يجب تحديد قيمة الاشتراك الشهري للمزرعة'],
      min: 0,
    },
    trial_ends_at: {
      type: Date,
      required: [true, 'تاريخ انتهاء الفترة التجريبية مطلوب'],
    },
    subscription_ends_at: {
      type: Date,
      default: null,
    },
    has_feed_mill: { 
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

//  التطوير المعماري: منع إنشاء مزرعتين بنفس الاسم داخل نفس المؤسسة بقوة محرك الداتا بيز
farmSchema.index({ organization_id: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Farm', farmSchema);