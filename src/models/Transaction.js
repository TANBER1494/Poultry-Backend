const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    local_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    //  التطوير المعماري: ضروري جداً لتقارير المركز المالي المجمعة
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
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
      required: true,
    },
    type: {
      type: String,
      enum: ['IN', 'OUT'],
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
        'MERCHANT_PAYMENT',
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
      default: '',
    },
  },
  { timestamps: true }
);

//  التطوير المعماري: فهرس مجمع لتسريع استخراج المركز المالي للمؤسسة بالكامل مرتباً زمنياً
transactionSchema.index({ organization_id: 1, transaction_date: -1 });
transactionSchema.index({ farm_id: 1, type: 1 });
transactionSchema.index({ cycle_id: 1 });
transactionSchema.index({ worker_id: 1, category: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
