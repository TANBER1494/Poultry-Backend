const mongoose = require('mongoose');
const PlatformPayment = require('../models/PlatformPayment');
const Farm = require('../models/Farm');
const Notification = require('../models/Notification');
const socket = require('../models/socket');

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

const submitPaymentRequest = asyncHandler(async (req, res, next) => {
  const { farm_id, amount_paid, transfer_number, requested_months } = req.body;
  const orgId = req.user.organization_id;

  const numAmount = Number(amount_paid);
  const numMonths = Number(requested_months);

  if (
    !farm_id ||
    isNaN(numAmount) ||
    numAmount <= 0 ||
    !transfer_number ||
    isNaN(numMonths) ||
    numMonths <= 0
  ) {
    return next(
      new AppError(
        'جميع الحقول (المزرعة، المبلغ الصحيح، رقم التحويل، ومدة الباقة الصحيحة) مطلوبة',
        400
      )
    );
  }

  if (!req.file || !req.file.path) {
    return next(new AppError('صورة إيصال التحويل مطلوبة لاعتماد الدفع', 400));
  }

  const farm = await Farm.exists({ _id: farm_id, organization_id: orgId });
  if (!farm)
    return next(
      new AppError('المزرعة غير موجودة أو لا تملك صلاحية عليها', 404)
    );

  const newPayment = await PlatformPayment.create({
    organization_id: orgId,
    farm_id: farm_id,
    amount_paid: numAmount,
    transfer_number: transfer_number.trim(),
    requested_months: numMonths,
    payment_method: 'VODAFONE_CASH',
    receipt_image_url: req.file.path,
  });

  try {
    const notification = await Notification.create({
      organization_id: orgId,
      farm_id: farm_id,
      target_role: 'SUPER_ADMIN',
      title: 'طلب تجديد اشتراك جديد 💳',
      message: `قام المالك برفع إيصال دفع بمبلغ ${numAmount} ج.م بانتظار مراجعتك.`,
      type: 'SYSTEM',
      link: '/admin/payments',
    });

    const io = socket.getIO();
    io.to('SUPER_ADMIN_ROOM').emit(
      'new_notification',
      notification.toJSON ? notification.toJSON() : notification
    );
  } catch (notifErr) {
    console.error('🚨 خطأ صامت منع إرسال الإشعار:', notifErr.message);
  }

  res.status(201).json({
    message:
      'تم إرسال طلب التجديد بنجاح! سيتم تفعيل الباقة فور مراجعة الإيصال.',
    payment: newPayment,
  });
});

const getOwnerPaymentHistory = asyncHandler(async (req, res, next) => {
  const orgId = req.user.organization_id;

  const payments = await PlatformPayment.find({
    organization_id: orgId,
    is_deleted_by_owner: false,
  })
    .populate('farm_id', 'name')
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json(payments);
});

const clearFarmHistory = asyncHandler(async (req, res, next) => {
  const orgId = req.user.organization_id;
  const { farmId } = req.params;

  await PlatformPayment.updateMany(
    { organization_id: orgId, farm_id: farmId },
    { $set: { is_deleted_by_owner: true } }
  );

  res.status(200).json({ message: 'تم تنظيف السجل بنجاح' });
});

const getPendingPayments = asyncHandler(async (req, res, next) => {
  const pendingPayments = await PlatformPayment.find({ status: 'PENDING' })
    .populate('organization_id', 'name phone')
    .populate('farm_id', 'name subscription_status subscription_ends_at')
    .sort({ createdAt: 1 })
    .lean();

  res.status(200).json(pendingPayments);
});

const reviewPaymentRequest = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { action, admin_notes } = req.body;

  const payment = await PlatformPayment.findById(id);
  if (!payment) return next(new AppError('طلب الدفع غير موجود', 404));

  if (payment.status !== 'PENDING') {
    return next(
      new AppError(
        `هذا الطلب تمت مراجعته مسبقاً وحالته: ${payment.status}`,
        400
      )
    );
  }

  if (action === 'REJECT') {
    payment.status = 'REJECTED';
    payment.admin_notes = admin_notes
      ? admin_notes.trim()
      : 'تم رفض الطلب لعدم تطابق البيانات، يرجى مراجعة الإدارة.';
    await payment.save();
    return res.status(200).json({ message: 'تم رفض طلب الدفع بنجاح' });
  }

  if (action === 'APPROVE') {
    const farm = await Farm.findById(payment.farm_id);
    if (!farm)
      return next(
        new AppError('المزرعة المرتبطة بهذا الطلب لم تعد موجودة', 404)
      );

    const now = new Date();
    let newStartDate = now;

    if (
      farm.subscription_status === 'ACTIVE' &&
      farm.subscription_ends_at &&
      farm.subscription_ends_at > now
    ) {
      newStartDate = new Date(farm.subscription_ends_at);
    }

    const newEndDate = new Date(newStartDate);
    newEndDate.setMonth(newEndDate.getMonth() + payment.requested_months);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      farm.subscription_status = 'ACTIVE';
      farm.subscription_ends_at = newEndDate;
      await farm.save({ session });

      payment.status = 'APPROVED';
      payment.admin_notes = admin_notes
        ? admin_notes.trim()
        : 'تم استلام المبلغ وتمديد الاشتراك بنجاح.';
      await payment.save({ session });

      const [notification] = await Notification.create(
        [
          {
            organization_id: payment.organization_id,
            farm_id: farm._id,
            target_role: 'OWNER',
            title: 'تم تفعيل اشتراك المزرعة!',
            message: `تمت مراجعة إيصال الدفع بنجاح، وتفعيل اشتراك مزرعة (${farm.name}) لمدة ${payment.requested_months} شهر/شهور.`,
            type: 'SYSTEM',
            link: '/owner/farms',
          },
        ],
        { session }
      );

      await session.commitTransaction();
      session.endSession();

      const io = socket.getIO();
      io.to(payment.organization_id.toString()).emit(
        'new_notification',
        notification
      );

      return res.status(200).json({
        message: `تم اعتماد المبلغ وتمديد اشتراك المزرعة بنجاح لمدة ${payment.requested_months} شهر/شهور.`,
        new_end_date: newEndDate,
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Review Payment Transaction Error:', error);
      return next(
        new AppError(
          'حدث خطأ أثناء حفظ الموافقة وتفعيل المزرعة، تم التراجع لحماية النظام',
          500
        )
      );
    }
  }

  return next(
    new AppError('إجراء غير معروف (يجب أن يكون APPROVE أو REJECT)', 400)
  );
});

module.exports = {
  submitPaymentRequest,
  getOwnerPaymentHistory,
  getPendingPayments,
  reviewPaymentRequest,
  clearFarmHistory,
};
