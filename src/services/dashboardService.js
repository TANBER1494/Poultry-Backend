const Farm = require('../models/Farm');
const Cycle = require('../models/Cycle');
const InventoryItem = require('../models/InventoryItem');
const Invoice = require('../models/Invoice');

class DashboardService {
  /**
   * Calculate remaining days for a subscription
   * @param {Date} targetDate 
   * @returns {Number}
   */
  _calculateDaysLeft(targetDate) {
    if (!targetDate) return 0;
    const diffInDays = Math.ceil((new Date(targetDate) - new Date()) / (1000 * 60 * 60 * 24));
    return diffInDays > 0 ? diffInDays : 0;
  }

  /**
   * Build the Master Dashboard for the organization owner
   * @param {String} orgId 
   * @returns {Object} Grand totals and per-farm data
   */
  async getMasterDashboard(orgId) {
    const farms = await Farm.find({ organization_id: orgId }).lean();
    if (!farms || farms.length === 0) {
      return { grand_totals: { total_debts_for_us: 0, total_debts_on_us: 0 }, farms: [] };
    }

    const farmIds = farms.map((f) => f._id);

    // 1. Parallel execution of optimized Database queries (Aggregation instead of fetching all documents)
    const [activeCycles, debtsAggregation, lowStockAggregation] = await Promise.all([
      // Fetch only necessary fields for active cycles
      Cycle.find({ farm_id: { $in: farmIds }, status: 'ACTIVE' })
        .select('farm_id name current_bird_count type')
        .lean(),

      // Aggregation: Sum debts directly in MongoDB (Zero memory overhead on Node.js)
      Invoice.aggregate([
        { $match: { farm_id: { $in: farmIds }, payment_status: { $ne: 'PAID' } } },
        {
          $group: {
            _id: '$farm_id',
            for_us: { 
              $sum: { $cond: [{ $eq: ['$invoice_type', 'SALE'] }, '$remaining_amount', 0] } 
            },
            on_us: { 
              $sum: { $cond: [{ $eq: ['$invoice_type', 'PURCHASE'] }, '$remaining_amount', 0] } 
            }
          }
        }
      ]),

      // Aggregation: Count low stock items directly in MongoDB
      InventoryItem.aggregate([
        { 
          $match: { 
            farm_id: { $in: farmIds }, 
            min_alert_level: { $gt: 0 }, 
            $expr: { $lte: ['$stock_quantity', '$min_alert_level'] } 
          } 
        },
        { $group: { _id: '$farm_id', count: { $sum: 1 } } }
      ])
    ]);

    // 2. Map the aggregation results for O(1) lookup speed
    const debtsMap = {};
    debtsAggregation.forEach(debt => {
      debtsMap[debt._id.toString()] = { for_us: debt.for_us, on_us: debt.on_us };
    });

    const lowStockMap = {};
    lowStockAggregation.forEach(stock => {
      lowStockMap[stock._id.toString()] = stock.count;
    });

    const cyclesMap = {};
    activeCycles.forEach(cycle => {
      const fId = cycle.farm_id.toString();
      if (!cyclesMap[fId]) cyclesMap[fId] = [];
      cyclesMap[fId].push({
        cycle_id: cycle._id,
        name: cycle.name,
        type: cycle.type,
        current_birds: cycle.current_bird_count,
      });
    });

    // 3. Assemble Final Response
    let grandTotalDebtsForUs = 0;
    let grandTotalDebtsOnUs = 0;

    const farmsData = farms.map((farm) => {
      const fId = farm._id.toString();
      const farmDebts = debtsMap[fId] || { for_us: 0, on_us: 0 };
      
      grandTotalDebtsForUs += farmDebts.for_us;
      grandTotalDebtsOnUs += farmDebts.on_us;

      const targetDate = farm.subscription_status === 'TRIAL' 
        ? farm.trial_ends_at 
        : farm.subscription_ends_at;

      return {
        _id: farm._id,
        name: farm.name,
        type: farm.farm_type,
        has_feed_mill: farm.has_feed_mill,
        status: farm.subscription_status,
        days_left: this._calculateDaysLeft(targetDate),
        active_cycles: cyclesMap[fId] || [],
        active_cycles_count: (cyclesMap[fId] || []).length,
        debts_for_us: farmDebts.for_us,
        debts_on_us: farmDebts.on_us,
        low_stock_count: lowStockMap[fId] || 0,
      };
    });

    return {
      grand_totals: {
        total_debts_for_us: grandTotalDebtsForUs,
        total_debts_on_us: grandTotalDebtsOnUs,
      },
      farms: farmsData,
    };
  }
}

module.exports = new DashboardService();