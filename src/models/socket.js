let io;

module.exports = {
  // تهيئة السيرفر
  init: (httpServer) => {
    const { Server } = require('socket.io');
    io = new Server(httpServer, {
      cors: {
        origin: '*', // سنقوم بتأمينه لاحقاً ليتوافق مع الـ Frontend
        methods: ['GET', 'POST']
      }
    });

    // 🚀 الجراحة الأولى: السماح للسوكيت بالاستماع وضم المستخدم لغرفته
    io.on('connection', (socket) => {
      socket.on('joinRoom', (room) => {
        socket.join(room);
        console.log(`🔌 Socket ${socket.id} joined room: ${room}`);
      });
    });

    return io;
  },
  // استدعاء السيرفر من أي كنترولر
  getIO: () => {
    if (!io) {
      throw new Error('Socket.io لم يتم تهيئته بعد!');
    }
    return io;
  }
};