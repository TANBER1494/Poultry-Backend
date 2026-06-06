const mongoose = require('mongoose');

const dailyLogSchema = new mongoose.Schema(
  {
    local_id: { 
      type: String,
      required: true,
      unique: true, 
      index: true,
    },
    farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      required: true,
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
      required: true, // المشرف اللي كتب التقرير
    },
    log_date: { 
      type: Date,
      required: true,
    },
    age_in_days: { // 🚀 (العمر) بيزيد تدريجي زي ما تفضلت
      type: Number,
      required: true,
      min: 1,
    },
    
    // 💀 النافق والاستبعاد (لكل أنواع العنابر)
    mortality_count: { type: Number, default: 0, min: 0 },
    culled_count: { type: Number, default: 0, min: 0 }, // فرز واستبعاد (مريضة/ضعيفة)

    // 🌾 الاستهلاك (لتبسيط الإدخال على المشرف)
    feed_consumed_bags: { type: Number, default: 0, min: 0 }, // 15 شكارة
    feed_consumed_kg: { type: Number, default: 0, min: 0 },   // فكة بالكيلو لو فيه
    water_consumed_liters: { type: Number, default: 0, min: 0 },

    // 🥚 إنتاج البيض (تُستخدم فقط لو كان العنبر LAYER بياض أو أمهات)
    egg_trays_produced: { type: Number, default: 0, min: 0 }, // عدد الأطباق السليمة
    loose_eggs_produced: { type: Number, default: 0, min: 0 }, // بيض فرط (أقل من طبق)
    broken_eggs: { type: Number, default: 0, min: 0 }, // بيض مكسور/مستبعد

    // ⚖️ الأوزان الطبية (تُستخدم أساساً في دورات التسمين BROILER)
    average_weight_grams: { type: Number, default: null }, 

    // 💉 الأدوية والملاحظات
    medications_given: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
  }
);

// منع المشرف من تسجيل تقريرين لنفس العنبر/الدورة في نفس اليوم (يجب أن يعدل القديم)
dailyLogSchema.index({ cycle_id: 1, log_date: 1 }, { unique: true });

module.exports = mongoose.model('DailyLog', dailyLogSchema);