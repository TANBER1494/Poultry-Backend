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
      unique: true,
      index: true,
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

module.exports = mongoose.model('User', userSchema);
