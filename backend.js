/* ParcelTrack (เวอร์ชันเว็บ) — แทนที่โปรแกรมฝั่งคอม (ASP.NET) ด้วยโค้ดที่รันในเบราว์เซอร์
 *
 * - ข้อมูลเก็บใน Supabase (ตาราง pt_orders / pt_withdrawals / pt_meta + bucket "parceltrack")
 *   ไม่ต้องล็อกอิน: เปิด "ลิงก์เชื่อมเครื่อง" ครั้งเดียวต่อเครื่อง ใช้ข้อมูลชุดเดียวกันทุกเครื่อง
 *   คนที่ไม่มีลิงก์เชื่อมเครื่องอ่าน/แก้ข้อมูลไม่ได้ (Row Level Security เฉพาะบัญชีเจ้าของ)
 * - อ่านภาพด้วย Tesseract.js (OCR ในเบราว์เซอร์ ใช้ไฟล์ภาษาไทยใน tessdata/)
 * - ดัก fetch("/api/...") และ fetch("/uploads/...") ของ app.js แล้วตอบจากในเครื่อง
 *   app.js จึงแทบไม่ต้องแก้ ทำงานเหมือนตอนต่อกับโปรแกรมบนคอม
 */
(() => {
  "use strict";

  const VERSION = "web-1.18.0";
  const P = window.PTParser;
  const CONTROL_RX = /^PT-\d{6}-\d{4}$/;
  const ALLOWED_EXT = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"];

  // ---------- ตัวช่วยวันที่ (เก็บแบบเวลาท้องถิ่น ไม่มีโซนเวลา เหมือนโปรแกรมเดิม) ----------
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const isoOf = (d) => `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const nowIso = () => isoOf(new Date());
  function toDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    const s = String(v).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    const d = new Date(s);     // มีโซนเวลา (เช่น +07:00 จากไฟล์ของโปรแกรมเดิม) แปลงเป็นเวลาท้องถิ่น
    return isNaN(d) ? null : d;
  }
  const normIso = (v) => { const d = toDate(v); return d ? isoOf(d) : null; };
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const fmt = (d, f) => f
    .replace("yyyy", pad(d.getFullYear(), 4)).replace("yy", pad(d.getFullYear() % 100))
    .replace("MM", pad(d.getMonth() + 1)).replace("dd", pad(d.getDate()))
    .replace("HH", pad(d.getHours())).replace("mm", pad(d.getMinutes()));
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const sum = (arr, f) => round2(arr.reduce((a, x) => a + (Number(f(x)) || 0), 0));
  const trimOrNull = (s) => (s == null || !String(s).trim() ? null : String(s).trim());
  const newId = () => (crypto.randomUUID ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

  // ---------- Supabase (ฐานข้อมูล + ที่เก็บรูป + ล็อกอิน) ----------
  const cfg = window.PT_CONFIG || {};
  if (!window.supabase || !cfg.supabaseUrl) throw new Error("โหลด Supabase ไม่สำเร็จ ตรวจ config.js");
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const BUCKET = cfg.bucket || "parceltrack";
  let uid = null, userEmail = null;

  const orders = new Map();       // id -> order
  const withdrawals = new Map();  // id -> withdrawal
  const imageUrls = new Map();    // ชื่อไฟล์ -> URL ที่ใช้กับ <img src> (signed URL หรือ blob:)
  const localBlobs = new Map();   // รูปที่เพิ่งอัปโหลดจากเครื่องนี้ (ไม่ต้องดาวน์โหลดซ้ำ)

  // ข้อผิดพลาดจากเน็ตหลุด (ใช้ตัดสินว่าจะเก็บงานไว้ส่งทีหลังหรือไม่)
  const isNetMsg = (m) => /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|ERR_INTERNET|ERR_NETWORK/i.test(String(m || ""));
  function check({ data, error }) {
    if (error) {
      const e = new Error("ติดต่อฐานข้อมูลไม่สำเร็จ: " + (error.message || error));
      e.net = !navigator.onLine || isNetMsg(error.message) || isNetMsg(error.name) || error.status === 0;
      throw e;
    }
    return data;
  }
  const netErr = (e) => !!(e && (e.net || !navigator.onLine || isNetMsg(e.message) || e.name === "TypeError"));

  // ---------- ที่เก็บในเครื่อง (IndexedDB): สำเนาข้อมูลล่าสุด + คิวงานตอนออฟไลน์ ----------
  const local = (() => {
    let dbp;
    const open = () => dbp ||= new Promise((res, rej) => {
      const r = indexedDB.open("parceltrack-cache", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction("kv", mode), q = fn(t.objectStore("kv"));
        t.oncomplete = () => res(q?.result);
        t.onerror = () => rej(t.error);
      });
    };
    return {
      get: (k) => run("readonly", (s) => s.get(k)).catch(() => undefined),
      set: (k, v) => run("readwrite", (s) => s.put(v, k)).catch(() => {}),
    };
  })();

  const versions = new Map();     // id -> updated_at ล่าสุดที่เครื่องนี้รู้ (ใช้ตรวจการแก้ชนกันข้ามเครื่อง)
  let offline = false;            // โหลดจากสำเนาในเครื่อง เพราะติดต่อ Supabase ไม่ได้
  let outbox = [];                // งานที่รอส่งขึ้น Supabase

  async function selectAll(table) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const rows = check(await sb.from(table).select("id, data, updated_at").order("id").range(from, from + 999));
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  }

  const SIGN_TTL = 60 * 60 * 24 * 7;   // ลิงก์รูปอายุ 7 วัน
  let signedAt = 0;
  async function loadImages() {
    const names = [];
    for (let offset = 0; ; offset += 1000) {
      const items = check(await sb.storage.from(BUCKET).list(uid, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } }));
      names.push(...items.filter((i) => i.id && !i.name.startsWith(".")).map((i) => i.name));
      if (items.length < 1000) break;
    }
    // ลิงก์ใกล้หมดอายุ (เกิน 5 วัน) ขอใหม่ทั้งหมด รูปจะได้ไม่หายถ้าเปิดค้างไว้นาน
    const renew = Date.now() - signedAt > 5 * 86400000;
    const keep = new Set(names);
    for (const [n, u] of [...imageUrls]) {
      if (u.startsWith("blob:")) { if (!keep.has(n) && !localBlobs.has(n)) imageUrls.delete(n); continue; }
      if (!keep.has(n) || renew) imageUrls.delete(n);
    }
    const missing = names.filter((n) => !imageUrls.has(n));
    for (let i = 0; i < missing.length; i += 200) {
      const chunk = missing.slice(i, i + 200);
      const signed = check(await sb.storage.from(BUCKET).createSignedUrls(chunk.map((n) => `${uid}/${n}`), SIGN_TTL));
      signed.forEach((s, j) => { if (s.signedUrl) imageUrls.set(chunk[j], s.signedUrl); });
    }
    if (renew || missing.length) signedAt = Date.now();
  }

  const snapKey = () => "snapshot:" + uid;
  const saveSnapshot = () => local.set(snapKey(), {
    at: Date.now(), orders: [...orders.values()], withdrawals: [...withdrawals.values()], versions: [...versions],
  });

  let lastLoad = 0;
  async function loadAll() {
    try {
      const [os, ws] = await Promise.all([selectAll("pt_orders"), selectAll("pt_withdrawals")]);
      orders.clear(); withdrawals.clear(); versions.clear();
      os.forEach((r) => { orders.set(r.id, r.data); versions.set(r.id, r.updated_at); });
      ws.forEach((r) => { withdrawals.set(r.id, r.data); versions.set(r.id, r.updated_at); });
      // งานที่ยังค้างในคิว ทับข้อมูลที่โหลดมา (เครื่องนี้แก้ไว้ล่าสุด)
      for (const job of outbox) applyLocal(job);
      await loadImages();
      offline = false;
      lastLoad = Date.now();
      saveSnapshot();
    } catch (e) {
      if (!netErr(e)) throw e;
      const snap = await local.get(snapKey());
      if (!snap) throw new Error("ไม่มีอินเทอร์เน็ต และเครื่องนี้ยังไม่เคยโหลดข้อมูลไว้");
      orders.clear(); withdrawals.clear(); versions.clear();
      snap.orders.forEach((o) => orders.set(o.id, o));
      snap.withdrawals.forEach((w) => withdrawals.set(w.id, w));
      (snap.versions || []).forEach(([k, v]) => versions.set(k, v));
      for (const job of outbox) applyLocal(job);
      offline = true;
      notice("ออฟไลน์: ใช้ข้อมูลที่โหลดไว้ล่าสุด งานใหม่จะถูกส่งขึ้นเมื่อมีอินเทอร์เน็ต");
    }
  }

  // ---------- เขียนข้อมูล: ส่งขึ้น Supabase ทันที ถ้าเน็ตหลุดเก็บเข้าคิวไว้ส่งทีหลัง ----------
  const stampNow = () => new Date().toISOString();
  const TABLE = { order: "pt_orders", withdrawal: "pt_withdrawals" };

  function applyLocal(job) {
    const map = job.kind === "withdrawal" ? withdrawals : orders;
    if (job.op === "put") map.set(job.row.id, job.row);
    if (job.op === "del") map.delete(job.id);
  }

  async function remotePut(kind, row, checkVersion) {
    const table = TABLE[kind], at = stampNow(), known = versions.get(row.id);
    if (checkVersion && known) {
      // แก้รายการเดิม: เขียนได้เฉพาะเมื่อไม่มีเครื่องอื่นแก้ไปก่อน
      const rows = check(await sb.from(table).update({ data: row, updated_at: at }).eq("id", row.id).eq("updated_at", known).select("updated_at"));
      if (rows.length) { versions.set(row.id, rows[0].updated_at); return; }
      const latest = check(await sb.from(table).select("data, updated_at").eq("id", row.id).limit(1))[0];
      if (latest) {
        (kind === "withdrawal" ? withdrawals : orders).set(row.id, latest.data);
        versions.set(row.id, latest.updated_at);
        saveSnapshot();
        const e = new Error("รายการนี้ถูกแก้จากอีกเครื่องก่อนหน้านี้ เปิดรายการใหม่อีกครั้งเพื่อดูข้อมูลล่าสุด แล้วแก้ซ้ำ");
        e.conflict = true;
        throw e;
      }
    }
    const rows = check(await sb.from(table).upsert({ id: row.id, data: row, updated_at: at }).select("updated_at"));
    if (rows[0]) versions.set(row.id, rows[0].updated_at);
  }
  async function remoteDel(kind, id) {
    check(await sb.from(TABLE[kind]).delete().eq("id", id));
    versions.delete(id);
  }

  async function queue(job) {
    outbox.push(job);
    await local.set("outbox:" + uid, outbox);
    notice(`ออฟไลน์: บันทึกไว้ในเครื่องแล้ว (${outbox.length} งานรอส่ง) จะส่งขึ้นเมื่อมีอินเทอร์เน็ต`);
  }

  async function write(job, checkVersion) {
    if (!outbox.length) {
      try {
        if (job.op === "put") await remotePut(job.kind, job.row, checkVersion);
        else await remoteDel(job.kind, job.id);
        applyLocal(job); saveSnapshot();
        return;
      } catch (e) { if (!netErr(e)) throw e; }
    }
    await queue(job);          // มีงานค้างอยู่แล้ว หรือเน็ตหลุด: ต่อคิวไว้ตามลำดับ
    applyLocal(job); saveSnapshot();
  }

  const putOrder = (o, opts = {}) => write({ op: "put", kind: "order", row: o }, opts.checkVersion);
  const delOrder = (id) => write({ op: "del", kind: "order", id });
  const putWithdrawal = (w) => write({ op: "put", kind: "withdrawal", row: w });
  const delWithdrawal = (id) => write({ op: "del", kind: "withdrawal", id });

  async function getMeta(k) {
    const rows = check(await sb.from("pt_meta").select("value").eq("key", k).limit(1));
    return rows[0]?.value ?? null;
  }
  async function setMeta(k, v) {
    check(await sb.from("pt_meta").upsert({ key: k, value: v }, { onConflict: "user_id,key" }));
  }
  async function getImage(name) {
    if (localBlobs.has(name)) return localBlobs.get(name);
    const { data, error } = await sb.storage.from(BUCKET).download(`${uid}/${name}`);
    return error ? null : data;
  }
  const imgType = (blob) => (/^image\/(jpeg|png|webp)$/.test(blob.type) ? blob.type : "image/jpeg");
  function setLocalImage(name, blob) {
    const old = imageUrls.get(name);
    if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
    localBlobs.set(name, blob);
    imageUrls.set(name, URL.createObjectURL(blob));
  }
  async function putImage(name, blob) {
    const job = { op: "img", name, blob };
    if (!outbox.length) {
      try {
        check(await sb.storage.from(BUCKET).upload(`${uid}/${name}`, blob, { upsert: true, contentType: imgType(blob), cacheControl: "60" }));
        setLocalImage(name, blob);
        return;
      } catch (e) { if (!netErr(e)) throw e; }
    }
    await queue(job);
    setLocalImage(name, blob);
  }
  async function deleteImage(name) {
    if (!outbox.length) {
      try { check(await sb.storage.from(BUCKET).remove([`${uid}/${name}`])); }
      catch (e) { if (!netErr(e)) throw e; await queue({ op: "imgdel", name }); }
    } else await queue({ op: "imgdel", name });
    const old = imageUrls.get(name);
    if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
    imageUrls.delete(name); localBlobs.delete(name);
  }

  // ส่งงานในคิวขึ้น Supabase ตามลำดับ (เครื่องนี้แก้ล่าสุด = ใช้ของเครื่องนี้)
  let flushing = false;
  async function flush() {
    if (flushing || !outbox.length || !uid) return;
    flushing = true;
    try {
      while (outbox.length) {
        const job = outbox[0];
        if (job.op === "put") await remotePut(job.kind, job.row, false);
        else if (job.op === "del") await remoteDel(job.kind, job.id);
        else if (job.op === "img") check(await sb.storage.from(BUCKET).upload(`${uid}/${job.name}`, job.blob, { upsert: true, contentType: imgType(job.blob), cacheControl: "60" }));
        else if (job.op === "imgdel") check(await sb.storage.from(BUCKET).remove([`${uid}/${job.name}`]));
        outbox.shift();
        await local.set("outbox:" + uid, outbox);
      }
      if (offline) { offline = false; await loadAll(); }
      saveSnapshot();
      notice("ส่งงานที่ค้างขึ้น Supabase ครบแล้ว", false);
    } catch (e) {
      if (!netErr(e)) {
        // งานที่ส่งไม่ได้ด้วยเหตุอื่น (ไม่ใช่เน็ต) ข้ามไป ไม่ให้ค้างคิวตลอดไป
        console.error("flush", e);
        outbox.shift(); await local.set("outbox:" + uid, outbox);
        notice("ส่งงานที่ค้างบางรายการไม่สำเร็จ: " + e.message);
        flushing = false; return flush();
      }
    } finally { flushing = false; }
  }
  window.addEventListener("online", () => flush());
  setInterval(() => { if (outbox.length && navigator.onLine) flush(); }, 60000);

  function notice(msg, isError = true) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg; t.className = "toast show" + (isError ? " error" : "");
    clearTimeout(notice.timer);
    notice.timer = setTimeout(() => (t.className = "toast"), 4500);
  }

  // ---------- เชื่อมเครื่อง (ไม่ต้องล็อกอิน/ไม่ต้องใส่ PIN) ----------
  // เปิด "ลิงก์เชื่อมเครื่อง" (…/#pair=xxxx) ครั้งเดียวต่อเครื่อง เครื่องจะจำไว้ตลอด
  // เครื่องที่เชื่อมแล้วแสดง QR ของลิงก์นี้ในเมนู "มือถือ & สำรองข้อมูล" ให้มือถือส่องเพื่อเชื่อมต่อ
  const PAIR_KEY = "pt-pair";
  const pairFromHash = (() => {
    const m = location.hash.match(/^#pair=([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    history.replaceState(null, "", location.pathname + location.search + "#/");
    return m[1];
  })();
  const decodePair = (code) => {
    try {
      const txt = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
      const i = txt.indexOf("\n");
      return i > 0 ? { email: txt.slice(0, i), password: txt.slice(i + 1) } : null;
    } catch { return null; }
  };
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };

  async function signInWithPair(code) {
    const c = code && decodePair(code);
    if (!c) return null;
    const { data, error } = await sb.auth.signInWithPassword(c);
    if (error) return null;
    lsSet(PAIR_KEY, code);
    return data.user;
  }

  function notPairedScreen(msg) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;inset:0;z-index:9999;background:var(--ground,#F3F1EC);display:grid;place-items:center;padding:20px";
    wrap.innerHTML = `<div style="width:min(420px,100%);background:#fff;border:1px solid var(--line,#E3E0D9);border-radius:18px;padding:26px;line-height:1.6">
      <h1 style="margin:0 0 8px;font-size:24px">ParcelTrack</h1>
      <p style="margin:0;color:var(--muted,#5B6169)">${msg || "เครื่องนี้ยังไม่ได้เชื่อมต่อ"}<br>
      เปิด <b>ลิงก์เชื่อมเครื่อง</b> ที่ได้รับไว้ หรือบนเครื่องที่ใช้อยู่แล้ว ไปที่เมนู <b>มือถือ &amp; สำรองข้อมูล</b>
      แล้วใช้มือถือส่อง QR "เชื่อมเครื่องนี้"</p></div>`;
    document.body.appendChild(wrap);
    return new Promise(() => {});   // รอจนกว่าจะเปิดด้วยลิงก์เชื่อมเครื่อง
  }

  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" && uid) location.reload();
  });

  const ready = (async () => {
    let user = pairFromHash ? await signInWithPair(pairFromHash) : null;
    if (!user) { const { data: { session } } = await sb.auth.getSession(); user = session?.user || null; }
    if (!user) user = await signInWithPair(lsGet(PAIR_KEY));
    if (!user) user = await notPairedScreen(pairFromHash ? "ลิงก์เชื่อมเครื่องไม่ถูกต้อง หรือเชื่อมต่อไม่ได้" : null);
    uid = user.id; userEmail = user.email;
    outbox = (await local.get("outbox:" + uid)) || [];
    await loadAll();
    if (outbox.length && navigator.onLine) flush();
    setTimeout(backupReminder, 4000);
  })();

  // กลับมาที่หน้าเว็บ (เช่น สลับแอปบนมือถือ) ดึงข้อมูลล่าสุดจากอีกเครื่อง แล้ววาดหน้ารายการใหม่
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || !uid || Date.now() - lastLoad < 20000) return;
    try {
      await ready; await flush(); await loadAll();
      if (/^#?\/?(orders|report)?$/.test(location.hash)) window.dispatchEvent(new HashChangeEvent("hashchange"));
    } catch { /* ออฟไลน์ชั่วคราว */ }
  });

  // ---------- เลข ID No. (PT-ปปดดวว-ลำดับ เริ่มใหม่ทุกวัน ออกเลขที่ฐานข้อมูล ไม่ชนกันข้ามเครื่อง) ----------
  const imageName = (id) => id + ".jpg";
  async function nextControlNo() {
    const today = fmt(new Date(), "yyMMdd");
    const used = (id) => imageUrls.has(imageName(id)) || allOrders().some((o) => o.controlNo === id);
    for (let i = 0; i < 50; i++) {
      let seq;
      try { seq = check(await sb.rpc("pt_next_seq", { p_day: today })); }
      catch (e) {
        if (!netErr(e)) throw e;
        // ออฟไลน์: ใช้เลขชุด 9xxx ของเครื่องนี้ ไม่ชนกับเลขที่ออกจากฐานข้อมูล
        let n = 9001; while (used(`PT-${today}-${n}`)) n++;
        return `PT-${today}-${n}`;
      }
      const id = `PT-${today}-${pad(seq, 4)}`;
      if (!used(id)) return id;
    }
    throw new Error("ออกเลข ID No. ไม่สำเร็จ");
  }

  // ---------- OCR ด้วย Tesseract.js ----------
  const base = new URL(".", document.currentScript?.src || location.href).href;
  const workers = {};
  let ocrLock = Promise.resolve();

  function getWorker(lang) {
    if (!workers[lang]) {
      if (!window.Tesseract) throw new Error("โหลดตัวอ่านภาพ (Tesseract.js) ไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วรีเฟรชหน้า");
      workers[lang] = Tesseract.createWorker(lang, 1, {
        workerPath: base + "vendor/tesseract/worker.min.js",
        corePath: base + "vendor/tesseract/",
        langPath: base + "tessdata",
        gzip: false,
        cacheMethod: "write",
      }).catch((e) => { delete workers[lang]; throw new Error("เปิดตัวอ่านภาพไม่สำเร็จ: " + (e?.message || e)); });
    }
    return workers[lang];
  }

  // ---------- Google Vision (ผ่าน Supabase Edge Function "pt-ocr") ----------
  const ENGINE_KEY = "pt-ocr-engine";
  const ocrEngine = () => (lsGet(ENGINE_KEY) === "vision" ? "vision" : "local");
  const setOcrEngine = (v) => lsSet(ENGINE_KEY, v === "vision" ? "vision" : "local");
  const visionMemo = new WeakMap();   // ภาพเดิมอ่านครั้งเดียว (ไม่เสียค่าใช้จ่ายซ้ำ)
  const blobToB64 = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  function visionRead(blob) {
    if (!visionMemo.has(blob)) {
      visionMemo.set(blob, (async () => {
        const { data, error } = await sb.functions.invoke("pt-ocr", { body: { image: await blobToB64(blob) } });
        if (error) {
          let msg = error.message;
          try { msg = (await error.context.json()).error || msg; } catch { /* */ }
          throw new Error(msg === "not-configured" ? "ยังไม่ได้ตั้ง GOOGLE_VISION_API_KEY ใน Supabase" : msg);
        }
        return { text: data.text || "", lines: data.lines || [], width: data.width || 0, height: data.height || 0 };
      })().catch((e) => { visionMemo.delete(blob); throw e; }));
    }
    return visionMemo.get(blob);
  }

  /** อ่านภาพ 1 ครั้ง ได้ข้อความ + บรรทัดพร้อมตำแหน่ง (ใช้ Google Vision ถ้าเลือกไว้ ถ้าใช้ไม่ได้กลับมาอ่านในเครื่อง) */
  async function ocrRead(blob, psm = 3, lang = null, whitelist = null) {
    if (ocrEngine() === "vision") {
      try { return await visionRead(blob); }
      catch (e) { notice("Google Vision ใช้ไม่ได้ (" + e.message + ") อ่านในเครื่องแทน"); }
    }
    return tesseractRead(blob, psm, lang, whitelist);
  }

  function tesseractRead(blob, psm = 3, lang = null, whitelist = null) {
    const run = ocrLock.then(async () => {
      const w = await getWorker(lang || "tha+eng");
      await w.setParameters({
        tessedit_pageseg_mode: String(psm),
        preserve_interword_spaces: "1",
        tessedit_char_whitelist: whitelist || "",
      });
      const { data } = await w.recognize(blob, {}, { text: true, tsv: true });
      const t = P.parseTsv(data.tsv);
      return { text: data.text || "", lines: t.lines, width: t.width, height: t.height };
    });
    ocrLock = run.catch(() => {});
    return run;
  }

  // ---------- ตัวช่วยตอบกลับ ----------
  class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  const bad = (msg) => { throw new HttpError(400, msg); };
  const notFound = () => { throw new HttpError(404, "ไม่พบข้อมูล"); };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
  const file = (blob, name, type) => new Response(blob, {
    status: 200, headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"`, "X-Filename": encodeURIComponent(name) },
  });

  const allOrders = () => [...orders.values()];
  const orderDate = (o) => toDate(o.orderedAt) || toDate(o.createdAt) || new Date(0);
  function parseRange(from, to) {
    const f = toDate(from), t = toDate(to);
    return [f ? dayStart(f) : null, t ? dayStart(t) : null];
  }
  const inRange = (d, f, t) => { if (!d) return false; const x = dayStart(d); return (!f || x >= f) && (!t || x <= t); };

  function filterOrders(list, status, q, from, to) {
    const [f, t] = parseRange(from, to);
    if (f || t) list = list.filter((o) => inRange(orderDate(o), f, t));
    const st = ["pending", "received"].includes(String(status || "").toLowerCase())
      ? (String(status).toLowerCase() === "pending" ? "Pending" : "Received") : null;
    if (st) list = list.filter((o) => o.status === st);
    if (q && q.trim()) {
      const k = q.trim().toLowerCase();
      const has = (v) => (v ?? "").toString().toLowerCase().includes(k);
      list = list.filter((o) => has(o.controlNo) || has(o.productName) || has(o.orderNumber) || has(o.trackingNumber)
        || has(o.shopName) || has(o.recipientName) || has(o.shippingAddress));
    }
    const rank = (o) => (o.status === "Received" ? 1 : 0);
    return [...list].sort((a, b) => rank(a) - rank(b) || (toDate(b.createdAt) - toDate(a.createdAt)));
  }

  function findExisting(all, tracking, orderNo, refNo) {
    const same = (a, b) => !!(a && b && String(a).trim() && String(b).trim()
      && String(a).split(" ").join("").toUpperCase() === String(b).split(" ").join("").toUpperCase());
    return all.find((o) => same(o.trackingNumber, tracking) || same(o.orderNumber, orderNo) || same(o.referenceNumber, refNo)) || null;
  }

  const normalizeTracking = (s) => (s == null ? null : s.toUpperCase().split(" ").join("").split("O").join("0"));

  function findDuplicate(all, r, selfId) {
    const tr = trimOrNull(r.trackingNumber) ? normalizeTracking(String(r.trackingNumber).trim()) : null;
    const on = trimOrNull(r.orderNumber)?.toUpperCase();
    for (const o of all.filter((x) => x.id !== selfId)) {
      if (!selfId && r.controlNo && o.controlNo === r.controlNo) return `ID No. ${o.controlNo} ถูกบันทึกไว้แล้ว (${o.productName})`;
      if (tr && (o.trackingNumber || "").toUpperCase() === tr) return `เลขพัสดุ ${o.trackingNumber} ถูกบันทึกไว้แล้ว (${o.productName})`;
      if (on && (o.orderNumber || "").toUpperCase() === on) return `หมายเลขคำสั่งซื้อ ${o.orderNumber} ถูกบันทึกไว้แล้ว (${o.productName})`;
    }
    return null;
  }

  function newOrder() {
    return {
      id: newId(), controlNo: null, productName: "", variant: null, shopName: null, quantity: 1,
      orderNumber: null, referenceNumber: null, trackingNumber: null, carrier: null, recipientName: null,
      shippingAddress: null, totalAmount: null, paymentMethod: null, cardLast4: null, paymentConfirmed: false,
      orderedAt: null, createdAt: nowIso(), receivedAt: null, receivedScanCode: null, status: "Pending",
      screenshots: [], note: null,
    };
  }

  function apply(o, r) {
    if (o.controlNo == null && r.controlNo && CONTROL_RX.test(r.controlNo)) o.controlNo = r.controlNo;
    o.productName = String(r.productName).trim();
    o.variant = trimOrNull(r.variant);
    o.shopName = trimOrNull(r.shopName);
    const q = parseInt(r.quantity, 10);
    o.quantity = q > 0 ? q : 1;
    o.orderNumber = trimOrNull(r.orderNumber)?.toUpperCase() ?? null;
    o.referenceNumber = trimOrNull(r.referenceNumber)?.toUpperCase() ?? null;
    o.trackingNumber = normalizeTracking(trimOrNull(r.trackingNumber));
    o.carrier = trimOrNull(r.carrier);
    o.recipientName = trimOrNull(r.recipientName);
    o.shippingAddress = trimOrNull(r.shippingAddress);
    const amt = r.totalAmount === "" || r.totalAmount == null ? null : Number(String(r.totalAmount).split(",").join(""));
    o.totalAmount = amt == null || isNaN(amt) ? null : amt;
    o.paymentMethod = trimOrNull(r.paymentMethod);
    const digits = String(r.cardNumber ?? "").replace(/\D/g, "");
    o.cardLast4 = digits.length >= 4 ? digits.slice(-4) : null;   // เก็บแค่ 4 หลักท้าย
    o.paymentConfirmed = !!r.paymentConfirmed;
    o.orderedAt = normIso(r.orderedAt);
    o.note = trimOrNull(r.note);
    if (Array.isArray(r.screenshots))
      o.screenshots = r.screenshots.filter((s) => !/[\\/]|\.\./.test(s));
  }

  // ---------- ไฟล์ ZIP / Excel (สร้างในเบราว์เซอร์) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

  async function deflate(u8) {
    if (typeof CompressionStream === "undefined") return null;
    try {
      const s = new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(s).arrayBuffer());
    } catch { return null; }
  }

  /** entries: [{ name, data: Uint8Array|string|Blob }] */
  async function buildZip(entries) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const e of entries) {
      const raw = typeof e.data === "string" ? enc.encode(e.data)
        : e.data instanceof Blob ? new Uint8Array(await e.data.arrayBuffer()) : e.data;
      const name = enc.encode(e.name);
      const crc = crc32(raw);
      const isImage = /\.(jpe?g|png|webp|zip)$/i.test(e.name);
      const comp = isImage ? null : await deflate(raw);
      const method = comp && comp.length < raw.length ? 8 : 0;
      const body = method === 8 ? comp : raw;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, method, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, body);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, method, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, raw.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + body.length;
    }
    const cdSize = central.reduce((a, p) => a + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }

  const xmlEsc = (s) => String(s).replace(/[^\t\n\r -￿]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const colName = (i) => { let n = "", x = i + 1; while (x > 0) { const m = (x - 1) % 26; n = String.fromCharCode(65 + m) + n; x = Math.floor((x - 1) / 26); } return n; };
  const toOADate = (d) => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - Date.UTC(1899, 11, 30)) / 86400000;

  async function buildXlsxFile(sheetName, cols, rows) {
    let sb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>';
    cols.forEach((c, i) => { sb += `<col min="${i + 1}" max="${i + 1}" width="${c.w}" customWidth="1"/>`; });
    sb += '</cols><sheetData><row r="1" ht="22" customHeight="1">';
    cols.forEach((c, i) => { sb += `<c r="${colName(i)}1" t="inlineStr" s="1"><is><t>${xmlEsc(c.h)}</t></is></c>`; });
    sb += "</row>";
    let r = 1;
    for (const row of rows) {
      r++;
      sb += `<row r="${r}">`;
      cols.forEach((c, i) => {
        const v = row[i], addr = colName(i) + r;
        if (v == null || v === "") sb += `<c r="${addr}" s="0"/>`;
        else if (v instanceof Date) sb += `<c r="${addr}" s="3"><v>${toOADate(v)}</v></c>`;
        else if (typeof v === "number") sb += `<c r="${addr}" s="${c.k === "money" ? 2 : 4}"><v>${v}</v></c>`;
        else sb += `<c r="${addr}" t="inlineStr" s="0"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
      });
      sb += "</row>";
    }
    sb += `</sheetData><autoFilter ref="A1:${colName(cols.length - 1)}${Math.max(r, 1)}"/></worksheet>`;

    const files = [
      { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: "xl/_rels/workbook.xml.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { name: "xl/styles.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0E6B63"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FFE3E0D9"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
      { name: "xl/worksheets/sheet1.xml", data: sb },
    ];
    const zip = await buildZip(files);
    return new Blob([zip], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function buildOrdersXlsx(list) {
    const cols = [
      { h: "ID No.", w: 17 }, { h: "สถานะ", w: 12 }, { h: "สินค้า", w: 48 }, { h: "ตัวเลือก", w: 16 }, { h: "ร้านค้า", w: 20 },
      { h: "จำนวน", w: 8, k: "number" }, { h: "หมายเลขคำสั่งซื้อ", w: 20 }, { h: "เลขอ้างอิง", w: 28 },
      { h: "เลขพัสดุ", w: 18 }, { h: "ขนส่ง", w: 16 }, { h: "ชื่อผู้รับ", w: 24 }, { h: "ที่อยู่จัดส่ง", w: 46 },
      { h: "ยอดสุทธิ (บาท)", w: 15, k: "money" }, { h: "วิธีชำระ", w: 18 }, { h: "บัตร 4 หลักท้าย", w: 14 },
      { h: "วันที่สั่งซื้อ", w: 18 }, { h: "วันที่บันทึก", w: 18 }, { h: "วันที่รับของ", w: 18 }, { h: "หมายเหตุ", w: 30 },
    ];
    const rows = list.map((o) => [
      o.controlNo, o.status === "Received" ? "ได้รับแล้ว" : "รอของมาส่ง", o.productName, o.variant, o.shopName,
      o.quantity, o.orderNumber, o.referenceNumber, o.trackingNumber, o.carrier, o.recipientName, o.shippingAddress,
      o.totalAmount, o.paymentMethod, o.cardLast4 ? "xxxx " + o.cardLast4 : null,
      toDate(o.orderedAt), toDate(o.createdAt), toDate(o.receivedAt), o.note,
    ]);
    return buildXlsxFile("คำสั่งซื้อ", cols, rows);
  }

  const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const stamp = () => fmt(new Date(), "yyyyMMdd-HHmm");
  function pick(body) {
    const ids = new Set(Array.isArray(body?.ids) ? body.ids : []);
    return allOrders().filter((o) => ids.has(o.id));
  }

  // ---------- เส้นทาง API ----------
  const routes = [];
  const on = (method, pattern, fn) => routes.push({ method, rx: new RegExp("^" + pattern + "$"), fn });
  const GUID = "([0-9a-fA-F-]{36})";
  const fileExt = (f) => { const m = (f.name || "").match(/\.[^.]+$/); return m ? m[0].toLowerCase() : ({ "image/png": ".png", "image/webp": ".webp" }[f.type] || ".jpg"); };

  on("GET", "/version", () => json({ version: VERSION, features: ["report", "cards", "export-range", "zoom-scan", "web"], httpsPort: null, httpPort: null }));

  on("POST", "/ocr", async ({ form }) => {
    if (!form) bad("ส่งภาพแบบ multipart/form-data");
    const files = form.getAll("files").filter((f) => f instanceof Blob);
    if (!files.length) bad("ยังไม่ได้เลือกภาพ");
    if (files.length > 6) bad("ส่งได้ครั้งละไม่เกิน 6 ภาพ");
    const drafts = [];
    for (const f of files) {
      const ext = fileExt(f);
      if (!ALLOWED_EXT.includes(ext)) bad(`ไม่รองรับไฟล์ ${ext} (ใช้ PNG หรือ JPG)`);
      if (f.size > 15 * 1024 * 1024) bad("ภาพใหญ่เกิน 15 MB");
      // อ่านรอบแรกแบบอัตโนมัติ (psm 3) ถ้าได้ข้อมูลน้อย อ่านซ้ำแบบคอลัมน์เดียว (psm 4) แล้วรวมผล
      let first = P.parseOcr(await ocrRead(f, 3));
      if (first.foundFields.length < 3) {
        const second = P.parseOcr(await ocrRead(f, 4));
        first = second.foundFields.length > first.foundFields.length ? P.merge([second, first]) : P.merge([first, second]);
      }
      drafts.push(first);
    }
    const result = P.merge(drafts);
    result.imageCount = files.length;
    const sessionNo = String(form.get("controlNo") || "");
    const all = allOrders();
    const dup = findExisting(all, result.trackingNumber, result.orderNumber, result.referenceNumber);
    const sessionFree = CONTROL_RX.test(sessionNo) && !all.some((o) => o.controlNo === sessionNo);
    if (dup) {
      if (sessionFree) await deleteImage(imageName(sessionNo)).catch(() => {});
      result.duplicate = { id: dup.id, controlNo: dup.controlNo, productName: dup.productName, status: dup.status, trackingNumber: dup.trackingNumber, orderNumber: dup.orderNumber };
      return json(result);
    }
    result.controlNo = sessionFree ? sessionNo : await nextControlNo();
    return json(result);
  });

  on("POST", "/ocr/read", async ({ form }) => {
    if (!form) bad("ส่งภาพแบบ multipart/form-data");
    const files = form.getAll("files").filter((f) => f instanceof Blob);
    if (!files.length) bad("ยังไม่ได้เลือกภาพ");
    if (files.length > 6) bad("ส่งได้ครั้งละไม่เกิน 6 ภาพ");
    const drafts = [];
    for (const f of files)
      for (const psm of [3, 4, 6]) {
        try { drafts.push(P.parseOcr(await ocrRead(f, psm))); } catch { /* ข้ามโหมดที่ล้มเหลว */ }
      }
    if (!drafts.length) throw new HttpError(500, "อ่านภาพไม่สำเร็จ");
    drafts.sort((a, b) => b.foundFields.length - a.foundFields.length);
    return json(P.merge(drafts));
  });

  on("POST", "/ocr/crop", async ({ form }) => {
    if (!form) bad("ส่งภาพแบบ multipart/form-data");
    const f = form.get("crop");
    if (!(f instanceof Blob)) bad("ไม่มีภาพในกรอบที่เลือก");
    const codeMode = form.get("mode") === "code";
    const results = [];
    for (const psm of [6, 7]) {
      try {
        const r = await ocrRead(f, psm, codeMode ? "eng" : null,
          codeMode ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/.,: " : null);
        let text = r.lines.map((l) => l.text).join(" ").trim();
        if (!text) text = r.text.split("\n").join(" ").trim();
        if (text) results.push(P.normalize(text).trim());
      } catch { /* ข้ามโหมดนี้ */ }
    }
    if (!results.length) return json({ text: "", options: [] });
    const best = [...results].sort((a, b) => b.length - a.length)[0];
    return json({ text: best, options: [...new Set(results)] });
  });

  on("POST", "/ocr/image", async ({ form }) => {
    const controlNo = String(form?.get("controlNo") || "");
    const combined = form?.get("combined");
    if (!CONTROL_RX.test(controlNo) || !(combined instanceof Blob)) bad("ข้อมูลรูปรวมไม่ครบ");
    if (combined.size > 25 * 1024 * 1024) bad("รูปรวมใหญ่เกิน 25 MB");
    if (allOrders().some((o) => o.controlNo === controlNo)) throw new HttpError(409, `ID No. ${controlNo} บันทึกไปแล้ว แก้รูปไม่ได้`);
    await putImage(imageName(controlNo), combined);
    return json({ file: imageName(controlNo) });
  });

  on("GET", "/orders", ({ query }) => json(filterOrders(allOrders(), query.get("status"), query.get("q"))));
  on("GET", `/orders/${GUID}`, ({ m }) => (orders.has(m[1]) ? json(orders.get(m[1])) : notFound()));

  on("GET", "/stats", () => {
    const all = allOrders(), pend = all.filter((o) => o.status === "Pending");
    return json({ pending: pend.length, received: all.length - pend.length, total: all.length, pendingAmount: sum(pend, (o) => o.totalAmount) });
  });

  on("POST", "/orders", async ({ body }) => {
    if (!body?.productName || !String(body.productName).trim()) bad("กรุณาใส่ชื่อสินค้า");
    const dup = findDuplicate(allOrders(), body, null);
    if (dup) throw new HttpError(409, dup);
    const o = newOrder();
    apply(o, body);
    await putOrder(o);
    return json(o, 201);
  });

  on("PUT", `/orders/${GUID}`, async ({ m, body }) => {
    const o = orders.get(m[1]);
    if (!o) notFound();
    if (!body?.productName || !String(body.productName).trim()) bad("กรุณาใส่ชื่อสินค้า");
    const dup = findDuplicate(allOrders(), body, o.id);
    if (dup) throw new HttpError(409, dup);
    const copy = { ...o };
    apply(copy, body);
    try { await putOrder(copy, { checkVersion: true }); }
    catch (e) { if (e.conflict) throw new HttpError(409, e.message); throw e; }
    return json(copy);
  });

  async function removeOrder(id) {
    const o = orders.get(id);
    if (!o) return false;
    await delOrder(id);
    if (o.controlNo) await deleteImage(imageName(o.controlNo)).catch(() => {});
    return true;
  }
  on("DELETE", `/orders/${GUID}`, async ({ m }) => ((await removeOrder(m[1])) ? new Response(null, { status: 204 }) : notFound()));
  on("POST", "/orders/bulk-delete", async ({ body }) => {
    const ids = [...new Set(Array.isArray(body?.ids) ? body.ids : [])];
    if (!ids.length) bad("ยังไม่ได้เลือกรายการที่จะลบ");
    let deleted = 0;
    for (const id of ids) if (await removeOrder(id)) deleted++;
    return json({ deleted });
  });

  on("GET", "/lan-urls", () => json({ urls: [location.href.split("#")[0]], secureUrls: [] }));

  on("POST", "/scan", ({ body }) => {
    const code = body?.code;
    if (!code || !String(code).trim()) bad("ไม่มีค่าที่ยิงได้");
    const match = P.findMatch(allOrders(), code);
    if (!match) return json({ code, match: null, alreadyReceived: false, message: "ไม่พบคำสั่งซื้อที่ตรงกับเลขนี้" });
    const already = match.status === "Received";
    const at = toDate(match.receivedAt);
    return json({ code, match, alreadyReceived: already, message: already ? `รายการนี้รับของไปแล้วเมื่อ ${at ? fmt(at, "dd/MM/yyyy HH:mm") : ""}` : "พบคำสั่งซื้อที่ตรงกัน" });
  });

  on("POST", `/orders/${GUID}/receive`, async ({ m, body }) => {
    const o = orders.get(m[1]);
    if (!o) notFound();
    if (o.status === "Received") return json(o);
    const copy = { ...o, status: "Received", receivedAt: nowIso(), receivedScanCode: body?.code ?? null };
    await putOrder(copy);
    return json(copy);
  });

  on("POST", `/orders/${GUID}/scan-image`, async ({ m, form }) => {
    const o = orders.get(m[1]);
    if (!o) notFound();
    if (!o.controlNo) bad("รายการนี้ไม่มี ID No. จึงไม่มีไฟล์รูปให้รวม");
    const combined = form?.get("combined");
    if (!(combined instanceof Blob)) bad("ไม่มีรูป");
    if (combined.size > 25 * 1024 * 1024) bad("รูปใหญ่เกิน 25 MB");
    await putImage(imageName(o.controlNo), combined);
    await putOrder({ ...o, screenshots: [imageName(o.controlNo)] });
    return json({ file: imageName(o.controlNo) });
  });

  on("POST", `/orders/${GUID}/undo-receive`, async ({ m }) => {
    const o = orders.get(m[1]);
    if (!o) notFound();
    const copy = { ...o, status: "Pending", receivedAt: null, receivedScanCode: null };
    await putOrder(copy);
    return json(copy);
  });

  const sortedWithdrawals = () => [...withdrawals.values()].sort((a, b) => (toDate(b.date) - toDate(a.date)) || (toDate(b.createdAt) - toDate(a.createdAt)));

  on("GET", "/withdrawals", ({ query }) => {
    const [f, t] = parseRange(query.get("from"), query.get("to"));
    return json(sortedWithdrawals().filter((w) => inRange(toDate(w.date), f, t)));
  });
  on("POST", "/withdrawals", async ({ body }) => {
    const amount = Number(body?.amount);
    if (!(amount > 0)) bad("ใส่จำนวนเงินมากกว่า 0");
    const d = toDate(body?.date) || new Date();
    const w = { id: newId(), amount, date: isoOf(dayStart(d)), note: trimOrNull(body?.note), createdAt: nowIso() };
    await putWithdrawal(w);
    return json(w, 201);
  });
  on("DELETE", `/withdrawals/${GUID}`, async ({ m }) => {
    if (!withdrawals.has(m[1])) notFound();
    await delWithdrawal(m[1]);
    return new Response(null, { status: 204 });
  });

  on("GET", "/report", ({ query }) => {
    const all = allOrders(), ws = sortedWithdrawals();
    const n = Math.min(36, Math.max(1, parseInt(query.get("months"), 10) || 12));
    const [f, t] = parseRange(query.get("from"), query.get("to"));
    const now = new Date();
    const monthly = [];
    for (let i = 0; i < n; i++) {
      const m = new Date(now.getFullYear(), now.getMonth() - (n - 1) + i, 1);
      const inMonth = all.filter((o) => { const d = orderDate(o); return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth(); });
      monthly.push({ key: fmt(m, "yyyy-MM"), year: m.getFullYear(), month: m.getMonth() + 1, total: sum(inMonth, (o) => o.totalAmount), count: inMonth.length });
    }
    const inR = all.filter((o) => inRange(orderDate(o), f, t));
    const wsInRange = ws.filter((w) => inRange(toDate(w.date), f, t));
    const withdrawnInRange = sum(wsInRange, (w) => w.amount);
    const receivedInRange = sum(all.filter((o) => o.status === "Received" && o.receivedAt && inRange(toDate(o.receivedAt), f, t)), (o) => o.totalAmount);
    const withdrawnAll = sum(ws, (w) => w.amount);
    const receivedAll = sum(all.filter((o) => o.status === "Received"), (o) => o.totalAmount);
    const pend = all.filter((o) => o.status === "Pending");

    const groups = new Map();
    for (const o of inR) {
      const k = o.cardLast4 && o.cardLast4.trim() ? o.cardLast4 : "ไม่ระบุบัตร";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }
    const cards = [...groups.entries()].map(([k, g]) => ({
      last4: k, label: k === "ไม่ระบุบัตร" ? "ไม่ระบุบัตร" : "•••• " + k,
      method: g.map((o) => o.paymentMethod).find((x) => x && x.trim()) ?? null,
      total: sum(g, (o) => o.totalAmount), count: g.length,
      received: sum(g.filter((o) => o.status === "Received"), (o) => o.totalAmount),
    })).sort((a, b) => b.total - a.total);

    const thisMonth = monthly[monthly.length - 1].total;
    const prevMonth = monthly.length > 1 ? monthly[monthly.length - 2].total : 0;
    const rangeTotal = sum(inR, (o) => o.totalAmount);
    return json({
      monthly, cards,
      range: { from: f ? fmt(f, "yyyy-MM-dd") : null, to: t ? fmt(t, "yyyy-MM-dd") : null },
      finance: {
        withdrawn: withdrawnInRange, spent: receivedInRange, balance: round2(withdrawnInRange - receivedInRange),
        withdrawnAll, spentAll: receivedAll, balanceAll: round2(withdrawnAll - receivedAll),
        pendingAmount: sum(pend, (o) => o.totalAmount), withdrawals: wsInRange.slice(0, 50),
      },
      summary: {
        thisMonth, prevMonth, diff: round2(thisMonth - prevMonth), rangeTotal, rangeCount: inR.length,
        rangeAvg: inR.length ? round2(rangeTotal / inR.length) : 0,
        pending: pend.length, pendingAmount: sum(pend, (o) => o.totalAmount),
      },
    });
  });

  on("GET", "/export.xlsx", async ({ query }) => {
    const list = filterOrders(allOrders(), query.get("status"), query.get("q"), query.get("from"), query.get("to"));
    return file(await buildOrdersXlsx(list), `ParcelTrack-${stamp()}.xlsx`, XLSX_TYPE);
  });

  on("POST", "/share/selected.xlsx", async ({ body }) => {
    const picked = pick(body);
    if (!picked.length) bad("ยังไม่ได้เลือกรายการ");
    return file(await buildOrdersXlsx(picked), `ParcelTrack-${picked.length}-orders-${stamp()}.xlsx`, XLSX_TYPE);
  });

  on("POST", "/share/bundle.zip", async ({ body }) => {
    const picked = pick(body);
    if (!picked.length) bad("ยังไม่ได้เลือกรายการ");
    const entries = [{ name: `ParcelTrack-${stamp()}.xlsx`, data: await buildOrdersXlsx(picked) }];
    for (const o of picked)
      for (const shot of o.screenshots || []) {
        const blob = await getImage(shot);
        if (blob) entries.push({ name: "images/" + shot, data: blob });
      }
    return file(await buildZip(entries), `ParcelTrack-${picked.length}-orders-${stamp()}.zip`, "application/zip");
  });

  on("GET", "/export.csv", () => {
    const C = (v) => '"' + String(v ?? "").split('"').join('""') + '"';
    const fd = (v) => { const d = toDate(v); return d ? fmt(d, "yyyy-MM-dd HH:mm") : null; };
    const lines = ["สถานะ,สินค้า,ตัวเลือก,ร้านค้า,จำนวน,หมายเลขคำสั่งซื้อ,เลขอ้างอิง,เลขพัสดุ,ขนส่ง,ยอดสุทธิ,วิธีชำระ,บัตร 4 หลักท้าย,วันที่สั่งซื้อ,วันที่รับของ"];
    for (const o of [...allOrders()].sort((a, b) => toDate(b.createdAt) - toDate(a.createdAt)))
      lines.push([o.status === "Received" ? "ได้รับแล้ว" : "รอของมาส่ง", o.productName, o.variant, o.shopName, o.quantity,
        o.orderNumber, o.referenceNumber, o.trackingNumber, o.carrier, o.totalAmount != null ? Number(o.totalAmount).toFixed(2) : null,
        o.paymentMethod, o.cardLast4 ? "xxxx" + o.cardLast4 : null, fd(o.orderedAt), fd(o.receivedAt)].map(C).join(","));
    return file(new Blob(["﻿" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" }), `parceltrack-${fmt(new Date(), "yyyyMMdd")}.csv`, "text/csv; charset=utf-8");
  });

  // ---------- ดัก fetch ของ app.js ----------
  const origFetch = window.fetch.bind(window);

  async function handle(path, init) {
    await ready;
    const u = new URL(path, "http://local");
    const method = (init.method || "GET").toUpperCase();
    if (u.pathname.startsWith("/uploads/")) {
      const blob = await getImage(decodeURIComponent(u.pathname.slice(9)));
      return blob ? new Response(blob, { headers: { "Content-Type": blob.type || "image/jpeg" } }) : new Response("", { status: 404 });
    }
    const sub = u.pathname.slice(4);   // ตัด /api
    let form = null, body = null;
    if (init.body instanceof FormData) form = init.body;
    else if (typeof init.body === "string" && init.body) { try { body = JSON.parse(init.body); } catch { body = null; } }
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = sub.match(r.rx);
      if (!m) continue;
      try {
        return await r.fn({ m, query: u.searchParams, form, body });
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status);
        console.error(e);
        return json({ error: e?.message || String(e) }, 500);
      }
    }
    return json({ error: "ไม่พบคำสั่งนี้" }, 404);
  }

  function localPath(input) {
    const s = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    if (!s) return null;
    if (s.startsWith("/api/") || s === "/api" || s.startsWith("/uploads/")) return s;
    return null;
  }

  window.fetch = (input, init = {}) => {
    const p = localPath(input);
    return p ? handle(p, init) : origFetch(input, init);
  };

  // ลิงก์ดาวน์โหลด เช่น <a href="/api/export.xlsx" download> ให้สร้างไฟล์ในเครื่องแทน
  async function downloadFrom(path) {
    const res = await handle(path, {});
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "สร้างไฟล์ไม่สำเร็จ"); }
    const name = decodeURIComponent(res.headers.get("X-Filename") || "ParcelTrack");
    saveBlob(await res.blob(), name);
  }
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || !(href.startsWith("/api/") || href.startsWith("/uploads/"))) return;
    e.preventDefault();
    downloadFrom(href).catch((err) => alertToast(err.message));
  }, true);

  function alertToast(msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg; t.className = "toast show error";
    setTimeout(() => (t.className = "toast"), 3500);
  }

  // ---------- สำรอง / นำเข้าข้อมูล ----------
  const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  const dataUrlToBlob = async (u) => (await origFetch(u)).blob();

  async function exportBackup() {
    await ready;
    const images = {};
    for (const name of imageUrls.keys()) {
      const b = await getImage(name);
      if (b) images[name] = await blobToDataUrl(b);
    }
    const data = { app: "ParcelTrack", format: 1, version: VERSION, exportedAt: nowIso(),
      orders: allOrders(), withdrawals: sortedWithdrawals(), counter: (await getMeta("control-counter")) || null, images };
    saveBlob(new Blob([JSON.stringify(data)], { type: "application/json" }), `ParcelTrack-backup-${stamp()}.json`);
    lsSet("pt-last-backup", String(Date.now()));
    return { orders: data.orders.length, images: Object.keys(images).length };
  }

  // ไฟล์ของโปรแกรมเดิมใช้ชื่อช่องขึ้นต้นตัวใหญ่ (ProductName) แปลงเป็น productName
  const camel = (obj) => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k[0].toLowerCase() + k.slice(1)] = v;
    return out;
  };
  function cleanImportedOrder(raw) {
    const o = { ...newOrder(), ...camel(raw) };
    if (!o.id || !o.productName) return null;
    o.id = String(o.id).toLowerCase();
    o.status = String(o.status).toLowerCase() === "received" || o.status === 1 ? "Received" : "Pending";
    for (const k of ["orderedAt", "createdAt", "receivedAt"]) o[k] = normIso(o[k]);
    o.createdAt ||= nowIso();
    o.screenshots = Array.isArray(o.screenshots) ? o.screenshots : [];
    return o;
  }
  function cleanImportedWithdrawal(raw) {
    const w = camel(raw);
    if (!w?.id || !(Number(w.amount) > 0)) return null;
    return { id: String(w.id).toLowerCase(), amount: Number(w.amount), date: normIso(w.date) || nowIso(), note: trimOrNull(w.note), createdAt: normIso(w.createdAt) || nowIso() };
  }

  /** นำเข้าได้ทั้งไฟล์สำรองของเวอร์ชันเว็บ และไฟล์ของโปรแกรมเดิม (orders.json, withdrawals.json, รูป .jpg ใน data\uploads) */
  async function importFiles(fileList) {
    await ready;
    const stat = { orders: 0, withdrawals: 0, images: 0, skipped: 0, duplicates: 0 };
    for (const f of fileList) {
      const name = f.name || "";
      if (/\.(jpe?g|png|webp)$/i.test(name) || (f.type || "").startsWith("image/")) {
        await putImage(name, f); stat.images++; continue;
      }
      let data;
      try { data = JSON.parse(await f.text()); } catch { stat.skipped++; continue; }
      let os = [], ws = [], imgs = {};
      if (Array.isArray(data)) {
        const first = camel(data[0] || {});
        if ("productName" in first || "trackingNumber" in first) os = data;
        else if ("amount" in first) ws = data;
        else { stat.skipped++; continue; }
      } else if (data && typeof data === "object" && (data.orders || data.withdrawals)) {
        os = data.orders || []; ws = data.withdrawals || []; imgs = data.images || {};
        if (data.counter) {
          const cur = await getMeta("control-counter");
          if (!cur || data.counter.date > cur.date || (data.counter.date === cur.date && data.counter.seq > cur.seq)) await setMeta("control-counter", data.counter);
        }
      } else if (data && "date" in data && "seq" in data) {
        await setMeta("control-counter", camel(data)); continue;
      } else { stat.skipped++; continue; }
      for (const raw of os) {
        const o = cleanImportedOrder(raw);
        if (!o) continue;
        // มีอยู่แล้ว (เลขพัสดุ / เลขคำสั่งซื้อ / เลขอ้างอิง ตรงกับรายการอื่น) ไม่นำเข้าซ้ำ
        const dup = findExisting(allOrders().filter((x) => x.id !== o.id), o.trackingNumber, o.orderNumber, o.referenceNumber);
        if (dup) { stat.duplicates++; continue; }
        await putOrder(o); stat.orders++;
      }
      for (const raw of ws) { const w = cleanImportedWithdrawal(raw); if (w) { await putWithdrawal(w); stat.withdrawals++; } }
      for (const [n, u] of Object.entries(imgs)) {
        if (/[\\/]|\.\./.test(n)) continue;
        await putImage(n, await dataUrlToBlob(u)); stat.images++;
      }
    }
    return stat;
  }

  async function storageInfo() {
    await ready;
    return { email: userEmail, orders: orders.size, withdrawals: withdrawals.size, images: imageUrls.size,
      pending: outbox.length, offline, lastBackup: Number(lsGet("pt-last-backup")) || null };
  }
  async function signOut() {
    uid = null;
    try { localStorage.removeItem(PAIR_KEY); } catch { /* */ }
    await sb.auth.signOut();
    location.reload();
  }
  // ลิงก์สำหรับเชื่อมเครื่องอื่น (มีเฉพาะบนเครื่องที่เชื่อมแล้ว)
  const pairLink = () => { const c = lsGet(PAIR_KEY); return c ? location.href.split("#")[0] + "#pair=" + c : null; };

  // รูปที่ไม่มีในเครื่องนี้ แสดงเป็นกรอบว่างแทนรูปเสีย
  const MISSING = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="100%" height="100%" fill="#ECE9E3"/><text x="50%" y="50%" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#5B6169">ไม่มีรูปในเครื่องนี้</text></svg>');

  // เตือนให้ดาวน์โหลดไฟล์สำรอง (รวมรูป) ถ้าไม่ได้สำรองเกิน 14 วัน วันละครั้ง
  function backupReminder() {
    if (!orders.size) return;
    const last = Number(lsGet("pt-last-backup")) || 0, nagged = Number(lsGet("pt-backup-nag")) || 0;
    if (Date.now() - last < 14 * 86400000 || Date.now() - nagged < 86400000) return;
    lsSet("pt-backup-nag", String(Date.now()));
    notice(last ? "ไม่ได้ดาวน์โหลดไฟล์สำรองมาเกิน 14 วัน ไปที่เมนู มือถือ & สำรองข้อมูล" : "ยังไม่เคยดาวน์โหลดไฟล์สำรอง ไปที่เมนู มือถือ & สำรองข้อมูล", false);
  }

  window.PTBackend = {
    ready, version: VERSION,
    imgUrl: (name) => imageUrls.get(name) || MISSING,
    exportBackup, importFiles, storageInfo, signOut, pairLink, flush, ocrEngine, setOcrEngine, reload: async () => { await ready; await flush(); await loadAll(); },
  };
})();
