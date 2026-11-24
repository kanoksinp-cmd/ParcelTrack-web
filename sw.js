/* ไฟล์นี้มีไว้ยกเลิกโหมดออฟไลน์ (service worker) ที่เครื่องเคยติดตั้งจากเวอร์ชัน 1.18.0
 * เครื่องที่ยังติดตั้งอยู่จะโหลดไฟล์นี้ แล้วลบแคช + ถอนตัวเอง จากนั้นแอปจะโหลดจากเว็บตามปกติ */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: "window" })) c.navigate(c.url);
  })());
});
