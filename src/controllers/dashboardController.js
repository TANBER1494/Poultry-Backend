const Farm = require('../models/Farm');
const Cycle = require('../models/Cycle');
const InventoryItem = require('../models/InventoryItem');
const Invoice = require('../models/Invoice');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
// وظائف مساعدة (Utility Functions)
// ==========================================

/*
 * حساب الأيام المتبقية لاشتراك المزرعة
 */
const calculateDaysLeft = (targetDate) => {
  if (!targetDate) return 0;
  const diffInDays = Math.ceil(
    (new Date(targetDate) - new Date()) / (1000 * 60 * 60 * 24)
  );
  return diffInDays > 0 ? diffInDays : 0;
};

// ==========================================
// لوحة القيادة المركزية للمالك (Master Dashboard)
// ==========================================

/*
 * جلب ملخص تشغيلي ومالي لجميع المزارع التابعة للمؤسسة
 */
const getOwnerMasterDashboard = asyncHandler(async (req, res, next) => {
  const orgId = req.user.organization_id;

  const farms = await Farm.find({ organization_id: orgId }).lean();
  if (!farms || farms.length === 0) {
    return res.status(200).json({
      grand_totals: { total_debts_for_us: 0, total_debts_on_us: 0 },
      farms: [],
    });
  }

  const farmIds = farms.map((f) => f._id);

  // 1. تنفيذ استعلامات متوازية لجلب البيانات التشغيلية والمالية الأساسية
  const [activeCycles, invoices, lowStockItems] = await Promise.all([
    // جلب الدورات التي لا تزال قيد التشغيل لمعرفة الطاقة الفعالة
    Cycle.find({ farm_id: { $in: farmIds }, status: 'ACTIVE' })
      .select('farm_id name current_bird_count type')
      .lean(),

    // جلب الفواتير غير المسددة بالكامل لحساب المديونيات
    Invoice.find({ farm_id: { $in: farmIds }, payment_status: { $ne: 'PAID' } })
      .select('farm_id invoice_type remaining_amount')
      .lean(),

    // جلب الأصناف التي وصل رصيدها لحد التنبيه أو أقل
    InventoryItem.find({
      farm_id: { $in: farmIds },
      $expr: { $lte: ['$stock_quantity', '$min_alert_level'] },
      min_alert_level: { $gt: 0 },
    })
      .select('farm_id')
      .lean(),
  ]);

  // 2. معالجة وتجميع البيانات عبر الذاكرة (Memory Maps) لضمان سرعة الأداء

  // خريطة الدورات النشطة لكل مزرعة
  const cyclesMap = {};
  activeCycles.forEach((cycle) => {
    const fId = cycle.farm_id.toString();
    if (!cyclesMap[fId]) cyclesMap[fId] = [];
    cyclesMap[fId].push({
      cycle_id: cycle._id,
      name: cycle.name,
      type: cycle.type,
      current_birds: cycle.current_bird_count,
    });
  });

  // خريطة الديون (المستحقات للمزرعة والمستحقات على المزرعة)
  const debtsMap = {};
  invoices.forEach((inv) => {
    const fId = inv.farm_id.toString();
    if (!debtsMap[fId]) debtsMap[fId] = { for_us: 0, on_us: 0 };

    // المبيعات غير المسددة بالكامل تُحتسب كديون مستحقة للمزرعة
    if (inv.invoice_type === 'SALE') {
      debtsMap[fId].for_us += inv.remaining_amount;
    }
    // المشتريات غير المسددة بالكامل تُحتسب كديون مستحقة على المزرعة
    else if (inv.invoice_type === 'PURCHASE') {
      debtsMap[fId].on_us += inv.remaining_amount;
    }
  });

  // خريطة النواقص في المخازن لكل مزرعة
  const lowStockMap = {};
  lowStockItems.forEach((item) => {
    const fId = item.farm_id.toString();
    lowStockMap[fId] = (lowStockMap[fId] || 0) + 1;
  });

  // 3. تجميع البيانات النهائية لكل مزرعة وإعداد الإجماليات
  let grandTotalDebtsForUs = 0;
  let grandTotalDebtsOnUs = 0;

  const farmsData = farms.map((farm) => {
    const fId = farm._id.toString();

    const farmDebts = debtsMap[fId] || { for_us: 0, on_us: 0 };
    grandTotalDebtsForUs += farmDebts.for_us;
    grandTotalDebtsOnUs += farmDebts.on_us;

    const targetDate =
      farm.subscription_status === 'TRIAL'
        ? farm.trial_ends_at
        : farm.subscription_ends_at;

    return {
      _id: farm._id,
      name: farm.name,
      type: farm.farm_type,
      has_feed_mill: farm.has_feed_mill,
      status: farm.subscription_status,
      days_left: calculateDaysLeft(targetDate),
      active_cycles: cyclesMap[fId] || [],
      active_cycles_count: (cyclesMap[fId] || []).length,
      debts_for_us: farmDebts.for_us,
      debts_on_us: farmDebts.on_us,
      low_stock_count: lowStockMap[fId] || 0,
    };
  });

  res.status(200).json({
    grand_totals: {
      total_debts_for_us: grandTotalDebtsForUs,
      total_debts_on_us: grandTotalDebtsOnUs,
    },
    farms: farmsData,
  });
});

module.exports = { getOwnerMasterDashboard };
