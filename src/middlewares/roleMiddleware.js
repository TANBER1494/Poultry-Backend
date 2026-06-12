const AppError = require('../utils/AppError');

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(
        new AppError(`إجراء أمني: دورك الحالي (${req.user?.role || 'مجهول'}) لا يملك صلاحية لتنفيذ هذا الإجراء.`, 403)
      );
    }
    next();
  };
};

module.exports = { authorize };