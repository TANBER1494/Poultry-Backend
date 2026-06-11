const express = require('express');
const router = express.Router();

const {
  addWorker,
  getWorkers,
  recordWorkerLog,
  getWorkerStatement,
  settleWorkerAccount,
  changeWorkerStatus
} = require('../controllers/workerController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

router.use(protect);

// تم منح الصلاحيات بالكامل للمشرف (SUPERVISOR) لإدارة العمال
router.post('/', authorize('SUPERVISOR'), checkSubscription, addWorker);
router.put('/:worker_id/status', authorize('SUPERVISOR'), checkSubscription, changeWorkerStatus);

// مسارات المعاملات المالية للعمال وتصفية الرواتب
router.post('/settle', authorize('SUPERVISOR'), checkSubscription, settleWorkerAccount);
router.get('/:worker_id/statement', authorize('SUPERVISOR'), getWorkerStatement);

// تسجيل اليومية (الاستحقاق اليومي للمقيمين)
router.post('/logs', authorize('SUPERVISOR'), checkSubscription, recordWorkerLog);
router.get('/farm/:farm_id', authorize('SUPERVISOR'), getWorkers);

module.exports = router;