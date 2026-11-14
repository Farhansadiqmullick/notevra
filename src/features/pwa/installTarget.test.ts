import { describe, expect, it } from 'vitest';
import { detectInstallTarget, inAppName, type InstallEnv } from './installTarget';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  // iPadOS 13+ sends a desktop Mac UA
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 339.0.3.12.91 (iPhone15,2; iOS 17_5; en_US; en; scale=3.00; 1179x2556; 614374564)',
  facebookAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.0;]',
  macSafari17: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macSafari16: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.68',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
};

function env(ua: string, over: Partial<InstallEnv> = {}): InstallEnv {
  return { ua, maxTouchPoints: 0, standalone: false, canPrompt: false, ...over };
}

describe('detectInstallTarget', () => {
  it('says installed when already running standalone, whatever the browser', () => {
    expect(detectInstallTarget(env(UA.iphoneSafari, { standalone: true, maxTouchPoints: 5 }))).toBe('installed');
    expect(detectInstallTarget(env(UA.winEdge, { standalone: true, canPrompt: true }))).toBe('installed');
  });

  it('sends every iOS browser to the Share sheet', () => {
    expect(detectInstallTarget(env(UA.iphoneSafari, { maxTouchPoints: 5 }))).toBe('ios');
    expect(detectInstallTarget(env(UA.iphoneChrome, { maxTouchPoints: 5 }))).toBe('ios');
  });

  it('treats an iPad with a desktop UA as iOS, not Mac Safari', () => {
    expect(detectInstallTarget(env(UA.ipad, { maxTouchPoints: 5 }))).toBe('ios');
  });

  it('offers the one-tap prompt on Android Chrome, even before the event fires', () => {
    expect(detectInstallTarget(env(UA.androidChrome, { maxTouchPoints: 5, canPrompt: true }))).toBe('prompt');
    expect(detectInstallTarget(env(UA.androidChrome, { maxTouchPoints: 5 }))).toBe('prompt');
  });

  it('uses the menu on Android browsers without the prompt, and the prompt once it fires', () => {
    expect(detectInstallTarget(env(UA.samsung, { maxTouchPoints: 5 }))).toBe('android-menu');
    expect(detectInstallTarget(env(UA.androidFirefox, { maxTouchPoints: 5 }))).toBe('android-menu');
    expect(detectInstallTarget(env(UA.samsung, { maxTouchPoints: 5, canPrompt: true }))).toBe('prompt');
  });

  it('spots in-app webviews before anything else', () => {
    expect(detectInstallTarget(env(UA.instagram, { maxTouchPoints: 5 }))).toBe('in-app');
    expect(detectInstallTarget(env(UA.facebookAndroid, { maxTouchPoints: 5, canPrompt: true }))).toBe('in-app');
    expect(inAppName(UA.instagram)).toBe('Instagram');
    expect(inAppName(UA.facebookAndroid)).toBe('Facebook');
  });

  it('uses Add to Dock on Mac Safari 17+, and calls older Safari unsupported', () => {
    expect(detectInstallTarget(env(UA.macSafari17))).toBe('mac-safari');
    expect(detectInstallTarget(env(UA.macSafari16))).toBe('unsupported');
  });

  it('offers the prompt on desktop Chrome and Edge', () => {
    expect(detectInstallTarget(env(UA.macChrome))).toBe('prompt');
    expect(detectInstallTarget(env(UA.winEdge, { canPrompt: true }))).toBe('prompt');
  });

  it('calls desktop Firefox unsupported', () => {
    expect(detectInstallTarget(env(UA.winFirefox))).toBe('unsupported');
  });
});
