import { NextRequest, NextResponse } from 'next/server';
import { parseSignedRequest, registerDeletionRequest, deletionStatus } from '@/server/compliance/data-deletion';
import { getRuntimeSetting } from '@/server/settings/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    if (body.length > 20000) return NextResponse.json({ error: 'Request too large' }, { status: 413 });
    const signed = new URLSearchParams(body).get('signed_request');
    if (!signed) return NextResponse.json({ error: 'Missing signed_request' }, { status: 400 });
    const secret = await getRuntimeSetting('META_APP_SECRET');
    if (!secret) return NextResponse.json({ error: 'Server configuration error' }, { status: 503 });
    const parsed = parseSignedRequest(signed, secret);
    if (!parsed) return NextResponse.json({ error: 'Invalid signed_request' }, { status: 403 });
    const code = await registerDeletionRequest(parsed, secret);
    const origin = (process.env.APP_URL || 'https://hubchat-omega.vercel.app').replace(/\/$/, '');
    return NextResponse.json({ url: `${origin}/api/compliance/data-deletion-status?code=${code}`, confirmation_code: code });
  } catch {
    console.error('[data-deletion] Could not persist request');
    return NextResponse.json({ error: 'Request could not be recorded. Please retry.' }, { status: 503 });
  }
}
export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get('code');
    if (!code) return NextResponse.json({ error: 'Missing confirmation code' }, { status: 400 });
    const result = await deletionStatus(code);
    return NextResponse.json(result ?? { error: 'Confirmation code not found' }, { status: result ? 200 : 404, headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Status temporarily unavailable' }, { status: 503 }); }
}
