const dailyLogService = require('../services/dailyLogService');
const notificationController = require('../controllers/notificationController');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

/**
 * @desc    Record bulk daily logs for multiple cycles
 * @route   POST /api/daily-logs/bulk
 * @access  Private
 */
const createBulkDailyLogs = asyncHandler(async (req, res, next) => {
  const { logs } = req.body;
  const farmId = req.user.farm_id || req.body.farm_id || req.query.farm_id;
  const orgId = req.user.organization_id;

  if (!logs || !Array.isArray(logs) || logs.length === 0) {
    return next(new AppError('لا توجد بيانات يوميات لإرسالها', 400));
  }

  if (!farmId) {
    return next(new AppError('المزرعة غير محددة', 400));
  }

  const result = await dailyLogService.createBulkDailyLogs(logs, req.user._id, farmId, orgId);

  // إشعارات الإدخال المجمع
  try {
    if (result.logs.length > 0) {
      await notificationController.sendAppNotification({
        title: '✅ تم تسجيل يوميات مجمعة',
        message: `قام المشرف ${req.user.name} بتسجيل يوميات لعدد (${result.logs.length}) عنابر بنجاح.`,
        type: 'DAILY_LOG',
        target_role: 'OWNER',
        organization_id: orgId,
        link: `/owner/farms/${farmId}/cycles`,
      });
    }

    //  تنبيه النافق مخصص لكل عنبر على حدة
    if (result.highMortalityAlerts && result.highMortalityAlerts.length > 0) {
      const alertDetails = result.highMortalityAlerts.map(a => `${a.barn_name} (${a.dead_count} نافق)`).join('، ');
      await notificationController.sendAppNotification({
        title: '🚨 تنبيه طارئ: نافق غير طبيعي',
        message: `تم تسجيل نافق مرتفع في العنابر التالية: ${alertDetails}.`,
        type: 'HIGH_MORTALITY',
        target_role: 'OWNER',
        organization_id: orgId,
        link: `/owner/farms/${farmId}`,
      });
    }
  } catch (notifErr) {
    console.error('⚠️ فشل إرسال إشعارات اليومية:', notifErr.message);
  }

  res.status(201).json({
    message: `تم تسجيل (${result.logs.length}) يومية وتحديث المخازن بنجاح`,
    logs: result.logs,
  });
});

const getCycleDailyLogs = asyncHandler(async (req, res, next) => {
  const { cycle_id } = req.params;
  const farmId = req.user.farm_id || req.query.farm_id;
  const orgId = req.user.organization_id;

  if (!farmId)
    return next(
      new AppError('يجب تحديد معرف المزرعة للتحقق من الصلاحيات', 400)
    );

  const logs = await dailyLogService.getLogsByCycle(cycle_id, farmId, orgId);
  res.status(200).json({ count: logs.length, logs });
});

module.exports = {
  createBulkDailyLogs,
  getCycleDailyLogs,
};
