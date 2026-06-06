const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema(
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
    merchant_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: true,
      index: true,
    },
    cycle_id: { 
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cycle',
      default: null,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true, // من أصدر الفاتورة؟ (المشرف/المالك)
    },
    invoice_type: {
      type: String,
      enum: ['PURCHASE', 'SALE', 'RETURN_PURCHASE', 'RETURN_SALE'], // شراء، بيع، مرتجع شراء، مرتجع بيع
      required: true,
    },
    
    items: [
      {
        item_name: { type: String, required: true }, // مثال: "علف بادي" أو "طبق بيض أحمر"
        quantity: { type: Number, required: true },
        unit_price: { type: Number, required: true },
        total_price: { type: Number, required: true }, // quantity * unit_price
      }
    ],

    // 💰 الحسابات المالية الصارمة للفاتورة
    total_amount: {
      type: Number,
      required: [true, 'إجمالي الفاتورة مطلوب'],
      min: 0,
    },
    paid_amount: { // الفلوس اللي ادفعت "كاش" وقت استلام/تسليم البضاعة
      type: Number,
      default: 0,
      min: 0,
    },
    remaining_amount: { // total_amount - paid_amount (تُحسب برمجياً في الباك إند)
      type: Number,
      required: true,
      min: 0,
    },
    payment_status: {
      type: String,
      enum: ['PAID', 'PARTIAL', 'UNPAID'], // خالص، مدفوع جزئياً، آجل بالكامل
      required: true,
    },
    
    invoice_date: {
      type: Date,
      required: true, // تاريخ المعاملة الفعلي
    },
    due_date: { // تاريخ الاستحقاق لتسديد باقي الفلوس (اختياري عشان الإشعارات)
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

// فهارس لتسريع كشف حساب المورد أو التاجر
invoiceSchema.index({ merchant_id: 1, invoice_type: 1 });
invoiceSchema.index({ cycle_id: 1 });

module.exports = mongoose.model('Invoice', invoiceSchema);