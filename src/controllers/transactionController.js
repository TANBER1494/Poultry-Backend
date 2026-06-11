const transactionService = require('../services/transactionService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

/**
 * @desc    Record a new financial transaction (Income / Expense)
 * @route   POST /api/transactions
 * @access  Private
 */
const createTransaction = asyncHandler(async (req, res, next) => {
  const { local_id, farm_id, type, category, amount, transaction_date } = req.body;

  if (!local_id || !farm_id || !type || !category || !amount || !transaction_date) {
    return next(new AppError('البيانات الأساسية للمعاملة المالية غير مكتملة', 400));
  }

  const numericAmount = Number(amount);
  if (numericAmount <= 0) {
    return next(new AppError('قيمة المعاملة يجب أن تكون أكبر من الصفر', 400));
  }

  const result = await transactionService.recordTransaction(req.body, req.user.organization_id, req.user._id);

  if (result.isDuplicate) {
    return res.status(200).json({ 
      message: 'تم تسجيل هذه المعاملة مسبقاً', 
      transaction: result.transaction 
    });
  }

  res.status(201).json({
    message: 'تم تسجيل المعاملة المالية وتوجيه الحسابات بنجاح',
    transaction: result.transaction
  });
});

/**
 * @desc    Get general ledger transactions with filters
 * @route   GET /api/transactions/farm/:farm_id
 * @access  Private
 */
const getTransactions = asyncHandler(async (req, res, next) => {
  const transactions = await transactionService.getLedgerTransactions(req.params.farm_id, req.user.organization_id, req.query);
  res.status(200).json({ count: transactions.length, transactions });
});

/**
 * @desc    Get treasury balance summary
 * @route   GET /api/transactions/farm/:farm_id/balance
 * @access  Private
 */
const getTreasuryBalance = asyncHandler(async (req, res, next) => {
  const balance = await transactionService.getTreasuryBalance(req.params.farm_id, req.user.organization_id);
  res.status(200).json(balance);
});

module.exports = {
  createTransaction,
  getTransactions,
  getTreasuryBalance
};