const cron = require('node-cron');
const Farm = require('./models/Farm');
const Notification = require('./models/Notification');
const socket = require('./models/socket'); 

const startCronJobs = () => {
  // ==========================================
  // 💳 الوظيفة: تنبيه انتهاء الاشتراك قبل 5 أيام
  // (تعمل يومياً الساعة 10:00 صباحاً)
  // ==========================================
  cron.schedule('0 10 * * *', async () => {
    try {
      console.log('⏱️ Checking farm subscriptions...');
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
      });

      for (const farm of farmsToWarn) {
        const notification = await Notification.create({
          organization_id: farm.organization_id,
          farm_id: farm._id,
          target_role: 'OWNER',
          title: 'تنبيه: اقتراب انتهاء الاشتراك 💳',
          message: `مزرعة (${farm.name}) سينتهي اشتراكها خلال 5 أيام. يرجى التجديد لضمان عدم توقف الخدمة.`,
          type: 'SYSTEM',
          link: '/owner/billing'
        });

        try {
          const io = socket.getIO();
          io.to(farm.organization_id.toString()).emit('new_notification', notification);
        } catch (socketErr) {}
      }
    } catch (error) {
      console.error('Subscription Cron Error:', error);
    }
  });
};

module.exports = startCronJobs;