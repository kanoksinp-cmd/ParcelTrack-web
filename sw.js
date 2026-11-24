/* ParcelTrack service worker: ให้เปิดแอปได้แม้ไม่มีอินเทอร์เน็ต และโหลดเร็วขึ้น
 * - ไฟล์หน้าเว็บ (html/js/css): ใช้ของใหม่จากเน็ตก่อน ถ้าเน็ตหลุดใช้ของที่เก็บไว้
 * - ไฟล์ใหญ่ที่ไม่ค่อยเปลี่ยน (vendor/, tessdata/, ไอคอน): ใช้ของที่เก็บไว้ก่อน
 * - ไม่แตะคำขอไปที่ Supabase / เว็บอื่น (ข้อมูลจริงจัดการใน backend.js)
 * แก้ไฟล์ในแอปแล้วให้เปลี่ยน VERSION ด้านล่าง เพื่อให้เครื่องที่ติดตั้งไว้ได้ของใหม่
 */
const VERSION = "pt-web-1.18.0";
const SHELL = [
  "./", "index.html", "app.css", "app.js", "backend.js", "parser.js", "config.js",
  "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png",
  "vendor/supabase.js", "vendor/html5-qrcode.min.js", "vendor/qrcode.js", "vendor/tesseract/tesseract.min.js",
];
const HEAVY = [
  "vendor/tesseract/worker.min.js", "vendor/tesseract/tesseract-core-simd-lstm.wasm.js",
  "vendor/tesseract/tesseract-core-lstm.wasm.js", "tessdata/tha.traineddata", "tessdata/eng.traineddata",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    // ไฟล์ตัวอ่านภาพ (~13 MB) โหลดเก็บไว้เบื้องหลัง ถ้าไม่สำเร็จก็ไม่เป็นไร จะเก็บตอนใช้ครั้งแรก
    Promise.all(HEAVY.map((u) => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const heavy = /\/(vendor|tessdata)\/|\.png$|\.svg$/.test(url.pathname);
  e.respondWith(heavy ? cacheFirst(req) : networkFirst(req));
});

async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
    return res;
  } catch {
    const hit = await caches.match(req, { ignoreSearch: true })
      || (req.mode === "navigate" ? await caches.match("index.html") : null);
    if (hit) return hit;
    throw new Error("offline");
  }
}
