const mongoose = require('mongoose');

const cycleSchema = new mongoose.Schema(
  {
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
    },
    supervisor_id: { 
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'اسم الدورة مطلوب (مثال: دورة تسمين مايو 2026)'],
      trim: true,
    },
    type: {
      type: String,
      enum: ['BROILER', 'LAYER'], // تسمين، بياض
      required: true,
    },
    status: {
      type: String,
      enum: ['PREPARATION', 'ACTIVE', 'CLOSED'], // تجهيز، تعمل، مقفلة/مصفاة
      default: 'ACTIVE',
    },
    start_date: {
      type: Date,
      required: [true, 'تاريخ استلام الكتاكيت/الطيور مطلوب'],
    },
    end_date: { // تاريخ بيع وتصفية الدورة
      type: Date,
      default: null,
    },
    initial_bird_count: {
      type: Number,
      required: [true, 'العدد الابتدائي للطيور مطلوب'],
      min: 1,
    },
    current_bird_count: { // يتم تحديثه تلقائياً كلما زاد النافق
      type: Number,
      required: true,
    },
    // 💰 ميزانية الدورة (تُحدث تلقائياً مع كل عملية مالية تخص هذه الدورة)
    total_expenses: { type: Number, default: 0 }, // تكلفة كتكوت، علف، أدوية، عمال
    total_revenue: { type: Number, default: 0 },  // مبيعات لحم، بيض، سبلة
    net_profit: { type: Number, default: 0 },     // صافي الربح (يُحسب عند الإغلاق)
  },
  {
    timestamps: true,
  }
);

// لضمان سرعة استخراج التقارير للدورة
cycleSchema.index({ farm_id: 1, status: 1 });

module.exports = mongoose.model('Cycle', cycleSchema);