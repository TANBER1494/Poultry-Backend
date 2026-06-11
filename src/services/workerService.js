const mongoose = require('mongoose');
const Worker = require('../models/Worker');
const WorkerLog = require('../models/WorkerLog');
const Transaction = require('../models/Transaction');
const Farm = require('../models/Farm');
const AppError = require('../utils/AppError');

class WorkerService {
  /**
   * حساب الرصيد الصافي للعامل باستخدام Aggregation لضمان الأداء الفائق
   * @private
   */
  async _calculateWorkerBalance(workerId) {
    const workerObjectId = new mongoose.Types.ObjectId(workerId);

    const [earnedResult, drawnResult] = await Promise.all([
      WorkerLog.aggregate([
        { $match: { worker_id: workerObjectId } },
        { $group: { _id: null, total: { $sum: '$earned_amount' } } }
      ]),
      Transaction.aggregate([
        { $match: { worker_id: workerObjectId, type: 'OUT', category: { $in: ['WORKER_ADVANCE', 'WORKER_SALARY'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    const totalEarned = earnedResult.length > 0 ? earnedResult[0].total : 0;
    const totalDrawn = drawnResult.length > 0 ? drawnResult[0].total : 0;

    return { totalEarned, totalDrawn, netBalance: totalEarned - totalDrawn };
  }

  /**
   * تسجيل عامل جديد
   */
  async createWorker(data, orgId) {
    const { farm_id, name, phone, national_id, base_daily_wage } = data;

    const farm = await Farm.findOne({ _id: farm_id, organization_id: orgId }).lean();
    if (!farm) throw new AppError('المزرعة غير موجودة أو لا تملك صلاحية الوصول إليها', 403);

    return await Worker.create({
      farm_id,
      name: name.trim(),
      phone: phone ? phone.trim() : '',
      national_id: national_id ? national_id.trim() : '',
      base_daily_wage: Number(base_daily_wage)
    });
  }

  /**
   * جلب قائمة العمال
   */
  async getWorkers(farmId, orgId, filters) {
    const farm = await Farm.findOne({ _id: farmId, organization_id: orgId }).lean();
    if (!farm) throw new AppError('المزرعة غير موجودة', 403);

    const query = { farm_id: farmId };
    if (filters.status) query.status = filters.status;

    return await Worker.find(query).sort({ status: 1, name: 1 }).lean();
  }

  /**
   * تسجيل حضور / يومية عامل
   */
  async recordLog(data, userId, orgId) {
    const { local_id, worker_id, log_date, wage_multiplier, notes } = data;

    const existingLogByLocalId = await WorkerLog.findOne({ local_id }).lean();
    if (existingLogByLocalId) return { isDuplicate: true, log: existingLogByLocalId };

    const worker = await Worker.findById(worker_id).lean();
    if (!worker || worker.status === 'TERMINATED') {
      throw new AppError('العامل غير موجود أو تم إنهاء عمله', 404);
    }

    const farm = await Farm.findOne({ _id: worker.farm_id, organization_id: orgId }).lean();
    if (!farm) throw new AppError('لا تملك صلاحية الوصول لبيانات هذا العامل', 403);

    const targetDate = new Date(log_date);
    targetDate.setHours(0, 0, 0, 0);

    const existingLogByDate = await WorkerLog.findOne({
      worker_id,
      log_date: {
        $gte: targetDate,
        $lt: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000)
      }
    }).lean();

    if (existingLogByDate) throw new AppError('تم تسجيل يومية لهذا العامل في هذا التاريخ مسبقاً', 400);

    const earnedAmount = worker.base_daily_wage * Number(wage_multiplier);

    const newLog = await WorkerLog.create({
      local_id,
      farm_id: worker.farm_id,
      worker_id,
      recorded_by: userId,
      log_date: new Date(log_date),
      wage_multiplier: Number(wage_multiplier),
      earned_amount: earnedAmount,
      notes: notes ? notes.trim() : ''
    });

    return { isDuplicate: false, log: newLog };
  }

  /**
   * جلب كشف حساب العامل
   */
  async getWorkerStatement(workerId, orgId) {
    const worker = await Worker.findById(workerId).lean();
    if (!worker) throw new AppError('العامل غير موجود', 404);

    const farm = await Farm.findOne({ _id: worker.farm_id, organization_id: orgId }).lean();
    if (!farm) throw new AppError('لا تملك صلاحية الوصول لكشف حساب هذا العامل', 403);

    const { totalEarned, totalDrawn, netBalance } = await this._calculateWorkerBalance(workerId);

    const logs = await WorkerLog.find({ worker_id: workerId })
      .select('log_date wage_multiplier earned_amount notes')
      .sort({ log_date: -1 })
      .lean();

    const transactions = await Transaction.find({ 
      worker_id: workerId, 
      type: 'OUT', 
      category: { $in: ['WORKER_ADVANCE', 'WORKER_SALARY'] } 
    })
      .select('amount transaction_date category notes reference_doc')
      .sort({ transaction_date: -1 })
      .lean();

    return {
      worker_info: {
        name: worker.name,
        base_daily_wage: worker.base_daily_wage,
        status: worker.status
      },
      financial_summary: {
        total_earned: totalEarned,
        total_drawn: totalDrawn,
        net_balance: netBalance
      },
      logs_history: logs,
      transactions_history: transactions
    };
  }

  /**
   * تصفية حساب العامل (صرف راتب)
   */
  async settleAccount(data, userId, orgId) {
    const { local_id, worker_id, amount_to_pay, transaction_date, notes } = data;

    const existingTransaction = await Transaction.findOne({ local_id }).lean();
    if (existingTransaction) return { isDuplicate: true, transaction: existingTransaction };

    const worker = await Worker.findById(worker_id).lean();
    if (!worker) throw new AppError('العامل غير موجود', 404);

    const farm = await Farm.findOne({ _id: worker.farm_id, organization_id: orgId }).lean();
    if (!farm) throw new AppError('لا تملك صلاحية الوصول لبيانات هذا العامل', 403);

    const newTransaction = await Transaction.create({
      local_id,
      farm_id: worker.farm_id,
      worker_id,
      performed_by: userId,
      type: 'OUT',
      category: 'WORKER_SALARY',
      amount: Number(amount_to_pay),
      transaction_date: new Date(transaction_date),
      notes: notes ? notes.trim() : 'تصفية راتب',
      reference_doc: `سداد مستحقات العامل: ${worker.name}`
    });

    return { isDuplicate: false, transaction: newTransaction };
  }

  /**
   * تغيير حالة العامل
   */
  async changeStatus(workerId, status, orgId) {
    const worker = await Worker.findById(workerId);
    if (!worker) throw new AppError('العامل غير موجود', 404);

    const farm = await Farm.findOne({ _id: worker.farm_id, organization_id: orgId }).lean();
    if (!farm) throw new AppError('لا تملك صلاحية الوصول لبيانات هذا العامل', 403);

    if (status === 'TERMINATED') {
      const { netBalance } = await this._calculateWorkerBalance(workerId);
      if (netBalance < 0) {
        throw new AppError(`لا يمكن إنهاء عمل العامل وعليه مديونية (سلف غير مسددة) بقيمة ${Math.abs(netBalance)} ج.م`, 400);
      }
      worker.termination_date = new Date();
    } else {
      worker.termination_date = null; 
    }

    worker.status = status;
    await worker.save();
    return worker;
  }
}

module.exports = new WorkerService();