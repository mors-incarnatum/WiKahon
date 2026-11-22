const CACHE_NAME = "wikahon-shell-v5";

const CORE_ROUTES = [
    "/board",
    "/board/needs",
    "/board/actions",
    "/board/people",
    "/board/feelings",
    "/login",
];

const STATIC_SYMBOLS = [
    "/symbols/kain.svg",
    "/symbols/inom.svg",
    "/symbols/tubig.svg",
    "/symbols/banyo.svg",
    "/symbols/tulong.svg",
    "/symbols/oo.svg",
    "/symbols/hindi.svg",
    "/symbols/sandali.svg",
    "/symbols/pakisuyo.svg",
    "/symbols/tapos-na.svg",
    "/symbols/nanay.svg",
    "/symbols/tatay.svg",
    "/symbols/ate.svg",
    "/symbols/kuya.svg",
    "/symbols/guro.svg",
    "/symbols/masaya.svg",
    "/symbols/malungkot.svg",
    "/symbols/galit.svg",
    "/symbols/masakit.svg",
    "/symbols/pagod.svg",
    "/symbols/tigil.svg",
    "/symbols/ayoko.svg",
    "/symbols/gusto-ko-pa.svg",
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            await cache.addAll([...CORE_ROUTES, ...STATIC_SYMBOLS]);
            const assets = new Set();
            for (const route of CORE_ROUTES) {
                const response = await cache.match(route);
                const html = await response.text();
                for (const match of html.matchAll(/(?:src|href)=["']([^"']*\/_next\/static\/[^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)) {
                    assets.add(match[1].replace(/&amp;/g, "&"));
                }
            }
            if (!assets.size) throw new Error("No startup assets found in cached routes");
            await cache.addAll([...assets]);
        }),
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches
            .keys()
            .then(keys =>
                Promise.all(
                    keys
                        .filter(key => key.startsWith("wikahon-shell-") && key !== CACHE_NAME)
                        .map(key => caches.delete(key)),
                ),
            ),
    );
});

self.addEventListener("fetch", event => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname === "/forgot-password" || /^\/reset-password(?:\/|$)/.test(url.pathname)) return;

    if (req.mode === "navigate") {
        event.respondWith(
            fetch(req)
                .then(res => {
                    if (res.ok) {
                        const copy = res.clone();
                        void caches.open(CACHE_NAME).then(c => c.put(req, copy));
                    }
                    return res;
                })
                .catch(async () => {
                    const cached = await caches.match(req);
                    if (cached) return cached;
                    if (/^\/(?:login|register)(?:\/|$)/.test(url.pathname)) {
                        const loginShell = await caches.match("/login");
                        if (loginShell) return loginShell;
                    }
                    // Fallback to /board shell so custom offline folders and app routes resolve via client store.
                    const boardShell = await caches.match("/board");
                    return boardShell || new Response("Offline", { status: 503 });
                }),
        );
        return;
    }

    if (
        url.pathname.startsWith("/_next/static/") ||
        url.pathname.startsWith("/symbols/") ||
        url.pathname.startsWith("/gifs/")
    ) {
        event.respondWith(
            caches.match(req).then(cached => {
                if (cached) return cached;
                return fetch(req)
                    .then(res => {
                        if (res.ok) {
                            const copy = res.clone();
                            void caches.open(CACHE_NAME).then(c => c.put(req, copy));
                        }
                        return res;
                    })
                    .catch(() => new Response("", { status: 503, statusText: "Offline" }));
            }),
        );
    }
});
