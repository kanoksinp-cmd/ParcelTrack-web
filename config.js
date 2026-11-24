/* ตั้งค่าการเชื่อมต่อ Supabase
 * publishable key เปิดเผยได้ (ใช้ในเว็บได้) ข้อมูลถูกป้องกันด้วย Row Level Security: แต่ละบัญชีเห็นเฉพาะข้อมูลของตัวเอง
 * ห้ามใส่ service_role / secret key ในไฟล์นี้เด็ดขาด
 */
window.PT_CONFIG = {
  supabaseUrl: "https://kbropcdytqkaruezuvhr.supabase.co",
  supabaseKey: "sb_publishable_zBmkLVtZ-5Doe3bUATxS9g_TV4vYkEI",
  bucket: "parceltrack",
};
