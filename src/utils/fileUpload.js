const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');
const AppError = require('./AppError'); //  استدعاء صائد الأخطاء الخاص بنا

// (ملاحظة معمارية: يُفضل مستقبلاً فصل إعدادات Cloudinary في مجلد config)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 🚀 تطبيق نمط (Dictionary/Map) للامتثال لمبدأ (Open/Closed)
// إذا أردت إضافة نوع جديد لاحقاً، فقط أضفه لهذا الكائن بدون لمس المنطق
const FOLDER_MAP = {
  invoice_image: 'farm_system/invoices',
  receipt_image: 'farm_system/receipts',
  profile_picture: 'farm_system/profiles', // مثال لقابلية التوسع
};

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // تحديد المجلد ديناميكياً، مع وضع مسار افتراضي (Fallback)
    const folderName = FOLDER_MAP[file.fieldname] || 'farm_system/misc';

    const orgId = req.user ? req.user.organization_id : 'system';
    const publicId = `org-${orgId}-${Date.now()}`;

    return {
      folder: folderName,
      resource_type: 'auto',
      public_id: publicId,
    };
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

  const isMimeValid = file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';
  const isExtValid = allowedExts.includes(ext);

  if (isMimeValid && isExtValid) {
    cb(null, true);
  } else {
    //  استخدام AppError لتوجيه الخطأ للفرونت إند كـ 400 Bad Request مهندم
    cb(new AppError('صيغة الملف غير صالحة! يرجى رفع صور (JPG, PNG) أو ملفات PDF فقط.', 400), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // حد أقصى 5 ميجابايت
});

module.exports = upload;