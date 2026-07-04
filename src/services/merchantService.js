const Merchant = require('../models/Merchant');
const Farm = require('../models/Farm');
const Invoice = require('../models/Invoice');
const Transaction = require('../models/Transaction');
const AppError = require('../utils/AppError');
const transactionService = require('./transactionService'); // 🚀 استدعاء خدمة الخزينة لتسجيل الدفعات

class MerchantService {
  async createMerchant(data, orgId) {
    const { farm_id, company_name, merchant_type, company_phone, address, opening_balance, representatives } = data;

    const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
    if (!farm) throw new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403);

    try {
      return await Merchant.create({
        organization_id: orgId, 
        farm_id,
        company_name: company_name.trim(),
        merchant_type,
        company_phone: company_phone ? company_phone.trim() : '',
        address: address ? address.trim() : '',
        opening_balance: Number(opening_balance) || 0,
        representatives: Array.isArray(representatives) ? representatives : []
      });
    } catch (error) {
      if (error.code === 11000) {
        throw new AppError('هذه الشركة مسجلة بالفعل بنفس النشاط في النظام', 400);
      }
      throw error;
    }
  }

  async getMerchants(farmId, orgId, filters) {
    const query = { farm_id: farmId, organization_id: orgId };
    if (filters.merchant_type) query.merchant_type = filters.merchant_type;
    if (filters.status) query.status = filters.status;

    return await Merchant.find(query).sort({ company_name: 1 }).lean();
  }

  async getMerchants(farmId, orgId, filters) {
    const query = { farm_id: farmId, organization_id: orgId };
    if (filters.merchant_type) query.merchant_type = filters.merchant_type;
    if (filters.status) query.status = filters.status;

    const merchants = await Merchant.find(query).sort({ company_name: 1 }).lean();

    for (let merchant of merchants) {
      const [invoices, transactions] = await Promise.all([
        Invoice.find({ merchant_id: merchant._id, organization_id: orgId }).select('invoice_type remaining_amount').lean(),
        Transaction.find({ merchant_id: merchant._id, organization_id: orgId }).select('type amount invoice_id').lean()
      ]);

      let currentBalance = merchant.opening_balance || 0;
      invoices.forEach(inv => {
        if (inv.invoice_type === 'PURCHASE') currentBalance -= inv.remaining_amount;
        if (inv.invoice_type === 'SALE') currentBalance += inv.remaining_amount;
      });
      transactions.forEach(tx => {
        if (!tx.invoice_id) {
          if (tx.type === 'IN') currentBalance -= tx.amount;
          if (tx.type === 'OUT') currentBalance += tx.amount;
        }
      });
      merchant.current_balance = currentBalance;
    }

    return merchants;
  }

  async removeRepresentative(merchantId, repId, orgId) {
    const merchant = await Merchant.findOne({ _id: merchantId, organization_id: orgId });
    if (!merchant) throw new AppError('الشركة غير موجودة', 404);

    merchant.representatives.id(repId).deleteOne();
    await merchant.save();
    return merchant;
  }

  async recordPayment(merchantId, orgId, paymentData, userId) {
    const merchant = await Merchant.findOne({ _id: merchantId, organization_id: orgId });
    if (!merchant) throw new AppError('الشركة غير موجودة', 404);

    const { amount, type, transaction_date, notes, rep_name } = paymentData;

    let defaultNotes = type === 'IN' 
      ? `تسديد دفعة نقدية من حساب (${merchant.company_name})` 
      : `صرف دفعة نقدية لحساب (${merchant.company_name})`;
    
    if (rep_name) defaultNotes += ` - المندوب: ${rep_name}`;

    // توجيه العملية لخدمة الخزينة لتسجيلها بشكل ذري آمن
    return await transactionService.recordTransaction({
        local_id: `PAY_${Date.now()}`,
        farm_id: merchant.farm_id,
        type: type, // 'IN' قبض من التاجر, 'OUT' صرف للتاجر
        category: 'MERCHANT_PAYMENT',
        amount: amount,
        transaction_date: transaction_date || new Date(),
        merchant_id: merchantId,
        notes: notes || defaultNotes,
    }, orgId, userId);
  }

  async getMerchantStatement(merchantId, orgId) {
    const merchant = await Merchant.findOne({ _id: merchantId, organization_id: orgId }).lean();
    if (!merchant) throw new AppError('الشركة غير موجودة أو لا تملك صلاحية الوصول لكشف حسابها', 404);

    const [invoices, transactions] = await Promise.all([
      Invoice.find({ merchant_id: merchantId, organization_id: orgId })
        .sort({ invoice_date: -1 })
        .lean(),
      
      Transaction.find({ merchant_id: merchantId, organization_id: orgId })
        .sort({ transaction_date: -1 })
        .lean()
    ]);

    let currentBalance = merchant.opening_balance;
    let totalPurchasesQty = 0; 

    // 1. حساب المديونية بناءً على الفواتير
    invoices.forEach(inv => {
      if (inv.invoice_type === 'PURCHASE') {
        currentBalance -= inv.remaining_amount;
      }
      if (inv.invoice_type === 'SALE') {
        currentBalance += inv.remaining_amount;
        const qty = inv.quantity || (inv.items && inv.items.length > 0 ? inv.items[0].quantity : 0);
        totalPurchasesQty += Number(qty);
      }
    });

    transactions.forEach(tx => {
      if (!tx.invoice_id) { // سداد عام للحساب
        if (tx.type === 'IN') currentBalance -= tx.amount; // التاجر دفع لنا (قلت مديونيته)
        if (tx.type === 'OUT') currentBalance += tx.amount; // نحن دفعنا للتاجر (زادت مديونيته)
      }
    });

    return {
      merchant_info: {
        company_name: merchant.company_name,
        representatives: merchant.representatives,
        type: merchant.merchant_type,
        status: merchant.status,
        opening_balance: merchant.opening_balance,
        current_calculated_balance: currentBalance
      },
      total_purchases_qty: totalPurchasesQty,
      invoices_history: invoices,
      transactions_history: transactions
    };
  }

  async deleteMerchant(merchantId, orgId) {
    const merchant = await Merchant.findOne({ _id: merchantId, organization_id: orgId });
    if (!merchant) throw new AppError('الشركة غير موجودة أو لا تملك صلاحية حذفها', 404);

    const [hasInvoices, hasTransactions] = await Promise.all([
      Invoice.exists({ merchant_id: merchantId, organization_id: orgId }),
      Transaction.exists({ merchant_id: merchantId, organization_id: orgId })
    ]);

    if (hasInvoices) throw new AppError('إجراء مرفوض: لا يمكن حذف الشركة لوجود فواتير مسجلة باسمها.', 400);
    if (hasTransactions) throw new AppError('إجراء مرفوض: لا يمكن حذف الشركة لوجود حركات مالية مسجلة باسمها في الخزينة.', 400);

    await Merchant.findByIdAndDelete(merchantId);
    return true;
  }
}

module.exports = new MerchantService();