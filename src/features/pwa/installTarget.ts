// Which install path this browser offers. Pure: callers pass navigator values in.

export type InstallTarget =
  | 'installed'
  | 'prompt'
  | 'ios'
  | 'mac-safari'
  | 'android-menu'
  | 'in-app'
  | 'unsupported';

export interface InstallEnv {
  ua: string;
  maxTouchPoints: number;
  standalone: boolean;
  canPrompt: boolean;
}

// social and search apps open links in a webview that can't install anything
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|TikTok|musical_ly|Snapchat|Pinterest|Twitter|Line\/|GSA\//i;

export function isIosDevice(ua: string, maxTouchPoints: number): boolean {
  // iPadOS reports itself as a Mac; the touch points give it away
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

export function isAndroid(ua: string): boolean {
  return /Android/.test(ua);
}

function isChromium(ua: string): boolean {
  return /Chrome\/|Chromium\/|Edg\//.test(ua) && !/SamsungBrowser|Firefox|FxiOS/.test(ua);
}

function macSafariVersion(ua: string): number {
  if (!/Macintosh/.test(ua) || /Chrome|Chromium|Edg\/|Firefox|OPR/.test(ua)) return 0;
  const m = /Version\/(\d+)[\d.]* Safari/.exec(ua);
  return m ? Number(m[1]) : 0;
}

export function detectInstallTarget({ ua, maxTouchPoints, standalone, canPrompt }: InstallEnv): InstallTarget {
  if (standalone) return 'installed';
  if (IN_APP.test(ua)) return 'in-app';
  if (canPrompt) return 'prompt';
  // every iOS browser installs through the Share sheet (third-party ones since iOS 16.4)
  if (isIosDevice(ua, maxTouchPoints)) return 'ios';
  if (isAndroid(ua)) return isChromium(ua) ? 'prompt' : 'android-menu';
  if (macSafariVersion(ua) >= 17) return 'mac-safari';
  // desktop Chrome/Edge: beforeinstallprompt may just not have fired yet
  if (isChromium(ua)) return 'prompt';
  return 'unsupported';
}

// Which app's webview we're in, for the "open in your browser" line.
export function inAppName(ua: string): string {
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
  if (/LinkedInApp/i.test(ua)) return 'LinkedIn';
  if (/TikTok|musical_ly/i.test(ua)) return 'TikTok';
  if (/Snapchat/i.test(ua)) return 'Snapchat';
  if (/Pinterest/i.test(ua)) return 'Pinterest';
  if (/Twitter/i.test(ua)) return 'X';
  if (/Line\//i.test(ua)) return 'LINE';
  if (/GSA\//i.test(ua)) return 'the Google app';
  return 'this app';
}
