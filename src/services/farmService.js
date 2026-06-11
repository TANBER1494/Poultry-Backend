const Farm = require('../models/Farm');
const Barn = require('../models/Barn');
const Cycle = require('../models/Cycle');
const User = require('../models/User');
const AppError = require('../utils/AppError');

class FarmService {
  /**
   * حساب الأيام المتبقية للاشتراك
   * @param {Date} targetDate
   * @private
   */
  _calculateDaysLeft(targetDate) {
    if (!targetDate) return 0;
    const diffInDays = Math.ceil((new Date(targetDate) - new Date()) / (1000 * 60 * 60 * 24));
    return diffInDays > 0 ? diffInDays : 0;
  }

  /**
   * إنشاء مزرعة جديدة وإعداد الفترة التجريبية
   */
  async createFarm(data, orgId) {
    const { name, location, farm_type, max_capacity, has_feed_mill } = data;

    const existingFarm = await Farm.findOne({ organization_id: orgId, name: name.trim() }).lean();
    if (existingFarm) {
      throw new AppError('يوجد مزرعة بهذا الاسم بالفعل مسجلة في النظام', 400);
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    const newFarm = await Farm.create({
      organization_id: orgId,
      name: name.trim(),
      location: location.trim(),
      farm_type: farm_type,
      max_capacity: Number(max_capacity),
      has_feed_mill: has_feed_mill || false,
      subscription_status: 'TRIAL',
      monthly_fee: 0,
      trial_ends_at: trialEndsAt
    });

    return newFarm;
  }

  /**
   * جلب مزارع المؤسسة مع حساب الأيام المتبقية ديناميكياً
   */
  async getOrganizationFarms(orgId) {
    const farmsRaw = await Farm.find({ organization_id: orgId })
      .sort({ createdAt: -1 })
      .lean();

    return farmsRaw.map(farm => {
      const targetDate = farm.subscription_status === 'TRIAL' ? farm.trial_ends_at : farm.subscription_ends_at;
      return {
        ...farm,
        status: farm.subscription_status,
        days_left: this._calculateDaysLeft(targetDate)
      };
    });
  }

  /**
   * تحديث إعدادات المزرعة
   */
  async updateFarm(farmId, orgId, updates) {
    const farm = await Farm.findOne({ _id: farmId, organization_id: orgId });
    if (!farm) {
      throw new AppError('المزرعة غير موجودة أو لا تملك صلاحية التعديل عليها', 404);
    }

    if (updates.name) farm.name = updates.name.trim();
    if (updates.location) farm.location = updates.location.trim();
    if (updates.farm_type) farm.farm_type = updates.farm_type;
    if (updates.max_capacity !== undefined) farm.max_capacity = Number(updates.max_capacity);
    if (updates.has_feed_mill !== undefined) farm.has_feed_mill = Boolean(updates.has_feed_mill);

    await farm.save();
    return farm;
  }

  /**
   * تغيير حالة اشتراك المزرعة (إيقاف / تنشيط)
   */
  async changeFarmStatus(farmId, orgId, action) {
    const farm = await Farm.findOne({ _id: farmId, organization_id: orgId });
    if (!farm) {
      throw new AppError('المزرعة غير موجودة', 404);
    }

    if (action === 'SUSPEND') {
      farm.subscription_status = 'LOCKED';
    } else if (action === 'REACTIVATE') {
      farm.subscription_status = (farm.trial_ends_at && farm.trial_ends_at > new Date()) ? 'TRIAL' : 'ACTIVE';
    }

    await farm.save();
    return farm;
  }

  /**
   * الحذف النهائي مع فحص القيود المرجعية المتوازي (Optimized)
   */
  async deleteFarm(farmId, orgId) {
    // تنفيذ استعلامات الفحص بشكل متوازٍ لتقليل وقت الاستجابة
    const [hasBarns, hasCycles, hasUsers] = await Promise.all([
      Barn.exists({ farm_id: farmId }),
      Cycle.exists({ farm_id: farmId }),
      User.exists({ farm_id: farmId, deleted_at: null })
    ]);

    if (hasBarns) throw new AppError('لا يمكن حذف المزرعة لوجود عنابر مسجلة بها. يجب حذف العنابر أولاً.', 400);
    if (hasCycles) throw new AppError('لا يمكن حذف المزرعة لوجود سجلات دورات إنتاج مرتبطة بها.', 400);
    if (hasUsers) throw new AppError('يجب نقل أو حذف المشرفين المربوطين بهذه المزرعة أولاً.', 400);

    const deletedFarm = await Farm.findOneAndDelete({ _id: farmId, organization_id: orgId });
    if (!deletedFarm) {
      throw new AppError('المزرعة غير موجودة', 404);
    }

    return true;
  }
}

module.exports = new FarmService();