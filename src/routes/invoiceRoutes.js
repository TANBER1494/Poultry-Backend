const express = require('express');
const router = express.Router();

const {
  createInvoice,
  getInvoices,
  getInvoiceDetails,
  deleteInvoice
} = require('../controllers/invoiceController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

// تفعيل حماية تسجيل الدخول لجميع المسارات
router.use(protect);

// مسار إنشاء الفاتورة (متاح للمالك والمشرف + يتطلب اشتراك فعال)
router.post('/', authorize('OWNER', 'SUPERVISOR'), checkSubscription, createInvoice);

// مسارات القراءة والمتابعة (متاحة للمالك والمشرف)
router.get('/farm/:farm_id', authorize('OWNER', 'SUPERVISOR'), getInvoices);
router.get('/:id', authorize('OWNER', 'SUPERVISOR'), getInvoiceDetails);

// مسار إلغاء الفاتورة (حكر على المالك فقط نظراً لتأثيره على الخزينة والمخزن)
router.delete('/:id', authorize('OWNER'), checkSubscription, deleteInvoice);

module.exports = router;