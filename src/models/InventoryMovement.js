const mongoose = require('mongoose');

const inventoryMovementSchema = new mongoose.Schema(
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
    },
    item_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryItem',
      required: true,
    },
    cycle_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cycle',
      default: null, 
    },
    performed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true, // المشرف اللي سجل إنتاج المدشة أو استلم العربية
    },
    
    movement_type: {
      type: String,
      enum: [
        'PRODUCTION',    // 🏭 إنتاج داخلي (للمزارع التي بها مدشة)
        'TRANSFER_IN',   // 🚛 وارد من مزرعة أخرى تابعة للمالك
        'PURCHASE',      // 🛒 شراء من شركة أعلاف خارجية
        'CONSUMPTION',   // 🐓 منصرف استهلاك للطيور (يخصم من المخزن)
        'ADJUSTMENT',    // ⚖️ تسوية جرد (عجز أو زيادة)
      ],
      required: true,
    },
    
    // 🚛 في حال كان العلف جاي من مزرعة تانية للمالك، نسجل جات منين!
    source_farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      default: null,
    },

    quantity: {
      type: Number,
      required: [true, 'يجب تحديد الكمية (بالشكارة أو الطن حسب إعداد الصنف)'],
      min: [0.01, 'الكمية يجب أن تكون أكبر من الصفر'], 
    },
    unit_cost_at_time: {
      type: Number,
      required: [true, 'سعر الشكارة أو الطن وقت الحركة (سواء بعد الإنتاج أو عند الشراء)'],
      min: 0,
    },
    total_value: { // quantity * unit_cost_at_time
      type: Number,
      required: true,
      min: 0,
    },
    movement_date: {
      type: Date,
      required: true, // التاريخ الفعلي للإنتاج أو وصول السيارة
    },
    reference_doc: { 
      type: String,
      trim: true,
      default: '', // مثال: "رقم اللوط بتاع المدشة" أو "رقم بوليصة السواق"
    },
  },
  { timestamps: true }
);

// فهارس لتسريع استخراج تقارير التكلفة للمالك
inventoryMovementSchema.index({ farm_id: 1, movement_type: 1 });
inventoryMovementSchema.index({ cycle_id: 1 });

module.exports = mongoose.model('InventoryMovement', inventoryMovementSchema);