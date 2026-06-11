const Merchant = require('../models/Merchant');
const Farm = require('../models/Farm');
const Invoice = require('../models/Invoice');
const Transaction = require('../models/Transaction');
const AppError = require('../utils/AppError');

class MerchantService {
  /**
   * إضافة تاجر جديد
   */
  async createMerchant(data, orgId) {
    const { farm_id, name, merchant_type, phone, address, opening_balance } = data;

    const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
    if (!farm) throw new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403);

    const existingMerchant = await Merchant.findOne({ farm_id, name: name.trim(), merchant_type }).lean();
    if (existingMerchant) throw new AppError('هذا التاجر أو المورد مسجل بالفعل بهذا النشاط في النظام', 400);

    return await Merchant.create({
      organization_id: orgId, // Denormalization
      farm_id,
      name: name.trim(),
      merchant_type,
      phone: phone ? phone.trim() : '',
      address: address ? address.trim() : '',
      opening_balance: Number(opening_balance) || 0
    });
  }

  /**
   * جلب قائمة التجار مع الفلاتر
   */
  async getMerchants(farmId, orgId, filters) {
    const farm = await Farm.findOne({ _id: farmId, organization_id: orgId }).lean();
    if (!farm) throw new AppError('المزرعة غير موجودة', 404);

    const query = { farm_id: farmId };
    if (filters.merchant_type) query.merchant_type = filters.merchant_type;
    if (filters.status) query.status = filters.status;

    return await Merchant.find(query).sort({ name: 1 }).lean();
  }

  /**
   * تحديث بيانات التاجر
   */
  async updateMerchant(merchantId, orgId, updates) {
    const merchant = await Merchant.findById(merchantId);
    if (!merchant) throw new AppError('التاجر أو المورد غير موجود', 404);

    const farm = await Farm.findOne({ _id: merchant.farm_id, organization_id: orgId }).lean();
    if (!farm) throw new AppError('لا تملك صلاحية التعديل على بيانات هذا التاجر', 403);

    if (updates.name) merchant.name = updates.name.trim();
    if (updates.phone !== undefined) merchant.phone = updates.phone.trim();
    if (updates.address !== undefined) merchant.address = updates.address.trim();
    if (updates.status) merchant.status = updates.status;

    await merchant.save();
    return merchant;
  }

  /**
   * استخراج كشف حساب التاجر (Ledger Statement)
   * تم تحسينها باستخدام التنفيذ المتوازي لمعالجة أسرع
   */
  async getMerchantStatement(merchantId, orgId) {
    const merchant = await Merchant.findById(merchantId).lean();
    if (!merchant) throw new AppError('التاجر غير موجود', 404);

    const farm = await Farm.findOne({ _id: merchant.farm_id, organization_id: orgId }).lean();
    if (!farm) throw new AppError('لا تملك صلاحية الوصول لكشف حساب هذا التاجر', 403);

    // تنفيذ الاستعلامات بشكل متوازٍ لتقليل وقت الاستجابة
    const [invoices, transactions] = await Promise.all([
      Invoice.find({ merchant_id: merchantId })
        .select('invoice_type total_amount paid_amount remaining_amount invoice_date payment_status')
        .sort({ invoice_date: -1 })
        .lean(),
      
      Transaction.find({ merchant_id: merchantId })
        .select('type amount transaction_date category reference_doc invoice_id')
        .sort({ transaction_date: -1 })
        .lean()
    ]);

    // حساب الرصيد الحالي
    let currentBalance = merchant.opening_balance;
    invoices.forEach(inv => {
      if (inv.invoice_type === 'PURCHASE') currentBalance -= inv.remaining_amount;
      if (inv.invoice_type === 'SALE') currentBalance += inv.remaining_amount;
    });

    return {
      merchant_info: {
        name: merchant.name,
        type: merchant.merchant_type,
        status: merchant.status,
        opening_balance: merchant.opening_balance,
        current_calculated_balance: currentBalance
      },
      invoices_history: invoices,
      transactions_history: transactions
    };
  }

  /**
   * الحذف النهائي للتاجر مع الفحص المتوازي للقيود المرجعية
   */
  async deleteMerchant(merchantId, orgId) {
    const merchant = await Merchant.findById(merchantId);
    if (!merchant) throw new AppError('التاجر غير موجود', 404);

    const farm = await Farm.findOne({ _id: merchant.farm_id, organization_id: orgId }).lean();
    if (!farm) throw new AppError('لا تملك صلاحية حذف هذا التاجر', 403);

    // الفحص المتوازي للقيود المرجعية
    const [hasInvoices, hasTransactions] = await Promise.all([
      Invoice.exists({ merchant_id: merchantId }),
      Transaction.exists({ merchant_id: merchantId })
    ]);

    if (hasInvoices) throw new AppError('إجراء مرفوض: لا يمكن حذف التاجر لوجود فواتير مسجلة باسمه. قم بتغيير حالته إلى (INACTIVE) بدلاً من الحذف.', 400);
    if (hasTransactions) throw new AppError('إجراء مرفوض: لا يمكن حذف التاجر لوجود حركات مالية مسجلة باسمه في الخزينة.', 400);

    await Merchant.findByIdAndDelete(merchantId);
    return true;
  }
}

module.exports = new MerchantService();