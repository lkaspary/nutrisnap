const CACHE_NAME = 'caloriq-v5';
const STATIC_ASSETS = [
  '/',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only cache GET requests
  if (event.request.method !== 'GET') return;

  // Don't cache API calls or Supabase requests
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        // Cache successful responses for static assets
        if (response.ok && (event.request.url.includes('/icons/') || event.request.url.includes('/manifest'))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback
      if (event.request.mode === 'navigate') {
        return caches.match('/');
      }
    })
  );
});

// ── #46 — Daily logging reminder ──────────────────────────────────────────────
let reminderTimer = null;
let reminderConfig = null;

self.addEventListener('message', (event) => {
  const { type, time, title, body } = event.data || {};

  if (type === 'SCHEDULE_DAILY_REMINDER') {
    reminderConfig = { time, title, body };
    scheduleNextReminder();
  }

  if (type === 'CANCEL_REMINDER') {
    if (reminderTimer) clearTimeout(reminderTimer);
    reminderTimer = null;
    reminderConfig = null;
  }
});

function scheduleNextReminder() {
  if (!reminderConfig) return;
  if (reminderTimer) clearTimeout(reminderTimer);

  const [hours, minutes] = reminderConfig.time.split(':').map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(hours, minutes, 0, 0);

  // If the time has already passed today, schedule for tomorrow
  if (next <= now) next.setDate(next.getDate() + 1);

  const msUntil = next.getTime() - now.getTime();

  reminderTimer = setTimeout(() => {
    self.registration.showNotification(reminderConfig.title, {
      body: reminderConfig.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'daily-logging-reminder',
      renotify: true,
    });
    // Reschedule for the same time tomorrow
    scheduleNextReminder();
  }, msUntil);
}

// Open the app when the user taps the notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});