// ทดสอบตัวแยกข้อความ OCR (parser.js) — รัน: node --test tests/
// เพิ่มเคสใหม่: เปิด "ดูข้อความที่อ่านได้จากภาพ" ในหน้าตรวจข้อมูล คัดลอกมาใส่ใน fixtures แล้วเขียนค่าที่ต้องได้
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../parser.js", import.meta.url), "utf8"), ctx);
const P = ctx.window.PTParser;

const shopeeLike = `รายละเอียดคำสั่งซื้อ
ที่อยู่ในการจัดส่ง
สมชาย ใจดี (0812345678)
99/1 ถนนสุขุมวิท แขวงคลองตัน เขตคลองเตย กรุงเทพมหานคร 10110
Flash Express
หมายเลขพัสดุ: TH12345678901A
ร้านซุปเปอร์ไอที
Official Store
หูฟังไร้สาย Bluetooth รุ่น Pro Max
สีดำ
฿1,290.00   x1
รวมยอดสั่งซื้อ  ฿1,250.00
หมายเลขคำสั่งซื้อ 2611240ABCDEF12
วันที่สั่งซื้อ 24 พ.ย. 2026 20:15
บัตรเครดิต **** 4321
ชำระเงินสำเร็จ`;

test("อ่านหน้ารายละเอียดคำสั่งซื้อครบทุกช่องหลัก", () => {
  const d = P.parseText(shopeeLike);
  assert.equal(d.trackingNumber, "TH12345678901A");
  assert.equal(d.carrier, "Flash Express");
  assert.equal(d.orderNumber, "2611240ABCDEF12");
  assert.equal(d.totalAmount, 1250);
  assert.equal(d.orderedAt, "2026-11-24T20:15:00");
  assert.equal(d.paymentMethod, "บัตรเครดิต / เดบิต");
  assert.equal(d.cardLast4, "4321");
  assert.equal(d.paymentConfirmed, true);
  assert.equal(d.recipientName, "สมชาย ใจดี (0812345678)");
  assert.match(d.shippingAddress, /10110$/);
  assert.equal(d.shopName, "ร้านซุปเปอร์ไอที");
});

test("ชื่อสินค้าใช้ตำแหน่งบนภาพ: บรรทัดข้างรูปสินค้า เหนือบรรทัดราคา x1", () => {
  const rows = shopeeLike.split("\n");
  const lines = rows.map((text, i) => {
    const item = /หูฟัง|^สีดำ|x1$/.test(text);
    return { text, left: item ? 300 : 20, top: i * 40, right: 900, bottom: i * 40 + 30 };
  });
  const d = P.parseOcr({ text: shopeeLike, lines, width: 1000, height: rows.length * 40 });
  assert.equal(d.productName, "หูฟังไร้สาย Bluetooth รุ่น Pro Max");
  assert.equal(d.variant, "สีดำ");
  assert.ok(d.rawLines.includes("Flash Express"));
});

test("เลขพัสดุ: ตัดช่องว่าง และเปลี่ยนตัว O เป็นเลข 0", () => {
  assert.equal(P.parseText("หมายเลขพัสดุ: ANL FLHO39 07703").trackingNumber, "ANLFLH03907703");
});

test("ยอดเงิน: ฿ ที่ OCR อ่านเป็นเลข 8 ถูกตัดออก แต่ 8,999.00 ไม่ถูกตัด", () => {
  assert.equal(P.parseText("รวมยอดสั่งซื้อ 84,740.45").totalAmount, 4740.45);
  assert.equal(P.parseText("รวมยอดสั่งซื้อ ฿8,999.00").totalAmount, 8999);
  assert.equal(P.parseText("ส่วนลดรวมยอด ฿50.00\nยอดชำระ ฿120.00").totalAmount, 120);
});

test("วันที่: ปี พ.ศ. / ตัวเลข / OCR อ่านเดือนเพี้ยน", () => {
  assert.equal(P.parseDate("วันที่สั่งซื้อ 31 ส.ค. 2569 21:11"), "2026-08-31T21:11:00");
  assert.equal(P.parseDate("Order Time 31/08/2026 09:05"), "2026-08-31T09:05:00");
  assert.equal(P.parseDate("2026-01-02 10:00"), "2026-01-02T10:00:00");
  assert.equal(P.parseDate("12 nv. 2026"), "2026-09-12T00:00:00");   // n=ก v=ย -> ก.ย.
  assert.equal(P.parseDate("31 ก.พ. 2026"), null);                    // วันที่ไม่มีจริง
});

test("ำ ที่ OCR แยกเป็น ํา ถูกรวมกลับ", () => {
  assert.equal(P.normalize("คําสั่งซื้อ"), "คำสั่งซื้อ");
});

test("รวมผลหลายภาพ: ช่องที่ขาดเติมจากภาพถัดไป", () => {
  const a = P.parseText("หมายเลขพัสดุ: TH12345678901A");
  const b = P.parseText("รวมยอดสั่งซื้อ ฿99.00");
  const m = P.merge([a, b]);
  assert.equal(m.trackingNumber, "TH12345678901A");
  assert.equal(m.totalAmount, 99);
});

test("จับคู่ QR: เลขพัสดุตรง ๆ, ลิงก์ติดตามพัสดุ, ให้รายการที่ยังรอของก่อน", () => {
  const orders = [
    { id: "1", status: "Received", trackingNumber: "TH12345678901A" },
    { id: "2", status: "Pending", trackingNumber: "TH12345678901A" },
    { id: "3", status: "Pending", orderNumber: "2611240ABCDEF12" },
  ];
  assert.equal(P.findMatch(orders, "TH12345678901A").id, "2");
  assert.equal(P.findMatch(orders, "https://track.example.com/?n=TH12345678901A").id, "2");
  assert.equal(P.findMatch(orders, "2611240ABCDEF12").id, "3");
  assert.equal(P.findMatch(orders, "XYZ"), null);
});

test("แก้รหัสรุ่นที่ OCR อ่านเลข 6 เป็น é", () => {
  assert.equal(P.fixModelCode("Galaxy Aét"), "Galaxy A6t");
});

test("TSV ของ Tesseract: รวมคำภาษาไทยติดกัน คำอังกฤษเว้นวรรค", () => {
  const tsv = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "1\t1\t0\t0\t0\t0\t0\t0\t500\t300\t-1\t",
    "5\t1\t1\t1\t1\t1\t10\t10\t40\t20\t90\tสวัส",
    "5\t1\t1\t1\t1\t2\t51\t10\t30\t20\t90\tดี",
    "5\t1\t1\t1\t1\t3\t100\t10\t50\t20\t90\tHello",
  ].join("\n");
  const r = P.parseTsv(tsv);
  assert.equal(r.width, 500);
  assert.equal(r.lines[0].text, "สวัสดี Hello");
});
