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
      local_id,
      barn_id,
      cycle_id,
      log_date,
      age_in_days,
      mortality_count,
      culled_count,
      feed_item_id,
      feed_consumed_bags,
      feed_consumed_kg,
      water_consumed_liters,
      egg_trays_produced,
      loose_eggs_produced,
      broken_eggs,
      average_weight_grams,
      medications_given,
      notes,
    } = data;

    // 1: توحيد صيغة التاريخ لمنع ثغرة تخطي الفهرس الفريد
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

    // 2: جلب بيانات العلف قبل الـ Transaction للتحقق
    if (feed_item_id && (bagsCount > 0 || kgCount > 0)) {
      feedItemMeta = await InventoryItem.findOne({
        _id: feed_item_id,
        farm_id: farmId,
      }).lean();
      if (!feedItemMeta) throw new AppError('صنف العلف المختار غير موجود', 404);

      quantityToDeduct = feedItemMeta.unit === 'BAG' ? bagsCount : kgCount;
      feedExpense = quantityToDeduct * feedItemMeta.average_unit_cost;
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      //  جلب الدورة للتحقق منها وتحديث إحصائياتها
      const cycle = await Cycle.findOne({
        _id: cycle_id,
        organization_id: orgId,
        status: 'ACTIVE',
      }).session(session);

      if (!cycle) {
        throw new AppError('الدورة غير موجودة أو مغلقة', 400);
      }

      if (cycle.current_bird_count < totalDeadBirds) {
        throw new AppError('عدد النافق يتجاوز الطيور الحية المتبقية في العنبر', 400);
      }

      // 3: تحديث الرصيد الحي والمصروفات والنافق في الدورة
      if (totalDeadBirds > 0) {
        cycle.current_bird_count -= totalDeadBirds;
        cycle.total_dead_birds = (cycle.total_dead_birds || 0) + totalDeadBirds;
      }
      if (feedExpense > 0) {
        cycle.total_expenses += feedExpense;
      }

      // 4: التعامل مع عهدة العلف وتسجيل الاستهلاك
      if (feedItemMeta && quantityToDeduct > 0) {
        const custodyIndex = cycle.feed_custody.findIndex(
          (c) => c.item_id.toString() === feed_item_id.toString()
        );

        if (custodyIndex === -1 || cycle.feed_custody[custodyIndex].quantity < quantityToDeduct) {
          throw new AppError(
            `عفواً، عهدة العنبر من هذا العلف لا تكفي للاستهلاك. المتاح في العهدة: ${
              custodyIndex > -1 ? cycle.feed_custody[custodyIndex].quantity : 0
            }، يرجى صرف عهدة من المخزن الرئيسي أولاً.`,
            400
          );
        }

        cycle.feed_custody[custodyIndex].quantity -= quantityToDeduct;

        await InventoryMovement.create(
          [
            {
              local_id: `${local_id}_FEED_OUT`,
              organization_id: orgId, farm_id: farmId, item_id: feed_item_id, cycle_id: cycle_id,
              performed_by: userId, movement_type: 'CONSUMPTION', quantity: quantityToDeduct,
              unit_cost_at_time: feedItemMeta.average_unit_cost, total_value: feedExpense,
              movement_date: normalizedLogDate,
              reference_doc: `استهلاك من عهدة العنبر (يومية عمر ${age_in_days} يوم)`,
            },
          ],
          { session }
        );
      }

      // ==========================================
      //  5: نظام التسوية الذكي لإنتاج البيض (Smart Reconciliation)
      // ==========================================
      const physicalEggTrays = Number(egg_trays_produced) || 0; // ما يراه المشرف بعينه
      const pendingPulls = cycle.pending_egg_pulls || 0; // السلف المسحوبة صباحاً للفواتير
      const totalEggTraysProduced = physicalEggTrays + pendingPulls; // الإجمالي الحقيقي للإنتاج

      // تصفير السلفة من الدورة لأننا سنسويها الآن
      if (pendingPulls > 0) {
        cycle.pending_egg_pulls = 0;
      }

      // حفظ الدورة بجميع التحديثات (نافق، علف، تصفير سلفة) بضربة واحدة
      await cycle.save({ session });

      // 6: إدخال البيض المُنتج (الفعلي فقط) إلى المخزن
      if (physicalEggTrays > 0) {
        let eggItem = await InventoryItem.findOne({
          farm_id: farmId, category: 'PRODUCT', unit: 'TRAY',
        }).session(session);

        if (!eggItem) {
          const [newEggItem] = await InventoryItem.create([{
            organization_id: orgId, farm_id: farmId, name: 'بيض مائدة (إنتاج المزرعة)',
            category: 'PRODUCT', unit: 'TRAY', stock_quantity: 0, average_unit_cost: 0,
          }], { session });
          eggItem = newEggItem;
        }

        eggItem.stock_quantity += physicalEggTrays;
        await eggItem.save({ session });

        await InventoryMovement.create(
          [{
            local_id: `${local_id}_EGG_IN`,
            organization_id: orgId, farm_id: farmId, item_id: eggItem._id, cycle_id: cycle_id,
            performed_by: userId, movement_type: 'PRODUCTION', quantity: physicalEggTrays,
            unit_cost_at_time: 0, total_value: 0, movement_date: normalizedLogDate,
            reference_doc: `إنتاج يومية عنبر (${age_in_days} يوم) - توريد للمخزن`,
          }],
          { session }
        );
      }

      // تجهيز ملاحظة التسوية الأوتوماتيكية
      let finalNotes = notes ? notes.trim() : '';
      if (pendingPulls > 0) {
        const pullNote = `⚠️ (تسوية آلية): تم إضافة ${pendingPulls} طبق للإنتاج، كانت قد سُحبت مسبقاً لمبيعات اليوم.`;
        finalNotes = finalNotes ? `${finalNotes} | ${pullNote}` : pullNote;
      }

      // 7: تسجيل اليومية بالإنتاج الإجمالي
      const [newLog] = await DailyLog.create(
        [{
            local_id, organization_id: orgId, farm_id: farmId, barn_id, cycle_id,
            recorded_by: userId, log_date: normalizedLogDate, age_in_days,
            mortality_count: Number(mortality_count) || 0, culled_count: Number(culled_count) || 0,
            feed_consumed_bags: bagsCount, feed_consumed_kg: kgCount,
            water_consumed_liters: Number(water_consumed_liters) || 0,
            
            egg_trays_produced: totalEggTraysProduced, 
            loose_eggs_produced: Number(loose_eggs_produced) || 0,
            broken_eggs: Number(broken_eggs) || 0,
            average_weight_grams: average_weight_grams ? Number(average_weight_grams) : null,
            medications_given: medications_given ? medications_given.trim() : '',
            notes: finalNotes, //
        }],
        { session }
      );

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
    const cycle = await Cycle.findOne({
      _id: cycleId,
      farm_id: farmId,
      organization_id: orgId,
    }).lean();
    if (!cycle)
      throw new AppError('الدورة غير موجودة أو غير مصرح لك بالوصول إليها', 403);

    return await DailyLog.find({ cycle_id: cycleId })
      .populate('recorded_by', 'name role')
      .sort({ log_date: -1 })
      .lean();
  }
}

module.exports = new DailyLogService();