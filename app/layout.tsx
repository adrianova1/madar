import type { Metadata, Viewport } from 'next';
import { Vazirmatn, IBM_Plex_Mono } from 'next/font/google';
import Script from 'next/script';
import './globals.css';

const vazirmatn = Vazirmatn({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-vazirmatn',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MADAR | مدار — جهان تو، آدم‌های تو، بازی‌های تو',
  description:
    'پلتفرم اجتماعی و سرگرمی مدار: آشنایی هوشمند و آشنایی ناشناس ونوس، بازی‌های حکم، مافیای خودکار، کوییز و بطری سه‌بعدی جرئت و حقیقت، نجوای ناشناس و دستیار هوشمند گروه تلگرام.',
  openGraph: {
    title: 'MADAR | مدار — جهان تو، آدم‌های تو، بازی‌های تو',
    description:
      'پلتفرم یکپارچه تلگرام، مینی‌اپ و وب برای آشنایی، بازی‌های گروهی، پیام ناشناس و مدیریت هوشمند گروه.',
    type: 'website',
    locale: 'fa_IR',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MADAR | مدار',
    description: 'جهان تو، آدم‌های تو، بازی‌های تو',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#050816',
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="fa"
      dir="rtl"
      className={`${vazirmatn.variable} ${ibmPlexMono.variable} dark`}
    >
      <body
        suppressHydrationWarning
        className="font-sans bg-[#050816] text-slate-100 antialiased selection:bg-cyan-400/25 selection:text-cyan-100 overflow-x-clip"
      >
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
        {children}
      </body>
    </html>
  );
}
