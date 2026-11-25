# راهنمای واقعی استقرار پروژه MADAR (مدار) روی هاست cPanel و سرور VPS

این سند مطابق با معماری واقعی و فعلی پروژه **MADAR** (Next.js 15 + React 19 + SQLite `better-sqlite3` + موتور مدیریت گروه بومی بدون Gemini API) نوشته شده است. تمام استاب‌های قدیمی پایتون (`madar_cpanel_app.py` و `passenger_wsgi.py`) و وابستگی‌های `GEMINI_API_KEY` حذف شده‌اند.

---

## ۱. بررسی صادقانه محدودیت‌های هاست اشتراکی cPanel

پروژه MADAR یک اپلیکیشن **Next.js 15 تمام‌عیار (App Router + API Routes)** با دیتابیس بومی **`better-sqlite3`** (دارای باینری C++ / Native Addon) است. قبل از استقرار روی هاست اشتراکی cPanel، این محدودیت‌های واقعی را در نظر بگیرید:

1. **نیاز به Node.js نسخه ۲۰ یا بالاتر:** Next.js 15 روی Node.js 16 یا ۱۸ قدیمی اجرا نمی‌شود. cPanel شما باید قابلیت **Setup Node.js App** با نسخه `20.x` یا `22.x` داشته باشد.
2. **بیلد باینری `better-sqlite3`:** در هاست‌های CloudLinux محدود که ابزارهای کامپایل C++ (`gcc`/`make`/`python3`) یا دسترسی اینترنت برای دریافت prebuild بسته باشد، دستور `npm install` ممکن است روی `better-sqlite3` خطا دهد.
3. **محدودیت RAM هنگام `next build`:** ساخت نسخه Production با دستور `npm run build` معمولاً به **۱.۵ تا ۲ گیگابایت RAM** نیاز دارد. روی هاست اشتراکی با محدودیت RAM پایین، ممکن است بیلد با خطای `Out of Memory (Killed)` متوقف شود. راه‌حل: پروژه را روی سیستم خودتان یا CI با همان معماری لینوکس (x64) بیلد بگیرید و پوشه `.next` را آپلود کنید، یا از VPS استفاده کنید.
4. **محدودیت پردازش هم‌زمان (Multi-Worker) روی SQLite WAL:** دیتابیس SQLite باید در یک مسیر **بیرون از `public_html`** با مجوز نوشتن پایدار قرار گیرد (تنظیم از طریق `DATABASE_PATH`) و Passenger روی **تک‌پردازش (Single Instance)** اجرا شود تا قفل‌های WAL تداخل ایجاد نکنند.
5. **عدم نیاز به Gemini API:** تمام منطق مدیریت گروه (ضدلینک، ضدتبلیغ، ضدتبچی، ضداسپم، ضدفیلود، قفل رسانه و پاسخ‌گویی دستورات) کاملاً بومی و روی سرور خودتان اجرا می‌شود و به هیچ کلید هوش مصنوعی خارجی نیاز ندارد.

> **توصیه مهندسی برای ترافیک واقعی و پایداری بلندمدت:** اگر هاست cPanel شما محدودیت RAM یا کامپایلر دارد، استقرار روی یک **VPS لینوکس (حداقل ۲GB RAM، اوبونتو ۲۲.۰۴/۲۴.۰۴) با Node.js 20 + PM2 + Nginx + SSL رایگان Certbot** بسیار پایدارتر، سریع‌تر و ارزان‌تر از ارتقای هاست اشتراکی است.

---

## ۲. متغیرهای محیطی الزامی (`.env`)

یک فایل `.env` در ریشه پروژه (یا در بخش Environment Variables پنل cPanel) با مقادیر واقعی تنظیم کنید. هرگز `.env` را در Git ذخیره نکنید:

```env
NODE_ENV=production
PORT=3000
APP_URL=https://madar.yourdomain.com
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=YourMadarBot

# مسیر فایل دیتابیس SQLite بیرون از پوشه عمومی وب
DATABASE_PATH=/home/YOUR_CPANEL_USER/madar_data/madar.db

# توکن واقعی ربات تلگرام از @BotFather
TELEGRAM_BOT_TOKEN=123456789:REPLACE_WITH_REAL_BOT_TOKEN

# رمز تصادفی طولانی (حداقل ۳۲ کاراکتر) برای احراز اصالت Webhook تلگرام
TELEGRAM_WEBHOOK_SECRET=replace-with-strong-random-hex-secret

# رمز پنل مدیریت مدار (حداقل ۱۶ کاراکتر)
MADAR_ADMIN_PASSCODE=replace-with-strong-admin-passcode

# درگاه واقعی پیامک برای ارسال OTP شماره‌های +98 (در صورت نبودن، OTP در Production غیرفعال می‌ماند)
SMS_PROVIDER_URL=https://your-sms-gateway.example/send
SMS_PROVIDER_API_KEY=replace-with-real-sms-api-key
```

---

## ۳. مراحل استقرار روی cPanel (با Setup Node.js App)

1. در cPanel یک پوشه خصوصی بیرون از `public_html` بسازید (مثلاً `/home/YOUR_USER/madar_app` و `/home/YOUR_USER/madar_data`).
2. سورس پروژه را (بدون `node_modules`، بدون `.env` و بدون `data/*.db*`) در `/home/YOUR_USER/madar_app` قرار دهید.
3. وارد **Setup Node.js App** شوید و تنظیمات زیر را وارد کنید:
   - **Node.js version:** `20.x` (یا بالاتر)
   - **Application mode:** `Production`
   - **Application root:** `madar_app`
   - **Application URL:** دامنه یا ساب‌دامنه HTTPS شما (مثلاً `madar.yourdomain.com`)
   - **Application startup file:** `cpanel-deploy/server.js`
4. تمام متغیرهای بخش ۲ را در جدول **Environment variables** وارد کرده و ذخیره کنید.
5. از طریق Terminal یا SSH وارد محیط مجازی Node (دستور `source` نمایش‌داده‌شده در بالای صفحه Setup Node.js App) شوید و اجرا کنید:
   ```bash
   npm ci --omit=dev
   npm run build
   ```
   *(اگر RAM هاست برای `npm run build` کافی نبود، بیلد را روی لینوکس ۶۴بیتی انجام دهید و پوشه `.next` را منتقل کنید.)*
6. در پنل **Setup Node.js App** روی **Restart** کلیک کنید و آدرس `https://madar.yourdomain.com` را بررسی نمایید.

---

## ۴. جایگزین پیشنهادی: استقرار روی سرور VPS (Node 20 + PM2 + Nginx)

```bash
# ۱. نصب وابستگی‌ها و بیلد
npm ci
npm run build

# ۲. اجرا با PM2 (تک‌پردازش برای هماهنگی کامل با SQLite WAL)
pm2 start cpanel-deploy/server.js --name madar-app --env production
pm2 save
pm2 startup
```

نمونه پیکربندی Reverse Proxy در Nginx (`/etc/nginx/sites-available/madar`):

```nginx
server {
    listen 80;
    server_name madar.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

سپس گواهی HTTPS را فعال کنید:
```bash
sudo certbot --nginx -d madar.yourdomain.com
```

---

## ۵. تنظیم Webhook و Mini App در تلگرام

1. در `@BotFather` دستور `/newapp` یا تنظیم دکمه Menu Button را روی آدرس HTTPS اپلیکیشن خود (`https://madar.yourdomain.com`) قرار دهید.
2. Webhook ربات را با هدر امنیتی `secret_token` ثبت کنید (دقیقاً برابر با `TELEGRAM_WEBHOOK_SECRET` در `.env`):

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://madar.yourdomain.com/api/telegram/webhook",
    "secret_token": "YOUR_TELEGRAM_WEBHOOK_SECRET",
    "allowed_updates": ["message"]
  }'
```

3. برای عملکرد ضدلینک، ضدتبچی، حذف پیام و سکوت خودکار در گروه‌های تلگرام، ربات را به گروه اضافه کرده و دسترسی ادمین **Delete Messages** و **Restrict Members** را به آن بدهید.

---

## ۶. پاک‌سازی ایمن فایل‌های دیتابیس از تاریخچه مخزن GitHub (در صورت Commit قبلی)

فایل `.gitignore` اکنون پوشه `data/` و تمام فایل‌های `*.db`، `*.db-wal` و `*.db-shm` را مسدود می‌کند. اگر پیش‌تر فایل‌های `data/madar.db-wal` یا `data/madar.db-shm` در تاریخچه مخزن GitHub ثبت شده‌اند، ابتدا یک نسخه پشتیبان کامل از مخزن بگیرید و سپس با `git-filter-repo` آن‌ها را از تاریخچه پاک کنید:

```bash
# ۱. ابتدا حتماً بکاپ بگیرید
git clone --mirror https://github.com/YOUR_ORG/YOUR_REPO.git madar-backup.git

# ۲. حذف فایل‌های دیتابیس از تاریخچه Git (روی کلون جدید)
git clone https://github.com/YOUR_ORG/YOUR_REPO.git madar-clean
cd madar-clean
git filter-repo --invert-paths --path-glob 'data/*.db*' --path-glob '*.sqlite*'

# ۳. بررسی وضعیت و Force Push هماهنگ با تیم
git push --force --all
git push --force --tags
```
