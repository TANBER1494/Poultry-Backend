const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    //  تهيئة الاتصال الآمن مع سيرفرات جوجل
    this.transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465, // استخدام البورت الآمن والمشفر
      secure: true, // تفعيل الـ SSL/TLS
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS, // هنا نضع الـ App Password وليس الباسوورد العادية
      },
    });
  }

  /**
   * إرسال كود الـ OTP بديناميكية حسب نوع الإجراء
   */
  async sendOTP(options) {
    let subject = '';
    let actionText = '';

    if (options.type === 'activation') {
      subject = 'كود تفعيل حسابك ';
      actionText = 'مرحباً بك في نظام إدارة مزارع الدواجن. لتفعيل حسابك وإكمال عملية التسجيل، يرجى استخدام كود التحقق الآمن أدناه:';
    } else if (options.type === 'reset_password') {
      subject = 'كود استعادة كلمة المرور ';
      actionText = 'لقد تلقينا طلباً لاستعادة كلمة المرور الخاصة بحسابك. يرجى استخدام كود التحقق الآمن أدناه:';
    } else {
      subject = 'كود التحقق الخاص بك ';
      actionText = 'يرجى استخدام كود التحقق الآمن أدناه لإكمال الإجراء المطلوب:';
    }

    const htmlTemplate = `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; direction: rtl; }
          .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
          .header { background-color: #16a34a; padding: 25px; text-align: center; } 
          .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.5px; }
          .content { padding: 40px 30px; color: #1e293b; line-height: 1.7; text-align: right; }
          .message-box { background-color: #f1f5f9; padding: 25px; border-radius: 8px; text-align: center; margin: 30px 0; border: 2px dashed #cbd5e1; }
          .code { font-size: 36px; font-weight: 800; color: #16a34a; letter-spacing: 8px; margin: 0; }
          .footer { background-color: #f8fafc; padding: 20px; text-align: center; color: #64748b; font-size: 13px; border-top: 1px solid #e2e8f0; }
          .warning { font-size: 14px; color: #64748b; background-color: #fffbeb; padding: 12px; border-right: 4px solid #f59e0b; border-radius: 4px; text-align: right; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>نظام إدارة مزارع الدواجن</h1>
          </div>
          
          <div class="content">
            <p style="font-size: 18px; margin-top: 0; font-weight: 600;">أهلاً بك يا ${options.name}،</p>
            <p style="margin-bottom: 20px; font-size: 15px;">${actionText}</p>
            
            <div class="message-box">
              <span class="code">${options.otp}</span>
            </div>
            
            <p class="warning">هذا الكود صالح لمدة <strong>10 دقائق</strong> فقط. لحماية حسابك، لا تشارك هذا الكود مع أي شخص.</p>
          </div>
          
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Poultry ERP. جميع الحقوق محفوظة.</p>
            <p>لقد تلقيت هذه الرسالة بناءً على طلب أمان تم إجراؤه لحسابك.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      const mailOptions = {
        from: `"نظام إدارة المزارع" <${process.env.EMAIL_USER}>`, // اسم احترافي للمرسل
        to: options.email,
        subject: subject,
        text: `${actionText} الكود هو: ${options.otp}`,
        html: htmlTemplate,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('✅ Email sent securely:', info.messageId);
      return info;
    } catch (err) {
      console.error("❌ Nodemailer Exception:", err);
      throw new Error('تعذر الإرسال، يرجى المحاولة لاحقاً');
    }
  }
}

module.exports = new EmailService();