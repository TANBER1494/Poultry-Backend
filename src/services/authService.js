const mongoose = require('mongoose');
const User = require('../models/User');
const Organization = require('../models/Organization');
const Farm = require('../models/Farm');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const AppError = require('../utils/AppError');

//  دالة داخلية لتوليد التوكنات (Access & Refresh) مع حقن الـ SessionId
const generateTokens = (id, sessionId) => {
  const accessToken = jwt.sign({ id, sessionId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1h', // توكن قصير الأجل للأمان
  });
  
  const refreshToken = jwt.sign({ id, sessionId }, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d', // توكن طويل الأجل للراحة
  });

  return { accessToken, refreshToken };
};

class AuthService {
  async registerOwner(data) {
    const { name, phone, password, organization_name, farm_name, address } = data;

    const existingUser = await User.findOne({ phone }).lean();
    if (existingUser) throw new AppError('رقم الهاتف مسجل بالفعل في النظام', 400);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const trialDays = Number(process.env.TRIAL_DAYS) || 14;
      const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

      const [organization] = await Organization.create([{
        name: organization_name.trim(),
        owner_name: name.trim(),
        phone: phone.trim(),
        subscription_status: 'TRIAL',
        trial_ends_at: trialEndsAt,
      }], { session });

      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(password, salt);
      const sessionId = crypto.randomBytes(16).toString('hex');

      const [owner] = await User.create([{
        organization_id: organization._id,
        name: name.trim(),
        phone: phone.trim(),
        password_hash,
        role: 'OWNER',
        status: 'ACTIVE',
        current_session_id: sessionId,
      }], { session });

      const [farm] = await Farm.create([{
        organization_id: organization._id,
        name: farm_name.trim(),
        location: address ? address.trim() : 'المقر الرئيسي',
        max_capacity: 5000,
        monthly_fee: 0,
        subscription_status: 'TRIAL',
        trial_ends_at: trialEndsAt,
      }], { session });

      const { accessToken, refreshToken } = generateTokens(owner._id, sessionId);

      await session.commitTransaction();
      session.endSession();

      return {
        owner: { id: owner._id, name: owner.name, phone: owner.phone },
        organization: { id: organization._id, name: organization.name },
        farm: { id: farm._id, name: farm.name },
        accessToken,
        refreshToken
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Registration Transaction Error:', error);
      throw new AppError('فشل تأسيس النظام بسبب خطأ داخلي، تم التراجع عن العملية', 500);
    }
  }

  async login(phone, password) {
    const user = await User.findOne({ phone, deleted_at: null }).select('+password_hash');
    
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new AppError('بيانات الدخول غير صحيحة', 401);
    }

    if (user.status !== 'ACTIVE') {
      throw new AppError('هذا الحساب معطل، يرجى مراجعة الإدارة', 403);
    }

    const sessionId = crypto.randomBytes(16).toString('hex');
    user.current_session_id = sessionId;
    await user.save({ validateBeforeSave: false });

    const { accessToken, refreshToken } = generateTokens(user._id, sessionId);

    return {
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        organization_id: user.organization_id,
        farm_id: user.farm_id || null,
      },
      accessToken,
      refreshToken
    };
  }

  async refreshAuthToken(token) {
    if (!token) throw new AppError('توكن التجديد مفقود', 401);

    try {
      // 1. التحقق من صحة التوكن الطويل
      const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
      
      // 2. جلب المستخدم
      const user = await User.findById(decoded.id);
      if (!user || user.deleted_at || user.status !== 'ACTIVE') {
        throw new AppError('حساب غير صالح', 401);
      }

      // 3. الجدار الناري: التحقق من أن التوكن لم يتم الاستيلاء عليه أو أن الجلسة لم تُقتل
      if (user.current_session_id !== decoded.sessionId) {
        throw new AppError('تم تسجيل الدخول من جهاز آخر. تم إنهاء هذه الجلسة.', 401);
      }

      // 4. توليد توكنات جديدة (Rotating Refresh Tokens لزيادة الأمان)
      const newSessionId = crypto.randomBytes(16).toString('hex');
      user.current_session_id = newSessionId;
      await user.save({ validateBeforeSave: false });

      return generateTokens(user._id, newSessionId);
    } catch (error) {
      throw new AppError('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً', 401);
    }
  }

  async updateFcmToken(userId, fcm_token) {
    await User.findByIdAndUpdate(userId, { fcm_token });
  }
}

module.exports = new AuthService();