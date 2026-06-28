const User = require('../models/User');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const AppError = require('../utils/AppError');

class SettingsService {
  /**
   * جلب تفضيلات المستخدم
   */
  async getSettings(userId) {
   const user = await User.findOne({ _id: userId, deleted_at: null })
      .select('name phone is_dark_mode notifications') 
      .lean();
    
    if (!user) throw new AppError('المستخدم غير موجود أو تم إيقاف حسابه', 404);
    return user;
  }

  /**
   * تحديث رقم الهاتف مع التحقق من صحته وعدم تكراره
   */
  async updatePhone(userId, newPhone, newName) {
    if (!newPhone || !/^01[0125][0-9]{8}$/.test(newPhone)) {
      throw new AppError('رقم الهاتف الجديد غير صحيح أو غير مطابق للمواصفات', 400);
    }

    const user = await User.findOne({ _id: userId, deleted_at: null });
    if (!user) throw new AppError('المستخدم غير موجود', 404);

    let isSamePhone = user.phone === newPhone;
    let isNameChanged = newName && user.name !== newName.trim();

    if (isSamePhone && !isNameChanged) {
      return { isSame: true, phone: user.phone, name: user.name };
    }

    user.phone = newPhone;
    if (newName) user.name = newName.trim(); // سيتحدث الاسم للمالك فقط

    try {
      await user.save();
      return { isSame: false, phone: user.phone, name: user.name };
    } catch (error) {
      if (error.code === 11000) {
        throw new AppError('هذا الرقم مسجل بحساب آخر نشط في النظام', 400);
      }
      throw error;
    }
  }

  /**
   * تحديث كلمة المرور مع تفعيل الـ Kill Switch الأمني
   */
  async updatePassword(userId, currentPassword, newPassword) {
    if (newPassword.length < 6) {
      throw new AppError('يجب أن تتكون كلمة المرور من 6 أحرف كحد أدنى', 400);
    }

    const user = await User.findOne({ _id: userId, deleted_at: null }).select('+password_hash');
    if (!user) throw new AppError('المستخدم غير موجود', 404);

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      throw new AppError('كلمة المرور الحالية غير صحيحة', 401);
    }

    const salt = await bcrypt.genSalt(10);
    user.password_hash = await bcrypt.hash(newPassword, salt);
    
    //  الـ Kill Switch: تغيير الـ Session ID لتسجيل خروج جميع الأجهزة فوراً
    user.current_session_id = crypto.randomBytes(16).toString('hex');
    
    await user.save();
    return user;
  }

  /**
   * تحديث التفضيلات (المظهر والإشعارات)
   */
  async updatePreferences(userId, data) {
    const { is_dark_mode, notifications } = data;
    const user = await User.findOne({ _id: userId, deleted_at: null });
    
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