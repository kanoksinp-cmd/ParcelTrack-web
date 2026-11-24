/* ParcelTrack — หน้าเว็บฝั่งผู้ใช้ (ใช้ได้ทั้งมือถือและคอม)
 * เวอร์ชันเว็บล้วน: คำสั่ง /api/... ถูกตอบโดย backend.js ที่รันในเบราว์เซอร์ */
(() => {
  "use strict";

  const $view = document.getElementById("view");
  const $toast = document.getElementById("toast");
  const $picker = document.getElementById("filePicker");
  const $usb = document.getElementById("usbScan");

  // ---------- ไอคอน ----------
  const I = {
    box: '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg>',
    qr: '<svg viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
    alert: '<svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.01"/><circle cx="12" cy="12" r="9"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    excel: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8l6 8M15 8l-6 8"/></svg>',
    fwd: '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1-5a8 8 0 1 1 17-6z"/></svg>',
  };

  // ---------- ตัวช่วย ----------
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n == null ? "–" : "฿\u202f" + Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const dt = (s, withTime = true) => {
    if (!s) return "–";
    const d = new Date(s);
    if (isNaN(d)) return "–";
    const opt = { day: "2-digit", month: "short", year: "numeric" };
    if (withTime) Object.assign(opt, { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleString("th-TH-u-ca-gregory", opt);
  };
  const statusBadge = (o) => o.status === "Received"
    ? '<span class="badge received">ได้รับแล้ว</span>'
    : '<span class="badge pending">รอของมาส่ง</span>';

  let toastTimer;
  function toast(msg, isError = false) {
    $toast.textContent = msg;
    $toast.className = "toast show" + (isError ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($toast.className = "toast"), 3200);
  }

  async function api(path, opts = {}) {
    const res = await fetch("/api" + path, {
      headers: opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
      ...opts,
      body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (data === null) throw new Error("เกิดข้อผิดพลาดในการอ่านข้อมูล ลองรีเฟรชหน้าเว็บ");
    if (!res.ok) throw new Error(data.error || data.detail || "เกิดข้อผิดพลาด (" + res.status + ")");
    return data;
  }

  // ---------- เส้นทางหน้า ----------
  let draft = null;        // ข้อมูลที่อ่านจากภาพ รอผู้ใช้ตรวจ
  let scanner = null;      // กล้องสแกน QR
  let scanBusy = false;
  let scanPhoto = null;    // รูปที่ใช้ตอนสแกน เอาไปรวมกับรูปของรายการเมื่อปิดงาน
  let deepScanTimer = null;  // ตัวจับเวลาสำหรับซูมอ่านโค้ดระหว่างเปิดกล้องสด
  let scanZoom = null;      // ภาพบริเวณที่ซูมเข้าไปอ่านโค้ดได้ ใช้โชว์ให้เห็นว่าอ่านมาจากตรงไหน
  let appInfo = null;      // ข้อมูลเวอร์ชัน/พอร์ตจากเซิร์ฟเวอร์ (ใช้ทำลิงก์ https ของหน้าสแกน)

  const routes = [
    [/^$/, home],
    [/^orders$/, orders],
    [/^capture$/, capture],
    [/^edit\/(.+)$/, editOrder],
    [/^scan$/, scan],
    [/^done\/(.+)$/, done],
    [/^order\/(.+)$/, detail],
    [/^phone$/, phone],
    [/^report$/, report],
  ];

  async function render() {
    await stopScanner();
    closeSheet();
    const path = location.hash.replace(/^#\/?/, "").split("?")[0];
    if (!path.startsWith("order/")) pager = { prev: null, next: null };
    const nav = path.split("/")[0] || "home";
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === nav));
    $view.classList.toggle("flush", nav === "scan");
    document.querySelector(".tabbar").style.display = nav === "scan" ? "none" : "";
    for (const [rx, fn] of routes) {
      const m = path.match(rx);
      if (m) {
        try { await fn(...m.slice(1)); }
        catch (e) { $view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
        window.scrollTo(0, 0);
        return;
      }
    }
    location.hash = "#/";
  }
  window.addEventListener("hashchange", render);

  // ---------- รายการคำสั่งซื้อ (ใช้ซ้ำหลายหน้า) ----------
  function orderRows(list, withHead) {
    if (!list.length) return "";
    const head = withHead ? '<div class="thead"><div>สินค้า</div><div>หมายเลขคำสั่งซื้อ</div><div>เลขพัสดุ</div><div>วันที่สั่ง</div><div class="num">ยอดสุทธิ</div><div>สถานะ</div></div>' : "";
    return head + list.map((o) => {
      const st = o.status === "Received" ? "received" : "pending";
      return `<a class="order card" href="#/order/${o.id}" data-id="${o.id}">
        <span class="pick" aria-hidden="true">${I.check}</span>
        <span class="ic ${st}">${st === "received" ? I.check : I.box}</span>
        <span class="main">
          <span class="name">${esc(o.productName)}${o.variant ? " · " + esc(o.variant) : ""}</span>
          <span class="sub">${o.controlNo ? `<b class="idtag">${esc(o.controlNo)}</b> · ` : ""}${esc(o.carrier || "ไม่ระบุขนส่ง")} · ${esc(o.trackingNumber || "ไม่มีเลขพัสดุ")}${o.recipientName ? " · " + esc(o.recipientName) : ""}</span>
        </span>
        <span class="cell">${esc(o.orderNumber || "–")}<small>${esc(o.shopName || "")}</small></span>
        <span class="cell">${esc(o.trackingNumber || "–")}<small>${esc(o.carrier || "")}</small></span>
        <span class="cell date">${dt(o.orderedAt, false)}</span>
        <span class="side">
          <span class="price">${money(o.totalAmount)}</span>
          ${statusBadge(o)}
        </span>
      </a>`;
    }).join("");
  }

  // ---------- หน้าหลัก ----------
  async function home() {
    const [stats, list] = await Promise.all([api("/stats"), api("/orders")]);
    $view.innerHTML = `
      <div class="page-head">
        <div><p>สวัสดีครับ</p><h1>ParcelTrack</h1></div>
        <a class="btn small" href="#/phone">${I.share}<span>สำรองข้อมูล</span></a>
      </div>
      <div class="stats">
        <div class="stat card pending"><span>รอของมาส่ง</span><b>${stats.pending}</b></div>
        <div class="stat card received"><span>ได้รับแล้ว</span><b>${stats.received}</b></div>
        <div class="stat card"><span>ทั้งหมด</span><b>${stats.total}</b></div>
        <div class="stat card desk-only" style="display:none"><span>ยอดที่รอรับของ</span><b style="font-size:22px">${money(stats.pendingAmount)}</b></div>
      </div>
      <div class="actions">
        <a class="action primary" href="#/capture"><span class="ic">${I.doc}</span>
          <span><strong>สแกนภาพหน้าจอ</strong><small>อ่านคำสั่งซื้ออัตโนมัติ</small></span></a>
        <a class="action" href="#/scan"><span class="ic">${I.qr}</span>
          <span><strong>ยิง QR พัสดุ</strong><small>ยืนยันว่าของมาถึงแล้ว</small></span></a>
      </div>
      <div class="list-head"><h2>รายการล่าสุด</h2><a href="#/orders">ดูทั้งหมด</a></div>
      <div class="orders">${orderRows(list.slice(0, 8), true) ||
        '<div class="empty card">ยังไม่มีคำสั่งซื้อ<br>เริ่มจากกด “สแกนภาพหน้าจอ” แล้วเลือกภาพหน้ารายละเอียดคำสั่งซื้อ</div>'}</div>`;
    if (matchMedia("(min-width: 960px)").matches) $view.querySelector(".desk-only").style.display = "";
  }

  // ---------- หน้ารายการทั้งหมด ----------
  let filter = { status: "", q: "" };
  async function orders() {
    let selecting = false;

    $view.innerHTML = `
      <div class="page-head"><div><h1>คำสั่งซื้อ</h1><p>บันทึกจากภาพหน้าจอ แล้วยิง QR ยืนยันเมื่อของมาถึง</p></div>
        <div class="head-actions">
          <button class="btn small" id="selMode" aria-label="เลือกหลายรายการ">${I.check}<span>เลือกหลายรายการ</span></button>
          <a class="btn small excel" id="xlsx" href="/api/export.xlsx" download aria-label="Export to Excel">${I.excel}<span>Export to Excel</span></a>
          <a class="btn primary small" href="#/capture" aria-label="เพิ่มจากภาพ">${I.upload}<span>เพิ่มจากภาพ</span></a>
        </div></div>
      <label class="search card">${I.search}<span class="sr-only">ค้นหา</span>
        <input id="q" type="search" placeholder="ค้นหา ID No. เลขคำสั่งซื้อ เลขพัสดุ หรือชื่อสินค้า" value="${esc(filter.q)}"></label>
      <div class="chips" role="group" aria-label="กรองตามสถานะ">
        <button class="chip" data-s="">ทั้งหมด</button>
        <button class="chip" data-s="Pending">รอของมาส่ง</button>
        <button class="chip" data-s="Received">ได้รับแล้ว</button>
      </div>
      <div class="orders" id="list"></div>
      <div class="bulkbar" id="bulkbar" hidden>
        <button class="btn small" id="bbAll">เลือกทั้งหมด</button>
        <span class="bb-count">เลือกแล้ว <b>0</b> รายการ</span>
        <button class="btn small share" id="bbShare" disabled>${I.share}แชร์เข้าไลน์</button>
        <button class="btn small danger" id="bbDel" disabled>${I.trash}ลบที่เลือก</button>
        <button class="btn small" id="bbCancel">ยกเลิก</button>
      </div>`;

    const $list = $view.querySelector("#list");
    const $bar = $view.querySelector("#bulkbar");
    const $count = $bar.querySelector(".bb-count b");
    const $del = $view.querySelector("#bbDel");
    const $share = $view.querySelector("#bbShare");
    const $all = $view.querySelector("#bbAll");
    const picked = () => [...$list.querySelectorAll(".order.picked")];

    const refreshBar = () => {
      const n = picked().length;
      const total = $list.querySelectorAll(".order").length;
      $count.textContent = n;
      $del.disabled = n === 0;
      $share.disabled = n === 0;
      $all.textContent = n && n === total ? "ไม่เลือกเลย" : "เลือกทั้งหมด";
    };

    const setSelecting = (on) => {
      selecting = on;
      $list.classList.toggle("selecting", on);
      $view.classList.toggle("has-bulkbar", on);
      $bar.hidden = !on;
      $view.querySelector("#selMode").classList.toggle("on", on);
      if (!on) picked().forEach((el) => el.classList.remove("picked"));
      refreshBar();
    };

    const load = async () => {
      $view.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c.dataset.s === filter.status));
      const qs = new URLSearchParams(filter).toString();
      // ปุ่ม Export ส่งออกตามตัวกรอง/คำค้นที่เลือกอยู่
      $view.querySelector("#xlsx").href = "/api/export.xlsx?" + qs;
      const list = await api("/orders?" + qs);
      $list.innerHTML = orderRows(list, true) || '<div class="empty card">ไม่พบรายการ</div>';
      $list.classList.toggle("selecting", selecting);
      refreshBar();
    };

    // เลือกรายการ: ในโหมดเลือก แตะแถวไหนก็ติ๊ก/เอาออก ไม่เปิดหน้ารายละเอียด
    $list.addEventListener("click", (e) => {
      if (!selecting) return;
      const row = e.target.closest(".order");
      if (!row) return;
      e.preventDefault();
      row.classList.toggle("picked");
      refreshBar();
    });

    $view.querySelector("#selMode").addEventListener("click", () => setSelecting(!selecting));
    $view.querySelector("#bbCancel").addEventListener("click", () => setSelecting(false));
    $all.addEventListener("click", () => {
      const rows = [...$list.querySelectorAll(".order")];
      const on = picked().length !== rows.length;
      rows.forEach((r) => r.classList.toggle("picked", on));
      refreshBar();
    });
    $share.addEventListener("click", () => shareOrders(picked().map((r) => r.dataset.id)));
    $del.addEventListener("click", async () => {
      const ids = picked().map((r) => r.dataset.id);
      if (!ids.length) return;
      if (!confirm(`ลบ ${ids.length} รายการนี้ถาวร?\nรูปรวมภาพหน้าจอของรายการที่เลือกจะถูกลบด้วย`)) return;
      $del.disabled = true;
      try {
        const r = await api("/orders/bulk-delete", { method: "POST", body: { ids } });
        toast(`ลบแล้ว ${r.deleted} รายการ`);
        setSelecting(false);
        await load();
      } catch (e) { toast(e.message, true); $del.disabled = false; }
    });

    $view.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { filter.status = c.dataset.s; load(); }));
    let t;
    $view.querySelector("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { filter.q = e.target.value; load(); }, 250); });
    await load();
  }

  // ---------- สแกนภาพหน้าจอ ----------
  async function capture() {
    if (draft) return renderForm(draft, null);
    $view.innerHTML = `
      <div class="topbar"><a class="icon-btn ghost" href="#/" aria-label="กลับ">${I.back}</a><h1>สแกนภาพหน้าจอคำสั่งซื้อ</h1></div>
      <div class="drop" id="drop" role="button" tabindex="0">
        <span class="big">${I.upload}</span>
        <h2>เลือกภาพหน้าจอ</h2>
        <p>แตะเพื่อเลือกจากคลังภาพ (เลือกได้หลายภาพ)<br><span class="desk-hint">หรือลากภาพมาวาง / กด Ctrl+V เพื่อวาง</span></p>
      </div>
      <div class="tips card">
        <b>ถ่ายภาพหน้าจอให้ได้ข้อมูลครบ</b><br>
        ภาพที่ 1: ส่วนบนของหน้า “รายละเอียดคำสั่งซื้อ” ที่มีเลขพัสดุ ขนส่ง และชื่อสินค้า<br>
        ภาพที่ 2: ส่วนล่างที่มียอดชำระ หมายเลขคำสั่งซื้อ และวันที่สั่งซื้อ<br>
        ระบบจะรวมข้อมูลจากทุกภาพให้เอง
      </div>`;
    const drop = $view.querySelector("#drop");
    drop.addEventListener("click", () => $picker.click());
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $picker.click(); } });
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove("over"); dragDepth = 0; dropOverlay.classList.remove("show"); runOcr([...e.dataTransfer.files]); });
  }

  let appendNext = false;   // true = ภาพที่เลือกถัดไปจะรวมเข้ากับข้อมูลที่อ่านไว้แล้ว
  $picker.addEventListener("change", () => {
    const f = [...$picker.files]; $picker.value = "";
    const append = appendNext; appendNext = false;
    if (f.length) runOcr(f, append);
  });
  // วางภาพ (Ctrl+V) หรือลากภาพมาวางได้ทุกหน้า: ไปหน้าสแกนแล้วอ่านทันที
  const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) && el.type !== "checkbox";
  document.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    if (typing(e.target) && !location.hash.startsWith("#/capture")) return;
    if (location.hash.startsWith("#/scan")) return;
    e.preventDefault();
    runOcr(files, location.hash.startsWith("#/capture") && !!draft);
  });
  const dropOverlay = document.createElement("div");
  dropOverlay.className = "drop-overlay";
  dropOverlay.innerHTML = `<div>${I.upload}<b>วางภาพหน้าจอเพื่ออ่านข้อมูล</b></div>`;
  document.body.appendChild(dropOverlay);
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  window.addEventListener("dragenter", (e) => { if (!hasFiles(e) || location.hash.startsWith("#/scan")) return; dragDepth++; dropOverlay.classList.add("show"); });
  window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; dropOverlay.classList.remove("show"); } });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; dropOverlay.classList.remove("show");
    if (e.defaultPrevented && e.target.closest?.("#drop")) return;
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    if (files.length) runOcr(files, location.hash.startsWith("#/capture") && !!draft);
  });

  // ---------- การอ่านหนึ่งครั้ง = ID No. หนึ่งเลข + รูปรวมหนึ่งรูป ----------
  let session = null;   // { controlNo, files: [File] } ภาพทั้งหมดของการอ่านครั้งนี้

  async function runOcr(files, append = false) {
    files = files.filter((f) => f.type.startsWith("image/"));
    if (!files.length) return toast("เลือกได้เฉพาะไฟล์ภาพ", true);
    if (!location.hash.startsWith("#/capture")) location.hash = "#/capture";
    const keep = append ? draft : null;
    const keepSession = append ? session : null;
    $view.innerHTML = `<div class="loading"><div class="spinner"></div><div>กำลังอ่านข้อมูลจาก ${files.length} ภาพ…<br><small>ใช้เวลาประมาณ 3–10 วินาทีต่อภาพ</small></div></div>`;
    try {
      // 1) อ่านภาพก่อน เซิร์ฟเวอร์ตรวจว่าซ้ำกับของเดิมหรือไม่
      const fd = new FormData();
      if (append && session) fd.append("controlNo", session.controlNo);
      const prepped = await Promise.all(files.map(preprocessForOcr));
      prepped.forEach((f, i) => fd.append("files", f, f.name || `screenshot-${i + 1}.png`));
      const result = await api("/ocr", { method: "POST", body: fd });

      if (result.duplicate) {            // ซ้ำ: ไม่ออก ID No. ไม่บันทึกรูป
        draft = null; session = null;
        return showDuplicate(result.duplicate);
      }

      // 2) ไม่ซ้ำ: รวมภาพทั้งหมดของการอ่านครั้งนี้เป็นรูปเดียว ตั้งชื่อตาม ID No.
      if (!append || !session || session.controlNo !== result.controlNo) session = { controlNo: result.controlNo, files: [] };
      session.files.push(...files);
      const combined = await combineImages(session.files, session.controlNo);
      if (combined) {
        const img = new FormData();
        img.append("controlNo", session.controlNo);
        img.append("combined", combined, session.controlNo + ".jpg");
        const saved = await api("/ocr/image", { method: "POST", body: img });
        result.screenshots = [saved.file];
      }
      draft = keep ? mergeDraft(keep, result) : result;
      draft.controlNo = session.controlNo;
      draft.imageCount = session.files.length;
      draft.imageVersion = Date.now();   // บังคับโหลดรูปรวมใหม่ (ชื่อไฟล์เดิม)
      renderForm(draft, null);
    } catch (e) {
      toast(e.message, true);
      draft = keep;
      session = keepSession;
      capture();
    }
  }

  function showDuplicate(dup) {
    const received = dup.status === "Received";
    $view.innerHTML = `
      <div class="topbar"><a class="icon-btn ghost" href="#/" aria-label="กลับ">${I.back}</a><h1>พบรายการเดิม</h1></div>
      <div class="card dup">
        <div class="sheet-head"><span class="dot warn">${I.alert}</span>
          <div><h2>คำสั่งซื้อนี้บันทึกไว้แล้ว</h2><p>ไม่ได้บันทึกรูปและไม่ออก ID No. ใหม่</p></div></div>
        <div class="match card">
          <div class="row1"><span>${esc(dup.productName)}</span></div>
          <div class="kv">
            <div><span>ID No.</span><b>${esc(dup.controlNo || "–")}</b></div>
            <div><span>สถานะ</span><b style="color:${received ? "var(--accent-ink)" : "var(--warn-ink)"}">${received ? "ได้รับแล้ว" : "รอของมาส่ง"}</b></div>
            <div><span>หมายเลขคำสั่งซื้อ</span><b>${esc(dup.orderNumber || "–")}</b></div>
            <div><span>เลขพัสดุ</span><b>${esc(dup.trackingNumber || "–")}</b></div>
          </div>
        </div>
        <a class="btn primary block" href="#/order/${dup.id}">ดูรายการเดิม</a>
        <button class="btn block" id="another">อ่านภาพหน้าจออื่น</button>
      </div>`;
    $view.querySelector("#another").addEventListener("click", () => $picker.click());
  }

  function mergeDraft(a, b) {
    const r = { ...a };
    for (const k of Object.keys(b)) if (r[k] == null || r[k] === "") r[k] = b[k];
    r.controlNo = a.controlNo || b.controlNo;
    r.screenshots = b.screenshots?.length ? b.screenshots : a.screenshots;   // รูปรวมไฟล์เดียว
    r.foundFields = [...new Set([...(a.foundFields || []), ...(b.foundFields || [])])];
    r.unsureReasons = { ...(b.unsureReasons || {}), ...(a.unsureReasons || {}) };
    for (const k of Object.keys(r.unsureReasons)) if (a[k] != null && a[k] !== "" && !(a.unsureReasons || {})[k]) delete r.unsureReasons[k];
    r.rememberedFields = [...new Set([...(a.rememberedFields || []), ...(b.rememberedFields || [])])];
    r.rawText = (a.rawText || "") + "\n\n----------\n\n" + (b.rawText || "");
    r.paymentConfirmed = a.paymentConfirmed || b.paymentConfirmed;
    return r;
  }

  // รวมภาพหลายภาพเป็นรูปเดียว (เรียงซ้ายไปขวา) พร้อมแถบหัวบอก ID No. แล้วส่งออกเป็น JPEG
  async function combineImages(files, controlNo) {
    try {
      const imgs = await Promise.all(files.map(loadImage));
      const pad = 24, gap = 24, headH = 96;
      let h = Math.min(Math.max(...imgs.map((i) => i.height)), 1800);
      let widths = imgs.map((i) => Math.round(i.width * h / i.height));
      let W = pad * 2 + widths.reduce((a, b) => a + b, 0) + gap * (imgs.length - 1);
      const maxW = 8000;                       // กันรูปใหญ่เกินที่มือถือวาดได้
      if (W > maxW) {
        const k = (maxW - pad * 2 - gap * (imgs.length - 1)) / (W - pad * 2 - gap * (imgs.length - 1));
        h = Math.round(h * k); widths = widths.map((w) => Math.round(w * k));
        W = pad * 2 + widths.reduce((a, b) => a + b, 0) + gap * (imgs.length - 1);
      }
      const H = headH + pad + h + pad;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const g = c.getContext("2d");
      g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#16191D"; g.fillRect(0, 0, W, headH);
      g.fillStyle = "#FFFFFF"; g.textBaseline = "middle";
      g.font = "bold 44px Tahoma, 'Leelawadee UI', sans-serif";
      g.fillText("ID No. " + controlNo, pad, headH / 2);
      const idW = g.measureText("ID No. " + controlNo).width;
      g.fillStyle = "#B9BEC4"; g.font = "30px Tahoma, 'Leelawadee UI', sans-serif";
      g.fillText(`${dt(new Date().toISOString())}  ·  ${imgs.length} ภาพ`, pad + idW + 32, headH / 2 + 2);
      let x = pad;
      imgs.forEach((img, i) => {
        g.drawImage(img, x, headH + pad, widths[i], h);
        g.strokeStyle = "#E3E0D9"; g.lineWidth = 2; g.strokeRect(x, headH + pad, widths[i], h);
        x += widths[i] + gap;
      });
      imgs.forEach((i) => i.close?.());
      return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.9));
    } catch (e) {
      console.warn("รวมรูปไม่สำเร็จ", e);
      return null;
    }
  }

  async function loadImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file); } catch { /* ใช้วิธีสำรอง */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  /**
   * เตรียมภาพก่อนส่งไปอ่าน (OCR)
   *  - ภาพเล็กผิดปกติ (กว้างต่ำกว่า 700) ขยายให้กว้างราว 1050 px  (ภาพปกติใช้ต้นฉบับ อ่านได้ตรงกว่า ทดสอบแล้ว)
   *  - ถ้ามีบริเวณที่ระบายปากกาไฮไลต์ (เหลือง/เขียว/ชมพู) จะล้างสีพื้นให้เป็นขาว ตัวหนังสือยังดำอยู่
   *    ทำให้ข้อความที่ถูกไฮไลต์ไว้ เช่น ที่อยู่/ชื่อผู้รับ อ่านออก ไม่ถูกสีกลืน
   */
  async function preprocessForOcr(file) {
    try {
      const img = await loadImage(file);
      const w0 = img.width, h0 = img.height;
      if (!w0 || !h0) return file;
      // วัดผลแล้ว: ภาพกว้าง 700 px ขึ้นไป ขยายแล้วอ่านแย่ลง (ชื่อรุ่นเพี้ยน) จึงขยายเฉพาะภาพที่เล็กจริง ๆ
      const k = w0 < 700 ? Math.min(3, 1050 / w0) : 1;
      const W = Math.round(w0 * k), H = Math.round(h0 * k);
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, W, H);
      img.close?.();

      const changed = clearHighlighter(g, W, H);
      if (k === 1 && !changed) return file;                  // ไม่ต้องแปลงอะไรเลย ใช้ไฟล์เดิม
      const blob = await new Promise((res) => c.toBlob(res, "image/png"));
      if (!blob || blob.size > 18 * 1024 * 1024) return file;
      return new File([blob], (file.name || "shot").replace(/\.\w+$/, "") + "-ocr.png", { type: "image/png" });
    } catch (e) {
      console.warn("เตรียมภาพก่อนอ่านไม่สำเร็จ ใช้ภาพต้นฉบับแทน", e);
      return file;
    }
  }

  /**
   * ล้างสีปากกาไฮไลต์ออกให้เป็นพื้นขาว โดยดูเป็นช่อง ๆ (16x16 px)
   * ช่องไหนมีสีสดจัดเกินครึ่งช่อง = เป็นแถบไฮไลต์ ค่อยล้างเฉพาะช่องนั้น
   * (ตัวหนังสือสีแดง/เขียวบาง ๆ จะไม่ถูกล้าง เพราะสีไม่เต็มช่อง)
   */
  function clearHighlighter(g, W, H) {
    const cell = 16;
    const cx = Math.ceil(W / cell), cy = Math.ceil(H / cell);
    const hits = new Int32Array(cx * cy);
    const d = g.getImageData(0, 0, W, H);
    const px = d.data;
    const isHi = (i) => {
      const r = px[i], gr = px[i + 1], b = px[i + 2];
      const mx = Math.max(r, gr, b), mn = Math.min(r, gr, b);
      return mx > 185 && mx - mn > 60;      // สว่างและสีสดจัด = ปากกาไฮไลต์
    };
    for (let y = 0; y < H; y++) {
      const cyi = ((y / cell) | 0) * cx;
      for (let x = 0; x < W; x++) {
        if (isHi((y * W + x) * 4)) hits[cyi + ((x / cell) | 0)]++;
      }
    }
    const need = cell * cell * 0.5;
    let cells = 0;
    for (let i = 0; i < hits.length; i++) if (hits[i] > need) cells++;
    const frac = cells / hits.length;
    if (frac < 0.002 || frac > 0.5) return false;             // ไม่มีไฮไลต์ หรือทั้งภาพเป็นสี ไม่ต้องยุ่ง

    for (let y = 0; y < H; y++) {
      const cyi = ((y / cell) | 0) * cx;
      for (let x = 0; x < W; x++) {
        if (hits[cyi + ((x / cell) | 0)] <= need) continue;
        const i = (y * W + x) * 4;
        if (isHi(i)) { px[i] = px[i + 1] = px[i + 2] = 255; }  // พื้นไฮไลต์ -> ขาว
        else {
          // ตัวหนังสือบนไฮไลต์: ทำให้เป็นโทนเทาเข้ม อ่านง่ายขึ้น
          const v = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
          px[i] = px[i + 1] = px[i + 2] = v < 150 ? Math.max(0, v - 40) : v;
        }
      }
    }
    g.putImageData(d, 0, 0);
    return true;
  }

  // เลขพัสดุใช้เลขศูนย์ 0 เสมอ ไม่ใช้ตัวอักษร O (ทั้งที่อ่านจากภาพและที่พิมพ์เอง)
  // ตัด O→0 เฉพาะส่วนที่เป็นตัวเลข (เลขของ Lazada ขึ้นต้น LEXDO… ไม่ถูกแก้ผิด)
  const fixTracking = (v) => window.PTParser.fixTracking(v || "");

  // ---------- อ่าน QR / บาร์โค้ดจากรูปถ่ายกล่องพัสดุ ----------
  // รูปถ่ายกล่องทั้งใบ โค้ดจะเล็กมากเมื่อเทียบกับทั้งภาพ อ่านทั้งรูปทีเดียวมักไม่ออก
  // ขั้นตอน: หาพื้นที่ที่น่าจะเป็นโค้ดก่อน -> ซูมเข้าไปเฉพาะบริเวณนั้น -> ค่อยอ่าน
  let readerHostEl = null;
  function readerHostId() {
    if (!readerHostEl) {
      readerHostEl = document.createElement("div");
      readerHostEl.id = "codeReaderHost";
      readerHostEl.style.cssText = "position:fixed;left:-10000px;top:0;width:8px;height:8px;overflow:hidden";
      document.body.appendChild(readerHostEl);
    }
    return readerHostEl.id;
  }

  async function decodeCanvas(canvas) {
    if (!window.Html5Qrcode) return null;
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    if (!blob) return null;
    let inst = null;
    try {
      inst = new Html5Qrcode(readerHostId(), { verbose: false });
      const text = await inst.scanFile(new File([blob], "code.png", { type: "image/png" }), false);
      return text || null;
    } catch { return null; }
    finally { try { inst?.clear(); } catch { /* ignore */ } }
  }

  /** ครอปบริเวณที่สนใจแล้วขยายให้ใหญ่ขึ้น (ซูม) */
  function cropZoom(src, r, outW) {
    const k = Math.min(4, Math.max(1, outW / r.w));
    const c = document.createElement("canvas");
    c.width = Math.round(r.w * k); c.height = Math.round(r.h * k);
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    return c;
  }

  /** ปรับภาพให้โค้ดเด่นขึ้น: ไฮไลต์เหลือง/พื้นสีจะกลายเป็นขาว เส้นบาร์โค้ดกลายเป็นดำ */
  function boostCode(src) {
    const c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(src, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      // ใช้ค่าสูงสุดของแดง/เขียว: ปากกาไฮไลต์สีเหลืองจะสว่างเท่ากระดาษขาว แต่เส้นดำยังดำอยู่
      let v = Math.max(px[i], px[i + 1]);
      v = v < 105 ? 0 : v > 165 ? 255 : (v - 105) * (255 / 60);
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    g.putImageData(d, 0, 0);
    return c;
  }

  function rotateCanvas(src, deg) {
    const c = document.createElement("canvas");
    const swap = deg === 90 || deg === 270;
    c.width = swap ? src.height : src.width;
    c.height = swap ? src.width : src.height;
    const g = c.getContext("2d");
    g.translate(c.width / 2, c.height / 2);
    g.rotate((deg * Math.PI) / 180);
    g.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  }

  /**
   * หาพื้นที่ที่น่าจะเป็น QR / บาร์โค้ด
   * โค้ดคือบริเวณที่มีเส้นขอบถี่มากผิดปกติ จึงวัด "ความหนาแน่นของขอบ" แล้วเลือกกรอบที่เข้มที่สุด
   */
  function findCodeRegions(base) {
    const W = base.width, H = base.height;
    const sw = 300, sh = Math.max(40, Math.round((H * sw) / W));
    const sc = document.createElement("canvas");
    sc.width = sw; sc.height = sh;
    const g = sc.getContext("2d", { willReadFrequently: true });
    g.drawImage(base, 0, 0, sw, sh);
    const im = g.getImageData(0, 0, sw, sh).data;

    const gray = new Float32Array(sw * sh);
    for (let i = 0, p = 0; i < im.length; i += 4, p++) gray[p] = Math.max(im[i], im[i + 1], im[i + 2]);

    // นับจุดที่เป็น "ขอบคม" ทั้งแนวตั้งและแนวนอน
    const edge = new Float32Array(sw * sh);
    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        const i = y * sw + x;
        const gx = Math.abs(gray[i + 1] - gray[i - 1]);
        const gy = Math.abs(gray[i + sw] - gray[i - sw]);
        edge[i] = gx > 45 || gy > 45 ? 1 : 0;
      }
    }
    // integral image เพื่อคิดผลรวมในกรอบได้เร็ว
    const ii = new Float32Array((sw + 1) * (sh + 1));
    for (let y = 0; y < sh; y++) {
      let row = 0;
      for (let x = 0; x < sw; x++) {
        row += edge[y * sw + x];
        ii[(y + 1) * (sw + 1) + (x + 1)] = ii[y * (sw + 1) + (x + 1)] + row;
      }
    }
    const sum = (x, y, w, h) =>
      ii[(y + h) * (sw + 1) + (x + w)] - ii[y * (sw + 1) + (x + w)] - ii[(y + h) * (sw + 1) + x] + ii[y * (sw + 1) + x];

    const cands = [];
    for (const frac of [0.5, 0.34, 0.22, 0.14]) {
      const bw = Math.round(sw * frac), bh = Math.round(bw * 0.8);
      if (bw < 12 || bh < 12 || bw > sw || bh > sh) continue;
      const step = Math.max(4, Math.round(bw / 3));
      for (let y = 0; y + bh <= sh; y += step) {
        for (let x = 0; x + bw <= sw; x += step) {
          const density = sum(x, y, bw, bh) / (bw * bh);
          if (density > 0.06) cands.push({ x, y, w: bw, h: bh, score: density });
        }
      }
    }
    cands.sort((a, b) => b.score - a.score);

    // ตัดกรอบที่ทับกันออก เหลือบริเวณเด่น ๆ ไม่กี่จุด
    const picked = [];
    const overlap = (a, b) => {
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      return (ix * iy) / Math.min(a.w * a.h, b.w * b.h);
    };
    for (const c of cands) {
      if (picked.length >= 5) break;
      if (picked.some((p) => overlap(p, c) > 0.3)) continue;
      picked.push(c);
    }

    // ขยายกรอบเผื่อขอบ แล้วแปลงกลับไปเป็นพิกัดของภาพจริง
    const kx = W / sw, ky = H / sh;
    return picked.map((c) => {
      const padX = c.w * 0.18, padY = c.h * 0.25;
      const x = Math.max(0, (c.x - padX) * kx), y = Math.max(0, (c.y - padY) * ky);
      const w = Math.min(W - x, (c.w + padX * 2) * kx), h = Math.min(H - y, (c.h + padY * 2) * ky);
      return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), score: c.score };
    });
  }

  /**
   * อ่านโค้ดจากรูปถ่าย 1 ใบ: ลองทั้งภาพก่อน ถ้าไม่ได้ค่อยหาพื้นที่โค้ดแล้วซูมเข้าไปอ่านทีละจุด
   * คืนค่า { text, preview } โดย preview คือภาพบริเวณที่ซูมเข้าไปอ่านได้
   */
  async function decodeFromPhoto(file, onStep, opt = {}) {
    const img = await loadImage(file);
    const maxSide = 2600;
    const k = Math.min(1, maxSide / Math.max(img.width, img.height));
    const base = document.createElement("canvas");
    base.width = Math.round(img.width * k); base.height = Math.round(img.height * k);
    base.getContext("2d").drawImage(img, 0, 0, base.width, base.height);
    img.close?.();

    // 1) ถ้าเบราว์เซอร์มีตัวอ่านโค้ดในตัว (Android/Chrome) ใช้ก่อน เร็วและแม่น
    if (window.BarcodeDetector) {
      try {
        onStep?.("กำลังค้นหาโค้ดในรูป…");
        const found = await new BarcodeDetector().detect(base);
        if (found.length) {
          const b = found[0].boundingBox;
          const r = { x: Math.max(0, b.x - b.width * .15), y: Math.max(0, b.y - b.height * .3), w: b.width * 1.3, h: b.height * 1.6 };
          return { text: found[0].rawValue, preview: cropZoom(base, r, 700).toDataURL("image/jpeg", .75) };
        }
      } catch { /* เบราว์เซอร์ไม่รองรับรูปแบบนี้ */ }
    }

    // 2) ลองอ่านทั้งภาพ (กรณีถ่ายใกล้ ๆ เห็นโค้ดเต็มจอ)
    onStep?.("กำลังอ่านทั้งรูป…");
    let text = await decodeCanvas(base);
    if (text) return { text, preview: null };

    // 3) หาพื้นที่โค้ดแล้วซูมเข้าไปอ่านทีละจุด
    const regions = findCodeRegions(base).slice(0, opt.maxRegions || 5);
    for (let i = 0; i < regions.length; i++) {
      onStep?.(`ซูมอ่านบริเวณที่พบโค้ด (${i + 1}/${regions.length})…`);
      const zoom = cropZoom(base, regions[i], 1100);
      const tries = [zoom, boostCode(zoom)];
      if (i < 2 && !opt.quick) tries.push(rotateCanvas(zoom, 90));
      for (const c of tries) {
        text = await decodeCanvas(c);
        if (text) return { text, preview: zoom.toDataURL("image/jpeg", .75) };
      }
    }
    if (opt.quick) return null;

    // 4) ทางสุดท้าย: แบ่งภาพเป็น 4 ส่วนซ้อนกันแล้วซูมอ่าน
    onStep?.("ซูมอ่านทีละส่วนของรูป…");
    const halves = [
      { x: 0, y: 0, w: base.width * .62, h: base.height * .62 },
      { x: base.width * .38, y: 0, w: base.width * .62, h: base.height * .62 },
      { x: 0, y: base.height * .38, w: base.width * .62, h: base.height * .62 },
      { x: base.width * .38, y: base.height * .38, w: base.width * .62, h: base.height * .62 },
    ];
    for (const r of halves) {
      const zoom = cropZoom(base, r, 1100);
      text = (await decodeCanvas(zoom)) || (await decodeCanvas(boostCode(zoom)));
      if (text) return { text, preview: zoom.toDataURL("image/jpeg", .75) };
    }
    return null;
  }

  /** กล่องสถานะระหว่างค้นหา/ซูมอ่านโค้ดจากรูป */
  function showScanBusy() {
    const el = document.createElement("div");
    el.className = "scan-busy";
    el.innerHTML = '<div class="sb-card"><div class="spinner"></div><div class="sb-text">กำลังอ่านรูป…</div></div>';
    document.body.appendChild(el);
    return {
      step: (t) => { const x = el.querySelector(".sb-text"); if (x) x.textContent = t; },
      close: () => el.remove(),
    };
  }

  // ---------- แชร์รายการที่เลือก เข้าไลน์ / แอปอื่น ----------
  const LINE_TEXT_URL = "https://line.me/R/msg/text/?";

  function shareSummary(orders) {
    const lines = orders.map((o, i) =>
      `${i + 1}) ${o.controlNo ? o.controlNo + " · " : ""}${o.productName}${o.variant ? " (" + o.variant + ")" : ""}` +
      `\n   ${money(o.totalAmount)} · ${o.carrier || "ไม่ระบุขนส่ง"} ${o.trackingNumber || ""}` +
      ` · ${o.status === "Received" ? "ได้รับแล้ว" : "รอของมาส่ง"}`);
    const total = orders.reduce((a, o) => a + (o.totalAmount || 0), 0);
    return `ParcelTrack · ${orders.length} รายการ\n\n${lines.join("\n")}\n\nรวมทั้งหมด ${money(total)}`;
  }

  async function blobsForOrders(orders, ids) {
    const files = [];
    // ไฟล์ Excel เฉพาะรายการที่เลือก
    try {
      const res = await fetch("/api/share/selected.xlsx", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        const blob = await res.blob();
        files.push(new File([blob], `ParcelTrack-${orders.length}-orders.xlsx`,
          { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      }
    } catch { /* ไม่มีไฟล์ Excel ก็แชร์รูปอย่างเดียว */ }

    // รูปรวมภาพหน้าจอของแต่ละรายการ
    for (const o of orders) {
      for (const shot of o.screenshots || []) {
        try {
          const res = await fetch(imgUrl(shot));
          if (!res.ok) continue;
          const blob = await res.blob();
          files.push(new File([blob], shot, { type: blob.type || "image/jpeg" }));
        } catch { /* ข้ามรูปที่โหลดไม่ได้ */ }
      }
    }
    return files;
  }

  async function shareOrders(ids) {
    if (!ids.length) return toast("ยังไม่ได้เลือกรายการ", true);
    const busy = showScanBusy();
    busy.step(`กำลังเตรียมไฟล์ ${ids.length} รายการ…`);
    try {
      const all = await api("/orders");
      const orders = ids.map((id) => all.find((o) => o.id === id)).filter(Boolean);
      const text = shareSummary(orders);
      let files = await blobsForOrders(orders, ids);
      const imgCount = files.filter((f) => f.type.startsWith("image/")).length;

      // รูปเยอะ ๆ ส่งเป็นไฟล์เดียว (.zip) จะเสถียรกว่า
      if (imgCount > 8) {
        const res = await fetch("/api/share/bundle.zip", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
        });
        if (res.ok) files = [new File([await res.blob()], `ParcelTrack-${orders.length}-orders.zip`, { type: "application/zip" })];
      }
      busy.close();

      // มือถือ: เปิดแผงแชร์ของเครื่อง แล้วเลือก LINE ได้เลย (ต้องเปิดผ่าน https)
      if (navigator.canShare?.({ files }) && navigator.share) {
        try {
          await navigator.share({ files, text, title: "ParcelTrack" });
          return toast("ส่งไฟล์เรียบร้อย");
        } catch (e) {
          if (e?.name === "AbortError") return;     // ผู้ใช้กดยกเลิกเอง
        }
      }
      shareFallbackSheet(orders, ids, text, files);
    } catch (e) {
      busy.close();
      toast("เตรียมไฟล์ไม่สำเร็จ: " + (e?.message || e), true);
    }
  }

  /** เครื่องที่แชร์ไฟล์ตรง ๆ ไม่ได้ (คอม หรือมือถือที่เปิดผ่าน http) */
  function shareFallbackSheet(orders, ids, text, files) {
    closeSheet();
    const httpsHint = !window.isSecureContext && appInfo?.httpsPort && location.protocol === "http:" && location.hostname !== "localhost"
      ? `<div class="share-note">${I.alert}<span>ถ้าอยากส่งเข้าไลน์ได้ในคลิกเดียวจากมือถือ ให้เปิดแอปผ่านลิงก์ https
           <a href="https://${location.hostname}:${appInfo.httpsPort}/#/orders">เปิดแบบ https →</a></span></div>` : "";
    const wrap = document.createElement("div");
    wrap.className = "sheet-backdrop";
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><span class="grab"></span>
      <div class="sheet-head"><span class="dot">${I.share}</span>
        <div><h2>แชร์ ${orders.length} รายการเข้าไลน์</h2><p>ไฟล์ Excel + รูปรวมภาพหน้าจอ</p></div></div>
      <button class="btn primary block" data-act="zip">${I.excel}ดาวน์โหลดไฟล์ทั้งหมด (.zip)</button>
      <a class="btn block" data-act="line" href="${LINE_TEXT_URL}${encodeURIComponent(text)}" target="_blank" rel="noopener">${I.chat}เปิดไลน์พร้อมข้อความสรุป</a>
      <button class="btn block" data-act="copy">${I.copy}คัดลอกข้อความสรุป</button>
      <div class="share-note">${I.alert}<span>บนคอม: กดดาวน์โหลด .zip แล้วลากไฟล์เข้าห้องแชทไลน์ได้เลย</span></div>
      ${httpsHint}
      <button class="btn block" data-act="close" style="border:0">ปิด</button>
    </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act && e.target !== wrap) return;
      if (act === "zip") {
        const res = await fetch("/api/share/bundle.zip", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
        });
        if (!res.ok) return toast("สร้างไฟล์ไม่สำเร็จ", true);
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = `ParcelTrack-${orders.length}-orders-${ymd(new Date())}.zip`;
        a.rel = "noopener";
        document.body.appendChild(a);          // ต้องอยู่ในหน้าเว็บจริง ชื่อไฟล์ถึงจะถูกใช้
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 8000);
        toast("ดาวน์โหลดแล้ว ลากไฟล์เข้าห้องแชทไลน์ได้เลย");
      } else if (act === "copy") {
        copyText(text);
      } else if (act === "close" || e.target === wrap) {
        closeSheet();
      }
    });
  }

  /** ผูกปุ่ม "บรรทัดที่อ่านได้" ให้แตะแล้วใส่ลงช่องที่กำลังแก้อยู่ */
  function bindOcrLines(f) {
    $view.querySelectorAll(".ocr-line:not([data-bound])").forEach((b) => {
      b.dataset.bound = "1";
      b.addEventListener("mousedown", (e) => e.preventDefault());   // กันไม่ให้ช่องที่เลือกไว้หลุดโฟกัส
      b.addEventListener("click", () => {
        const text = b.dataset.t;
        const el = f.querySelector(".fld-active");
        if (!el) { copyText(text); return toast("แตะช่องที่ต้องการก่อน แล้วค่อยแตะบรรทัด (คัดลอกไว้ให้แล้ว)"); }
        el.value = el.type === "number" ? (text.match(/\d+/)?.[0] ?? text) : text;
        el.classList.remove("missing");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.focus();
        renderWarnings(f);
        toast("ใส่ข้อความลงช่องแล้ว");
      });
    });
  }

  const THAI_MONTH_ABBR = { "ม.ค.": 1, "ก.พ.": 2, "มี.ค.": 3, "เม.ย.": 4, "พ.ค.": 5, "มิ.ย.": 6, "ก.ค.": 7, "ส.ค.": 8, "ก.ย.": 9, "ต.ค.": 10, "พ.ย.": 11, "ธ.ค.": 12 };

  /** แปลงข้อความที่อ่านได้ ให้อยู่ในรูปแบบของช่องนั้น ๆ */
  function valueForField(field, raw) {
    const t = (raw || "").trim();
    if (field === "trackingNumber" || field === "orderNumber" || field === "referenceNumber") {
      // ช่องรหัส: ต้องเจอกลุ่มตัวอักษร/ตัวเลขจริง ๆ ถ้าไม่เจอถือว่าเลือกกรอบผิด
      const tok = (t.toUpperCase().match(/[A-Z0-9][A-Z0-9-]{5,}/g) || []).sort((a, b) => b.length - a.length)[0];
      if (!tok) return "";
      return field === "trackingNumber" ? fixTracking(tok) : tok.replace(/\s+/g, "");
    }
    if (field === "totalAmount") {
      const nums = t.replace(/[฿B]/g, "").match(/\d[\d,]*\.\d{2}|\d[\d,]*/g) || [];
      const pick = nums.sort((a, b) => b.replace(/\D/g, "").length - a.replace(/\D/g, "").length)[0];
      return pick ? pick.replace(/,/g, "") : t;
    }
    if (field === "quantity") return (t.match(/\d{1,3}/) || ["1"])[0];
    if (field === "cardNumber") return (t.match(/\d{4}(?!.*\d{4})/) || [t])[0];
    if (field === "orderedAt") {
      let m = t.match(/(\d{1,2})\s*([ก-ฮ]{1,2}\.[ก-ฮ]\.)\s*(\d{4})(?:\s+(\d{1,2})[:.](\d{2}))?/);
      if (m && THAI_MONTH_ABBR[m[2]]) {
        let y = +m[3]; if (y > 2400) y -= 543;
        return `${y}-${String(THAI_MONTH_ABBR[m[2]]).padStart(2, "0")}-${m[1].padStart(2, "0")}T${(m[4] || "00").padStart(2, "0")}:${m[5] || "00"}`;
      }
      m = t.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2})[:.](\d{2}))?/);
      if (m) {
        let y = +m[3]; if (y > 2400) y -= 543;
        return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T${(m[4] || "00").padStart(2, "0")}:${m[5] || "00"}`;
      }
      return "";
    }
    return t;
  }

  /** แตกข้อความที่อ่านได้เป็นตัวเลือกย่อย ๆ เช่น ตัดคำนำหน้า "หมายเลขพัสดุ:" ออก */
  function cropCandidates(texts, field) {
    const out = new Set();
    for (const t of texts) {
      if (!t) continue;
      out.add(t.trim());
      const after = t.split(/[:：]/).slice(1).join(":").trim();
      if (after.length >= 2) out.add(after);
      t.split(/\s{2,}|\n/).forEach((part) => { const x = part.trim(); if (x.length >= 2) out.add(x); });
    }
    const list = [...out].filter(Boolean);
    const suggested = list.map((t) => valueForField(field, t)).find((v) => v && v.length >= 2);
    if (suggested && !list.includes(suggested)) list.unshift(suggested);
    return list.slice(0, 8);
  }

  // ---------- เครื่องมือช่วยให้อ่านครบและตรง ----------
  const FIELD_LABELS = {
    productName: "ชื่อสินค้า", variant: "ตัวเลือก", quantity: "จำนวน", shopName: "ร้านค้า",
    orderNumber: "หมายเลขคำสั่งซื้อ", referenceNumber: "หมายเลขอ้างอิง", orderedAt: "วันที่สั่งซื้อ",
    totalAmount: "ยอดชำระสุทธิ", paymentMethod: "วิธีชำระเงิน", cardNumber: "เลขบัตร",
    trackingNumber: "เลขพัสดุ", carrier: "บริษัทขนส่ง", recipientName: "ชื่อผู้รับ",
    shippingAddress: "ที่อยู่ในการจัดส่ง", note: "หมายเหตุ",
  };

  /** ภาพต้นทางของรายการนี้ ใช้ทั้งอ่านซ้ำและลากกรอบ */
  async function sourceImages(d) {
    if (session?.files?.length) return session.files;            // เพิ่งอ่านมา ยังมีไฟล์ต้นฉบับอยู่
    const shot = (d.screenshots || [])[0];
    if (!shot) return [];
    try {
      const blob = await (await fetch(imgUrl(shot, Date.now()))).blob();
      return [new File([blob], shot, { type: blob.type || "image/jpeg" })];
    } catch { return []; }
  }

  /** ตรวจค่าที่กรอกอยู่ว่ามีช่องไหนน่าสงสัย ควรเช็กกับรูปอีกรอบ */
  function fieldWarnings(v) {
    const w = [];
    const num = (x) => parseFloat(String(x || "").replace(/[฿,\s]/g, ""));
    const name = (v.productName || "").trim();
    if (!name) w.push(["productName", "ยังไม่มีชื่อสินค้า"]);
    else if (name.length < 5) w.push(["productName", "ชื่อสินค้าสั้นผิดปกติ"]);
    else if ((name.match(/[A-Za-zก-๙0-9]/g) || []).length / name.length < 0.5)
      w.push(["productName", "ชื่อสินค้ามีอักขระแปลกปนมาก อาจอ่านเพี้ยน"]);

    const total = num(v.totalAmount);
    if (!v.totalAmount) w.push(["totalAmount", "ยังไม่มียอดชำระสุทธิ"]);
    else if (!(total > 0)) w.push(["totalAmount", "ยอดชำระต้องมากกว่า 0"]);
    else if (total > 1000000) w.push(["totalAmount", "ยอดชำระสูงผิดปกติ ลองเทียบกับรูป"]);

    const tk = (v.trackingNumber || "").trim();
    if (!tk) w.push(["trackingNumber", "ยังไม่มีเลขพัสดุ (ใช้จับคู่ตอนยิง QR)"]);
    else if (tk.length < 8) w.push(["trackingNumber", "เลขพัสดุสั้นผิดปกติ (" + tk.length + " ตัว)"]);
    else if (/[^A-Z0-9-]/.test(tk)) w.push(["trackingNumber", "เลขพัสดุมีอักขระที่ไม่ใช่ตัวเลข/ตัวอักษร"]);

    const q = parseInt(v.quantity, 10);
    if (q > 50) w.push(["quantity", "จำนวนมากผิดปกติ ลองเทียบกับ X1 ข้างราคา"]);

    if (v.orderedAt) {
      const t = new Date(v.orderedAt).getTime();
      if (t > Date.now() + 864e5) w.push(["orderedAt", "วันที่สั่งซื้อเป็นอนาคต"]);
      if (t < Date.now() - 3 * 365 * 864e5) w.push(["orderedAt", "วันที่สั่งซื้อเก่ากว่า 3 ปี"]);
    } else w.push(["orderedAt", "ยังไม่มีวันที่สั่งซื้อ"]);

    if (!v.carrier) w.push(["carrier", "ยังไม่มีบริษัทขนส่ง"]);
    if (!v.recipientName) w.push(["recipientName", "ยังไม่มีชื่อผู้รับ"]);
    if (!v.shippingAddress) w.push(["shippingAddress", "ยังไม่มีที่อยู่ในการจัดส่ง"]);
    return w;
  }

  function renderWarnings(f) {
    const box = f.querySelector("#warnBox") || document.querySelector("#warnBox");
    if (!box) return;
    const v = {};
    f.querySelectorAll("[name]").forEach((el) => { v[el.name] = el.type === "checkbox" ? el.checked : el.value; });
    const w = fieldWarnings(v);
    f.querySelectorAll(".unsure[data-why]").forEach((el) => {
      if (!w.some(([n]) => n === el.name)) w.unshift([el.name, el.dataset.why + " — เทียบกับรูปอีกครั้ง"]);
    });
    if (!w.length) {
      box.innerHTML = `<div class="warn-ok">${I.check}ตรวจแล้ว ช่องสำคัญครบและดูสมเหตุสมผล</div>`;
      return;
    }
    box.innerHTML = `<div class="warn-list">
      <div class="warn-head">${I.alert}ควรตรวจอีกครั้ง ${w.length} ช่อง</div>
      ${w.map(([field, msg]) => `<button type="button" class="warn-item" data-field="${field}">
        <b>${esc(FIELD_LABELS[field] || field)}</b><span>${esc(msg)}</span></button>`).join("")}
    </div>`;
    box.querySelectorAll("[data-field]").forEach((b) => b.addEventListener("click", () => {
      const el = f.querySelector(`[name=${b.dataset.field}]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.focus();
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1200);
    }));
  }

  /** อ่านซ้ำแบบละเอียด: ส่งภาพเดิมไปอ่านหลายโหมด แล้วเติมเฉพาะช่องที่ยังว่าง */
  async function deepRead(d, f) {
    const files = await sourceImages(d);
    if (!files.length) return toast("ไม่พบภาพต้นฉบับของรายการนี้", true);
    const busy = showScanBusy();
    busy.step(`กำลังอ่านซ้ำแบบละเอียด ${files.length} ภาพ…\nใช้เวลามากกว่าปกติ 2-3 เท่า`);
    try {
      const fd = new FormData();
      files.forEach((file, i) => fd.append("files", file, file.name || `shot-${i + 1}.png`));
      const r = await api("/ocr/read", { method: "POST", body: fd });
      busy.close();

      const filled = [];
      const put = (nameAttr, val) => {
        const el = f.querySelector(`[name=${nameAttr}]`);
        if (!el || val == null || val === "" || el.value.trim()) return;
        el.value = nameAttr === "totalAmount" ? Number(val).toFixed(2)
          : nameAttr === "orderedAt" ? String(val).slice(0, 16) : val;
        el.classList.remove("missing");
        filled.push(FIELD_LABELS[nameAttr] || nameAttr);
      };
      put("productName", r.productName); put("variant", r.variant); put("shopName", r.shopName);
      put("quantity", r.quantity); put("orderNumber", r.orderNumber); put("referenceNumber", r.referenceNumber);
      put("trackingNumber", fixTracking(r.trackingNumber)); put("carrier", r.carrier);
      put("recipientName", r.recipientName); put("shippingAddress", r.shippingAddress);
      put("totalAmount", r.totalAmount); put("paymentMethod", r.paymentMethod); put("orderedAt", r.orderedAt);

      // เติมบรรทัดที่อ่านได้เพิ่ม ให้เลือกแตะใส่ช่องได้มากขึ้น
      const box = $view.querySelector(".ocr-lines");
      if (box && r.rawLines?.length) {
        const have = new Set([...box.querySelectorAll(".ocr-line")].map((b) => b.dataset.t));
        const extra = r.rawLines.filter((l) => !have.has(l));
        box.insertAdjacentHTML("beforeend", extra.map((l) => `<button type="button" class="ocr-line new" data-t="${esc(l)}">${esc(l)}</button>`).join(""));
        bindOcrLines(f);
        if (extra.length) toast(`เพิ่มบรรทัดที่อ่านได้อีก ${extra.length} บรรทัด`);
      }
      renderWarnings(f);
      toast(filled.length ? "เติมให้แล้ว: " + filled.join(", ") : "อ่านซ้ำแล้ว ไม่มีช่องว่างที่เติมเพิ่มได้");
    } catch (e) {
      busy.close();
      toast("อ่านซ้ำไม่สำเร็จ: " + (e?.message || e), true);
    }
  }

  /** ลากกรอบบนรูปเพื่ออ่านเฉพาะบริเวณนั้น แล้วใส่ลงช่องที่เลือก */
  async function cropRead(d, f) {
    const files = await sourceImages(d);
    if (!files.length) return toast("ไม่พบภาพต้นฉบับของรายการนี้", true);
    const img = await loadImage(files[0]);
    const W = img.width, H = img.height;

    const wrap = document.createElement("div");
    wrap.className = "crop-overlay";
    wrap.innerHTML = `
      <div class="crop-top">
        <b>ลากกรอบคลุมข้อความที่ต้องการ</b>
        <button type="button" class="icon-btn" data-x="close" aria-label="ปิด">${I.close}</button>
      </div>
      <div class="crop-stage"><canvas id="cropCanvas"></canvas><div class="crop-box" hidden></div></div>
      <div class="crop-foot">
        <select id="cropField">${Object.entries(FIELD_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <button type="button" class="btn primary" data-x="read" disabled>${I.search}อ่านข้อความในกรอบ</button>
      </div>
      <div class="crop-result" hidden></div>`;
    document.body.appendChild(wrap);

    const canvas = wrap.querySelector("#cropCanvas");
    const stage = wrap.querySelector(".crop-stage");
    const box = wrap.querySelector(".crop-box");
    const readBtn = wrap.querySelector("[data-x=read]");
    const fieldSel = wrap.querySelector("#cropField");
    const lastFocused = f.querySelector(".fld-active");
    if (lastFocused?.name && FIELD_LABELS[lastFocused.name]) fieldSel.value = lastFocused.name;

    canvas.width = W; canvas.height = H;
    canvas.getContext("2d").drawImage(img, 0, 0);
    img.close?.();

    let sx = 0, sy = 0, sel = null, dragging = false;
    const pos = (e) => {
      const t = e.touches?.[0] || e;
      const r = canvas.getBoundingClientRect();
      return { x: (t.clientX - r.left) / r.width, y: (t.clientY - r.top) / r.height };
    };
    const paint = () => {
      if (!sel) return box.setAttribute("hidden", "");
      const r = canvas.getBoundingClientRect(), s = stage.getBoundingClientRect();
      box.removeAttribute("hidden");
      // กรอบอยู่ในพื้นที่ที่เลื่อนได้ (crop-stage) ต้องบวกระยะที่เลื่อนไปแล้ว ไม่งั้นกรอบจะเพี้ยนจากจุดที่ลาก
      box.style.left = (r.left - s.left + stage.scrollLeft + sel.x * r.width) + "px";
      box.style.top = (r.top - s.top + stage.scrollTop + sel.y * r.height) + "px";
      box.style.width = sel.w * r.width + "px";
      box.style.height = sel.h * r.height + "px";
    };
    const start = (e) => { e.preventDefault(); const p = pos(e); sx = p.x; sy = p.y; dragging = true; sel = null; paint(); };
    const move = (e) => {
      if (!dragging) return;
      e.preventDefault();
      const p = pos(e);
      sel = { x: Math.min(sx, p.x), y: Math.min(sy, p.y), w: Math.abs(p.x - sx), h: Math.abs(p.y - sy) };
      readBtn.disabled = sel.w * W < 12 || sel.h * H < 8;
      paint();
    };
    const end = () => { dragging = false; };
    stage.addEventListener("scroll", paint);      // เลื่อนดูส่วนอื่นของรูป กรอบต้องขยับตาม
    canvas.addEventListener("mousedown", start); canvas.addEventListener("touchstart", start, { passive: false });
    window.addEventListener("mousemove", move); canvas.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("mouseup", end); canvas.addEventListener("touchend", end);
    window.addEventListener("resize", paint);

    const close = () => {
      stage.removeEventListener("scroll", paint);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("resize", paint);
      wrap.remove();
    };

    wrap.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-x]")?.dataset.x;
      if (act === "close") return close();
      if (act !== "read" || !sel) return;
      const rx = Math.max(0, Math.round(sel.x * W) - 6), ry = Math.max(0, Math.round(sel.y * H) - 6);
      const rw = Math.min(W - rx, Math.round(sel.w * W) + 12), rh = Math.min(H - ry, Math.round(sel.h * H) + 12);
      const zoom = cropZoom(canvas, { x: rx, y: ry, w: rw, h: rh }, Math.min(1600, Math.max(700, rw * 3)));
      const clean = boostCode(zoom);   // ล้างพื้นสี/ไฮไลต์ ให้ตัวหนังสือคมขึ้น
      const busy = showScanBusy();
      busy.step("กำลังอ่านข้อความในกรอบ…");
      try {
        const blob = await new Promise((res) => zoom.toBlob(res, "image/png"));
        const CODE_FIELDS = ["trackingNumber", "orderNumber", "referenceNumber", "totalAmount", "quantity", "cardNumber"];
        const mode = CODE_FIELDS.includes(fieldSel.value) ? "code" : "text";
        const fd = new FormData();
        fd.append("crop", new File([blob], "crop.png", { type: "image/png" }));
        fd.append("mode", mode);
        let r = await api("/ocr/crop", { method: "POST", body: fd });
        if (!r.text) {
          const blob2 = await new Promise((res) => clean.toBlob(res, "image/png"));
          const fd2 = new FormData();
          fd2.append("crop", new File([blob2], "crop.png", { type: "image/png" }));
          fd2.append("mode", mode);
          r = await api("/ocr/crop", { method: "POST", body: fd2 });
        }
        busy.close();
        const res = wrap.querySelector(".crop-result");
        if (!r.text) {
          res.hidden = false;
          res.innerHTML = `<div class="cr-empty">อ่านไม่ออก ลองลากกรอบให้ชิดข้อความมากขึ้น หรือคลุมทีละบรรทัด</div>`;
          return;
        }
        const cands = cropCandidates(r.options || [r.text], fieldSel.value);
        res.hidden = false;
        res.innerHTML = `
          <div class="cr-head">อ่านได้ — แตะข้อความที่ถูกต้อง เพื่อใส่ลงช่อง "<b>${esc(FIELD_LABELS[fieldSel.value])}</b>"</div>
          <div class="cr-options">${cands.map((t, i) => `<button type="button" class="cr-opt${i === 0 ? " best" : ""}" data-t="${esc(t)}">${esc(t)}</button>`).join("")}</div>
          <div class="cr-tip">ถ้ายังไม่ตรง ลากกรอบให้ชิดข้อความขึ้น หรือคลุมทีละบรรทัด</div>`;
        res.querySelectorAll(".cr-opt").forEach((b) => b.addEventListener("click", () => {
          const el = f.querySelector(`[name=${fieldSel.value}]`);
          if (!el) return;
          const val = valueForField(fieldSel.value, b.dataset.t);
          if (!val) return toast("แปลงเป็นค่าของช่องนี้ไม่ได้ ลองเลือกข้อความอื่น", true);
          el.value = val;
          el.classList.remove("missing");
          el.dispatchEvent(new Event("input", { bubbles: true }));
          renderWarnings(f);
          toast(`ใส่ลงช่อง "${FIELD_LABELS[fieldSel.value]}" แล้ว`);
          close();
        }));
      } catch (err) {
        busy.close();
        toast("อ่านกรอบไม่สำเร็จ: " + (err?.message || err), true);
      }
    });
  }

  // รูปเก็บอยู่ใน Supabase Storage: ได้ลิงก์ (signed URL / blob:) ของรูปล่าสุดเสมอ ไม่ต้องใช้ ?v= กันแคช
  const imgUrl = (name) => window.PTBackend.imgUrl(name);

  async function editOrder(id) {
    const o = await api("/orders/" + id);
    renderForm(o, id);
  }

  const FIELD_COUNT = 13;
  function renderForm(d, editingId) {
    const shots = d.screenshots || [];
    const found = (d.foundFields || []).length;
    const miss = (v) => (v == null || v === "" ? " missing" : "");
    const unsure = editingId ? {} : (d.unsureReasons || {});
    const remembered = new Set(editingId ? [] : (d.rememberedFields || []));
    // missing = อ่านไม่ได้ (เหลือง) · unsure = อ่านได้แต่ไม่ชัด ควรตรวจ (ส้ม) · remembered = ใช้ค่าที่เคยแก้ไว้ (ฟ้า)
    const cls = (n) => miss(d[n]) || (unsure[n] ? " unsure" : remembered.has(n) ? " remembered" : "");
    const why = (n) => (unsure[n] ? ` data-why="${esc(unsure[n])}" title="${esc(unsure[n])}"` : remembered.has(n) ? ' title="ใช้ค่าที่คุณเคยแก้ไว้"' : "");
    const nUnsure = Object.keys(unsure).filter((k) => d[k] != null && d[k] !== "").length;
    const dtLocal = d.orderedAt ? String(d.orderedAt).slice(0, 16) : "";
    $view.innerHTML = `
      <div class="topbar"><a class="icon-btn ghost" href="${editingId ? "#/order/" + editingId : "#/"}" aria-label="กลับ">${I.back}</a>
        <h1>${editingId ? "แก้ไขคำสั่งซื้อ" : "ตรวจข้อมูลก่อนบันทึก"}</h1></div>
      <div class="capture-wrap"><form id="f" novalidate>
        ${d.controlNo ? `<div class="idno">ID No. <b>${esc(d.controlNo)}</b></div>` : ""}
        ${shots.length || !editingId ? `<div class="source card">
          <div class="thumbs">${shots.slice(0, 1).map((s) => `<a href="${imgUrl(s, d.imageVersion)}" target="_blank" rel="noopener"><img class="combined" src="${imgUrl(s, d.imageVersion)}" alt="รูปรวมภาพหน้าจอ"></a>`).join("")}</div>
          <div class="info">
            <b style="font-size:15px">${editingId ? "รูปรวมภาพหน้าจอ" : `อ่านจากภาพหน้าจอ ${d.imageCount || 1} ภาพ`}</b>
            ${shots.length ? `<span class="muted" style="font-size:12px;word-break:break-all">บันทึกรูปเป็น ${esc(shots[0])}</span>` : ""}
            ${editingId ? "" : `<span class="okline${found < 9 ? " warn" : ""}">${found < 9 ? I.alert : I.check}อ่านได้ ${found}/${FIELD_COUNT} ช่อง</span>
            ${nUnsure ? `<span class="okline warn" style="color:#B4541A">${I.alert}ควรตรวจ ${nUnsure} ช่อง (สีส้ม = อ่านไม่ชัด)</span>` : ""}
            ${remembered.size ? `<span class="muted" style="font-size:12px">สีฟ้า = เติมจากค่าที่คุณเคยแก้ไว้ ${remembered.size} ช่อง</span>` : ""}
            ${found < FIELD_COUNT ? '<span class="muted" style="font-size:12px">ช่องสีเหลืองอ่านไม่ได้ กรอกเพิ่มหรือเพิ่มภาพ</span>' : '<span class="muted" style="font-size:12px">ตรวจความถูกต้อง แตะช่องไหนก็แก้ได้</span>'}`}
            ${editingId ? "" : `<button type="button" class="btn small" id="more" style="align-self:flex-start">+ เพิ่มภาพ (ID No. เดิม)</button>`}
          </div></div>` : ""}

        <div class="section-label">สินค้า</div>
        <div class="card form-card">
          <label class="field">ชื่อสินค้า *<input name="productName" required value="${esc(d.productName)}" class="${cls("productName")}"${why("productName")}></label>
          <div class="grid2">
            <label class="field">ตัวเลือก (สี/ขนาด)<input name="variant" value="${esc(d.variant)}" class="${(cls("variant") || "").replace(" missing", "")}"${why("variant")}></label>
            <label class="field">จำนวน<input name="quantity" type="number" min="1" inputmode="numeric" value="${esc(d.quantity ?? 1)}"></label>
          </div>
          <label class="field">ร้านค้า<input name="shopName" value="${esc(d.shopName)}" class="${cls("shopName")}"${why("shopName")}></label>
        </div>

        <div class="section-label">คำสั่งซื้อ</div>
        <div class="card form-card">
          <label class="field">หมายเลขคำสั่งซื้อ<input name="orderNumber" autocapitalize="characters" value="${esc(d.orderNumber)}" class="${cls("orderNumber")}"${why("orderNumber")}></label>
          <label class="field">หมายเลขอ้างอิง<input name="referenceNumber" autocapitalize="characters" value="${esc(d.referenceNumber)}"></label>
          <div class="grid2">
            <label class="field">วันที่สั่งซื้อ<input name="orderedAt" type="datetime-local" value="${esc(dtLocal)}" class="${cls("orderedAt")}"${why("orderedAt")}></label>
            <label class="field">ยอดชำระสุทธิ (บาท)<input name="totalAmount" inputmode="decimal" value="${d.totalAmount != null ? esc(Number(d.totalAmount).toFixed(2)) : ""}" class="${cls("totalAmount")}"${why("totalAmount")}></label>
          </div>
          <div class="grid2">
            <label class="field">วิธีชำระเงิน<input name="paymentMethod" list="pm" value="${esc(d.paymentMethod)}" class="${(cls("paymentMethod") || "").replace(" missing", "")}"${why("paymentMethod")}></label>
            <label class="field">หมายเลขบัตรเครดิต / เดบิต<input name="cardNumber" inputmode="numeric" autocomplete="off" maxlength="23"
              placeholder="เช่น 1234" value="${d.cardLast4 ? "•••• " + esc(d.cardLast4) : ""}"></label>
          </div>
          <div class="field-note">พิมพ์เลขบัตรเต็มหรือแค่ 4 หลักท้ายก็ได้ ระบบเก็บไว้เฉพาะ 4 หลักท้ายเพื่อความปลอดภัย</div>
          <label class="check"><input type="checkbox" name="paymentConfirmed" ${d.paymentConfirmed ? "checked" : ""}>ชำระเงินสำเร็จแล้ว</label>
          <datalist id="pm"><option value="บัตรเครดิต / เดบิต"><option value="พร้อมเพย์"><option value="โอนผ่านธนาคาร"><option value="เก็บเงินปลายทาง"></datalist>
        </div>

        <div class="section-label">การจัดส่ง</div>
        <div class="card form-card key">
          <label class="field big">เลขพัสดุ<input name="trackingNumber" autocapitalize="characters" value="${esc(d.trackingNumber)}" class="${cls("trackingNumber")}"${why("trackingNumber")}></label>
          <label class="field">บริษัทขนส่ง<input name="carrier" list="carriers" value="${esc(d.carrier)}" class="${cls("carrier")}"${why("carrier")}></label>
          <datalist id="carriers"><option value="Flash Express"><option value="Kerry Express"><option value="J&amp;T Express"><option value="SPX Express"><option value="ไปรษณีย์ไทย"><option value="Ninja Van"><option value="Lazada Express"><option value="Best Express"><option value="DHL eCommerce"></datalist>
          <div class="hint">${I.qr}<span>เลขนี้ใช้จับคู่ตอนยิง QR / บาร์โค้ดบนกล่อง เมื่อพัสดุมาส่ง · ตัว O ในส่วนที่เป็นตัวเลขจะถูกเปลี่ยนเป็นเลข 0 ให้อัตโนมัติ</span></div>
        </div>

        <div class="section-label">ผู้รับ / ที่อยู่จัดส่ง</div>
        <div class="card form-card">
          <label class="field">ชื่อผู้รับ<input name="recipientName" value="${esc(d.recipientName)}" class="${cls("recipientName")}"${why("recipientName")}></label>
          <label class="field">ที่อยู่ในการจัดส่ง<textarea name="shippingAddress" rows="2" class="${cls("shippingAddress")}"${why("shippingAddress")}>${esc(d.shippingAddress)}</textarea></label>
        </div>

        <div class="section-label">หมายเหตุ</div>
        <div class="card form-card"><label class="field"><span class="sr-only">หมายเหตุ</span><textarea name="note" placeholder="เช่น ซื้อให้ใคร ใช้ทำอะไร">${esc(d.note)}</textarea></label></div>

        ${(d.rawLines || []).length ? `
        <div class="read-tools card">
          <div class="rt-head"><b>เครื่องมือช่วยอ่านให้ครบและตรง</b></div>
          <div class="rt-btns">
            <button type="button" class="btn small" id="deepRead">${I.search}อ่านซ้ำแบบละเอียด</button>
            <button type="button" class="btn small" id="cropRead">${I.doc}ลากกรอบอ่านเฉพาะช่อง</button>
          </div>
          <div id="warnBox"></div>
        </div>

        <details class="raw ocr-panel"${editingId ? "" : " open"}>
          <summary>ข้อความที่อ่านได้จากภาพ (${d.rawLines.length} บรรทัด)</summary>
          <p class="ocr-tip">แตะช่องที่ต้องการก่อน แล้วแตะบรรทัดด้านล่าง ข้อความจะถูกใส่ลงช่องนั้นตรงตามรูป</p>
          <div class="ocr-lines">${d.rawLines.map((l) => `<button type="button" class="ocr-line" data-t="${esc(l)}">${esc(l)}</button>`).join("")}</div>
          ${d.rawText ? `<details class="raw"><summary>ดูข้อความดิบทั้งหมด</summary><pre>${esc(d.rawText)}</pre></details>` : ""}
        </details>`
        : `<div class="read-tools card">
          <div class="rt-head"><b>เครื่องมือช่วยอ่านให้ครบและตรง</b></div>
          <div class="rt-btns">
            <button type="button" class="btn small" id="deepRead">${I.search}อ่านซ้ำแบบละเอียด</button>
            <button type="button" class="btn small" id="cropRead">${I.doc}ลากกรอบอ่านเฉพาะช่อง</button>
          </div>
          <div id="warnBox"></div>
          ${d.rawText ? `<details class="raw"><summary>ดูข้อความที่อ่านได้จากภาพ</summary><pre>${esc(d.rawText)}</pre></details>` : ""}
        </div>`}

        <div class="form-actions">
          <button type="button" class="btn" id="cancel">ยกเลิก</button>
          <button type="submit" class="btn primary">${I.check}${editingId ? "บันทึกการแก้ไข" : "บันทึกคำสั่งซื้อ"}</button>
        </div>
      </form>
      <div class="preview-col">${shots.map((s) => `<img src="${imgUrl(s, d.imageVersion)}" alt="รูปรวมภาพหน้าจอ">`).join("")}</div>
      </div>`;

    const f = $view.querySelector("#f");
    // เลือกวันที่/เวลาเสร็จ ให้ปฏิทินหุบทันที ไม่ต้องกดที่อื่นก่อน
    f.querySelectorAll('input[type=date], input[type=datetime-local]').forEach((el) =>
      el.addEventListener("change", () => el.blur()));
    f.querySelectorAll("input.missing, textarea.missing").forEach((i) => i.addEventListener("input", () => i.classList.toggle("missing", !i.value)));
    // แก้ช่องสีส้ม/ฟ้าแล้ว ถือว่าตรวจแล้ว เอาสีออก
    f.querySelectorAll(".unsure, .remembered").forEach((i) => i.addEventListener("input", () => {
      i.classList.remove("unsure", "remembered"); delete i.dataset.why; renderWarnings(f);
    }));
    // พิมพ์ตัว O ในช่องเลขพัสดุ ให้กลายเป็นเลข 0 ทันที
    f.trackingNumber?.addEventListener("input", (e) => {
      const el = e.target, pos = el.selectionStart, fixed = fixTracking(el.value);
      if (fixed !== el.value) { el.value = fixed; el.setSelectionRange(pos, pos); }
    });

    // แตะบรรทัดที่ OCR อ่านได้ เพื่อใส่ลงช่องที่กำลังแก้อยู่ (ได้ข้อความตรงกับรูปเป๊ะ)
    f.querySelectorAll("input:not([type=checkbox]), textarea").forEach((el) => {
      el.addEventListener("focus", () => { f.querySelectorAll(".fld-active").forEach((x) => x.classList.remove("fld-active")); el.classList.add("fld-active"); });
      el.addEventListener("change", () => renderWarnings(f));
    });
    bindOcrLines(f);

    // เครื่องมือช่วยอ่าน: อ่านซ้ำละเอียด / ลากกรอบอ่านเฉพาะช่อง / เตือนช่องที่น่าสงสัย
    $view.querySelector("#deepRead")?.addEventListener("click", () => deepRead(d, f));
    $view.querySelector("#cropRead")?.addEventListener("click", () => cropRead(d, f));
    renderWarnings(f);
    $view.querySelector("#more")?.addEventListener("click", () => {
      draft = readForm(f, d);
      appendNext = true;
      $picker.click();
    });
    $view.querySelector("#cancel").addEventListener("click", () => {
      if (!editingId && !confirm("ทิ้งข้อมูลที่อ่านได้?")) return;
      draft = null; if (!editingId) session = null;
      location.hash = editingId ? "#/order/" + editingId : "#/";
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = readForm(f, d);
      if (!body.productName) { toast("กรุณาใส่ชื่อสินค้า", true); f.productName.focus(); return; }
      const btn = f.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        const saved = editingId
          ? await api("/orders/" + editingId, { method: "PUT", body })
          : await api("/orders", { method: "POST", body });
        draft = null; if (!editingId) session = null;
        toast(editingId ? "บันทึกการแก้ไขแล้ว" : "บันทึกแล้ว รอยิง QR เมื่อของมาส่ง");
        location.hash = "#/order/" + saved.id;
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    });
  }

  function readForm(f, d) {
    const v = (n) => f[n].value.trim();
    const amount = v("totalAmount").replace(/[฿,\s]/g, "");
    return {
      controlNo: d.controlNo || null,
      imageCount: d.imageCount, imageVersion: d.imageVersion,
      productName: v("productName"),
      variant: v("variant") || null,
      shopName: v("shopName") || null,
      quantity: parseInt(v("quantity"), 10) || 1,
      orderNumber: v("orderNumber") || null,
      referenceNumber: v("referenceNumber") || null,
      trackingNumber: fixTracking(v("trackingNumber")) || null,
      carrier: v("carrier") || null,
      recipientName: v("recipientName") || null,
      shippingAddress: v("shippingAddress") || null,
      totalAmount: amount && !isNaN(+amount) ? +amount : null,
      paymentMethod: v("paymentMethod") || null,
      cardNumber: v("cardNumber") || null,
      paymentConfirmed: f.paymentConfirmed.checked,
      orderedAt: v("orderedAt") ? v("orderedAt") + ":00" : null,
      screenshots: d.screenshots || [],
      note: v("note") || null,
      foundFields: d.foundFields, rawText: d.rawText, rawLines: d.rawLines,
    };
  }

  // ---------- ยิง QR / บาร์โค้ด ----------
  async function scan() {
    // กล้องสดใช้ได้เฉพาะหน้าเว็บที่เป็น https หรือ localhost (ข้อบังคับของเบราว์เซอร์)
    const liveOk = !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
    if (!appInfo) { try { appInfo = await api("/version"); } catch { appInfo = {}; } }
    const httpsPort = appInfo?.httpsPort;
    const secureLink = !liveOk && httpsPort && location.protocol === "http:" && location.hostname !== "localhost"
      ? `https://${location.hostname}:${httpsPort}/#/scan` : null;

    $view.innerHTML = `
      <div class="scan-page">
        <div class="scan-top">
          <a class="icon-btn" href="#/" aria-label="ปิด">${I.close}</a>
          <h1>ยิง QR / บาร์โค้ดพัสดุ</h1>
          <span style="width:44px"></span>
        </div>

        ${liveOk ? `
        <div class="reader-wrap"><div id="reader"></div></div>
        <div id="camMsg"></div>
        <p class="scan-help">เล็งกล้องไปที่ QR หรือบาร์โค้ดบนกล่องพัสดุ<br>ระบบจะจับคู่กับคำสั่งซื้อให้อัตโนมัติ</p>
        <label class="btn photo-scan ghost-w">${I.doc}ถ่ายรูปบาร์โค้ดแทน
          <input id="photoScan" type="file" accept="image/*" capture="environment" hidden></label>
        ` : `
        <div class="photo-mode">
          <div class="pm-ring">${I.qr}</div>
          <h2>ถ่ายรูป QR / บาร์โค้ดบนกล่อง</h2>
          <p>แตะปุ่มด้านล่างเพื่อเปิดกล้องมือถือ<br>ถ่ายให้เห็นบาร์โค้ดชัดเต็มกรอบ ระบบจะอ่านเลขพัสดุให้เอง</p>
          <label class="btn primary block big-cam">${I.qr}เปิดกล้องถ่ายบาร์โค้ด
            <input id="photoScan" type="file" accept="image/*" capture="environment" hidden></label>
          <label class="btn block ghost-w">${I.upload}เลือกรูปจากคลังภาพ
            <input id="photoPick" type="file" accept="image/*" hidden></label>
          <div class="pm-note">
            ${I.alert}<span>มือถือเปิด<b>กล้องสด</b>ได้เฉพาะลิงก์ที่เป็น https เท่านั้น การถ่ายรูปด้านบนใช้ได้ทุกกรณี
            ${secureLink ? `<br><a class="pm-link" href="${secureLink}">เปิดแบบ https เพื่อใช้กล้องสด →</a>` : ""}</span>
          </div>
        </div>
        `}

        <form class="manual" id="manual">
          <label class="sr-only" for="code">เลขพัสดุ</label>
          <input id="code" autocomplete="off" autocapitalize="characters" placeholder="พิมพ์เลขพัสดุ หรือใช้เครื่องยิงบาร์โค้ด">
          <button class="btn">ค้นหา</button>
        </form>
        ${liveOk ? "" : '<div id="reader" hidden></div>'}
      </div>`;

    const input = $view.querySelector("#code");
    $view.querySelector("#manual").addEventListener("submit", (e) => {
      e.preventDefault();
      if (input.value.trim()) { scanZoom = null; handleCode(input.value.trim()); input.value = ""; }
    });

    // ถ่ายรูป/เลือกรูปบาร์โค้ด ใช้ได้แม้เปิดเว็บแบบ http (กล้องสดต้องใช้ https)
    const onPhoto = async (e) => {
      const file = e.target.files[0]; e.target.value = "";
      if (!file) return;
      if (!window.Html5Qrcode) return toast("โหลดตัวอ่านบาร์โค้ดไม่ได้ ลองรีเฟรชหน้าเว็บ", true);
      scanPhoto = file;
      scanZoom = null;
      await stopScanner();
      const busy = showScanBusy();
      try {
        const r = await decodeFromPhoto(file, busy.step);
        busy.close();
        if (!r) {
          return toast("หาโค้ดในรูปไม่เจอ ลองถ่ายให้เห็น QR / บาร์โค้ดชัด ๆ ไม่เอียง และไม่มีแสงสะท้อน", true);
        }
        scanZoom = r.preview || null;
        handleCode(r.text);
      } catch (err) {
        busy.close();
        toast("อ่านรูปไม่สำเร็จ: " + (err?.message || err), true);
      }
    };
    $view.querySelector("#photoScan")?.addEventListener("change", onPhoto);
    $view.querySelector("#photoPick")?.addEventListener("change", onPhoto);

    if (matchMedia("(min-width: 960px)").matches) input.focus();
    if (liveOk) await startScanner();
  }

  async function startScanner() {
    const msg = $view.querySelector("#camMsg");
    if (!window.Html5Qrcode) { msg.innerHTML = '<div class="cam-error">โหลดตัวสแกนไม่ได้ ใช้ช่องพิมพ์เลขด้านล่างแทน</div>'; return; }
    if (!window.isSecureContext) {
      msg.innerHTML = '<div class="cam-error">เบราว์เซอร์เปิดกล้องได้เฉพาะเว็บที่เป็น https เท่านั้น<br>ใช้ปุ่ม “ถ่ายรูปบาร์โค้ดแทน” หรือพิมพ์เลขพัสดุด้านล่าง</div>';
      return;
    }
    try {
      scanner = new Html5Qrcode("reader", { verbose: false });
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: (w, h) => ({ width: Math.floor(Math.min(w, h * 1.6) * 0.8), height: Math.floor(Math.min(w, h * 1.6) * 0.5) }) },
        (text) => { if (!scanBusy) { grabVideoFrame(); handleCode(text); } },
        () => {}
      );
      startDeepScanLoop();
    } catch (e) {
      scanner = null;
      msg.innerHTML = `<div class="cam-error">เปิดกล้องไม่ได้ (${esc(e?.message || e)})<br>อนุญาตให้เว็บใช้กล้อง หรือพิมพ์เลขพัสดุด้านล่างแทน</div>`;
    }
  }

  /** ระหว่างเปิดกล้องสด ถ้าอ่านไม่ติด จะจับภาพนิ่งมาหาบริเวณโค้ดแล้วซูมอ่านให้เองเป็นระยะ */
  function startDeepScanLoop() {
    stopDeepScanLoop();
    let busy = false;
    deepScanTimer = setInterval(async () => {
      if (busy || scanBusy || !scanner) return;
      busy = true;
      try {
        const v = document.querySelector("#reader video");
        if (v?.videoWidth) {
          const c = document.createElement("canvas");
          c.width = v.videoWidth; c.height = v.videoHeight;
          c.getContext("2d").drawImage(v, 0, 0);
          const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
          if (blob && !scanBusy && scanner) {
            const hit = await decodeFromPhoto(blob, null, { quick: true, maxRegions: 3 });
            if (hit && !scanBusy) {
              scanPhoto = blob;
              scanZoom = hit.preview || null;
              navigator.vibrate?.(60);
              handleCode(hit.text);
            }
          }
        }
      } catch { /* ข้ามรอบนี้ */ }
      finally { busy = false; }
    }, 2600);
  }
  function stopDeepScanLoop() { if (deepScanTimer) { clearInterval(deepScanTimer); deepScanTimer = null; } }

  async function stopScanner() {
    stopDeepScanLoop();
    if (!scanner) return;
    try { if (scanner.isScanning) await scanner.stop(); scanner.clear(); } catch { /* ignore */ }
    scanner = null;
  }

  // ค่าที่ยิงได้ ไม่ว่าจากกล้อง ช่องพิมพ์ หรือเครื่องยิงบาร์โค้ด USB มาจบที่นี่
  async function handleCode(code) {
    scanBusy = true;
    try { scanner?.pause(true); } catch { /* ignore */ }
    navigator.vibrate?.(60);
    try {
      const r = await api("/scan", { method: "POST", body: { code } });
      showResult(r);
    } catch (e) {
      toast(e.message, true);
      resumeScan();
    }
  }

  function resumeScan() {
    scanBusy = false;
    scanZoom = null;
    try { scanner?.resume(); } catch { /* ignore */ }
    const input = document.querySelector("#code");
    if (input && matchMedia("(min-width: 960px)").matches) input.focus();
  }

  // จับภาพนิ่งจากกล้องสดไว้เป็นหลักฐานตอนรับของ
  function grabVideoFrame() {
    try {
      const v = document.querySelector("#reader video");
      if (!v || !v.videoWidth) return;
      const c = document.createElement("canvas");
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext("2d").drawImage(v, 0, 0);
      c.toBlob((b) => { if (b) scanPhoto = b; }, "image/jpeg", 0.9);
    } catch { /* ไม่มีภาพก็ข้ามไป */ }
  }

  // รวมรูปสแกนเข้ากับรูปรวมเดิมของรายการ แล้วเขียนทับไฟล์ชื่อเดิม (ID No.)
  async function mergeScanPhoto(order, photo) {
    if (!photo || !order.controlNo || !order.screenshots?.length) return false;
    try {
      const [base, shot] = await Promise.all([
        loadImage(await (await fetch(imgUrl(order.screenshots[0], Date.now()))).blob()),
        loadImage(photo),
      ]);
      const gap = 24, pad = 24, tagH = 56;
      const h = base.height;
      const shotW = Math.round(shot.width * (h - tagH) / shot.height);
      const W = base.width + gap + shotW + pad;
      const c = document.createElement("canvas");
      c.width = W; c.height = h;
      const g = c.getContext("2d");
      g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, W, h);
      g.drawImage(base, 0, 0);
      const x = base.width + gap;
      // แถบกำกับว่ารูปนี้คือรูปตอนรับของ
      g.fillStyle = "#0E6B63"; g.fillRect(x, 0, shotW, tagH);
      g.fillStyle = "#FFFFFF"; g.textBaseline = "middle";
      g.font = "bold 28px Tahoma, 'Leelawadee UI', sans-serif";
      g.fillText("รับของ " + dt(new Date().toISOString()), x + 14, tagH / 2);
      g.drawImage(shot, x, tagH, shotW, h - tagH);
      g.strokeStyle = "#E3E0D9"; g.lineWidth = 2; g.strokeRect(x, tagH, shotW, h - tagH);
      base.close?.(); shot.close?.();
      const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.9));
      if (!blob) return false;
      const fd = new FormData();
      fd.append("combined", blob, order.controlNo + ".jpg");
      await api(`/orders/${order.id}/scan-image`, { method: "POST", body: fd });
      return true;
    } catch (e) {
      console.warn("รวมรูปสแกนไม่สำเร็จ", e);
      return false;
    }
  }

  function closeSheet() { document.querySelector(".sheet-backdrop")?.remove(); }

  function showResult(r) {
    closeSheet();
    const o = r.match;
    const wrap = document.createElement("div");
    wrap.className = "sheet-backdrop";
    let body;
    if (!o) {
      body = `<div class="sheet-head"><span class="dot miss">${I.alert}</span>
          <div><h2>ไม่พบคำสั่งซื้อที่ตรงกัน</h2><p>${esc(r.code)}</p></div></div>
        ${scanZoom ? `<div class="zoom-proof"><img src="${scanZoom}" alt="บริเวณที่ซูมเข้าไปอ่าน"><span>อ่านจากบริเวณนี้ในรูป</span></div>` : ""}
        <p class="muted" style="margin:0;font-size:14px;line-height:1.6">ตรวจว่าบันทึกคำสั่งซื้อนี้ไว้แล้ว และเลขพัสดุในระบบตรงกับบนกล่อง</p>
        <button class="btn primary block" data-act="again">สแกนใหม่</button>
        <a class="btn block" href="#/capture">บันทึกคำสั่งซื้อใหม่</a>`;
    } else {
      body = `<div class="sheet-head"><span class="dot${r.alreadyReceived ? " warn" : ""}">${r.alreadyReceived ? I.alert : I.check}</span>
          <div><h2>${esc(r.message)}</h2><p>ยิงได้ ${esc(r.code)}</p></div></div>
        ${scanZoom ? `<div class="zoom-proof"><img src="${scanZoom}" alt="บริเวณที่ซูมเข้าไปอ่าน"><span>อ่านจากบริเวณนี้ในรูป</span></div>` : ""}
        <div class="match card">
          <div class="row1"><span>${esc(o.productName)}${o.variant ? " · " + esc(o.variant) : ""}</span><span>${money(o.totalAmount)}</span></div>
          <div class="kv">
            <div><span>ID No.</span><b>${esc(o.controlNo || "–")}</b></div>
            <div><span>คำสั่งซื้อ</span><b>${esc(o.orderNumber || "–")}</b></div>
            <div><span>ขนส่ง</span><b>${esc(o.carrier || "–")}</b></div>
            <div><span>ร้านค้า</span><b>${esc(o.shopName || "–")}</b></div>
            <div><span>สถานะ</span><b style="color:${r.alreadyReceived ? "var(--accent-ink)" : "var(--warn-ink)"}">${r.alreadyReceived ? "ได้รับแล้ว" : "รอของมาส่ง"}</b></div>
          </div>
        </div>
        ${r.alreadyReceived
          ? `<a class="btn block" href="#/order/${o.id}">ดูรายละเอียด</a><button class="btn primary block" data-act="again">สแกนชิ้นถัดไป</button>`
          : `<button class="btn primary block" data-act="receive" style="height:54px;font-size:16px">${I.box}ยืนยันรับพัสดุ · ซื้อขายสำเร็จ</button>
             <button class="btn block" data-act="again" style="border:0">ไม่ใช่รายการนี้ สแกนใหม่</button>`}`;
    }
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><span class="grab"></span>${body}</div>`;
    document.body.appendChild(wrap);
    wrap.querySelector(".btn.primary")?.focus();

    wrap.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (e.target === wrap || act === "again") { closeSheet(); resumeScan(); return; }
      if (act === "receive") {
        e.target.closest("button").disabled = true;
        try {
          await api(`/orders/${o.id}/receive`, { method: "POST", body: { code: r.code } });
          const merged = await mergeScanPhoto(o, scanPhoto);   // รวมรูปสแกนเข้าไฟล์เดิม ชื่อเดิม
          scanPhoto = null;
          navigator.vibrate?.([40, 60, 40]);
          scanBusy = false;
          if (merged) toast("รวมรูปสแกนเข้ากับรูปของรายการแล้ว");
          location.hash = "#/done/" + o.id;
        } catch (err) { toast(err.message, true); }
      }
    });
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeSheet(); resumeScan(); } });
  }

  // ช่องเครื่องยิงบาร์โค้ด USB ในแถบด้านข้าง (เครื่องยิงพิมพ์ตัวเลขแล้วกด Enter ให้เอง)
  $usb.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && $usb.value.trim()) { e.preventDefault(); scanZoom = null; handleCode($usb.value.trim()); $usb.value = ""; }
  });

  // ---------- สำเร็จ ----------
  async function done(id) {
    const o = await api("/orders/" + id);
    $view.innerHTML = `
      <div class="done">
        <div class="done-hero">
          <div class="done-ring"><span>${I.check}</span></div>
          <h1>ซื้อขายสำเร็จ</h1>
          <p>บันทึกการรับพัสดุเรียบร้อย<br>สถานะเปลี่ยนเป็น “ได้รับแล้ว”</p>
        </div>
        ${summaryCard(o)}
        <div class="stack">
          <a class="btn primary block" href="#/scan" style="height:54px;font-size:16px">${I.qr}สแกนพัสดุชิ้นถัดไป</a>
          <a class="btn block" href="#/">กลับหน้าหลัก</a>
        </div>
      </div>`;
  }

  function summaryCard(o) {
    const received = o.status === "Received";
    return `<div class="card sum">
      <div class="row1"><div><b>${esc(o.productName)}${o.variant ? " · " + esc(o.variant) : ""}</b><div class="muted" style="font-size:13px">${o.controlNo ? `ID No. <b class="idtag">${esc(o.controlNo)}</b> · ` : ""}${esc(o.orderNumber || "")}</div></div>
        <b style="white-space:nowrap">${money(o.totalAmount)}</b></div>
      <div class="divider"></div>
      <div class="timeline">
        <div class="tl"><div class="rail"><i></i><u></u></div><div class="txt">สั่งซื้อสินค้า<small>${dt(o.orderedAt)}</small></div></div>
        <div class="tl"><div class="rail"><i></i><u></u></div><div class="txt">บันทึกจากภาพหน้าจอ<small>${dt(o.createdAt)}</small></div></div>
        <div class="tl"><div class="rail"><i class="${received ? "" : "open"}"></i></div>
          <div class="txt" style="${received ? "color:var(--accent-ink);font-weight:600" : "color:var(--warn-ink);font-weight:500"}">
            ${received ? "ยิง QR ยืนยันรับพัสดุ" : "รอยิง QR ยืนยันรับของ"}
            <small>${received ? dt(o.receivedAt) + " · " + esc(o.carrier || "") + " " + esc(o.trackingNumber || "") : esc(o.carrier || "") + " " + esc(o.trackingNumber || "")}</small></div></div>
      </div>
    </div>`;
  }

  // ---------- รายละเอียด ----------
  let pager = { prev: null, next: null };   // ไว้ให้ปุ่มลูกศร / ปุ่มคีย์บอร์ด / ปัดจอ ใช้ร่วมกัน

  function goRel(dir) {
    const to = dir === "prev" ? pager.prev : pager.next;
    if (to) location.hash = "#/order/" + to;
    else toast(dir === "prev" ? "นี่คือรายการแรกแล้ว" : "นี่คือรายการสุดท้ายแล้ว");
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const t = document.createElement("textarea");
        t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
        document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
      }
      toast("คัดลอก " + text + " แล้ว");
    } catch { toast("คัดลอกไม่สำเร็จ"); }
  }

  async function detail(id) {
    const qs = new URLSearchParams(filter).toString();
    const [o, list] = await Promise.all([api("/orders/" + id), api("/orders?" + qs).catch(() => [])]);
    const received = o.status === "Received";

    const idx = list.findIndex((x) => x.id === o.id);
    pager = {
      prev: idx > 0 ? list[idx - 1].id : null,
      next: idx >= 0 && idx < list.length - 1 ? list[idx + 1].id : null,
    };
    const pos = idx >= 0 ? `${idx + 1} / ${list.length}` : "";

    const dash = '<span class="dash">–</span>';
    const val = (v) => (v === null || v === undefined || v === "" ? dash : esc(v));
    const cp = (v) => (v ? `<button class="copy-v" data-copy="${esc(v)}" title="คัดลอก">${esc(v)}${I.copy}</button>` : dash);
    const row = (label, html) => `<div class="drow"><dt>${label}</dt><dd>${html}</dd></div>`;
    const arrow = (dir, disabled) =>
      `<button class="icon-btn pg" data-go="${dir}"${disabled ? " disabled" : ""} aria-label="${dir === "prev" ? "รายการก่อนหน้า" : "รายการถัดไป"}">${dir === "prev" ? I.back : I.fwd}</button>`;

    $view.innerHTML = `
      <div class="topbar detail-top">
        <a class="icon-btn ghost" href="#/orders" aria-label="กลับไปหน้ารายการ">${I.back}</a>
        <div class="tb-title"><h1>รายละเอียดคำสั่งซื้อ</h1>${pos ? `<span class="tb-sub">รายการที่ ${pos}</span>` : ""}</div>
        <div class="pager">${arrow("prev", !pager.prev)}${arrow("next", !pager.next)}</div>
      </div>

      ${pager.prev ? `<button class="edge-nav left" data-go="prev" aria-label="รายการก่อนหน้า">${I.back}</button>` : ""}
      ${pager.next ? `<button class="edge-nav right" data-go="next" aria-label="รายการถัดไป">${I.fwd}</button>` : ""}

      <div class="detail-grid">
        <div class="stack">
          <div class="card hero">
            <div class="hero-main">
              <span class="hero-ic ${received ? "received" : "pending"}">${received ? I.check : I.box}</span>
              <div class="hero-txt">
                <h2>${esc(o.productName)}</h2>
                ${o.variant || o.shopName ? `<p class="hero-sub">${[o.variant, o.shopName].filter(Boolean).map(esc).join(" · ")}</p>` : ""}
                <div class="hero-chips">
                  ${statusBadge(o)}
                  ${o.controlNo ? `<button class="chip-copy" data-copy="${esc(o.controlNo)}" title="คัดลอก ID No.">ID No. <b>${esc(o.controlNo)}</b>${I.copy}</button>` : ""}
                </div>
              </div>
              <div class="hero-amt"><small>ยอดสุทธิ</small><b>${money(o.totalAmount)}</b></div>
            </div>
            <div class="divider"></div>
            <div class="timeline">
              <div class="tl"><div class="rail"><i></i><u></u></div><div class="txt">สั่งซื้อสินค้า<small>${dt(o.orderedAt)}</small></div></div>
              <div class="tl"><div class="rail"><i></i><u></u></div><div class="txt">บันทึกจากภาพหน้าจอ<small>${dt(o.createdAt)}</small></div></div>
              <div class="tl"><div class="rail"><i class="${received ? "" : "open"}"></i></div>
                <div class="txt ${received ? "ok" : "wait"}">${received ? "ยิง QR ยืนยันรับพัสดุ" : "รอยิง QR ยืนยันรับของ"}
                  <small>${received ? dt(o.receivedAt) + (o.carrier || o.trackingNumber ? " · " + esc(o.carrier || "") + " " + esc(o.trackingNumber || "") : "") : esc(o.carrier || "") + " " + esc(o.trackingNumber || "")}</small></div></div>
            </div>
          </div>

          <div class="card info">
            <section>
              <h3>การจัดส่ง</h3>
              <dl>
                ${row("เลขพัสดุ", cp(o.trackingNumber))}
                ${row("ขนส่ง", val(o.carrier))}
                ${row("หมายเลขคำสั่งซื้อ", cp(o.orderNumber))}
                ${row("หมายเลขอ้างอิง", cp(o.referenceNumber))}
              </dl>
            </section>
            <section>
              <h3>ผู้รับ / ที่อยู่จัดส่ง</h3>
              <dl>
                ${row("ชื่อผู้รับ", o.recipientName ? cp(o.recipientName) : dash)}
                ${row("ที่อยู่จัดส่ง", o.shippingAddress ? cp(o.shippingAddress) : dash)}
              </dl>
            </section>
            <section>
              <h3>สินค้า</h3>
              <dl>
                ${row("ร้านค้า", val(o.shopName))}
                ${row("รุ่น / ตัวเลือก", val(o.variant))}
                ${row("จำนวน", `${esc(o.quantity)} ชิ้น`)}
              </dl>
            </section>
            <section>
              <h3>การชำระเงิน</h3>
              <dl>
                ${row("ยอดสุทธิ", `<b class="amt">${money(o.totalAmount)}</b>`)}
                ${row("วิธีชำระ", o.paymentMethod ? esc(o.paymentMethod) + (o.paymentConfirmed ? ' <span class="ok-tag">ชำระสำเร็จ</span>' : "") : dash)}
                ${row("บัตรที่ใช้ชำระ", o.cardLast4 ? `<span class="cardno">•••• •••• •••• ${esc(o.cardLast4)}</span>` : dash)}
                ${row("วันที่สั่งซื้อ", dt(o.orderedAt) === "–" ? dash : dt(o.orderedAt))}
                ${row("วันที่รับของ", received ? dt(o.receivedAt) : dash)}
              </dl>
            </section>
            ${o.note ? `<section class="note-sec"><h3>บันทึกเพิ่มเติม</h3><p>${esc(o.note)}</p></section>` : ""}
          </div>
        </div>

        <div class="stack side">
          <div class="card act-card">
            ${received
              ? `<div class="act-note ok">${I.check}<span>รับพัสดุแล้ว<small>${dt(o.receivedAt)}</small></span></div>
                 <button class="btn block" id="undo">ยกเลิกสถานะ “ได้รับแล้ว”</button>`
              : `<div class="act-note wait">${I.clock}<span>รอของมาส่ง<small>ยิง QR เมื่อพัสดุมาถึง</small></span></div>
                 <a class="btn primary block" href="#/scan">${I.qr}ยิง QR รับพัสดุ</a>
                 <button class="btn block" id="manualReceive">ยืนยันรับพัสดุโดยไม่สแกน</button>`}
            <button class="btn block share" id="shareOne">${I.share}แชร์เข้าไลน์</button>
            <div class="act-row">
              <a class="btn" href="#/edit/${o.id}">${I.edit}แก้ไขข้อมูล</a>
              <button class="btn danger" id="del">${I.trash}ลบรายการ</button>
            </div>
          </div>

          ${o.screenshots?.length ? `
          <div class="card shot-card">
            <div class="shot-head"><h3>รูปรวมภาพหน้าจอ</h3><span class="muted">${esc(o.screenshots[0])}</span></div>
            <div class="shots">${o.screenshots.map((s) => `<a href="${imgUrl(s)}" target="_blank" rel="noopener"><img class="combined" src="${imgUrl(s)}" alt="รูปรวมภาพหน้าจอ"></a>`).join("")}</div>
            <a class="btn small block" href="${imgUrl(o.screenshots[0])}" download="${esc(o.screenshots[0])}">ดาวน์โหลดรูป</a>
          </div>` : ""}
        </div>
      </div>`;

    $view.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => goRel(b.dataset.go)));
    $view.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copyText(b.dataset.copy)));

    // ปัดซ้าย/ขวาบนมือถือเพื่อเปลี่ยนรายการ
    let sx = 0, sy = 0, st = 0;
    $view.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
    $view.addEventListener("touchend", (e) => {
      const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Date.now() - st < 600 && Math.abs(dx) > 70 && Math.abs(dy) < 50) goRel(dx < 0 ? "next" : "prev");
    }, { passive: true });

    $view.querySelector("#manualReceive")?.addEventListener("click", async () => {
      if (!confirm("ยืนยันว่าได้รับพัสดุนี้แล้ว?")) return;
      await api(`/orders/${o.id}/receive`, { method: "POST", body: { code: "manual" } });
      location.hash = "#/done/" + o.id;
    });
    $view.querySelector("#undo")?.addEventListener("click", async () => {
      await api(`/orders/${o.id}/undo-receive`, { method: "POST" });
      toast("เปลี่ยนกลับเป็น “รอของมาส่ง” แล้ว");
      render();
    });
    $view.querySelector("#shareOne")?.addEventListener("click", () => shareOrders([o.id]));
    $view.querySelector("#del").addEventListener("click", async () => {
      if (!confirm("ลบรายการนี้ถาวร?")) return;
      await api("/orders/" + o.id, { method: "DELETE" });
      toast("ลบแล้ว");
      location.hash = "#/orders";
    });
  }

  // ---------- มือถือ & สำรองข้อมูล (ข้อมูลอยู่บน Supabase ใช้ร่วมกันทุกเครื่อง ไม่ต้องล็อกอิน) ----------
  async function phone() {
    const info = await window.PTBackend.storageInfo();
    const site = location.href.split("#")[0];
    const online = /^https:$/.test(location.protocol);
    const qr = (text) => {
      const q = qrcode(0, "M"); q.addData(text); q.make();
      return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    };

    $view.innerHTML = `
      <div class="page-head"><div><h1>มือถือ &amp; สำรองข้อมูล</h1>
        <p>ข้อมูลเก็บบน Supabase เปิดเว็บนี้บนมือถือหรือคอมก็เห็นข้อมูลชุดเดียวกัน ไม่ต้องล็อกอิน</p></div></div>
      <div class="phone-grid">
        <div class="stack">
          ${online ? `
          <div class="card qr-card secure">
            <div class="qr-tag green">เปิดบนมือถือ</div>
            <div class="qr">${qr(site)}</div>
            <div class="qr-url">${esc(site)}</div>
            <p class="qr-note">ส่องด้วยกล้องมือถือเพื่อเปิดเว็บนี้ ใช้ข้อมูลชุดเดียวกันได้ทันที
              (กด แชร์ &gt; "เพิ่มไปยังหน้าจอโฮม" เพื่อใช้แบบแอป)</p>
          </div>` : ""}
          <div class="card" style="padding:18px 20px">
            <h2 style="margin:0 0 8px;font-size:18px">ข้อมูลบน Supabase</h2>
            <p>คำสั่งซื้อ <b>${info.orders}</b> รายการ · ยอดเบิก <b>${info.withdrawals}</b> รายการ · รูป <b>${info.images}</b> รูป</p>
            <div class="row" style="display:flex;gap:10px;margin-top:10px">
              <button class="btn" id="acRefresh" style="flex:1">ดึงข้อมูลล่าสุด</button>
            </div>
          </div>
        </div>
        <div class="stack">
          <div class="card" style="padding:18px 20px">
            <h2 style="margin:0 0 8px;font-size:18px">สำรองข้อมูล</h2>
            <p>ดาวน์โหลดไฟล์ .json ที่มีคำสั่งซื้อ ยอดเบิก และรูปทั้งหมด เก็บไว้เป็นสำเนาสำรองนอก Supabase</p>
            <button class="btn primary block" id="bkExport">${I.upload}ดาวน์โหลดไฟล์สำรอง</button>
          </div>
          <div class="card" style="padding:18px 20px">
            <h2 style="margin:0 0 8px;font-size:18px">นำเข้าข้อมูล</h2>
            <p>เลือกไฟล์สำรอง (.json) จากเครื่องอื่น หรือย้ายข้อมูลจาก<b>โปรแกรม ParcelTrack บนคอมแบบเดิม</b>:
              เลือก <code>orders.json</code>, <code>withdrawals.json</code>, <code>control-counter.json</code>
              ในโฟลเดอร์ <code>C:\\ParcelTrack\\data</code> และรูป .jpg ทั้งหมดใน <code>data\\uploads</code> พร้อมกันได้เลย
              (รายการที่ ID ตรงกันจะถูกแทนที่ ไม่เกิดรายการซ้ำ)</p>
            <input type="file" id="bkFiles" accept=".json,application/json,image/*" multiple hidden>
            <button class="btn block" id="bkImport">${I.doc}เลือกไฟล์ที่จะนำเข้า</button>
          </div>
        </div>
      </div>
      <div class="card tips"><b>ควรรู้</b><br>
        • ไม่มีการล็อกอิน ใครที่รู้ลิงก์เว็บนี้จะเห็นและแก้ข้อมูลได้ อย่าแชร์ลิงก์ และกดดาวน์โหลดไฟล์สำรองไว้เป็นระยะ<br>
        • อีกเครื่องเพิ่มรายการใหม่ กลับมาที่หน้านี้หรือกด "ดึงข้อมูลล่าสุด" จะเห็นทันที<br>
        • การอ่านภาพทำในเครื่องนี้ ครั้งแรกจะโหลดตัวอ่านภาพประมาณ 10 MB หลังจากนั้นเร็วขึ้น<br>
        • Supabase แพ็กเกจฟรีจะหยุด project ถ้าไม่มีการใช้งาน 7 วัน ให้เข้าไปกด Restore ที่ supabase.com</div>`;

    $view.querySelector("#acRefresh").addEventListener("click", async () => {
      try { await window.PTBackend.reload(); toast("ดึงข้อมูลล่าสุดแล้ว"); phone(); }
      catch (err) { toast(err?.message || String(err), true); }
    });

    $view.querySelector("#bkExport").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const r = await window.PTBackend.exportBackup();
        toast(`สำรองแล้ว ${r.orders} รายการ ${r.images} รูป`);
      } catch (err) { toast("สำรองไม่สำเร็จ: " + (err?.message || err), true); }
      finally { btn.disabled = false; }
    });
    const $files = $view.querySelector("#bkFiles");
    $view.querySelector("#bkImport").addEventListener("click", () => $files.click());
    $files.addEventListener("change", async () => {
      const list = [...$files.files]; $files.value = "";
      if (!list.length) return;
      const busy = showScanBusy();
      busy.step(`กำลังนำเข้า ${list.length} ไฟล์…`);
      try {
        const r = await window.PTBackend.importFiles(list);
        busy.close();
        toast(`นำเข้าแล้ว: คำสั่งซื้อ ${r.orders} · ยอดเบิก ${r.withdrawals} · รูป ${r.images}${r.duplicates ? ` · ข้ามรายการซ้ำ ${r.duplicates}` : ""}${r.skipped ? ` · ข้ามไฟล์ที่ไม่รู้จัก ${r.skipped}` : ""}`);
        phone();
      } catch (err) {
        busy.close();
        toast("นำเข้าไม่สำเร็จ: " + (err?.message || err), true);
      }
    });
  }
  // ---------- หน้าสรุปรายงาน: ยอดซื้อรายเดือน + แยกหมวดค่าใช้จ่าย + ส่งออกตามช่วงเวลา ----------
  const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const shortBaht = (n) => (n >= 1000000 ? (n / 1000000).toFixed(1) + "ล." : n >= 1000 ? Math.round(n / 1000) + "พ." : String(Math.round(n)));

  let range = { from: "", to: "" };   // ช่วงเวลาที่เลือกในหน้ารายงาน

  async function report() {
    const qs = new URLSearchParams({ months: 12, from: range.from, to: range.to }).toString();
    const r = await api("/report?" + qs);
    const s = r.summary, f = r.finance;
    const max = Math.max(...r.monthly.map((m) => m.total), 1);
    const cardMax = Math.max(...r.cards.map((c) => c.total), 1);
    const short = (v) => (v < 0 ? "-" : "") + money(Math.abs(v));

    $view.innerHTML = `
      <div class="page-head"><div><h1>รายงานสรุป</h1><p>ควบคุมการเงิน: เงินเบิก − ยอดสั่งซื้อสำเร็จ = คงเหลือ</p></div></div>

      <div class="stats report">
        <div class="stat card"><span>1. ยอดเงินเบิก</span><b>${money(f.withdrawn)}</b></div>
        <div class="stat card"><span>2. ยอดสั่งซื้อสำเร็จ (รับของแล้ว)</span><b style="color:var(--warn-ink)">${money(f.spent)}</b></div>
        <div class="stat card balance ${f.balance < 0 ? "minus" : ""}"><span>3. ยอดเงินคงเหลือ</span><b>${short(f.balance)}</b></div>
        <div class="stat card"><span>รอรับของ (ยังไม่นับ)</span><b>${money(f.pendingAmount)}</b></div>
      </div>

      <div class="report-grid">
        <div class="card money-card">
          <div class="chart-head"><h2>ยอดเงินเบิก</h2><span class="muted">รวมทั้งหมด ${money(f.withdrawnAll)} · ใช้ไป ${money(f.spentAll)} · คงเหลือ ${short(f.balanceAll)}</span></div>
          <form id="wf" class="wd-form">
            <label class="field">จำนวนเงินที่เบิก (บาท)<input id="wAmount" inputmode="decimal" placeholder="เช่น 20000" required></label>
            <label class="field">วันที่เบิก<input id="wDate" type="date" value="${ymd(new Date())}"></label>
            <label class="field">หมายเหตุ<input id="wNote" placeholder="เช่น เบิกงวดที่ 1"></label>
            <button class="btn primary" type="submit">${I.check}บันทึกยอดเบิก</button>
          </form>
          <div class="section-label">ประวัติการเบิก (ช่วงที่เลือก)</div>
          ${f.withdrawals.length ? `<table class="mini wd-table">
            <tr><th>วันที่เบิก</th><th>จำนวน</th><th>หมายเหตุ</th><th></th></tr>
            ${f.withdrawals.map((w) => `<tr>
              <td>${dt(w.date, false)}<small class="muted"> · บันทึก ${dt(w.createdAt)}</small></td>
              <td class="num">${money(w.amount)}</td>
              <td>${esc(w.note || "–")}</td>
              <td><button class="link-del" data-del="${w.id}" aria-label="ลบรายการเบิก">ลบ</button></td>
            </tr>`).join("")}
          </table>` : '<div class="empty">ยังไม่มีการเบิกเงินในช่วงเวลานี้</div>'}
        </div>

        <div class="card export-card">
          <div class="chart-head"><h2>ช่วงเวลา / ส่งออก Excel</h2></div>
          <div class="presets">
            <button class="chip" data-preset="this">เดือนนี้</button>
            <button class="chip" data-preset="last">เดือนที่แล้ว</button>
            <button class="chip" data-preset="3m">3 เดือน</button>
            <button class="chip" data-preset="year">ปีนี้</button>
            <button class="chip" data-preset="all">ทั้งหมด</button>
          </div>
          <div class="grid2">
            <label class="field">ตั้งแต่วันที่<input type="date" id="from" value="${esc(range.from)}"></label>
            <label class="field">ถึงวันที่<input type="date" id="to" value="${esc(range.to)}"></label>
          </div>
          <label class="field">สถานะ
            <select id="st">
              <option value="">ทั้งหมด</option>
              <option value="Pending">รอของมาส่ง</option>
              <option value="Received">ได้รับแล้ว</option>
            </select>
          </label>
          <a class="btn primary block excel" id="xlsx" href="/api/export.xlsx" download>${I.excel}Export to Excel</a>
          <div class="field-note">ตัวเลขการเงินด้านบนใช้ช่วงเวลานี้ · ยอดสั่งซื้อสำเร็จนับจากวันที่กดรับพัสดุ</div>
        </div>
      </div>

      <div class="card chart-card" style="margin-top:16px">
        <div class="chart-head"><h2>ยอดซื้อรายเดือน</h2><span class="muted">12 เดือนล่าสุด · หน่วยบาท</span></div>
        <div class="chart-scroll">${barChart(r.monthly, max)}</div>
      </div>

      <div class="card cat-card">
        <div class="chart-head"><h2>ยอดรวมแยกตามบัตร</h2><span class="muted">4 หลักท้ายของบัตรที่ใช้ชำระ</span></div>
        ${r.cards.length ? r.cards.map((c) => `
          <div class="cat-row">
            <div class="cat-name">${esc(c.label)}<small>${c.count} รายการ${c.method && c.last4 !== "ไม่ระบุบัตร" ? " · " + esc(c.method) : ""} · รับของแล้ว ${money(c.received)}</small></div>
            <div class="cat-bar"><i style="width:${Math.max(2, (c.total / cardMax) * 100)}%"></i></div>
            <div class="cat-total">${money(c.total)}</div>
          </div>`).join("") + `
          <div class="cat-row sum-row">
            <div class="cat-name">รวมทุกบัตร<small>${r.cards.reduce((s, c) => s + c.count, 0)} รายการ · รับของแล้ว ${money(r.cards.reduce((s, c) => s + c.received, 0))}</small></div>
            <div class="cat-bar"></div>
            <div class="cat-total">${money(r.cards.reduce((s, c) => s + c.total, 0))}</div>
          </div>` : '<div class="empty">ไม่มีข้อมูลในช่วงเวลานี้</div>'}
      </div>`;

    const $from = $view.querySelector("#from"), $to = $view.querySelector("#to"), $st = $view.querySelector("#st");
    const syncLink = () => {
      range = { from: $from.value, to: $to.value };
      $view.querySelector("#xlsx").href = "/api/export.xlsx?" + new URLSearchParams({ from: range.from, to: range.to, status: $st.value });
    };
    // เลือกวันที่เสร็จ ให้ปฏิทินหุบทันที แล้วค่อยคำนวณใหม่
    [$from, $to].forEach((el) => el.addEventListener("change", () => {
      el.blur();
      syncLink();
      setTimeout(report, 0);
    }));
    $st.addEventListener("change", syncLink);
    $view.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
      const now = new Date();
      const p = b.dataset.preset;
      if (p === "all") range = { from: "", to: "" };
      else if (p === "this") range = { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
      else if (p === "last") range = { from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) };
      else if (p === "3m") range = { from: ymd(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: ymd(now) };
      else if (p === "year") range = { from: ymd(new Date(now.getFullYear(), 0, 1)), to: ymd(now) };
      report();
    }));

    $view.querySelector("#wDate")?.addEventListener("change", (e) => e.target.blur());

    // บันทึกยอดเบิก
    $view.querySelector("#wf").addEventListener("submit", async (e) => {
      e.preventDefault();
      const amount = parseFloat($view.querySelector("#wAmount").value.replace(/[฿,\s]/g, ""));
      if (!amount || amount <= 0) return toast("ใส่จำนวนเงินมากกว่า 0", true);
      try {
        await api("/withdrawals", { method: "POST", body: { amount, date: $view.querySelector("#wDate").value || null, note: $view.querySelector("#wNote").value || null } });
        toast("บันทึกยอดเบิก " + money(amount) + " แล้ว");
        report();
      } catch (err) { toast(err.message, true); }
    });
    $view.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("ลบรายการเบิกนี้?")) return;
      await api("/withdrawals/" + b.dataset.del, { method: "DELETE" });
      toast("ลบแล้ว");
      report();
    }));

    syncLink();
  }

  // กราฟแท่งแบบ SVG สีเดียว (ไม่ต้องใช้ไลบรารีภายนอก)
  function barChart(months, max) {
    const W = 760, H = 250, padL = 52, padR = 12, padT = 26, padB = 34;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const step = plotW / months.length;
    const bw = Math.min(46, step - 10);
    const y = (v) => padT + plotH - (v / max) * plotH;
    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const val = max * f, yy = y(val);
      return `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"></line>
              <text x="${padL - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#5B6169">${f === 0 ? "0" : shortBaht(val)}</text>`;
    }).join("");
    const bars = months.map((m, i) => {
      const h = Math.max(m.total > 0 ? 3 : 0, (m.total / max) * plotH);
      const x = padL + i * step + (step - bw) / 2;
      const top = padT + plotH - h, r = Math.min(4, h);
      const isLast = i === months.length - 1;
      const label = m.label = `${THAI_MONTHS[m.month - 1]} ${String(m.year + 543).slice(-2)}`;
      return `<g class="bar">
        <title>${label} · ${money(m.total)} · ${m.count} รายการ</title>
        <rect x="${padL + i * step}" y="${padT}" width="${step}" height="${plotH}" fill="transparent"></rect>
        ${h > 0 ? `<path d="M${x} ${padT + plotH} V${top + r} a${r} ${r} 0 0 1 ${r} -${r} h${bw - 2 * r} a${r} ${r} 0 0 1 ${r} ${r} V${padT + plotH} Z" fill="${isLast ? "#0E6B63" : "#6BADA6"}"></path>` : ""}
        ${(isLast || m.total === max) && m.total > 0 ? `<text x="${x + bw / 2}" y="${top - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="#16191D">${shortBaht(m.total)}</text>` : ""}
        <text x="${x + bw / 2}" y="${H - 12}" text-anchor="middle" font-size="11" fill="${isLast ? "#16191D" : "#5B6169"}">${THAI_MONTHS[m.month - 1]}</text>
      </g>`;
    }).join("");
    return `<svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟแท่งยอดซื้อรายเดือน 12 เดือนล่าสุด">
      ${grid}
      <line class="axis" x1="${padL}" x2="${W - padR}" y1="${padT + plotH}" y2="${padT + plotH}"></line>
      ${bars}
    </svg>
    <details class="raw"><summary>ดูเป็นตาราง</summary>
      <table class="mini"><tr><th>เดือน</th><th>จำนวน</th><th>ยอดซื้อ</th></tr>
      ${months.map((m) => `<tr><td>${THAI_MONTHS[m.month - 1]} ${m.year + 543}</td><td>${m.count}</td><td>${money(m.total)}</td></tr>`).join("")}
      </table></details>`;
  }

  // แสดงเวอร์ชันของโปรแกรมที่รันอยู่ ใช้ตรวจว่าอัปเดตแล้วจริงไหม
  api("/version").then((v) => {
    appInfo = v;
    const el = document.getElementById("ver");
    if (el) el.textContent = "เวอร์ชัน " + v.version;
  }).catch(() => {
    const el = document.getElementById("ver");
    if (el) el.textContent = "เวอร์ชันเว็บ";
  });

  // ลูกศรซ้าย/ขวาบนคีย์บอร์ด = ดูรายการก่อนหน้า / ถัดไป (เฉพาะหน้ารายละเอียด)
  document.addEventListener("keydown", (e) => {
    if (!location.hash.startsWith("#/order/")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowLeft" && pager.prev) { e.preventDefault(); goRel("prev"); }
    if (e.key === "ArrowRight" && pager.next) { e.preventDefault(); goRel("next"); }
  });

  render();
})();
