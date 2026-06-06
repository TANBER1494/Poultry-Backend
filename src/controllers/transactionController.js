const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Invoice = require('../models/Invoice');
const Cycle = require('../models/Cycle');
const Farm = require('../models/Farm');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 1. تسجيل معاملة مالية جديدة (وارد / منصرف)
// ==========================================
const createTransaction = asyncHandler(async (req, res, next) => {
  const {
    local_id, farm_id, type, category, amount, transaction_date,
    cycle_id, worker_id, merchant_id, invoice_id, notes, reference_doc
  } = req.body;
  const orgId = req.user.organization_id;

  if (!local_id || !farm_id || !type || !category || !amount || !transaction_date) {
    return next(new AppError('البيانات الأساسية للمعاملة المالية غير مكتملة', 400));
  }

  const numericAmount = Number(amount);
  if (numericAmount <= 0) {
    return next(new AppError('قيمة المعاملة يجب أن تكون أكبر من الصفر', 400));
  }

  // 1. حاجز منع التكرار (Offline Support)
  const existingTransaction = await Transaction.findOne({ local_id }).lean();
  if (existingTransaction) {
    return res.status(200).json({ message: 'تم تسجيل هذه المعاملة مسبقاً', transaction: existingTransaction });
  }

  // 2. حاجز أمان الملكية
  const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 3. معالجة تسديد الفواتير (Accounts Payable / Receivable)
    if (invoice_id) {
      const invoice = await Invoice.findOne({ _id: invoice_id, farm_id }).session(session);
      if (!invoice) {
        throw new AppError('الفاتورة المرتبطة غير موجودة', 404);
      }
      if (invoice.payment_status === 'PAID') {
        throw new AppError('لا يمكن تسديد دفعة لفاتورة خالصة بالفعل', 400);
      }
      if (numericAmount > invoice.remaining_amount) {
        throw new AppError(`المبلغ المدفوع (${numericAmount}) يتجاوز القيمة المتبقية للفاتورة (${invoice.remaining_amount})`, 400);
      }

      // تحديث أرصدة الفاتورة
      invoice.paid_amount += numericAmount;
      invoice.remaining_amount -= numericAmount;
      invoice.payment_status = invoice.remaining_amount === 0 ? 'PAID' : 'PARTIAL';
      await invoice.save({ session });
    } 
    // 4. معالجة المعاملات النقدية المباشرة المؤثرة على الدورة (بدون فواتير)
    else if (cycle_id) {
      const cycle = await Cycle.findOne({ _id: cycle_id, farm_id }).session(session);
      if (cycle && cycle.status !== 'CLOSED') {
        if (type === 'IN') {
          cycle.total_revenue += numericAmount;
        } else if (type === 'OUT' && !['FEED_PURCHASE', 'MED_PURCHASE'].includes(category)) {
          // استثناء مصاريف العلف والدواء لأنها تُحسب وقت الاستهلاك من المخزن وليس وقت الشراء لتجنب الازدواج المحاسبي
          cycle.total_expenses += numericAmount;
        }
        await cycle.save({ session });
      }
    }

    // 5. إنشاء القيد المالي في الخزينة
    const [newTransaction] = await Transaction.create([{
      local_id,
      farm_id,
      cycle_id: cycle_id || null,
      worker_id: worker_id || null,
      merchant_id: merchant_id || null,
      invoice_id: invoice_id || null,
      performed_by: req.user._id,
      type,
      category,
      amount: numericAmount,
      transaction_date: new Date(transaction_date),
      notes: notes ? notes.trim() : '',
      reference_doc: reference_doc ? reference_doc.trim() : ''
    }], { session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'تم تسجيل المعاملة المالية وتوجيه الحسابات بنجاح',
      transaction: newTransaction
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    if (error.isOperational) return next(error);
    console.error('Financial Transaction Error:', error);
    return next(new AppError('فشل في تسجيل المعاملة المالية، تم التراجع عن القيود لحماية الخزينة', 500));
  }
});

// ==========================================
// 2. جلب دفتر الأستاذ العام (كشف حساب الخزينة)
// ==========================================
const getTransactions = asyncHandler(async (req, res, next) => {
  const { farm_id } = req.params;
  const { type, category, start_date, end_date, cycle_id } = req.query;
  const orgId = req.user.organization_id;

  const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول', 403));
  }

  // بناء الفلاتر الديناميكية
  let query = { farm_id };
  if (type) query.type = type;
  if (category) query.category = category;
  if (cycle_id) query.cycle_id = cycle_id;
  
  if (start_date || end_date) {
    query.transaction_date = {};
    if (start_date) query.transaction_date.$gte = new Date(start_date);
    if (end_date) query.transaction_date.$lte = new Date(end_date);
  }

  const transactions = await Transaction.find(query)
    .populate('performed_by', 'name role')
    .populate('worker_id', 'name')
    .populate('merchant_id', 'name merchant_type')
    .sort({ transaction_date: -1 })
    .lean();

  res.status(200).json({ count: transactions.length, transactions });
});

// ==========================================
// 3. جلب ملخص أرصدة الخزينة (السيولة المتاحة)
// ==========================================
const getTreasuryBalance = asyncHandler(async (req, res, next) => {
  const { farm_id } = req.params;
  const orgId = req.user.organization_id;

  const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('المزرعة غير موجودة', 403));
  }

  const pipeline = [
    { $match: { farm_id: new mongoose.Types.ObjectId(farm_id) } },
    {
      $group: {
        _id: '$type',
        total: { $sum: '$amount' }
      }
    }
  ];

  const results = await Transaction.aggregate(pipeline);

  let totalIn = 0;
  let totalOut = 0;

  results.forEach(result => {
    if (result._id === 'IN') totalIn = result.total;
    if (result._id === 'OUT') totalOut = result.total;
  });

  const netBalance = totalIn - totalOut;

  res.status(200).json({
    total_in: totalIn,
    total_out: totalOut,
    net_balance: netBalance
  });
});

module.exports = {
  createTransaction,
  getTransactions,
  getTreasuryBalance
};