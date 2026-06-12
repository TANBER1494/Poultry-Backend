const mongoose = require('mongoose');

const barnSchema = new mongoose.Schema(
  {
    farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      required: [true, 'يجب ربط العنبر بمزرعة'],
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
      required: [true, 'اسم أو رقم العنبر مطلوب (مثال: عنبر 1)'],
      trim: true,
    },
    barn_type: {
      type: String,
      enum: ['BROILER', 'LAYER', 'BREEDER'],
      required: [true, 'يجب تحديد نوع نشاط العنبر'],
    },
    capacity: {
      type: Number,
      required: [true, 'سعة العنبر من الطيور مطلوبة'],
      min: [1, 'يجب أن تكون السعة أكبر من صفر'],
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'MAINTENANCE', 'INACTIVE'],
      default: 'ACTIVE',
    },
    deleted_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

//  التطوير المعماري: منع تكرار اسم العنبر داخل نفس المزرعة للعنابر غير المحذوفة فقط
barnSchema.index(
  { farm_id: 1, name: 1 }, 
  { unique: true, partialFilterExpression: { deleted_at: null } }
);

module.exports = mongoose.model('Barn', barnSchema);