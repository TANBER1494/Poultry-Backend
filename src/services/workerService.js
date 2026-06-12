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
  async _calculateWorkerBalance(workerId, orgId) {
    const workerObjectId = new mongoose.Types.ObjectId(workerId);
    const orgObjectId = new mongoose.Types.ObjectId(orgId);

    //  الترقية المعمارية: تضمين orgId في الـ Aggregation لأمان مطلق
    const [earnedResult, drawnResult] = await Promise.all([
      WorkerLog.aggregate([
        { $match: { worker_id: workerObjectId, organization_id: orgObjectId } },
        { $group: { _id: null, total: { $sum: '$earned_amount' } } }
      ]),
      Transaction.aggregate([
        { 
          $match: { 
            worker_id: workerObjectId, 
            organization_id: orgObjectId,
            type: 'OUT', 
            category: { $in: ['WORKER_ADVANCE', 'WORKER_SALARY'] } 
          } 
        },
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

    try {
      //  الترقية المعمارية: حقن orgId الإلزامي لإنقاذ العملية من الانهيار
      return await Worker.create({
        organization_id: orgId, 
        farm_id,
        name: name.trim(),
        phone: phone ? phone.trim() : '',
        national_id: national_id ? national_id.trim() : '',
        base_daily_wage: Number(base_daily_wage)
      });
    } catch (error) {
      if (error.code === 11000) {
        throw new AppError('يوجد عامل مسجل بالفعل بنفس الرقم القومي في هذه المزرعة', 400);
      }
      throw error;
    }
  }

  /**
   * جلب قائمة العمال
   */
  async getWorkers(farmId, orgId, filters) {
    //  الترقية المعمارية: استعلام واحد مباشر O(1) بدلاً من استعلامين متتاليين
    const query = { farm_id: farmId, organization_id: orgId };
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

    //  التوثيق السريع بخطوة واحدة
    const worker = await Worker.findOne({ _id: worker_id, organization_id: orgId }).lean();
    if (!worker || worker.status === 'TERMINATED') {
      throw new AppError('العامل غير موجود أو تم إنهاء عمله', 404);
    }

    //  الترقية المعمارية: توحيد التاريخ للـ UTC لإجبار الداتا بيز على صد التكرار تلقائياً
    const normalizedLogDate = new Date(log_date);
    normalizedLogDate.setUTCHours(0, 0, 0, 0);

    const earnedAmount = worker.base_daily_wage * Number(wage_multiplier);

    try {
      //  الترقية المعمارية: حقن orgId الإلزامي
      const newLog = await WorkerLog.create({
        local_id,
        organization_id: orgId, 
        farm_id: worker.farm_id,
        worker_id,
        recorded_by: userId,
        log_date: normalizedLogDate,
        wage_multiplier: Number(wage_multiplier),
        earned_amount: earnedAmount,
        notes: notes ? notes.trim() : ''
      });

      return { isDuplicate: false, log: newLog };
    } catch (error) {
      if (error.code === 11000) {
        throw new AppError('تم تسجيل يومية لهذا العامل في هذا التاريخ مسبقاً', 400);
      }
      throw error;
    }
  }

  /**
   * جلب كشف حساب العامل
   */
  async getWorkerStatement(workerId, orgId) {
    //  توثيق وجلب بـ O(1)
    const worker = await Worker.findOne({ _id: workerId, organization_id: orgId }).lean();
    if (!worker) throw new AppError('العامل غير موجود أو لا تملك صلاحية الوصول له', 404);

    const { totalEarned, totalDrawn, netBalance } = await this._calculateWorkerBalance(workerId, orgId);

    //  حقن orgId في الاستعلامات لتأمين (IDOR) بشكل قاطع
    const logs = await WorkerLog.find({ worker_id: workerId, organization_id: orgId })
      .select('log_date wage_multiplier earned_amount notes')
      .sort({ log_date: -1 })
      .lean();

    const transactions = await Transaction.find({ 
      worker_id: workerId, 
      organization_id: orgId,
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

    //  توثيق بخطوة واحدة
    const worker = await Worker.findOne({ _id: worker_id, organization_id: orgId }).lean();
    if (!worker) throw new AppError('العامل غير موجود أو لا تملك صلاحية الوصول له', 404);

    //  الترقية المعمارية: حقن orgId الإلزامي لإنقاذ عملية الخزينة
    const newTransaction = await Transaction.create({
      local_id,
      organization_id: orgId, 
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
    const worker = await Worker.findOne({ _id: workerId, organization_id: orgId });
    if (!worker) throw new AppError('العامل غير موجود أو لا تملك صلاحية التعديل عليه', 404);

    if (status === 'TERMINATED') {
      const { netBalance } = await this._calculateWorkerBalance(workerId, orgId);
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