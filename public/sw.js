// ─── Roger AI Service Worker ───────────────────────────────────────────────
// Handles Web Push notifications and offline caching.

const CACHE_NAME = 'roger-ai-v1';

// ── Push notification handler ─────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const title = data.title ?? 'Roger AI';
  const options = {
    body:    data.body  ?? 'You have a new message from Roger.',
    icon:    data.icon  ?? '/mascot.png',
    badge:   '/icon.png',
    tag:     data.tag   ?? 'roger-notification',
    renotify: true,
    data: {
      url:      data.url      ?? '/',
      type:     data.type     ?? 'general',
      userId:   data.userId   ?? null,
    },
    actions: data.actions ?? [
      { action: 'open',    title: '📡 Open Roger' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click handler ────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      // Otherwise open new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Install + activate ────────────────────────────────────────────────────
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));
