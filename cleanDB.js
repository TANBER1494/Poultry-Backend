const mongoose = require('mongoose');
require('dotenv').config();

const cleanDatabase = async () => {
  try {
    console.log('🔄 جاري الاتصال بقاعدة البيانات...');
    await mongoose.connect(process.env.MONGO_URI);
    
    console.log('⚠️ جاري مسح قاعدة البيانات بالكامل...');
    await mongoose.connection.db.dropDatabase();
    
    console.log('✅ تم تنظيف الداتا بيز بنجاح! البيئة الآن جاهزة للاختبار.');
    process.exit(0);
  } catch (error) {
    console.error('❌ حدث خطأ أثناء التنظيف:', error);
    process.exit(1);
  }
};

cleanDatabase();