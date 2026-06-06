const mongoose = require('mongoose');
const Worker = require('../models/Worker');
const WorkerLog = require('../models/WorkerLog');
const Transaction = require('../models/Transaction');
const Farm = require('../models/Farm');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 1. إضافة عامل جديد
// ==========================================
const addWorker = asyncHandler(async (req, res, next) => {
  const { farm_id, name, phone, national_id, base_daily_wage } = req.body;
  const orgId = req.user.organization_id;

  if (!farm_id || !name || base_daily_wage === undefined) {
    return next(new AppError('البيانات الأساسية (المزرعة، الاسم، الأجر اليومي الأساسي) مطلوبة', 400));
  }

  const numericWage = Number(base_daily_wage);
  if (numericWage < 0) {
    return next(new AppError('الأجر اليومي لا يمكن أن يكون بالسالب', 400));
  }

  // التحقق من صلاحية الوصول للمزرعة
  const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403));
  }

  const newWorker = await Worker.create({
    farm_id,
    name: name.trim(),
    phone: phone ? phone.trim() : '',
    national_id: national_id ? national_id.trim() : '',
    base_daily_wage: numericWage
  });

  res.status(201).json({
    message: 'تم تسجيل بيانات العامل بنجاح',
    worker: newWorker
  });
});

// ==========================================
// 2. جلب قائمة العمال لمزرعة معينة
// ==========================================
const getWorkers = asyncHandler(async (req, res, next) => {
  const { farm_id } = req.params;
  const { status } = req.query;
  const orgId = req.user.organization_id;

  const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('المزرعة غير موجودة', 403));
  }

  let query = { farm_id };
  if (status) query.status = status;

  const workers = await Worker.find(query)
    .sort({ status: 1, name: 1 })
    .lean();

  res.status(200).json({ count: workers.length, workers });
});

// ==========================================
// 3. تسجيل يومية عامل (حضور / غياب / إضافي)
// ==========================================
const recordWorkerLog = asyncHandler(async (req, res, next) => {
  const { local_id, worker_id, log_date, wage_multiplier, notes } = req.body;
  const orgId = req.user.organization_id;

  if (!local_id || !worker_id || !log_date || wage_multiplier === undefined) {
    return next(new AppError('البيانات الأساسية لتسجيل اليومية غير مكتملة', 400));
  }

  const numericMultiplier = Number(wage_multiplier);
  if (numericMultiplier < 0) {
    return next(new AppError('معامل الأجر لا يمكن أن يكون بالسالب', 400));
  }

  // منع التكرار (Offline Support)
  const existingLogByLocalId = await WorkerLog.findOne({ local_id }).lean();
  if (existingLogByLocalId) {
    return res.status(200).json({ message: 'تم استلام هذه اليومية مسبقاً', log: existingLogByLocalId });
  }

  // التحقق من العامل والمزرعة
  const worker = await Worker.findById(worker_id);
  if (!worker || worker.status === 'TERMINATED') {
    return next(new AppError('العامل غير موجود أو تم إنهاء عمله', 404));
  }

  const farm = await Farm.findOne({ _id: worker.farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('لا تملك صلاحية الوصول لبيانات هذا العامل', 403));
  }

  // منع تسجيل أكثر من يومية لنفس العامل في نفس اليوم
  const targetDate = new Date(log_date);
  targetDate.setHours(0, 0, 0, 0);

  const existingLogByDate = await WorkerLog.findOne({
    worker_id,
    log_date: {
      $gte: targetDate,
      $lt: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000)
    }
  }).lean();

  if (existingLogByDate) {
    return next(new AppError('تم تسجيل يومية لهذا العامل في هذا التاريخ مسبقاً', 400));
  }

  const earnedAmount = worker.base_daily_wage * numericMultiplier;

  const newWorkerLog = await WorkerLog.create({
    local_id,
    farm_id: worker.farm_id,
    worker_id,
    recorded_by: req.user._id,
    log_date: new Date(log_date),
    wage_multiplier: numericMultiplier,
    earned_amount: earnedAmount,
    notes: notes ? notes.trim() : ''
  });

  res.status(201).json({
    message: 'تم تسجيل اليومية واحتساب الاستحقاق بنجاح',
    log: newWorkerLog
  });
});

// ==========================================
// 4. استخراج كشف حساب العامل (تجميع الاستحقاقات والسلف)
// ==========================================
const getWorkerStatement = asyncHandler(async (req, res, next) => {
  const { worker_id } = req.params;
  const orgId = req.user.organization_id;

  const worker = await Worker.findById(worker_id).lean();
  if (!worker) {
    return next(new AppError('العامل غير موجود', 404));
  }

  const farm = await Farm.findOne({ _id: worker.farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('لا تملك صلاحية الوصول لكشف حساب هذا العامل', 403));
  }

  // 1. تجميع الاستحقاقات (اليوميات)
  const logs = await WorkerLog.find({ worker_id })
    .select('log_date wage_multiplier earned_amount notes')
    .sort({ log_date: -1 })
    .lean();

  const totalEarned = logs.reduce((sum, log) => sum + log.earned_amount, 0);

  // 2. تجميع المسحوبات (سلف + رواتب مصروفة) من الخزينة
  const transactions = await Transaction.find({ 
    worker_id, 
    type: 'OUT', 
    category: { $in: ['WORKER_ADVANCE', 'WORKER_SALARY'] } 
  })
    .select('amount transaction_date category notes reference_doc')
    .sort({ transaction_date: -1 })
    .lean();

  const totalDrawn = transactions.reduce((sum, tx) => sum + tx.amount, 0);

  // 3. حساب الصافي المستحق
  const netBalance = totalEarned - totalDrawn;

  res.status(200).json({
    worker_info: {
      name: worker.name,
      base_daily_wage: worker.base_daily_wage,
      status: worker.status
    },
    financial_summary: {
      total_earned: totalEarned,
      total_drawn: totalDrawn,
      net_balance: netBalance // إذا كان موجباً، فالعامل له مستحقات. إذا كان سالباً، العامل عليه مديونية (سحب أكثر مما عمل).
    },
    logs_history: logs,
    transactions_history: transactions
  });
});

// ==========================================
// 5. تصفية حساب العامل (صرف راتب)
// ==========================================
const settleWorkerAccount = asyncHandler(async (req, res, next) => {
  const { local_id, worker_id, amount_to_pay, transaction_date, notes } = req.body;
  const orgId = req.user.organization_id;

  if (!local_id || !worker_id || !amount_to_pay || !transaction_date) {
    return next(new AppError('البيانات الأساسية لعملية الصرف غير مكتملة', 400));
  }

  const numericAmount = Number(amount_to_pay);
  if (numericAmount <= 0) {
    return next(new AppError('المبلغ المصروف يجب أن يكون أكبر من الصفر', 400));
  }

  const existingTransaction = await Transaction.findOne({ local_id }).lean();
  if (existingTransaction) {
    return res.status(200).json({ message: 'تم تسجيل عملية الصرف مسبقاً', transaction: existingTransaction });
  }

  const worker = await Worker.findById(worker_id).lean();
  if (!worker) {
    return next(new AppError('العامل غير موجود', 404));
  }

  const farm = await Farm.findOne({ _id: worker.farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('لا تملك صلاحية الوصول لبيانات هذا العامل', 403));
  }

  // يتم تسجيل الصرف مباشرة كعملية خروج من الخزينة تحت بند WORKER_SALARY
  const newTransaction = await Transaction.create({
    local_id,
    farm_id: worker.farm_id,
    worker_id,
    performed_by: req.user._id,
    type: 'OUT',
    category: 'WORKER_SALARY',
    amount: numericAmount,
    transaction_date: new Date(transaction_date),
    notes: notes ? notes.trim() : 'تصفية راتب',
    reference_doc: `سداد مستحقات العامل: ${worker.name}`
  });

  res.status(201).json({
    message: 'تم صرف المبلغ وتوثيقه في الخزينة بنجاح',
    transaction: newTransaction
  });
});


// ==========================================
// 6. تغيير حالة العامل (إجازة / إنهاء عمل / تنشيط)
// ==========================================
const changeWorkerStatus = asyncHandler(async (req, res, next) => {
  const { worker_id } = req.params;
  const { status } = req.body;
  const orgId = req.user.organization_id;

  if (!['ACTIVE', 'ON_LEAVE', 'TERMINATED'].includes(status)) {
    return next(new AppError('حالة العامل غير صالحة. الحالات المقبولة: ACTIVE, ON_LEAVE, TERMINATED', 400));
  }

  const worker = await Worker.findById(worker_id);
  if (!worker) {
    return next(new AppError('العامل غير موجود', 404));
  }

  const farm = await Farm.findOne({ _id: worker.farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('لا تملك صلاحية الوصول لبيانات هذا العامل', 403));
  }

  // إذا كان سيتم إنهاء عمله، يجب التأكد من عدم وجود مديونيات عليه للمزرعة
  if (status === 'TERMINATED') {
    // حساب الرصيد الحالي (مبسط للتحقق السريع)
    const logs = await WorkerLog.find({ worker_id }).select('earned_amount').lean();
    const totalEarned = logs.reduce((sum, log) => sum + log.earned_amount, 0);

    const transactions = await Transaction.find({ 
      worker_id, type: 'OUT', category: { $in: ['WORKER_ADVANCE', 'WORKER_SALARY'] } 
    }).select('amount').lean();
    const totalDrawn = transactions.reduce((sum, tx) => sum + tx.amount, 0);

    const netBalance = totalEarned - totalDrawn;

    if (netBalance < 0) {
      return next(new AppError(`لا يمكن إنهاء عمل العامل وعليه مديونية (سلف غير مسددة) بقيمة ${Math.abs(netBalance)} ج.م`, 400));
    }
  }

  worker.status = status;
  
  // توثيق تاريخ الإنهاء إذا تم فصله
  if (status === 'TERMINATED') {
    worker.termination_date = new Date();
  } else {
    worker.termination_date = null; 
  }

  await worker.save();

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