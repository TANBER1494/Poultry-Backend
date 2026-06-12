const Farm = require('../models/Farm');

const checkSubscription = async (req, res, next) => {
  try {
    if (req.user?.role === 'SUPER_ADMIN') return next();

    // 1. تحديد المزرعة بصرامة حسب الصلاحية
    let farmId;
    if (req.user?.role === 'SUPERVISOR') {
      farmId = req.user.farm_id;
    } else {
      farmId = req.body?.farm_id || req.query?.farm_id || req.params?.farm_id || req.params?.id;
    }

    if (!farmId) {
      return res.status(400).json({ message: 'إجراء أمني: يجب تحديد المزرعة لإتمام العملية.' });
    }

    // 2. بناء استعلام الحماية ضد ثغرات (IDOR)
    const query = { _id: farmId };
    if (req.user?.role === 'OWNER') {
      query.organization_id = req.user.organization_id;
    }

    // استخدام .lean() لأداء أسرع في عمليات القراءة فقط
    const farm = await Farm.findOne(query).lean();

    if (!farm) {
      return res.status(403).json({
        message: 'إجراء أمني: المزرعة غير موجودة أو أنك لا تملك صلاحية إدارية عليها.'
      });
    }

    // 3. فحص الإغلاق الإداري (أولوية قصوى)
    if (farm.subscription_status === 'LOCKED') {
      return res.status(403).json({
        status: 'LOCKED',
        message: 'تم إغلاق هذه المزرعة بقرار إداري، يرجى التواصل مع الدعم الفني.'
      });
    }

    // 4. الفحص اللحظي لتواريخ الصلاحية (بدون المساس بحالة قاعدة البيانات)
    const now = new Date();
    const targetDate = farm.subscription_status === 'TRIAL' 
      ? farm.trial_ends_at 
      : farm.subscription_ends_at;

    if (targetDate && now > targetDate) {
      return res.status(403).json({
        status: 'EXPIRED',
        message: 'انتهت مدة الاشتراك أو الفترة التجريبية، يرجى السداد لتجنب توقف الخدمة.'
      });
    }

    next();
  } catch (error) {
    console.error('Subscription Middleware Error:', error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء الفحص الأمني للاشتراك.' });
  }
};

module.exports = { checkSubscription };