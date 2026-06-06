require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');

// 🚀 استدعاء ملفات الـ Routes للمزارع الدواجن
const authRoutes = require('./routes/authRoutes');
const farmRoutes = require('./routes/farmRoutes');
const barnRoutes = require('./routes/barnRoutes');
const cycleRoutes = require('./routes/cycleRoutes');
const dailyLogRoutes = require('./routes/dailyLogRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const merchantRoutes = require('./routes/merchantRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const workerRoutes = require('./routes/workerRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const platformPaymentRoutes = require('./routes/platformPaymentRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const adminRoutes = require('./routes/adminRoutes');  
const startCronJobs = require('./cronJobs');
const supervisorRoutes = require('./routes/supervisorRoutes');

const app = express();
connectDB();

// ==========================================
// 🛡️ طبقات الحماية والأمن (Security Middlewares)
// ==========================================
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

app.use(helmet({ frameguard: false }));

const allowedOrigins = [
  'http://localhost:5173', 
  'http://localhost:3000', 
  process.env.CLIENT_URL 
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('إجراء أمني: غير مصرح لك بالوصول - CORS Policy'));
    }
  },
  credentials: true 
}));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 1000, 
  message: 'تم تجاوز الحد المسموح من الطلبات، يرجى المحاولة بعد قليل'
});
app.use('/api', generalLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 10, 
  message: 'محاولات تسجيل دخول كثيرة جداً، تم حظر جهازك مؤقتاً لمدة ربع ساعة.'
});
app.use('/api/auth/login', loginLimiter);

app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(hpp()); 

app.use((req, res, next) => {
  if (req.body) mongoSanitize.sanitize(req.body, { replaceWith: '_' });
  if (req.query) mongoSanitize.sanitize(req.query, { replaceWith: '_' });
  if (req.params) mongoSanitize.sanitize(req.params, { replaceWith: '_' });
  next();
});

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ==========================================
// 🌐 توجيه المسارات (API Routes)
// ==========================================
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'success', message: 'Poultry Farm ERP API is running securely!' });
});

app.use('/api/auth', authRoutes);
app.use('/api/farms', farmRoutes);
app.use('/api/barns', barnRoutes);
app.use('/api/cycles', cycleRoutes);
app.use('/api/daily-logs', dailyLogRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/merchants', merchantRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/workers', workerRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/payments', platformPaymentRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/supervisors', supervisorRoutes);
// ==========================================
// 🚀 معالجة الأخطاء الشاملة (Global Error Handling)
// ==========================================
app.use((err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    err.statusCode = 400;
    err.message = `بيانات غير صالحة: المعرّف (${err.value}) ليس بصيغة صحيحة.`;
  }

  if (process.env.NODE_ENV === 'development') {
    console.error('🔥 Error:', err.message);
  }

  res.status(err.statusCode).json({
    status: err.status,
    message: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ==========================================
// 🚀 تشغيل السيرفر وتفعيل (Socket.io)
// ==========================================
const http = require('http');
const socket = require('./models/socket'); 

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
const io = socket.init(server);

io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  socket.on('joinRoom', (room) => {
    socket.join(room);
    console.log(`🏠 Socket ${socket.id} joined room: ${room}`);
  });
  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Poultry Farm Server running securely in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  startCronJobs(); 
});

process.on('unhandledRejection', (err) => {
  console.log('💥 UNHANDLED REJECTION! Shutting down gracefully...');
  console.log(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});