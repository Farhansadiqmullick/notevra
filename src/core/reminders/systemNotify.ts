// System notifications for reminders that come due while Notevra is in the background.
export const canNotify = (): boolean => typeof Notification !== 'undefined';

export const notifyPermission = (): NotificationPermission | 'unsupported' =>
  canNotify() ? Notification.permission : 'unsupported';

// asked from a click (setting a snooze, or Settings), never on load; asking again after a no does nothing
export async function askToNotify(): Promise<void> {
  if (!canNotify() || Notification.permission !== 'default') return;
  try {
    await Notification.requestPermission();
  } catch {
    /* an old browser that only takes a callback; the in-app notice still works */
  }
}

// a visible tab already shows the in-app notice, so this only speaks when you're elsewhere
export async function systemNotify(title: string, body: string): Promise<void> {
  if (notifyPermission() !== 'granted' || !document.hidden) return;
  const options = { body, tag: 'notevra-reminder', icon: '/icons/pwa-192.png' };
  try {
    // Android only shows notifications through the service worker
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return void (await reg.showNotification(title, options));
    new Notification(title, options);
  } catch {
    /* blocked by the system; the notice is waiting in the app */
  }
}
