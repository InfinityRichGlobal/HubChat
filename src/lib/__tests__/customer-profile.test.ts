import { describe, expect, it } from 'vitest';
import { customerProfileUrl } from '@/lib/customer-profile';

describe('customerProfileUrl', () => {
  it('สร้างลิงก์ Instagram จาก username ที่ Meta คืนมา', () => {
    expect(customerProfileUrl('instagram', '@or_kra')).toBe('https://www.instagram.com/or_kra/');
  });

  it('ไม่เดาลิงก์ Facebook จาก PSID', () => {
    expect(customerProfileUrl('facebook', '123456789')).toBeNull();
  });

  it('ปฏิเสธ username ที่ไม่ปลอดภัย', () => {
    expect(customerProfileUrl('instagram', '../someone')).toBeNull();
  });
});
