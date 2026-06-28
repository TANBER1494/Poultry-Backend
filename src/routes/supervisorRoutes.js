const express = require('express');
const router = express.Router();

const {
  addSupervisor,
  getSupervisors,
  updateSupervisor,
  deleteSupervisor // تم الإضافة
} = require('../controllers/supervisorController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

router.use(protect);

router.post('/', authorize('OWNER'), checkSubscription, addSupervisor);
router.get('/farm/:farm_id', authorize('OWNER'), getSupervisors);
router.put('/:id', authorize('OWNER'), checkSubscription, updateSupervisor);
router.delete('/:id', authorize('OWNER'), checkSubscription, deleteSupervisor);

module.exports = router;