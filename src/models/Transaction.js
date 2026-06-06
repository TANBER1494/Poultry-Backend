const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    local_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      required: true,
      index: true,
    },
    cycle_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cycle',
      default: null,
    },
    worker_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Worker',
      default: null,
    },
    merchant_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      default: null,
    },
    invoice_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      default: null,
    },
    performed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true, // من أودع أو سحب الفلوس؟
    },
    type: {
      type: String,
      enum: ['IN', 'OUT'], // وارد للخزنة، منصرف من الخزنة
      required: true,
    },
    category: {
      type: String,
      enum: [
        'EGG_SALE',
        'MEAT_SALE',
        'MANURE_SALE',
        'OWNER_DEPOSIT',
        'OTHER_REVENUE',
        'FEED_PURCHASE',
        'MED_PURCHASE',
        'CHICK_PURCHASE',
        'WORKER_ADVANCE',
        'WORKER_SALARY',
        'MAINTENANCE',
        'TRANSPORTATION',
        'OTHER_EXPENSE',
        'BIRD_SALE',
        'OTHER',
      ],
      required: true,
    },
    amount: {
      type: Number,
      required: [true, 'يجب تحديد قيمة المعاملة'],
      min: [0.01, 'المبلغ يجب أن يكون أكبر من الصفر'],
    },
    transaction_date: {
      type: Date,
      required: true,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    reference_doc: {
      type: String,
      trim: true,
      default: '', // مثال: "رقم وصل السلفة" أو "فاتورة بيع البيض رقم 1"
    },
  },
  { timestamps: true }
);

// فهارس لتسريع التقارير المالية (حساب أرباح الدورة، أو كشف حساب سلف العامل)
transactionSchema.index({ farm_id: 1, type: 1 });
transactionSchema.index({ cycle_id: 1 });
transactionSchema.index({ worker_id: 1, category: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
