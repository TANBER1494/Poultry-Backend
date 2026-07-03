const Barn = require('../models/Barn');
const Farm = require('../models/Farm');
const Cycle = require('../models/Cycle');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

/**
 * @desc    Create a new barn and associate it with the organization
 * @route   POST /api/barns
 * @access  Private (Owner, Supervisor)
 */
const addBarn = asyncHandler(async (req, res, next) => {
  const { farm_id, name, barn_type, capacity } = req.body;
  const orgId = req.user.organization_id;

  // التحقق من ملكية المزرعة كحاجز أمني أولي
  const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403));
  }

  // تم إزالة الاستعلام البرمجي لمنع التكرار. قاعدة البيانات ستتكفل بالرفض اللحظي.
  const newBarn = await Barn.create({
    organization_id: orgId, // إلزامي للتوافق مع قيود الـ Model
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

/**
 * @desc    Get all active barns for a specific farm
 * @route   GET /api/barns/farm/:farm_id
 * @access  Private
 */
const getFarmBarns = asyncHandler(async (req, res, next) => {
  const { farm_id } = req.params;
  const orgId = req.user.organization_id;

  // استعلام محسن يجلب العنابر النشطة فقط
  const barns = await Barn.find({ farm_id, organization_id: orgId, deleted_at: null })
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ count: barns.length, barns });
});

/**
 * @desc    Update barn details and handle referential integrity
 * @route   PUT /api/barns/:id
 * @access  Private
 */
const updateBarn = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, barn_type, capacity, status } = req.body;
  const orgId = req.user.organization_id;
  
  const barn = await Barn.findOne({ _id: id, organization_id: orgId, deleted_at: null });
  if (!barn) {
    return next(new AppError('العنبر غير موجود أو لا تملك صلاحية تعديله', 404));
  }

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

/**
 * @desc    Delete a barn (Hard Delete if no cycles exist)
 * @route   DELETE /api/barns/:id
 * @access  Private
 */
const deleteBarn = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const orgId = req.user.organization_id;
  
  // 1. البحث عن العنبر
  const barn = await Barn.findOne({ _id: id, organization_id: orgId, deleted_at: null });
  if (!barn) {
    return next(new AppError('العنبر غير موجود أو لا تملك صلاحية حذفه', 404));
  }

  // 2. التحقق مما إذا كان العنبر يحتوي على دورات سابقة أم لا
  const hasCycles = await Cycle.exists({ barn_id: id });

  if (hasCycles) {
    //  مسار الأرشفة (Soft Delete): يوجد تاريخ مالي وعمليات مسجلة
    barn.deleted_at = new Date();
    barn.status = 'INACTIVE';
    // تحرير الاسم: إضافة "مؤرشف" وطابع زمني لفك القيد الفريد والسماح بإنشاء عنبر بنفس الاسم
    barn.name = `${barn.name}_مؤرشف_${Date.now()}`;
    await barn.save();

    return res.status(200).json({ 
      message: 'تم أرشفة العنبر بنجاح للحفاظ على الفواتير والتقارير القديمة. (تم تحرير الاسم لتتمكن من استخدامه لعنبر جديد)' 
    });
  } else {
    //  مسار الحذف النهائي (Hard Delete): العنبر جديد ولم يستخدم قط
    await Barn.deleteOne({ _id: id });
    return res.status(200).json({ 
      message: 'تم حذف العنبر نهائياً لعدم وجود أي دورات أو حسابات مرتبطة به.' 
    });
  }
});

module.exports = { 
  addBarn, 
  getFarmBarns, 
  updateBarn, 
  deleteBarn 
};