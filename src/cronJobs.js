const cron = require('node-cron');
const Farm = require('./models/Farm');
const Notification = require('./models/Notification');
const socket = require('./models/socket');
const Worker = require('./models/Worker');       // 🛡️ تم الإضافة
const WorkerLog = require('./models/WorkerLog'); // 🛡️ تم الإضافة

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

      const notificationsToInsert = farmsToWarn.map(farm => ({
        organization_id: farm.organization_id,
        farm_id: farm._id,
        target_role: 'OWNER',
        title: 'تنبيه: اقتراب انتهاء الاشتراك',
        message: `مزرعة (${farm.name}) سينتهي اشتراكها خلال 5 أيام. يرجى التجديد لضمان عدم توقف الخدمة.`,
        type: 'SYSTEM',
        link: '/owner/billing'
      }));

      const createdNotifications = await Notification.insertMany(notificationsToInsert);

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

  // ==========================================
  //  الوظيفة الثالثة: التقييم اليومي التلقائي للعمال (أتمتة الحضور)
  // (تعمل يومياً الساعة 23:55 قبل منتصف الليل بـ 5 دقائق)
  // ==========================================
  cron.schedule('55 23 * * *', async () => {
    console.log('[CRON] Starting daily worker attendance automation...');
    try {
      const today = new Date();
      // توحيد التاريخ للـ UTC ليتطابق مع طريقة حفظ الفرونت إند
      today.setUTCHours(0, 0, 0, 0);

      // 1. جلب كل العمال المقيمين والنشطين حالياً
      const activeWorkers = await Worker.find({ status: 'ACTIVE' }).lean();
      if (activeWorkers.length === 0) return;

      // 2. تجهيز العمليات المجمعة (Bulk Operations) لتقليل الضغط على السيرفر
      const bulkOps = activeWorkers.map(worker => ({
        updateOne: {
          // البحث عن يومية لهذا العامل في هذا التاريخ
          filter: { worker_id: worker._id, log_date: today },
          update: {
            // $setOnInsert: لن يتم تنفيذ هذا الأمر إلا إذا لم يقم المشرف بتسجيل استثناء يدوياً خلال اليوم
            $setOnInsert: {
              local_id: `WLOG_AUTO_${worker._id}_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              organization_id: worker.organization_id,
              farm_id: worker.farm_id,
              worker_id: worker._id,
              log_date: today,
              wage_multiplier: 1.0, // استحقاق يوم كامل افتراضياً
              earned_amount: worker.base_daily_wage,
              notes: 'إثبات استحقاق آلي (نظام المزارع)',
            }
          },
          upsert: true // إذا لم يجد يومية، قم بإنشائها
        }
      }));

      // 3. تنفيذ الإدراج الذكي
      const result = await WorkerLog.bulkWrite(bulkOps, { ordered: false });
      console.log(`[CRON] Auto-registered attendance for ${result.upsertedCount} workers.`);
    } catch (error) {
      console.error('[CRON] Auto-attendance Error:', error.message);
    }
  });
};

module.exports = startCronJobs;