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

  event.waitUntil(self.registration.showNotification(message.title || 'Family Calendar', {
    body: message.body || 'You have a family event coming up.',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: message.tag || 'family-calendar-reminder',
    data: { url: message.url || APP_URL },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || APP_URL, self.location.origin).href;
  event.waitUntil((async () => {
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
