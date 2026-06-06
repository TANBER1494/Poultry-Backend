const Farm = require('../models/Farm');

const checkSubscription = async (req, res, next) => {
  try {
    if (req.user?.role === 'SUPER_ADMIN') return next();

    // ==========================================
    // 🛡️ 1. تحديد المزرعة بصرامة شديدة حسب الصلاحية
    // ==========================================
    let farmId;

    if (req.user?.role === 'SUPERVISOR') {
      // المشرف لا يحق له تمرير ID من الفرونت إند إطلاقاً، نعتمد على التوكن فقط
      farmId = req.user.farm_id;
    } else {
      // المالك يحق له تمرير الـ ID في أي مكان في الطلب
      farmId =
        req.body?.farm_id ||
        req.query?.farm_id ||
        req.params?.farm_id ||
        req.params?.id;
    }

    if (!farmId) {
      return res
        .status(400)
        .json({ message: 'إجراء أمني: يجب تحديد المزرعة لإتمام العملية.' });
    }

    // ==========================================
    // 🛡️ 2. منع اختراق المزارع (IDOR Protection)
    // ==========================================
    const query = { _id: farmId };

    // إذا كان مالكاً، نجبر البحث أن تكون المزرعة تحت مؤسسته فقط
    if (req.user?.role === 'OWNER') {
      query.organization_id = req.user.organization_id;
    }

    const farm = await Farm.findOne(query);

    if (!farm) {
      return res
        .status(403)
        .json({
          message:
            'إجراء أمني: المزرعة غير موجودة أو أنك لا تملك صلاحية إدارية عليها.',
        });
    }

    const now = new Date();

    // 3. فحص الإغلاق الإداري
    if (farm.subscription_status === 'LOCKED') {
      return res.status(403).json({
        status: 'LOCKED',
        message:
          'تم إغلاق هذه المزرعة بقرار إداري، يرجى التواصل مع الدعم الفني.',
      });
    }

    // 4. فحص الفترة التجريبية
    if (farm.subscription_status === 'TRIAL') {
      if (now > farm.trial_ends_at) {
        farm.subscription_status = 'OVERDUE';
        await farm.save();
        return res.status(403).json({
          status: 'EXPIRED',
          message:
            'انتهت الفترة التجريبية المجانية، يرجى تفعيل الاشتراك للاستمرار.',
        });
      }
    }

    // 5. فحص الاشتراك المدفوع
    if (
      farm.subscription_status === 'ACTIVE' ||
      farm.subscription_status === 'OVERDUE'
    ) {
      if (farm.subscription_ends_at && now > farm.subscription_ends_at) {
        farm.subscription_status = 'OVERDUE';
        await farm.save();
        return res.status(403).json({
          status: 'EXPIRED',
          message: 'انتهت مدة الاشتراك المدفوع، يرجى السداد لتجنب توقف الخدمة.',
        });
      }
    }

    next();
  } catch (error) {
    console.error('Subscription Middleware Error:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء الفحص الأمني للاشتراك.' });
  }
};

module.exports = { checkSubscription };
