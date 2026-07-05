const express = require('express');
const router = express.Router();

const {
  startCycle,
  getFarmCycles,
  getCycleDetails,
  closeCycle,
  recordCycleSale
} = require('../controllers/cycleController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

// تفعيل حماية تسجيل الدخول لجميع المسارات
router.use(protect);

// مسارات التشغيل المالي والإداري (حكر على المالك + تتطلب اشتراك فعال)
router.post('/', authorize('OWNER'), checkSubscription, startCycle);
router.put('/:id/close', authorize('OWNER'), checkSubscription, closeCycle);
router.get('/farm/:farm_id/financial-summary', authorize('OWNER'), getFarmFinancialSummary);
router.post('/:id/sales', authorize('OWNER', 'SUPERVISOR'), checkSubscription, recordCycleSale);
// مسارات القراءة والمتابعة (متاحة للمالك والمشرف)
router.get('/farm/:farm_id', authorize('OWNER', 'SUPERVISOR'), getFarmCycles);
router.get('/:id', authorize('OWNER', 'SUPERVISOR'), getCycleDetails);

module.exports = router;