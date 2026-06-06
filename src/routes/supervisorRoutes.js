const express = require('express');
const router = express.Router();

const {
  addSupervisor,
  getSupervisors
} = require('../controllers/supervisorController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

// حماية المسارات
router.use(protect);

// مسارات إدارة المشرفين (حكر على المالك فقط)
router.post('/', authorize('OWNER'), checkSubscription, addSupervisor);
router.get('/farm/:farm_id', authorize('OWNER'), getSupervisors);

module.exports = router;