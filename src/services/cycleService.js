const mongoose = require('mongoose');
const Cycle = require('../models/Cycle');
const Barn = require('../models/Barn');
const Invoice = require('../models/Invoice');
const Transaction = require('../models/Transaction');
const Merchant = require('../models/Merchant');
const AppError = require('../utils/AppError');

class CycleService {
  /**
   * @desc بدء دورة إنتاج جديدة
   */
  async startCycle(data, orgId) {
    const { farm_id, barn_id, supervisor_id, name, type, start_date, initial_bird_count } = data;
    const parsedBirdCount = Number(initial_bird_count);

    const barn = await Barn.findOne({ _id: barn_id, farm_id, organization_id: orgId });
    if (!barn || barn.deleted_at !== null) {
      throw new AppError('العنبر غير موجود أو لا تملك صلاحية الوصول إليه', 404);
    }

    if (barn.barn_type !== type) {
      throw new AppError(`لا يمكن تشغيل دورة (${type}) في عنبر مجهز كـ (${barn.barn_type})`, 400);
    }

    const maxAllowedCount = barn.capacity + (barn.capacity * 0.02);
    if (parsedBirdCount > maxAllowedCount) {
      throw new AppError(`تجاوز خطير للسعة: العنبر يستوعب ${barn.capacity} طائر كحد أقصى`, 400);
    }

    const existingActiveCycle = await Cycle.findOne({
      barn_id,
      status: { $in: ['PREPARATION', 'ACTIVE'] }
    }).lean();

    if (existingActiveCycle) {
      throw new AppError('العنبر مشغول حالياً بدورة إنتاج نشطة', 400);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const [newCycle] = await Cycle.create([{
        organization_id: orgId, // Denormalization for faster queries
        farm_id,
        barn_id,
        supervisor_id,
        name: name.trim(),
        type,
        status: 'ACTIVE',
        start_date: new Date(start_date),
        initial_bird_count: parsedBirdCount,
        current_bird_count: parsedBirdCount,
        total_expenses: 0,
        total_revenue: 0,
        net_profit: 0
      }], { session });

      barn.status = 'ACTIVE';
      await barn.save({ session });

      await session.commitTransaction();
      return newCycle;
    } catch (error) {
      await session.abortTransaction();
      throw new AppError('فشل في تسجيل الدورة بسبب خطأ في قاعدة البيانات', 500);
    } finally {
      session.endSession();
    }
  }

  /**
   * @desc إغلاق دورة وتصفيتها محاسبياً
   */
  async closeCycle(cycleId, endDate, orgId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const cycle = await Cycle.findOne({ _id: cycleId, organization_id: orgId }).session(session);
      
      if (!cycle) throw new AppError('الدورة غير موجودة أو لا تملك صلاحية إغلاقها', 404);
      if (cycle.status === 'CLOSED') throw new AppError('تم إغلاق هذه الدورة مسبقاً', 400);

      cycle.net_profit = cycle.total_revenue - cycle.total_expenses;
      cycle.status = 'CLOSED';
      cycle.end_date = new Date(endDate);
      await cycle.save({ session });

      await Barn.findByIdAndUpdate(cycle.barn_id, { status: 'MAINTENANCE' }, { session });

      await session.commitTransaction();
      return cycle;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * @desc تنفيذ عملية بيع مع حماية صارمة ضد التزامن (Race Conditions)
   */
  async sellBirds(cycleId, saleData, orgId, userId) {
    const { local_id, merchant_id, birds_sold_count, total_weight_kg, price_per_kg, paid_amount, transaction_date, notes } = saleData;
    
    const numericBirds = Number(birds_sold_count);
    const numericWeight = Number(total_weight_kg);
    const numericPrice = Number(price_per_kg);
    const numericPaid = Number(paid_amount) || 0;
    const totalInvoiceAmount = numericWeight * numericPrice;

    if (numericPaid > totalInvoiceAmount) {
      throw new AppError('المبلغ المدفوع يتجاوز قيمة البيع', 400);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const merchant = await Merchant.findOne({ _id: merchant_id, organization_id: orgId }).lean();
      if (!merchant) throw new AppError('التاجر غير موجود', 404);

      // التحديث الذري (Atomic Update) لمنع ثغرات التزامن
      const cycle = await Cycle.findOneAndUpdate(
        { 
          _id: cycleId, 
          organization_id: orgId, 
          status: 'ACTIVE',
          current_bird_count: { $gte: numericBirds } // الشرط الأهم: التأكد من توفر العدد قبل الخصم
        },
        { 
          $inc: { 
            current_bird_count: -numericBirds, 
            total_revenue: totalInvoiceAmount 
          } 
        },
        { new: true, session }
      );

      if (!cycle) {
        throw new AppError('الرصيد الحي من الطيور لا يكفي لهذه العملية، أو الدورة مغلقة', 400);
      }

      const remainingAmount = totalInvoiceAmount - numericPaid;
      const paymentStatus = numericPaid === 0 ? 'UNPAID' : (remainingAmount === 0 ? 'PAID' : 'PARTIAL');

      const [newInvoice] = await Invoice.create([{
        local_id: `${local_id}_INV`,
        farm_id: cycle.farm_id,
        merchant_id,
        cycle_id: cycle._id,
        created_by: userId,
        invoice_type: 'SALE',
        items: [{
          item_name: `بيع طيور - عدد ${numericBirds} طائر`,
          quantity: numericWeight,
          unit_price: numericPrice,
          total_price: totalInvoiceAmount
        }],
        total_amount: totalInvoiceAmount,
        paid_amount: numericPaid,
        remaining_amount: remainingAmount,
        payment_status: paymentStatus,
        invoice_date: new Date(transaction_date),
        notes: notes ? notes.trim() : `متوسط وزن الطائر: ${(numericWeight / numericBirds).toFixed(3)} كجم`
      }], { session });

      if (numericPaid > 0) {
        await Transaction.create([{
          local_id: `${local_id}_PAY`,
          farm_id: cycle.farm_id,
          cycle_id: cycle._id,
          merchant_id,
          invoice_id: newInvoice._id,
          performed_by: userId,
          type: 'IN',
          category: 'BIRD_SALE',
          amount: numericPaid,
          transaction_date: new Date(transaction_date),
          reference_doc: `دفعة مبيعات فاتورة #${newInvoice._id.toString().slice(-6)}`
        }], { session });
      }

      await session.commitTransaction();
      return { invoice: newInvoice, remainingBirds: cycle.current_bird_count };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}

module.exports = new CycleService();