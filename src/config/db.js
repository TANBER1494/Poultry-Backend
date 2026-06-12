const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // إعدادات متقدمة لإدارة الاتصالات (Connection Pooling)
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 20, // السماح بـ 20 اتصال متزامن لتخفيف الضغط
      serverSelectionTimeoutMS: 5000,
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);

    // مراقبة انقطاع الاتصال اللحظي
    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected! Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected successfully.');
    });

    // الإغلاق الآمن عند توقف السيرفر (Graceful Shutdown)
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('MongoDB connection closed due to app termination');
      process.exit(0);
    });

  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1); 
  }
};

module.exports = connectDB;