const mongoose = require('mongoose');
const DailyLog = require('../models/DailyLog');
const Cycle = require('../models/Cycle');
const InventoryItem = require('../models/InventoryItem');
const InventoryMovement = require('../models/InventoryMovement');
const AppError = require('../utils/AppError');

class DailyLogService {
  /**
   * @desc إنشاء يومية جديدة بأسلوب آمن ضد التزامن
   */
  async createDailyLog(data, userId, farmId, orgId) {
    const {
      local_id, barn_id, cycle_id, log_date, age_in_days,
      mortality_count, culled_count,
      feed_item_id, feed_consumed_bags, feed_consumed_kg,
      water_consumed_liters, egg_trays_produced, loose_eggs_produced, broken_eggs,
      average_weight_grams, medications_given, notes
    } = data;

    // منع التكرار بناء على الـ local_id (لدعم العمل بدون إنترنت)
    const existingLogByLocalId = await DailyLog.findOne({ local_id }).lean();
    if (existingLogByLocalId) return { isDuplicate: true, log: existingLogByLocalId };

    // منع تكرار اليومية لنفس الدورة في نفس اليوم
    const startOfDay = new Date(log_date).setHours(0, 0, 0, 0);
    const existingLogByDate = await DailyLog.findOne({ cycle_id, log_date: startOfDay }).lean();
    if (existingLogByDate) {
      throw new AppError('تم تسجيل يومية لهذه الدورة في هذا التاريخ مسبقاً', 400);
    }

    const totalDeadBirds = (Number(mortality_count) || 0) + (Number(culled_count) || 0);
    const bagsCount = Number(feed_consumed_bags) || 0;
    const kgCount = Number(feed_consumed_kg) || 0;
    let feedExpense = 0;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1. التحديث الذري للدورة (خصم النافق وإضافة المصروفات بشكل آمن)
      const cycleUpdateQuery = totalDeadBirds > 0 || feedExpense > 0 
        ? { $inc: { current_bird_count: -totalDeadBirds } } 
        : {};

      const cycle = await Cycle.findOneAndUpdate(
        { 
          _id: cycle_id, 
          farm_id: farmId, 
          status: 'ACTIVE',
          current_bird_count: { $gte: totalDeadBirds } // ضمان وجود رصيد طيور كافٍ
        },
        cycleUpdateQuery,
        { new: true, session }
      );

      if (!cycle) {
        throw new AppError('الدورة غير موجودة، مغلقة، أو أن عدد النافق يتجاوز الطيور الحية المتبقية', 400);
      }

      // 2. التحديث الذري للمخزون (خصم العلف)
      if (feed_item_id && (bagsCount > 0 || kgCount > 0)) {
        // جلب الصنف لمعرفة وحدة القياس ومتوسط التكلفة أولاً
        const feedItemMeta = await InventoryItem.findOne({ _id: feed_item_id, farm_id: farmId }).lean();
        if (!feedItemMeta) throw new AppError('صنف العلف المختار غير موجود', 404);

        const quantityToDeduct = feedItemMeta.unit === 'BAG' ? bagsCount : kgCount;
        feedExpense = quantityToDeduct * feedItemMeta.average_unit_cost;

        // التحديث الذري للمخزون
        const updatedFeedItem = await InventoryItem.findOneAndUpdate(
          { 
            _id: feed_item_id, 
            farm_id: farmId,
            stock_quantity: { $gte: quantityToDeduct } // ضمان عدم سحب رصيد بالسالب
          },
          { $inc: { stock_quantity: -quantityToDeduct } },
          { new: true, session }
        );

        if (!updatedFeedItem) {
          throw new AppError(`رصيد العلف لا يكفي لإتمام هذه اليومية`, 400);
        }

        // إضافة مصروف العلف إلى الدورة (تحديث ثانٍ للدورة بعد حساب التكلفة)
        await Cycle.findByIdAndUpdate(cycle_id, { $inc: { total_expenses: feedExpense } }, { session });

        // تسجيل حركة المخزن
        await InventoryMovement.create([{
          local_id: `${local_id}_FEED_OUT`,
          farm_id: farmId,
          item_id: feed_item_id,
          cycle_id: cycle._id,
          performed_by: userId,
          movement_type: 'CONSUMPTION',
          quantity: quantityToDeduct,
          unit_cost_at_time: feedItemMeta.average_unit_cost,
          total_value: feedExpense,
          movement_date: new Date(log_date),
          reference_doc: `استهلاك يومية عمر ${age_in_days} يوم`
        }], { session });
      }

      // 3. إنشاء سجل اليومية
      const [newLog] = await DailyLog.create([{
        local_id,
        farm_id: farmId,
        barn_id,
        cycle_id,
        recorded_by: userId,
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
      return { isDuplicate: false, log: newLog };

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * @desc جلب اليوميات مع التحقق من الصلاحيات (سد ثغرة IDOR)
   */
  async getLogsByCycle(cycleId, farmId) {
    // التحقق من أن الدورة تابعة لمزرعة يملكها المستخدم
    const cycle = await Cycle.findOne({ _id: cycleId, farm_id: farmId }).lean();
    if (!cycle) throw new AppError('الدورة غير موجودة أو غير مصرح لك بالوصول إليها', 403);

    return await DailyLog.find({ cycle_id: cycleId })
      .populate('recorded_by', 'name role')
      .sort({ age_in_days: -1 })
      .lean();
  }
}

module.exports = new DailyLogService();