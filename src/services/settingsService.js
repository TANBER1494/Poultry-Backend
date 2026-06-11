const User = require('../models/User');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const AppError = require('../utils/AppError');

class SettingsService {
  /**
   * جلب تفضيلات المستخدم
   */
  async getSettings(userId) {
    const user = await User.findById(userId).select('phone is_dark_mode notifications').lean();
    if (!user) throw new AppError('المستخدم غير موجود', 404);
    return user;
  }

  /**
   * تحديث رقم الهاتف مع التحقق من صحته وعدم تكراره
   */
  async updatePhone(userId, newPhone) {
    if (!newPhone || !/^01[0125][0-9]{8}$/.test(newPhone)) {
      throw new AppError('رقم الهاتف الجديد غير صحيح أو غير مطابق للمواصفات', 400);
    }

    const user = await User.findById(userId);
    if (!user) throw new AppError('المستخدم غير موجود', 404);

    if (user.phone === newPhone) {
      return { isSame: true, phone: user.phone };
    }

    const existingUser = await User.exists({ phone: newPhone });
    if (existingUser) {
      throw new AppError('هذا الرقم مسجل بحساب آخر في النظام', 400);
    }

    user.phone = newPhone;
    await user.save();
    return { isSame: false, phone: user.phone };
  }

  /**
   * تحديث كلمة المرور مع تفعيل الـ Kill Switch الأمني
   */
  async updatePassword(userId, currentPassword, newPassword) {
    if (newPassword.length < 6) {
      throw new AppError('يجب أن تتكون كلمة المرور من 6 أحرف كحد أدنى', 400);
    }

    const user = await User.findById(userId).select('+password_hash');
    if (!user) throw new AppError('المستخدم غير موجود', 404);

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      throw new AppError('كلمة المرور الحالية غير صحيحة', 401);
    }

    const salt = await bcrypt.genSalt(10);
    user.password_hash = await bcrypt.hash(newPassword, salt);
    
    // 🛡️ الترقية الأمنية: تفعيل الـ Kill Switch لتسجيل خروج جميع الأجهزة المتصلة
    user.current_session_id = crypto.randomBytes(16).toString('hex');
    
    await user.save();
    return user;
  }

  /**
   * تحديث التفضيلات (المظهر والإشعارات)
   */
  async updatePreferences(userId, data) {
    const { is_dark_mode, notifications } = data;
    const user = await User.findById(userId);
    if (!user) throw new AppError('المستخدم غير موجود', 404);

    if (is_dark_mode !== undefined) {
      user.is_dark_mode = is_dark_mode;
    }

    if (notifications && typeof notifications === 'object') {
      user.notifications = { ...user.notifications, ...notifications };
    }

    await user.save();
    return user;
  }
}

module.exports = new SettingsService();