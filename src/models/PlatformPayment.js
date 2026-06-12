const mongoose = require('mongoose');

const platformPaymentSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'يجب تحديد المؤسسة الدافعة'],
      index: true,
    },
    farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      required: [true, 'يجب تحديد المزرعة المرتبطة بالدفع'],
      index: true,
    },
    amount_paid: {
      type: Number,
      required: [true, 'يجب تحديد المبلغ المدفوع'],
      min: [1, 'المبلغ يجب أن يكون أكبر من صفر'],
    },
    transfer_number: {
      type: String,
      required: [true, 'يجب إدخال رقم الهاتف الذي تم التحويل منه'],
      trim: true
    },
    requested_months: {
      type: Number,
      enum: [1, 3, 6, 9, 12], //  ملاحظة: تمت إضافة 6 و 12 لدعم الباقات النصف سنوية والسنوية (وهو المعيار التجاري)
      required: [true, 'يجب تحديد مدة الاشتراك المطلوبة'],
    },
    payment_method: {
      type: String,
      enum: ['VODAFONE_CASH', 'BANK_TRANSFER'],
      default: 'VODAFONE_CASH',
    },
    receipt_image_url: {
      type: String,
      required: [true, 'صورة إيصال التحويل مطلوبة لتأكيد الدفع'], 
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING', 
    },
    payment_date: {
      type: Date,
      default: Date.now,
    },
    admin_notes: {
      type: String,
      default: null,
      trim: true
    },
    is_deleted_by_owner: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

//  التطوير المعماري: فهرس مركب لتسريع جلب الإدارة للطلبات المعلقة (PENDING) مرتبة زمنياً
platformPaymentSchema.index({ status: 1, createdAt: 1 });

// فهرس لتسريع جلب المالك لسجل مدفوعاته (غير المحذوفة من طرفه)
platformPaymentSchema.index({ organization_id: 1, is_deleted_by_owner: 1 });

module.exports = mongoose.model('PlatformPayment', platformPaymentSchema);