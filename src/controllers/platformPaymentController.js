const platformPaymentService = require('../services/platformPaymentService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

/**
 * @desc    Submit a new payment request for subscription renewal
 * @route   POST /api/platform-payments
 * @access  Private (Owner)
 */
const submitPaymentRequest = asyncHandler(async (req, res, next) => {
  const { farm_id, amount_paid, transfer_number, requested_months } = req.body;

  const numAmount = Number(amount_paid);
  const numMonths = Number(requested_months);

  if (!farm_id || isNaN(numAmount) || numAmount <= 0 || !transfer_number || isNaN(numMonths) || numMonths <= 0) {
    return next(new AppError('جميع الحقول (المزرعة، المبلغ الصحيح، رقم التحويل، ومدة الباقة الصحيحة) مطلوبة', 400));
  }

  if (!req.file || !req.file.path) {
    return next(new AppError('صورة إيصال التحويل مطلوبة لاعتماد الدفع', 400));
  }

  const payment = await platformPaymentService.submitPaymentRequest(req.body, req.user.organization_id, req.file.path);

  res.status(201).json({
    message: 'تم إرسال طلب التجديد بنجاح! سيتم تفعيل الباقة فور مراجعة الإيصال.',
    payment,
  });
});

/**
 * @desc    Get payment history for the current owner
 * @route   GET /api/platform-payments/history
 * @access  Private (Owner)
 */
const getOwnerPaymentHistory = asyncHandler(async (req, res, next) => {
  const payments = await platformPaymentService.getOwnerPaymentHistory(req.user.organization_id);
  res.status(200).json(payments);
});

/**
 * @desc    Clear payment history from owner view
 * @route   DELETE /api/platform-payments/history/farm/:farmId
 * @access  Private (Owner)
 */
const clearFarmHistory = asyncHandler(async (req, res, next) => {
  await platformPaymentService.clearFarmHistory(req.user.organization_id, req.params.farmId);
  res.status(200).json({ message: 'تم تنظيف السجل بنجاح' });
});

/**
 * @desc    Get all pending payments
 * @route   GET /api/platform-payments/pending
 * @access  Private (Super Admin)
 */
const getPendingPayments = asyncHandler(async (req, res, next) => {
  const pendingPayments = await platformPaymentService.getPendingPayments();
  res.status(200).json(pendingPayments);
});

/**
 * @desc    Review and process a payment request (Approve/Reject)
 * @route   PUT /api/platform-payments/:id/review
 * @access  Private (Super Admin)
 */
const reviewPaymentRequest = asyncHandler(async (req, res, next) => {
  const { action, admin_notes } = req.body;
  
  if (!action) {
    return next(new AppError('الرجاء تحديد الإجراء المطلوب (APPROVE أو REJECT)', 400));
  }

  const result = await platformPaymentService.reviewPaymentRequest(req.params.id, action, admin_notes);

  if (result.status === 'REJECTED') {
    return res.status(200).json({ message: 'تم رفض طلب الدفع بنجاح' });
  }

  return res.status(200).json({
    message: `تم اعتماد المبلغ وتمديد اشتراك المزرعة بنجاح لمدة ${result.months} شهر/شهور.`,
    new_end_date: result.newEndDate,
  });
});

module.exports = {
  submitPaymentRequest,
  getOwnerPaymentHistory,
  getPendingPayments,
  reviewPaymentRequest,
  clearFarmHistory,
};