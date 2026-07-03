const Merchant = require('../models/Merchant');
const Farm = require('../models/Farm');
const Invoice = require('../models/Invoice');
const Transaction = require('../models/Transaction');
const AppError = require('../utils/AppError');

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

  async updateMerchant(merchantId, orgId, updates) {
    const merchant = await Merchant.findOne({ _id: merchantId, organization_id: orgId });
    if (!merchant) throw new AppError('الشركة غير موجودة أو لا تملك صلاحية تعديلها', 404);

    if (updates.company_name) merchant.company_name = updates.company_name.trim();
    if (updates.company_phone !== undefined) merchant.company_phone = updates.company_phone.trim();
    if (updates.address !== undefined) merchant.address = updates.address.trim();
    if (updates.status) merchant.status = updates.status;

    try {
      await merchant.save();
      return merchant;
    } catch (error) {
      if (error.code === 11000) throw new AppError('يوجد شركة أخرى مسجلة بنفس الاسم والنشاط', 400);
      throw error;
    }
  }

  //  دوال جديدة لإدارة المناديب المنفصلين
  async addRepresentative(merchantId, orgId, repData) {
    const merchant = await Merchant.findOne({ _id: merchantId, organization_id: orgId });
    if (!merchant) throw new AppError('الشركة غير موجودة', 404);
    
    // إذا كان هذا أول مندوب يتم إضافته، نجعله المندوب الأساسي
    if (merchant.representatives.length === 0) repData.is_primary = true;

    merchant.representatives.push(repData);
    await merchant.save();
    return merchant;
  }

  async removeRepresentative(merchantId, repId, orgId) {
    const merchant = await Merchant.findOne({ _id: merchantId, organization_id: orgId });
    if (!merchant) throw new AppError('الشركة غير موجودة', 404);

    // سحب (Pull) المندوب من المصفوفة بناءً على الـ ID الخاص به
    merchant.representatives.id(repId).deleteOne();
    await merchant.save();
    return merchant;
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

    invoices.forEach(inv => {
      if (inv.invoice_type === 'PURCHASE') {
        currentBalance -= inv.remaining_amount;
      }
      if (inv.invoice_type === 'SALE') {
        currentBalance += inv.remaining_amount;
        // حساب الكمية بأمان سواء كانت في الحقل المباشر أو داخل المصفوفة
        const qty = inv.quantity || (inv.items && inv.items.length > 0 ? inv.items[0].quantity : 0);
        totalPurchasesQty += Number(qty);
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