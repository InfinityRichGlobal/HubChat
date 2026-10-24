# แก้เส้นทาง Instagram Private Reply — 24 ตุลาคม 2026

HubChat ใช้ Facebook Page Access Token บน `graph.facebook.com` และเก็บ Instagram account ID ใน `pages.page_id` สำหรับรับ webhook และจัดการคอมเมนต์

เอกสาร Meta ของ Messenger API for Instagram ระบุให้ส่ง Private Reply ผ่าน `/{FACEBOOK_PAGE_ID}/messages` พร้อม `recipient.comment_id` แต่ adapter เดิมนำ Instagram account ID มาใช้เป็นผู้ส่ง

อ้างอิง: https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/private-replies (อ่านจากเอกสาร Meta โดยตรง วันที่ 24 ตุลาคม 2026)

## พฤติกรรมหลังแก้

- อ่าน `me?fields=id,instagram_business_account` ด้วย token เดิม และตรวจบัญชี IG ให้ตรงกับรายการที่กำลังส่ง
- ส่งผ่าน Facebook Page ID ที่ตรวจได้ โดยไม่เปลี่ยน ID ที่ใช้รับ webhook และจัดการ public comment
- ถ้าตรวจตัวตนไม่ได้ จะไม่ส่งข้อความและคืนสิทธิ์จอง เพราะยังไม่ได้เรียก Send API
- ถ้าส่งแล้วไม่ทราบผล จะไม่ลอง endpoint อื่นและไม่เปิดให้ส่งซ้ำ ตามระบบป้องกันข้อความซ้ำเดิม
- การเปิดอ่านหรือทำเครื่องหมายอ่านแล้วไม่ล้าง `last_error_th` และไม่นำรายการที่ยังส่งไม่สำเร็จออกจาก “ต้องตรวจสอบ”

## การตรวจสอบ

ทดสอบการเลือก Page ID, บัญชีเชื่อมไม่ตรง, lookup ล้มเหลว, การไม่ fallback หลังส่งแล้วไม่ทราบผล และการเก็บข้อผิดพลาดหลังอ่านคอมเมนต์

ตรวจแบบอ่านอย่างเดียวกับ token จริงแล้ว ยืนยันว่าการหาเพจ Facebook ที่เชื่อมกับ Instagram ทำงานสำเร็จ

การทดสอบส่งก่อนแก้ได้รับ Meta error `200 / 2534066` และไม่สำเร็จ การผ่าน unit tests หรืออ่านตัวตนได้ยังไม่ใช่หลักฐานว่าข้อความส่งถึงผู้รับ ต้องตรวจผล Send API หลังแก้โดยได้รับอนุญาตให้ส่งถึงผู้รับทดสอบก่อน
