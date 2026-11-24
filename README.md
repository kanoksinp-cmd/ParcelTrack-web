# ParcelTrack (เวอร์ชันเว็บล้วน)

บันทึกคำสั่งซื้อจากภาพหน้าจอ แล้วยิง QR / บาร์โค้ดยืนยันรับพัสดุ — แปลงมาจากโปรแกรม ParcelTrack (ASP.NET Core)
ให้เป็นเว็บ HTML/JavaScript ล้วน **ไม่ต้องติดตั้ง .NET / Tesseract / เปิดหน้าต่างสีดำ** เปิดผ่าน GitHub Pages ได้เลย
เก็บข้อมูลบน Supabase จึงใช้ข้อมูลชุดเดียวกันทั้งมือถือและคอม

ทำได้ครบเหมือนเดิม: สแกนภาพหน้าจอ (OCR ภาษาไทย), ตรวจแล้วบันทึก (กันบันทึกซ้ำ), ยิง QR / บาร์โค้ด / เครื่องยิง USB,
รูปรวมตาม ID No., รายงานสรุปรายเดือน + ยอดเบิก, ส่งออก Excel / CSV, แชร์เข้าไลน์ (.xlsx + รูป / .zip)

## ข้อมูลเก็บที่ Supabase
- **ไม่ต้องล็อกอิน:** เปิด "ลิงก์เชื่อมเครื่อง" (`…/#pair=…`) ครั้งเดียวต่อเครื่อง เครื่องจะจำไว้ตลอด
  เพิ่มมือถือ: เมนู **มือถือ & สำรองข้อมูล > แสดง QR เชื่อมเครื่อง** แล้วส่องด้วยกล้องมือถือ
  **ลิงก์/QR นี้คือกุญแจของข้อมูล อย่าส่งให้คนอื่น และอย่าใส่ลงใน repo**
- ตาราง `pt_orders`, `pt_withdrawals`, `pt_meta` และ bucket `parceltrack` (รูปรวมภาพหน้าจอ) อยู่ใน Supabase project **trip-splitter**
- Row Level Security: อ่าน/เขียนได้เฉพาะเครื่องที่เชื่อมแล้ว คนที่รู้แค่ลิงก์เว็บไม่เห็นอะไรเลย
- `config.js` มีแค่ URL กับ publishable key (เปิดเผยได้) **ห้ามใส่ service_role / secret key**
- OCR ยังทำในเบราว์เซอร์ (Tesseract.js) ไม่ได้ส่งภาพออกไปอ่านที่อื่น
- Supabase แพ็กเกจฟรีจะหยุด project ถ้าไม่มีการใช้งาน 7 วัน ให้เข้า supabase.com แล้วกด Restore

## ย้ายข้อมูลจากโปรแกรมเดิม
เมนู **มือถือ & สำรองข้อมูล > เลือกไฟล์ที่จะนำเข้า** แล้วเลือกพร้อมกัน:
`C:\ParcelTrack\data\orders.json`, `withdrawals.json`, `control-counter.json` และรูป `.jpg` ทั้งหมดใน `data\uploads`

## ใช้งานแบบแอป + ออฟไลน์
- เปิดเว็บบนมือถือแล้วกด แชร์ > "เพิ่มไปยังหน้าจอโฮม" (Android: Chrome > "ติดตั้งแอป") จะได้ไอคอนเหมือนแอปจริง
- `sw.js` เก็บไฟล์แอปและตัวอ่านภาพ (~13 MB) ไว้ในเครื่อง เปิดครั้งต่อไปเร็วขึ้นและเปิดได้แม้ไม่มีเน็ต
- เน็ตหลุดระหว่างใช้งาน (เช่น ยิง QR รับพัสดุหน้าบ้าน) งานจะถูกเก็บไว้ในเครื่อง แล้วส่งขึ้น Supabase เองเมื่อเน็ตกลับมา
  เลข ID No. ที่ออกตอนออฟไลน์จะเป็นชุด 9xxx (เช่น PT-261124-9001) เพื่อไม่ชนกับเลขจากฐานข้อมูล
- แก้รายการเดียวกันจากสองเครื่อง: เครื่องที่บันทึกทีหลังจะได้รับคำเตือนให้เปิดรายการใหม่ ไม่เขียนทับของอีกเครื่องเงียบ ๆ

## OCR แบบ Google Vision (เลือกเปิดได้)
อ่านภาษาไทยแม่นกว่า Tesseract มาก ฟรี 1,000 ภาพ/เดือน เกินจากนั้นประมาณ $1.50 ต่อ 1,000 ภาพ
1. Google Cloud Console: สร้าง project > เปิด **Cloud Vision API** > ผูกบัตร (Billing) > APIs & Services > Credentials > **Create API key**
   (แนะนำ: Restrict key ให้ใช้ได้เฉพาะ Cloud Vision API)
2. Supabase Dashboard > project trip-splitter > **Edge Functions > Secrets** > เพิ่ม `GOOGLE_VISION_API_KEY` = key ที่ได้
3. ในแอป: เมนู **มือถือ & สำรองข้อมูล > ตัวอ่านภาพ** เลือก **Google Vision**
ถ้า Google Vision ใช้ไม่ได้ แอปจะกลับไปอ่านในเครื่องให้เอง Edge Function อยู่ที่ `supabase/functions/pt-ocr/` (ใช้ได้เฉพาะบัญชีเจ้าของ)

## สำรองข้อมูล
- **อัตโนมัติทุกวันอาทิตย์ 21:13:** scheduled task ของ Claude ดึงข้อมูลคำสั่งซื้อ/ยอดเบิกจาก Supabase ไปเก็บที่ `C:\ParcelTrack\cloud-backup\` (ไม่รวมรูป คอมต้องเปิดอยู่)
- **ครบทุกอย่างรวมรูป:** ปุ่ม "ดาวน์โหลดไฟล์สำรอง" ในแอป แอปจะเตือนถ้าไม่ได้กดเกิน 14 วัน

## ทดสอบ
```
node --test tests/*.test.mjs
```
เปิดทดสอบอัตโนมัติบน GitHub: ย้าย `ci/github-actions-test.yml` ไปไว้ที่ `.github/workflows/test.yml` แล้ว push
(หรือบน github.com: Add file > Create new file ตั้งชื่อ `.github/workflows/test.yml` แล้ววางเนื้อหาไฟล์นั้น) ดูผลที่แท็บ Actions ของ repo
เจอร้านที่อ่านผิด: คัดลอกข้อความจาก "ดูข้อความที่อ่านได้จากภาพ" มาเพิ่มเป็นเคสใน `tests/parser.test.mjs` ก่อนแก้ `parser.js`

## เปิดใช้งานผ่าน GitHub Pages
1. GitHub Desktop: **Publish repository** (จะเลือก Private ก็ได้ แต่ GitHub Pages ของ repo private ต้องใช้แพ็กเกจที่เสียเงิน)
2. ที่หน้า repo บน github.com: **Settings > Pages > Build and deployment** เลือก Source = *Deploy from a branch*,
   Branch = `main` / `/ (root)` แล้วกด Save
3. รอ 1–2 นาที จะได้ลิงก์ `https://<ชื่อผู้ใช้>.github.io/ParcelTrack-web/`

ข้อมูลคำสั่งซื้อไม่ได้อยู่ใน repo นี้ (อยู่ใน Supabase เปิดได้เฉพาะเครื่องที่เชื่อมแล้ว) repo เป็น public ได้โดยไม่เปิดเผยข้อมูลลูกค้า
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
backend.js            แทนโปรแกรมฝั่งคอม: ตอบคำสั่ง /api/... ในเบราว์เซอร์, ล็อกอิน + เก็บข้อมูลบน Supabase, OCR, สร้าง Excel/ZIP, สำรอง/นำเข้า
config.js             URL + publishable key ของ Supabase
sw.js                 service worker (ติดตั้งเป็นแอป + เปิดตอนออฟไลน์)
supabase/functions/   Edge Function pt-ocr (Google Vision)
tests/                ชุดทดสอบ parser.js
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
