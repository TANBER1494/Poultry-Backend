const mongoose = require('mongoose');
const DailyLog = require('../models/DailyLog');
const Cycle = require('../models/Cycle');
const InventoryItem = require('../models/InventoryItem');
const InventoryMovement = require('../models/InventoryMovement');
const AppError = require('../utils/AppError');

class DailyLogService {
  /**
   * @desc إنشاء يومية جديدة بأسلوب آمن (Zero-Waste Transaction)
   */
  async createDailyLog(data, userId, farmId, orgId) {
    const {
      local_id, barn_id, cycle_id, log_date, age_in_days,
      mortality_count, culled_count,
      feed_item_id, feed_consumed_bags, feed_consumed_kg,
      water_consumed_liters, egg_trays_produced, loose_eggs_produced, broken_eggs,
      average_weight_grams, medications_given, notes
    } = data;

    //  التطوير المعماري 1: توحيد صيغة التاريخ لمنع ثغرة تخطي الفهرس الفريد
    const normalizedLogDate = new Date(log_date);
    normalizedLogDate.setUTCHours(0, 0, 0, 0);

    const existingLogByLocalId = await DailyLog.findOne({ local_id }).lean();
    if (existingLogByLocalId) return { isDuplicate: true, log: existingLogByLocalId };

    const totalDeadBirds = (Number(mortality_count) || 0) + (Number(culled_count) || 0);
    const bagsCount = Number(feed_consumed_bags) || 0;
    const kgCount = Number(feed_consumed_kg) || 0;
    
    let feedExpense = 0;
    let quantityToDeduct = 0;
    let feedItemMeta = null;

    //  التطوير المعماري 2: جلب بيانات العلف قبل الـ Transaction (Fail-fast principle)
    if (feed_item_id && (bagsCount > 0 || kgCount > 0)) {
      feedItemMeta = await InventoryItem.findOne({ _id: feed_item_id, farm_id: farmId }).lean();
      if (!feedItemMeta) throw new AppError('صنف العلف المختار غير موجود', 404);

      quantityToDeduct = feedItemMeta.unit === 'BAG' ? bagsCount : kgCount;
      feedExpense = quantityToDeduct * feedItemMeta.average_unit_cost;
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      //  التطوير المعماري 3: تحديث الدورة (خصم النافق + إضافة المصروفات) في استعلام ذري واحد!
      let cycleUpdateQuery = {};
      if (totalDeadBirds > 0) cycleUpdateQuery.$inc = { current_bird_count: -totalDeadBirds };
      if (feedExpense > 0) {
        cycleUpdateQuery.$inc = cycleUpdateQuery.$inc || {};
        cycleUpdateQuery.$inc.total_expenses = feedExpense;
      }

      if (Object.keys(cycleUpdateQuery).length > 0) {
        const cycle = await Cycle.findOneAndUpdate(
          { 
            _id: cycle_id, 
            organization_id: orgId, // أمان إضافي (Multi-tenant check)
            status: 'ACTIVE',
            current_bird_count: { $gte: totalDeadBirds } 
          },
          cycleUpdateQuery,
          { new: true, session }
        );

        if (!cycle) {
          throw new AppError('الدورة غير موجودة، مغلقة، أو أن عدد النافق يتجاوز الطيور الحية المتبقية', 400);
        }
      }

      // التحديث الذري للمخزون (خصم العلف وتسجيل حركته)
      if (feedItemMeta && quantityToDeduct > 0) {
        const updatedFeedItem = await InventoryItem.findOneAndUpdate(
          { 
            _id: feed_item_id, 
            farm_id: farmId,
            stock_quantity: { $gte: quantityToDeduct } 
          },
          { $inc: { stock_quantity: -quantityToDeduct } },
          { new: true, session }
        );

        if (!updatedFeedItem) {
          throw new AppError('رصيد العلف في المخزن لا يكفي لإتمام هذه اليومية', 400);
        }

        //  التطوير المعماري 4: حقن organization_id
        await InventoryMovement.create([{
          local_id: `${local_id}_FEED_OUT`,
          organization_id: orgId, 
          farm_id: farmId,
          item_id: feed_item_id,
          cycle_id: cycle_id,
          performed_by: userId,
          movement_type: 'CONSUMPTION',
          quantity: quantityToDeduct,
          unit_cost_at_time: feedItemMeta.average_unit_cost,
          total_value: feedExpense,
          movement_date: normalizedLogDate,
          reference_doc: `استهلاك يومية عمر ${age_in_days} يوم`
        }], { session });
      }

      //  التطوير المعماري 5: حقن organization_id واستخدام التاريخ الموحد
      const [newLog] = await DailyLog.create([{
        local_id,
        organization_id: orgId,
        farm_id: farmId,
        barn_id,
        cycle_id,
        recorded_by: userId,
        log_date: normalizedLogDate,
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
      if (error.code === 11000) {
        throw new AppError('تم تسجيل يومية لهذه الدورة في هذا التاريخ مسبقاً', 400);
      }
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * @desc جلب اليوميات مع التحقق الصارم من الصلاحيات
   */
  async getLogsByCycle(cycleId, farmId, orgId) {
    const cycle = await Cycle.findOne({ _id: cycleId, farm_id: farmId, organization_id: orgId }).lean();
    if (!cycle) throw new AppError('الدورة غير موجودة أو غير مصرح لك بالوصول إليها', 403);

    return await DailyLog.find({ cycle_id: cycleId })
      .populate('recorded_by', 'name role')
      .sort({ log_date: -1 }) // الترتيب بالتاريخ أفضل وأدق من العمر
      .lean();
  }
}

module.exports = new DailyLogService();