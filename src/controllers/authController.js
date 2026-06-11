const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const authService = require('../services/authService');

const registerOwner = asyncHandler(async (req, res, next) => {
  const { name, phone, password, organization_name, farm_name } = req.body;

  if (!name || !phone || !password || !organization_name || !farm_name) {
    return next(
      new AppError('جميع بيانات المالك والمزرعة الأساسية مطلوبة', 400)
    );
  }

  const result = await authService.registerOwner(req.body);

  res.status(201).json({
    message: 'تم تأسيس النظام بنجاح',
    token: result.accessToken,
    refresh_token: result.refreshToken,
    data: {
      owner: result.owner,
      organization: result.organization,
      farm: result.farm,
    },
  });
});

const login = asyncHandler(async (req, res, next) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return next(new AppError('يرجى إدخال رقم الهاتف وكلمة المرور', 400));
  }

  const result = await authService.login(phone, password);

  res.status(200).json({
    message: 'تم تسجيل الدخول بنجاح',
    token: result.accessToken,
    refresh_token: result.refreshToken,
    user: result.user,
  });
});

const refreshToken = asyncHandler(async (req, res, next) => {
  const { refresh_token } = req.body;

  const tokens = await authService.refreshAuthToken(refresh_token);

  res.status(200).json({
    message: 'تم تجديد الجلسة بنجاح',
    token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
});

const updateFcmToken = asyncHandler(async (req, res, next) => {
  const { fcm_token } = req.body;
  if (!fcm_token) return next(new AppError('توكن الإشعارات مطلوب', 400));

  await authService.updateFcmToken(req.user._id, fcm_token);

  res.status(200).json({ message: 'تم تحديث توكن الإشعارات بنجاح' });
});

module.exports = {
  registerOwner,
  login,
  refreshToken,
  updateFcmToken,
};
