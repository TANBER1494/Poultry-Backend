const Cycle = require('../models/Cycle');
const Farm = require('../models/Farm');
const cycleService = require('../services/cycleService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

/**
 * @desc    Start a new production cycle
 * @route   POST /api/cycles
 * @access  Private
 */
const startCycle = asyncHandler(async (req, res, next) => {
  const { farm_id, barn_id, supervisor_id, name, type, start_date, initial_bird_count } = req.body;

  if (!farm_id || !barn_id || !supervisor_id || !name || !type || !start_date || !initial_bird_count) {
    return next(new AppError('جميع بيانات بدء الدورة مطلوبة', 400));
  }

  if (Number(initial_bird_count) <= 0) {
    return next(new AppError('لا يمكن أن يكون عدد الطيور صفراً أو سالباً', 400));
  }

  const newCycle = await cycleService.startCycle(req.body, req.user.organization_id);

  res.status(201).json({
    message: 'تم تسكين الدورة بنجاح وتفعيل العمليات التشغيلية للعنبر',
    cycle: newCycle,
  });
});

/**
 * @desc    Get all cycles for a specific farm
 * @route   GET /api/cycles/farm/:farm_id
 * @access  Private
 */
const getFarmCycles = asyncHandler(async (req, res, next) => {
  const { farm_id } = req.params;
  const { status } = req.query;
  const orgId = req.user.organization_id;

  const query = { farm_id, organization_id: orgId };
  if (status) query.status = status;

  const cycles = await Cycle.find(query)
    .populate('barn_id', 'name capacity barn_type')
    .populate('supervisor_id', 'name phone')
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ count: cycles.length, cycles });
});

/**
 * @desc    Get specific cycle details
 * @route   GET /api/cycles/:id
 * @access  Private
 */
const getCycleDetails = asyncHandler(async (req, res, next) => {
  const cycle = await Cycle.findOne({ _id: req.params.id, organization_id: req.user.organization_id })
    .populate('barn_id', 'name capacity')
    .populate('supervisor_id', 'name phone')
    .lean();

  if (!cycle) {
    return next(new AppError('الدورة غير موجودة أو غير مصرح لك بالوصول إليها', 404));
  }

  res.status(200).json(cycle);
});

/**
 * @desc    Close and finalize a cycle
 * @route   PUT /api/cycles/:id/close
 * @access  Private
 */
const closeCycle = asyncHandler(async (req, res, next) => {
  if (!req.body.end_date) {
    return next(new AppError('يجب تحديد تاريخ الإغلاق الفعلي للدورة', 400));
  }

  const cycle = await cycleService.closeCycle(req.params.id, req.body.end_date, req.user.organization_id);

  res.status(200).json({
    message: 'تم إقفال الدورة محاسبياً بنجاح، وتحويل العنبر لوضع التطهير والصيانة',
    cycle_summary: {
      total_expenses: cycle.total_expenses,
      total_revenue: cycle.total_revenue,
      net_profit: cycle.net_profit,
      mortality_rate: (((cycle.initial_bird_count - cycle.current_bird_count) / cycle.initial_bird_count) * 100).toFixed(2) + '%',
    },
  });
});

/**
 * @desc    Smart sales calculator for cycle birds
 * @route   POST /api/cycles/:id/sales
 * @access  Private
 */
const sellCycleBirds = asyncHandler(async (req, res, next) => {
  const { local_id, merchant_id, birds_sold_count, total_weight_kg, price_per_kg, transaction_date } = req.body;

  if (!local_id || !merchant_id || !birds_sold_count || !total_weight_kg || !price_per_kg || !transaction_date) {
    return next(new AppError('جميع بيانات المبيعات الأساسية مطلوبة', 400));
  }

  const result = await cycleService.sellBirds(req.params.id, req.body, req.user.organization_id, req.user._id);

  res.status(201).json({
    message: 'تم تنفيذ البيع وخصم العدد من الدورة وتوجيه الحسابات بنجاح',
    invoice: result.invoice,
    remaining_birds_in_cycle: result.remainingBirds,
  });
});

module.exports = {
  startCycle,
  getFarmCycles,
  getCycleDetails,
  closeCycle,
  sellCycleBirds,
};