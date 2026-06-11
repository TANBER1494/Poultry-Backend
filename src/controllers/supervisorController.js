const supervisorService = require('../services/supervisorService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

/**
 * @desc    Add a new supervisor to a farm
 * @route   POST /api/supervisors
 * @access  Private (Owner)
 */
const addSupervisor = asyncHandler(async (req, res, next) => {
  const { name, phone, password, farm_id } = req.body;

  if (!name || !phone || !password || !farm_id) {
    return next(new AppError('جميع بيانات المشرف مطلوبة (الاسم، الهاتف، كلمة المرور، المزرعة)', 400));
  }

  const newSupervisor = await supervisorService.createSupervisor(req.body, req.user.organization_id);

  res.status(201).json({
    message: 'تم إضافة حساب المشرف بنجاح، يمكنه الآن تسجيل الدخول',
    supervisor: { id: newSupervisor._id, name: newSupervisor.name, phone: newSupervisor.phone }
  });
});

/**
 * @desc    Get all supervisors for a specific farm
 * @route   GET /api/supervisors/farm/:farm_id
 * @access  Private (Owner)
 */
const getSupervisors = asyncHandler(async (req, res, next) => {
  const supervisors = await supervisorService.getSupervisors(req.params.farm_id, req.user.organization_id);
  res.status(200).json({ count: supervisors.length, supervisors });
});

/**
 * @desc    Update supervisor details or status (e.g., Suspend)
 * @route   PUT /api/supervisors/:id
 * @access  Private (Owner)
 */
const updateSupervisor = asyncHandler(async (req, res, next) => {
  const supervisor = await supervisorService.updateSupervisor(req.params.id, req.user.organization_id, req.body);
  
  res.status(200).json({ 
    message: 'تم تحديث بيانات المشرف بنجاح', 
    supervisor: { id: supervisor._id, name: supervisor.name, status: supervisor.status } 
  });
});

/**
 * @desc    Soft delete a supervisor (Fire/Remove)
 * @route   DELETE /api/supervisors/:id
 * @access  Private (Owner)
 */
const deleteSupervisor = asyncHandler(async (req, res, next) => {
  await supervisorService.deleteSupervisor(req.params.id, req.user.organization_id);
  res.status(200).json({ message: 'تم حذف حساب المشرف من النظام بنجاح' });
});

module.exports = { 
  addSupervisor, 
  getSupervisors,
  updateSupervisor,
  deleteSupervisor
};