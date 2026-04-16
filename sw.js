/**
 * ZIPCASTELLANO SERVICE WORKER
 * Versión: 7.1 (Scanner v6 optimización de velocidad de cámara)
 * Permite uso offline y mejora la velocidad de carga.
 */

const CACHE_NAME = 'zipcastellano-v7.1';
const CACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './js/app.js',
  './js/scanner.js',
  './js/printer.js',
  './icon-192.png',
  './icon-512.png',
  // CDN libraries (se cachean la primera vez que se usan)
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap'
];

// Instalación: pre-cachear archivos esenciales
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_URLS.filter(u => !u.startsWith('https://cdn'))))
      .then(() => self.skipWaiting())
  );
});

// Activación: limpiar caches viejos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: estrategia "Network First, Cache Fallback"
self.addEventListener('fetch', event => {
  // No interceptar llamadas a Google Apps Script (sync en tiempo real)
  if (event.request.url.includes('script.google.com') ||
      event.request.url.includes('api.qrserver.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Guardar copia en cache si la respuesta es válida
        if (response && response.status === 200 && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
