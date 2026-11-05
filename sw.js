/* Palco Pro — Service Worker
 * Cache local/offline do aplicativo.
 * Versão v3: atualize este número sempre que precisar renovar o cache.
 */

const CACHE_PREFIX = "palco-pro-";
const CACHE_NAME = `${CACHE_PREFIX}v3`;

const APP_SCOPE_URL = new URL(self.registration.scope);
const APP_ROOT_URL = new URL("./", APP_SCOPE_URL).toString();
const INDEX_URL = new URL("./index.html", APP_SCOPE_URL).toString();

const APP_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

function isInsideAppScope(url) {
  return (
    url.origin === APP_SCOPE_URL.origin &&
    url.pathname.startsWith(APP_SCOPE_URL.pathname)
  );
}

async function cacheCoreFiles() {
  const cache = await caches.open(CACHE_NAME);

  // Cada arquivo é armazenado separadamente. Se um ícone opcional estiver
  // ausente ou a rede falhar durante a instalação, o Service Worker ainda instala.
  await Promise.all(
    APP_FILES.map(async (file) => {
      const fileUrl = new URL(file, APP_SCOPE_URL).toString();

      try {
        const response = await fetch(fileUrl, { cache: "reload" });

        if (response.ok) {
          await cache.put(fileUrl, response.clone());
        } else {
          console.warn("Palco Pro: não foi possível armazenar", file, response.status);
        }
      } catch (error) {
        console.warn("Palco Pro: arquivo não armazenado no cache", file, error);
      }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    cacheCoreFiles().then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();

      // Remove somente caches antigos do Palco Pro, sem apagar caches
      // pertencentes a outros aplicativos hospedados no mesmo domínio.
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
          return Promise.resolve(false);
        })
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // O Service Worker não interfere em envios de formulários, POST ou outros
  // métodos usados pelas integrações do aplicativo.
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);

  // Não intercepta arquivos de outros domínios nem recursos fora da pasta
  // do Palco Pro. Assim, APIs externas e serviços de terceiros seguem normais.
  if (!isInsideAppScope(requestUrl)) return;

  // Não armazena respostas dinâmicas identificadas por query string.
  // Navegações com parâmetros continuam sendo tratadas mais abaixo.
  if (requestUrl.search && request.mode !== "navigate") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Para páginas, prioriza a versão publicada mais recente. Se estiver
      // sem internet, abre a cópia local do aplicativo.
      if (request.mode === "navigate") {
        try {
          const networkResponse = await fetch(request);

          if (networkResponse && networkResponse.ok) {
            await cache.put(INDEX_URL, networkResponse.clone());
          }

          return networkResponse;
        } catch (error) {
          const cachedPage =
            (await cache.match(request)) ||
            (await cache.match(INDEX_URL)) ||
            (await cache.match(APP_ROOT_URL));

          if (cachedPage) return cachedPage;

          return new Response(
            "O Palco Pro está sem conexão e ainda não possui uma cópia offline desta página.",
            {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" }
            }
          );
        }
      }

      // Para os demais arquivos locais, tenta a rede primeiro para não manter
      // recursos antigos após uma atualização. Usa o cache quando estiver offline.
      const cachedResponse = await cache.match(request);

      try {
        const networkResponse = await fetch(request);

        if (networkResponse && networkResponse.ok) {
          await cache.put(request, networkResponse.clone());
          return networkResponse;
        }

        return cachedResponse || networkResponse;
      } catch (error) {
        if (cachedResponse) return cachedResponse;

        return new Response("Recurso indisponível enquanto o aparelho está offline.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      }
    })()
  );
});
