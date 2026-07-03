const sgMail = require('@sendgrid/mail');

class EmailService {
  constructor() {
    // إعداد مفتاح SendGrid
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  }

  /**
   * إرسال كود الـ OTP بديناميكية باستخدام HTTP API لتخطي حظر السيرفرات
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
      actionText = 'يرجى استخدام كود التحقق التالي:';
    }

    const htmlTemplate = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #334155; }
          .container { max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
          .header { background-color: #4f46e5; color: white; padding: 24px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; font-weight: 700; }
          .content { padding: 32px 24px; }
          .message-box { background-color: #f1f5f9; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; border: 1px dashed #cbd5e1; }
          .code { font-size: 32px; font-weight: 900; color: #4f46e5; letter-spacing: 4px; }
          .warning { font-size: 13px; color: #64748b; text-align: center; margin-top: 20px; }
          .footer { background-color: #f8fafc; padding: 16px; text-align: center; border-top: 1px solid #e2e8f0; }
          .footer p { margin: 4px 0; font-size: 12px; color: #94a3b8; }
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

    const msg = {
      to: options.email,
      from: {
        email: process.env.EMAIL_USER,
        name: 'نظام إدارة المزارع'
      },
      subject: subject,
      text: `${actionText} الكود هو: ${options.otp}`,
      html: htmlTemplate,
    };

    try {
      await sgMail.send(msg);
      console.log(`✅ تم إرسال كود الـ OTP بنجاح عبر SendGrid إلى: ${options.email}`);
    } catch (error) {
      console.error('❌ خطأ من سيرفر SendGrid:', error);
      if (error.response) {
        console.error(error.response.body);
      }
      throw new Error('تعذر الإرسال، يرجى المحاولة لاحقاً');
    }
  }
}

module.exports = new EmailService();