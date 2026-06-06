const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Merchant = require('../models/Merchant');
const Transaction = require('../models/Transaction');
const Farm = require('../models/Farm');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 1. إنشاء فاتورة جديدة (بيع / شراء) مع معالجة الدفعة المُقدمة
// ==========================================
const createInvoice = asyncHandler(async (req, res, next) => {
  const {
    local_id,
    farm_id,
    merchant_id,
    cycle_id,
    invoice_type,
    items,
    total_amount,
    paid_amount,
    invoice_date,
    due_date,
    notes,
    transaction_category, // 🚀 مطلوب لتوجيه الدفعة في الخزينة إذا كان هناك دفع نقدي
  } = req.body;

  const orgId = req.user.organization_id;

  if (
    !local_id ||
    !farm_id ||
    !merchant_id ||
    !invoice_type ||
    !items ||
    !total_amount ||
    !invoice_date
  ) {
    return next(new AppError('البيانات الأساسية للفاتورة غير مكتملة', 400));
  }

  const numericTotal = Number(total_amount);
  const numericPaid = Number(paid_amount) || 0;

  if (numericTotal <= 0) {
    return next(new AppError('إجمالي الفاتورة يجب أن يكون أكبر من الصفر', 400));
  }
  if (numericPaid > numericTotal) {
    return next(
      new AppError('المبلغ المدفوع لا يمكن أن يتجاوز إجمالي الفاتورة', 400)
    );
  }

  // 1. حاجز منع التكرار (Offline Support)
  const existingInvoice = await Invoice.findOne({ local_id }).lean();
  if (existingInvoice) {
    return res
      .status(200)
      .json({
        message: 'تم تسجيل هذه الفاتورة مسبقاً',
        invoice: existingInvoice,
      });
  }

  // 2. التحقق من صلاحية المزرعة والتاجر
  const farm = await Farm.findOne({
    _id: farm_id,
    organization_id: orgId,
  }).lean();
  if (!farm)
    return next(
      new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول', 403)
    );

  const merchant = await Merchant.findOne({ _id: merchant_id, farm_id }).lean();
  if (!merchant)
    return next(
      new AppError('التاجر أو المورد المختار غير موجود في هذه المزرعة', 404)
    );

  if (numericPaid > 0 && !transaction_category) {
    return next(
      new AppError(
        'يجب تحديد بند الخزينة (Transaction Category) لتسجيل الدفعة النقدية المُقدمة',
        400
      )
    );
  }

  const remaining_amount = numericTotal - numericPaid;
  let payment_status = 'UNPAID';
  if (numericPaid > 0)
    payment_status = remaining_amount === 0 ? 'PAID' : 'PARTIAL';

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 3. إنشاء الفاتورة
    const [newInvoice] = await Invoice.create(
      [
        {
          local_id,
          farm_id,
          merchant_id,
          cycle_id: cycle_id || null,
          created_by: req.user._id,
          invoice_type,
          items,
          total_amount: numericTotal,
          paid_amount: numericPaid,
          remaining_amount,
          payment_status,
          invoice_date: new Date(invoice_date),
          due_date: due_date ? new Date(due_date) : null,
          notes: notes ? notes.trim() : '',
        },
      ],
      { session }
    );

    // 4. تسجيل الدفعة في الخزينة فوراً إذا تم دفع جزء "كاش" وقت الفاتورة
    if (numericPaid > 0) {
      const transactionType = ['PURCHASE', 'RETURN_SALE'].includes(invoice_type)
        ? 'OUT'
        : 'IN';

      await Transaction.create(
        [
          {
            local_id: `${local_id}_PAYMENT`, // توليد Local ID مشتق للعملية النقدية
            farm_id,
            cycle_id: cycle_id || null,
            merchant_id,
            invoice_id: newInvoice._id,
            performed_by: req.user._id,
            type: transactionType,
            category: transaction_category,
            amount: numericPaid,
            transaction_date: new Date(invoice_date),
            reference_doc: `دفعة مقدمة لفاتورة رقم ${newInvoice._id.toString().slice(-6)}`,
          },
        ],
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'تم إصدار الفاتورة وتوجيه الحسابات بنجاح',
      invoice: newInvoice,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    if (error.isOperational) return next(error);
    console.error('Invoice Creation Error:', error);
    return next(
      new AppError(
        'فشل في إصدار الفاتورة، تم التراجع عن القيود المالي لحماية النظام',
        500
      )
    );
  }
});

// ==========================================
// 2. جلب الفواتير (مع فلاتر البحث والتقارير)
// ==========================================
const getInvoices = asyncHandler(async (req, res, next) => {
  const { farm_id } = req.params;
  const {
    merchant_id,
    invoice_type,
    payment_status,
    cycle_id,
    start_date,
    end_date,
  } = req.query;
  const orgId = req.user.organization_id;

  const farm = await Farm.findOne({
    _id: farm_id,
    organization_id: orgId,
  }).lean();
  if (!farm) return next(new AppError('المزرعة غير موجودة', 403));

  let query = { farm_id };
  if (merchant_id) query.merchant_id = merchant_id;
  if (invoice_type) query.invoice_type = invoice_type;
  if (payment_status) query.payment_status = payment_status;
  if (cycle_id) query.cycle_id = cycle_id;

  if (start_date || end_date) {
    query.invoice_date = {};
    if (start_date) query.invoice_date.$gte = new Date(start_date);
    if (end_date) query.invoice_date.$lte = new Date(end_date);
  }

  const invoices = await Invoice.find(query)
    .populate('merchant_id', 'name merchant_type phone')
    .populate('created_by', 'name role')
    .sort({ invoice_date: -1 })
    .lean();

  res.status(200).json({ count: invoices.length, invoices });
});

// ==========================================
// 3. جلب تفاصيل فاتورة محددة (مع حركات السداد الخاصة بها)
// ==========================================
const getInvoiceDetails = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const orgId = req.user.organization_id;

  const invoice = await Invoice.findById(id)
    .populate('merchant_id', 'name merchant_type')
    .populate('created_by', 'name')
    .populate('cycle_id', 'name')
    .lean();

  if (!invoice) return next(new AppError('الفاتورة غير موجودة', 404));

  const farm = await Farm.findOne({
    _id: invoice.farm_id,
    organization_id: orgId,
  }).lean();
  if (!farm)
    return next(new AppError('غير مصرح لك باستعراض هذه الفاتورة', 403));

  // جلب كافة الدفعات التي تمت على هذه الفاتورة من الخزينة
  const payments = await Transaction.find({ invoice_id: id })
    .select('amount type transaction_date performed_by reference_doc')
    .populate('performed_by', 'name')
    .sort({ transaction_date: -1 })
    .lean();

  res.status(200).json({ invoice, payment_history: payments });
});

// ==========================================
// 4. الحذف النهائي للفاتورة (مع حماية صارمة)
// ==========================================
const deleteInvoice = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const orgId = req.user.organization_id;

  const invoice = await Invoice.findById(id);
  if (!invoice) return next(new AppError('الفاتورة غير موجودة', 404));

  const farm = await Farm.findOne({
    _id: invoice.farm_id,
    organization_id: orgId,
  }).lean();
  if (!farm) return next(new AppError('لا تملك صلاحية حذف هذه الفاتورة', 403));

  // 🛡️ حاجز محاسبي صارم: يُمنع نهائياً حذف فاتورة تم دفع أي جزء منها
  if (invoice.paid_amount > 0) {
    return next(
      new AppError(
        'إجراء مرفوض: لا يمكن حذف فاتورة تحتوي على دفعات مسددة لأن ذلك سيسبب عجزاً في الخزينة. يجب عمل "مرتجع فاتورة" بدلاً من الحذف.',
        400
      )
    );
  }

  await Invoice.findByIdAndDelete(id);
  res.status(200).json({ message: 'تم إلغاء الفاتورة من النظام بنجاح' });
});

module.exports = {
  createInvoice,
  getInvoices,
  getInvoiceDetails,
  deleteInvoice,
};
