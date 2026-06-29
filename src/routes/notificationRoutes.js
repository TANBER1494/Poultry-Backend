const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');

const { 
  getNotifications, 
  markAsRead, 
  markAllAsRead, 
  deleteNotification, 
  deleteAllReadNotifications,
  testSendNotification,
  registerFcmToken
} = require('../controllers/notificationController');

// Security Middleware
router.use(protect);

// Notifications Retrieval
router.get('/', getNotifications);

// Static Notification Routes
router.post('/register-token', registerFcmToken);
router.put('/read-all', markAllAsRead);
router.delete('/read', deleteAllReadNotifications);
router.post('/send', testSendNotification);

// Dynamic Notification Routes
router.put('/:id/read', markAsRead);
router.delete('/:id', deleteNotification);

module.exports = router;