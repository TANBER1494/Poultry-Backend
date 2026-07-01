const Notification = require('../models/Notification');
const User = require('../models/User'); 
const admin = require('firebase-admin');
const socket = require('../models/socket'); 
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ==========================================
//  1. تهيئة الفايربيز (Firebase Admin Initialization)
// ==========================================
try {
  let serviceAccount;

  if (process.env.FIREBASE_BASE64_KEY) {
    const decodedKey = Buffer.from(process.env.FIREBASE_BASE64_KEY, 'base64').toString('utf8');
    serviceAccount = JSON.parse(decodedKey);
    console.log('✅ Loaded Firebase Config via Base64');
  } 
  else if (process.env.FIREBASE_PRIVATE_KEY) {
    serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  } 
  else {
    serviceAccount = require('../config/firebase-key.json');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('✅ Firebase Admin Initialized Successfully');
} catch (error) {
  console.error('❌ فشل تهيئة Firebase Admin:', error.message);
}

// ==========================================
// 2. دالة السينيورز: المدفع الذكي (قاعدة بيانات + Socket + FCM)
// ==========================================
const sendAppNotification = async ({ title, message, type, target_role, target_user_id, organization_id, link }) => {
  try {
    const newNotification = await Notification.create({
      title, message, type, target_role, target_user_id, organization_id, link
    });

    let room;
    if (target_role === 'SUPER_ADMIN') room = 'SUPER_ADMIN_ROOM';
    else if (target_role === 'OWNER') room = organization_id.toString();
    else if (target_user_id) room = target_user_id.toString();

    if (room && socket.getIO()) {
      socket.getIO().to(room).emit('new_notification', newNotification);
    }

    let query = { status: 'ACTIVE', fcm_token: { $ne: null } };
    
    if (target_role === 'SUPER_ADMIN') query.role = 'SUPER_ADMIN';
    else if (target_role === 'OWNER') { query.role = 'OWNER'; query.organization_id = organization_id; }
    else if (target_user_id) query._id = target_user_id;

    const targetUsers = await User.find(query).select('fcm_token').lean();
    const tokens = targetUsers.map(user => user.fcm_token).filter(Boolean);

    if (tokens.length > 0) {
      
      //  1. نظام تخصيص الأيقونات (اللوجو) بناءً على النوع
      const BASE_URL = 'https://poultry-frontend-eta.vercel.app';
      let notificationIcon = `${BASE_URL}/pwa-192x192.png`;

      // يمكنك مستقبلاً رفع صور لكل نوع في مجلد public في الفرونت إند واستدعائها هنا
      switch (type) {
        case 'EGG_SALE':
          notificationIcon = `${BASE_URL}/egg-icon.png`; 
          break;
        case 'HIGH_MORTALITY':
          notificationIcon = `${BASE_URL}/alert-icon.png`; 
          break;
        case 'FEED_DELIVERY':
          notificationIcon = `${BASE_URL}/truck-icon.png`;
          break;
      }

      //  2. بناء الـ Payload بمعايير Web Push الرسمية
      const payload = {
        notification: {
          title: title,
          body: message,
        },
        data: {
          url: String(link || '/'),
          click_action: String(link || '/')
        },
        // هنا يكمن السحر الذي سيجبر الأندرويد على الاستجابة
        webpush: {
          fcm_options: {
            link: String(link || '/') 
          },
          notification: {
            icon: notificationIcon, 
            badge: `${BASE_URL}/badge.png`,
            dir: 'rtl'
          }
        },
        tokens: tokens, 
      };

      const response = await admin.messaging().sendEachForMulticast(payload);
      console.log(`🚀 FCM Sent: ${response.successCount} Success, ${response.failureCount} Failed`);
    }

    return newNotification;
  } catch (error) {
    console.error('❌ خطأ في نظام الإرسال المزدوج للإشعارات:', error);
  }
};

// ==========================================
//  دوال جلب وإدارة الإشعارات 
// ==========================================

const getNotifications = asyncHandler(async (req, res, next) => {
  const { role, _id, organization_id } = req.user;
  let query = {};

  if (role === 'SUPER_ADMIN') query.target_role = 'SUPER_ADMIN';
  else if (role === 'OWNER') { query.organization_id = organization_id; query.target_role = 'OWNER'; }
  else if (role === 'SUPERVISOR') { query.organization_id = organization_id; query.target_role = 'SUPERVISOR'; query.target_user_id = _id; }
  else return res.status(200).json([]);

  const notifications = await Notification.find(query).sort({ createdAt: -1 }).limit(50).lean();
  res.status(200).json(notifications);
});

const markAsRead = asyncHandler(async (req, res, next) => {
  const { role, _id, organization_id } = req.user;
  let query = { _id: req.params.id };

  if (role === 'SUPER_ADMIN') query.target_role = 'SUPER_ADMIN';
  else { query.organization_id = organization_id; if (role === 'SUPERVISOR') query.target_user_id = _id; }

  const notification = await Notification.findOneAndUpdate(query, { is_read: true });
  if (!notification) return next(new AppError('الإشعار غير موجود', 404));
  res.status(200).json({ message: 'تم التحديد كمقروء' });
});

const markAllAsRead = asyncHandler(async (req, res, next) => {
  const { role, _id, organization_id } = req.user;
  let query = { is_read: false };

  if (role === 'SUPER_ADMIN') query.target_role = 'SUPER_ADMIN';
  else { query.organization_id = organization_id; query.target_role = role; if (role === 'SUPERVISOR') query.target_user_id = _id; }

  await Notification.updateMany(query, { is_read: true });
  res.status(200).json({ message: 'تم تحديد الكل كمقروء' });
});

const deleteAllReadNotifications = asyncHandler(async (req, res, next) => {
  const { role, _id, organization_id } = req.user;
  let query = { is_read: true };

  if (role === 'SUPER_ADMIN') query.target_role = 'SUPER_ADMIN';
  else { query.organization_id = organization_id; query.target_role = role; if (role === 'SUPERVISOR') query.target_user_id = _id; }

  await Notification.deleteMany(query);
  res.status(200).json({ message: 'تم تنظيف الإشعارات المقروءة' });
});

const deleteNotification = asyncHandler(async (req, res, next) => {
  const { role, _id, organization_id } = req.user;
  let query = { _id: req.params.id };

  if (role === 'SUPER_ADMIN') query.target_role = 'SUPER_ADMIN';
  else { query.organization_id = organization_id; if (role === 'SUPERVISOR') query.target_user_id = _id; }

  const deleted = await Notification.findOneAndDelete(query);
  if (!deleted) return next(new AppError('الإشعار غير موجود', 404));
  res.status(200).json({ message: 'تم حذف الإشعار' });
});


// ==========================================
//  دوال تسجيل التوكن والاختبار
// ==========================================

const registerFcmToken = asyncHandler(async (req, res, next) => {
  const { fcm_token } = req.body;
  if (!fcm_token) return next(new AppError('FCM token is required', 400));
  
  await User.findByIdAndUpdate(req.user._id, { fcm_token }, { new: true });
  res.status(200).json({ message: 'تم تسجيل FCM Token بنجاح' });
});

const testSendNotification = asyncHandler(async (req, res, next) => {
  const notification = await sendAppNotification(req.body);
  res.status(200).json({ message: 'تم إرسال الإشعار التجريبي بنجاح', notification });
});

module.exports = { 
  sendAppNotification,
  getNotifications, 
  markAsRead, 
  markAllAsRead, 
  deleteNotification, 
  deleteAllReadNotifications,
  registerFcmToken,
  testSendNotification
};