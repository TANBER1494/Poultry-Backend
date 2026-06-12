const cron = require('node-cron');
const Farm = require('./models/Farm');
const Notification = require('./models/Notification');
const socket = require('./models/socket'); 

const startCronJobs = () => {
  
  // ==========================================
  // الوظيفة الأولى: تحديث حالة الاشتراكات المنتهية
  // (تعمل يومياً الساعة 00:01 بعد منتصف الليل)
  // ==========================================
  cron.schedule('1 0 * * *', async () => {
    console.log('[CRON] Starting daily subscription suspension check...');
    try {
      const now = new Date();
      
      const trialResult = await Farm.updateMany(
        { subscription_status: 'TRIAL', trial_ends_at: { $lt: now } },
        { $set: { subscription_status: 'OVERDUE' } }
      );

      const activeResult = await Farm.updateMany(
        { subscription_status: 'ACTIVE', subscription_ends_at: { $lt: now } },
        { $set: { subscription_status: 'OVERDUE' } }
      );

      const totalUpdated = trialResult.modifiedCount + activeResult.modifiedCount;
      console.log(`[CRON] Suspended ${totalUpdated} expired farms.`);
    } catch (error) {
      console.error('[CRON] Suspension Error:', error.message);
    }
  });

  // ==========================================
  // الوظيفة الثانية: تنبيه انتهاء الاشتراك قبل 5 أيام
  // (تعمل يومياً الساعة 10:00 صباحاً)
  // ==========================================
  cron.schedule('0 10 * * *', async () => {
    console.log('[CRON] Checking for farms nearing expiration...');
    try {
      const now = new Date();
      
      const fiveDaysLater = new Date();
      fiveDaysLater.setDate(now.getDate() + 5);
      
      const startOfTargetDay = new Date(fiveDaysLater.setHours(0, 0, 0, 0));
      const endOfTargetDay = new Date(fiveDaysLater.setHours(23, 59, 59, 999));

      const farmsToWarn = await Farm.find({
        subscription_status: { $in: ['ACTIVE', 'TRIAL'] },
        $or: [
          { trial_ends_at: { $gte: startOfTargetDay, $lte: endOfTargetDay } },
          { subscription_ends_at: { $gte: startOfTargetDay, $lte: endOfTargetDay } }
        ]
      }).select('_id organization_id name').lean();

      if (farmsToWarn.length === 0) return;

      // الحل الهندسي لمشكلة N+1 (Bulk Insert)
      const notificationsToInsert = farmsToWarn.map(farm => ({
        organization_id: farm.organization_id,
        farm_id: farm._id,
        target_role: 'OWNER',
        title: 'تنبيه: اقتراب انتهاء الاشتراك',
        message: `مزرعة (${farm.name}) سينتهي اشتراكها خلال 5 أيام. يرجى التجديد لضمان عدم توقف الخدمة.`,
        type: 'SYSTEM',
        link: '/owner/billing'
      }));

      // إدخال الإشعارات دفعة واحدة في قاعدة البيانات
      const createdNotifications = await Notification.insertMany(notificationsToInsert);

      // بث الإشعارات الحية بشكل آمن ومتوازي
      const io = socket.getIO();
      if (io) {
        createdNotifications.forEach(notification => {
          io.to(notification.organization_id.toString()).emit('new_notification', notification);
        });
      }

      console.log(`[CRON] Sent ${farmsToWarn.length} expiration warnings.`);
    } catch (error) {
      console.error('[CRON] Warning Cron Error:', error.message);
    }
  });
};

module.exports = startCronJobs;