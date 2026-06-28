# استخدام نسخة خفيفة وآمنة من Node.js
FROM node:18-alpine

# إنشاء مستخدم غير الـ root لزيادة الأمان (مطلوب في منصات مثل Hugging Face)
RUN adduser -D user
USER user

# تحديد مجلد العمل
WORKDIR /app

# نسخ ملفات الحزم
COPY --chown=user:user package*.json ./

# تثبيت الحزم (لبيئة الإنتاج فقط لتقليل الحجم)
RUN npm install --production

# نسخ باقي ملفات المشروع
COPY --chown=user:user . .

# فضح المنفذ الافتراضي لـ Hugging Face
EXPOSE 7860
ENV PORT=7860
ENV NODE_ENV=production

# تشغيل السيرفر
CMD ["npm", "start"]