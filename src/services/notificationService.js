const Notification = require('../models/Notification');
const User = require('../models/User');
const admin = require('firebase-admin');
const socket = require('../models/socket');
const AppError = require('../utils/AppError');

class NotificationService {
  constructor() {
    this._initializeFirebase();
  }

  /**
   * تهيئة آمنة لـ Firebase Admin (تمنع التهيئة المزدوجة)
   * @private
   */
  _initializeFirebase() {
    if (!admin.apps.length) {
      try {
        let serviceAccount;
        if (process.env.FIREBASE_PRIVATE_KEY) {
          serviceAccount = {
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          };
        } else {
          serviceAccount = require('../config/firebase-key.json');
        }

        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        console.log('Firebase Admin Initialized Successfully');
      } catch (error) {
        console.error('Failed to initialize Firebase Admin:', error.message);
      }
    }
  }

  /**
   * بناء الاستعلام الأساسي الموحد بناءً على صلاحيات المستخدم
   * @private
   */
  _buildBaseQuery(user) {
    const { role, _id, organization_id } = user;
    let query = {};

    if (role === 'SUPER_ADMIN') {
      query.target_role = 'SUPER_ADMIN';
    } else if (role === 'OWNER') {
      query.organization_id = organization_id;
      query.target_role = 'OWNER';
    } else if (role === 'SUPERVISOR') {
      query.organization_id = organization_id;
      query.target_role = 'SUPERVISOR';
      query.target_user_id = _id;
    } else {
      throw new AppError('صلاحية غير صالحة للوصول إلى الإشعارات', 403);
    }

    return query;
  }

  /**
   * الإرسال المزدوج للإشعارات (قاعدة البيانات + Socket + FCM)
   */
  async sendAppNotification(data) {
    const { title, message, type, target_role, target_user_id, organization_id, link } = data;

    try {
      const newNotification = await Notification.create({
        title, message, type, target_role, target_user_id, organization_id, link
      });

      let room;
      if (target_role === 'SUPER_ADMIN') room = 'SUPER_ADMIN_ROOM';
      else if (target_role === 'OWNER') room = organization_id.toString();
      else if (target_user_id) room = target_user_id.toString();

      if (room && socket.getIO()) {
        socket.getIO().to(room).emit('receiveNotification', newNotification);
      }

      let query = { status: 'ACTIVE', fcm_token: { $ne: null } };
      if (target_role === 'SUPER_ADMIN') query.role = 'SUPER_ADMIN';
      else if (target_role === 'OWNER') { query.role = 'OWNER'; query.organization_id = organization_id; }
      else if (target_user_id) query._id = target_user_id;

      const targetUsers = await User.find(query).select('fcm_token').lean();
      const tokens = targetUsers.map(user => user.fcm_token).filter(Boolean);

      if (tokens.length > 0) {
        const payload = {
          notification: { title, body: message },
          tokens, 
        };
        const response = await admin.messaging().sendEachForMulticast(payload);
        console.log(`FCM Sent: ${response.successCount} Success, ${response.failureCount} Failed`);
      }

      return newNotification;
    } catch (error) {
      console.error('Error in Dual Notification System:', error);
      throw new AppError('فشل في إرسال الإشعار', 500);
    }
  }

  /**
   * جلب الإشعارات
   */
  async getNotifications(user) {
    const query = this._buildBaseQuery(user);
    return await Notification.find(query).sort({ createdAt: -1 }).limit(50).lean();
  }

  /**
   * تحديد إشعار كمقروء
   */
  async markAsRead(notificationId, user) {
    const query = { ...this._buildBaseQuery(user), _id: notificationId };
    const notification = await Notification.findOneAndUpdate(query, { is_read: true });
    if (!notification) throw new AppError('الإشعار غير موجود أو لا تملك صلاحية الوصول إليه', 404);
    return true;
  }

  /**
   * تحديد الكل كمقروء
   */
  async markAllAsRead(user) {
    const query = { ...this._buildBaseQuery(user), is_read: false };
    await Notification.updateMany(query, { is_read: true });
    return true;
  }

  /**
   * حذف جميع الإشعارات المقروءة
   */
  async deleteAllReadNotifications(user) {
    const query = { ...this._buildBaseQuery(user), is_read: true };
    await Notification.deleteMany(query);
    return true;
  }

  /**
   * حذف إشعار محدد
   */
  async deleteNotification(notificationId, user) {
    const query = { ...this._buildBaseQuery(user), _id: notificationId };
    const deleted = await Notification.findOneAndDelete(query);
    if (!deleted) throw new AppError('الإشعار غير موجود أو لا تملك صلاحية حذفه', 404);
    return true;
  }
}

module.exports = new NotificationService();