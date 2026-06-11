const dailyLogService = require('../services/dailyLogService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

/**
 * @desc    Record a new daily production log
 * @route   POST /api/daily-logs
 * @access  Private
 */
const createDailyLog = asyncHandler(async (req, res, next) => {
  const { local_id, barn_id, cycle_id, log_date, age_in_days } = req.body;
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

  if (!farmId) {
    return next(new AppError('يجب تحديد معرف المزرعة للتحقق من الصلاحيات', 400));
  }

  const logs = await dailyLogService.getLogsByCycle(cycle_id, farmId);

  res.status(200).json({ count: logs.length, logs });
});

module.exports = {
  createDailyLog,
  getCycleDailyLogs
};