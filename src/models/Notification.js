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

module.exports = mongoose.model('Notification', notificationSchema);