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
    //  التعديل الجديد: إضافة البريد الإلكتروني مع دعم الـ Sparse للعمال
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true, 
      match: [/^\S+@\S+\.\S+$/, 'صيغة البريد الإلكتروني غير صالحة'],
    },
    role: {
      type: String,
      enum: ['SUPER_ADMIN', 'OWNER', 'SUPERVISOR', 'WORKER'],
      required: true,
    },
    phone: {
      type: String,
      required: [true, 'رقم الهاتف مطلوب'],
      match: [/^(01[0125][0-9]{8})$/, 'رقم الهاتف غير صالح، يجب أن يكون رقماً مصرياً صحيحاً']
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
    fcm_token: {
      type: String,
      default: null,
    },
    //  التعديل الجديد: حقول الـ OTP المدمجة (مخفية افتراضياً للأمان)
    otp_code: {
      type: String,
      select: false,
    },
    otp_expires_at: {
      type: Date,
      select: false,
    },
    otp_last_sent_at: {
      type: Date,
      select: false,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED', 'TERMINATED', 'PENDING'],
      default: 'PENDING',
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

userSchema.index(
  { phone: 1 }, 
  { unique: true, partialFilterExpression: { deleted_at: null } }
);

module.exports = mongoose.model('User', userSchema);