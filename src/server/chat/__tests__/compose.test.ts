/**
 * ชุดทดสอบการประกอบข้อความสำเร็จรูป (ก้อน 2 ข้อ 1.8 / 1.9 / 1.10)
 * ===========================================================================
 * 🔴 กฎที่ห้ามพัง : ข้อความที่ยังไม่สมบูรณ์ ต้องไม่หลุดไปถึงลูกค้า
 */
import { describe, it, expect } from 'vitest';
import {
  resolveVariables, isReadyToSend, explainMissing,
  shippingInfoText, productText, orderSummaryText, baht,
} from '../compose';

describe('แทนค่าตัวแปรในชุดคำตอบ', () => {
  it('มีค่าครบ → แทนได้หมด และพร้อมส่ง', () => {
    const r = resolveVariables('สวัสดีคุณ {{customer_name}} ออเดอร์ {{order_number}} ยอด {{order_total}}', {
      customer_name: 'สมชาย',
      order_number: 'ORD-001',
      order_total: '1,500 บาท',
    });
    expect(r.text).toBe('สวัสดีคุณ สมชาย ออเดอร์ ORD-001 ยอด 1,500 บาท');
    expect(isReadyToSend(r)).toBe(true);
  });

  it('🔴 ไม่มีค่า → ต้องคง {{...}} ไว้ ไม่ใช่แทนด้วยช่องว่าง', () => {
    /**
     * ถ้าแทนด้วยช่องว่าง ข้อความจะกลายเป็น "เลขพัสดุคือ  ค่ะ"
     * ซึ่งดู "ปกติพอจะกดส่ง" แล้วแอดมินที่รีบจะส่งออกไปโดยไม่ทันสังเกต
     * การคงโค้ดไว้ทำให้ผิดจนมองข้ามไม่ได้
     */
    const r = resolveVariables('เลขพัสดุคือ {{tracking_number}} ค่ะ', {});
    expect(r.text).toContain('{{tracking_number}}');
    expect(r.missing).toEqual(['tracking_number']);
    expect(isReadyToSend(r)).toBe(false);
  });

  it('🔴 ค่าที่เป็นช่องว่างล้วน ต้องนับว่าไม่มีค่า', () => {
    const r = resolveVariables('{{carrier}}', { carrier: '   ' });
    expect(r.missing).toEqual(['carrier']);
  });

  it('ตัวแปรที่ระบบไม่รู้จัก → เตือน และไม่แทนค่า', () => {
    const r = resolveVariables('ยอด {{grand_total}} บาท', {});
    expect(r.unknown).toEqual(['grand_total']);
    expect(r.text).toContain('{{grand_total}}');
    expect(isReadyToSend(r)).toBe(false);
  });

  it('รองรับช่องว่างรอบชื่อตัวแปร', () => {
    const r = resolveVariables('{{ customer_name }}', { customer_name: 'สมหญิง' });
    expect(r.text).toBe('สมหญิง');
  });

  it('ตัวแปรเดิมซ้ำหลายที่ → แทนครบทุกที่ และนับว่าขาดครั้งเดียว', () => {
    const r = resolveVariables('{{carrier}} / {{carrier}}', {});
    expect(r.missing).toEqual(['carrier']);
    const ok = resolveVariables('{{carrier}} / {{carrier}}', { carrier: 'Flash' });
    expect(ok.text).toBe('Flash / Flash');
  });

  it('ข้อความไม่มีตัวแปรเลย → ผ่านตามปกติ', () => {
    const r = resolveVariables('ขอบคุณค่ะ', {});
    expect(isReadyToSend(r)).toBe(true);
  });

  it('คำเตือนต้องบอกเป็นภาษาไทยที่อ่านรู้เรื่อง', () => {
    const r = resolveVariables('{{tracking_number}} {{order_total}}', {});
    const msg = explainMissing(r);
    expect(msg).toContain('เลขพัสดุ');
    expect(msg).toContain('ยอดรวม');
  });
});

describe('ข้อมูลจัดส่ง', () => {
  const full = {
    recipient_name: 'สมชาย ใจดี',
    phone: '0812345678',
    address: '123 หมู่ 4 ต.บางรัก',
    postcode: '10500',
    carrier: 'Flash',
    tracking_no: 'TH123456',
  };

  it('ข้อมูลครบ → ได้ข้อความครบและไม่มีอะไรขาด', () => {
    const r = shippingInfoText(full);
    expect(r.missing_th).toEqual([]);
    expect(r.text).toContain('สมชาย ใจดี');
    expect(r.text).toContain('0812345678');
    expect(r.text).toContain('10500');
    expect(r.text).toContain('TH123456');
  });

  it('🔴 ขาดที่อยู่ → ต้องบอกว่าขาด ไม่ใช่ประกอบข้อความครึ่ง ๆ กลาง ๆ', () => {
    /**
     * ข้อความจัดส่งที่ขาดที่อยู่ = ลูกค้ายืนยันของที่ไม่มีอยู่จริง
     * แล้วพัสดุจะถูกส่งผิดที่ ซึ่งแก้ทีหลังไม่ได้
     */
    const r = shippingInfoText({ ...full, address: null });
    expect(r.missing_th).toContain('ที่อยู่');
  });

  it('ขาดชื่อและเบอร์ → บอกครบทั้งสอง', () => {
    const r = shippingInfoText({ ...full, recipient_name: '  ', phone: null });
    expect(r.missing_th).toEqual(['ชื่อผู้รับ', 'เบอร์โทร']);
  });

  it('⭐ ยังไม่มีเลขพัสดุ ไม่นับว่าขาด — ยังไม่ได้ส่งของก็เรื่องปกติ', () => {
    const r = shippingInfoText({ ...full, tracking_no: null, carrier: null });
    expect(r.missing_th).toEqual([]);
    expect(r.text).not.toContain('เลขพัสดุ');
  });
});

describe('แทรกสินค้า', () => {
  it('ใส่ชื่อ ราคา และโปรที่ใช้ได้', () => {
    const r = productText([
      { name: 'เสื้อยืด', variant: 'ดำ', price: 590, promotion_th: 'ซื้อ 2 แถม 1' },
    ]);
    expect(r.text).toContain('เสื้อยืด (ดำ)');
    expect(r.text).toContain('590 บาท');
    expect(r.text).toContain('ซื้อ 2 แถม 1');
  });

  it('ไม่มีสี → ไม่ต้องมีวงเล็บว่าง', () => {
    const r = productText([{ name: 'กางเกง', variant: null, price: 890, promotion_th: null }]);
    expect(r.text).toBe('กางเกง — 890 บาท');
  });

  it('ไม่เลือกสินค้าเลย → บอกว่าขาด', () => {
    expect(productText([]).missing_th).toContain('สินค้า');
  });
});

describe('สรุปออเดอร์', () => {
  const order = {
    order_no: 'ORD-260826-001',
    items: [{ name: 'เสื้อยืด', variant: 'ดำ', qty: 2, total: 1180 }],
    subtotal: 1180,
    shipping_fee: 50,
    discount: 100,
    total: 1130,
    payment_method_th: 'เก็บเงินปลายทาง',
  };

  it('มีครบทุกบรรทัดที่ลูกค้าต้องเห็น', () => {
    const r = orderSummaryText(order);
    expect(r.text).toContain('ORD-260826-001');
    expect(r.text).toContain('เสื้อยืด (ดำ) x2');
    expect(r.text).toContain('ส่วนลด : -100 บาท');
    expect(r.text).toContain('ค่าส่ง : 50 บาท');
    expect(r.text).toContain('รวมทั้งหมด : 1,130 บาท');
    expect(r.text).toContain('เก็บเงินปลายทาง');
  });

  it('ไม่มีส่วนลด/ค่าส่ง → ไม่ต้องขึ้นบรรทัดเปล่า', () => {
    const r = orderSummaryText({ ...order, discount: 0, shipping_fee: 0 });
    expect(r.text).not.toContain('ส่วนลด');
    expect(r.text).not.toContain('ค่าส่ง');
  });
});

describe('จัดรูปเงิน', () => {
  it('ใส่ลูกน้ำหลักพัน', () => {
    expect(baht(1130)).toBe('1,130 บาท');
    expect(baht(1000000)).toBe('1,000,000 บาท');
  });

  it('เศษสตางค์แสดงได้ แต่ไม่บังคับทศนิยม', () => {
    expect(baht(99)).toBe('99 บาท');
    expect(baht(99.5)).toBe('99.5 บาท');
  });
});
