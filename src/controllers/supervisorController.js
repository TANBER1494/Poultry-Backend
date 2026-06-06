const User = require('../models/User');
const Farm = require('../models/Farm');
const bcrypt = require('bcryptjs');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 1. إضافة مشرف جديد للمزرعة (صلاحية المالك)
// ==========================================
const addSupervisor = asyncHandler(async (req, res, next) => {
  const { name, phone, password, farm_id } = req.body;
  const orgId = req.user.organization_id;

  if (!name || !phone || !password || !farm_id) {
    return next(new AppError('جميع بيانات المشرف مطلوبة (الاسم، الهاتف، كلمة المرور، المزرعة)', 400));
  }

  // التحقق من ملكية المزرعة
  const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
  if (!farm) return next(new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403));

  const existingUser = await User.findOne({ phone }).lean();
  if (existingUser) return next(new AppError('رقم الهاتف مسجل بالفعل في النظام', 400));

  const salt = await bcrypt.genSalt(10);
  const password_hash = await bcrypt.hash(password, salt);

  const newSupervisor = await User.create({
    organization_id: orgId,
    farm_id,
    name: name.trim(),
    role: 'SUPERVISOR',
    phone: phone.trim(),
    password_hash,
    status: 'ACTIVE'
  });

  res.status(201).json({
    message: 'تم إضافة حساب المشرف بنجاح، يمكنه الآن تسجيل الدخول',
    supervisor: { id: newSupervisor._id, name: newSupervisor.name, phone: newSupervisor.phone }
  });
});

// ==========================================
// 2. جلب مشرفي المزرعة
// ==========================================
const getSupervisors = asyncHandler(async (req, res, next) => {
  const { farm_id } = req.params;
  const orgId = req.user.organization_id;

  const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
  if (!farm) return next(new AppError('المزرعة غير موجودة', 403));

  const supervisors = await User.find({ farm_id, role: 'SUPERVISOR', deleted_at: null })
    .select('name phone status hiring_date')
    .sort({ createdAt: -1 }).lean();

  res.status(200).json({ count: supervisors.length, supervisors });
});

module.exports = { addSupervisor, getSupervisors };