import { describe, it, expect, beforeEach, afterEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'a'.repeat(40);
process.env.SUPABASE_SERVICE_ROLE_KEY = 'b'.repeat(40);
process.env.SESSION_SECRET = 'c'.repeat(40);
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

import { sendToMeta, uploadAttachmentToMeta, __setFetcherForTests, type MetaPage } from '../client';
import { clearInstagramMessagingPageCache } from '../instagram-messaging-page';
import { encryptSecret } from '@/lib/crypto';

describe('Meta client — Instagram routing & resolution', () => {
  beforeEach(() => {
    clearInstagramMessagingPageCache();
    __setFetcherForTests(null);
  });

  afterEach(() => {
    clearInstagramMessagingPageCache();
    __setFetcherForTests(null);
  });

  const fbPage: MetaPage = {
    id: 'page-fb-1',
    platform: 'facebook',
    page_id: 'fb-page-12345',
    access_token: encryptSecret('EAAB_fb_token'),
  };

  const igPage: MetaPage = {
    id: 'page-ig-1',
    platform: 'instagram',
    page_id: 'ig-account-67890',
    access_token: encryptSecret('EAAB_ig_token'),
  };

  it('Facebook Send API uses page_id directly without identity lookup', async () => {
    const urls: string[] = [];
    __setFetcherForTests((async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ message_id: 'mid.fb.123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch);

    const res = await sendToMeta(fbPage, { recipient: { id: 'psid-1' }, message: { text: 'Hello FB' } });
    expect(res.ok).toBe(true);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/v26.0/fb-page-12345/messages');
  });

  it('Instagram Send API resolves linked Facebook Page ID and posts to /{facebook_page_id}/messages', async () => {
    const urls: string[] = [];
    __setFetcherForTests((async (url: string | URL | Request) => {
      const urlStr = String(url);
      urls.push(urlStr);
      if (urlStr.includes('/me?')) {
        return new Response(
          JSON.stringify({
            id: 'fb-page-linked-999',
            instagram_business_account: { id: 'ig-account-67890' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('/messages')) {
        return new Response(JSON.stringify({ message_id: 'mid.ig.456' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch);

    const res = await sendToMeta(igPage, { recipient: { id: 'igsid-1' }, message: { text: 'Hello IG' } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.message_id).toBe('mid.ig.456');

    // First call was lookup /me, second call was /messages on the linked FB page
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('/v26.0/me?');
    expect(urls[1]).toContain('/v26.0/fb-page-linked-999/messages');

    // Second send should use memory cache and skip the /me lookup
    const res2 = await sendToMeta(igPage, { recipient: { id: 'igsid-2' }, message: { text: 'Hello IG 2' } });
    expect(res2.ok).toBe(true);
    expect(urls).toHaveLength(3);
    expect(urls[2]).toContain('/v26.0/fb-page-linked-999/messages');
  });

  it('Instagram Send API safely bails out if linked account does not match page_id', async () => {
    const urls: string[] = [];
    __setFetcherForTests((async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify({
          id: 'fb-page-linked-999',
          instagram_business_account: { id: 'mismatched-ig-account' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch);

    const res = await sendToMeta(igPage, { recipient: { id: 'igsid-1' }, message: { text: 'Hello' } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.http_status).toBe(400);
    expect(res.error.message_th).toContain('token ต้องเป็นของเพจ Facebook ที่เชื่อมกับบัญชี Instagram นี้');
    // Send API must never be called when lookup fails
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/v26.0/me?');
  });

  it('Instagram Attachment Upload API resolves linked Facebook Page ID and posts to /{facebook_page_id}/message_attachments', async () => {
    const urls: string[] = [];
    __setFetcherForTests((async (url: string | URL | Request) => {
      const urlStr = String(url);
      urls.push(urlStr);
      if (urlStr.includes('/me?')) {
        return new Response(
          JSON.stringify({
            id: 'fb-page-linked-999',
            instagram_business_account: { id: 'ig-account-67890' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('/message_attachments')) {
        return new Response(JSON.stringify({ attachment_id: 'att-ig-777' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch);

    const file = { bytes: new ArrayBuffer(8), mime: 'image/jpeg', filename: 'product.jpg' };
    const res = await uploadAttachmentToMeta(igPage, file, 'image');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.attachment_id).toBe('att-ig-777');

    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('/v26.0/me?');
    expect(urls[1]).toContain('/v26.0/fb-page-linked-999/message_attachments');
  });
});
