const mongoose = require('mongoose');
const InventoryItem = require('../models/InventoryItem');
const InventoryMovement = require('../models/InventoryMovement');
const Cycle = require('../models/Cycle');
const Farm = require('../models/Farm');
const AppError = require('../utils/AppError');

class InventoryService {
  async recordMovement(data, userId, orgId) {
    const { 
      local_id, farm_id, item_id, movement_type, 
      quantity, unit_cost_at_time, movement_date, 
      cycle_id, source_farm_id, reference_doc 
    } = data;

    const existingMovement = await InventoryMovement.findOne({ local_id }).lean();
    if (existingMovement) {
      return { isDuplicate: true, movement: existingMovement };
    }

    const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
    if (!farm) {
      throw new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403);
    }

    const numericQuantity = Number(quantity);
    const numericCost = Number(unit_cost_at_time);
    const totalValue = numericQuantity * numericCost;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      //  الترقية المعمارية: أضفنا orgId لضمان الأمان المطلق للمؤسسة أثناء الـ Transaction
      const item = await InventoryItem.findOne({ _id: item_id, farm_id, organization_id: orgId }).session(session);
      if (!item) {
        throw new AppError('الصنف غير موجود في مخزن هذه المزرعة', 404);
      }

      let newStockQuantity = item.stock_quantity;
      
      if (['PURCHASE', 'TRANSFER_IN', 'PRODUCTION', 'RETURN'].includes(movement_type)) {
        newStockQuantity += numericQuantity;
        const currentTotalValue = item.stock_quantity * item.average_unit_cost;
        const newTotalValue = currentTotalValue + totalValue;
        item.average_unit_cost = newStockQuantity > 0 ? (newTotalValue / newStockQuantity) : 0;
        
      } else if (['CONSUMPTION', 'ADJUSTMENT'].includes(movement_type)) {
        if (item.stock_quantity < numericQuantity) {
          throw new AppError(`الرصيد الحالي للصنف (${item.name}) لا يكفي. المتاح: ${item.stock_quantity}`, 400);
        }
        newStockQuantity -= numericQuantity;
      }

      item.stock_quantity = newStockQuantity;
      await item.save({ session });

      //  الترقية المعمارية: استخدام التحديث الذري ($inc) لمنع ثغرات التزامن أثناء الاستهلاك
      if (movement_type === 'CONSUMPTION' && cycle_id) {
        const cycle = await Cycle.findOneAndUpdate(
          { _id: cycle_id, farm_id, organization_id: orgId, status: 'ACTIVE' },
          { $inc: { total_expenses: totalValue } },
          { new: true, session }
        );
        
        if (!cycle) {
          throw new AppError('الدورة المحددة للاستهلاك غير موجودة أو مغلقة', 404);
        }
      }

      //  الترقية المعمارية: تمرير organization_id ليتوافق مع القيود المرجعية الصارمة
      const [movement] = await InventoryMovement.create([{
        local_id,
        organization_id: orgId, 
        farm_id,
        item_id,
        cycle_id: cycle_id || null,
        performed_by: userId,
        movement_type,
        source_farm_id: source_farm_id || null,
        quantity: numericQuantity,
        unit_cost_at_time: numericCost,
        total_value: totalValue,
        movement_date: new Date(movement_date),
        reference_doc: reference_doc ? reference_doc.trim() : ''
      }], { session });

      await session.commitTransaction();
      return { isDuplicate: false, movement };

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}

module.exports = new InventoryService();