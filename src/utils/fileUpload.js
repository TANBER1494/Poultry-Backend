const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    let folderName = 'farm_system/misc';
    let resourceType = 'auto';

    if (file.fieldname === 'invoice_image') {
      folderName = 'farm_system/invoices';
    } else if (file.fieldname === 'receipt_image') {
      folderName = 'farm_system/receipts';
    }

    const orgId = req.user ? req.user.organization_id : 'system';
    const publicId = `org-${orgId}-${Date.now()}`;

    return {
      folder: folderName,
      resource_type: resourceType,
      public_id: publicId,
    };
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

  if (file.fieldname === 'invoice_image' || file.fieldname === 'receipt_image') {
    const isMimeValid = file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';
    const isExtValid = allowedExts.includes(ext);

    if (isMimeValid && isExtValid) {
      cb(null, true);
    } else {
      cb(new Error('صيغة الملف غير صالحة! يرجى رفع صور (JPG, PNG) أو ملفات PDF فقط.'), false);
    }
  } else {
    cb(new Error('حقل الملف غير معروف في الطلب!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

module.exports = upload;