const mongoose = require('mongoose');
const Merchant = require('../models/Merchant');
const Farm = require('../models/Farm');
const Invoice = require('../models/Invoice');
const Transaction = require('../models/Transaction');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// 1. إضافة تاجر أو مورد جديد
// ==========================================
const addMerchant = asyncHandler(async (req, res, next) => {
  const { farm_id, name, merchant_type, phone, address, opening_balance } = req.body;
  const orgId = req.user.organization_id;

  if (!farm_id || !name || !merchant_type) {
    return next(new AppError('البيانات الأساسية (المزرعة، الاسم، نوع النشاط) مطلوبة', 400));
  }

  // حاجز أمني: التحقق من ملكية المزرعة
  const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403));
  }

  // حاجز أمني: منع تكرار نفس التاجر بنفس النشاط في نفس المزرعة
  const existingMerchant = await Merchant.findOne({ 
    farm_id, 
    name: name.trim(), 
    merchant_type 
  }).lean();
  
  if (existingMerchant) {
    return next(new AppError('هذا التاجر أو المورد مسجل بالفعل بهذا النشاط في النظام', 400));
  }

  const newMerchant = await Merchant.create({
    farm_id,
    name: name.trim(),
    merchant_type,
    phone: phone ? phone.trim() : '',
    address: address ? address.trim() : '',
    opening_balance: Number(opening_balance) || 0
  });

  res.status(201).json({ 
    message: 'تم تسجيل بيانات التاجر/المورد بنجاح', 
    merchant: newMerchant 
  });
});

// ==========================================
// 2. جلب قائمة التجار لمزرعة معينة (مع إمكانية الفلترة بنوع النشاط)
// ==========================================
const getMerchants = asyncHandler(async (req, res, next) => {
  const { farm_id } = req.params;
  const { merchant_type, status } = req.query;
  const orgId = req.user.organization_id;

  const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('المزرعة غير موجودة', 404));
  }

  let query = { farm_id };
  if (merchant_type) query.merchant_type = merchant_type;
  if (status) query.status = status;

  const merchants = await Merchant.find(query)
    .sort({ name: 1 })
    .lean();

  res.status(200).json({ count: merchants.length, merchants });
});

// ==========================================
// 3. تعديل بيانات التاجر
// ==========================================
const updateMerchant = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, phone, address, status } = req.body;
  const orgId = req.user.organization_id;

  const merchant = await Merchant.findById(id);
  if (!merchant) {
    return next(new AppError('التاجر أو المورد غير موجود', 404));
  }

  // التحقق من الملكية عبر المزرعة
  const farm = await Farm.findOne({ _id: merchant.farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('لا تملك صلاحية التعديل على بيانات هذا التاجر', 403));
  }

  if (name) merchant.name = name.trim();
  if (phone !== undefined) merchant.phone = phone.trim();
  if (address !== undefined) merchant.address = address.trim();
  if (status) merchant.status = status;

  // ملاحظة هندسية: يمنع تعديل (الرصيد الافتتاحي) أو (نوع التاجر) بعد الإنشاء لمنع التلاعب المحاسبي

  await merchant.save();
  res.status(200).json({ message: 'تم تحديث بيانات التاجر بنجاح', merchant });
});

// ==========================================
// 4. استخراج كشف حساب التاجر (Ledger Statement)
// ==========================================
const getMerchantStatement = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const orgId = req.user.organization_id;

  const merchant = await Merchant.findById(id).lean();
  if (!merchant) {
    return next(new AppError('التاجر غير موجود', 404));
  }

  const farm = await Farm.findOne({ _id: merchant.farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('لا تملك صلاحية الوصول لكشف حساب هذا التاجر', 403));
  }

  // 1. جلب الفواتير المرتبطة
  const invoices = await Invoice.find({ merchant_id: id })
    .select('invoice_type total_amount paid_amount remaining_amount invoice_date payment_status')
    .sort({ invoice_date: -1 })
    .lean();

  // 2. جلب المدفوعات المستقلة أو المرتبطة بفواتير من الخزينة
  const transactions = await Transaction.find({ merchant_id: id })
    .select('type amount transaction_date category reference_doc invoice_id')
    .sort({ transaction_date: -1 })
    .lean();

  // 3. حساب الرصيد الحالي بناءً على نوع التاجر
  let currentBalance = merchant.opening_balance;
  
  invoices.forEach(inv => {
    // إذا كان مورداً (نحن نشتري منه)، فالفاتورة تزيد الديون علينا
    if (inv.invoice_type === 'PURCHASE') currentBalance -= inv.remaining_amount;
    // إذا كان عميلاً (نحن نبيع له)، فالفاتورة تزيد الديون لنا
    if (inv.invoice_type === 'SALE') currentBalance += inv.remaining_amount;
  });

  res.status(200).json({
    merchant_info: {
      name: merchant.name,
      type: merchant.merchant_type,
      status: merchant.status,
      opening_balance: merchant.opening_balance,
      current_calculated_balance: currentBalance // موجب = التاجر مدين لنا / سالب = التاجر دائن (نحن مدينون له)
    },
    invoices_history: invoices,
    transactions_history: transactions
  });
});

// ==========================================
// 5. الحذف النهائي للتاجر (مع حماية القيود المرجعية)
// ==========================================
const deleteMerchant = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const orgId = req.user.organization_id;

  const merchant = await Merchant.findById(id);
  if (!merchant) {
    return next(new AppError('التاجر غير موجود', 404));
  }

  const farm = await Farm.findOne({ _id: merchant.farm_id, organization_id: orgId }).lean();
  if (!farm) {
    return next(new AppError('لا تملك صلاحية حذف هذا التاجر', 403));
  }

  // حاجز أمني: التحقق من وجود فواتير مرتبطة
  const hasInvoices = await Invoice.exists({ merchant_id: id });
  if (hasInvoices) {
    return next(new AppError('إجراء مرفوض: لا يمكن حذف التاجر لوجود فواتير مسجلة باسمه. قم بتغيير حالته إلى (INACTIVE) بدلاً من الحذف.', 400));
  }

  // حاجز أمني: التحقق من وجود حركات مالية في الخزينة
  const hasTransactions = await Transaction.exists({ merchant_id: id });
  if (hasTransactions) {
    return next(new AppError('إجراء مرفوض: لا يمكن حذف التاجر لوجود حركات مالية مسجلة باسمه في الخزينة.', 400));
  }

  await Merchant.findByIdAndDelete(id);
  res.status(200).json({ message: 'تم حذف التاجر من النظام بشكل آمن' });
});

module.exports = {
  addMerchant,
  getMerchants,
  updateMerchant,
  getMerchantStatement,
  deleteMerchant
};