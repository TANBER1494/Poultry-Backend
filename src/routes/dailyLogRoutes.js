const express = require('express');
const router = express.Router();

const {
  createBulkDailyLogs,
  getCycleDailyLogs
} = require('../controllers/dailyLogController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

router.use(protect);

//  مسار الإدخال المجمع الجديد
router.post('/bulk', authorize('OWNER', 'SUPERVISOR'), checkSubscription, createBulkDailyLogs);

router.get('/cycle/:cycle_id', authorize('OWNER', 'SUPERVISOR'), getCycleDailyLogs);

module.exports = router;