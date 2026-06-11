const workerService = require('../services/workerService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

/**
 * @desc    Add a new worker
 * @route   POST /api/workers
 * @access  Private
 */
const addWorker = asyncHandler(async (req, res, next) => {
  const { farm_id, name, base_daily_wage } = req.body;

  if (!farm_id || !name || base_daily_wage === undefined) {
    return next(new AppError('البيانات الأساسية (المزرعة، الاسم، الأجر اليومي الأساسي) مطلوبة', 400));
  }

  if (Number(base_daily_wage) < 0) {
    return next(new AppError('الأجر اليومي لا يمكن أن يكون بالسالب', 400));
  }

  const worker = await workerService.createWorker(req.body, req.user.organization_id);

  res.status(201).json({
    message: 'تم تسجيل بيانات العامل بنجاح',
    worker
  });
});

/**
 * @desc    Get workers for a specific farm
 * @route   GET /api/workers/farm/:farm_id
 * @access  Private
 */
const getWorkers = asyncHandler(async (req, res, next) => {
  const workers = await workerService.getWorkers(req.params.farm_id, req.user.organization_id, req.query);
  res.status(200).json({ count: workers.length, workers });
});

/**
 * @desc    Record daily log (attendance/absence/bonus)
 * @route   POST /api/workers/log
 * @access  Private
 */
const recordWorkerLog = asyncHandler(async (req, res, next) => {
  const { local_id, worker_id, log_date, wage_multiplier } = req.body;

  if (!local_id || !worker_id || !log_date || wage_multiplier === undefined) {
    return next(new AppError('البيانات الأساسية لتسجيل اليومية غير مكتملة', 400));
  }

  if (Number(wage_multiplier) < 0) {
    return next(new AppError('معامل الأجر لا يمكن أن يكون بالسالب', 400));
  }

  const result = await workerService.recordLog(req.body, req.user._id, req.user.organization_id);

  if (result.isDuplicate) {
    return res.status(200).json({ message: 'تم استلام هذه اليومية مسبقاً', log: result.log });
  }

  res.status(201).json({
    message: 'تم تسجيل اليومية واحتساب الاستحقاق بنجاح',
    log: result.log
  });
});

/**
 * @desc    Get full statement (Ledger) for a worker
 * @route   GET /api/workers/:worker_id/statement
 * @access  Private
 */
const getWorkerStatement = asyncHandler(async (req, res, next) => {
  const statement = await workerService.getWorkerStatement(req.params.worker_id, req.user.organization_id);
  res.status(200).json(statement);
});

/**
 * @desc    Settle worker account (Pay salary/advance)
 * @route   POST /api/workers/settle
 * @access  Private
 */
const settleWorkerAccount = asyncHandler(async (req, res, next) => {
  const { local_id, worker_id, amount_to_pay, transaction_date } = req.body;

  if (!local_id || !worker_id || !amount_to_pay || !transaction_date) {
    return next(new AppError('البيانات الأساسية لعملية الصرف غير مكتملة', 400));
  }

  if (Number(amount_to_pay) <= 0) {
    return next(new AppError('المبلغ المصروف يجب أن يكون أكبر من الصفر', 400));
  }

  const result = await workerService.settleAccount(req.body, req.user._id, req.user.organization_id);

  if (result.isDuplicate) {
    return res.status(200).json({ message: 'تم تسجيل عملية الصرف مسبقاً', transaction: result.transaction });
  }

  res.status(201).json({
    message: 'تم صرف المبلغ وتوثيقه في الخزينة بنجاح',
    transaction: result.transaction
  });
});

/**
 * @desc    Change worker status (ACTIVE, ON_LEAVE, TERMINATED)
 * @route   PUT /api/workers/:worker_id/status
 * @access  Private
 */
const changeWorkerStatus = asyncHandler(async (req, res, next) => {
  const { status } = req.body;

  if (!['ACTIVE', 'ON_LEAVE', 'TERMINATED'].includes(status)) {
    return next(new AppError('حالة العامل غير صالحة. الحالات المقبولة: ACTIVE, ON_LEAVE, TERMINATED', 400));
  }

  const worker = await workerService.changeStatus(req.params.worker_id, status, req.user.organization_id);

  res.status(200).json({
    message: `تم تحديث حالة العامل إلى: ${status} بنجاح`,
    worker
  });
});

module.exports = {
  addWorker,
  getWorkers,
  recordWorkerLog,
  getWorkerStatement,
  settleWorkerAccount,
  changeWorkerStatus
};