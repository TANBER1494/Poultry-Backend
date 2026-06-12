const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: function () {
        return this.role !== 'SUPER_ADMIN';
      },
      index: true,
    },
    farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      default: null,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'اسم المستخدم مطلوب'],
      trim: true,
    },
    role: {
      type: String,
      enum: ['SUPER_ADMIN', 'OWNER', 'SUPERVISOR'],
      required: true,
    },
    phone: {
      type: String,
      required: [true, 'رقم الهاتف مطلوب'],
      match: [/^(01[0125][0-9]{8})$/, 'رقم الهاتف غير صالح، يجب أن يكون رقماً مصرياً صحيحاً']
      // تم إزالة unique: true من هنا لنقلها إلى مستوى الـ Schema لدعم الحذف الناعم
    },
    password_hash: {
      type: String,
      required: true,
      select: false,
    },
    current_session_id: {
      type: String,
      default: null,
    },
    //  التطوير المعماري 1: إصلاح ثغرة الإشعارات الحرجة
    fcm_token: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED', 'TERMINATED'],
      default: 'ACTIVE',
    },
    hiring_date: {
      type: Date,
      default: Date.now,
    },
    deleted_at: {
      type: Date,
      default: null,
      index: true,
    },
    is_dark_mode: {
      type: Boolean,
      default: false,
    },
    notifications: {
      cycle_started: { type: Boolean, default: true },
      cycle_ended: { type: Boolean, default: true },
      high_mortality: { type: Boolean, default: true },
      large_expense: { type: Boolean, default: true },
      feed_delivery: { type: Boolean, default: true },
    },
  },
  {
    timestamps: true,
  }
);

//  التطوير المعماري 2: فهرس فريد يسمح بتسجيل رقم هاتف لموظف جديد إذا كان القديم محذوفاً
userSchema.index(
  { phone: 1 }, 
  { unique: true, partialFilterExpression: { deleted_at: null } }
);

module.exports = mongoose.model('User', userSchema);