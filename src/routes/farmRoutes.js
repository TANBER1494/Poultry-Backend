const express = require('express');
const router = express.Router();
const { 
  addFarm, 
  getFarms, 
  updateFarmSettings, 
  suspendFarm, 
  reactivateFarm, 
  hardDeleteFarm 
} = require('../controllers/farmController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');

// تفعيل حماية تسجيل الدخول لجميع المسارات
router.use(protect);

//  مسار الجلب: متاح للمالك والمشرف
router.get('/', authorize('OWNER', 'SUPERVISOR'), getFarms);

//  باقي المسارات حكر على المالك فقط (لا نستخدم router.use هنا)
router.post('/', authorize('OWNER'), addFarm);
router.put('/:id', authorize('OWNER'), updateFarmSettings);
router.delete('/:id', authorize('OWNER'), suspendFarm);
router.put('/:id/reactivate', authorize('OWNER'), reactivateFarm); 
router.delete('/:id/hard-delete', authorize('OWNER'), hardDeleteFarm);

module.exports = router;