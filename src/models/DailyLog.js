const mongoose = require('mongoose');

const dailyLogSchema = new mongoose.Schema(
  {
    local_id: { type: String, required: true, unique: true, index: true },
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      required: true,
      index: true,
    },
    barn_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Barn',
      required: true,
      index: true,
    },
    cycle_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cycle',
      required: true,
      index: true,
    },
    recorded_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    log_date: { type: Date, required: true },
    age_in_days: { type: Number, required: true, min: 1 },

    mortality_count: { type: Number, default: 0, min: 0 },
    culled_count: { type: Number, default: 0, min: 0 },

    feed_consumed_bags: { type: Number, default: 0, min: 0 },
    feed_consumed_kg: { type: Number, default: 0, min: 0 },

    egg_trays_produced: { type: Number, default: 0, min: 0 },
    loose_eggs_produced: { type: Number, default: 0, min: 0 },
    broken_eggs: { type: Number, default: 0, min: 0 },
    average_weight_grams: { type: Number, default: null },

    consumed_medications: [
      {
        item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem' },
        name: { type: String }, // للاحتفاظ بالاسم للسرعة في العرض
        quantity: { type: Number, default: 0 },
      },
    ],

    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

dailyLogSchema.index({ cycle_id: 1, log_date: 1 }, { unique: true });

module.exports = mongoose.model('DailyLog', dailyLogSchema);
