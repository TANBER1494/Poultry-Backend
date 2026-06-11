const InventoryItem = require('../models/InventoryItem');
const InventoryMovement = require('../models/InventoryMovement');
const Farm = require('../models/Farm');
const inventoryService = require('../services/inventoryService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

/**
 * @desc    Create a new inventory item card
 * @route   POST /api/inventory/items
 * @access  Private
 */
const addInventoryItem = asyncHandler(async (req, res, next) => {
  const { farm_id, name, category, unit, min_alert_level } = req.body;
  const orgId = req.user.organization_id;

  if (!farm_id || !name || !category || !unit) {
    return next(new AppError('البيانات الأساسية للصنف مطلوبة (المزرعة، الاسم، التصنيف، الوحدة)', 400));
  }

  // سد ثغرة IDOR
  const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403));
  }

  const existingItem = await InventoryItem.findOne({ farm_id, name: name.trim(), deleted_at: null }).lean();
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

/**
 * @desc    Get all active inventory items for a specific farm
 * @route   GET /api/inventory/items/farm/:farm_id
 * @access  Private
 */
const getInventoryItems = asyncHandler(async (req, res, next) => {
  const { farm_id } = req.params;
  const orgId = req.user.organization_id;

  // سد ثغرة IDOR
  const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403));
  }

  const items = await InventoryItem.find({ farm_id, deleted_at: null })
    .sort({ category: 1, name: 1 })
    .lean();

  res.status(200).json({ count: items.length, items });
});

/**
 * @desc    Record an inventory movement (In/Out/Adjustment)
 * @route   POST /api/inventory/movements
 * @access  Private
 */
const recordInventoryMovement = asyncHandler(async (req, res, next) => {
  const { local_id, farm_id, item_id, movement_type, quantity, unit_cost_at_time, movement_date } = req.body;

  if (!local_id || !farm_id || !item_id || !movement_type || !quantity || !unit_cost_at_time || !movement_date) {
    return next(new AppError('البيانات الأساسية للحركة المخزنية غير مكتملة', 400));
  }

  const result = await inventoryService.recordMovement(req.body, req.user._id, req.user.organization_id);

  if (result.isDuplicate) {
    return res.status(200).json({ message: 'الحركة مسجلة مسبقاً', movement: result.movement });
  }

  res.status(201).json({
    message: 'تم تسجيل الحركة وتحديث الأرصدة بنجاح',
    movement: result.movement
  });
});

/**
 * @desc    Get movement history (Ledger) for a specific item
 * @route   GET /api/inventory/movements/item/:item_id
 * @access  Private
 */
const getItemMovements = asyncHandler(async (req, res, next) => {
  const { item_id } = req.params;
  const orgId = req.user.organization_id;

  // التحقق من أن الصنف يتبع لمزرعة يملكها المستخدم لسد ثغرة IDOR
  const item = await InventoryItem.findById(item_id).lean();
  if (!item) {
    return next(new AppError('الصنف غير موجود', 404));
  }

  const farm = await Farm.findOne({ _id: item.farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('لا تملك صلاحية الوصول لبيانات هذا الصنف', 403));
  }

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