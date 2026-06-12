const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Invoice = require('../models/Invoice');
const Cycle = require('../models/Cycle');
const Farm = require('../models/Farm');
const AppError = require('../utils/AppError');

class TransactionService {
  /**
   * تسجيل معاملة مالية وتوجيه القيود بشكل آمن ضد التزامن
   */
  async recordTransaction(data, orgId, userId) {
    const {
      local_id, farm_id, type, category, amount, transaction_date,
      cycle_id, worker_id, merchant_id, invoice_id, notes, reference_doc
    } = data;

    const numericAmount = Number(amount);

    const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
    if (!farm) throw new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403);

    const existingTransaction = await Transaction.findOne({ local_id }).lean();
    if (existingTransaction) {
      return { isDuplicate: true, transaction: existingTransaction };
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1. معالجة تسديد الفواتير (تحديث ذري آمن)
      if (invoice_id) {
        //  الترقية المعمارية: تضمين organization_id في التحديث الذري لمنع التلاعب
        const updatedInvoice = await Invoice.findOneAndUpdate(
          { 
            _id: invoice_id, 
            farm_id, 
            organization_id: orgId,
            remaining_amount: { $gte: numericAmount } 
          },
          { 
            $inc: { 
              paid_amount: numericAmount, 
              remaining_amount: -numericAmount 
            } 
          },
          { new: true, session }
        );

        if (!updatedInvoice) {
          throw new AppError('الفاتورة غير موجودة، أو المبلغ المدفوع يتجاوز القيمة المتبقية للفاتورة', 400);
        }

        const paymentStatus = updatedInvoice.remaining_amount === 0 ? 'PAID' : 'PARTIAL';
        await Invoice.updateOne(
          { _id: invoice_id }, 
          { paymentStatus: paymentStatus }, 
          { session }
        );
      } 
      // 2. معالجة المعاملات النقدية المباشرة المؤثرة على الدورة
      else if (cycle_id) {
        let cycleIncQuery = {};
        
        if (type === 'IN') {
          cycleIncQuery = { total_revenue: numericAmount };
        } else if (type === 'OUT' && !['FEED_PURCHASE', 'MED_PURCHASE'].includes(category)) {
          cycleIncQuery = { total_expenses: numericAmount };
        }

        if (Object.keys(cycleIncQuery).length > 0) {
          // 🛡️ الترقية المعمارية: تأمين التحديث الذري للدورة
          await Cycle.findOneAndUpdate(
            { _id: cycle_id, farm_id, organization_id: orgId, status: { $ne: 'CLOSED' } },
            { $inc: cycleIncQuery },
            { session }
          );
        }
      }

      // 3. إنشاء القيد المالي في الخزينة
      //  الترقية المعمارية: إصلاح اللغم البرمجي وحقن organization_id الإلزامي
      const [newTransaction] = await Transaction.create([{
        local_id,
        organization_id: orgId, 
        farm_id,
        cycle_id: cycle_id || null,
        worker_id: worker_id || null,
        merchant_id: merchant_id || null,
        invoice_id: invoice_id || null,
        performed_by: userId,
        type,
        category,
        amount: numericAmount,
        transaction_date: new Date(transaction_date),
        notes: notes ? notes.trim() : '',
        reference_doc: reference_doc ? reference_doc.trim() : ''
      }], { session });

      await session.commitTransaction();
      return { isDuplicate: false, transaction: newTransaction };

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * جلب حركات الخزينة (دفتر الأستاذ)
   */
  async getLedgerTransactions(farmId, orgId, filters) {
    //  الترقية المعمارية: توفير استعلام الـ Farm الزائد، والاعتماد المباشر على orgId في الخزينة
    const query = { farm_id: farmId, organization_id: orgId };
    
    if (filters.type) query.type = filters.type;
    if (filters.category) query.category = filters.category;
    if (filters.cycle_id) query.cycle_id = filters.cycle_id;
    
    if (filters.start_date || filters.end_date) {
      query.transaction_date = {};
      if (filters.start_date) query.transaction_date.$gte = new Date(filters.start_date);
      if (filters.end_date) query.transaction_date.$lte = new Date(filters.end_date);
    }

    return await Transaction.find(query)
      .populate('performed_by', 'name role')
      .populate('worker_id', 'name')
      .populate('merchant_id', 'name merchant_type')
      .sort({ transaction_date: -1 })
      .lean();
  }

  /**
   * جلب ملخص السيولة النقدية باستخدام Aggregation
   */
  async getTreasuryBalance(farmId, orgId) {
    //  الترقية المعمارية: استعلام O(1) صارم، مع إزالة البحث الدائري في جدول المزارع
    const pipeline = [
      { 
        $match: { 
          farm_id: new mongoose.Types.ObjectId(farmId),
          organization_id: new mongoose.Types.ObjectId(orgId) 
        } 
      },
      {
        $group: {
          _id: '$type',
          total: { $sum: '$amount' }
        }
      }
    ];

    const results = await Transaction.aggregate(pipeline);

    let totalIn = 0;
    let totalOut = 0;

    results.forEach(result => {
      if (result._id === 'IN') totalIn = result.total;
      if (result._id === 'OUT') totalOut = result.total;
    });

    return {
      total_in: totalIn,
      total_out: totalOut,
      net_balance: totalIn - totalOut
    };
  }
}

module.exports = new TransactionService();