const merchantService = require('../services/merchantService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

const addMerchant = asyncHandler(async (req, res, next) => {
  const { farm_id, company_name, merchant_type } = req.body;

  if (!farm_id || !company_name || !merchant_type) {
    return next(new AppError('البيانات الأساسية (المزرعة، اسم الشركة، نوع النشاط) مطلوبة', 400));
  }

  const newMerchant = await merchantService.createMerchant(req.body, req.user.organization_id);
  res.status(201).json({ message: 'تم تسجيل بيانات الشركة بنجاح', merchant: newMerchant });
});

const getMerchants = asyncHandler(async (req, res, next) => {
  const merchants = await merchantService.getMerchants(req.params.farm_id, req.user.organization_id, req.query);
  res.status(200).json({ count: merchants.length, merchants });
});

const updateMerchant = asyncHandler(async (req, res, next) => {
  const merchant = await merchantService.updateMerchant(req.params.id, req.user.organization_id, req.body);
  res.status(200).json({ message: 'تم تحديث بيانات الشركة بنجاح', merchant });
});

//  الكنترولرز الجديدة لإدارة المناديب
const addRepresentative = asyncHandler(async (req, res, next) => {
  const { name } = req.body;
  if (!name) return next(new AppError('اسم المندوب مطلوب', 400));

  const merchant = await merchantService.addRepresentative(req.params.id, req.user.organization_id, req.body);
  res.status(200).json({ message: 'تمت إضافة المندوب للشركة بنجاح', merchant });
});

const removeRepresentative = asyncHandler(async (req, res, next) => {
  const merchant = await merchantService.removeRepresentative(req.params.id, req.params.repId, req.user.organization_id);
  res.status(200).json({ message: 'تم حذف المندوب بنجاح', merchant });
});

const getMerchantStatement = asyncHandler(async (req, res, next) => {
  const statement = await merchantService.getMerchantStatement(req.params.id, req.user.organization_id);
  res.status(200).json(statement);
});

const deleteMerchant = asyncHandler(async (req, res, next) => {
  await merchantService.deleteMerchant(req.params.id, req.user.organization_id);
  res.status(200).json({ message: 'تم حذف الشركة من النظام بشكل آمن' });
});

module.exports = {
  addMerchant,
  getMerchants,
  updateMerchant,
  addRepresentative,
  removeRepresentative,
  getMerchantStatement,
  deleteMerchant
};