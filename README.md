# ParcelTrack (เวอร์ชันเว็บล้วน)

บันทึกคำสั่งซื้อจากภาพหน้าจอ แล้วยิง QR / บาร์โค้ดยืนยันรับพัสดุ — แปลงมาจากโปรแกรม ParcelTrack (ASP.NET Core)
ให้เป็นเว็บ HTML/JavaScript ล้วน **ไม่ต้องติดตั้ง .NET / Tesseract / เปิดหน้าต่างสีดำ** เปิดผ่าน GitHub Pages ได้เลย

ทำได้ครบเหมือนเดิม: สแกนภาพหน้าจอ (OCR ภาษาไทย), ตรวจแล้วบันทึก (กันบันทึกซ้ำ), ยิง QR / บาร์โค้ด / เครื่องยิง USB,
รูปรวมตาม ID No., รายงานสรุปรายเดือน + ยอดเบิก, ส่งออก Excel / CSV, แชร์เข้าไลน์ (.xlsx + รูป / .zip)

## สิ่งที่ต่างจากโปรแกรมบนคอม

| | โปรแกรมเดิม (.exe) | เวอร์ชันเว็บนี้ |
|---|---|---|
| อ่านภาพ (OCR) | Tesseract บนคอม | Tesseract.js ในเบราว์เซอร์ (ใช้ไฟล์ภาษาไทยชุดเดิมใน `tessdata/`) |
| เก็บข้อมูล | `C:\ParcelTrack\data` | IndexedDB ในเบราว์เซอร์ของแต่ละเครื่อง |
| มือถือกับคอม | ใช้ข้อมูลชุดเดียวกันผ่าน Wi-Fi | **ข้อมูลแยกกัน** ย้ายด้วยไฟล์สำรอง (เมนู "มือถือ & สำรองข้อมูล") |
| กล้องสดบนมือถือ | ต้องเข้าผ่าน https ของโปรแกรม | GitHub Pages เป็น https อยู่แล้ว ใช้ได้เลย |

> ล้างข้อมูลเว็บไซต์ / ใช้โหมดไม่ระบุตัวตน = ข้อมูลหาย ควรกด **ดาวน์โหลดไฟล์สำรอง** เป็นระยะ

## ย้ายข้อมูลจากโปรแกรมเดิม
เมนู **มือถือ & สำรองข้อมูล > เลือกไฟล์ที่จะนำเข้า** แล้วเลือกพร้อมกัน:
`C:\ParcelTrack\data\orders.json`, `withdrawals.json`, `control-counter.json` และรูป `.jpg` ทั้งหมดใน `data\uploads`

## เปิดใช้งานผ่าน GitHub Pages
1. GitHub Desktop: **Publish repository** (จะเลือก Private ก็ได้ แต่ GitHub Pages ของ repo private ต้องใช้แพ็กเกจที่เสียเงิน)
2. ที่หน้า repo บน github.com: **Settings > Pages > Build and deployment** เลือก Source = *Deploy from a branch*,
   Branch = `main` / `/ (root)` แล้วกด Save
3. รอ 1–2 นาที จะได้ลิงก์ `https://<ชื่อผู้ใช้>.github.io/ParcelTrack-web/`

ข้อมูลคำสั่งซื้อไม่ได้อยู่ใน repo นี้ (อยู่ในเบราว์เซอร์ของแต่ละเครื่อง) repo เป็น public ได้โดยไม่เปิดเผยข้อมูลลูกค้า
**อย่า commit ไฟล์สำรอง `ParcelTrack-backup-*.json` หรือโฟลเดอร์ `data/` ลง repo** (`.gitignore` กันไว้ให้แล้ว)

## ลองบนคอมก่อน publish
เปิดผ่านเว็บเซิร์ฟเวอร์เล็ก ๆ (ดับเบิลคลิก `index.html` ตรง ๆ บางเบราว์เซอร์จะอ่านภาพไม่ได้):
```
cd ParcelTrack-web
python -m http.server 8000
```
แล้วเปิด http://localhost:8000

## โครงสร้างไฟล์
```
index.html            หน้าเว็บ
app.js / app.css      หน้าจอทั้งหมด (มาจากโปรแกรมเดิมเกือบทั้งไฟล์)
backend.js            แทนโปรแกรมฝั่งคอม: ตอบคำสั่ง /api/... ในเบราว์เซอร์, เก็บข้อมูล, OCR, สร้าง Excel/ZIP, สำรอง/นำเข้า
parser.js             แยกข้อความ OCR เป็นช่องข้อมูล + จับคู่ QR (พอร์ตจาก OrderTextParser.cs / ScanMatcher.cs)
tessdata/             ข้อมูลภาษาไทย + อังกฤษของ OCR
vendor/               html5-qrcode, qrcode.js, Tesseract.js
```
แอปร้านค้าไหนอ่านช่องไม่ได้ ให้เพิ่มคำค้นใน `parser.js` (เหมือนที่เคยแก้ `OrderTextParser.cs`)

## ไลบรารีที่ใช้
- [Tesseract.js](https://github.com/naptha/tesseract.js) 5.1.1 (Apache-2.0)
- [html5-qrcode](https://github.com/mebjas/html5-qrcode) (Apache-2.0)
- qrcode-generator (MIT)
