// ===== CRM LGC - Service Worker =====
// PWA : cache des assets, stratégies cache-first / network-first, support hors-ligne

const CACHE_NAME = 'crm-lgc-v1';

// Assets statiques à mettre en cache à l'installation
const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './css/styles.css',
    './js/error-tracker.js',
    './js/data-version.js',
    './js/auth.js',
    './js/graph.js',
    './js/deals.js',
    './js/clients.js',
    './js/pipeline.js',
    './js/alerts.js',
    './js/email-scanner.js',
    './js/contracts.js',
    './js/payments.js',
    './js/shopify.js',
    './js/team.js',
    './js/reports.js',
    './js/plan-reader.js',
    './js/notifications.js',
    './js/calendar.js',
    './js/installations.js',
    './js/sav.js',
    './js/directory.js',
    './js/chatbot.js',
    './js/contacts.js',
    './js/activities.js',
    './js/automations.js',
    './js/import-export.js',
    './js/custom-fields.js',
    './js/mecinov-sync.js',
    './js/soumission-scanner.js',
    './js/app.js',
    './assets/logo.png',
    './assets/logo-white.png',
    './assets/logo.svg',
    './assets/favicon.png',
];

// Patterns pour identifier les appels API (network-first)
const API_PATTERNS = [
    'graph.microsoft.com',
    'shopify',
    'login.microsoftonline.com',
];

// Patterns pour identifier les assets statiques (cache-first)
const STATIC_PATTERNS = [
    '/css/',
    '/js/',
    '/assets/',
    '.css',
    '.js',
    '.png',
    '.svg',
    '.jpg',
    '.jpeg',
    '.ico',
    '.woff',
    '.woff2',
];

// ===== INSTALLATION : pré-cache des assets =====
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => console.log('[SW] Assets mis en cache'))
    );
    self.skipWaiting();
});

// ===== ACTIVATION : nettoyage des anciens caches =====
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k.startsWith('crm-lgc-') && k !== CACHE_NAME)
                    .map(k => {
                        console.log('[SW] Suppression ancien cache:', k);
                        return caches.delete(k);
                    })
            )
        )
    );
    self.clients.claim();
});

// ===== FETCH : stratégies de cache =====
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Ignorer les requêtes non-GET
    if (event.request.method !== 'GET') return;

    // Vérifier si c'est un appel API → network-first
    const isAPI = API_PATTERNS.some(pattern => url.includes(pattern));
    if (isAPI) {
        event.respondWith(networkFirst(event.request));
        return;
    }

    // Vérifier si c'est un asset statique → cache-first
    const isStatic = STATIC_PATTERNS.some(pattern => url.includes(pattern));
    if (isStatic) {
        event.respondWith(cacheFirst(event.request));
        return;
    }

    // Par défaut → network-first avec fallback cache
    event.respondWith(networkFirst(event.request));
});

// ===== STRATÉGIE CACHE-FIRST =====
// Sert depuis le cache si disponible, sinon réseau (met en cache la réponse)
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        // Hors-ligne et pas en cache
        return new Response('Hors-ligne', { status: 503, statusText: 'Service Unavailable' });
    }
}

// ===== STRATÉGIE NETWORK-FIRST =====
// Essaie le réseau d'abord, fallback vers le cache si hors-ligne
async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;

        // Dernière chance : retourner la page d'accueil pour la navigation
        if (request.mode === 'navigate') {
            return caches.match('./index.html');
        }

        return new Response('Hors-ligne', { status: 503, statusText: 'Service Unavailable' });
    }
}
