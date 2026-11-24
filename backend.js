/* ParcelTrack (เวอร์ชันเว็บล้วน) — แทนที่โปรแกรมฝั่งคอม (ASP.NET) ด้วยโค้ดที่รันในเบราว์เซอร์
 *
 * - ข้อมูลเก็บใน IndexedDB ของเบราว์เซอร์ (แต่ละเครื่อง/เบราว์เซอร์มีข้อมูลของตัวเอง)
 * - อ่านภาพด้วย Tesseract.js (OCR ในเบราว์เซอร์ ใช้ไฟล์ภาษาไทยใน tessdata/)
 * - ดัก fetch("/api/...") และ fetch("/uploads/...") ของ app.js แล้วตอบจากในเครื่อง
 *   app.js จึงแทบไม่ต้องแก้ ทำงานเหมือนตอนต่อกับโปรแกรมบนคอม
 */
(() => {
  "use strict";

  const VERSION = "web-1.16.0";
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

  // ---------- IndexedDB ----------
  let db;
  const orders = new Map();       // id -> order
  const withdrawals = new Map();  // id -> withdrawal
  const imageUrls = new Map();    // ชื่อไฟล์ -> blob: URL (ใช้กับ <img src>)

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("parceltrack", 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore("orders", { keyPath: "id" });
        d.createObjectStore("withdrawals", { keyPath: "id" });
        d.createObjectStore("images");
        d.createObjectStore("meta");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("บันทึกข้อมูลในเบราว์เซอร์ไม่สำเร็จ (พื้นที่เต็ม?)"));
    });
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  async function loadAll() {
    const [os, ws] = await Promise.all([
      tx("orders", "readonly", (s) => reqP(s.getAll())),
      tx("withdrawals", "readonly", (s) => reqP(s.getAll())),
    ]);
    os.forEach((o) => orders.set(o.id, o));
    ws.forEach((w) => withdrawals.set(w.id, w));
    await new Promise((resolve, reject) => {
      const t = db.transaction("images", "readonly");
      const cur = t.objectStore("images").openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        imageUrls.set(c.key, URL.createObjectURL(c.value));
        c.continue();
      };
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  }

  const putOrder = (o) => tx("orders", "readwrite", (s) => s.put(o)).then(() => orders.set(o.id, o));
  const delOrder = (id) => tx("orders", "readwrite", (s) => s.delete(id)).then(() => orders.delete(id));
  const putWithdrawal = (w) => tx("withdrawals", "readwrite", (s) => s.put(w)).then(() => withdrawals.set(w.id, w));
  const delWithdrawal = (id) => tx("withdrawals", "readwrite", (s) => s.delete(id)).then(() => withdrawals.delete(id));
  const getMeta = (k) => tx("meta", "readonly", (s) => reqP(s.get(k)));
  const setMeta = (k, v) => tx("meta", "readwrite", (s) => s.put(v, k));
  const getImage = (name) => tx("images", "readonly", (s) => reqP(s.get(name)));
  async function putImage(name, blob) {
    await tx("images", "readwrite", (s) => s.put(blob, name));
    if (imageUrls.has(name)) URL.revokeObjectURL(imageUrls.get(name));
    imageUrls.set(name, URL.createObjectURL(blob));
  }
  async function deleteImage(name) {
    await tx("images", "readwrite", (s) => s.delete(name));
    if (imageUrls.has(name)) { URL.revokeObjectURL(imageUrls.get(name)); imageUrls.delete(name); }
  }

  const ready = (async () => {
    db = await openDb();
    await loadAll();
    try { await navigator.storage?.persist?.(); } catch { /* ไม่เป็นไร */ }
  })();

  // ---------- เลข ID No. (PT-ปปดดวว-ลำดับ เริ่มใหม่ทุกวัน) ----------
  const imageName = (id) => id + ".jpg";
  let idLock = Promise.resolve();
  function nextControlNo() {
    const run = idLock.then(async () => {
      const today = fmt(new Date(), "yyMMdd");
      const c = (await getMeta("control-counter")) || { date: today, seq: 0 };
      let seq = c.date === today ? c.seq : 0;
      let id;
      do { seq++; id = `PT-${today}-${pad(seq, 4)}`; } while (imageUrls.has(imageName(id)));
      await setMeta("control-counter", { date: today, seq });
      return id;
    });
    idLock = run.catch(() => {});
    return run;
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

  /** อ่านภาพ 1 ครั้ง ได้ข้อความ + บรรทัดพร้อมตำแหน่ง */
  function ocrRead(blob, psm = 3, lang = null, whitelist = null) {
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
    await putOrder(copy);
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
    const stat = { orders: 0, withdrawals: 0, images: 0, skipped: 0 };
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
      for (const raw of os) { const o = cleanImportedOrder(raw); if (o) { await putOrder(o); stat.orders++; } }
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
    let usage = null, quota = null, persisted = null;
    try { const e = await navigator.storage?.estimate?.(); usage = e?.usage ?? null; quota = e?.quota ?? null; } catch { /* */ }
    try { persisted = await navigator.storage?.persisted?.(); } catch { /* */ }
    return { orders: orders.size, withdrawals: withdrawals.size, images: imageUrls.size, usage, quota, persisted };
  }

  // รูปที่ไม่มีในเครื่องนี้ แสดงเป็นกรอบว่างแทนรูปเสีย
  const MISSING = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="100%" height="100%" fill="#ECE9E3"/><text x="50%" y="50%" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#5B6169">ไม่มีรูปในเครื่องนี้</text></svg>');

  window.PTBackend = {
    ready, version: VERSION,
    imgUrl: (name) => imageUrls.get(name) || MISSING,
    exportBackup, importFiles, storageInfo,
  };
})();
