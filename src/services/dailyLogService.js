const mongoose = require('mongoose');
const DailyLog = require('../models/DailyLog');
const Cycle = require('../models/Cycle');
const InventoryItem = require('../models/InventoryItem');
const InventoryMovement = require('../models/InventoryMovement');
const AppError = require('../utils/AppError');

class DailyLogService {
  
  //  الدالة الجديدة كلياً: الإدخال المجمع (Bulk Entry)
  async createBulkDailyLogs(logsArray, userId, farmId, orgId) {
    if (!logsArray || !Array.isArray(logsArray) || logsArray.length === 0) {
      throw new AppError('لا توجد بيانات لتسجيلها', 400);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const createdLogs = [];
      let totalDeadAlertCount = 0; // لحساب إجمالي النافق للإشعارات

      // معالجة كل يومية لعنبر بالترتيب
      for (const data of logsArray) {
        const {
          local_id, barn_id, cycle_id, log_date, age_in_days, mortality_count, culled_count,
          feed_item_id, feed_consumed_bags, egg_trays_produced, consumed_medications, notes
        } = data;

        const normalizedLogDate = new Date(log_date);
        normalizedLogDate.setUTCHours(0, 0, 0, 0);

        // تخطي إذا كانت مسجلة مسبقاً
        const existingLog = await DailyLog.findOne({ cycle_id, log_date: normalizedLogDate }).session(session);
        if (existingLog) continue; 

        const cycle = await Cycle.findOne({ _id: cycle_id, organization_id: orgId, status: 'ACTIVE' }).session(session);
        if (!cycle) throw new AppError(`الدورة غير نشطة للعنبر المحدد`, 400);

        const totalDeadBirds = (Number(mortality_count) || 0) + (Number(culled_count) || 0);
        totalDeadAlertCount += totalDeadBirds;

        if (cycle.current_bird_count < totalDeadBirds) {
          throw new AppError(`النافق يتجاوز العدد الحي في عنبر (${cycle.barn_id})`, 400);
        }

        if (totalDeadBirds > 0) {
          cycle.current_bird_count -= totalDeadBirds;
          cycle.total_dead_birds = (cycle.total_dead_birds || 0) + totalDeadBirds;
        }

        // --- 1. معالجة سحب العلف من عهدة العنبر ---
        const bagsCount = Number(feed_consumed_bags) || 0;
        if (feed_item_id && bagsCount > 0) {
          const feedItemMeta = await InventoryItem.findOne({ _id: feed_item_id }).session(session);
          if (!feedItemMeta) throw new AppError('صنف العلف المختار غير موجود', 404);

          const custodyIndex = cycle.feed_custody.findIndex(c => c.item_id.toString() === feed_item_id.toString());
          if (custodyIndex === -1 || cycle.feed_custody[custodyIndex].quantity < bagsCount) {
            throw new AppError(`عفواً، عهدة العلف لا تكفي في العنبر، يرجى صرف عهدة أولاً.`, 400);
          }

          cycle.feed_custody[custodyIndex].quantity -= bagsCount;
          const feedExpense = bagsCount * feedItemMeta.average_unit_cost;
          cycle.total_expenses += feedExpense;

          await InventoryMovement.create([{
            local_id: `${local_id}_FEED_OUT`, organization_id: orgId, farm_id: farmId, item_id: feed_item_id,
            cycle_id: cycle_id, performed_by: userId, movement_type: 'CONSUMPTION', quantity: bagsCount,
            unit_cost_at_time: feedItemMeta.average_unit_cost, total_value: feedExpense, movement_date: normalizedLogDate,
            reference_doc: `استهلاك علف (يومية مجمعة)`
          }], { session });
        }

        // --- 2.  معالجة سحب الأدوية من المخزن الرئيسي مباشرة ---
        const processedMedications = [];
        if (consumed_medications && Array.isArray(consumed_medications)) {
          for (const med of consumed_medications) {
            const medQty = Number(med.quantity) || 0;
            if (!med.item_id || medQty <= 0) continue;

            const invItem = await InventoryItem.findOne({ _id: med.item_id, farm_id: farmId, organization_id: orgId }).session(session);
            if (!invItem) throw new AppError(`الصنف الطبي غير موجود`, 404);
            if (invItem.stock_quantity < medQty) throw new AppError(`الرصيد لا يكفي من (${invItem.name}) في المخزن الرئيسي`, 400);

            // الخصم من المخزن الرئيسي
            invItem.stock_quantity -= medQty;
            await invItem.save({ session });

            const medExpense = medQty * (invItem.average_unit_cost || 0);
            cycle.total_expenses += medExpense; // تحميل التكلفة على الدورة

            await InventoryMovement.create([{
              local_id: `${local_id}_MED_${med.item_id}_${Date.now()}`, organization_id: orgId, farm_id: farmId,
              item_id: med.item_id, cycle_id: cycle_id, performed_by: userId, movement_type: 'CONSUMPTION', quantity: medQty,
              unit_cost_at_time: invItem.average_unit_cost, total_value: medExpense, movement_date: normalizedLogDate,
              reference_doc: `صرف أدوية من المخزن الرئيسي (يومية مجمعة)`
            }], { session });

            processedMedications.push({ item_id: invItem._id, name: invItem.name, quantity: medQty });
          }
        }

        // --- 3. معالجة إنتاج البيض والتسوية الآلية ---
        const physicalEggTrays = Number(egg_trays_produced) || 0;
        const pendingPulls = cycle.pending_egg_pulls || 0;
        const totalEggTraysProduced = physicalEggTrays + pendingPulls;

        if (pendingPulls > 0) cycle.pending_egg_pulls = 0;
        await cycle.save({ session });

        if (physicalEggTrays > 0) {
          let eggItem = await InventoryItem.findOne({ farm_id: farmId, category: 'PRODUCT', unit: 'TRAY' }).session(session);
          if (!eggItem) {
            const [newEggItem] = await InventoryItem.create([{
              organization_id: orgId, farm_id: farmId, name: 'بيض مائدة (إنتاج المزرعة)',
              category: 'PRODUCT', unit: 'TRAY', stock_quantity: 0, average_unit_cost: 0,
            }], { session });
            eggItem = newEggItem;
          }

          eggItem.stock_quantity += physicalEggTrays;
          await eggItem.save({ session });

          await InventoryMovement.create([{
            local_id: `${local_id}_EGG_IN`, organization_id: orgId, farm_id: farmId, item_id: eggItem._id,
            cycle_id: cycle_id, performed_by: userId, movement_type: 'PRODUCTION', quantity: physicalEggTrays,
            unit_cost_at_time: 0, total_value: 0, movement_date: normalizedLogDate,
            reference_doc: `إنتاج بيض (يومية مجمعة)`
          }], { session });
        }

        // --- 4. إنشاء سجل اليومية ---
        let finalNotes = notes ? notes.trim() : '';
        if (pendingPulls > 0) finalNotes += ` [تسوية: +${pendingPulls} طبق سلفة]`;

        const [newLog] = await DailyLog.create([{
          local_id, organization_id: orgId, farm_id: farmId, barn_id, cycle_id, recorded_by: userId,
          log_date: normalizedLogDate, age_in_days, mortality_count: Number(mortality_count) || 0,
          feed_consumed_bags: bagsCount, egg_trays_produced: totalEggTraysProduced,
          consumed_medications: processedMedications, notes: finalNotes
        }], { session });

        createdLogs.push(newLog);
      }

      await session.commitTransaction();
      return { logs: createdLogs, totalDeadAlertCount };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async getLogsByCycle(cycleId, farmId, orgId) {
    const cycle = await Cycle.findOne({ _id: cycleId, farm_id: farmId, organization_id: orgId }).lean();
    if (!cycle) throw new AppError('الدورة غير موجودة أو غير مصرح لك بالوصول إليها', 403);

    return await DailyLog.find({ cycle_id: cycleId })
      .populate('recorded_by', 'name role')
      .populate('consumed_medications.item_id', 'name unit')
      .sort({ log_date: -1 })
      .lean();
  }
}

module.exports = new DailyLogService();