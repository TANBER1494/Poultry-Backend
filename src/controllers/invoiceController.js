const invoiceService = require('../services/invoiceService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

/**
 * @desc    Create a new invoice and handle partial payments
 * @route   POST /api/invoices
 * @access  Private
 */
const createInvoice = asyncHandler(async (req, res, next) => {
  const { local_id, farm_id, merchant_id, invoice_type, items, total_amount, invoice_date } = req.body;

  if (!local_id || !farm_id || !merchant_id || !invoice_type || !items || !total_amount || !invoice_date) {
    return next(new AppError('البيانات الأساسية للفاتورة غير مكتملة', 400));
  }

  const result = await invoiceService.createInvoice(req.body, req.user._id, req.user.organization_id);

  if (result.isDuplicate) {
    return res.status(200).json({
      message: 'تم تسجيل هذه الفاتورة مسبقاً',
      invoice: result.invoice,
    });
  }

  res.status(201).json({
    message: 'تم إصدار الفاتورة وتوجيه الحسابات بنجاح',
    invoice: result.invoice,
  });
});

/**
 * @desc    Get all invoices for a specific farm with filters
 * @route   GET /api/invoices/farm/:farm_id
 * @access  Private
 */
const getInvoices = asyncHandler(async (req, res, next) => {
  const invoices = await invoiceService.getInvoices(req.params.farm_id, req.user.organization_id, req.query);
  res.status(200).json({ count: invoices.length, invoices });
});

/**
 * @desc    Get single invoice details with its payment history
 * @route   GET /api/invoices/:id
 * @access  Private
 */
const getInvoiceDetails = asyncHandler(async (req, res, next) => {
  const details = await invoiceService.getInvoiceDetails(req.params.id, req.user.organization_id);
  res.status(200).json(details);
});

/**
 * @desc    Delete an unpaid invoice safely
 * @route   DELETE /api/invoices/:id
 * @access  Private
 */
const deleteInvoice = asyncHandler(async (req, res, next) => {
  await invoiceService.deleteInvoice(req.params.id, req.user.organization_id);
  res.status(200).json({ message: 'تم إلغاء الفاتورة من النظام بنجاح' });
});

module.exports = {
  createInvoice,
  getInvoices,
  getInvoiceDetails,
  deleteInvoice,
};