const jwt = require('jsonwebtoken');

let io;

module.exports = {
  init: (httpServer) => {
    const { Server } = require('socket.io');
    
    // 1. تقييد صارم للمصادر (Strict CORS Policy)
    io = new Server(httpServer, {
      cors: {
        origin: process.env.NODE_ENV === 'production' ? [process.env.CLIENT_URL] : ['http://localhost:5173', 'http://localhost:3000'],
        methods: ['GET', 'POST'],
        credentials: true
      }
    });

    // 2. الجدار الناري للاتصالات (Socket Authentication Middleware)
    io.use((socket, next) => {
      try {
        // استخراج التوكن سواء تم إرساله في الـ auth أو في الـ headers
        const token = socket.handshake.auth?.token || 
                      (socket.handshake.headers?.authorization && socket.handshake.headers.authorization.split(' ')[1]);
        
        if (!token) {
          console.warn(`[Socket] اتصال مرفوض: توكن مفقود (ID: ${socket.id})`);
          return next(new Error('إجراء أمني: غير مصرح بالاتصال لعدم وجود توكن'));
        }

        // فك تشفير التوكن والتحقق من صحته
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // إرفاق بيانات المستخدم الموثق بـ session الخاص بالسوكت
        socket.user = decoded; 
        next();
      } catch (err) {
        console.warn(`[Socket] اتصال مرفوض: توكن غير صالح (ID: ${socket.id})`);
        return next(new Error('إجراء أمني: التوكن غير صالح أو منتهي الصلاحية'));
      }
    });

    return io;
  },

  getIO: () => {
    if (!io) {
      throw new Error('Socket.io لم يتم تهيئته بعد');
    }
    return io;
  }
};