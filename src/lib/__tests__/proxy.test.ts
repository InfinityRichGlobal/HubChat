import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { signSession, SESSION_COOKIE } from '@/lib/auth/session';
const secret='test-session-secret-for-proxy-only-123456';
beforeEach(()=>{process.env.SESSION_SECRET=secret;});
async function ticket() { return signSession({sub:'test',sv:1,role:'owner',mcp:true},secret,1); }
describe('proxy public access and session recovery',()=>{
  it('allows public compliance and offline pages even with a password-reset ticket',async()=>{
    for(const path of ['/privacy','terms','/offline.html','/api/compliance/data-deletion-status?code=test','/api/webhooks/meta/data-deletion']) {
      const res=await proxy(new NextRequest(new URL(path,'https://app.test'),{headers:{cookie:`${SESSION_COOKIE}=${await ticket()}`}}));
      expect(res.status).toBe(200); expect(res.headers.get('location')).toBeNull();
    }
  });
  it('clears rejected password-reset sessions instead of redirecting forever',async()=>{
    const res=await proxy(new NextRequest('https://app.test/login?reason=session_expired',{headers:{cookie:`${SESSION_COOKIE}=${await ticket()}`}}));
    expect(res.status).toBe(200); expect(res.cookies.get(SESSION_COOKIE)?.value).toBe('');
  });
  it('blocks cross-origin changes while allowing signed webhook validation and same-origin login',async()=>{
    expect((await proxy(new NextRequest('https://app.test/api/settings/data-deletion',{method:'POST',headers:{origin:'https://evil.test'}}))).status).toBe(403);
    expect((await proxy(new NextRequest('https://app.test/api/auth/login',{method:'POST',headers:{origin:'https://app.test'}}))).status).toBe(200);
    expect((await proxy(new NextRequest('https://app.test/api/webhooks/meta',{method:'POST',headers:{origin:'https://meta.test'}}))).status).toBe(200);
  });
});
