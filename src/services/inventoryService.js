const mongoose = require('mongoose');
const InventoryItem = require('../models/InventoryItem');
const InventoryMovement = require('../models/InventoryMovement');
const Cycle = require('../models/Cycle');
const Farm = require('../models/Farm');
const AppError = require('../utils/AppError');

class InventoryService {
  /**
   * تسجيل حركة مخزنية مع حساب متوسط التكلفة المرجح وتأمين المعاملات
   * @param {Object} data - بيانات الحركة المخزنية
   * @param {String} userId - معرف المستخدم الذي قام بالعملية
   * @param {String} orgId - معرف المؤسسة للتحقق من الصلاحيات
   * @returns {Promise<Object>} - الحركة المخزنية المسجلة
   */
  async recordMovement(data, userId, orgId) {
    const { 
      local_id, farm_id, item_id, movement_type, 
      quantity, unit_cost_at_time, movement_date, 
      cycle_id, source_farm_id, reference_doc 
    } = data;

    // التحقق من ملكية المؤسسة للمزرعة لسد ثغرة IDOR
    const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
    if (!farm) {
      throw new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403);
    }

    const existingMovement = await InventoryMovement.findOne({ local_id }).lean();
    if (existingMovement) {
      return { isDuplicate: true, movement: existingMovement };
    }

    const numericQuantity = Number(quantity);
    const numericCost = Number(unit_cost_at_time);
    const totalValue = numericQuantity * numericCost;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const item = await InventoryItem.findOne({ _id: item_id, farm_id }).session(session);
      if (!item) {
        throw new AppError('الصنف غير موجود في مخزن هذه المزرعة', 404);
      }

      let newStockQuantity = item.stock_quantity;
      
      // تطبيق القواعد المحاسبية بناءً على نوع التوجيه المخزني
      if (['PURCHASE', 'TRANSFER_IN', 'PRODUCTION', 'RETURN'].includes(movement_type)) {
        newStockQuantity += numericQuantity;
        
        // حساب متوسط التكلفة المرجح اللحظي
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

      // معالجة التكاليف التشغيلية إن وجدت
      if (movement_type === 'CONSUMPTION' && cycle_id) {
        const cycle = await Cycle.findOne({ _id: cycle_id, farm_id }).session(session);
        if (!cycle || cycle.status !== 'ACTIVE') {
          throw new AppError('الدورة المحددة للاستهلاك غير موجودة أو مغلقة', 404);
        }
        cycle.total_expenses += totalValue;
        await cycle.save({ session });
      }

      const [movement] = await InventoryMovement.create([{
        local_id,
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