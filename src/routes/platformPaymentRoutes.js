const express = require('express');
const router = express.Router();

const {
  submitPaymentRequest,
  getOwnerPaymentHistory,
  getPendingPayments,
  reviewPaymentRequest,
  clearFarmHistory
} = require('../controllers/platformPaymentController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const upload = require('../utils/fileUpload'); 

// Security Middleware
router.use(protect);

// Owner Payment Routes
router.post(
  '/request',
  authorize('OWNER'),
  upload.single('receipt_image'),
  submitPaymentRequest
);

router.get(
  '/history',
  authorize('OWNER'),
  getOwnerPaymentHistory
);

router.delete(
  '/farms/:farmId',
  authorize('OWNER'),
  clearFarmHistory
);

// Super Admin Payment Routes
router.get(
  '/pending',
  authorize('SUPER_ADMIN'),
  getPendingPayments
);

router.put(
  '/:id/review',
  authorize('SUPER_ADMIN'),
  reviewPaymentRequest
);

module.exports = router;