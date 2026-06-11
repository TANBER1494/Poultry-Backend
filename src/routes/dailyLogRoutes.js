const express = require('express');
const router = express.Router();

const {
  createDailyLog,
  getCycleDailyLogs
} = require('../controllers/dailyLogController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

// تفعيل حماية تسجيل الدخول لجميع المسارات
router.use(protect);

// مسار تسجيل اليومية (متاح للمشرف والمالك + يتطلب اشتراك فعال لضمان حفظ البيانات)
router.post('/', authorize( 'SUPERVISOR'), checkSubscription, createDailyLog);

// مسار عرض أرشيف اليوميات لدورة معينة
router.get('/cycle/:cycle_id', authorize('SUPERVISOR'), getCycleDailyLogs);

module.exports = router;