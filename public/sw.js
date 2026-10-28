const CACHE_NAME = 'jelita-flower-pwa-v1'
const APP_SHELL = ['/', '/manifest.webmanifest', '/icons/pwa-192.png', '/icons/pwa-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('jelita-flower-pwa-') && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cachedShell = await caches.match('/')
        if (cachedShell) return cachedShell
        throw new Error('Aplikasi tidak tersedia saat offline.')
      }),
    )
    return
  }

  if (['script', 'style', 'font', 'image'].includes(request.destination) || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse
        return fetch(request).then(async (response) => {
          if (response.ok) {
            await caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()))
          }
          return response
        })
      }),
    )
  }
})

self.addEventListener('push', (event) => {
  if (!event.data) return
  const payload = event.data.json()
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Jelita Flower', {
      body: payload.body || 'Ada informasi baru di dashboard admin.',
      icon: '/icons/pwa-192.png',
      badge: '/icons/pwa-192.png',
      tag: payload.orderId ? `order-${payload.orderId}` : 'jelita-admin',
      data: { url: '/admin' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const adminClient = clients.find((client) => {
        const url = new URL(client.url)
        return url.origin === self.location.origin && url.pathname.startsWith('/admin')
      })
      if (adminClient) {
        await adminClient.focus()
        if ('navigate' in adminClient) await adminClient.navigate('/admin')
        return
      }
      await self.clients.openWindow('/admin')
    }),
  )
})
