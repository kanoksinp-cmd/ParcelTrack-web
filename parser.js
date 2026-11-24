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

  const CARRIER_FUZZY = [
    [/J\s?[&8]\s?T|(?:^|\n)\s*(?:18|J8|JT)\s+Express/im, "J&T Express"], [/\bSPX\b/i, "SPX Express"], [/Kerry/i, "Kerry Express"], [/Flash/i, "Flash Express"],
    [/Lazada\s?(Express|Logistics)|\bLEX\b/i, "Lazada Express"], [/Ninja\s?Van/i, "Ninja Van"], [/Best\s?Express/i, "Best Express"],
    [/ไปรษณีย์/u, "ไปรษณีย์ไทย"], [/\bEMS\b/, "EMS"], [/DHL/i, "DHL eCommerce"],
  ];

  const ThaiMonths = [
    ["ม.ค.", 1], ["ก.พ.", 2], ["มี.ค.", 3], ["เม.ย.", 4], ["พ.ค.", 5], ["มิ.ย.", 6],
    ["ก.ค.", 7], ["ส.ค.", 8], ["ก.ย.", 9], ["ต.ค.", 10], ["พ.ย.", 11], ["ธ.ค.", 12],
  ];

  const AMOUNT_SRC = "(?<![\\d,.])[฿B8๒]?\\s?(?<n>\\d{1,3}(?:,\\d{3})+|\\d+)\\.(?<d>\\d{2})(?!\\d)";
  const amountTest = (s) => new RegExp(AMOUNT_SRC, "u").test(s);
  const amountAll = (s) => [...s.matchAll(new RegExp(AMOUNT_SRC, "gu"))];

  const QTY_SRC = "(?<![*\\d])[xXхХ×✕%*]\\s?(\\d{1,3})(?!\\d)\\s*[|\\]\\)]?\\s*$";
  const QtyRx = new RegExp(QTY_SRC, "u");

  const ciIncludes = (hay, needle) => hay.toLowerCase().includes(needle.toLowerCase());
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const localIso = (y, mo, d, h = 0, mi = 0, s = 0) => `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`;

  // คำที่ OCR ภาษาไทยอ่านพลาดบ่อย (บ↔ป, ย↔ข, จ↔อ, ฿ เป็น B/8 ฯลฯ) แก้ก่อนแยกช่อง
  const WORD_FIXES = [
    [/บ?ปัตร/gu, "บัตร"], [/ย?ขอด(?=รวม|ชำระ|สุทธิ|คำสั่ง)/gu, "ยอด"], [/ยขอด/gu, "ยอด"],
    [/[อจ]ัดส่ง/gu, "จัดส่ง"], [/สำเร[ือ็]+จ?(?=แล้ว)/gu, "สำเร็จ"], [/สําเร็จ/gu, "สำเร็จ"],
    [/เครติต/gu, "เครดิต"], [/เดปิต/gu, "เดบิต"], [/พร้อมเพข/gu, "พร้อมเพย์"],
    [/หมายเลขติดตามพัสต/gu, "หมายเลขติดตามพัสดุ"], [/ชําระ/gu, "ชำระ"],
    [/(\d)\s?(?:ทา|mI|rnl|m1)(?=\s|$|\|)/gu, "$1ml"],
    [/\s+[|\]]+\s*$/gmu, ""],
    [/(?<=\s)su(?=\s+[A-Za-z0-9éèêë]{2,})/gu, "รุ่น"],
  ];

  function normalize(text) {
    let t = String(text ?? "").split("ํา").join("ำ").split("\r").join("");
    // คำผิดที่ OCR ชอบอ่านพลาดในหน้าคำสั่งซื้อ
    t = t.replace(/ส[ิั]?่?งซื้อ/gu, "สั่งซื้อ");
    t = t.split("หมายเลขหพัสดุ").join("หมายเลขพัสดุ");
    for (const [rx, to] of WORD_FIXES) t = t.replace(rx, to);
    return t;
  }

  function emptyDraft(rawText = "") {
    return {
      controlNo: null, imageCount: 0, duplicate: null,
      productName: null, variant: null, shopName: null, quantity: null,
      orderNumber: null, referenceNumber: null, trackingNumber: null, carrier: null,
      recipientName: null, shippingAddress: null, totalAmount: null, paymentMethod: null,
      cardLast4: null, paymentConfirmed: false, orderedAt: null,
      screenshots: [], foundFields: [], rawText, rawLines: [], unsureFields: [], unsureReasons: {},
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
    const addFound = (f) => { if (!d.foundFields.includes(f)) d.foundFields.push(f); };
    if (item.title != null) {
      d.productName = item.title;
      if (item.variant != null) d.variant = item.variant;
      addFound("productName");
      if (item.variant != null) addFound("variant");
      if (item.qty != null) { d.quantity = item.qty; addFound("quantity"); }
      if (item.conf < 80) d._unsure.productName = `บางคำในชื่อสินค้าอ่านไม่ชัด (มั่นใจ ${Math.round(item.conf)}%)`;
      // ไม่เจอร้านจากป้าย Official/Mall: ใช้บรรทัดหัวกล่องสินค้า (ชื่อร้านมักอยู่เหนือรูปสินค้า)
      if (d.shopName == null) {
        const cand = [...item.above].reverse().slice(0, 2).map((l) => l.text).find(isShopName);
        if (cand) { d.shopName = cand; addFound("shopName"); d._unsure.shopName = "เดาจากบรรทัดเหนือสินค้า ตรวจชื่อร้านอีกครั้ง"; }
      }
    }

    // ความมั่นใจของ OCR ต่อบรรทัด: ช่องที่มาจากบรรทัดที่อ่านไม่ชัด ให้ขึ้นสีเตือน
    const squash = (x) => String(x ?? "").toUpperCase().replace(/[\s,]/g, "");
    const lineOf = (val) => {
      const v = squash(val);
      if (v.length < 3) return null;
      return ocr.lines.find((l) => squash(normalize(l.text)).includes(v) || squash(fixTracking(l.text)).includes(v)) || null;
    };
    const checks = { orderNumber: d.orderNumber, trackingNumber: d.trackingNumber, shopName: d.shopName, recipientName: d.recipientName,
      totalAmount: d.totalAmount != null ? Number(d.totalAmount).toFixed(2).replace(/\.00$/, "") : null, shippingAddress: null };
    // ความมั่นใจของคำที่ประกอบเป็นค่าในช่องนั้น (ไม่นับคำป้าย เช่น "หมายเลขคำสั่งซื้อ")
    const wordConf = (l, val) => {
      const v = squash(val);
      const ws = (l.words || []).filter((w) => { const t = squash(normalize(w.text)); return t.length && (v.includes(t) || t.includes(v)); });
      return ws.length ? Math.min(...ws.map((w) => w.conf)) : l.minConf;
    };
    const limit = { orderNumber: 70, trackingNumber: 70, totalAmount: 70, shopName: 80, recipientName: 80 };
    for (const [f, val] of Object.entries(checks)) {
      if (val == null || d._unsure[f]) continue;
      const l = lineOf(val);
      if (!l) continue;
      const c = wordConf(l, val);
      if (c < (limit[f] || 80)) d._unsure[f] = `ภาพไม่ชัดตรงนี้ (มั่นใจ ${Math.round(c)}%)`;
    }
    if (d.trackingNumber && !trackingValid(d.trackingNumber) && !d._unsure.trackingNumber)
      d._unsure.trackingNumber = "รูปแบบเลขพัสดุไม่ตรงกับขนส่งที่รู้จัก";
    return finalize(d);
  }

  function finalize(d) {
    const u = d._unsure || {};
    d.unsureReasons = {};
    for (const [k, msg] of Object.entries(u)) if (d[k] != null && d[k] !== "") d.unsureReasons[k] = msg;
    d.unsureFields = Object.keys(d.unsureReasons);
    delete d._unsure;
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

    const textLines = block.filter((l) => !amountTest(l.text));
    if (!textLines.length) return { title: null, variant: null };
    let titleLines = [textLines[0]], variant = null, variantLine = null;
    const rest = textLines.slice(1);
    if (rest.length >= 2) {
      // ชื่อยาวขึ้นบรรทัดใหม่ + ตัวเลือกบรรทัดสุดท้าย (เช่น "Galaxy A56 (8+256GB)" / "สมาร์ทโฟน" / "สีกราไฟต์")
      const last = rest[rest.length - 1];
      if (last.text.length <= 30) { variant = last.text; variantLine = last; titleLines.push(...rest.slice(0, -1)); }
      else titleLines.push(...rest);
    } else if (rest.length === 1) {
      if (rest[0].text.length <= 30) { variant = rest[0].text; variantLine = rest[0]; }
      else titleLines.push(rest[0]);
    }
    const title = titleLines.map((l) => l.text).join(" ");
    return {
      title: cleanProductName(title), variant, qty: readQty(lines[anchor].text),
      conf: Math.min(...titleLines.flatMap((l) => (l.words || []).map((w) => w.conf)), 100),
      avgConf: titleLines.reduce((a, l) => a + (l.conf ?? 100), 0) / titleLines.length,
      variantConf: variantLine?.minConf ?? 100,
      above: lines.slice(0, lines.indexOf(block[0])),
    };
  }

  function parseText(rawText) {
    const d = emptyDraft(rawText);
    d._unsure = {};
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
    if (d.carrier == null) for (const [rx, c] of CARRIER_FUZZY) if (rx.test(text)) { d.carrier = c; break; }
    if (d.carrier == null) {
      m = text.match(/ส่งโดย\s*[:：]?\s*(.+)/u);
      if (m) d.carrier = m[1].trim();
    }

    // ---------- หมายเลขคำสั่งซื้อ / อ้างอิง ----------
    const platform = detectPlatform(text);
    m = text.match(/(?:หมายเลขคำสั่งซื้อ|เลขที่คำสั่งซื้อ|รหัสคำสั่งซื้อ|เลขคำสั่งซื้อ|คำสั่งซื้อ\s*#|Order (?:ID|No\.?|Number))\s*[:：#]?\s*([A-Z0-9][A-Z0-9 -]{6,}[A-Z0-9])/iu);
    if (m) {
      const on = fixOrderNumber(m[1], platform);
      d.orderNumber = on.value;
      if (!on.valid) d._unsure.orderNumber = "รูปแบบเลขคำสั่งซื้อไม่ตรงกับที่แอปร้านค้าใช้";
    }
    m = text.match(/อ้างอิง\s*[:：]?\s*([A-Z0-9][A-Z0-9 -]{4,}[A-Z0-9])/iu);
    if (m) d.referenceNumber = cleanCode(m[1]);

    // ---------- ยอดชำระ ----------
    // ป้ายยอดสุทธิเรียงจากมั่นใจมากไปน้อย (รวมการสั่งซื้อ/ยอดรวมสินค้า = ยอดก่อนส่วนลด ใช้เป็นตัวเลือกสุดท้าย)
    const TOTAL_LABELS = [
      /ยอดคำสั่งซื้อทั้งหมด|ยอดรวมทั้งหมด|ยอดชำระทั้งหมด|ชำระเงินทั้งหมด|ยอดชำระสุทธิ|ยอดสุทธิ|ยอดที่ต้องชำระ|ยอดชำระ|Order Total|Total Payment|Grand Total/iu,
      /รวมยอด|ยอดรวม(?!สินค้า)|รวมทั้งหมด|Total(?! ?Items)/iu,
      /รวมการสั่งซื้อ|ยอดรวมสินค้า|Subtotal/iu,
    ];
    const notTotal = /ส่วนลด|ค่าจัดส่ง|คูปอง|พอยท์|แต้ม|เหรียญ/u;
    const pageAmounts = amountAll(text);
    const unsymbolEights = pageAmounts.filter((x) => !/[฿B๒]/u.test(x[0]) && /^8/.test(x.groups.n)).length;
    const itemTotals = lines.filter(isItemPriceLine).map((l) => {
      const am = amountAll(l), q = readQty(l) || 1;
      return am.length ? round2(toNumber(am[am.length - 1], unsymbolEights >= 2) * q) : null;
    }).filter((x) => x != null);
    for (const rx of TOTAL_LABELS) {
      const totalLine = [...lines].reverse().find((l) => rx.test(l) && !notTotal.test(l) && amountTest(l));
      if (totalLine == null) continue;
      const amounts = amountAll(totalLine);
      const last = amounts[amounts.length - 1];
      let v = toNumber(last, unsymbolEights >= 2);
      // ฿ ถูกอ่านเป็นเลข 8 ข้างหน้า: ถ้าตัด 8 แล้วตรงกับราคาสินค้า×จำนวน ใช้ค่าที่ตัดแล้ว
      const raw = Number(last.groups.n.split(",").join("") + "." + last.groups.d);
      if (/^8/.test(last.groups.n) && !/[฿B๒]/u.test(last[0])) {
        const stripped = Number(last.groups.n.slice(1).split(",").join("") + "." + last.groups.d);
        const itemsSum = itemTotals.reduce((a, b) => a + b, 0);
        const plausible = (x) => itemsSum > 0 && x >= itemsSum * 0.3 && x <= itemsSum * 1.5 + 200;
        if (itemTotals.some((t) => Math.abs(t - stripped) < 0.01)) v = stripped;
        else if (itemTotals.some((t) => Math.abs(t - raw) < 0.01)) v = raw;
        else if (plausible(stripped) && !plausible(raw)) v = stripped;
        else if (plausible(raw) && !plausible(stripped)) v = raw;
        else d._unsure.totalAmount = "ตัวเลขขึ้นต้นด้วย 8 อาจเป็นสัญลักษณ์ ฿ ที่อ่านเพี้ยน";
      }
      d.totalAmount = v;
      if (rx === TOTAL_LABELS[2]) d._unsure.totalAmount = "อ่านได้แค่ยอดก่อนส่วนลด/ค่าส่ง ตรวจยอดสุทธิอีกครั้ง";
      break;
    }

    // ---------- วันที่สั่งซื้อ ----------
    const dateLine = lines.find((l) => /วันที่สั่งซื้อ|เวลาที่?สั่งซื้อ|ซื้อเมื่อ|วันที่ทำการสั่งซื้อ|Order (?:Time|Date)|Placed on/iu.test(l) && parseDate(l));
    if (dateLine != null) d.orderedAt = parseDate(dateLine);
    else {
      const any = lines.find((l) => !/คาดว่า|ได้รับ|จัดส่งภายใน|หมดอายุ/u.test(l) && parseDate(l));
      if (any != null) { d.orderedAt = parseDate(any); d._unsure.orderedAt = "ไม่พบป้าย \"เวลาสั่งซื้อ\" ใช้วันที่แรกที่เจอในภาพ"; }
    }

    // ---------- การชำระเงิน ----------
    if (/บัตรเครดิต|บัตรเดบิต|เครดิต\s?\/\s?เดบิต|Credit\s?Card|Debit\s?Card|Visa|Mastercard/iu.test(text)) d.paymentMethod = "บัตรเครดิต / เดบิต";
    else if (/พร้อมเพย์|PromptPay|QR พร้อมเพย์/iu.test(text)) d.paymentMethod = "พร้อมเพย์";
    else if (text.includes("โอนเงิน") || text.includes("Mobile Banking")) d.paymentMethod = "โอนผ่านธนาคาร";
    else if (text.includes("เก็บเงินปลายทาง") || new RegExp(`${B0}COD${B1}`, "u").test(text)) d.paymentMethod = "เก็บเงินปลายทาง";
    else if (/ShopeePay|ช้อปปี้เพย์|Lazada Wallet|TikTok Pay|SPayLater|LazPayLater/iu.test(text)) d.paymentMethod = "วอลเล็ต / Pay Later";
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
        if (/^\(?\+?\d[\d\s()*+-]{6,}$/u.test(l)) continue;      // บรรทัดเบอร์โทรอย่างเดียว
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
    const badgeOnly = /^(?:Official\s*(?:Mall|Shop|Store)?|LazMall|Shopee\s?Mall|Mall|ร้านแนะนำ|Preferred\+?|Official)$/iu;
    if (officialIdx >= 0 && !badgeOnly.test(lines[officialIdx]) && isShopName(lines[officialIdx])) {
      d.shopName = lines[officialIdx].replace(/^(?:Mall|LazMall)\s+/iu, "");
    } else if (officialIdx >= 0) {
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
      for (const k of keys) {
        if (r[k] == null && d[k] != null) {
          r[k] = d[k];
          if (d.unsureReasons?.[k]) (r.unsureReasons ||= {})[k] = d.unsureReasons[k];
        }
      }
      r.paymentConfirmed = r.paymentConfirmed || !!d.paymentConfirmed;
      r.screenshots.push(...(d.screenshots || []));
      r.rawText += (r.rawText.length > 0 ? "\n\n----------\n\n" : "") + (d.rawText || "");
      for (const f of d.foundFields || []) if (!r.foundFields.includes(f)) r.foundFields.push(f);
      for (const l of d.rawLines || []) if (!r.rawLines.includes(l)) r.rawLines.push(l);
    }
    r.unsureReasons ||= {};
    r.unsureFields = Object.keys(r.unsureReasons);
    return r;
  }

  function parseDate(line) {
    line = line.replace(/([ก-ฮ])\.\s+([ก-ฮ])/gu, "$1.$2");
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
  const TRACK_PREFIX = /^(LEX[A-Z]{2}|SPXTH|THBEST|KER[A-Z]{0,3}|KEX[A-Z]?|KBK|NVTH|JNTE?|BEST|DHL|TH|[A-Z]{2}(?=[0-9OQDILZSBG]{9}TH$))/;
  const DIGITISH = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", B: "8", G: "6" };
  /** เลขพัสดุ: ตัดช่องว่าง ตัวใหญ่ และเปลี่ยนตัวอักษรที่หน้าตาเหมือนตัวเลขเฉพาะช่วงที่ควรเป็นตัวเลข */
  function fixTracking(raw) {
    const c = String(raw ?? "").toUpperCase().replace(/[\s-]+/gu, "");
    if (!c) return c;
    const m = c.match(TRACK_PREFIX);
    let pre = m ? m[0] : "", body = c.slice(pre.length), suf = "";
    if (!m) { const lead = c.match(/^[A-Z]+/); pre = lead ? lead[0].replace(/O+$/, "") : ""; body = c.slice(pre.length); }
    const tail = body.match(/(TH|[A-Z])$/);
    if (tail && /\d/.test(body.slice(0, -tail[0].length))) { suf = tail[0]; body = body.slice(0, -suf.length); }
    if ((body.match(/\d/g) || []).length >= body.length * 0.6) body = body.replace(/[OQDILZSBG]/g, (ch) => DIGITISH[ch]);
    return pre + body + suf;
  }
  const cleanTracking = (raw) => fixTracking(cleanCode(raw));

  /** แพลตฟอร์มจากข้อความ ใช้ตรวจรูปแบบเลขคำสั่งซื้อ/เลขพัสดุ */
  function detectPlatform(text) {
    if (/shopee|ช้อปปี้|SPX/iu.test(text)) return "shopee";
    if (/lazada|ลาซาด้า|LazMall|LEX[A-Z]{2}\d/iu.test(text)) return "lazada";
    if (/tiktok|ติ๊กต็อก/iu.test(text)) return "tiktok";
    return null;
  }

  /** เลขคำสั่งซื้อ: แก้ตามรูปแบบของแต่ละแอป แล้วบอกว่าเข้ารูปแบบที่รู้จักหรือไม่ */
  function fixOrderNumber(raw, platform) {
    let c = cleanCode(raw || "");
    if (!c) return { value: null, valid: false };
    const toDigits = (s) => s.replace(/[OQDILZSBG]/g, (ch) => DIGITISH[ch]);
    if (/^[0-9OQDILZSBG]{6}[A-Z0-9]{8}$/.test(c) && platform !== "lazada" && platform !== "tiktok")
      c = toDigits(c.slice(0, 6)) + c.slice(6);                                  // Shopee: ปปดดวว + 8 ตัว
    else if ((c.match(/\d/g) || []).length >= c.length - 2) c = toDigits(c);      // Lazada / TikTok: ตัวเลขล้วน
    const valid = /^\d{6}[A-Z0-9]{8}$/.test(c) || /^\d{12,16}$/.test(c) || /^5\d{17}$/.test(c);
    return { value: c, valid };
  }

  const TRACK_OK = [/^TH\d{10,14}[A-Z]?$/, /^SPXTH\d{9,13}$/, /^LEX[A-Z]{2}\d{8,12}$/, /^[A-Z]{2}\d{9}TH$/,
    /^KER[A-Z]{0,3}\d{7,12}$/, /^KEX[A-Z]?\d{7,12}$/, /^\d{10,15}$/, /^(NV|NVTH)[A-Z0-9]{8,16}$/, /^JNTE?\d{9,13}$/, /^[A-Z]{2,5}\d{8,14}[A-Z]{0,2}$/];
  const trackingValid = (t) => !!t && TRACK_OK.some((rx) => rx.test(t));

  const LookAlike = [
    ["n", "ก"], ["N", "ก"], ["u", "ย"], ["v", "ย"], ["U", "ย"],
    ["w", "พ"], ["W", "พ"], ["s", "ส"], ["S", "ส"], ["m", "ม"], ["M", "ม"],
    ["A", "ค"], ["a", "ค"], ["e", "เ"], ["E", "เ"], ["d", "ด"], ["D", "ด"],
    ["t", "ต"], ["T", "ต"], ["y", "ย"], ["Y", "ย"], ["p", "พ"], ["P", "พ"], ["g", "ย"], ["q", "ย"], ["c", "ค"], ["C", "ค"],
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

  function toNumber(m, eightIsBaht = false) {
    let n = m.groups.n;
    // OCR มักอ่าน ฿ เป็นเลข 8 ติดหน้าตัวเลข เช่น "84,740.45" ที่จริงคือ ฿4,740.45
    if (!/[฿B๒]/u.test(m[0]) && (/^8\d{1,2},\d{3}$/u.test(n) || (eightIsBaht && /^8\d+$/u.test(n) && n.length >= 2))) n = n.slice(1);
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
  const isThai = (c) => c >= "\u0E00" && c <= "\u0E7F";
  let SPACE_GAP = 0.28;

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
      groups.get(key).push({ text: c[11], l: I(6), t: I(7), w: I(8), h: I(9), conf: parseFloat(c[10]) });
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
        if ((!thaiPair || gap > lineH * SPACE_GAP) && !trailingDots) s += " ";
        s += cur.text;
      }
      lines.push({
        text: s,
        left: Math.min(...words.map((w) => w.l)), top: Math.min(...words.map((w) => w.t)),
        right: Math.max(...words.map((w) => w.l + w.w)), bottom: Math.max(...words.map((w) => w.t + w.h)),
        words: words.map((w) => ({ text: w.text, conf: isNaN(w.conf) ? 0 : w.conf })),
        conf: words.reduce((a, w) => a + (isNaN(w.conf) ? 0 : w.conf), 0) / words.length,
        minConf: Math.min(...words.map((w) => (isNaN(w.conf) ? 0 : w.conf))),
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

  window.PTParser = {
    normalize, parseOcr, parseText: (t) => finalize(parseText(t)), merge, parseDate, parseTsv, findMatch, scanClean, fixModelCode,
    setSpaceGap: (v) => { SPACE_GAP = v; }, fixTracking, fixOrderNumber, trackingValid, detectPlatform, isItemPriceLine,
  };
})();
