const Farm = require('../models/Farm');

const checkSubscription = async (req, res, next) => {
  try {
    // مدير النظام له كامل الصلاحيات
    if (req.user?.role === 'SUPER_ADMIN') return next();

    // 1. تحديد المزرعة بصرامة
    let farmId;
    if (req.user?.role === 'SUPERVISOR' || req.user?.role === 'WORKER') {
      farmId = req.user.farm_id;
    } else {
      farmId = req.body?.farm_id || req.query?.farm_id || req.params?.farm_id || req.params?.id;
    }

    if (!farmId) {
      return res.status(400).json({ message: 'إجراء أمني: يجب تحديد المزرعة لإتمام العملية.' });
    }

    const query = { _id: farmId };
    if (req.user?.role === 'OWNER') {
      query.organization_id = req.user.organization_id;
    }

    const farm = await Farm.findOne(query);

    if (!farm) {
      return res.status(403).json({ message: 'إجراء أمني: المزرعة غير موجودة أو لا تملك صلاحية إدارية عليها.' });
    }

    //  2. الفحص الإداري (الإيقاف اليدوي من الإدارة)
    if (farm.subscription_status === 'LOCKED') {
      return res.status(403).json({ 
        status: 'LOCKED', 
        message: 'تم إغلاق هذه المزرعة، لا يمكن إجراء أي عمليات.' 
      });
    }

    //  3. سد الثغرة: إذا كانت المزرعة منتهية بالفعل (OVERDUE) تُرفض فوراً
    if (farm.subscription_status === 'OVERDUE') {
      return res.status(402).json({ 
        status: 'EXPIRED', 
        message: 'الاشتراك منتهي، يرجى التجديد لتتمكن من استخدام النظام.' 
      });
    }

    //  4. الفحص اللحظي للتواريخ (للمزارع النشطة أو التجريبية فقط)
    const now = new Date();
    let isExpired = false;
    let expireMessage = '';

    if (farm.subscription_status === 'TRIAL') {
      if (farm.trial_ends_at && now > farm.trial_ends_at) {
        isExpired = true;
        expireMessage = 'انتهت الفترة التجريبية (14 يوم) لهذه المزرعة، يرجى الاشتراك.';
      }
    } else if (farm.subscription_status === 'ACTIVE') {
      if (farm.subscription_ends_at && now > farm.subscription_ends_at) {
        isExpired = true;
        expireMessage = 'انتهى اشتراك المزرعة، يرجى التجديد لتجنب توقف الخدمة.';
      }
    }

    // إذا اكتشفنا الانتهاء للتو، نُحدث الداتابيز ونطرد المستخدم
    if (isExpired) {
      farm.subscription_status = 'OVERDUE';
      await farm.save();
      return res.status(402).json({ 
        status: 'EXPIRED', 
        message: expireMessage 
      });
    }

    // إذا وصلنا إلى هنا، فهذا يعني أن المزرعة نشطة وفي فترة السماح
    next();
  } catch (error) {
    console.error('Subscription Middleware Error:', error);
    res.status(500).json({ message: 'حدث خطأ داخلي أثناء الفحص الأمني للاشتراك.' });
  }
};

module.exports = { checkSubscription };