/**
 * ชุดทดสอบตัวแกะ webhook
 * ===========================================================================
 * ใช้ payload หน้าตาเหมือนของจริงจาก Meta
 * ทดสอบได้โดยไม่ต้องมี Meta / ไม่ต้องมีฐานข้อมูล เพราะตัวแกะเป็นฟังก์ชันบริสุทธิ์
 */
import { describe, it, expect } from 'vitest';
import { parseWebhookPayload } from '../parse';
import type { CommentEvent, EchoMessageEvent, InboundMessageEvent } from '../types';

const PAGE = '102938475610293';
const PSID = '7239084751029384';
const T = 1_755_000_000_000; // เวลาคงที่ จะได้ทดสอบซ้ำได้ผลเดิมเสมอ

function messengerBody(messaging: unknown[]) {
  return { object: 'page', entry: [{ id: PAGE, time: T, messaging }] };
}

function inboundOf(events: ReturnType<typeof parseWebhookPayload>): InboundMessageEvent[] {
  return events.filter((e): e is InboundMessageEvent => e.kind === 'inbound_message');
}
function echoOf(events: ReturnType<typeof parseWebhookPayload>): EchoMessageEvent[] {
  return events.filter((e): e is EchoMessageEvent => e.kind === 'echo_message');
}
function commentOf(events: ReturnType<typeof parseWebhookPayload>): CommentEvent[] {
  return events.filter((e): e is CommentEvent => e.kind === 'comment');
}

/* ================================================================== */
describe('ข้อความปกติจาก Messenger', () => {
  it('แกะข้อความตัวอักษรได้ครบทุกฟิลด์', () => {
    const events = parseWebhookPayload(
      messengerBody([
        {
          sender: { id: PSID },
          recipient: { id: PAGE },
          timestamp: T,
          message: { mid: 'mid.abc123', text: 'สนใจโปร 2 ชิ้นค่ะ' },
        },
      ]),
    );

    const [msg] = inboundOf(events);
    expect(msg).toBeDefined();
    expect(msg.platform).toBe('facebook');
    expect(msg.page_meta_id).toBe(PAGE);
    expect(msg.psid).toBe(PSID);
    expect(msg.meta_message_id).toBe('mid.abc123');
    expect(msg.text).toBe('สนใจโปร 2 ชิ้นค่ะ');
    expect(msg.sent_at).toBe(new Date(T).toISOString());
    expect(msg.attachments).toEqual([]);
  });

  it('แกะรูปภาพได้ และเก็บลิงก์ไว้', () => {
    const events = parseWebhookPayload(
      messengerBody([
        {
          sender: { id: PSID },
          recipient: { id: PAGE },
          timestamp: T,
          message: {
            mid: 'mid.img',
            attachments: [
              { type: 'image', payload: { url: 'https://example.test/slip.jpg' } },
              // template ไม่ใช่ไฟล์ ต้องถูกตัดทิ้ง
              { type: 'template', payload: { template_type: 'generic' } },
            ],
          },
        },
      ]),
    );

    const [msg] = inboundOf(events);
    expect(msg.text).toBeNull();
    expect(msg.attachments).toEqual([{ type: 'image', url: 'https://example.test/slip.jpg' }]);
  });

  it('หลายข้อความในก้อนเดียว ต้องได้ครบทุกอัน', () => {
    const events = parseWebhookPayload(
      messengerBody([
        { sender: { id: PSID }, recipient: { id: PAGE }, timestamp: T, message: { mid: 'a', text: '1' } },
        { sender: { id: PSID }, recipient: { id: PAGE }, timestamp: T + 1, message: { mid: 'b', text: '2' } },
      ]),
    );
    expect(inboundOf(events).map((m) => m.meta_message_id)).toEqual(['a', 'b']);
  });
});

/* ================================================================== */
describe('ที่มาของแชท (สเปกหัวข้อ 1 ข้อ 4)', () => {
  it('ทักมาจากแอด → ADS พร้อม ad_id', () => {
    const events = parseWebhookPayload(
      messengerBody([
        {
          sender: { id: PSID },
          recipient: { id: PAGE },
          timestamp: T,
          message: {
            mid: 'mid.ad',
            text: 'สนใจค่ะ',
            referral: { source: 'ADS', type: 'OPEN_THREAD', ad_id: '120210000000', ref: 'lip9-aug' },
          },
        },
      ]),
    );
    const [msg] = inboundOf(events);
    expect(msg.referral).toEqual({
      source: 'ADS',
      ad_id: '120210000000',
      post_id: null,
      ref: 'lip9-aug',
    });
  });

  it('มี ad_id แต่ source เป็นอย่างอื่น ก็ยังถือเป็น ADS', () => {
    const events = parseWebhookPayload(
      messengerBody([
        {
          sender: { id: PSID },
          recipient: { id: PAGE },
          timestamp: T,
          referral: { source: 'SHORTLINK', ad_id: '999' },
          message: { mid: 'mid.x', text: 'hi' },
        },
      ]),
    );
    expect(inboundOf(events)[0].referral.source).toBe('ADS');
  });

  it('source ที่ระบบเราไม่รู้จัก ต้องตกเป็น ORGANIC ไม่ใช่ทำข้อความหาย', () => {
    const events = parseWebhookPayload(
      messengerBody([
        {
          sender: { id: PSID },
          recipient: { id: PAGE },
          timestamp: T,
          message: { mid: 'mid.y', text: 'hi', referral: { source: 'CUSTOMER_CHAT_PLUGIN' } },
        },
      ]),
    );
    const [msg] = inboundOf(events);
    expect(msg.referral.source).toBe('ORGANIC');
    expect(msg.text).toBe('hi');
  });

  it('ไม่มีข้อมูลที่มาเลย → ทุกช่องเป็น null (ไม่เดา)', () => {
    const events = parseWebhookPayload(
      messengerBody([
        { sender: { id: PSID }, recipient: { id: PAGE }, timestamp: T, message: { mid: 'm', text: 'hi' } },
      ]),
    );
    expect(inboundOf(events)[0].referral).toEqual({ source: null, ad_id: null, post_id: null, ref: null });
  });
});

/* ================================================================== */
describe('echo — ข้อความที่เพจส่งออกไปเอง', () => {
  it('แกะ echo แล้วต้องได้ psid ของลูกค้าจากช่อง recipient', () => {
    const events = parseWebhookPayload(
      messengerBody([
        {
          sender: { id: PAGE },
          recipient: { id: PSID },
          timestamp: T,
          message: { mid: 'mid.echo', text: 'สวัสดีค่ะ', is_echo: true, app_id: 123 },
        },
      ]),
    );

    const [echo] = echoOf(events);
    expect(echo).toBeDefined();
    expect(echo.psid).toBe(PSID);
    expect(echo.page_meta_id).toBe(PAGE);
    expect(echo.meta_message_id).toBe('mid.echo');
    expect(echo.text).toBe('สวัสดีค่ะ');
    // echo ต้องไม่ถูกนับเป็นข้อความขาเข้าเด็ดขาด
    expect(inboundOf(events)).toEqual([]);
  });

  it('ผู้ส่งเป็นเพจแต่ไม่มี is_echo → ข้าม ไม่เดาว่าเป็นของใคร', () => {
    const events = parseWebhookPayload(
      messengerBody([
        { sender: { id: PAGE }, recipient: { id: PSID }, timestamp: T, message: { mid: 'weird', text: 'x' } },
      ]),
    );
    expect(inboundOf(events)).toEqual([]);
    expect(echoOf(events)).toEqual([]);
    expect(events[0].kind).toBe('ignored');
  });
});

/* ================================================================== */
describe('Instagram แยกจาก Messenger', () => {
  it('object=instagram ต้องได้ platform เป็น instagram', () => {
    const events = parseWebhookPayload({
      object: 'instagram',
      entry: [
        {
          id: '178414000000000',
          time: T,
          messaging: [
            {
              sender: { id: 'IGSID_1' },
              recipient: { id: '178414000000000' },
              timestamp: T,
              message: { mid: 'ig.mid.1', text: 'ราคาเท่าไหร่คะ' },
            },
          ],
        },
      ],
    });
    const [msg] = inboundOf(events);
    expect(msg.platform).toBe('instagram');
    expect(msg.psid).toBe('IGSID_1');
  });

  it('object แปลก ๆ ต้องถูกปฏิเสธทั้งก้อน', () => {
    const events = parseWebhookPayload({ object: 'whatsapp_business_account', entry: [] });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('ignored');
  });
});

/* ================================================================== */
describe('สิ่งที่ต้องข้ามอย่างปลอดภัย', () => {
  const cases: Array<[string, unknown]> = [
    ['payload ไม่ใช่ object', 'ข้อความเปล่า'],
    ['payload เป็น null', null],
    ['entry ว่าง', { object: 'page', entry: [] }],
    [
      'ข้อความไม่มี mid (กันซ้ำไม่ได้)',
      { object: 'page', entry: [{ id: PAGE, messaging: [{ sender: { id: PSID }, recipient: { id: PAGE }, timestamp: T, message: { text: 'hi' } }] }] },
    ],
    [
      'ไม่มี timestamp',
      { object: 'page', entry: [{ id: PAGE, messaging: [{ sender: { id: PSID }, recipient: { id: PAGE }, message: { mid: 'm', text: 'hi' } }] }] },
    ],
    [
      'เหตุการณ์อ่านแล้ว',
      { object: 'page', entry: [{ id: PAGE, messaging: [{ sender: { id: PSID }, recipient: { id: PAGE }, timestamp: T, read: { watermark: T } }] }] },
    ],
    [
      'เหตุการณ์ส่งถึงแล้ว',
      { object: 'page', entry: [{ id: PAGE, messaging: [{ sender: { id: PSID }, recipient: { id: PAGE }, timestamp: T, delivery: { watermark: T } }] }] },
    ],
    [
      'คอมเมนต์ (changes)',
      { object: 'page', entry: [{ id: PAGE, changes: [{ field: 'feed', value: {} }] }] },
    ],
    [
      'ข้อความถูกลบที่ต้นทาง',
      { object: 'page', entry: [{ id: PAGE, messaging: [{ sender: { id: PSID }, recipient: { id: PAGE }, timestamp: T, message: { mid: 'm', is_deleted: true } }] }] },
    ],
    [
      'ข้อความว่างเปล่า ไม่มีทั้งข้อความและไฟล์',
      { object: 'page', entry: [{ id: PAGE, messaging: [{ sender: { id: PSID }, recipient: { id: PAGE }, timestamp: T, message: { mid: 'm' } }] }] },
    ],
  ];

  for (const [name, payload] of cases) {
    it(`${name} → ไม่ล้ม และไม่ได้ข้อความออกมา`, () => {
      const events = parseWebhookPayload(payload);
      expect(inboundOf(events)).toEqual([]);
      expect(echoOf(events)).toEqual([]);
      expect(events.length).toBeGreaterThan(0);
    });
  }

  it('เหตุการณ์พังหนึ่งอัน ต้องไม่ทำให้อันที่ดีในก้อนเดียวกันหาย', () => {
    const events = parseWebhookPayload(
      messengerBody([
        { sender: { id: PSID }, recipient: { id: PAGE }, timestamp: T, message: { text: 'ไม่มี mid' } },
        { sender: { id: PSID }, recipient: { id: PAGE }, timestamp: T, message: { mid: 'ดี', text: 'อันนี้ดี' } },
      ]),
    );
    expect(inboundOf(events).map((m) => m.meta_message_id)).toEqual(['ดี']);
  });
});

/* ================================================================== */
describe('คอมเมนต์ Facebook (feed changes)', () => {
  it('แกะคอมเมนต์ใหม่บน Facebook ได้ครบทุกฟิลด์', () => {
    const events = parseWebhookPayload({
      object: 'page',
      entry: [
        {
          id: PAGE,
          time: 1755000000,
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: '102938475610293_111222333',
                post_id: '102938475610293_999888777',
                from: { id: 'fb_user_456', name: 'สมศรี มีทรัพย์' },
                message: 'สนใจโปรนี้ค่ะ ขอรายละเอียดด้วยค่ะ',
                created_time: 1755000000,
                permalink_url: 'https://facebook.com/102938475610293/posts/999888777?comment_id=111222333',
              },
            },
          ],
        },
      ],
    });

    const [c] = commentOf(events);
    expect(c).toBeDefined();
    expect(c.platform).toBe('facebook');
    expect(c.page_meta_id).toBe(PAGE);
    expect(c.comment_id).toBe('102938475610293_111222333');
    expect(c.post_id).toBe('102938475610293_999888777');
    expect(c.parent_comment_id).toBeNull();
    expect(c.from_id).toBe('fb_user_456');
    expect(c.from_name).toBe('สมศรี มีทรัพย์');
    expect(c.message).toBe('สนใจโปรนี้ค่ะ ขอรายละเอียดด้วยค่ะ');
    expect(c.is_from_page).toBe(false);
    expect(c.commented_at).toBe(new Date(1755000000 * 1000).toISOString());
  });

  it('แกะคอมเมนต์ที่ตอบกลับ (reply) มี parent_comment_id', () => {
    const events = parseWebhookPayload({
      object: 'page',
      entry: [
        {
          id: PAGE,
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: 'cmt_sub_1',
                post_id: 'post_1',
                parent_id: 'cmt_parent_1',
                from: { id: 'user_2', name: 'ลูกค้าคนที่สอง' },
                message: 'ตามด้วยคนค่ะ',
                created_time: 1755000010,
              },
            },
          ],
        },
      ],
    });

    const [c] = commentOf(events);
    expect(c.parent_comment_id).toBe('cmt_parent_1');
  });

  it('คอมเมนต์จากเพจเอง → is_from_page เป็น true', () => {
    const events = parseWebhookPayload({
      object: 'page',
      entry: [
        {
          id: PAGE,
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: 'cmt_page_reply',
                post_id: 'post_1',
                from: { id: PAGE, name: 'เพจร้านค้า' },
                message: 'ทักข้อความไปแล้วนะคะ',
                created_time: 1755000020,
              },
            },
          ],
        },
      ],
    });

    const [c] = commentOf(events);
    expect(c.is_from_page).toBe(true);
  });
});

/* ================================================================== */
describe('คอมเมนต์ Instagram (comments changes)', () => {
  const IG_PAGE = '178414000000000';
  const IG_COMMENT_ID = '17858843049216338';
  const IG_MEDIA_ID = '17912345678901234';
  const IG_USER_ID = '17841400999999999';

  it('แกะคอมเมนต์ใหม่บน Instagram ได้ถูกต้องตาม contract จริง', () => {
    const events = parseWebhookPayload({
      object: 'instagram',
      entry: [
        {
          id: IG_PAGE,
          time: 1755000000000,
          changes: [
            {
              field: 'comments',
              value: {
                id: IG_COMMENT_ID,
                text: 'สนใจตัวสีขาว มีของพร้อมส่งไหมคะ?',
                from: {
                  id: IG_USER_ID,
                  username: 'fashion_lover_bkk',
                },
                media: {
                  id: IG_MEDIA_ID,
                  media_product_type: 'FEED',
                },
              },
            },
          ],
        },
      ],
    });

    const [c] = commentOf(events);
    expect(c).toBeDefined();
    expect(c.platform).toBe('instagram');
    expect(c.page_meta_id).toBe(IG_PAGE);
    expect(c.comment_id).toBe(IG_COMMENT_ID);
    expect(c.post_id).toBe(IG_MEDIA_ID);
    expect(c.media_id).toBe(IG_MEDIA_ID);
    expect(c.parent_comment_id).toBeNull();
    expect(c.from_id).toBe(IG_USER_ID);
    expect(c.from_username).toBe('fashion_lover_bkk');
    expect(c.from_name).toBe('fashion_lover_bkk');
    expect(c.message).toBe('สนใจตัวสีขาว มีของพร้อมส่งไหมคะ?');
    expect(c.is_from_page).toBe(false);
    expect(c.commented_at).toBe(new Date(1755000000000).toISOString());
  });

  it('แกะ reply บน Instagram ได้ parent_comment_id', () => {
    const events = parseWebhookPayload({
      object: 'instagram',
      entry: [
        {
          id: IG_PAGE,
          time: 1755000000000,
          changes: [
            {
              field: 'comments',
              value: {
                id: '17858843049219999',
                text: 'ขอราคาด้วยคนค่ะ',
                from: { id: '17841400888888888', username: 'another_user' },
                media: { id: IG_MEDIA_ID },
                parent_id: IG_COMMENT_ID,
              },
            },
          ],
        },
      ],
    });

    const [c] = commentOf(events);
    expect(c.parent_comment_id).toBe(IG_COMMENT_ID);
    expect(c.post_id).toBe(IG_MEDIA_ID);
  });

  it('คอมเมนต์ Instagram จากเพจเอง → is_from_page เป็น true', () => {
    const events = parseWebhookPayload({
      object: 'instagram',
      entry: [
        {
          id: IG_PAGE,
          changes: [
            {
              field: 'comments',
              value: {
                id: '17858843049210000',
                text: 'แจ้งรายละเอียดทาง DM เรียบร้อยค่า',
                from: { id: IG_PAGE, username: 'my_shop_official' },
                media: { id: IG_MEDIA_ID },
              },
            },
          ],
        },
      ],
    });

    const [c] = commentOf(events);
    expect(c.is_from_page).toBe(true);
  });

  it('Instagram payload ผิดรูปแบบ (ไม่มี id) → ignored อย่างปลอดภัย ไม่ throw', () => {
    const events = parseWebhookPayload({
      object: 'instagram',
      entry: [
        {
          id: IG_PAGE,
          changes: [
            {
              field: 'comments',
              value: { text: 'ไม่มี id' },
            },
          ],
        },
      ],
    });

    expect(commentOf(events)).toEqual([]);
    expect(events[0].kind).toBe('ignored');
    expect((events[0] as { reason: string }).reason).toContain('ไม่มี id');
  });

  it('Instagram field ที่ไม่รู้จัก (เช่น story_insights) → ignored อย่างปลอดภัย', () => {
    const events = parseWebhookPayload({
      object: 'instagram',
      entry: [
        {
          id: IG_PAGE,
          changes: [
            {
              field: 'story_insights',
              value: { impression_count: 100 },
            },
          ],
        },
      ],
    });

    expect(commentOf(events)).toEqual([]);
    expect(events[0].kind).toBe('ignored');
    expect((events[0] as { reason: string }).reason).toContain('story_insights');
  });
});
