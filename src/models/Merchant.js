const mongoose = require('mongoose');

const merchantSchema = new mongoose.Schema(
  {
    farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      required: [true, 'يجب ربط التاجر بمزرعة'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'اسم التاجر أو الشركة مطلوب'],
      trim: true,
    },
    merchant_type: {
      type: String,
      enum: [
        'FEED_SUPPLIER',   // مورد علف
        'CHICK_SUPPLIER',  // مورد كتاكيت
        'MED_SUPPLIER',    // مورد أدوية وتحصينات
        'EGG_BUYER',       // تاجر بيض (عميل)
        'MEAT_BUYER',      // تاجر لحم فراخ (عميل)
        'MANURE_BUYER',    // تاجر سبلة (عميل)
        'GENERAL'          // عام
      ],
      required: true,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    opening_balance: {
      type: Number,
      default: 0, 
      // موجب = التاجر مدين لنا (عليه فلوس) | سالب = التاجر دائن (ليه فلوس)
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'], // لو قاطعنا شركة معينة نوقف التعامل معاها
      default: 'ACTIVE',
    },
  },
  { timestamps: true }
);

// فهرس لمنع تسجيل نفس التاجر بنفس النشاط مرتين في نفس المزرعة
merchantSchema.index({ farm_id: 1, name: 1, merchant_type: 1 }, { unique: true });

module.exports = mongoose.model('Merchant', merchantSchema);