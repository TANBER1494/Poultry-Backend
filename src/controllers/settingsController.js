const User = require('../models/User');
const Farm = require('../models/Farm');
const bcrypt = require('bcryptjs');

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 1. جلب جميع الإعدادات والتفضيلات الحالية للمستخدم
// ==========================================
const getSettings = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id)
    .select('phone is_dark_mode notifications')
    .lean();

  if (!user) {
    return next(new AppError('المستخدم غير موجود', 404));
  }

  res.status(200).json({
    phone: user.phone,
    is_dark_mode: user.is_dark_mode,
    notifications: user.notifications,
  });
});

// ==========================================
// 2. تغيير رقم الهاتف الرئيسي للحساب
// ==========================================
const updatePhone = asyncHandler(async (req, res, next) => {
  const { new_phone } = req.body;

  // التحقق من صيغة رقم الهاتف (أرقام مصرية كمثال افتراضي)
  if (!new_phone || !/^01[0125][0-9]{8}$/.test(new_phone)) {
    return next(
      new AppError('رقم الهاتف الجديد غير صحيح أو غير مطابق للمواصفات', 400)
    );
  }

  const user = await User.findById(req.user._id);
  if (user.phone === new_phone) {
    return res
      .status(200)
      .json({
        message: 'تم إدخال رقم الهاتف الحالي للمستخدم',
        phone: user.phone,
      });
  }

  const existingUser = await User.exists({ phone: new_phone });
  if (existingUser) {
    return next(new AppError('هذا الرقم مسجل بحساب آخر في النظام', 400));
  }

  user.phone = new_phone;
  await user.save();

  res
    .status(200)
    .json({ message: 'تم تحديث رقم الهاتف بنجاح', phone: user.phone });
});

// ==========================================
// 3. تغيير كلمة المرور لأغراض الأمان
// ==========================================
const updatePassword = asyncHandler(async (req, res, next) => {
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    return next(new AppError('جميع الحقول الخاصة بكلمة المرور مطلوبة', 400));
  }
  if (new_password !== confirm_password) {
    return next(
      new AppError('كلمة المرور الجديدة غير متطابقة مع حقل التأكيد', 400)
    );
  }
  if (new_password.length < 6) {
    return next(
      new AppError('يجب أن تتكون كلمة المرور من 6 أحرف كحد أدنى', 400)
    );
  }

  const user = await User.findById(req.user._id).select('+password_hash');

  const isMatch = await bcrypt.compare(current_password, user.password_hash);
  if (!isMatch) {
    return next(new AppError('كلمة المرور الحالية غير صحيحة', 401));
  }

  const salt = await bcrypt.genSalt(10);
  user.password_hash = await bcrypt.hash(new_password, salt);
  await user.save();

  res.status(200).json({ message: 'تم تحديث كلمة المرور وحفظها بنجاح' });
});

// ==========================================
// 4. تحديث التفضيلات العامة وإعدادات الإشعارات
// ==========================================
const updatePreferences = asyncHandler(async (req, res, next) => {
  const { is_dark_mode, notifications } = req.body;

  const user = await User.findById(req.user._id);

  if (is_dark_mode !== undefined) {
    user.is_dark_mode = is_dark_mode;
  }

  if (notifications && typeof notifications === 'object') {
    // دمج الإعدادات الجديدة للإشعارات مع الإعدادات الحالية لعدم فقدان البيانات
    user.notifications = { ...user.notifications, ...notifications };
  }

  await user.save();

  res
    .status(200)
    .json({ message: 'تم حفظ تفضيلات العرض وإعدادات الإشعارات بنجاح' });
});

module.exports = {
  getSettings,
  updatePhone,
  updatePassword,
  updatePreferences,
};
