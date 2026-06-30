const dailyLogService = require('../services/dailyLogService');
// 1️ استدعاء خدمة الإشعارات
const notificationService = require('../services/notificationService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

/**
 * @desc    Record a new daily production log
 * @route   POST /api/daily-logs
 * @access  Private
 */
const createDailyLog = asyncHandler(async (req, res, next) => {
  const { local_id, barn_id, cycle_id, log_date, age_in_days, mortality_count } = req.body;
  const farmId = req.user.farm_id || req.body.farm_id;
  const orgId = req.user.organization_id;

  if (!local_id || !barn_id || !cycle_id || !log_date || !age_in_days) {
    return next(new AppError('البيانات الأساسية لليومية غير مكتملة', 400));
  }

  if (!farmId) {
    return next(new AppError('المزرعة غير محددة', 400));
  }

  const result = await dailyLogService.createDailyLog(req.body, req.user._id, farmId, orgId);

  if (result.isDuplicate) {
    return res.status(200).json({ 
      message: 'تم استلام هذه اليومية مسبقاً', 
      log: result.log 
    });
  }

  // ==========================================
  //  قسم إطلاق الإشعارات اللحظية (Sockets & FCM)
  // ==========================================
  try {
    // 2️ الإشعار الأول: إبلاغ المالك بنجاح تسجيل اليومية
    await notificationService.sendAppNotification({
      title: 'تم تسجيل يومية جديدة',
      message: `قام المشرف ${req.user.name} بتسجيل يومية للعنبر لعمر ${age_in_days} يوم.`,
      type: 'DAILY_LOG',
      target_role: 'OWNER',
      organization_id: orgId,
      link: `/dashboard/daily-logs?cycle=${cycle_id}` // رابط يوجه المالك لمعاينة اليومية
    });

    // 3️ الإشعار الثاني (الذكي): تحذير للعامل إذا كان النافق كبير
    const deadBirds = Number(mortality_count) || 0;
    if (deadBirds > 10) {
      await notificationService.sendAppNotification({
        title: '⚠️ تحذير: ارتفاع نسبة النافق',
        message: `تم تسجيل نافق عالي (${deadBirds} طيور) في اليومية الحالية! يرجى فحص العنبر فوراً.`,
        type: 'HIGH_MORTALITY',
        target_role: 'WORKER', // توجيه الرسالة للعامل (بناءً على التعديل الذي أضفناه سابقاً)
        organization_id: orgId,
        // link: '' // لا نحتاج لرابط هنا، مجرد تنبيه تحذيري
      });
    }
  } catch (notifErr) {
    // نكتفي بتسجيل الخطأ في الكونسول حتى لا نكسر عملية حفظ اليومية الأساسية
    console.error('⚠️ فشل إرسال إشعارات اليومية:', notifErr.message);
  }

  res.status(201).json({
    message: 'تم تسجيل اليومية وتحديث المخازن وحسابات الدورة بنجاح',
    log: result.log
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
    return next(new AppError('يجب تحديد معرف المزرعة للتحقق من الصلاحيات', 400));
  }

  const logs = await dailyLogService.getLogsByCycle(cycle_id, farmId, orgId);

  res.status(200).json({ count: logs.length, logs });
});

module.exports = {
  createDailyLog,
  getCycleDailyLogs
};