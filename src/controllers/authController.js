const mongoose = require('mongoose');
const User = require('../models/User');
const Organization = require('../models/Organization');
const Farm = require('../models/Farm');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const crypto = require('crypto');

// ==========================================
// 🔐 دالة مساعدة لتوليد التوكن
// ==========================================
const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
};
// ==========================================
// 1. تأسيس النظام (مؤسسة + مالك + مزرعة أولى)
// ==========================================
const registerOwner = asyncHandler(async (req, res, next) => {
  const { name, phone, password, organization_name, farm_name, address } = req.body;

  // التحقق الصارم من الحقول الأساسية
  if (!name || !phone || !password || !organization_name || !farm_name) {
    return next(new AppError('جميع بيانات المالك والمزرعة الأساسية مطلوبة للتأسيس', 400));
  }

  // منع تكرار رقم الهاتف
  const existingUser = await User.findOne({ phone }).lean();
  if (existingUser) {
    return next(new AppError('رقم الهاتف مسجل بالفعل في النظام', 400));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. إنشاء الكيان المؤسسي (مع إضافة الحقول الإجبارية الناقصة)
    const [organization] = await Organization.create(
      [
        {
          name: organization_name.trim(),
          owner_name: name.trim(), // تمت إضافته
          phone: phone.trim(),     // تمت إضافته
          subscription_status: 'TRIAL',
          trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), 
        },
      ],
      { session }
    );

    // 2. تشفير كلمة المرور
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    const sessionId = crypto.randomBytes(16).toString('hex');

    // 3. إنشاء حساب المالك
    const [owner] = await User.create(
      [
        {
          organization_id: organization._id,
          name: name.trim(),
          phone: phone.trim(),
          password_hash,
          role: 'OWNER',
          status: 'ACTIVE',
          current_session_id: sessionId,
        },
      ],
      { session }
    );

    // 4. إنشاء المزرعة الأولى (مع إضافة الحقول الإجبارية الناقصة)
    const [farm] = await Farm.create(
      [
        {
          organization_id: organization._id,
          name: farm_name.trim(),
          location: address ? address.trim() : 'المقر الرئيسي', // مطابقة الحقل مع الموديل
          max_capacity: 5000, // قيمة مبدئية إجبارية للموديل
          monthly_fee: 0,     // قيمة مبدئية إجبارية للموديل
          subscription_status: 'TRIAL',
          trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      ],
      { session }
    );

    // 5. توليد التوكن
    const token = signToken(owner._id);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'تم تأسيس النظام وإنشاء حساب المالك والمزرعة بنجاح',
      token,
      data: {
        owner: { id: owner._id, name: owner.name, phone: owner.phone },
        organization: { id: organization._id, name: organization.name },
        farm: { id: farm._id, name: farm.name },
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    // طباعة الخطأ الفعلي في الكونسول لتسهيل التتبع مستقبلاً
    console.error('Registration Transaction Error:', error); 
    return next(
      new AppError(
        'فشل تأسيس النظام بسبب خطأ في قاعدة البيانات، تم التراجع عن العملية',
        500
      )
    );
  }
});
// ==========================================
// 2. تسجيل الدخول (Login)
// ==========================================
const login = asyncHandler(async (req, res, next) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return next(new AppError('يرجى إدخال رقم الهاتف وكلمة المرور', 400));
  }

  // 🚀 التعديل هنا: إضافة .select('+password_hash') لإجبار Mongoose على جلب الحقل المخفي
  const user = await User.findOne({ phone, deleted_at: null }).select('+password_hash');
  
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return next(new AppError('بيانات الدخول غير صحيحة', 401));
  }

  if (user.status !== 'ACTIVE') {
    return next(new AppError('هذا الحساب معطل، يرجى مراجعة الإدارة', 403));
  }

  // تجديد الجلسة لقتل أي جلسات مفتوحة أخرى (Security Kill Switch)
  user.current_session_id = crypto.randomBytes(16).toString('hex');
  
  // حفظ التعديل بدون المساس بالباسورد المشفر
  await user.save({ validateBeforeSave: false });

  const token = signToken(user._id);

  res.status(200).json({
    message: 'تم تسجيل الدخول بنجاح',
    token,
    user: {
      id: user._id,
      name: user.name,
      role: user.role,
      organization_id: user.organization_id,
      farm_id: user.farm_id || null,
    },
  });
});

// ==========================================
// 3. تحديث توكن الإشعارات (FCM)
// ==========================================
const updateFcmToken = asyncHandler(async (req, res, next) => {
  const { fcm_token } = req.body;
  if (!fcm_token) return next(new AppError('توكن الإشعارات مطلوب', 400));

  await User.findByIdAndUpdate(req.user._id, { fcm_token });
  res.status(200).json({ message: 'تم تحديث توكن الإشعارات بنجاح' });
});

// ==========================================
// 4. تجديد الجلسة (Refresh Token - اختياري)
// ==========================================
const refreshToken = asyncHandler(async (req, res, next) => {
  res
    .status(200)
    .json({
      message:
        'هذه الدالة جاهزة للاستخدام في حال تفعيل الـ Refresh Tokens مستقبلاً',
    });
});

module.exports = {
  registerOwner,
  login,
  updateFcmToken,
  refreshToken,
};
