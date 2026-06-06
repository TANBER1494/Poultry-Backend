const Farm = require('../models/Farm');
const Barn = require('../models/Barn');
const Cycle = require('../models/Cycle');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// وظائف مساعدة (Utility Functions)
// ==========================================

/*
 * حساب الأيام المتبقية لاشتراك المزرعة
 */
const calculateDaysLeft = (targetDate) => {
  if (!targetDate) return 0;
  const diffInDays = Math.ceil((new Date(targetDate) - new Date()) / (1000 * 60 * 60 * 24));
  return diffInDays > 0 ? diffInDays : 0;
};

// ==========================================
// إدارة المزارع (Farm Management)
// ==========================================

/*
 * إضافة مزرعة جديدة للمؤسسة
 */
const addFarm = asyncHandler(async (req, res, next) => {
  const { name, location, farm_type, max_capacity, has_feed_mill } = req.body;
  const orgId = req.user.organization_id;

  if (!name || !location || !farm_type || !max_capacity) {
    return next(new AppError('البيانات الأساسية للمزرعة (الاسم، الموقع، النوع، السعة) مطلوبة', 400));
  }

  const existingFarm = await Farm.findOne({ organization_id: orgId, name: name.trim() }).lean();
  if (existingFarm) {
    return next(new AppError('يوجد مزرعة بهذا الاسم بالفعل مسجلة في النظام', 400));
  }

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 14);

  const newFarm = await Farm.create({
    organization_id: orgId,
    name: name.trim(),
    location: location.trim(),
    farm_type: farm_type,
    max_capacity: Number(max_capacity),
    has_feed_mill: has_feed_mill || false,
    subscription_status: 'TRIAL',
    monthly_fee: 0,
    trial_ends_at: trialEndsAt
  });

  res.status(201).json({
    message: 'تم تسجيل المزرعة وتفعيل الفترة التجريبية بنجاح',
    farm: newFarm
  });
});

/*
 * جلب جميع مزارع المؤسسة
 */
const getFarms = asyncHandler(async (req, res, next) => {
  const farmsRaw = await Farm.find({ organization_id: req.user.organization_id })
    .sort({ createdAt: -1 })
    .lean();

  const farms = farmsRaw.map(farm => {
    const targetDate = farm.subscription_status === 'TRIAL' ? farm.trial_ends_at : farm.subscription_ends_at;
    return {
      ...farm,
      status: farm.subscription_status,
      days_left: calculateDaysLeft(targetDate)
    };
  });

  res.status(200).json({ count: farms.length, farms });
});

/*
 * تعديل البيانات الأساسية للمزرعة
 */
const updateFarmSettings = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, location, farm_type, max_capacity, has_feed_mill } = req.body;

  const farm = await Farm.findOne({ _id: id, organization_id: req.user.organization_id });
  if (!farm) {
    return next(new AppError('المزرعة غير موجودة أو لا تملك صلاحية التعديل عليها', 404));
  }

  if (name) farm.name = name.trim();
  if (location) farm.location = location.trim();
  if (farm_type) farm.farm_type = farm_type;
  if (max_capacity !== undefined) farm.max_capacity = Number(max_capacity);
  if (has_feed_mill !== undefined) farm.has_feed_mill = Boolean(has_feed_mill);

  await farm.save();
  res.status(200).json({ message: 'تم تحديث بيانات المزرعة بنجاح', farm });
});

/*
 * إيقاف المزرعة (تعليق الحساب)
 */
const suspendFarm = asyncHandler(async (req, res, next) => {
  const farm = await Farm.findOneAndUpdate(
    { _id: req.params.id, organization_id: req.user.organization_id },
    { subscription_status: 'LOCKED' },
    { new: true }
  );

  if (!farm) {
    return next(new AppError('المزرعة غير موجودة', 404));
  }
  res.status(200).json({ message: 'تم إيقاف المزرعة بنجاح' });
});

/*
 * إعادة تنشيط المزرعة
 */
const reactivateFarm = asyncHandler(async (req, res, next) => {
  const farm = await Farm.findOne({ _id: req.params.id, organization_id: req.user.organization_id });
  if (!farm) {
    return next(new AppError('المزرعة غير موجودة', 404));
  }

  farm.subscription_status = (farm.trial_ends_at && farm.trial_ends_at > new Date()) ? 'TRIAL' : 'ACTIVE';
  await farm.save();

  res.status(200).json({ message: 'تم إعادة تنشيط المزرعة بنجاح' });
});

/*
 * الحذف النهائي للمزرعة (مع التحقق من القيود المرجعية)
 */
const hardDeleteFarm = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const orgId = req.user.organization_id;

  // 1. التحقق من وجود عنابر نشطة
  const hasBarns = await Barn.exists({ farm_id: id });
  if (hasBarns) {
    return next(new AppError('لا يمكن حذف المزرعة لوجود عنابر مسجلة بها. يجب حذف العنابر أولاً.', 400));
  }

  // 2. التحقق من وجود دورات مالية أو تشغيلية
  const hasCycles = await Cycle.exists({ farm_id: id });
  if (hasCycles) {
    return next(new AppError('لا يمكن حذف المزرعة لوجود سجلات دورات إنتاج مرتبطة بها.', 400));
  }

  // 3. التحقق من وجود مستخدمين أو مشرفين معلقين بالمزرعة
  const hasUsers = await User.exists({ farm_id: id, deleted_at: null });
  if (hasUsers) {
    return next(new AppError('يجب نقل أو حذف المشرفين المربوطين بهذه المزرعة أولاً.', 400));
  }

  const deletedFarm = await Farm.findOneAndDelete({ _id: id, organization_id: orgId });
  if (!deletedFarm) {
    return next(new AppError('المزرعة غير موجودة', 404));
  }

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