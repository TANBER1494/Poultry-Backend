const express = require('express');
const router = express.Router();

const {
  addMerchant,
  getMerchants,
  updateMerchant,
  getMerchantStatement,
  deleteMerchant,
  addRepresentative,
  removeRepresentative
} = require('../controllers/merchantController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

// تفعيل حماية تسجيل الدخول لجميع المسارات
router.use(protect);

// مسارات الإضافة والتعديل والحذف (حكر على المالك + تتطلب اشتراك فعال)
router.post('/', authorize('OWNER'), checkSubscription, addMerchant);
router.put('/:id', authorize('OWNER'), checkSubscription, updateMerchant);
router.delete('/:id', authorize('OWNER'), checkSubscription, deleteMerchant);

// مسارات الاستعلام عن الحسابات (حكر على المالك)
router.get('/:id/statement', authorize('OWNER'), getMerchantStatement);

// مسار جلب القائمة (متاح للمالك والمشرف لاستخدامه في إنشاء الفواتير)
router.get('/farm/:farm_id', authorize('OWNER', 'SUPERVISOR'), getMerchants);
router.post('/:id/representatives', authorize('OWNER'), checkSubscription, addRepresentative);
router.delete('/:id/representatives/:rep_id', authorize('OWNER'), checkSubscription, removeRepresentative);

module.exports = router;