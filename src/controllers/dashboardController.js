const dashboardService = require('../services/dashboardService');
const asyncHandler = require('../utils/asyncHandler');

/**
 * @desc    Get operational and financial summary for all farms under an organization
 * @route   GET /api/dashboard/master
 * @access  Private (Owner Only)
 */
const getOwnerMasterDashboard = asyncHandler(async (req, res, next) => {
  const orgId = req.user.organization_id;

  const dashboardData = await dashboardService.getMasterDashboard(orgId);

  res.status(200).json(dashboardData);
});

module.exports = { getOwnerMasterDashboard };