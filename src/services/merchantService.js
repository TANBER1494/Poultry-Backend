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

    // هنا نحتاج استعلام المزرعة لمرة واحدة فقط للتأكد من وجودها قبل الربط
    const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
    if (!farm) throw new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403);

    try {
      //  الترقية المعمارية: الاعتماد على الفهرس المركب لمنع التكرار بدلاً من الاستعلام اليدوي
      return await Merchant.create({
        organization_id: orgId, 
        farm_id,
        name: name.trim(),
        merchant_type,
        phone: phone ? phone.trim() : '',
        address: address ? address.trim() : '',
        opening_balance: Number(opening_balance) || 0
      });
    } catch (error) {
      if (error.code === 11000) {
        throw new AppError('هذا التاجر أو المورد مسجل بالفعل بهذا النشاط في النظام', 400);
      }
      throw error;
    }
  }

  /**
   * جلب قائمة التجار مع الفلاتر
   */
  async getMerchants(farmId, orgId, filters) {
    //  الترقية المعمارية: توفير استعلام الـ Farm بالكامل والاعتماد على orgId
    const query = { farm_id: farmId, organization_id: orgId };
    if (filters.merchant_type) query.merchant_type = filters.merchant_type;
    if (filters.status) query.status = filters.status;

    return await Merchant.find(query).sort({ name: 1 }).lean();
  }

  /**
   * تحديث بيانات التاجر
   */
  async updateMerchant(merchantId, orgId, updates) {
    //  الترقية المعمارية: التوثيق والجلب في خطوة واحدة (O(1)) بدلاً من خطوتين
    const merchant = await Merchant.findOne({ _id: merchantId, organization_id: orgId });
    if (!merchant) throw new AppError('التاجر أو المورد غير موجود أو لا تملك صلاحية تعديله', 404);

    if (updates.name) merchant.name = updates.name.trim();
    if (updates.phone !== undefined) merchant.phone = updates.phone.trim();
    if (updates.address !== undefined) merchant.address = updates.address.trim();
    if (updates.status) merchant.status = updates.status;

    try {
      await merchant.save();
      return merchant;
    } catch (error) {
      if (error.code === 11000) throw new AppError('يوجد تاجر آخر مسجل بنفس الاسم والنشاط', 400);
      throw error;
    }
  }

  /**
   * استخراج كشف حساب التاجر (Ledger Statement)
   */
  async getMerchantStatement(merchantId, orgId) {
    //  الترقية المعمارية: سد ثغرة IDOR بحقن orgId مباشرة وتوفير استعلام زائد
    const merchant = await Merchant.findOne({ _id: merchantId, organization_id: orgId }).lean();
    if (!merchant) throw new AppError('التاجر غير موجود أو لا تملك صلاحية الوصول لكشف حسابه', 404);

    //  الترقية المعمارية: حقن orgId في المعاملات المالية لضمان التوافق المطلق
    const [invoices, transactions] = await Promise.all([
      Invoice.find({ merchant_id: merchantId, organization_id: orgId })
        .select('invoice_type total_amount paid_amount remaining_amount invoice_date payment_status')
        .sort({ invoice_date: -1 })
        .lean(),
      
      Transaction.find({ merchant_id: merchantId, organization_id: orgId })
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
    const merchant = await Merchant.findOne({ _id: merchantId, organization_id: orgId });
    if (!merchant) throw new AppError('التاجر غير موجود أو لا تملك صلاحية حذفه', 404);

    //  الترقية المعمارية: حقن orgId للتوثيق الصارم أثناء فحص القيود المرجعية
    const [hasInvoices, hasTransactions] = await Promise.all([
      Invoice.exists({ merchant_id: merchantId, organization_id: orgId }),
      Transaction.exists({ merchant_id: merchantId, organization_id: orgId })
    ]);

    if (hasInvoices) throw new AppError('إجراء مرفوض: لا يمكن حذف التاجر لوجود فواتير مسجلة باسمه. قم بتغيير حالته إلى (INACTIVE) بدلاً من الحذف.', 400);
    if (hasTransactions) throw new AppError('إجراء مرفوض: لا يمكن حذف التاجر لوجود حركات مالية مسجلة باسمه في الخزينة.', 400);

    await Merchant.findByIdAndDelete(merchantId);
    return true;
  }
}

module.exports = new MerchantService();