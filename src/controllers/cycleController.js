const Cycle = require('../models/Cycle');
const Farm = require('../models/Farm');
const cycleService = require('../services/cycleService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

const startCycle = asyncHandler(async (req, res, next) => {
  const { farm_id, barn_id, supervisor_id, name, type, start_date, initial_bird_count } = req.body;
  if (!farm_id || !barn_id || !supervisor_id || !name || !type || !start_date || !initial_bird_count) {
    return next(new AppError('جميع بيانات بدء الدورة مطلوبة', 400));
  }
  if (Number(initial_bird_count) <= 0) return next(new AppError('لا يمكن أن يكون عدد الطيور صفراً أو سالباً', 400));

  const newCycle = await cycleService.startCycle(req.body, req.user.organization_id);
  res.status(201).json({ message: 'تم تسكين الدورة بنجاح وتفعيل العمليات التشغيلية للعنبر', cycle: newCycle });
});

const getFarmCycles = asyncHandler(async (req, res, next) => {
  const { farm_id } = req.params;
  const { status } = req.query;
  const query = { farm_id, organization_id: req.user.organization_id };
  if (status) query.status = status;

 const cycles = await Cycle.find(query)
    .populate('farm_id', 'name') 
    .populate('barn_id', 'name capacity barn_type')
    .populate('supervisor_id', 'name phone')
    .populate('feed_custody.item_id', 'name unit')
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ count: cycles.length, cycles });
});

const getCycleDetails = asyncHandler(async (req, res, next) => {
  const cycle = await Cycle.findOne({ _id: req.params.id, organization_id: req.user.organization_id })
    .populate('farm_id', 'name') // 🛡️ جلب اسم المزرعة
    .populate('barn_id', 'name capacity barn_type')
    .populate('supervisor_id', 'name phone')
    .lean();

  if (!cycle) return next(new AppError('الدورة غير موجودة أو غير مصرح لك بالوصول إليها', 404));
  res.status(200).json(cycle);
});

const closeCycle = asyncHandler(async (req, res, next) => {
  if (!req.body.end_date) return next(new AppError('يجب تحديد تاريخ الإغلاق الفعلي للدورة', 400));
  const cycle = await cycleService.closeCycle(req.params.id, req.body.end_date, req.user.organization_id);

  res.status(200).json({
    message: 'تم إقفال الدورة محاسبياً بنجاح، وتحويل العنبر لوضع التطهير والصيانة',
    cycle_summary: {
      total_expenses: cycle.total_expenses,
      total_revenue: cycle.total_revenue,
      net_profit: cycle.net_profit,
      mortality_rate: (((cycle.total_dead_birds) / cycle.initial_bird_count) * 100).toFixed(2) + '%',
    },
  });
});

const recordCycleSale = asyncHandler(async (req, res, next) => {
  const { local_id, merchant_id, sale_category, quantity, unit_price, transaction_date } = req.body;

  if (!local_id || !merchant_id || !sale_category || !quantity || !unit_price || !transaction_date) {
    return next(new AppError('جميع بيانات المبيعات الأساسية مطلوبة', 400));
  }

  //  التعديل: إرسال req.user.role إلى السيرفيس
  const result = await cycleService.recordCycleSale(req.params.id, req.body, req.user.organization_id, req.user._id, req.user.role);

  res.status(201).json({
    message: 'تم تسجيل فاتورة المبيعات وتوجيه الحسابات بنجاح',
    invoice: result.invoice,
    cycle_stats: { 
        current_birds: result.cycle.current_bird_count,
        total_revenue: result.cycle.total_revenue 
    }
  });
});

module.exports = {
  startCycle,
  getFarmCycles,
  getCycleDetails,
  closeCycle,
  recordCycleSale,
};