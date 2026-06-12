const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Merchant = require('../models/Merchant');
const Transaction = require('../models/Transaction');
const Farm = require('../models/Farm');
const AppError = require('../utils/AppError');

class InvoiceService {
  /**
   * إصدار فاتورة جديدة مع توجيه الدفعات النقدية آلياً للخزينة
   */
  async createInvoice(data, userId, orgId) {
    const {
      local_id, farm_id, merchant_id, cycle_id, invoice_type,
      items, total_amount, paid_amount, invoice_date, due_date, notes, transaction_category
    } = data;

    const numericTotal = Number(total_amount);
    const numericPaid = Number(paid_amount) || 0;

    if (numericTotal <= 0) throw new AppError('إجمالي الفاتورة يجب أن يكون أكبر من الصفر', 400);
    if (numericPaid > numericTotal) throw new AppError('المبلغ المدفوع لا يمكن أن يتجاوز إجمالي الفاتورة', 400);

    const existingInvoice = await Invoice.findOne({ local_id }).lean();
    if (existingInvoice) return { isDuplicate: true, invoice: existingInvoice };

    const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
    if (!farm) throw new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول', 403);

    //  الترقية المعمارية: الاستفادة من orgId في البحث لضمان أمان الـ IDOR للتاجر
    const merchant = await Merchant.findOne({ _id: merchant_id, farm_id, organization_id: orgId }).lean();
    if (!merchant) throw new AppError('التاجر أو المورد المختار غير موجود في هذه المزرعة', 404);

    if (numericPaid > 0 && !transaction_category) {
      throw new AppError('يجب تحديد بند الخزينة (Transaction Category) لتسجيل الدفعة النقدية المُقدمة', 400);
    }

    const remaining_amount = numericTotal - numericPaid;
    const payment_status = numericPaid === 0 ? 'UNPAID' : (remaining_amount === 0 ? 'PAID' : 'PARTIAL');

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const [newInvoice] = await Invoice.create([{
        organization_id: orgId, 
        local_id,
        farm_id,
        merchant_id,
        cycle_id: cycle_id || null,
        created_by: userId,
        invoice_type,
        items,
        total_amount: numericTotal,
        paid_amount: numericPaid,
        remaining_amount,
        payment_status,
        invoice_date: new Date(invoice_date),
        due_date: due_date ? new Date(due_date) : null,
        notes: notes ? notes.trim() : '',
      }], { session });

      if (numericPaid > 0) {
        const transactionType = ['PURCHASE', 'RETURN_SALE'].includes(invoice_type) ? 'OUT' : 'IN';

        //  الترقية المعمارية: إصلاح اللغم البرمجي بتمرير organization_id للخزينة
        await Transaction.create([{
          local_id: `${local_id}_PAYMENT`,
          organization_id: orgId, 
          farm_id,
          cycle_id: cycle_id || null,
          merchant_id,
          invoice_id: newInvoice._id,
          performed_by: userId,
          type: transactionType,
          category: transaction_category,
          amount: numericPaid,
          transaction_date: new Date(invoice_date),
          reference_doc: `دفعة مقدمة لفاتورة رقم ${newInvoice._id.toString().slice(-6)}`,
        }], { session });
      }

      await session.commitTransaction();
      return { isDuplicate: false, invoice: newInvoice };

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * جلب الفواتير مع تطبيق الفلاتر
   */
  async getInvoices(farmId, orgId, filters) {
    const farm = await Farm.findOne({ _id: farmId, organization_id: orgId }).lean();
    if (!farm) throw new AppError('المزرعة غير موجودة', 403);

    //  الترقية المعمارية: دمج orgId في استعلام البحث لزيادة الأمان
    const query = { farm_id: farmId, organization_id: orgId };
    if (filters.merchant_id) query.merchant_id = filters.merchant_id;
    if (filters.invoice_type) query.invoice_type = filters.invoice_type;
    if (filters.payment_status) query.payment_status = filters.payment_status;
    if (filters.cycle_id) query.cycle_id = filters.cycle_id;

    if (filters.start_date || filters.end_date) {
      query.invoice_date = {};
      if (filters.start_date) query.invoice_date.$gte = new Date(filters.start_date);
      if (filters.end_date) query.invoice_date.$lte = new Date(filters.end_date);
    }

    return await Invoice.find(query)
      .populate('merchant_id', 'name merchant_type phone')
      .populate('created_by', 'name role')
      .sort({ invoice_date: -1 })
      .lean();
  }

  /**
   * جلب تفاصيل الفاتورة مع حركات الخزينة المرتبطة بها
   */
  async getInvoiceDetails(invoiceId, orgId) {
    //  الترقية المعمارية: استعلام O(1) بدلاً من استعلامين متسلسلين
    const invoice = await Invoice.findOne({ _id: invoiceId, organization_id: orgId })
      .populate('merchant_id', 'name merchant_type')
      .populate('created_by', 'name')
      .populate('cycle_id', 'name')
      .lean();

    if (!invoice) throw new AppError('الفاتورة غير موجودة أو غير مصرح لك باستعراضها', 404);

    const payments = await Transaction.find({ invoice_id: invoiceId, organization_id: orgId })
      .select('amount type transaction_date performed_by reference_doc')
      .populate('performed_by', 'name')
      .sort({ transaction_date: -1 })
      .lean();

    return { invoice, payment_history: payments };
  }

  /**
   * حذف الفاتورة مع تطبيق قواعد الحماية المحاسبية
   */
  async deleteInvoice(invoiceId, orgId) {
    //  الترقية المعمارية: استعلام التحقق والملكية في خطوة واحدة
    const invoice = await Invoice.findOne({ _id: invoiceId, organization_id: orgId });
    if (!invoice) throw new AppError('الفاتورة غير موجودة أو لا تملك صلاحية حذفها', 404);

    // القاعدة المحاسبية: يمنع حذف فاتورة بها حركات مالية
    if (invoice.paid_amount > 0) {
      throw new AppError('إجراء مرفوض: لا يمكن حذف فاتورة تحتوي على دفعات مسددة لأن ذلك سيسبب عجزاً في الخزينة. يجب عمل "مرتجع فاتورة" بدلاً من الحذف.', 400);
    }

    await Invoice.findByIdAndDelete(invoiceId);
    return true;
  }
}

module.exports = new InvoiceService();