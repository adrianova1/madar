'use client';

export interface TelegramWebAppInstance {
  initData: string;
  initDataUnsafe?: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
      photo_url?: string;
    };
    start_param?: string;
  };
  colorScheme?: 'light' | 'dark';
  themeParams?: Record<string, string>;
  viewportHeight?: number;
  isExpanded?: boolean;
  ready: () => void;
  expand: () => void;
  openTelegramLink?: (url: string) => void;
  requestContact?: (callback: (shared: boolean) => void) => void;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  MainButton?: {
    setText: (text: string) => void;
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
}

export function getTelegramWebApp(): TelegramWebAppInstance | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { Telegram?: { WebApp?: TelegramWebAppInstance } };
  return w.Telegram?.WebApp ?? null;
}

export function initTelegramMiniApp(): { inTelegram: boolean; initData: string; startParam?: string } {
  const tg = getTelegramWebApp();
  if (!tg) return { inTelegram: false, initData: '' };
  try {
    tg.ready();
    tg.expand();
  } catch {
    // Ignore outside Telegram
  }
  return {
    inTelegram: Boolean(tg.initData),
    initData: tg.initData || '',
    startParam: tg.initDataUnsafe?.start_param,
  };
}

/**
 * Triggers the official Telegram Mini App native contact permission dialog.
 * Note: This only initiates sharing; the server MUST still validate the actual
 * Contact message arriving via Telegram Bot API Webhook before storing any phone.
 */
export function requestTelegramContact(): Promise<{ supported: boolean; shared: boolean }> {
  const tg = getTelegramWebApp();
  if (!tg || typeof tg.requestContact !== 'function') {
    return Promise.resolve({ supported: false, shared: false });
  }
  return new Promise((resolve) => {
    try {
      tg.requestContact!((shared) => {
        resolve({ supported: true, shared: Boolean(shared) });
      });
    } catch {
      resolve({ supported: false, shared: false });
    }
  });
}

export function openTelegramUrl(url: string) {
  const tg = getTelegramWebApp();
  if (tg && typeof tg.openTelegramLink === 'function' && /^https:\/\/t\.me\//i.test(url)) {
    try {
      tg.openTelegramLink(url);
      return;
    } catch {
      // Fallback below
    }
  }
  if (typeof window !== 'undefined' && /^https:\/\//i.test(url)) {
    window.location.href = url;
  }
}

export function triggerHaptic(style: 'light' | 'medium' | 'heavy' = 'light') {
  try {
    getTelegramWebApp()?.HapticFeedback?.impactOccurred(style);
  } catch {
    // Ignore outside Telegram
  }
}

export function triggerHapticNotice(type: 'success' | 'warning' | 'error') {
  try {
    getTelegramWebApp()?.HapticFeedback?.notificationOccurred(type);
  } catch {
    // Ignore outside Telegram
  }
}
