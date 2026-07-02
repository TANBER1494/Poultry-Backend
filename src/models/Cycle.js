const mongoose = require('mongoose');

const cycleSchema = new mongoose.Schema(
  {
    farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      required: true,
      index: true,
    },
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'يجب ربط المزرعة بشركة (Organization)'],
      index: true,
    },
    barn_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Barn',
      required: true,
    },
    supervisor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'اسم الدورة مطلوب'],
      trim: true,
    },
    type: {
      type: String,
      enum: ['BROILER', 'LAYER'],
      required: true,
    },
    status: {
      type: String,
      enum: ['PREPARATION', 'ACTIVE', 'CLOSED'],
      default: 'ACTIVE',
    },
    start_date: {
      type: Date,
      required: [true, 'تاريخ استلام الكتاكيت/الطيور مطلوب'],
    },
    end_date: {
      type: Date,
      default: null,
    },
    initial_bird_count: {
      type: Number,
      required: [true, 'العدد الابتدائي للطيور مطلوب'],
      min: 1,
    },
    current_bird_count: {
      type: Number,
      required: true,
      min: [0, 'لا يمكن أن يكون رصيد الطيور بالسالب'],
    },
    total_sold_birds: { type: Number, default: 0, min: 0 },
    total_dead_birds: { type: Number, default: 0, min: 0 },

    feed_custody: [
      {
        item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem' },
        quantity: { type: Number, default: 0, min: 0 },
      },
    ],
    // الترقية المعمارية: إضافة عدادات لمنتجات الدورة الأخرى
    total_sold_eggs: { type: Number, default: 0, min: 0 },
    total_sold_manure: { type: Number, default: 0, min: 0 },
    pending_egg_pulls: { type: Number, default: 0, min: 0 },
    total_expenses: { type: Number, default: 0 },
    total_revenue: { type: Number, default: 0 },
    net_profit: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

cycleSchema.index({ farm_id: 1, status: 1 });
cycleSchema.index(
  { barn_id: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['PREPARATION', 'ACTIVE'] } },
  }
);

module.exports = mongoose.model('Cycle', cycleSchema);
