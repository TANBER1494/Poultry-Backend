const mongoose = require('mongoose');
const InventoryItem = require('../models/InventoryItem');
const InventoryMovement = require('../models/InventoryMovement');
const Cycle = require('../models/Cycle');
const Farm = require('../models/Farm');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// إدارة كروت الأصناف (Inventory Items)
// ==========================================

/*
 * إضافة صنف جديد للمخزن (علف، دواء، تحصين)
 */
const addInventoryItem = asyncHandler(async (req, res, next) => {
  const { farm_id, name, category, unit, min_alert_level } = req.body;

  if (!farm_id || !name || !category || !unit) {
    return next(new AppError('البيانات الأساسية للصنف مطلوبة (المزرعة، الاسم، التصنيف، الوحدة)', 400));
  }

  const existingItem = await InventoryItem.findOne({ farm_id, name: name.trim() }).lean();
  if (existingItem) {
    return next(new AppError('هذا الصنف مسجل بالفعل في مخزن المزرعة', 400));
  }

  const newItem = await InventoryItem.create({
    farm_id,
    name: name.trim(),
    category,
    unit,
    min_alert_level: Number(min_alert_level) || 0
  });

  res.status(201).json({
    message: 'تم إضافة الصنف لبطاقة المخازن بنجاح',
    item: newItem
  });
});

/*
 * جلب جميع الأصناف الموجودة في مخزن مزرعة معينة
 */
const getInventoryItems = asyncHandler(async (req, res, next) => {
  const { farm_id } = req.params;

  const items = await InventoryItem.find({ farm_id, deleted_at: null })
    .sort({ category: 1, name: 1 })
    .lean();

  res.status(200).json({ count: items.length, items });
});

// ==========================================
// حركات المخزن (Inventory Movements)
// ==========================================

/*
 * تسجيل حركة مخزنية (وارد، منصرف، إنتاج)
 * هذه الدالة محصنة بمعاملات (ACID Transactions) لضمان عدم ضياع التكلفة
 */
const recordInventoryMovement = asyncHandler(async (req, res, next) => {
  const { 
    local_id, farm_id, item_id, movement_type, 
    quantity, unit_cost_at_time, movement_date, 
    cycle_id, source_farm_id, reference_doc 
  } = req.body;

  if (!local_id || !farm_id || !item_id || !movement_type || !quantity || !unit_cost_at_time || !movement_date) {
    return next(new AppError('البيانات الأساسية للحركة المخزنية غير مكتملة', 400));
  }

  // منع تكرار العملية في وضع الاوفلاين
  const existingMovement = await InventoryMovement.findOne({ local_id }).lean();
  if (existingMovement) {
    return res.status(200).json({ message: 'الحركة مسجلة مسبقاً', movement: existingMovement });
  }

  const numericQuantity = Number(quantity);
  const numericCost = Number(unit_cost_at_time);
  const totalValue = numericQuantity * numericCost;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. التحقق من وجود الصنف في المخزن
    const item = await InventoryItem.findById(item_id).session(session);
    if (!item) {
      throw new AppError('الصنف غير موجود في قاعدة البيانات', 404);
    }

    // 2. تحديث رصيد الصنف بناءً على نوع الحركة
    let newStockQuantity = item.stock_quantity;
    
    if (['PURCHASE', 'TRANSFER_IN', 'PRODUCTION', 'RETURN'].includes(movement_type)) {
      // وارد للمخزن
      newStockQuantity += numericQuantity;
      
      // تحديث متوسط التكلفة المرجح (Weighted Average Cost)
      const currentTotalValue = item.stock_quantity * item.average_unit_cost;
      const newTotalValue = currentTotalValue + totalValue;
      item.average_unit_cost = newStockQuantity > 0 ? (newTotalValue / newStockQuantity) : 0;
      
    } else if (['CONSUMPTION', 'ADJUSTMENT'].includes(movement_type)) {
      // منصرف من المخزن
      if (item.stock_quantity < numericQuantity) {
        throw new AppError(`الرصيد الحالي للصنف (${item.name}) لا يكفي لهذه العملية`, 400);
      }
      newStockQuantity -= numericQuantity;
    }

    item.stock_quantity = newStockQuantity;
    await item.save({ session });

    // 3. تحميل التكلفة على الدورة (في حالة المنصرف للاستهلاك)
    if (movement_type === 'CONSUMPTION' && cycle_id) {
      const cycle = await Cycle.findById(cycle_id).session(session);
      if (!cycle) {
        throw new AppError('الدورة المحددة للاستهلاك غير موجودة', 404);
      }
      cycle.total_expenses += totalValue;
      await cycle.save({ session });
    }

    // 4. تسجيل الحركة في دفتر المخازن
    const [movement] = await InventoryMovement.create([{
      local_id,
      farm_id,
      item_id,
      cycle_id: cycle_id || null,
      performed_by: req.user._id,
      movement_type,
      source_farm_id: source_farm_id || null,
      quantity: numericQuantity,
      unit_cost_at_time: numericCost,
      total_value: totalValue,
      movement_date: new Date(movement_date),
      reference_doc: reference_doc || ''
    }], { session });

    // 5. اعتماد المعاملة
    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'تم تسجيل الحركة وتحديث الأرصدة بنجاح',
      movement
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    // تمرير الخطأ إذا كان من النوع المخصص، وإلا إرسال خطأ عام
    if (error.isOperational) return next(error);
    return next(new AppError('فشل في تسجيل الحركة المخزنية، تم التراجع لحماية البيانات', 500));
  }
});

/*
 * جلب تقرير حركات صنف معين (دفتر الأستاذ للصنف)
 */
const getItemMovements = asyncHandler(async (req, res, next) => {
  const { item_id } = req.params;

  const movements = await InventoryMovement.find({ item_id })
    .populate('performed_by', 'name role')
    .populate('cycle_id', 'name type')
    .sort({ movement_date: -1 })
    .lean();

  res.status(200).json({ count: movements.length, movements });
});

module.exports = { 
  addInventoryItem, 
  getInventoryItems, 
  recordInventoryMovement, 
  getItemMovements 
};