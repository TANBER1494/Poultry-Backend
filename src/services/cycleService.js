const mongoose = require('mongoose');
const Cycle = require('../models/Cycle');
const Barn = require('../models/Barn');
const Invoice = require('../models/Invoice');
const Transaction = require('../models/Transaction');
const Merchant = require('../models/Merchant');
const AppError = require('../utils/AppError');
const InventoryItem = require('../models/InventoryItem');
const InventoryMovement = require('../models/InventoryMovement');

class CycleService {
  async startCycle(data, orgId) {
    const {
      farm_id,
      barn_id,
      supervisor_id,
      name,
      type,
      start_date,
      initial_bird_count,
    } = data;
    const parsedBirdCount = Number(initial_bird_count);

    const barn = await Barn.findOne({
      _id: barn_id,
      farm_id,
      organization_id: orgId,
    });
    if (!barn || barn.deleted_at !== null)
      throw new AppError('العنبر غير موجود', 404);
    if (barn.barn_type !== type)
      throw new AppError(
        `لا يمكن تشغيل دورة (${type}) في عنبر (${barn.barn_type})`,
        400
      );

    const maxAllowedCount = barn.capacity + barn.capacity * 0.02;
    if (parsedBirdCount > maxAllowedCount)
      throw new AppError(`تجاوز خطير للسعة القصوى`, 400);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const [newCycle] = await Cycle.create(
        [
          {
            organization_id: orgId,
            farm_id,
            barn_id,
            supervisor_id,
            name: name.trim(),
            type,
            status: 'ACTIVE',
            start_date: new Date(start_date),
            initial_bird_count: parsedBirdCount,
            current_bird_count: parsedBirdCount,
            total_sold_birds: 0,
            total_dead_birds: 0,
            total_sold_eggs: 0,
            total_sold_manure: 0,
            total_expenses: 0,
            total_revenue: 0,
            net_profit: 0,
          },
        ],
        { session }
      );

      barn.status = 'ACTIVE';
      await barn.save({ session });

      await session.commitTransaction();
      return newCycle;
    } catch (error) {
      await session.abortTransaction();
      if (error.code === 11000)
        throw new AppError('العنبر مشغول بدورة نشطة', 400);
      throw new AppError('فشل تسجيل الدورة', 500);
    } finally {
      session.endSession();
    }
  }

  async closeCycle(cycleId, endDate, orgId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const cycle = await Cycle.findOne({
        _id: cycleId,
        organization_id: orgId,
      }).session(session);
      if (!cycle) throw new AppError('الدورة غير موجودة', 404);
      if (cycle.status === 'CLOSED')
        throw new AppError('تم إغلاق الدورة مسبقاً', 400);

      cycle.net_profit = cycle.total_revenue - cycle.total_expenses;
      cycle.status = 'CLOSED';
      cycle.end_date = new Date(endDate);
      await cycle.save({ session });

      await Barn.findByIdAndUpdate(
        cycle.barn_id,
        { status: 'MAINTENANCE' },
        { session }
      );

      await session.commitTransaction();
      return cycle;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  //  الترقية المعمارية: المحرك الذكي لتسجيل المبيعات (طيور، بيض، سباخ)
  async recordCycleSale(cycleId, saleData, orgId, userId, userRole) {
    const {
      local_id,
      merchant_id,
      sale_category,
      quantity,
      total_weight_kg,
      unit_price,
      paid_amount,
      transaction_date,
      notes,
      representative_name,
    } = saleData;

    //  تطبيق القواعد الصارمة للصلاحيات والحوكمة
    if (userRole === 'SUPERVISOR' && sale_category === 'BIRDS') {
      throw new AppError(
        'إجراء أمني: صلاحيات المشرف تقتصر على بيع البيض والسباخ فقط. تصفية وبيع القطيع من صلاحيات المالك الحصرية.',
        403
      );
    }
    if (userRole === 'OWNER' && sale_category === 'EGGS') {
      throw new AppError(
        'إجراء تنظيمي: بيع البيض هو عملية يومية تتم من خلال شاشة المشرفين الخاصة بالعنابر البياضة.',
        403
      );
    }

    const numericQty = Number(quantity);
    const numericPrice = Number(unit_price);
    const numericPaid = Number(paid_amount) || 0;

    let totalInvoiceAmount = 0;
    let itemName = '';

    // تحديد نوع المبيع وقيمته
    if (sale_category === 'BIRDS') {
      const numericWeight = Number(total_weight_kg);
      if (!numericWeight)
        throw new AppError('الوزن الإجمالي مطلوب عند بيع الطيور', 400);
      totalInvoiceAmount = numericWeight * numericPrice;
      itemName = `بيع طيور - عدد ${numericQty} طائر بوزن ${numericWeight} كجم`;
    } else if (sale_category === 'EGGS') {
      totalInvoiceAmount = numericQty * numericPrice;
      itemName = `بيع بيض - كمية ${numericQty} كرتونة`;
    } else if (sale_category === 'MANURE') {
      totalInvoiceAmount = numericQty * numericPrice;
      itemName = `بيع سباخ/سماد - كمية ${numericQty} نقلة/طن`;
    } else {
      throw new AppError('نوع المبيعات غير مدعوم', 400);
    }

    if (numericPaid > totalInvoiceAmount) {
      throw new AppError('المبلغ المدفوع يتجاوز قيمة الفاتورة', 400);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const merchant = await Merchant.findOne({
        _id: merchant_id,
        organization_id: orgId,
      }).lean();
      if (!merchant) throw new AppError('الشركة أو التاجر غير موجود', 404);

      // بناء استعلام التحديث بناءً على نوع المبيع
      let matchQuery = {
        _id: cycleId,
        organization_id: orgId,
        status: 'ACTIVE',
      };
      let incLogic = { total_revenue: totalInvoiceAmount };

      if (sale_category === 'BIRDS') {
        matchQuery.current_bird_count = { $gte: numericQty }; // التأكد من وجود رصيد كافي للطيور فقط
        incLogic.current_bird_count = -numericQty;
        incLogic.total_sold_birds = numericQty;
      } else if (sale_category === 'EGGS') {
        incLogic.total_sold_eggs = numericQty;
      } else if (sale_category === 'MANURE') {
        incLogic.total_sold_manure = numericQty;
      }

      const cycle = await Cycle.findOneAndUpdate(
        matchQuery,
        { $inc: incLogic },
        { new: true, session }
      );

      if (!cycle) {
        throw new AppError(
          'الدورة مغلقة، أو أن الرصيد الحي من الطيور لا يكفي لهذه العملية',
          400
        );
      }

      if (sale_category === 'EGGS') {
        const eggItem = await InventoryItem.findOne({
          farm_id: cycle.farm_id,
          category: 'PRODUCT',
          unit: 'TRAY',
        }).session(session);

        if (!eggItem || eggItem.stock_quantity < numericQty) {
          throw new AppError(
            `رصيد البيض في المخزن لا يكفي. المتاح حالياً: ${eggItem ? eggItem.stock_quantity : 0} كرتونة/طبق`,
            400
          );
        }

        // خصم الكمية المباعة
        eggItem.stock_quantity -= numericQty;
        await eggItem.save({ session });

        // توثيق حركة خروج المبيعات
        await InventoryMovement.create(
          [
            {
              local_id: `${local_id}_EGG_SALE`,
              organization_id: orgId,
              farm_id: cycle.farm_id,
              item_id: eggItem._id,
              cycle_id: cycle._id,
              performed_by: userId,
              movement_type: 'SALE',
              quantity: numericQty,
              unit_cost_at_time: numericPrice,
              total_value: numericQty * numericPrice,
              movement_date: new Date(transaction_date),
              reference_doc: `مبيعات للتاجر`,
            },
          ],
          { session }
        );
      }

      const remainingAmount = totalInvoiceAmount - numericPaid;
      const paymentStatus =
        numericPaid === 0
          ? 'UNPAID'
          : remainingAmount === 0
            ? 'PAID'
            : 'PARTIAL';

      const [newInvoice] = await Invoice.create(
        [
          {
            local_id: `${local_id}_INV`,
            organization_id: orgId,
            farm_id: cycle.farm_id,
            merchant_id,
            cycle_id: cycle._id,
            created_by: userId,
            invoice_type: 'SALE',
            items: [
              {
                item_name: itemName,
                quantity:
                  sale_category === 'BIRDS'
                    ? Number(total_weight_kg)
                    : numericQty,
                unit_price: numericPrice,
                total_price: totalInvoiceAmount,
              },
            ],
            total_amount: totalInvoiceAmount,
            paid_amount: numericPaid,
            remaining_amount: remainingAmount,
            payment_status: paymentStatus,
            invoice_date: new Date(transaction_date),
            notes: notes ? notes.trim() : '',
          },
        ],
        { session }
      );

      if (numericPaid > 0) {
        await Transaction.create(
          [
            {
              local_id: `${local_id}_PAY`,
              organization_id: orgId,
              farm_id: cycle.farm_id,
              cycle_id: cycle._id,
              merchant_id,
              invoice_id: newInvoice._id,
              performed_by: userId,
              type: 'IN',
              category: 'EGG_SALE',
              amount: numericPaid,
              transaction_date: new Date(transaction_date),
              reference_doc: `مقبوضات فاتورة #${newInvoice._id.toString().slice(-6)}`,
            },
          ],
          { session }
        );
      }

      await session.commitTransaction();
      return { invoice: newInvoice, cycle };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}

module.exports = new CycleService();
