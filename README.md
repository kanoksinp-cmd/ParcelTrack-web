# ParcelTrack (เวอร์ชันเว็บล้วน)

บันทึกคำสั่งซื้อจากภาพหน้าจอ แล้วยิง QR / บาร์โค้ดยืนยันรับพัสดุ — แปลงมาจากโปรแกรม ParcelTrack (ASP.NET Core)
ให้เป็นเว็บ HTML/JavaScript ล้วน **ไม่ต้องติดตั้ง .NET / Tesseract / เปิดหน้าต่างสีดำ** เปิดผ่าน GitHub Pages ได้เลย
เก็บข้อมูลบน Supabase จึงใช้ข้อมูลชุดเดียวกันทั้งมือถือและคอม

ทำได้ครบเหมือนเดิม: สแกนภาพหน้าจอ (OCR ภาษาไทย), ตรวจแล้วบันทึก (กันบันทึกซ้ำ), ยิง QR / บาร์โค้ด / เครื่องยิง USB,
รูปรวมตาม ID No., รายงานสรุปรายเดือน + ยอดเบิก, ส่งออก Excel / CSV, แชร์เข้าไลน์ (.xlsx + รูป / .zip)

## ช่วยให้อ่านแม่นและใช้ง่าย
- **วางภาพได้ทุกหน้า:** กด Ctrl+V หรือลากภาพหน้าจอมาวางที่ไหนก็ได้ จะไปหน้าอ่านข้อมูลให้เอง
- **ช่องสีส้ม = อ่านได้แต่ไม่ชัด** (ความมั่นใจของ OCR ต่ำ หรือรูปแบบเลขไม่ตรงกับแอปร้านค้า) ควรเทียบกับรูป
  ช่องสีเหลือง = อ่านไม่ได้ · ช่องสีฟ้า = เติมจากค่าที่เคยแก้ไว้
- **จำค่าที่เคยแก้:** ถ้าแก้ชื่อร้าน/ชื่อผู้รับ/ที่อยู่ ฯลฯ ก่อนบันทึก ครั้งหน้าที่ OCR อ่านเพี้ยนแบบเดิมจะแก้ให้เอง (เก็บใน `pt_meta` คีย์ `corrections`)
- รู้จักรูปแบบหน้าคำสั่งซื้อของ **Shopee / Lazada / TikTok Shop**: เลขคำสั่งซื้อ เลขพัสดุ (SPX, Flash, J&T, Kerry, Lazada Express, ไปรษณีย์ไทย ฯลฯ)
  ยอดสุทธิ (ไม่หยิบยอดก่อนส่วนลด) และ ฿ ที่ OCR อ่านเป็นเลข 8

## ข้อมูลเก็บที่ Supabase
- ใช้คนเดียว **ไม่ต้องล็อกอิน** เปิดเว็บบนมือถือหรือคอมก็เห็นข้อมูลชุดเดียวกันทันที
- ตาราง `pt_orders`, `pt_withdrawals`, `pt_meta` และ bucket `parceltrack` (รูปรวมภาพหน้าจอ) อยู่ใน Supabase project **trip-splitter**
- ⚠️ เพราะไม่มีล็อกอิน ใครที่รู้ลิงก์เว็บ (หรือนำ key ใน `config.js` ไปใช้) จะอ่าน แก้ และลบข้อมูลได้
  อย่าแชร์ลิงก์ และกด **ดาวน์โหลดไฟล์สำรอง** ไว้เป็นระยะ
- `config.js` มีแค่ URL กับ publishable key **ห้ามใส่ service_role / secret key**
- OCR ทำในเบราว์เซอร์ (Tesseract.js) ไม่ได้ส่งภาพออกไปอ่านที่อื่น
- Supabase แพ็กเกจฟรีจะหยุด project ถ้าไม่มีการใช้งาน 7 วัน ให้เข้า supabase.com แล้วกด Restore

## ย้ายข้อมูลจากโปรแกรมเดิม
เมนู **มือถือ & สำรองข้อมูล > เลือกไฟล์ที่จะนำเข้า** แล้วเลือกพร้อมกัน:
`C:\ParcelTrack\data\orders.json`, `withdrawals.json`, `control-counter.json` และรูป `.jpg` ทั้งหมดใน `data\uploads`

## เปิดใช้งานผ่าน GitHub Pages
1. GitHub Desktop: **Publish repository** (จะเลือก Private ก็ได้ แต่ GitHub Pages ของ repo private ต้องใช้แพ็กเกจที่เสียเงิน)
2. ที่หน้า repo บน github.com: **Settings > Pages > Build and deployment** เลือก Source = *Deploy from a branch*,
   Branch = `main` / `/ (root)` แล้วกด Save
3. รอ 1–2 นาที จะได้ลิงก์ `https://<ชื่อผู้ใช้>.github.io/ParcelTrack-web/`

ข้อมูลคำสั่งซื้อไม่ได้อยู่ใน repo นี้ (อยู่ใน Supabase)
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
backend.js            แทนโปรแกรมฝั่งคอม: ตอบคำสั่ง /api/... ในเบราว์เซอร์, เก็บข้อมูลบน Supabase, OCR, สร้าง Excel/ZIP, สำรอง/นำเข้า
config.js             URL + publishable key ของ Supabase
sw.js                 ยกเลิกโหมดออฟไลน์ที่เคยติดตั้ง (ลบทิ้งได้หลังทุกเครื่องเปิดเว็บแล้ว)
parser.js             แยกข้อความ OCR เป็นช่องข้อมูล + จับคู่ QR (พอร์ตจาก OrderTextParser.cs / ScanMatcher.cs)
tessdata/             ข้อมูลภาษาไทย + อังกฤษของ OCR
vendor/               html5-qrcode, qrcode.js, Tesseract.js
```
แอปร้านค้าไหนอ่านช่องไม่ได้ ให้เพิ่มคำค้นใน `parser.js` (เหมือนที่เคยแก้ `OrderTextParser.cs`)

## ไลบรารีที่ใช้
- [Tesseract.js](https://github.com/naptha/tesseract.js) 5.1.1 (Apache-2.0)
- [html5-qrcode](https://github.com/mebjas/html5-qrcode) (Apache-2.0)
- qrcode-generator (MIT)
- [supabase-js](https://github.com/supabase/supabase-js) 2.119.2 (MIT)
