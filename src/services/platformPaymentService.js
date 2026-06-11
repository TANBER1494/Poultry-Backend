const mongoose = require('mongoose');
const PlatformPayment = require('../models/PlatformPayment');
const Farm = require('../models/Farm');
const Notification = require('../models/Notification');
const socket = require('../models/socket');
const AppError = require('../utils/AppError');

class PlatformPaymentService {
  /**
   * تقديم طلب دفع جديد
   */
  async submitPaymentRequest(data, orgId, fileUrl) {
    const { farm_id, amount_paid, transfer_number, requested_months } = data;

    const farm = await Farm.exists({ _id: farm_id, organization_id: orgId });
    if (!farm) throw new AppError('المزرعة غير موجودة أو لا تملك صلاحية عليها', 404);

    const newPayment = await PlatformPayment.create({
      organization_id: orgId,
      farm_id,
      amount_paid: Number(amount_paid),
      transfer_number: transfer_number.trim(),
      requested_months: Number(requested_months),
      payment_method: 'VODAFONE_CASH',
      receipt_image_url: fileUrl,
    });

    // إرسال الإشعار للإدارة بشكل غير متزامن (بدون تعطيل العملية الأساسية)
    this._notifySuperAdmin(orgId, farm_id, amount_paid).catch(err => {
      console.error('Failed to notify SUPER_ADMIN:', err.message);
    });

    return newPayment;
  }

  /**
   * إرسال إشعار للإدارة العليا
   * @private
   */
  async _notifySuperAdmin(orgId, farmId, amount) {
    const notification = await Notification.create({
      organization_id: orgId,
      farm_id: farmId,
      target_role: 'SUPER_ADMIN',
      title: 'طلب تجديد اشتراك جديد 💳',
      message: `قام المالك برفع إيصال دفع بمبلغ ${amount} ج.م بانتظار مراجعتك.`,
      type: 'SYSTEM',
      link: '/admin/payments',
    });

    const io = socket.getIO();
    io.to('SUPER_ADMIN_ROOM').emit('new_notification', notification.toJSON ? notification.toJSON() : notification);
  }

  /**
   * جلب سجل مدفوعات المالك
   */
  async getOwnerPaymentHistory(orgId) {
    return await PlatformPayment.find({
      organization_id: orgId,
      is_deleted_by_owner: false,
    })
      .populate('farm_id', 'name')
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * تنظيف سجل المدفوعات للمالك (Soft Delete)
   */
  async clearFarmHistory(orgId, farmId) {
    await PlatformPayment.updateMany(
      { organization_id: orgId, farm_id: farmId },
      { $set: { is_deleted_by_owner: true } }
    );
  }

  /**
   * جلب المدفوعات المعلقة للإدارة العليا
   */
  async getPendingPayments() {
    return await PlatformPayment.find({ status: 'PENDING' })
      .populate('organization_id', 'name phone')
      .populate('farm_id', 'name subscription_status subscription_ends_at')
      .sort({ createdAt: 1 })
      .lean();
  }

  /**
   * مراجعة طلب الدفع من قبل الإدارة (قبول / رفض)
   */
  async reviewPaymentRequest(paymentId, action, adminNotes) {
    const payment = await PlatformPayment.findById(paymentId);
    if (!payment) throw new AppError('طلب الدفع غير موجود', 404);

    if (payment.status !== 'PENDING') {
      throw new AppError(`هذا الطلب تمت مراجعته مسبقاً وحالته: ${payment.status}`, 400);
    }

    if (action === 'REJECT') {
      payment.status = 'REJECTED';
      payment.admin_notes = adminNotes ? adminNotes.trim() : 'تم رفض الطلب لعدم تطابق البيانات، يرجى مراجعة الإدارة.';
      await payment.save();
      return { status: 'REJECTED' };
    }

    if (action === 'APPROVE') {
      const farm = await Farm.findById(payment.farm_id);
      if (!farm) throw new AppError('المزرعة المرتبطة بهذا الطلب لم تعد موجودة', 404);

      const now = new Date();
      let newStartDate = now;

      if (farm.subscription_status === 'ACTIVE' && farm.subscription_ends_at && farm.subscription_ends_at > now) {
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
        payment.admin_notes = adminNotes ? adminNotes.trim() : 'تم استلام المبلغ وتمديد الاشتراك بنجاح.';
        await payment.save({ session });

        const [notification] = await Notification.create([{
          organization_id: payment.organization_id,
          farm_id: farm._id,
          target_role: 'OWNER',
          title: 'تم تفعيل اشتراك المزرعة!',
          message: `تمت مراجعة إيصال الدفع بنجاح، وتفعيل اشتراك مزرعة (${farm.name}) لمدة ${payment.requested_months} شهر/شهور.`,
          type: 'SYSTEM',
          link: '/owner/farms',
        }], { session });

        await session.commitTransaction();
        session.endSession();

        const io = socket.getIO();
        io.to(payment.organization_id.toString()).emit('new_notification', notification);

        return { status: 'APPROVED', newEndDate, months: payment.requested_months };
      } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw new AppError('حدث خطأ أثناء حفظ الموافقة وتفعيل المزرعة، تم التراجع لحماية النظام', 500);
      }
    }

    throw new AppError('إجراء غير معروف (يجب أن يكون APPROVE أو REJECT)', 400);
  }
}

module.exports = new PlatformPaymentService();