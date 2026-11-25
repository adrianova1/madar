'use client';

export interface TelegramWebAppInstance {
  initData: string;
  initDataUnsafe?: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    start_param?: string;
  };
  colorScheme?: 'light' | 'dark';
  themeParams?: Record<string, string>;
  viewportHeight?: number;
  isExpanded?: boolean;
  ready: () => void;
  expand: () => void;
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
