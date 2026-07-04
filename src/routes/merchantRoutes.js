const express = require('express');
const router = express.Router();

const {
  addMerchant,
  getMerchants,
  updateMerchant,
  getMerchantStatement,
  deleteMerchant,
  addRepresentative,
  removeRepresentative,
  recordPayment 
} = require('../controllers/merchantController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

// تفعيل حماية تسجيل الدخول لجميع المسارات
router.use(protect);

router.post('/', authorize('OWNER'), checkSubscription, addMerchant);
router.put('/:id', authorize('OWNER'), checkSubscription, updateMerchant);
router.delete('/:id', authorize('OWNER'), checkSubscription, deleteMerchant);

router.get('/:id/statement', authorize('OWNER'), getMerchantStatement);

router.post('/:id/payments', authorize('OWNER'), checkSubscription, recordPayment);

router.get('/farm/:farm_id', authorize('OWNER', 'SUPERVISOR'), getMerchants);
router.post('/:id/representatives', authorize('OWNER'), checkSubscription, addRepresentative);
router.delete('/:id/representatives/:rep_id', authorize('OWNER'), checkSubscription, removeRepresentative);

module.exports = router;