const farmService = require('../services/farmService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

/**
 * @desc    Add a new farm to the organization
 * @route   POST /api/farms
 * @access  Private (Owner)
 */
const addFarm = asyncHandler(async (req, res, next) => {
  const { name, location } = req.body;

  if (!name || !location) {
    return next(new AppError('البيانات الأساسية للمزرعة (الاسم، الموقع) مطلوبة', 400));
  }

  const newFarm = await farmService.createFarm(req.body, req.user.organization_id);

  res.status(201).json({
    message: 'تم تسجيل المزرعة وتفعيل الفترة التجريبية بنجاح',
    farm: newFarm
  });
});

/**
 * @desc    Get all farms for the current organization
 * @route   GET /api/farms
 * @access  Private (Owner)
 */
const getFarms = asyncHandler(async (req, res, next) => {
  let farms = await farmService.getOrganizationFarms(req.user.organization_id);

  if (req.user.role === 'SUPERVISOR') {
    farms = farms.filter(f => f._id.toString() === req.user.farm_id.toString());
  }

  res.status(200).json({ count: farms.length, farms });
});

/**
 * @desc    Update farm basic details
 * @route   PUT /api/farms/:id
 * @access  Private (Owner)
 */
const updateFarmSettings = asyncHandler(async (req, res, next) => {
  const farm = await farmService.updateFarm(req.params.id, req.user.organization_id, req.body);
  res.status(200).json({ message: 'تم تحديث بيانات المزرعة بنجاح', farm });
});

/**
 * @desc    Suspend a farm (Lock subscription)
 * @route   PUT /api/farms/:id/suspend
 * @access  Private (Owner)
 */
const suspendFarm = asyncHandler(async (req, res, next) => {
  await farmService.changeFarmStatus(req.params.id, req.user.organization_id, 'SUSPEND');
  res.status(200).json({ message: 'تم إيقاف المزرعة بنجاح' });
});

/**
 * @desc    Reactivate a suspended farm
 * @route   PUT /api/farms/:id/reactivate
 * @access  Private (Owner)
 */
const reactivateFarm = asyncHandler(async (req, res, next) => {
  await farmService.changeFarmStatus(req.params.id, req.user.organization_id, 'REACTIVATE');
  res.status(200).json({ message: 'تم إعادة تنشيط المزرعة بنجاح' });
});

/**
 * @desc    Permanently delete a farm
 * @route   DELETE /api/farms/:id
 * @access  Private (Owner)
 */
const hardDeleteFarm = asyncHandler(async (req, res, next) => {
  await farmService.deleteFarm(req.params.id, req.user.organization_id);
  res.status(200).json({ message: 'تم حذف المزرعة نهائياً وبشكل آمن' });
});

module.exports = { 
  addFarm, 
  getFarms, 
  updateFarmSettings, 
  suspendFarm, 
  reactivateFarm, 
  hardDeleteFarm 
};