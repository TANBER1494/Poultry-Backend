const express = require('express');
const router = express.Router();

const {
  addBarn,
  getFarmBarns,
  updateBarn,
  deleteBarn
} = require('../controllers/barnController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

// تفعيل حماية تسجيل الدخول لجميع المسارات
router.use(protect);

// مسارات الإضافة والتعديل (حكر على المالك + تتطلب اشتراك فعال)
router.post('/', authorize('OWNER'), checkSubscription, addBarn);
router.put('/:id', authorize('OWNER'), checkSubscription, updateBarn);
router.delete('/:id', authorize('OWNER'), checkSubscription, deleteBarn);

// مسارات القراءة (متاحة للمالك والمشرف لعرض العنابر)
router.get('/farm/:farm_id', authorize('OWNER', 'SUPERVISOR'), getFarmBarns);

module.exports = router;