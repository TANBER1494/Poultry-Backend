const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema(
  {
    local_id: { 
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    //  التطوير المعماري: إضافة organization_id لسد ثغرات IDOR وتسريع تقارير المؤسسة
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'يجب ربط الفاتورة بشركة (Organization)'],
      index: true,
    },
    farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      required: true,
      index: true,
    },
    merchant_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: true,
      index: true,
    },
    representative_name: {
      type: String,
      trim: true,
      default: '',
    },
    cycle_id: { 
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cycle',
      default: null,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true, 
    },
    invoice_type: {
      type: String,
      enum: ['PURCHASE', 'SALE', 'RETURN_PURCHASE', 'RETURN_SALE'], 
      required: true,
    },
    items: [
      {
        item_name: { type: String, required: true }, 
        quantity: { type: Number, required: true },
        unit_price: { type: Number, required: true },
        total_price: { type: Number, required: true }, 
      }
    ],
    total_amount: {
      type: Number,
      required: [true, 'إجمالي الفاتورة مطلوب'],
      min: 0,
    },
    paid_amount: { 
      type: Number,
      default: 0,
      min: 0,
      //  التطوير المعماري: أداة تحقق مخصصة لمنع الدفع الزائد بقوة قاعدة البيانات
      validate: {
        validator: function(value) {
          return value <= this.total_amount;
        },
        message: 'المبلغ المدفوع لا يمكن أن يتجاوز إجمالي الفاتورة'
      }
    },
    remaining_amount: { 
      type: Number,
      required: true,
      min: 0,
    },
    payment_status: {
      type: String,
      enum: ['PAID', 'PARTIAL', 'UNPAID'], 
      required: true,
    },
    invoice_date: {
      type: Date,
      required: true, 
    },
    due_date: { 
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { timestamps: true }
);

invoiceSchema.index({ organization_id: 1, invoice_date: -1 }); // تسريع جلب فواتير المؤسسة مرتبة زمنياً
invoiceSchema.index({ merchant_id: 1, invoice_type: 1 });
invoiceSchema.index({ cycle_id: 1 });

module.exports = mongoose.model('Invoice', invoiceSchema);