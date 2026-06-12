const mongoose = require('mongoose');

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
    name: {
      type: String,
      required: [true, 'اسم التاجر أو الشركة مطلوب'],
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
    phone: {
      type: String,
      trim: true,
      default: '',
      //  التطوير المعماري: تحقق اختياري ولكنه صارم في حال إدخال رقم هاتف
      match: [/^(01[0125][0-9]{8})?$/, 'رقم الهاتف غير صالح، يجب أن يكون رقماً مصرياً صحيحاً']
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
  },
  { timestamps: true }
);

merchantSchema.index(
  { farm_id: 1, name: 1, merchant_type: 1 },
  { unique: true }
);

module.exports = mongoose.model('Merchant', merchantSchema);