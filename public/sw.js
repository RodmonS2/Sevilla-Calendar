const APP_URL = '/';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data?.json() ?? {};
  } catch {
    message = { body: event.data?.text() ?? '' };
  }

  const notification = self.registration.showNotification(message.title || 'Family Calendar', {
    body: message.body || 'You have a family event coming up.',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: message.tag || 'family-calendar-reminder',
    silent: false,
    data: { url: message.url || APP_URL },
  });
  const appBadge = typeof self.navigator.setAppBadge === 'function'
    ? self.navigator.setAppBadge(1)
    : Promise.resolve();
  event.waitUntil(Promise.all([notification, appBadge]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || APP_URL, self.location.origin).href;
  event.waitUntil((async () => {
    if (typeof self.navigator.clearAppBadge === 'function') await self.navigator.clearAppBadge();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const windowClient of windows) {
      if ('focus' in windowClient) {
        await windowClient.navigate(targetUrl);
        return windowClient.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});
