const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true
    },
    farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      default: null
    },
    target_role: {
      type: String,
      enum: ['SUPER_ADMIN', 'OWNER', 'SUPERVISOR'], 
      required: true
    },
    target_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null 
    },
    title: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['CYCLE_STARTED', 'CYCLE_ENDED', 'HIGH_MORTALITY', 'LARGE_EXPENSE', 'FEED_DELIVERY', 'SYSTEM'],
      required: true
    },
    link: {
      type: String,
      default: null
    },
    is_read: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

//  التطوير المعماري 1: فهرس مركب (Compound Index) لتسريع الفرز بشكل جذري أثناء جلب الإشعارات
notificationSchema.index({ organization_id: 1, target_role: 1, createdAt: -1 });

//  التطوير المعماري 2: (TTL Index) لحذف الإشعارات تلقائياً بعد 30 يوماً من إنشائها لتنظيف الداتا بيز
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('Notification', notificationSchema);