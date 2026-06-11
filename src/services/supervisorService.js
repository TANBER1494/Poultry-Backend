const User = require('../models/User');
const Farm = require('../models/Farm');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const AppError = require('../utils/AppError');

class SupervisorService {
  /**
   * إنشاء حساب مشرف جديد
   */
  async createSupervisor(data, orgId) {
    const { name, phone, password, farm_id } = data;

    const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
    if (!farm) throw new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403);

    const existingUser = await User.findOne({ phone }).lean();
    if (existingUser) throw new AppError('رقم الهاتف مسجل بالفعل في النظام', 400);

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    return await User.create({
      organization_id: orgId,
      farm_id,
      name: name.trim(),
      role: 'SUPERVISOR',
      phone: phone.trim(),
      password_hash,
      status: 'ACTIVE'
    });
  }

  /**
   * جلب قائمة المشرفين لمزرعة
   */
  async getSupervisors(farmId, orgId) {
    const farm = await Farm.findOne({ _id: farmId, organization_id: orgId }).lean();
    if (!farm) throw new AppError('المزرعة غير موجودة أو لا تملك صلاحيتها', 403);

    return await User.find({ farm_id: farmId, role: 'SUPERVISOR', deleted_at: null })
      .select('name phone status hiring_date')
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * تعديل بيانات المشرف أو تغيير حالته (إيقاف / تنشيط)
   */
  async updateSupervisor(supervisorId, orgId, updates) {
    const supervisor = await User.findOne({ _id: supervisorId, organization_id: orgId, role: 'SUPERVISOR' });
    if (!supervisor) throw new AppError('المشرف غير موجود', 404);

    if (updates.name) supervisor.name = updates.name.trim();
    if (updates.phone) {
      const existingUser = await User.findOne({ phone: updates.phone, _id: { $ne: supervisorId } }).lean();
      if (existingUser) throw new AppError('رقم الهاتف الجديد مستخدم بالفعل لحساب آخر', 400);
      supervisor.phone = updates.phone.trim();
    }
    
    if (updates.status && ['ACTIVE', 'SUSPENDED'].includes(updates.status)) {
      supervisor.status = updates.status;
      // 🛡️ ترقية أمنية: إذا تم إيقاف المشرف، نقتل جلسته الحالية فوراً لطرده من النظام
      if (updates.status === 'SUSPENDED') {
        supervisor.current_session_id = crypto.randomBytes(16).toString('hex');
      }
    }

    if (updates.password) {
      const salt = await bcrypt.genSalt(10);
      supervisor.password_hash = await bcrypt.hash(updates.password, salt);
      // تغيير الباسوورد يقتل الجلسات القديمة أيضاً
      supervisor.current_session_id = crypto.randomBytes(16).toString('hex');
    }

    await supervisor.save();
    return supervisor;
  }

  /**
   * الحذف الناعم (Soft Delete) للمشرف للحفاظ على سجلاته التاريخية
   */
  async deleteSupervisor(supervisorId, orgId) {
    const supervisor = await User.findOneAndUpdate(
      { _id: supervisorId, organization_id: orgId, role: 'SUPERVISOR' },
      { 
        deleted_at: new Date(), 
        status: 'SUSPENDED',
        current_session_id: crypto.randomBytes(16).toString('hex') // طرده فوراً
      },
      { new: true }
    );

    if (!supervisor) throw new AppError('المشرف غير موجود', 404);
    return true;
  }
}

module.exports = new SupervisorService();