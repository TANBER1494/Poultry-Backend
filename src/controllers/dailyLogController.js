const dailyLogService = require('../services/dailyLogService');
const notificationService = require('../services/notificationService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

/**
 * @desc    Record a new daily production log
 * @route   POST /api/daily-logs
 * @access  Private
 */
const createDailyLog = asyncHandler(async (req, res, next) => {
  const {
    local_id,
    barn_id,
    cycle_id,
    log_date,
    age_in_days,
    mortality_count,
  } = req.body;
  const farmId = req.user.farm_id || req.body.farm_id;
  const orgId = req.user.organization_id;

  if (!local_id || !barn_id || !cycle_id || !log_date || !age_in_days) {
    return next(new AppError('البيانات الأساسية لليومية غير مكتملة', 400));
  }

  if (!farmId) {
    return next(new AppError('المزرعة غير محددة', 400));
  }

  const result = await dailyLogService.createDailyLog(
    req.body,
    req.user._id,
    farmId,
    orgId
  );

  if (result.isDuplicate) {
    return res.status(200).json({
      message: 'تم استلام هذه اليومية مسبقاً',
      log: result.log,
    });
  }

  // ==========================================
  //  قسم إطلاق الإشعارات اللحظية (Sockets & FCM)
  // ==========================================
  try {
    // 1. إبلاغ المالك بنجاح تسجيل اليومية مع تصحيح الرابط
    await notificationService.sendAppNotification({
      title: 'تم تسجيل يومية جديدة',
      message: `قام المشرف ${req.user.name} بتسجيل يومية للعنبر لعمر ${age_in_days} يوم.`,
      type: 'DAILY_LOG',
      target_role: 'OWNER',
      organization_id: orgId,
      link: `/owner/farms/${farmId}/cycles/${cycle_id}`,
    });

    // 2. تحذير النافق (تم توجيهه للمشرف والمالك بدلاً من العامل)
    const deadBirds = Number(mortality_count) || 0;
    if (deadBirds > 10) {
      // إشعار للمشرف (نفس المستخدم الحالي كتحذير بصري له)
      await notificationService.sendAppNotification({
        title: '⚠️ تحذير: ارتفاع نسبة النافق',
        message: `لقد قمت للتو بتسجيل نافق عالي (${deadBirds} طيور). يرجى اتخاذ الإجراءات الطبية اللازمة فوراً.`,
        type: 'HIGH_MORTALITY',
        target_role: 'SUPERVISOR',
        target_user_id: req.user._id, // توجيه للمشرف نفسه
        organization_id: orgId,
        link: `/supervisor/daily-logs`,
      });

      // إشعار طارئ للمالك ليكون على علم بالكارثة المحتملة
      await notificationService.sendAppNotification({
        title: '🚨 تنبيه طارئ: نافق غير طبيعي',
        message: `عاجل: تم تسجيل عدد (${deadBirds}) نافق في دورة العنبر بواسطة المشرف ${req.user.name}.`,
        type: 'HIGH_MORTALITY',
        target_role: 'OWNER',
        organization_id: orgId,
        link: `/owner/farms/${farmId}/cycles/${cycle_id}`,
      });
    }
  } catch (notifErr) {
    console.error('⚠️ فشل إرسال إشعارات اليومية:', notifErr.message);
  }

  res.status(201).json({
    message: 'تم تسجيل اليومية وتحديث المخازن وحسابات الدورة بنجاح',
    log: result.log,
  });
});

/**
 * @desc    Get all daily logs for a specific cycle
 * @route   GET /api/daily-logs/cycle/:cycle_id
 * @access  Private
 */
const getCycleDailyLogs = asyncHandler(async (req, res, next) => {
  const { cycle_id } = req.params;
  const farmId = req.user.farm_id || req.query.farm_id;
  const orgId = req.user.organization_id;

  if (!farmId) {
    return next(
      new AppError('يجب تحديد معرف المزرعة للتحقق من الصلاحيات', 400)
    );
  }

  const logs = await dailyLogService.getLogsByCycle(cycle_id, farmId, orgId);

  res.status(200).json({ count: logs.length, logs });
});

module.exports = {
  createDailyLog,
  getCycleDailyLogs,
};
