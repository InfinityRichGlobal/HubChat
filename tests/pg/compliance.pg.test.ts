import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import crypto from 'node:crypto';
import type { Pool } from 'pg';
import { postgresAvailable, resetDatabase, startRestServer, testPool, type RestServer } from './harness';
const storage = vi.hoisted(() => ({ removeObjects: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/server/storage/supabase-storage', () => storage);
const available = await postgresAvailable();
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${process.env.HUBCHAT_TEST_REST_PORT ?? 54399}`;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'a'.repeat(40);
process.env.SUPABASE_SERVICE_ROLE_KEY = 'b'.repeat(40);
process.env.SESSION_SECRET = 'c'.repeat(40);
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');
const { registerDeletionRequest, deletionStatus, listDeletionRequests, fulfillDeletion, parseSignedRequest } = await import('@/server/compliance/data-deletion');
let pool: Pool; let rest: RestServer;
const ownerId = crypto.randomUUID(); const page = crypto.randomUUID();
const owner = { id: ownerId, role: 'owner' } as Parameters<typeof fulfillDeletion>[0];
const request = { user_id: '123456', algorithm: 'HMAC-SHA256', issued_at: 1700000000 };
async function registered() {
  const code = await registerDeletionRequest(request, 'test-secret');
  const row = (await pool.query('select id from data_deletion_requests where confirmation_code=$1', [code])).rows[0];
  return { code, input: { request_id: row.id, customers: [] as string[], comments: [] as string[], verification_note: 'Verified using the customer-provided account and page context', confirmed: true } };
}
describe.skipIf(!available)('verified data deletion', () => {
  beforeAll(async () => { await resetDatabase(); pool = testPool(); rest = await startRestServer(pool); }, 120000);
  afterAll(async () => { await rest?.close(); await pool?.end(); });
  beforeEach(async () => {
    await pool.query('truncate data_deletion_requests,erased_meta_identities,webhook_queue,pages,admins cascade');
    await pool.query("insert into admins(id,name,email,password_hash,role) values($1,'Owner','owner@test.local','x','owner')", [ownerId]);
    await pool.query("insert into pages(id,platform,page_id,page_name) values($1,'facebook','meta-page','Test')", [page]);
    storage.removeObjects.mockReset().mockResolvedValue(undefined);
  });
  it('rejects malformed, tampered and incomplete signatures without throwing', () => {
    const sign = (text: string) => crypto.createHmac('sha256','secret').update(text).digest('base64url') + '.' + text;
    const payload = Buffer.from(JSON.stringify(request)).toString('base64url');
    expect(parseSignedRequest(sign(payload),'secret')).toEqual(request);
    expect(parseSignedRequest(sign(payload),'wrong')).toBeNull();
    expect(parseSignedRequest(sign(Buffer.from('{').toString('base64url')),'secret')).toBeNull();
    expect(parseSignedRequest(sign(Buffer.from('{}').toString('base64url')),'secret')).toBeNull();
    expect(parseSignedRequest('abc.def.extra','secret')).toBeNull();
  });
  it('duplicate callbacks return one durable code, unknown codes never claim completion, subject stays encrypted', async () => {
    const codes = await Promise.all(Array.from({length:6}, () => registerDeletionRequest(request,'secret')));
    expect(new Set(codes).size).toBe(1);
    expect((await deletionStatus(codes[0]))?.status).toBe('pending_review');
    expect(await deletionStatus('f'.repeat(48))).toBeNull();
    expect((await pool.query('select subject_encrypted from data_deletion_requests')).rows[0].subject_encrypted).not.toContain(request.user_id);
    expect((await listDeletionRequests(owner))[0].app_user_id).toBe(request.user_id);
    await expect(listDeletionRequests({...owner, role:'admin'})).rejects.toThrow('เจ้าของ');
  });
  it('verifies no linked records and records completed only after an owner review', async () => {
    const {code,input} = await registered();
    await expect(fulfillDeletion({...owner,role:'viewer'},input)).rejects.toThrow();
    await expect(fulfillDeletion(owner,{...input,confirmed:false})).rejects.toThrow();
    await fulfillDeletion(owner,input);
    expect((await deletionStatus(code))?.status).toBe('completed');
    expect((await pool.query('select subject_encrypted from data_deletion_requests')).rows[0].subject_encrypted).toBeNull();
  });
  it('storage failure does not delete records or report completed; retry removes linked records atomically and preserves another person', async () => {
    const customer = crypto.randomUUID(), other = crypto.randomUUID(), conv = crypto.randomUUID(), order = crypto.randomUUID(), asset = crypto.randomUUID();
    await pool.query("insert into customers(id,page_id,psid,name,platform) values($1,$3,'person-one','One','facebook'),($2,$3,'person-two','Two','facebook')", [customer,other,page]);
    await pool.query('insert into conversations(id,customer_id,page_id) values($1,$2,$3)', [conv,customer,page]);
    await pool.query("insert into orders(id,order_no,customer_id,conversation_id,page_id,recipient_name) values($1,'ORDER-ONE',$2,$3,$4,'One')", [order,customer,conv,page]);
    await pool.query("insert into media_assets(id,conversation_id,page_id,storage_key,status) values($1,$2,$3,'slip/one.jpg','stored')", [asset,conv,page]);
    await pool.query("insert into webhook_queue(payload) values($1)", [JSON.stringify({object:'page',entry:[{id:'meta-page',messaging:[{sender:{id:'person-one'},message:{text:'private'}},{sender:{id:'person-two'},message:{text:'preserved'}}]}]})]);
    const {code,input} = await registered(); input.customers=[customer];
    storage.removeObjects.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(fulfillDeletion(owner,input)).rejects.toThrow('storage unavailable');
    expect((await deletionStatus(code))?.status).toBe('failed');
    expect((await pool.query('select count(*)::int n from customers')).rows[0].n).toBe(2);
    await fulfillDeletion(owner,input);
    expect(storage.removeObjects).toHaveBeenLastCalledWith(['slip/one.jpg']);
    expect((await deletionStatus(code))?.status).toBe('completed');
    expect((await pool.query('select id from customers')).rows).toEqual([{id:other}]);
    expect((await pool.query('select count(*)::int n from orders')).rows[0].n).toBe(0);
    const payload=(await pool.query('select payload from webhook_queue')).rows[0].payload;
    expect(payload.entry[0].messaging).toHaveLength(1);
    expect(payload.entry[0].messaging[0].sender.id).toBe('person-two');
    await expect(pool.query("select * from ingest_inbound_message($1,'person-one','facebook','old','old erased content','[]',now()-interval '1 day',null,null,null,null)",[page])).rejects.toThrow('DELETED_SUBJECT');
    expect((await pool.query("select count(*)::int n from customers where psid='person-one'")).rows[0].n).toBe(0);
  });
});
