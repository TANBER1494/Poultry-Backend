const Barn = require('../models/Barn');
const Farm = require('../models/Farm');
const Cycle = require('../models/Cycle');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 1. إضافة عنبر جديد
// ==========================================
const addBarn = asyncHandler(async (req, res, next) => {
  const { farm_id, name, barn_type, capacity } = req.body;
  const orgId = req.user.organization_id;

  if (!farm_id || !name || !barn_type || !capacity) {
    return next(new AppError('البيانات الأساسية للعنبر (المزرعة، الاسم، النوع، السعة) مطلوبة', 400));
  }

  // 🛡️ حاجز أمني: التحقق من ملكية المزرعة
  const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403));
  }

  // 🛡️ حاجز أمني: منع التكرار
  const existingBarn = await Barn.findOne({ farm_id, name: name.trim(), deleted_at: null }).lean();
  if (existingBarn) {
    return next(new AppError('يوجد عنبر بهذا الاسم بالفعل داخل هذه المزرعة', 400));
  }

  const newBarn = await Barn.create({
    farm_id,
    name: name.trim(),
    barn_type,
    capacity: Number(capacity)
  });

  res.status(201).json({ 
    message: 'تم إنشاء العنبر بنجاح وجاهز لاستقبال دورات الإنتاج', 
    barn: newBarn 
  });
});

// ==========================================
// 2. جلب جميع العنابر لمزرعة معينة
// ==========================================
const getFarmBarns = asyncHandler(async (req, res, next) => {
  const { farm_id } = req.params;
  const orgId = req.user.organization_id;

  // 🛡️ حاجز أمني: منع الوصول لبيانات مزارع الغير
  const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403));
  }

  const barns = await Barn.find({ farm_id, deleted_at: null })
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ count: barns.length, barns });
});

// ==========================================
// 3. تعديل بيانات العنبر
// ==========================================
const updateBarn = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, barn_type, capacity, status } = req.body;
  const orgId = req.user.organization_id;
  
  const barn = await Barn.findById(id);
  if (!barn || barn.deleted_at !== null) {
    return next(new AppError('العنبر غير موجود', 404));
  }

  // 🛡️ حاجز أمني: التحقق من الملكية
  const farm = await Farm.findOne({ _id: barn.farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('لا تملك صلاحية التعديل على هذا العنبر', 403));
  }

  // 🛡️ حاجز أمني صارم: منع تغيير نوع العنبر إذا كان هناك ارتباطات مالية أو تشغيلية
  if (barn_type && barn_type !== barn.barn_type) {
    const hasCycles = await Cycle.exists({ barn_id: id });
    if (hasCycles) {
      return next(new AppError('إجراء مرفوض تقنياً: لا يمكن تغيير نوع العنبر لوجود دورات إنتاج مسجلة عليه تاريخياً. قم بإنشاء عنبر جديد.', 400));
    }
    barn.barn_type = barn_type;
  }

  if (name) barn.name = name.trim();
  if (capacity) barn.capacity = Number(capacity);
  if (status) barn.status = status;

  await barn.save();
  res.status(200).json({ message: 'تم تحديث بيانات العنبر بنجاح', barn });
});

// ==========================================
// 4. الحذف النهائي للعنبر (مع حماية القيود المرجعية)
// ==========================================
const deleteBarn = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const orgId = req.user.organization_id;
  
  const barn = await Barn.findById(id);
  if (!barn) {
    return next(new AppError('العنبر غير موجود', 404));
  }

  // 🛡️ حاجز أمني: التحقق من الملكية
  const farm = await Farm.findOne({ _id: barn.farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('لا تملك صلاحية حذف هذا العنبر', 403));
  }

  // 🛡️ حاجز أمني لحماية التكامل المرجعي (Referential Integrity)
  const hasCycles = await Cycle.exists({ barn_id: id });
  if (hasCycles) {
     return next(new AppError('إجراء مرفوض: لا يمكن حذف العنبر نهائياً لوجود دورات إنتاج وحسابات مرتبطة به. يرجى تغيير حالته إلى (مغلق/INACTIVE) بدلاً من الحذف.', 400));
  }

  await Barn.findByIdAndDelete(id);
  res.status(200).json({ message: 'تم حذف العنبر من النظام بشكل آمن' });
});

module.exports = { 
  addBarn, 
  getFarmBarns, 
  updateBarn, 
  deleteBarn 
};