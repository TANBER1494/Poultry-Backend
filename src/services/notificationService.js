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
        console.log('🔥 Firebase Admin Initialized Successfully');
      } catch (error) {
        console.error('⚠️ Failed to initialize Firebase Admin:', error.message);
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
   *  الترقية المعمارية: دعم الـ Transactions وإرسال الـ Push بشكل خلفي (Background)
   */
  async sendAppNotification(data, session = null) {
    const { title, message, type, target_role, target_user_id, organization_id, link } = data;

    try {
      const createOptions = session ? { session } : {};
      const [newNotification] = await Notification.create([{
        title, message, type, target_role, target_user_id, organization_id, link
      }], createOptions);

      // 1. الإرسال اللحظي عبر Socket (لا يكسر النظام إذا فشل)
      try {
        let room;
        if (target_role === 'SUPER_ADMIN') room = 'SUPER_ADMIN_ROOM';
        else if (target_role === 'OWNER') room = organization_id.toString();
        else if (target_user_id) room = target_user_id.toString();

        if (room && socket.getIO()) {
          //  توحيد اسم الحدث ليتوافق مع الفرونت إند وباقي السيرفر
          socket.getIO().to(room).emit('new_notification', newNotification);
        }
      } catch (socketErr) {
        console.warn('Socket Emission Failed:', socketErr.message);
      }

      // 2. إرسال إشعار الموبايل FCM في الخلفية (Background Promise)
      //  لا نقوم بعمل await هنا حتى لا نعطل سرعة الرد الأساسية (Non-blocking)
      this._sendPushNotifications(target_role, organization_id, target_user_id, title, message).catch(err => {
        console.error('[FCM Background Error]:', err.message);
      });

      return newNotification;
    } catch (error) {
      console.error('Error creating Notification in DB:', error);
      throw new AppError('فشل في حفظ الإشعار في قاعدة البيانات', 500);
    }
  }

  /**
   *  الترقية المعمارية: إرسال FCM مع تقسيم الطلبات (Chunking) لمنع الانهيار
   * @private
   */
  async _sendPushNotifications(target_role, organization_id, target_user_id, title, message) {
    if (!admin.apps.length) return; // الخروج بصمت إذا لم يعمل فايربيز

    let query = { status: 'ACTIVE', fcm_token: { $ne: null } };
    if (target_role === 'SUPER_ADMIN') query.role = 'SUPER_ADMIN';
    else if (target_role === 'OWNER') { query.role = 'OWNER'; query.organization_id = organization_id; }
    else if (target_user_id) query._id = target_user_id;

    const targetUsers = await User.find(query).select('fcm_token').lean();
    const tokens = targetUsers.map(user => user.fcm_token).filter(Boolean);

    if (tokens.length === 0) return;

    //  حل ثغرة فايربيز: إرسال بحد أقصى 500 توكن في الدفعة الواحدة
    const chunkSize = 500;
    for (let i = 0; i < tokens.length; i += chunkSize) {
      const chunk = tokens.slice(i, i + chunkSize);
      const payload = {
        notification: { title, body: message },
        tokens: chunk, 
      };
      
      try {
        const response = await admin.messaging().sendEachForMulticast(payload);
        console.log(`FCM Sent: ${response.successCount} Success, ${response.failureCount} Failed`);
      } catch (err) {
        console.error('FCM Multicast Error:', err.message);
      }
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