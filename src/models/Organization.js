const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'اسم شركة الدواجن / المستثمر مطلوب'],
      trim: true,
    },
    owner_name: {
      type: String,
      required: [true, 'اسم المالك مطلوب'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'رقم هاتف المالك مطلوب'],
      unique: true, 
      index: true,
      //  التطوير المعماري: ضمان صحة رقم الهاتف
      match: [/^(01[0125][0-9]{8})$/, 'رقم الهاتف غير صالح، يجب أن يكون رقماً مصرياً صحيحاً']
    },
    max_allowed_farms: { 
      type: Number,
      default: 1,
      min: [1, 'يجب أن يكون الحد الأدنى للمزارع المسموح بها 1'],
    },
    //  التطوير المعماري: مفتاح إيقاف كامل للشركة لتعليق جميع أنشطتها ومزارعها بضغطة واحدة
    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED'],
      default: 'ACTIVE'
    }
  },
  {
    timestamps: true, 
  }
);

module.exports = mongoose.model('Organization', organizationSchema);