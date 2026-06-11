const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'غير مصرح لك بالوصول، بيانات الاعتماد مفقودة.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password_hash');

    if (!req.user || req.user.deleted_at) {
      return res.status(401).json({ message: 'إجراء أمني: حساب المستخدم لم يعد موجوداً.' });
    }

    //  تفعيل زر الـ Kill Switch الحقيقي
    if (req.user.current_session_id !== decoded.sessionId) {
      return res.status(401).json({ message: 'تم تسجيل الدخول من جهاز آخر. تم إنهاء هذه الجلسة أمنياً.' });
    }

    if (req.user.status !== 'ACTIVE') {
      return res.status(403).json({ message: 'هذا الحساب معطل حالياً، راجع الإدارة.' });
    }

    next();
  } catch (error) {
    return res.status(401).json({ message: 'انتهت صلاحية الجلسة أو أن التوكن غير صالح.' });
  }
};

module.exports = { protect };