const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const {
  getSettings,
  updatePhone,
  updatePassword,
  updatePreferences
} = require('../controllers/settingsController');

// Security Middleware
router.use(protect);
router.use(authorize('OWNER', 'SUPER_ADMIN'));

// Settings Management Routes
router.get('/', getSettings);
router.put('/phone', updatePhone);
router.put('/password', updatePassword);
router.put('/preferences', updatePreferences);

module.exports = router;