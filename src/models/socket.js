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

    //  التدخل الجراحي: تفعيل الغرف لكي يعمل الاتصال اللحظي
    io.on('connection', (socket) => {
      console.log(`🔌 جهاز متصل بالسوكيت: ${socket.id}`);

      // الاستماع لطلب الفرونت إند بالانضمام للغرفة
      socket.on('joinRoom', (room) => {
        socket.join(room);
        console.log(`🏠 السوكيت ${socket.id} انضم للغرفة: ${room}`);
      });

      socket.on('disconnect', () => {
        console.log(`❌ السوكيت ${socket.id} غادر الاتصال`);
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