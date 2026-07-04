const mongoose = require('mongoose');
const InventoryItem = require('../models/InventoryItem');
const InventoryMovement = require('../models/InventoryMovement');
const Cycle = require('../models/Cycle');
const Farm = require('../models/Farm');
const AppError = require('../utils/AppError');

class InventoryService {
  async recordMovement(data, userId, orgId) {
    const {
      local_id, farm_id, item_id, movement_type, quantity,
      unit_cost_at_time, movement_date, cycle_id, source_farm_id, reference_doc, status,
    } = data;

    const existingMovement = await InventoryMovement.findOne({ local_id }).lean();
    if (existingMovement) return { isDuplicate: true, movement: existingMovement };

    const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
    if (!farm) throw new AppError('المزرعة غير موجودة', 403);

    const numericQuantity = Number(quantity);
    const numericCost = Number(unit_cost_at_time);
    const totalValue = numericQuantity * numericCost;
    const movementStatus = status || 'COMPLETED';

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const item = await InventoryItem.findOne({ _id: item_id, organization_id: orgId }).session(session);
      if (!item) throw new AppError('الصنف غير موجود', 404);

      let currentCost = item.average_unit_cost || 0;
      let currentStock = item.stock_quantity || 0;

      if (movementStatus === 'COMPLETED') {
        if (['TRANSFER_IN', 'PURCHASE', 'PRODUCTION', 'RETURN'].includes(movement_type)) {
          const oldTotalValue = currentStock * currentCost;
          const newTotalValue = oldTotalValue + totalValue;
          currentStock += numericQuantity;
          currentCost = currentStock > 0 ? newTotalValue / currentStock : 0;
        } else if (['CONSUMPTION', 'SALE', 'BARN_TRANSFER'].includes(movement_type)) {
          if (currentStock < numericQuantity) {
            throw new AppError(`رصيد الصنف لا يكفي. المتاح: ${currentStock}`, 400);
          }
          currentStock -= numericQuantity;
        } else if (movement_type === 'ADJUSTMENT') {
          currentStock += numericQuantity;
          if (currentStock < 0) throw new AppError('لا يمكن أن يكون الرصيد بالسالب', 400);
        }

        item.stock_quantity = currentStock;
        item.average_unit_cost = currentCost;
        await item.save({ session });
      }

      const movement = await InventoryMovement.create([{
        local_id, organization_id: orgId, farm_id, item_id, cycle_id,
        performed_by: userId, movement_type, source_farm_id,
        quantity: numericQuantity, unit_cost_at_time: movementStatus === 'COMPLETED' ? currentCost : numericCost,
        total_value: totalValue, movement_date, reference_doc, status: movementStatus
      }], { session });

      await session.commitTransaction();
      session.endSession();
      return { isDuplicate: false, movement: movement[0] };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  async produceFeed(data, orgId, userId) {
    const { farm_id, item_id, quantity, unit_cost, cycle_id, direct_to_barn } = data;

    // 1. تسجيل الإنتاج لدخوله المخزن وحساب التكلفة
    const prodResult = await this.recordMovement({
      local_id: `PROD_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      farm_id, item_id, movement_type: 'PRODUCTION', quantity,
      unit_cost_at_time: unit_cost, movement_date: new Date(), status: 'COMPLETED',
      reference_doc: 'إنتاج محلي (مدشة داخلية)'
    }, userId, orgId);

    // 2. السحب الفوري للعنبر إذا اختار المشرف ذلك (Atomic Operation)
    if (direct_to_barn && cycle_id) {
      await this.recordMovement({
        local_id: `TRANS_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        farm_id, item_id, movement_type: 'BARN_TRANSFER', quantity,
        unit_cost_at_time: unit_cost, movement_date: new Date(), cycle_id, status: 'COMPLETED',
        reference_doc: 'استهلاك فوري من المدشة للعنبر'
      }, userId, orgId);
    }
    return prodResult;
  }

  //  دالة جديدة كلياً: تأكيد استلام التوريد
  async confirmMovement(movementId, userId, orgId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const movement = await InventoryMovement.findOne({
        _id: movementId,
        organization_id: orgId,
        status: 'PENDING',
      }).session(session);
      if (!movement)
        throw new AppError('الحركة غير موجودة أو تم تأكيدها مسبقاً', 404);

      const item = await InventoryItem.findOne({
        _id: movement.item_id,
      }).session(session);

      // إضافة الكمية للمخزن وتحديث متوسط التكلفة
      const newStockQuantity = item.stock_quantity + movement.quantity;
      const currentTotalValue = item.stock_quantity * item.average_unit_cost;
      item.average_unit_cost =
        (currentTotalValue + movement.total_value) / newStockQuantity;
      item.stock_quantity = newStockQuantity;

      await item.save({ session });

      movement.status = 'COMPLETED';
      movement.confirmed_by = userId;
      await movement.save({ session });

      await session.commitTransaction();
      return movement;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   *  صرف عهدة علف من المخزن الرئيسي إلى العنبر (الدورة)
   */
  async transferToBarnCustody(data, userId, orgId) {
    const { local_id, farm_id, cycle_id, item_id, quantity } = data;
    const numericQty = Number(quantity);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1. الخصم من المخزن الرئيسي
      const item = await InventoryItem.findOne({
        _id: item_id,
        farm_id,
        organization_id: orgId,
      }).session(session);
      if (!item || item.stock_quantity < numericQty) {
        throw new AppError(
          `الرصيد في المخزن الرئيسي لا يكفي. المتاح: ${item ? item.stock_quantity : 0}`,
          400
        );
      }
      item.stock_quantity -= numericQty;
      await item.save({ session });

      // 2. الإضافة إلى عهدة العنبر (الدورة)
      const cycle = await Cycle.findOne({
        _id: cycle_id,
        farm_id,
        organization_id: orgId,
        status: 'ACTIVE',
      }).session(session);
      if (!cycle) throw new AppError('الدورة غير موجودة أو مغلقة', 404);

      const custodyIndex = cycle.feed_custody.findIndex(
        (c) => c.item_id.toString() === item_id.toString()
      );
      if (custodyIndex > -1) {
        cycle.feed_custody[custodyIndex].quantity += numericQty;
      } else {
        cycle.feed_custody.push({ item_id, quantity: numericQty });
      }
      await cycle.save({ session });

      // 3. توثيق الحركة المخزنية
      const [movement] = await InventoryMovement.create(
        [
          {
            local_id,
            organization_id: orgId,
            farm_id,
            item_id,
            cycle_id,
            performed_by: userId,
            movement_type: 'BARN_TRANSFER',
            quantity: numericQty,
            unit_cost_at_time: item.average_unit_cost,
            total_value: numericQty * item.average_unit_cost,
            movement_date: new Date(),
            reference_doc: 'صرف عهدة للعنبر',
          },
        ],
        { session }
      );

      await session.commitTransaction();
      return movement;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * تحديث بيانات الصنف المخزني
   */
  async updateInventoryItem(itemId, orgId, updates) {
    // نبحث عن الصنف ونتأكد أنه غير محذوف
    const item = await InventoryItem.findOne({
      _id: itemId,
      organization_id: orgId,
      deleted_at: null,
    });
    if (!item) throw new AppError('الصنف غير موجود أو تم حذفه مسبقاً', 404);

    if (updates.name) item.name = updates.name.trim();
    if (updates.category) item.category = updates.category;
    if (updates.unit) item.unit = updates.unit;
    if (updates.min_alert_level !== undefined)
      item.min_alert_level = Number(updates.min_alert_level);
    if (updates.average_unit_cost !== undefined)
      item.average_unit_cost = Number(updates.average_unit_cost);
    try {
      await item.save();
      return item;
    } catch (error) {
      if (error.code === 11000)
        throw new AppError('هناك صنف آخر مسجل بنفس الاسم في هذه المزرعة', 400);
      throw error;
    }
  }

  /**
   * الحذف الناعم للصنف المخزني (Soft Delete)
   */
  async deleteInventoryItem(itemId, orgId) {
    const item = await InventoryItem.findOne({
      _id: itemId,
      organization_id: orgId,
      deleted_at: null,
    });
    if (!item)
      throw new AppError('الصنف غير موجود أو لا تملك صلاحية حذفه', 404);

    // القاعدة المحاسبية: لا يمكن حذف صنف له حركات مخزنية سابقة، بل نقوم بأرشفته (Soft Delete)
    // حتى لا تتدمر الفواتير وتكلفة الدورات القديمة التي استخدمت هذا الصنف.
    item.deleted_at = new Date();
    await item.save();

    return true;
  }
}

module.exports = new InventoryService();
