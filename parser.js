/* ParcelTrack — แยกข้อความ OCR เป็นช่องข้อมูล + จับคู่ค่าที่ยิงได้กับคำสั่งซื้อ
 * พอร์ตมาจาก OrderTextParser.cs / ScanMatcher.cs / OcrService.ParseTsv ของโปรแกรมเดิม (ASP.NET)
 * ถ้าแอปร้านค้าไหนอ่านช่องไม่ได้ ให้เพิ่มคำค้นในไฟล์นี้
 */
(() => {
  "use strict";

  // ขอบคำแบบเดียวกับ .NET (ตัวอักษรไทยนับเป็นตัวอักษรของคำด้วย)
  const W = "[\\p{L}\\p{Mn}\\p{Nd}\\p{Pc}]";
  const B0 = `(?<!${W})`;   // \b หน้าคำ
  const B1 = `(?!${W})`;    // \b ท้ายคำ

  const KnownCarriers = [
    "Flash Express", "Kerry Express", "KEX Express", "J&T Express", "SPX Express", "Shopee Express",
    "Ninja Van", "Lazada Express", "Best Express", "DHL eCommerce", "DHL", "Nim Express",
    "SCG Express", "Thailand Post", "ไปรษณีย์ไทย", "EMS", "Inter Express", "Lalamove", "Grab Express",
  ];

  const ThaiMonths = [
    ["ม.ค.", 1], ["ก.พ.", 2], ["มี.ค.", 3], ["เม.ย.", 4], ["พ.ค.", 5], ["มิ.ย.", 6],
    ["ก.ค.", 7], ["ส.ค.", 8], ["ก.ย.", 9], ["ต.ค.", 10], ["พ.ย.", 11], ["ธ.ค.", 12],
  ];

  const AMOUNT_SRC = "(?<![\\d,.])[฿B8๒]?\\s?(?<n>\\d{1,3}(?:,\\d{3})+|\\d+)\\.(?<d>\\d{2})(?!\\d)";
  const amountTest = (s) => new RegExp(AMOUNT_SRC, "u").test(s);
  const amountAll = (s) => [...s.matchAll(new RegExp(AMOUNT_SRC, "gu"))];

  const QTY_SRC = "[xXхХ×✕%*]\\s?(\\d{1,3})(?!\\d)\\s*[|\\]\\)]?\\s*$";
  const QtyRx = new RegExp(QTY_SRC, "u");

  const ciIncludes = (hay, needle) => hay.toLowerCase().includes(needle.toLowerCase());
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const localIso = (y, mo, d, h = 0, mi = 0, s = 0) => `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`;

  function normalize(text) {
    let t = String(text ?? "").split("ํา").join("ำ").split("\r").join("");
    // คำผิดที่ OCR ชอบอ่านพลาดในหน้าคำสั่งซื้อ
    t = t.replace(/ส[ิั]?่?งซื้อ/gu, "สั่งซื้อ");
    t = t.split("หมายเลขหพัสดุ").join("หมายเลขพัสดุ");
    return t;
  }

  function emptyDraft(rawText = "") {
    return {
      controlNo: null, imageCount: 0, duplicate: null,
      productName: null, variant: null, shopName: null, quantity: null,
      orderNumber: null, referenceNumber: null, trackingNumber: null, carrier: null,
      recipientName: null, shippingAddress: null, totalAmount: null, paymentMethod: null,
      cardLast4: null, paymentConfirmed: false, orderedAt: null,
      screenshots: [], foundFields: [], rawText, rawLines: [],
    };
  }

  /** อ่านจากผล OCR ที่มีตำแหน่งบรรทัด: ใช้ตำแหน่งหาชื่อสินค้าที่อยู่ข้างรูปสินค้าได้แม่นขึ้น */
  function parseOcr(ocr) {
    const d = parseText(ocr.text);
    const seen = new Set();
    d.rawLines = [];
    for (const l of ocr.lines) {
      const t = normalize(l.text).trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      d.rawLines.push(t);
      if (d.rawLines.length >= 200) break;
    }
    const item = findItemBlock(ocr);
    if (item.title != null) {
      d.productName = item.title;
      if (item.variant != null) d.variant = item.variant;
      if (!d.foundFields.includes("productName")) d.foundFields.push("productName");
      if (item.variant != null && !d.foundFields.includes("variant")) d.foundFields.push("variant");
    }
    return d;
  }

  /** หา "กล่องสินค้า": รูปสินค้าอยู่ซ้าย ข้อความอยู่ขวา บรรทัดราคาที่ลงท้ายด้วย x1 = จุดอ้างอิง */
  function findItemBlock(ocr) {
    const lines = ocr.lines.map((l) => ({ ...l, text: normalize(l.text).trim() })).filter((l) => l.text.length > 0);
    if (!lines.length) return { title: null, variant: null };
    const width = ocr.width > 0 ? ocr.width : Math.max(...lines.map((l) => l.right));

    const anchor = lines.findIndex((l) => isItemPriceLine(l.text));
    if (anchor <= 0) return { title: null, variant: null };

    const indent = width * 0.2;
    const block = [];
    let below = lines[anchor];
    for (let i = anchor - 1; i >= 0; i--) {
      const l = lines[i];
      const h = l.bottom - l.top;
      if (l.left < indent) break;
      if (below.top - l.bottom > Math.max(h, 20) * 3) break;
      block.unshift(l);
      below = l;
    }
    if (!block.length) return { title: null, variant: null };

    let title = block[0].text;
    let variant = null;
    for (const l of block.slice(1)) {
      if (variant != null || amountTest(l.text)) continue;
      if (l.text.length <= 30) variant = l.text;
      else title += " " + l.text;
    }
    return { title: cleanProductName(title), variant };
  }

  function parseText(rawText) {
    const d = emptyDraft(rawText);
    const text = normalize(rawText);
    const lines = text.split("\n").map((l) => l.replace(/\s+/gu, " ").trim()).filter((l) => l.length > 0);
    let m;

    // ---------- เลขพัสดุ ----------
    m = text.match(/(?:พัสดุ|Tracking(?: No\.?| Number)?)\s*[:：]?\s*([A-Z0-9][A-Z0-9 ]{6,32}[A-Z0-9])/iu);
    if (m) d.trackingNumber = cleanTracking(m[1]);
    else {
      m = text.match(new RegExp(`${B0}(TH\\d{10,14}[A-Z]?|[A-Z]{2}\\d{9}TH|[A-Z]{3,6}[O0]?\\d{7,12})${B1}`, "u"));
      if (m) d.trackingNumber = cleanTracking(m[0]);
    }

    // ---------- ขนส่ง ----------
    for (const c of KnownCarriers) if (ciIncludes(text, c)) { d.carrier = c; break; }
    if (d.carrier == null) {
      m = text.match(/ส่งโดย\s*[:：]?\s*(.+)/u);
      if (m) d.carrier = m[1].trim();
    }

    // ---------- หมายเลขคำสั่งซื้อ / อ้างอิง ----------
    m = text.match(/(?:หมายเลขคำสั่งซื้อ|เลขที่คำสั่งซื้อ|Order (?:ID|No\.?|Number))\s*[:：#]?\s*([A-Z0-9][A-Z0-9 -]{6,}[A-Z0-9])/iu);
    if (m) d.orderNumber = cleanCode(m[1]);
    m = text.match(/อ้างอิง\s*[:：]?\s*([A-Z0-9][A-Z0-9 -]{4,}[A-Z0-9])/iu);
    if (m) d.referenceNumber = cleanCode(m[1]);

    // ---------- ยอดชำระ ----------
    const isTotalLabel = (l) =>
      /รวมยอด|ยอดรวม|ยอดชำระ|ยอดสุทธิ|รวมการสั่งซื้อ|ยอดที่ต้องชำระ|Order Total|Total Payment|Grand Total/iu.test(l)
      && !/ส่วนลด|ค่าจัดส่ง|คูปอง|พอยท์|แต้ม/u.test(l)
      && amountTest(l);
    const totalLine = [...lines].reverse().find(isTotalLabel);
    if (totalLine != null) {
      const amounts = amountAll(totalLine);
      if (amounts.length) d.totalAmount = toNumber(amounts[amounts.length - 1]);
    }

    // ---------- วันที่สั่งซื้อ ----------
    const dateLine = lines.find((l) => l.includes("วันที่สั่งซื้อ") || l.includes("เวลาสั่งซื้อ") || ciIncludes(l, "Order Time"));
    if (dateLine != null) d.orderedAt = parseDate(dateLine);

    // ---------- การชำระเงิน ----------
    if (text.includes("บัตรเครดิต")) d.paymentMethod = "บัตรเครดิต / เดบิต";
    else if (/พร้อมเพย์|PromptPay|QR พร้อมเพย์/iu.test(text)) d.paymentMethod = "พร้อมเพย์";
    else if (text.includes("โอนเงิน") || text.includes("Mobile Banking")) d.paymentMethod = "โอนผ่านธนาคาร";
    else if (text.includes("เก็บเงินปลายทาง") || new RegExp(`${B0}COD${B1}`, "u").test(text)) d.paymentMethod = "เก็บเงินปลายทาง";
    m = text.match(new RegExp(`(?:[*•●xX]{2,}[\\s-]*){1,3}(\\d{4})${B1}`, "u"));
    if (m) d.cardLast4 = m[1];
    d.paymentConfirmed = /ชำระเงินสำเร็จ|ชำระแล้ว|ชำระเงินแล้ว/u.test(text);

    // ---------- ผู้รับ + ที่อยู่ในการจัดส่ง ----------
    const addrIdx = lines.findIndex((l) => /ที่อยู่ในการจัดส่ง|ที่อยู่จัดส่ง|ที่อยู่ผู้รับ|ข้อมูลผู้รับ|Shipping Address|Delivery Address/iu.test(l));
    if (addrIdx >= 0) {
      const body = [];
      for (let i = addrIdx + 1; i < lines.length && body.length < 5; i++) {
        const l = lines[i];
        if (/รายละเอียด|ร้านค้า|จัดส่งแล้ว|ประเภทการจัดส่ง|หมายเลข|ข้อมูลการชำระ|วิธีการชำระ|สถานะ|ติดตามพัสดุ|ยกเลิก/u.test(l)) break;
        if (l.length < 2) continue;
        body.push(l);
        if (new RegExp(`${B0}\\d{5}${B1}`, "u").test(l)) break;
      }
      if (body.length) {
        const first = body[0];
        const looksLikeName = /\(\s?0\d[\d\s-]{7,}\)/u.test(first)
          || (first.length <= 45 && !/\d{5}|ซ\.|ถ\.|แขวง|เขต|ตำบล|อำเภอ|จังหวัด|บ้านเลขที่/u.test(first));
        if (looksLikeName) { d.recipientName = first; body.shift(); }
        if (body.length) d.shippingAddress = body.join(" ");
      }
    }

    // ---------- ร้านค้า ----------
    const officialIdx = lines.findIndex((l) => ciIncludes(l, "Official") || ciIncludes(l, "Mall"));
    if (officialIdx >= 0) {
      const startI = Math.max(0, officialIdx - 3), count = Math.min(3, officialIdx);
      const candidates = lines.slice(startI, startI + count).filter(isShopName);
      d.shopName = [...candidates].reverse().find((l) => /[ก-๏]/u.test(l)) ?? candidates[candidates.length - 1] ?? null;
    }

    // ---------- ชื่อสินค้า / ตัวเลือก / จำนวน ----------
    let start = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (l.includes("ส่งโดย") || (d.trackingNumber != null && l.includes(d.trackingNumber))
        || (d.carrier != null && ciIncludes(l, d.carrier))) { start = i; break; }
    }
    for (let i = start + 1; start >= 0 && i < lines.length; i++) {
      const l = lines[i];
      if (!isProductLine(l)) continue;
      if (d.carrier != null && ciIncludes(l, d.carrier)) continue;
      d.productName = cleanProductName(l);
      for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
        const v = lines[j];
        if (v.length >= 2 && v.length <= 30 && !/\d/u.test(v) && !isKeywordLine(v)) { d.variant = v; break; }
      }
      for (let j = i; j < Math.min(lines.length, i + 5); j++) {
        const qty = readQty(lines[j]);
        if (qty != null) { d.quantity = qty; break; }
      }
      break;
    }

    const found = (name, v) => { if (v != null) d.foundFields.push(name); };
    found("productName", d.productName); found("variant", d.variant); found("shopName", d.shopName);
    found("quantity", d.quantity); found("orderNumber", d.orderNumber); found("referenceNumber", d.referenceNumber);
    found("trackingNumber", d.trackingNumber); found("carrier", d.carrier); found("totalAmount", d.totalAmount);
    found("recipientName", d.recipientName); found("shippingAddress", d.shippingAddress);
    found("paymentMethod", d.paymentMethod); found("orderedAt", d.orderedAt);
    return d;
  }

  /** รวมผลจากหลายภาพ ช่องไหนภาพแรกไม่มีก็เอาจากภาพถัดไป */
  function merge(drafts) {
    const r = emptyDraft("");
    const keys = ["productName", "variant", "shopName", "quantity", "orderNumber", "referenceNumber", "trackingNumber",
      "carrier", "totalAmount", "recipientName", "shippingAddress", "paymentMethod", "cardLast4", "orderedAt"];
    for (const d of drafts) {
      for (const k of keys) r[k] ??= d[k] ?? null;
      r.paymentConfirmed = r.paymentConfirmed || !!d.paymentConfirmed;
      r.screenshots.push(...(d.screenshots || []));
      r.rawText += (r.rawText.length > 0 ? "\n\n----------\n\n" : "") + (d.rawText || "");
      for (const f of d.foundFields || []) if (!r.foundFields.includes(f)) r.foundFields.push(f);
      for (const l of d.rawLines || []) if (!r.rawLines.includes(l)) r.rawLines.push(l);
    }
    return r;
  }

  function parseDate(line) {
    let m = line.match(/(\d{1,2})\s*([^\s\d]{1,6}\.?[^\s\d]{0,3}\.?)\s*(\d{4})(?:\s+(\d{1,2})[:.](\d{2}))?/u);
    if (m) {
      const month = matchThaiMonth(m[2]);
      if (month != null) return build(m[1], month, m[3], m[4], m[5]);
    }
    m = line.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2})[:.](\d{2}))?/u);
    if (m) return build(m[1], parseInt(m[2], 10), m[3], m[4], m[5]);
    m = line.match(/(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/u);
    if (m) return build(m[3], parseInt(m[2], 10), m[1], m[4], m[5]);
    return null;

    function build(day, month, year, hh, mm) {
      let y = parseInt(year, 10);
      if (y > 2400) y -= 543;   // ปี พ.ศ.
      const dd = parseInt(day, 10), h = hh ? parseInt(hh, 10) : 0, mi = mm ? parseInt(mm, 10) : 0;
      if (y < 1 || month < 1 || month > 12 || dd < 1 || h > 23 || mi > 59) return null;
      const dim = new Date(y, month, 0).getDate();
      if (dd > dim) return null;
      return localIso(y, month, dd, h, mi, 0);
    }
  }

  const cleanCode = (raw) => raw.replace(/\s+/gu, "").replace(/-+$/u, "").toUpperCase();
  const cleanTracking = (raw) => cleanCode(raw).split("O").join("0");

  const LookAlike = [
    ["n", "ก"], ["N", "ก"], ["u", "ย"], ["v", "ย"], ["U", "ย"],
    ["w", "พ"], ["W", "พ"], ["s", "ส"], ["S", "ส"], ["m", "ม"], ["M", "ม"],
    ["A", "ค"], ["a", "ค"], ["e", "เ"], ["E", "เ"], ["d", "ด"], ["D", "ด"],
    ["t", "ต"], ["T", "ต"], ["y", "ย"], ["Y", "ย"], ["p", "พ"], ["P", "พ"],
  ];
  const isCons = (c) => c >= "ก" && c <= "ฮ";
  const keyChars = (s) => [...s].filter((c) => isCons(c) || c === "เ" || c === "ี" || c === "ิ").join("");
  const consOnly = (s) => [...s].filter(isCons).join("");

  function matchThaiMonth(token) {
    let t = token;
    for (const [from, to] of LookAlike) t = t.split(from).join(to);
    const key = keyChars(t);
    if (!key) return null;
    for (const [name, num] of ThaiMonths) if (key === keyChars(name)) return num;
    const cons = consOnly(key);
    const hits = [...new Set(ThaiMonths.filter(([name]) => consOnly(name) === cons).map(([, n]) => n))];
    return hits.length === 1 ? hits[0] : null;
  }

  const isItemPriceLine = (t) => QtyRx.test(t) && amountTest(t);

  function readQty(line) {
    let m = line.match(QtyRx);
    if (m) { const q = parseInt(m[1], 10); if (q > 0 && q <= 999) return q; }
    m = line.match(/(?:จำนวน|Qty|Quantity)\s*[:：]?\s*(\d{1,3})/iu);
    if (m) { const q = parseInt(m[1], 10); if (q > 0 && q <= 999) return q; }
    return null;
  }

  function toNumber(m) {
    let n = m.groups.n;
    // OCR มักอ่าน ฿ เป็นเลข 8 ติดหน้าตัวเลข เช่น "84,740.45" ที่จริงคือ ฿4,740.45
    if (!/[฿B๒]/u.test(m[0]) && /^8\d{1,2},\d{3}$/u.test(n)) n = n.slice(1);
    return Number(n.split(",").join("") + "." + m.groups.d);
  }

  const isKeywordLine = (l) => /รวม|ส่วนลด|คูปอง|ค่าจัดส่ง|ชำระ|หมายเลข|วันที่|ที่อยู่|แชท|คะแนน|สำเร็จ|รายละเอียด|ประเภท|พอยท์/u.test(l);

  function isProductLine(l) {
    if (l.length < 8 || isKeywordLine(l)) return false;
    if (amountTest(l) && l.length < 25) return false;
    return (l.match(/[A-Za-zก-๏]/gu) || []).length >= 6;
  }

  const isShopName = (l) => l.length >= 2 && l.length <= 40 && /[ก-๏A-Za-z]{2}/u.test(l) && !isKeywordLine(l) && !/^\d{1,2}:\d{2}/u.test(l);

  function cleanProductName(l) {
    let name = l.replace(/\s*[xXхХ×✕%*]\s?\d{1,3}\s*[|\]\)]?\s*$/u, "");
    name = fixModelCode(name);
    return name.replace(/\s+/gu, " ").trim();
  }

  /** แก้ตัวที่ OCR อ่านพลาดบ่อยในรหัสรุ่น เช่น "A6t" ถูกอ่านเป็น "Aét" */
  const fixModelCode = (s) => s.replace(new RegExp(`(?<=${B0}[A-Za-z0-9]{1,4})[éèêëÉ](?=[A-Za-z0-9]{0,4}${B1})`, "gu"), "6");

  // ---------- TSV ของ Tesseract -> บรรทัดพร้อมตำแหน่ง ----------
  const isThai = (c) => c >= "฀" && c <= "๿";

  function parseTsv(tsv) {
    let width = 0, height = 0;
    const groups = new Map();
    for (const row of String(tsv || "").split("\n")) {
      const c = row.replace(/\r$/, "").split("\t");
      if (c.length < 12 || c[0] === "level") continue;
      const I = (i) => parseInt(c[i], 10);
      if (c[0] === "1") { width = I(8); height = I(9); continue; }
      if (c[0] !== "5" || !c[11].trim()) continue;
      const key = `${I(1)}|${I(2)}|${I(3)}|${I(4)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ text: c[11], l: I(6), t: I(7), w: I(8), h: I(9) });
    }
    const lines = [];
    for (const list of groups.values()) {
      const words = [...list].sort((a, b) => a.l - b.l);
      const lineH = Math.max(...words.map((w) => w.h));
      let s = words[0].text;
      for (let i = 1; i < words.length; i++) {
        const prev = words[i - 1], cur = words[i];
        const gap = cur.l - (prev.l + prev.w);
        const thaiPair = isThai(prev.text[prev.text.length - 1]) && isThai(cur.text[0]);
        const trailingDots = (cur.text[0] === "." || cur.text[0] === "…") && gap <= lineH * 0.28;
        if ((!thaiPair || gap > lineH * 0.28) && !trailingDots) s += " ";
        s += cur.text;
      }
      lines.push({
        text: s,
        left: Math.min(...words.map((w) => w.l)), top: Math.min(...words.map((w) => w.t)),
        right: Math.max(...words.map((w) => w.l + w.w)), bottom: Math.max(...words.map((w) => w.t + w.h)),
      });
    }
    lines.sort((a, b) => a.top - b.top);
    return { lines, width, height };
  }

  // ---------- จับคู่ค่าที่ยิงได้จาก QR / บาร์โค้ด ----------
  const scanClean = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "").split("O").join("0");

  function scanTokens(code) {
    const upper = String(code).trim().toUpperCase();
    const out = [scanClean(upper)];
    for (const m of upper.matchAll(/[A-Z0-9]{8,}/g)) out.push(m[0].split("O").join("0"));
    return out;
  }

  function findMatch(orders, code) {
    const tokens = [...new Set(scanTokens(code).filter((t) => t.length >= 6))];
    if (!tokens.length) return null;
    let best = null, bestScore = 0;
    for (const o of orders) {
      let score = score1(o.trackingNumber, tokens, 3);
      score = Math.max(score, score1(o.orderNumber, tokens, 2));
      score = Math.max(score, score1(o.referenceNumber, tokens, 1));
      score = Math.max(score, score1(o.controlNo, tokens, 2));
      if (score > 0 && o.status === "Pending") score += 10;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  function score1(field, tokens, weight) {
    if (!field || !String(field).trim()) return 0;
    const f = scanClean(field);
    if (f.length < 6) return 0;
    for (const t of tokens) {
      if (t === f) return weight * 2;
      if (t.includes(f)) return weight;
    }
    return 0;
  }

  window.PTParser = { normalize, parseOcr, parseText, merge, parseDate, parseTsv, findMatch, scanClean, fixModelCode };
})();
