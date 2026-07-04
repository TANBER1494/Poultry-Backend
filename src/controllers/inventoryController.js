const InventoryItem = require('../models/InventoryItem');
const InventoryMovement = require('../models/InventoryMovement');
const Farm = require('../models/Farm');
const inventoryService = require('../services/inventoryService');
const notificationController = require('../controllers/notificationController');
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
    return next(
      new AppError(
        'البيانات الأساسية للصنف مطلوبة (المزرعة، الاسم، التصنيف، الوحدة)',
        400
      )
    );
  }

  const farm = await Farm.findOne({
    _id: farm_id,
    organization_id: orgId,
  }).lean();
  if (!farm) {
    return next(
      new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403)
    );
  }

  try {
    const newItem = await InventoryItem.create({
      organization_id: orgId,
      farm_id,
      name: name.trim(),
      category,
      unit,
      min_alert_level: Number(min_alert_level) || 0,
    });

    res.status(201).json({
      message: 'تم إضافة الصنف لبطاقة المخازن بنجاح',
      item: newItem,
    });
  } catch (error) {
    if (error.code === 11000) {
      return next(new AppError('هذا الصنف مسجل بالفعل في مخزن المزرعة', 400));
    }
    throw error;
  }
});

/**
 * @desc    Get all active inventory items for a specific farm
 * @route   GET /api/inventory/items/farm/:farm_id
 * @access  Private
 */
const getInventoryItems = asyncHandler(async (req, res, next) => {
  const { farm_id } = req.params;
  const orgId = req.user.organization_id;

  const items = await InventoryItem.find({
    farm_id,
    organization_id: orgId,
    deleted_at: null,
  })
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
  const {
    local_id,
    farm_id,
    item_id,
    movement_type,
    quantity,
    unit_cost_at_time,
    movement_date,
  } = req.body;

  if (
    !local_id ||
    !farm_id ||
    !item_id ||
    !movement_type ||
    !quantity ||
    !unit_cost_at_time ||
    !movement_date
  ) {
    return next(
      new AppError('البيانات الأساسية للحركة المخزنية غير مكتملة', 400)
    );
  }

  const result = await inventoryService.recordMovement(
    req.body,
    req.user._id,
    req.user.organization_id
  );

  if (result.isDuplicate) {
    return res
      .status(200)
      .json({ message: 'الحركة مسجلة مسبقاً', movement: result.movement });
  }

  // 2️ إطلاق إشعار للمشرف إذا كان التوريد معلقاً
  if (req.body.status === 'PENDING' && req.user.role === 'OWNER') {
    try {
      //  تم الاستبدال
      await notificationController.sendAppNotification({
        title: '🚚 توريد علف/أصناف في الطريق',
        message: `تم إرسال توريد جديد إلى المزرعة بكمية ${req.body.quantity}. يرجى تأكيد الاستلام فور وصوله.`,
        type: 'FEED_DELIVERY',
        target_role: 'SUPERVISOR',
        organization_id: req.user.organization_id,
        link: '/supervisor/inventory',
      });
    } catch (err) {
      console.error('فشل إرسال إشعار التوريد:', err.message);
    }
  }

  res.status(201).json({
    message:
      req.body.status === 'PENDING'
        ? 'تم تسجيل التوريد وبانتظار تأكيد المشرف'
        : 'تم تسجيل الحركة وتحديث الأرصدة بنجاح',
    movement: result.movement,
  });
});

/**
 * @desc    Confirm pending inventory movement (e.g., feed delivery)
 * @route   PUT /api/inventory/movements/:id/confirm
 * @access  Private (Owner, Supervisor)
 */
const confirmInventoryMovement = asyncHandler(async (req, res, next) => {
  const movement = await inventoryService.confirmMovement(
    req.params.id,
    req.user._id,
    req.user.organization_id
  );

  // 4️ إطلاق إشعار للمالك يفيد بأن المشرف استلم البضاعة وتأكد منها
  try {
    //  تم الاستبدال
    await notificationController.sendAppNotification({
      title: '✅ تأكيد استلام توريد',
      message: `قام المشرف ${req.user.name} بتأكيد استلام التوريد وتم إضافته لرصيد المزرعة بنجاح.`,
      type: 'FEED_CONFIRMED',
      target_role: 'OWNER',
      organization_id: req.user.organization_id,
     link: '/owner/inventory'
    });
  } catch (err) {
    console.error('فشل إرسال إشعار التأكيد:', err.message);
  }

  res.status(200).json({
    message: 'تم تأكيد الاستلام وتحديث رصيد المخزن بنجاح',
    movement,
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

  const item = await InventoryItem.findOne({
    _id: item_id,
    organization_id: orgId,
  }).lean();
  if (!item) {
    return next(
      new AppError('الصنف غير موجود أو لا تملك صلاحية الوصول إليه', 404)
    );
  }

  const movements = await InventoryMovement.find({
    item_id,
    organization_id: orgId,
  })
    .populate('performed_by', 'name role')
    .populate('cycle_id', 'name type')
    .sort({ movement_date: -1 })
    .lean();

  res.status(200).json({ count: movements.length, movements });
});

/**
 * @desc    Update an inventory item
 * @route   PUT /api/inventory/items/:id
 * @access  Private
 */
const updateInventoryItem = asyncHandler(async (req, res, next) => {
  const item = await inventoryService.updateInventoryItem(
    req.params.id,
    req.user.organization_id,
    req.body
  );
  res.status(200).json({ message: 'تم تحديث بيانات الصنف بنجاح', item });
});

/**
 * @desc    Soft delete an inventory item
 * @route   DELETE /api/inventory/items/:id
 * @access  Private
 */
const deleteInventoryItem = asyncHandler(async (req, res, next) => {
  await inventoryService.deleteInventoryItem(
    req.params.id,
    req.user.organization_id
  );
  res.status(200).json({ message: 'تم أرشفة الصنف من المخزن بنجاح' });
});

/**
 * @desc    Transfer feed from main inventory to barn custody
 * @route   POST /api/inventory/transfer-to-barn
 * @access  Private (Owner, Supervisor)
 */
const transferToBarn = asyncHandler(async (req, res, next) => {
  const { local_id, farm_id, cycle_id, item_id, quantity } = req.body;

  if (!local_id || !farm_id || !cycle_id || !item_id || !quantity) {
    return next(new AppError('جميع بيانات صرف العهدة مطلوبة', 400));
  }

  const movement = await inventoryService.transferToBarnCustody(
    req.body,
    req.user._id,
    req.user.organization_id
  );
  res.status(201).json({ message: 'تم صرف العهدة للعنبر بنجاح', movement });
});



/**
 * @desc    Produce feed from local feed mill (with optional direct transfer)
 * @route   POST /api/inventory/produce-feed
 * @access  Private (Supervisor)
 */
const produceFeed = asyncHandler(async (req, res, next) => {
  const { farm_id, item_id, quantity, unit_cost } = req.body;
  
  if (!farm_id || !item_id || !quantity || !unit_cost) {
    return next(new AppError('بيانات الإنتاج غير مكتملة (المزرعة، الصنف، الكمية، التكلفة)', 400));
  }

  const result = await inventoryService.produceFeed(req.body, req.user.organization_id, req.user._id);
  res.status(201).json({ message: req.body.direct_to_barn ? 'تم الإنتاج والتوزيع المباشر للعنبر بنجاح' : 'تم إنتاج العلف وإضافته للمخزن بنجاح', result });
});

module.exports = {
  addInventoryItem,
  getInventoryItems,
  recordInventoryMovement,
  confirmInventoryMovement,
  getItemMovements,
  updateInventoryItem,
  deleteInventoryItem,
  transferToBarn,
  produceFeed,
};