const notificationService = require('../services/notificationService');
const asyncHandler = require('../utils/asyncHandler');

/**
 * @desc    Get user notifications
 * @route   GET /api/notifications
 * @access  Private
 */
const getNotifications = asyncHandler(async (req, res, next) => {
  const notifications = await notificationService.getNotifications(req.user);
  res.status(200).json(notifications);
});

/**
 * @desc    Mark a single notification as read
 * @route   PUT /api/notifications/:id/read
 * @access  Private
 */
const markAsRead = asyncHandler(async (req, res, next) => {
  await notificationService.markAsRead(req.params.id, req.user);
  res.status(200).json({ message: 'تم التحديد كمقروء' });
});

/**
 * @desc    Mark all unread notifications as read
 * @route   PUT /api/notifications/read-all
 * @access  Private
 */
const markAllAsRead = asyncHandler(async (req, res, next) => {
  await notificationService.markAllAsRead(req.user);
  res.status(200).json({ message: 'تم تحديد الكل كمقروء' });
});

/**
 * @desc    Delete all read notifications
 * @route   DELETE /api/notifications/read
 * @access  Private
 */
const deleteAllReadNotifications = asyncHandler(async (req, res, next) => {
  await notificationService.deleteAllReadNotifications(req.user);
  res.status(200).json({ message: 'تم تنظيف الإشعارات المقروءة' });
});

/**
 * @desc    Delete a specific notification
 * @route   DELETE /api/notifications/:id
 * @access  Private
 */
const deleteNotification = asyncHandler(async (req, res, next) => {
  await notificationService.deleteNotification(req.params.id, req.user);
  res.status(200).json({ message: 'تم حذف الإشعار' });
});

/**
 * @desc    Test send notification (Admin only)
 * @route   POST /api/notifications/test
 * @access  Private (Super Admin)
 */
const testSendNotification = asyncHandler(async (req, res, next) => {
  const notification = await notificationService.sendAppNotification(req.body);
  res.status(200).json({
    message: 'تم إرسال الإشعار بنجاح',
    notification
  });
});

module.exports = { 
  getNotifications, 
  markAsRead, 
  markAllAsRead, 
  deleteNotification, 
  deleteAllReadNotifications,
  testSendNotification
};