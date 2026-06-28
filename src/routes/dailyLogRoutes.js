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

router.post('/', authorize('OWNER', 'SUPERVISOR'), checkSubscription, createDailyLog);
router.get('/cycle/:cycle_id', authorize('OWNER', 'SUPERVISOR'), getCycleDailyLogs);

module.exports = router;