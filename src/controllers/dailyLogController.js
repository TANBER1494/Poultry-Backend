const mongoose = require('mongoose');
const DailyLog = require('../models/DailyLog');
const Cycle = require('../models/Cycle');
const InventoryItem = require('../models/InventoryItem');
const InventoryMovement = require('../models/InventoryMovement');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 1. تسجيل يومية جديدة (معالجة النافق واستهلاك العلف)
// ==========================================
const createDailyLog = asyncHandler(async (req, res, next) => {
  const {
    local_id, barn_id, cycle_id, log_date, age_in_days,
    mortality_count, culled_count, 
    feed_item_id, feed_consumed_bags, feed_consumed_kg,
    water_consumed_liters, egg_trays_produced, loose_eggs_produced, broken_eggs,
    average_weight_grams, medications_given, notes
  } = req.body;

  const farmId = req.user.farm_id || req.body.farm_id;

  if (!local_id || !barn_id || !cycle_id || !log_date || !age_in_days) {
    return next(new AppError('البيانات الأساسية لليومية غير مكتملة', 400));
  }

  // حاجز أمني 1: منع التكرار بسبب ضعف الإنترنت
  const existingLogByLocalId = await DailyLog.findOne({ local_id }).lean();
  if (existingLogByLocalId) {
    return res.status(200).json({ message: 'تم استلام هذه اليومية مسبقاً', log: existingLogByLocalId });
  }

  // حاجز أمني 2: منع تسجيل يوميتين في نفس التاريخ لنفس الدورة
  const existingLogByDate = await DailyLog.findOne({ 
    cycle_id, 
    log_date: new Date(log_date).setHours(0,0,0,0) 
  }).lean();
  if (existingLogByDate) {
    return next(new AppError('تم تسجيل يومية لهذه الدورة في هذا التاريخ مسبقاً، يمكنك تعديلها بدلاً من إضافة واحدة جديدة', 400));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. التحقق من الدورة
    const cycle = await Cycle.findOne({ _id: cycle_id, farm_id: farmId, status: 'ACTIVE' }).session(session);
    if (!cycle) {
      throw new AppError('الدورة غير موجودة أو تم إغلاقها', 404);
    }

    const totalDeadBirds = (Number(mortality_count) || 0) + (Number(culled_count) || 0);
    
    if (totalDeadBirds > cycle.current_bird_count) {
      throw new AppError('عدد النافق والمستبعد أكبر من العدد الفعلي المتبقي للطيور في العنبر', 400);
    }

    let feedExpense = 0;
    const bagsCount = Number(feed_consumed_bags) || 0;
    const kgCount = Number(feed_consumed_kg) || 0;

    // 2. معالجة سحب العلف من المخزن (إذا تم تسجيل استهلاك)
    if (feed_item_id && (bagsCount > 0 || kgCount > 0)) {
      const feedItem = await InventoryItem.findOne({ _id: feed_item_id, farm_id: farmId }).session(session);
      if (!feedItem) {
        throw new AppError('صنف العلف المختار غير موجود في المخزن', 404);
      }

      // توحيد الكمية بناء على سياسة المزرعة (الافتراض هنا أن الخصم يتم بالشكارة أو الكيلو حسب إعداد الصنف)
      const quantityToDeduct = feedItem.unit === 'BAG' ? bagsCount : kgCount;

      if (feedItem.stock_quantity < quantityToDeduct) {
        throw new AppError(`رصيد العلف لا يكفي. الرصيد الحالي: ${feedItem.stock_quantity} ${feedItem.unit}`, 400);
      }

      // خصم الكمية من المخزن
      feedItem.stock_quantity -= quantityToDeduct;
      await feedItem.save({ session });

      // حساب التكلفة
      feedExpense = quantityToDeduct * feedItem.average_unit_cost;

      // تسجيل حركة منصرف في دفتر المخزن
      await InventoryMovement.create([{
        local_id: `${local_id}_FEED_OUT`,
        farm_id: farmId,
        item_id: feedItem._id,
        cycle_id: cycle._id,
        performed_by: req.user._id,
        movement_type: 'CONSUMPTION',
        quantity: quantityToDeduct,
        unit_cost_at_time: feedItem.average_unit_cost,
        total_value: feedExpense,
        movement_date: new Date(log_date),
        reference_doc: `استهلاك يومية عمر ${age_in_days} يوم`
      }], { session });
    }

    // 3. تحديث بيانات الدورة (تخفيض عدد الطيور وزيادة المصروفات)
    cycle.current_bird_count -= totalDeadBirds;
    cycle.total_expenses += feedExpense;
    await cycle.save({ session });

    // 4. إنشاء سجل اليومية
    const [newLog] = await DailyLog.create([{
      local_id,
      farm_id: farmId,
      barn_id,
      cycle_id,
      recorded_by: req.user._id,
      log_date: new Date(log_date),
      age_in_days,
      mortality_count: Number(mortality_count) || 0,
      culled_count: Number(culled_count) || 0,
      feed_consumed_bags: bagsCount,
      feed_consumed_kg: kgCount,
      water_consumed_liters: Number(water_consumed_liters) || 0,
      egg_trays_produced: Number(egg_trays_produced) || 0,
      loose_eggs_produced: Number(loose_eggs_produced) || 0,
      broken_eggs: Number(broken_eggs) || 0,
      average_weight_grams: average_weight_grams ? Number(average_weight_grams) : null,
      medications_given: medications_given ? medications_given.trim() : '',
      notes: notes ? notes.trim() : ''
    }], { session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'تم تسجيل اليومية وتحديث المخازن وحسابات الدورة بنجاح',
      log: newLog
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    if (error.isOperational) return next(error);
    console.error('Daily Log Transaction Error:', error);
    return next(new AppError('حدث خطأ داخلي أثناء تسجيل اليومية، تم التراجع لحماية البيانات', 500));
  }
});

// ==========================================
// 2. جلب يوميات دورة معينة
// ==========================================
const getCycleDailyLogs = asyncHandler(async (req, res, next) => {
  const { cycle_id } = req.params;
  
  const logs = await DailyLog.find({ cycle_id })
    .populate('recorded_by', 'name role')
    .sort({ age_in_days: -1 })
    .lean();

  res.status(200).json({ count: logs.length, logs });
});

module.exports = {
  createDailyLog,
  getCycleDailyLogs
};