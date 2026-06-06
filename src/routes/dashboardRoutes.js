const express = require('express');
const router = express.Router();
const { getOwnerMasterDashboard } = require('../controllers/dashboardController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');

// Security Middleware: OWNER Only
router.use(protect);
router.use(authorize('OWNER'));

// Master Dashboard Route
router.get('/master', getOwnerMasterDashboard);

module.exports = router;