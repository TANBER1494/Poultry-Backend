const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema(
  {
    farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      required: [true, 'يجب ربط الصنف بمزرعة معينة'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'اسم الصنف مطلوب (مثال: علف بادي 23% - إنتاجنا)'],
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
  },
  { timestamps: true }
);

// لضمان عدم تكرار نفس اسم الصنف داخل نفس المزرعة
inventoryItemSchema.index({ farm_id: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
