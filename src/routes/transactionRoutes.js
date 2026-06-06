const express = require('express');
const router = express.Router();

const {
  createTransaction,
  getTransactions,
  getTreasuryBalance
} = require('../controllers/transactionController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

// تفعيل حماية تسجيل الدخول لجميع المسارات
router.use(protect);

// مسارات إدخال البيانات (متاحة للمالك والمشرف + تتطلب اشتراك فعال)
router.post('/', authorize('OWNER', 'SUPERVISOR'), checkSubscription, createTransaction);

// مسارات التقارير المالية (حكر على المالك فقط لضمان سرية الحسابات)
router.get('/farm/:farm_id', authorize('OWNER'), getTransactions);
router.get('/farm/:farm_id/balance', authorize('OWNER'), getTreasuryBalance);

module.exports = router;