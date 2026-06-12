const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema(
  {
    //  التطوير المعماري: إضافة organization_id لتسريع فلاتر التقارير المجمعة للمالك
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      required: [true, 'يجب ربط الصنف بمزرعة معينة'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'اسم الصنف مطلوب'],
      trim: true,
    },
    category: {
      type: String,
      enum: ['FEED', 'MEDICATION', 'VACCINE', 'DISINFECTANT', 'OTHER'],
      required: true,
    },
    unit: {
      type: String,
      enum: ['BAG', 'TON', 'LITER', 'BOTTLE', 'KG', 'PIECE'],
      required: true,
    },
    stock_quantity: {
      type: Number,
      default: 0,
      min: [0, 'لا يمكن أن يكون رصيد المخزن بالسالب'],
    },
    average_unit_cost: {
      type: Number,
      default: 0,
      min: 0,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
    min_alert_level: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

//  التطوير المعماري: منع تكرار اسم الصنف للأصناف غير المحذوفة فقط
inventoryItemSchema.index(
  { farm_id: 1, name: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } }
);

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
