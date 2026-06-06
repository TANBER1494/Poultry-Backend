const mongoose = require('mongoose');
const Cycle = require('../models/Cycle');
const Barn = require('../models/Barn');
const Farm = require('../models/Farm');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const Invoice = require('../models/Invoice');
const Transaction = require('../models/Transaction');
const Merchant = require('../models/Merchant');

// ==========================================
// 1. بدء دورة إنتاج جديدة (تسكين الكتاكيت/الطيور)
// ==========================================
const startCycle = asyncHandler(async (req, res, next) => {
  const {
    farm_id,
    barn_id,
    supervisor_id,
    name,
    type,
    start_date,
    initial_bird_count,
  } = req.body;
  const orgId = req.user.organization_id;

  if (
    !farm_id ||
    !barn_id ||
    !supervisor_id ||
    !name ||
    !type ||
    !start_date ||
    !initial_bird_count
  ) {
    return next(
      new AppError(
        'جميع بيانات بدء الدورة مطلوبة (المزرعة، العنبر، المشرف، الاسم، النوع، التاريخ، العدد الفعلي)',
        400
      )
    );
  }

  const parsedBirdCount = Number(initial_bird_count);
  if (parsedBirdCount <= 0) {
    return next(
      new AppError('لا يمكن أن يكون عدد الطيور صفراً أو رقماً سالباً', 400)
    );
  }

  // 1. التحقق من صحة المزرعة وملكية المؤسسة
  const farm = await Farm.findOne({
    _id: farm_id,
    organization_id: orgId,
  }).lean();
  if (!farm) {
    return next(
      new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403)
    );
  }

  // 2. التحقق من صحة العنبر ومطابقته للشروط التشغيلية
  const barn = await Barn.findOne({ _id: barn_id, farm_id: farm_id });
  if (!barn || barn.deleted_at !== null) {
    return next(new AppError('العنبر غير موجود في هذه المزرعة', 404));
  }

  if (barn.barn_type !== type) {
    return next(
      new AppError(
        `إجراء مرفوض: لا يمكن تشغيل دورة من نوع (${type}) في عنبر مجهز كـ (${barn.barn_type})`,
        400
      )
    );
  }

  // السماح بتجاوز السعة بنسبة 2% فقط كحد أقصى (تأمين بونص الكتاكيت من المعمل)
  const maxAllowedCount = barn.capacity + barn.capacity * 0.02;
  if (parsedBirdCount > maxAllowedCount) {
    return next(
      new AppError(
        `تجاوز خطير للسعة: العنبر يستوعب ${barn.capacity} طائر، والعدد المدخل يتجاوز حد الأمان المسموح به`,
        400
      )
    );
  }

  // 3. التحقق من عدم وجود دورة نشطة في نفس العنبر
  const existingActiveCycle = await Cycle.findOne({
    barn_id,
    status: { $in: ['PREPARATION', 'ACTIVE'] },
  }).lean();

  if (existingActiveCycle) {
    return next(
      new AppError(
        'العنبر مشغول حالياً بدورة إنتاج نشطة، يجب إغلاقها وتصفيتها أولاً',
        400
      )
    );
  }

  // 4. تنفيذ العملية عبر Transaction لضمان تغيير حالة العنبر مع إنشاء الدورة
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const [newCycle] = await Cycle.create(
      [
        {
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
          net_profit: 0,
        },
      ],
      { session }
    );

    barn.status = 'ACTIVE';
    await barn.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'تم تسكين الدورة بنجاح وتفعيل العمليات التشغيلية للعنبر',
      cycle: newCycle,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(
      new AppError('فشل في تسجيل الدورة الجديدة، تم التراجع عن العملية', 500)
    );
  }
});

// ==========================================
// 2. جلب جميع الدورات الخاصة بمزرعة (مع إمكانية الفلترة بالحالة)
// ==========================================
const getFarmCycles = asyncHandler(async (req, res, next) => {
  const { farm_id } = req.params;
  const { status } = req.query;
  const orgId = req.user.organization_id;

  const farm = await Farm.findOne({
    _id: farm_id,
    organization_id: orgId,
  }).lean();
  if (!farm) {
    return next(new AppError('المزرعة غير موجودة', 404));
  }

  const query = { farm_id };
  if (status) query.status = status;

  const cycles = await Cycle.find(query)
    .populate('barn_id', 'name capacity barn_type')
    .populate('supervisor_id', 'name phone')
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ count: cycles.length, cycles });
});

// ==========================================
// 3. جلب تفاصيل دورة محددة للوحة المراقبة
// ==========================================
const getCycleDetails = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const orgId = req.user.organization_id;

  const cycle = await Cycle.findById(id)
    .populate('barn_id', 'name capacity')
    .populate('supervisor_id', 'name phone')
    .populate('farm_id', 'organization_id'); // للتحقق من الأمان

  if (!cycle) {
    return next(new AppError('الدورة غير موجودة', 404));
  }

  if (cycle.farm_id.organization_id.toString() !== orgId.toString()) {
    return next(new AppError('غير مصرح لك بالوصول إلى بيانات هذه الدورة', 403));
  }

  // إزالة الكائنات المرتبطة العميقة قبل إرسال الرد لتنظيف الهيكل
  const cycleData = cycle.toObject();
  delete cycleData.farm_id;

  res.status(200).json(cycleData);
});

// ==========================================
// 4. إغلاق وتصفية الدورة (الإقفال المحاسبي)
// ==========================================
const closeCycle = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { end_date } = req.body;
  const orgId = req.user.organization_id;

  if (!end_date) {
    return next(new AppError('يجب تحديد تاريخ الإغلاق الفعلي للدورة', 400));
  }

  const cycle = await Cycle.findById(id).populate('farm_id', 'organization_id');
  if (!cycle) {
    return next(new AppError('الدورة غير موجودة', 404));
  }

  if (cycle.farm_id.organization_id.toString() !== orgId.toString()) {
    return next(new AppError('غير مصرح لك بإغلاق هذه الدورة', 403));
  }

  if (cycle.status === 'CLOSED') {
    return next(new AppError('تم إغلاق هذه الدورة مسبقاً', 400));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. حساب صافي الربح النهائي
    cycle.net_profit = cycle.total_revenue - cycle.total_expenses;
    cycle.status = 'CLOSED';
    cycle.end_date = new Date(end_date);
    await cycle.save({ session });

    // 2. إيقاف العنبر وتحويله لوضع الصيانة (التطهير) استعداداً للدورة القادمة
    await Barn.findByIdAndUpdate(
      cycle.barn_id,
      { status: 'MAINTENANCE' },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      message:
        'تم إقفال الدورة محاسبياً بنجاح، وتحويل العنبر لوضع التطهير والصيانة',
      cycle_summary: {
        total_expenses: cycle.total_expenses,
        total_revenue: cycle.total_revenue,
        net_profit: cycle.net_profit,
        mortality_rate:
          (
            ((cycle.initial_bird_count - cycle.current_bird_count) /
              cycle.initial_bird_count) *
            100
          ).toFixed(2) + '%',
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(
      new AppError('فشل إغلاق الدورة بسبب خطأ في تحديث البيانات', 500)
    );
  }
});

// ==========================================
// 5. الحاسبة الذكية لبيع الطيور من الدورة (Smart Sales Calculator)
// ==========================================
const sellCycleBirds = asyncHandler(async (req, res, next) => {
  const { id } = req.params; // Cycle ID
  const {
    local_id,
    merchant_id,
    birds_sold_count,
    total_weight_kg,
    price_per_kg,
    paid_amount,
    transaction_date,
    notes,
  } = req.body;
  const orgId = req.user.organization_id;

  if (
    !local_id ||
    !merchant_id ||
    !birds_sold_count ||
    !total_weight_kg ||
    !price_per_kg ||
    !transaction_date
  ) {
    return next(new AppError('جميع بيانات الحاسبة الذكية للبيع مطلوبة', 400));
  }

  const numericBirds = Number(birds_sold_count);
  const numericWeight = Number(total_weight_kg);
  const numericPrice = Number(price_per_kg);
  const numericPaid = Number(paid_amount) || 0;

  const totalInvoiceAmount = numericWeight * numericPrice;

  if (numericPaid > totalInvoiceAmount) {
    return next(
      new AppError('المبلغ المدفوع لا يمكن أن يتجاوز إجمالي قيمة البيع', 400)
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. التحقق من الدورة
    const cycle = await Cycle.findById(id).populate('farm_id').session(session);
    if (!cycle || cycle.status === 'CLOSED') {
      throw new AppError('الدورة غير موجودة أو تم إغلاقها', 404);
    }
    if (cycle.farm_id.organization_id.toString() !== orgId.toString()) {
      throw new AppError('غير مصرح لك بإدارة مبيعات هذه الدورة', 403);
    }
    if (cycle.current_bird_count < numericBirds) {
      throw new AppError(
        `العدد المطلوب بيعه (${numericBirds}) أكبر من العدد المتاح حالياً في العنبر (${cycle.current_bird_count})`,
        400
      );
    }

    // 2. التحقق من التاجر
    const merchant = await Merchant.findOne({
      _id: merchant_id,
      farm_id: cycle.farm_id._id,
    }).session(session);
    if (!merchant) throw new AppError('التاجر غير موجود', 404);

    // 3. خصم الطيور من العنبر وزيادة إيرادات الدورة
    cycle.current_bird_count -= numericBirds;
    cycle.total_revenue += totalInvoiceAmount;
    await cycle.save({ session });

    // 4. إصدار فاتورة المبيعات آلياً للتاجر
    const remainingAmount = totalInvoiceAmount - numericPaid;
    let paymentStatus = 'UNPAID';
    if (numericPaid > 0)
      paymentStatus = remainingAmount === 0 ? 'PAID' : 'PARTIAL';

    const [newInvoice] = await Invoice.create(
      [
        {
          local_id: `${local_id}_INV`,
          farm_id: cycle.farm_id._id,
          merchant_id,
          cycle_id: cycle._id,
          created_by: req.user._id,
          invoice_type: 'SALE',
          items: [
            {
              item_name: `بيع ${cycle.type === 'BROILER' ? 'فراخ تسمين' : 'دواجن بياض'} - عدد ${numericBirds} طائر`,
              quantity: numericWeight,
              unit_price: numericPrice,
              total_price: totalInvoiceAmount,
            },
          ],
          total_amount: totalInvoiceAmount,
          paid_amount: numericPaid,
          remaining_amount: remainingAmount,
          payment_status: paymentStatus,
          invoice_date: new Date(transaction_date),
          notes: notes
            ? notes.trim()
            : `متوسط وزن الطائر: ${(numericWeight / numericBirds).toFixed(3)} كجم`,
        },
      ],
      { session }
    );

    // 5. تسجيل النقدية في الخزينة إذا دفع التاجر كاش
    if (numericPaid > 0) {
      await Transaction.create(
        [
          {
            local_id: `${local_id}_PAY`,
            farm_id: cycle.farm_id._id,
            cycle_id: cycle._id,
            merchant_id,
            invoice_id: newInvoice._id,
            performed_by: req.user._id,
            type: 'IN',
            category: 'BIRD_SALE',
            amount: numericPaid,
            transaction_date: new Date(transaction_date),
            reference_doc: `دفعة من بيع طيور فاتورة #${newInvoice._id.toString().slice(-6)}`,
          },
        ],
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'تم تنفيذ البيع وخصم العدد من الدورة وتوجيه الحسابات بنجاح',
      invoice: newInvoice,
      remaining_birds_in_cycle: cycle.current_bird_count,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    if (error.isOperational) return next(error);
    console.error('Smart Sales Calc Error:', error);
    return next(
      new AppError(
        'حدث خطأ أثناء تنفيذ عملية البيع، تم التراجع لحماية البيانات',
        500
      )
    );
  }
});

module.exports = {
  startCycle,
  getFarmCycles,
  getCycleDetails,
  closeCycle,
  sellCycleBirds,
};
