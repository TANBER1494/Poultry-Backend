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

// Security Middleware: OWNER Only
router.use(protect);
router.use(authorize('OWNER')); 

// Farms Management Routes
router.post('/', addFarm);
router.get('/', getFarms);
router.put('/:id', updateFarmSettings);
router.delete('/:id', suspendFarm);
router.put('/:id/reactivate', reactivateFarm); 
router.delete('/:id/hard-delete', hardDeleteFarm);

module.exports = router;