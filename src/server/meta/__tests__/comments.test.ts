import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  COMMENT_CAPABILITIES,
  explainCommentError,
  FB_SUBSCRIBED_FIELDS,
  IG_SUBSCRIBED_FIELDS,
  replyToCommentPublicly,
  sendPrivateReply,
  setCommentHidden,
  likeComment,
  unlikeComment,
  deleteComment,
  subscribePageWebhooks,
} from '../comments';
import * as metaClient from '../client';
import type { MetaPage } from '../client';

vi.mock('../client', async (importOriginal) => {
  const actual = await importOriginal<typeof metaClient>();
  return {
    ...actual,
    metaPost: vi.fn(),
    metaDelete: vi.fn(),
    metaGet: vi.fn(),
  };
});

describe('Platform Capability Matrix', () => {
  it('Facebook capabilities are defined correctly', () => {
    expect(COMMENT_CAPABILITIES.facebook).toEqual({
      like: true,
      unlike: false,
      publicReply: true,
      privateReply: true,
      hide: true,
      delete: true,
    });
  });

  it('Instagram capabilities are defined correctly', () => {
    expect(COMMENT_CAPABILITIES.instagram).toEqual({
      like: true,
      unlike: true,
      publicReply: true,
      privateReply: true,
      hide: true,
      delete: true,
    });
  });
});

describe('Webhook Subscribed Fields', () => {
  it('FB fields contain feed and all production messaging fields', () => {
    expect(FB_SUBSCRIBED_FIELDS).toContain('feed');
    expect(FB_SUBSCRIBED_FIELDS).toContain('messages');
    expect(FB_SUBSCRIBED_FIELDS).toContain('message_echoes');
    expect(FB_SUBSCRIBED_FIELDS).toContain('message_reactions');
    expect(FB_SUBSCRIBED_FIELDS).toContain('messaging_referrals');
  });

  it('IG fields contain comments and all production messaging fields', () => {
    expect(IG_SUBSCRIBED_FIELDS).toContain('comments');
    expect(IG_SUBSCRIBED_FIELDS).toContain('messages');
    expect(IG_SUBSCRIBED_FIELDS).toContain('messaging_seen');
    expect(IG_SUBSCRIBED_FIELDS).toContain('message_reactions');
    expect(IG_SUBSCRIBED_FIELDS).toContain('messaging_referral');
  });
});

describe('explainCommentError', () => {
  it('explains code 190 token expired', () => {
    expect(explainCommentError(190, 'ผิดพลาด', 'facebook')).toContain('token ของเพจ Facebook หมดอายุ');
    expect(explainCommentError(190, 'ผิดพลาด', 'instagram')).toContain('token ของเพจ Instagram หมดอายุ');
  });

  it('explains code 10/200/803 permission errors for Instagram', () => {
    const msg = explainCommentError(200, 'ผิดพลาด', 'instagram');
    expect(msg).toContain('instagram_manage_comments');
  });

  it('explains code 10/200/803 permission errors for Facebook', () => {
    const msg = explainCommentError(10, 'ผิดพลาด', 'facebook');
    expect(msg).toContain('pages_manage_engagement');
  });

  it('explains code 10903 expired or already replied for private reply', () => {
    const msg = explainCommentError(10903, 'ผิดพลาด', 'instagram');
    expect(msg).toContain('7 วัน');
  });

  it('explains rate limit code 32 or 613', () => {
    const msg = explainCommentError(613, 'ผิดพลาด', 'instagram');
    expect(msg).toContain('ถี่เกินโควตา');
  });
});

describe('Comment Adapter Dispatcher', () => {
  const fbPage: MetaPage = {
    id: 'page-fb-1',
    platform: 'facebook',
    page_id: 'fb-page-123',
    access_token: 'valid-fb-token',
  };

  const igPage: MetaPage = {
    id: 'page-ig-1',
    platform: 'instagram',
    page_id: 'ig-page-456',
    access_token: 'valid-ig-token',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes Facebook public reply to /{commentId}/comments', async () => {
    vi.mocked(metaClient.metaPost).mockResolvedValueOnce({
      ok: true,
      data: { id: 'fb-reply-1' },
      http_status: 200,
    });

    const res = await replyToCommentPublicly(fbPage, 'comment-100', 'ขอบคุณค่ะ');
    expect(res.ok).toBe(true);
    expect(metaClient.metaPost).toHaveBeenCalledWith(
      fbPage,
      'comment-100/comments',
      { message: 'ขอบคุณค่ะ' },
    );
  });

  it('routes Instagram public reply to /{commentId}/replies', async () => {
    vi.mocked(metaClient.metaPost).mockResolvedValueOnce({
      ok: true,
      data: { id: 'ig-reply-1' },
      http_status: 200,
    });

    const res = await replyToCommentPublicly(igPage, 'ig-comment-200', 'สวัสดีค่ะ');
    expect(res.ok).toBe(true);
    expect(metaClient.metaPost).toHaveBeenCalledWith(
      igPage,
      'ig-comment-200/replies',
      { message: 'สวัสดีค่ะ' },
    );
  });

  it('routes Facebook private reply to Send API /{page_id}/messages with recipient.comment_id', async () => {
    vi.mocked(metaClient.metaPost).mockResolvedValueOnce({
      ok: true,
      data: { message_id: 'fb-dm-1', recipient_id: 'fb-user-1' },
      http_status: 200,
    });

    const res = await sendPrivateReply(fbPage, 'fb-comm-1', 'สวัสดีทางแชท');
    expect(res.ok).toBe(true);
    expect(metaClient.metaPost).toHaveBeenCalledWith(
      fbPage,
      'fb-page-123/messages',
      {
        recipient: { comment_id: 'fb-comm-1' },
        message: { text: 'สวัสดีทางแชท' },
      },
    );
  });

  it('uses the linked Facebook Page for Instagram private replies with Facebook Login', async () => {
    vi.mocked(metaClient.metaGet).mockResolvedValueOnce({
      ok: true,
      data: { id: 'linked-facebook-page', instagram_business_account: { id: igPage.page_id } },
      http_status: 200,
    });
    vi.mocked(metaClient.metaPost).mockResolvedValueOnce({
      ok: true,
      data: { message_id: 'ig-msg-1', recipient_id: 'ig-user-1' },
      http_status: 200,
    });

    const res = await sendPrivateReply(igPage, 'ig-comm-2', 'ยินดีต้อนรับค่ะ');
    expect(res.ok).toBe(true);
    expect(metaClient.metaPost).toHaveBeenCalledWith(
      igPage,
      'linked-facebook-page/messages',
      {
        recipient: { comment_id: 'ig-comm-2' },
        message: { text: 'ยินดีต้อนรับค่ะ' },
      },
    );
  });

  it('routes Facebook hide with body { is_hidden: true }', async () => {
    vi.mocked(metaClient.metaPost).mockResolvedValueOnce({
      ok: true,
      data: { success: true },
      http_status: 200,
    });

    const res = await setCommentHidden(fbPage, 'fb-comm-3', true);
    expect(res.ok).toBe(true);
    expect(metaClient.metaPost).toHaveBeenCalledWith(
      fbPage,
      'fb-comm-3',
      { is_hidden: true },
    );
  });

  it('routes Instagram hide with query string ?hide=true', async () => {
    vi.mocked(metaClient.metaPost).mockResolvedValueOnce({
      ok: true,
      data: { success: true },
      http_status: 200,
    });

    const res = await setCommentHidden(igPage, 'ig-comm-3', true);
    expect(res.ok).toBe(true);
    expect(metaClient.metaPost).toHaveBeenCalledWith(
      igPage,
      'ig-comm-3?hide=true',
      {},
    );
  });

  it('routes Facebook like to POST /{commentId}/likes', async () => {
    vi.mocked(metaClient.metaPost).mockResolvedValueOnce({
      ok: true,
      data: { success: true },
      http_status: 200,
    });

    const res = await likeComment(fbPage, 'fb-comm-4');
    expect(res.ok).toBe(true);
    expect(metaClient.metaPost).toHaveBeenCalledWith(
      fbPage,
      'fb-comm-4/likes',
      {},
    );
  });

  it('routes Instagram like to POST /{commentId}/likes', async () => {
    vi.mocked(metaClient.metaPost).mockResolvedValueOnce({
      ok: true,
      data: { success: true },
      http_status: 200,
    });

    const res = await likeComment(igPage, 'ig-comm-4');
    expect(res.ok).toBe(true);
    expect(metaClient.metaPost).toHaveBeenCalledWith(
      igPage,
      'ig-comm-4/likes',
      {},
    );
  });

  it('rejects unlike on Facebook as unsupported', async () => {
    const res = await unlikeComment(fbPage, 'fb-comm-5');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error_th).toContain('Facebook ไม่รองรับการยกเลิกไลก์');
    }
    expect(metaClient.metaDelete).not.toHaveBeenCalled();
  });

  it('routes Instagram unlike to DELETE /{commentId}/likes', async () => {
    vi.mocked(metaClient.metaDelete).mockResolvedValueOnce({
      ok: true,
      data: { success: true },
      http_status: 200,
    });

    const res = await unlikeComment(igPage, 'ig-comm-5');
    expect(res.ok).toBe(true);
    expect(metaClient.metaDelete).toHaveBeenCalledWith(
      igPage,
      'ig-comm-5/likes',
    );
  });

  it('routes Facebook delete to DELETE /{commentId}', async () => {
    vi.mocked(metaClient.metaDelete).mockResolvedValueOnce({
      ok: true,
      data: { success: true },
      http_status: 200,
    });

    const res = await deleteComment(fbPage, 'fb-comm-6');
    expect(res.ok).toBe(true);
    expect(metaClient.metaDelete).toHaveBeenCalledWith(
      fbPage,
      'fb-comm-6',
    );
  });

  it('routes Instagram delete to DELETE /{commentId}', async () => {
    vi.mocked(metaClient.metaDelete).mockResolvedValueOnce({
      ok: true,
      data: { success: true },
      http_status: 200,
    });

    const res = await deleteComment(igPage, 'ig-comm-6');
    expect(res.ok).toBe(true);
    expect(metaClient.metaDelete).toHaveBeenCalledWith(
      igPage,
      'ig-comm-6',
    );
  });

  it('subscribes Facebook page with FB subscribed fields', async () => {
    vi.mocked(metaClient.metaPost).mockResolvedValueOnce({
      ok: true,
      data: { success: true },
      http_status: 200,
    });

    const res = await subscribePageWebhooks(fbPage);
    expect(res.ok).toBe(true);
    expect(metaClient.metaPost).toHaveBeenCalledWith(
      fbPage,
      'fb-page-123/subscribed_apps',
      expect.objectContaining({
        subscribed_fields: FB_SUBSCRIBED_FIELDS.join(','),
      }),
    );
  });

  it('subscribes Instagram page with IG subscribed fields', async () => {
    vi.mocked(metaClient.metaPost).mockResolvedValueOnce({
      ok: true,
      data: { success: true },
      http_status: 200,
    });

    const res = await subscribePageWebhooks(igPage);
    expect(res.ok).toBe(true);
    expect(metaClient.metaPost).toHaveBeenCalledWith(
      igPage,
      'ig-page-456/subscribed_apps',
      expect.objectContaining({
        subscribed_fields: IG_SUBSCRIBED_FIELDS.join(','),
      }),
    );
  });
});


describe('Instagram private reply rejection diagnostics', () => {
  it.each([100, 10, 200])('does not claim expiry from code %s alone', async (code) => {
    vi.mocked(metaClient.metaGet).mockResolvedValueOnce({
      ok: true, data: { id: 'facebook-page', instagram_business_account: { id: 'ig' } }, http_status: 200,
    });
    vi.mocked(metaClient.metaPost).mockResolvedValueOnce({
      ok: false, http_status: 400,
      error: { kind: 'policy', code, subcode: 123, message: 'Permission denied',
        fbtrace_id: 'trace-123', message_th: 'ถูกปฏิเสธ', window_actually_closed: false },
    });
    const result = await sendPrivateReply({ page_id: 'ig', platform: 'instagram', access_token: 'token' } as MetaPage, 'comment', 'hello');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error_th).not.toContain('เกิน 7 วัน');
      expect(result.error_th).toContain('รหัสย่อย 123');
      expect(result.error_th).toContain('trace-123');
      expect(result.outcome_unknown).toBe(false);
    }
  });
});

describe('Instagram private reply sender safety', () => {
  const page: MetaPage = { id: 'local-page', page_id: 'ig-account', platform: 'instagram', access_token: 'token' };
  beforeEach(() => vi.resetAllMocks());

  it.each([
    { id: 'facebook-page', instagram_business_account: { id: 'different-ig' } },
    { id: 'facebook-page' },
    { id: 'ig-account', instagram_business_account: { id: 'ig-account' } },
  ])('does not send with an unverified or mismatched Page: %j', async (identity) => {
    vi.mocked(metaClient.metaGet).mockResolvedValueOnce({ ok: true, data: identity, http_status: 200 });
    const result = await sendPrivateReply(page, 'comment', 'hello');
    expect(result).toMatchObject({ ok: false, outcome_unknown: false });
    expect(metaClient.metaPost).not.toHaveBeenCalled();
  });

  it('a failed identity lookup is safely unsent', async () => {
    vi.mocked(metaClient.metaGet).mockResolvedValueOnce({
      ok: false, http_status: 0,
      error: { kind: 'ambiguous', code: null, subcode: null, message: 'timeout',
        fbtrace_id: null, message_th: 'อ่านไม่สำเร็จ', window_actually_closed: false },
    });
    expect(await sendPrivateReply(page, 'comment', 'hello')).toMatchObject({ ok: false, outcome_unknown: false });
    expect(metaClient.metaPost).not.toHaveBeenCalled();
  });

  it('does not fall back to another endpoint after an uncertain send', async () => {
    vi.mocked(metaClient.metaGet).mockResolvedValueOnce({
      ok: true, data: { id: 'facebook-page', instagram_business_account: { id: page.page_id } }, http_status: 200,
    });
    vi.mocked(metaClient.metaPost).mockResolvedValueOnce({
      ok: false, http_status: 0,
      error: { kind: 'ambiguous', code: null, subcode: null, message: 'timeout',
        fbtrace_id: null, message_th: 'ไม่ทราบผล', window_actually_closed: false },
    });
    expect(await sendPrivateReply(page, 'comment', 'hello')).toMatchObject({ ok: false, outcome_unknown: true });
    expect(metaClient.metaPost).toHaveBeenCalledTimes(1);
  });
});
