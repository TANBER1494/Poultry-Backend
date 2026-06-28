const mongoose = require('mongoose');

//  الترقية المعمارية: Schema فرعية للمناديب (Embedded Document)
const representativeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'اسم المندوب مطلوب'],
    trim: true,
  },
  phone: {
    type: String,
    trim: true,
    default: '',
    match: [/^(01[0125][0-9]{8})?$/, 'رقم هاتف المندوب غير صالح']
  },
  is_primary: {
    type: Boolean,
    default: false
  }
});

const merchantSchema = new mongoose.Schema(
  {
    farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      required: [true, 'يجب ربط التاجر بمزرعة'],
      index: true,
    },
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'يجب ربط المزرعة بشركة (Organization)'],
      index: true,
    },
    company_name: {
      type: String,
      required: [true, 'اسم الشركة أو الكيان التجاري مطلوب'],
      trim: true,
    },
    merchant_type: {
      type: String,
      enum: [
        'FEED_SUPPLIER', 
        'CHICK_SUPPLIER', 
        'MED_SUPPLIER', 
        'EGG_BUYER', 
        'MEAT_BUYER', 
        'MANURE_BUYER', 
        'GENERAL', 
      ],
      required: true,
    },
    company_phone: {
      type: String,
      trim: true,
      default: '',
      match: [/^(01[0125][0-9]{8}|0[2-9][0-9]{7})?$/, 'رقم هاتف الشركة غير صالح']
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    opening_balance: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'], 
      default: 'ACTIVE',
    },
    // مصفوفة المناديب المدمجة
    representatives: [representativeSchema]
  },
  { timestamps: true }
);

merchantSchema.index(
  { farm_id: 1, company_name: 1, merchant_type: 1 },
  { unique: true }
);

module.exports = mongoose.model('Merchant', merchantSchema);