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

  if (!farm_id || !name || !barn_type || !capacity) {
    return next(new AppError('البيانات الأساسية للعنبر (المزرعة، الاسم، النوع، السعة) مطلوبة', 400));
  }

  // Verify farm ownership before creating the barn
  const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403));
  }

  // Check for duplicate barn name within the same farm
  const existingBarn = await Barn.findOne({ farm_id, name: name.trim(), deleted_at: null }).lean();
  if (existingBarn) {
    return next(new AppError('يوجد عنبر بهذا الاسم بالفعل داخل هذه المزرعة', 400));
  }

  const newBarn = await Barn.create({
    organization_id: orgId, // Added for denormalization and query optimization
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

  // Single optimized query leveraging the denormalized organization_id
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
  
  // Single query for fetching and ownership validation
  const barn = await Barn.findOne({ _id: id, organization_id: orgId });
  if (!barn || barn.deleted_at !== null) {
    return next(new AppError('العنبر غير موجود أو لا تملك صلاحية تعديله', 404));
  }

  // Prevent changing barn type if historical production cycles exist
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
 * @desc    Permanently delete a barn
 * @route   DELETE /api/barns/:id
 * @access  Private
 */
const deleteBarn = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const orgId = req.user.organization_id;
  
  // Single query for fetching and ownership validation
  const barn = await Barn.findOne({ _id: id, organization_id: orgId });
  if (!barn) {
    return next(new AppError('العنبر غير موجود أو لا تملك صلاحية حذفه', 404));
  }

  // Referential Integrity Check
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