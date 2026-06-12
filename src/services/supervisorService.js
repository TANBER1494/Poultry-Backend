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

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    try {
      //  الترقية المعمارية: إزالة الفحص اليدوي والاعتماد على قوة محرك البيانات للتعامل مع الحذف الناعم
      return await User.create({
        organization_id: orgId,
        farm_id,
        name: name.trim(),
        role: 'SUPERVISOR',
        phone: phone.trim(),
        password_hash,
        status: 'ACTIVE'
      });
    } catch (error) {
      if (error.code === 11000) {
        throw new AppError('رقم الهاتف مسجل بالفعل لمشرف أو مستخدم نشط في النظام', 400);
      }
      throw error;
    }
  }

  /**
   * جلب قائمة المشرفين لمزرعة
   */
  async getSupervisors(farmId, orgId) {
    const farm = await Farm.findOne({ _id: farmId, organization_id: orgId }).lean();
    if (!farm) throw new AppError('المزرعة غير موجودة أو لا تملك صلاحيتها', 403);

    //  الترقية المعمارية: تضمين orgId في الاستعلام كطبقة حماية إضافية (Defense in Depth)
    return await User.find({ farm_id: farmId, organization_id: orgId, role: 'SUPERVISOR', deleted_at: null })
      .select('name phone status hiring_date')
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * تعديل بيانات المشرف أو تغيير حالته (إيقاف / تنشيط)
   */
  async updateSupervisor(supervisorId, orgId, updates) {
    //  الترقية المعمارية: منع التعديل على المشرفين المحذوفين (المطرودين)
    const supervisor = await User.findOne({ 
      _id: supervisorId, 
      organization_id: orgId, 
      role: 'SUPERVISOR',
      deleted_at: null 
    });
    
    if (!supervisor) throw new AppError('المشرف غير موجود أو تم حذفه مسبقاً', 404);

    if (updates.name) supervisor.name = updates.name.trim();
    if (updates.phone) supervisor.phone = updates.phone.trim();
    
    if (updates.status && ['ACTIVE', 'SUSPENDED'].includes(updates.status)) {
      supervisor.status = updates.status;
      if (updates.status === 'SUSPENDED') {
        supervisor.current_session_id = crypto.randomBytes(16).toString('hex');
      }
    }

    if (updates.password) {
      const salt = await bcrypt.genSalt(10);
      supervisor.password_hash = await bcrypt.hash(updates.password, salt);
      supervisor.current_session_id = crypto.randomBytes(16).toString('hex');
    }

    try {
      await supervisor.save();
      return supervisor;
    } catch (error) {
      // التقاط محاولة استخدام رقم هاتف يخص مشرف آخر نشط
      if (error.code === 11000) {
        throw new AppError('رقم الهاتف الجديد مستخدم بالفعل لحساب آخر نشط', 400);
      }
      throw error;
    }
  }

  /**
   * الحذف الناعم (Soft Delete) للمشرف للحفاظ على سجلاته التاريخية
   */
  async deleteSupervisor(supervisorId, orgId) {
    //  الترقية المعمارية: منع إعادة حذف السجلات الميتة لتخفيف الضغط على الداتا بيز
    const supervisor = await User.findOneAndUpdate(
      { _id: supervisorId, organization_id: orgId, role: 'SUPERVISOR', deleted_at: null },
      { 
        deleted_at: new Date(), 
        status: 'SUSPENDED',
        current_session_id: crypto.randomBytes(16).toString('hex') 
      },
      { new: true }
    );

    if (!supervisor) throw new AppError('المشرف غير موجود أو تم حذفه بالفعل', 404);
    return true;
  }
}

module.exports = new SupervisorService();