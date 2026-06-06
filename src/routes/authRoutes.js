const express = require('express');
const router = express.Router();
const { registerOwner, login, refreshToken, updateFcmToken } = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');

// Public Routes for Authentication and System Initialization
router.post('/register-owner', registerOwner);
router.post('/login', login);
router.post('/refresh', refreshToken);

// Protected Routes
router.put('/fcm-token', protect, updateFcmToken);

module.exports = router;