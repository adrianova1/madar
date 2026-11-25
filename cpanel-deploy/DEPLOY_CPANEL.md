# MADAR | مدار — راهنمای استقرار مستقل روی هاست cPanel (Python 3.11 + Passenger)

این بسته به‌صورت کاملاً مستقل برای مسیر `/home/boysyst3/madar` طراحی شده و **هیچ فایلی یا دیتابیسی از `/home/boysyst3/g3pibot` را تغییر نمی‌دهد یا حذف نمی‌کند**.

## ۱. بررسی محدودیت‌های واقعی cPanel و معماری سازگار
- **وب‌سرور / Passenger**: از WSGI استاندارد با `Flask` استفاده می‌شود (پایدارتر از ASGI/Uvicorn روی Phusion Passenger اشتراکی).
- **بدون پردازش دائمی (Polling/WebSocket/Redis)**: ربات تلگرام به‌جای `getUpdates` دائمی، فقط با **HTTPS Webhook** (`/telegram/webhook`) کار می‌کند و بازی‌های چندنفره از **Smart Polling** سازگار با cPanel استفاده می‌کنند.
- **وظایف زمان‌بندی‌شده**: از طریق **cPanel Cron Jobs** (`cron_tasks.py`) برای ریست سقف روزانه هوش مصنوعی، پاک‌سازی OTPهای منقضی و پشتیبان‌گیری دیتابیس اجرا می‌شود.
- **دیتابیس**: SQLAlchemy با پشتیبانی مستقیم از **MySQL (cPanel)** و قابلیت مهاجرت بدون تغییر به **PostgreSQL** (`schema_mysql.sql`).

## ۲. مراحل استقرار در cPanel (بدون نیاز به SSH)
1. در File Manager پوشه مستقل `/home/boysyst3/madar` بسازید.
2. فایل‌های پوشه `cpanel-deploy/` را در `/home/boysyst3/madar` قرار دهید.
3. از بخش **MySQL Databases** در cPanel یک دیتابیس و کاربر جدید اختصاصی برای `madar` بسازید (به دیتابیس `g3pibot` دست نزنید) و فایل `schema_mysql.sql` را در phpMyAdmin ایمپورت کنید.
4. از بخش **Setup Python App** یک اپلیکیشن جدید با Python `3.11` روی دامنه یا ساب‌دامنه HTTPS (مثلاً `madar.yourdomain.ir`) بسازید:
   - Application root: `/home/boysyst3/madar`
   - Application startup file: `passenger_wsgi.py`
   - Application Entry point: `application`
5. متغیرهای محیطی زیر را در تنظیمات Setup Python App وارد کنید (هرگز داخل کد نگذارید):
   - `DATABASE_URL`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_SECRET`
   - `GEMINI_API_KEY`
   - `APP_URL`
   - `MADAR_ADMIN_PASSCODE`
6. در cPanel Terminal محیط مجازی را فعال کنید و پکیج‌ها را نصب کنید:
   ```bash
   pip install flask sqlalchemy pymysql requests google-genai
   ```
7. Webhook تلگرام را روی HTTPS ثبت کنید:
   ```bash
   curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d "url=$APP_URL/telegram/webhook" \
     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
   ```
8. در **Cron Jobs** دستور روزانه زیر را برای ریست سهمیه و پاک‌سازی OTP ثبت کنید:
   ```text
   0 0 * * * /home/boysyst3/virtualenv/madar/3.11/bin/python /home/boysyst3/madar/cron_tasks.py
   ```
