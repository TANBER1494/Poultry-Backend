const express = require('express');
const router = express.Router();
const { 
  registerOwner, 
  login, 
  refreshToken, 
  updateFcmToken,
  forgotPassword,
  resetPassword,
  verifyRegistration,
  resendActivationOTP,
} = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');

// مسارات عامة (Public) للتسجيل والدخول
router.post('/register-owner', registerOwner);
router.post('/login', login);
router.post('/refresh', refreshToken);

// مسارات استعادة كلمة المرور (Public)
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// مسارات تفعيل الحساب (Public)
router.post('/verify-registration', verifyRegistration);
router.post('/resend-activation-otp', resendActivationOTP);

// مسارات محمية (Protected)
router.put('/fcm-token', protect, updateFcmToken);

module.exports = router;