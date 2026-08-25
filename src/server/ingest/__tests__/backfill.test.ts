/**
 * ชุดทดสอบตัวแกะไฟล์แนบของ Conversations API (รอบ 7)
 * ===========================================================================
 * 🔴 ทำไมต้องมีชุดนี้แยกจากตัวแกะ webhook :
 *    รูปร่างข้อมูลของสองที่ "ไม่เหมือนกัน" ทั้งที่เป็น Meta เหมือนกัน
 *    webhook ให้ payload.url ส่วน Conversations API ให้ image_data.url / file_url
 *    ตรงนี้คือจุดที่พลาดง่ายที่สุดของทั้งรอบ
 */
import { describe, it, expect } from 'vitest';
import { parseAttachments } from '../backfill';

describe('แกะไฟล์แนบจาก Conversations API', () => {
  it('รูปภาพ — อ่านลิงก์จาก image_data.url', () => {
    const out = parseAttachments({
      data: [{ mime_type: 'image/jpeg', image_data: { url: 'https://cdn.example/a.jpg' } }],
    });
    expect(out).toEqual([{ type: 'image', url: 'https://cdn.example/a.jpg' }]);
  });

  it('ไฟล์ทั่วไป — อ่านลิงก์จาก file_url', () => {
    const out = parseAttachments({
      data: [{ mime_type: 'application/pdf', file_url: 'https://cdn.example/a.pdf' }],
    });
    expect(out).toEqual([{ type: 'file', url: 'https://cdn.example/a.pdf' }]);
  });

  it('วิดีโอ — จัดชนิดตาม mime', () => {
    const out = parseAttachments({
      data: [{ mime_type: 'video/mp4', file_url: 'https://cdn.example/a.mp4' }],
    });
    expect(out[0].type).toBe('video');
  });

  it('ไม่มี mime แต่มี image_data ให้ถือว่าเป็นรูป', () => {
    const out = parseAttachments({ data: [{ image_data: { url: 'https://cdn.example/b' } }] });
    expect(out[0].type).toBe('image');
  });

  it('ไม่มีลิงก์เลย ต้องตัดทิ้ง — เก็บไว้ก็เปิดไม่ได้ รกจอเปล่า ๆ', () => {
    expect(parseAttachments({ data: [{ mime_type: 'image/png' }] })).toEqual([]);
  });

  it('ข้อมูลเพี้ยน / ไม่มีไฟล์แนบ ต้องไม่ระเบิด', () => {
    expect(parseAttachments(undefined)).toEqual([]);
    expect(parseAttachments({})).toEqual([]);
    expect(parseAttachments({ data: 'ไม่ใช่อาเรย์' } as never)).toEqual([]);
  });
});
