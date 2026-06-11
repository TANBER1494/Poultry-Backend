const merchantService = require('../services/merchantService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

/**
 * @desc    Add a new merchant or supplier
 * @route   POST /api/merchants
 * @access  Private
 */
const addMerchant = asyncHandler(async (req, res, next) => {
  const { farm_id, name, merchant_type } = req.body;

  if (!farm_id || !name || !merchant_type) {
    return next(new AppError('البيانات الأساسية (المزرعة، الاسم، نوع النشاط) مطلوبة', 400));
  }

  const newMerchant = await merchantService.createMerchant(req.body, req.user.organization_id);

  res.status(201).json({ 
    message: 'تم تسجيل بيانات التاجر/المورد بنجاح', 
    merchant: newMerchant 
  });
});

/**
 * @desc    Get merchants list for a farm
 * @route   GET /api/merchants/farm/:farm_id
 * @access  Private
 */
const getMerchants = asyncHandler(async (req, res, next) => {
  const merchants = await merchantService.getMerchants(req.params.farm_id, req.user.organization_id, req.query);
  res.status(200).json({ count: merchants.length, merchants });
});

/**
 * @desc    Update merchant details
 * @route   PUT /api/merchants/:id
 * @access  Private
 */
const updateMerchant = asyncHandler(async (req, res, next) => {
  const merchant = await merchantService.updateMerchant(req.params.id, req.user.organization_id, req.body);
  res.status(200).json({ message: 'تم تحديث بيانات التاجر بنجاح', merchant });
});

/**
 * @desc    Get complete ledger statement for a merchant
 * @route   GET /api/merchants/:id/statement
 * @access  Private
 */
const getMerchantStatement = asyncHandler(async (req, res, next) => {
  const statement = await merchantService.getMerchantStatement(req.params.id, req.user.organization_id);
  res.status(200).json(statement);
});

/**
 * @desc    Delete merchant safely
 * @route   DELETE /api/merchants/:id
 * @access  Private
 */
const deleteMerchant = asyncHandler(async (req, res, next) => {
  await merchantService.deleteMerchant(req.params.id, req.user.organization_id);
  res.status(200).json({ message: 'تم حذف التاجر من النظام بشكل آمن' });
});

module.exports = {
  addMerchant,
  getMerchants,
  updateMerchant,
  getMerchantStatement,
  deleteMerchant
};