import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
    vi.restoreAllMocks();
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
    let uploadForm: FormData | undefined;
    __setFetcherForTests((async (url: string | URL | Request, init?: RequestInit) => {
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
        uploadForm = init?.body as FormData;
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
    expect(uploadForm?.get('platform')).toBe('instagram');
    expect(JSON.parse(String(uploadForm?.get('message')))).toEqual({
      attachment: { type: 'image', payload: { is_reusable: true } },
    });
    expect(uploadForm?.get('filedata')).toBeInstanceOf(Blob);
  });

  it('revalidates identity after token rotation even while the previous cache entry is fresh', async () => {
    const requests: { url: string; method: string }[] = [];
    let lookups = 0;
    __setFetcherForTests((async (url, init) => {
      requests.push({ url: String(url), method: init?.method ?? 'GET' });
      if (String(url).includes('/me?')) {
        lookups++;
        return Response.json({ id: 'linked-page', instagram_business_account: {
          id: lookups === 1 ? igPage.page_id : 'another-instagram-account',
        } });
      }
      return Response.json({ message_id: 'mid-test' });
    }) as typeof fetch);
    const payload = { recipient: { id: 'test-recipient' }, message: { text: 'test' } };
    expect((await sendToMeta(igPage, payload)).ok).toBe(true);
    const rotated = { ...igPage, access_token: encryptSecret('different-page-token') };
    expect((await sendToMeta(rotated, payload)).ok).toBe(false);
    expect(lookups).toBe(2);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
  });

  it('revalidates identity after the cache expires and blocks a changed linked account', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    let lookups = 0;
    let posts = 0;
    __setFetcherForTests((async (url) => {
      if (String(url).includes('/me?')) {
        lookups++;
        return Response.json({ id: 'linked-page', instagram_business_account: {
          id: lookups === 1 ? igPage.page_id : 'changed-ig',
        } });
      }
      posts++;
      return Response.json({ message_id: 'mid-test' });
    }) as typeof fetch);
    const payload = { message: { text: 'test' } };
    expect((await sendToMeta(igPage, payload)).ok).toBe(true);
    now.mockReturnValue(1_000_000 + 5 * 60_000);
    expect((await sendToMeta(igPage, payload)).ok).toBe(false);
    expect(lookups).toBe(2);
    expect(posts).toBe(1);
  });

  it('keeps transient lookup errors retryable and preserves Meta diagnostics without a POST', async () => {
    const fetch = vi.fn(async () => Response.json({ error: {
      code: 2, error_subcode: 456, message: 'Temporarily unavailable', fbtrace_id: 'lookup-trace',
    } }, { status: 503 }));
    __setFetcherForTests(fetch as typeof globalThis.fetch);
    const result = await sendToMeta(igPage, { message: { text: 'test' } });
    expect(result).toMatchObject({ ok: false, http_status: 503, error: {
      kind: 'transient', code: 2, subcode: 456, fbtrace_id: 'lookup-trace', window_actually_closed: false,
    } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/me?'), expect.objectContaining({ method: 'GET' }));
  });

  it('treats an identity GET timeout as safely retryable and does not cache the failure', async () => {
    let lookups = 0;
    let posts = 0;
    __setFetcherForTests((async (url) => {
      if (String(url).includes('/me?')) {
        lookups++;
        if (lookups === 1) throw new Error('lookup timeout');
        return Response.json({ id: 'linked-page', instagram_business_account: { id: igPage.page_id } });
      }
      posts++;
      return Response.json({ message_id: 'mid-test' });
    }) as typeof fetch);
    const first = await sendToMeta(igPage, { message: { text: 'test' } });
    expect(first).toMatchObject({ ok: false, error: { kind: 'transient' } });
    if (!first.ok) expect(first.error.message_th).toContain('ยังไม่ได้ส่งข้อความ');
    expect(posts).toBe(0);
    expect((await sendToMeta(igPage, { message: { text: 'test' } })).ok).toBe(true);
    expect(lookups).toBe(2);
    expect(posts).toBe(1);
  });

  it('keeps a permission failure nonretryable with its original code, subcode and trace', async () => {
    const fetch = vi.fn(async () => Response.json({ error: {
      code: 200, error_subcode: 2534048, message: 'Permission denied', fbtrace_id: 'permission-trace',
    } }, { status: 403 }));
    __setFetcherForTests(fetch as typeof globalThis.fetch);
    const result = await sendToMeta(igPage, { message: { text: 'test' } });
    expect(result).toMatchObject({ ok: false, http_status: 403, error: {
      kind: 'policy', code: 200, subcode: 2534048, fbtrace_id: 'permission-trace',
    } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('still treats a POST timeout as ambiguous with no endpoint fallback', async () => {
    const methods: string[] = [];
    __setFetcherForTests((async (url, init) => {
      methods.push(init?.method ?? 'GET');
      if (String(url).includes('/me?')) {
        return Response.json({ id: 'linked-page', instagram_business_account: { id: igPage.page_id } });
      }
      throw new Error('POST timeout');
    }) as typeof fetch);
    expect(await sendToMeta(igPage, { message: { text: 'test' } })).toMatchObject({
      ok: false, error: { kind: 'ambiguous' },
    });
    expect(methods).toEqual(['GET', 'POST']);
  });

  it('does not add Instagram routing to a Facebook attachment upload', async () => {
    const fetch = vi.fn(async () => Response.json({ attachment_id: 'fb-attachment' }));
    __setFetcherForTests(fetch as typeof globalThis.fetch);
    expect((await uploadAttachmentToMeta(fbPage, {
      bytes: new ArrayBuffer(8), mime: 'image/jpeg', filename: 'test.jpg',
    })).ok).toBe(true);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('/fb-page-12345/message_attachments'),
      expect.objectContaining({ method: 'POST' }),
    );
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.body as FormData).has('platform')).toBe(false);
  });

  it('preserves lookup errors before attachment upload without uploading bytes', async () => {
    const fetch = vi.fn(async () => Response.json({ error: {
      code: 4, message: 'Rate limit', fbtrace_id: 'upload-lookup-trace',
    } }, { status: 429 }));
    __setFetcherForTests(fetch as typeof globalThis.fetch);
    expect(await uploadAttachmentToMeta(igPage, {
      bytes: new ArrayBuffer(8), mime: 'image/jpeg', filename: 'test.jpg',
    })).toMatchObject({ ok: false, http_status: 429, error: {
      kind: 'transient', code: 4, fbtrace_id: 'upload-lookup-trace',
    } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/me?'), expect.objectContaining({ method: 'GET' }));
  });
});
