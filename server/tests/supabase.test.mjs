import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
import { PGlite } from '@electric-sql/pglite'
import { supabaseStore } from '../supabase-store.mjs'
import { openStorage } from '../storage.mjs'
import { createAdmin, tokenHash } from '../auth.mjs'
import { createApp } from '../app.mjs'
import { createVercelHandler } from '../vercel-handler.mjs'
import { createServer } from 'node:http'

test('Supabase SQL, SDK and Express integration against real PostgreSQL', async (t) => {
  const pg = new PGlite()
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;')
  const migration = await readFile(new URL('../../supabase/migrations/202611040001_travesia.sql', import.meta.url), 'utf8')
  await pg.exec(migration)
  const secret = `sb_secret_${randomBytes(24).toString('hex')}`
  const requests = []
  // Execute the actual SQL functions through the real Supabase SDK. Only the
  // HTTP transport is replaced because this test does not require a live account.
  const rpcFetch = async (url, init) => {
    assert.equal(new Headers(init.headers).get('apikey'), secret)
    const name = new URL(url).pathname.split('/').at(-1)
    assert.match(name, /^travesia_[a-z_]+$/)
    const args = JSON.parse(init.body || '{}')
    requests.push({ name, args })
    const parameters = Object.keys(args)
    parameters.forEach((name) => assert.match(name, /^p_[a-z_]+$/))
    const sql = `select public.${name}(${parameters.map((name, index) => `${name} => $${index + 1}`).join(', ')}) as result`
    try {
      const data = await pg.transaction(async (tx) => {
        await tx.exec('set local role service_role')
        return tx.query(sql, Object.values(args))
      })
      return Response.json(data.rows[0].result)
    } catch (error) {
      return Response.json({ code: error.code, message: error.message }, { status: 400 })
    }
  }
  const store = supabaseStore({ url: 'https://fixture.supabase.co', key: secret, fetch: rpcFetch })
  const credentials = { email: 'admin@example.test', password: randomBytes(24).toString('hex') }
  const admin = await createAdmin(store, credentials)
  const app = await createApp({ store, limits: { api: 1000, inquiries: 1000, login: 1000 } })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections() })
    await pg.close()
  })
  const base = `http://127.0.0.1:${server.address().port}/api`
  const request = (path, { body, headers, ...rest } = {}) => fetch(`${base}${path}`, {
    ...rest, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const inquiry = { name: 'María Pérez', email: 'maria@example.test', phone: '', type: 'Matrimonio', guests: 120, eventDate: null, message: '50%_literal', website: '' }
  let inquiryId
  let cookie

  await t.test('migration is repeatable, RLS is enabled and public roles cannot read tables or call RPCs', async () => {
    await pg.exec(migration)
    const tables = await pg.query("select relname, relrowsecurity from pg_class where relname in ('travesia_admins', 'travesia_sessions', 'travesia_inquiries', 'travesia_rate_limits')")
    assert.equal(tables.rows.length, 4)
    assert.ok(tables.rows.every((row) => row.relrowsecurity))
    for (const role of ['anon', 'authenticated']) {
      for (const sql of ['select * from public.travesia_admins', 'select * from public.travesia_inquiries', 'select public.travesia_list_inquiries(1, null, \'\')', 'select public.travesia_find_admin(\'admin@example.test\')']) {
        await assert.rejects(pg.transaction(async (tx) => { await tx.exec(`set local role ${role}`); await tx.exec(sql) }), (error) => error.code === '42501')
      }
    }
    assert.ok(await store.findAdmin(credentials.email))
  })

  await t.test('health and persistent, shared rate counters work through the SDK', async () => {
    assert.equal((await request('/health')).status, 200)
    const first = store.rateLimitStore('shared-check')
    const second = store.rateLimitStore('shared-check')
    first.init({ windowMs: 60_000 }); second.init({ windowMs: 60_000 })
    assert.equal((await first.increment('192.0.2.5')).totalHits, 1)
    const secondResult = await second.increment('192.0.2.5')
    assert.equal(secondResult.totalHits, 2)
    assert.ok(secondResult.resetTime > new Date())
    const stored = await pg.query('select key from public.travesia_rate_limits')
    assert.ok(stored.rows.every((row) => /^[a-f0-9]{64}$/.test(row.key)))
    await first.decrement('192.0.2.5')
    assert.equal((await second.increment('192.0.2.5')).totalHits, 2)
    await first.resetKey('192.0.2.5')
    assert.equal((await second.increment('192.0.2.5')).totalHits, 1)
    const expiredKey = requests.at(-1).args.p_key
    await pg.query('update public.travesia_rate_limits set expires_at = 0 where key = $1', [expiredKey])
    assert.equal((await second.increment('192.0.2.5')).totalHits, 1)
  })

  await t.test('submission and concurrent retries create only one row', async () => {
    const headers = { 'Idempotency-Key': randomUUID() }
    const results = await Promise.all(Array.from({ length: 5 }, () => request('/inquiries', { method: 'POST', body: inquiry, headers })))
    assert.equal(results.filter((response) => response.status === 201).length, 1)
    assert.equal(results.filter((response) => response.status === 200).length, 4)
    const ids = await Promise.all(results.map(async (response) => (await response.json()).id))
    assert.equal(new Set(ids).size, 1)
    inquiryId = ids[0]
    assert.equal((await pg.query('select count(*)::integer as n from public.travesia_inquiries')).rows[0].n, 1)
    assert.equal((await request('/inquiries', { method: 'POST', body: { ...inquiry, name: 'Otro nombre' }, headers })).status, 409)
    assert.equal((await request('/admin/inquiries')).status, 401)
  })

  await t.test('admin sessions, list filters, pagination and optimistic updates use Postgres', async () => {
    const response = await request('/auth/login', { method: 'POST', body: credentials })
    assert.equal(response.status, 200)
    cookie = response.headers.get('set-cookie').split(';')[0]
    const headers = { Cookie: cookie }
    assert.equal((await request('/auth/session', { headers })).status, 200)
    const session = (await pg.query('select token_hash from public.travesia_sessions')).rows[0]
    assert.equal(session.token_hash, tokenHash(cookie.split('=')[1]))
    for (let i = 0; i < 21; i++) {
      assert.equal((await request('/inquiries', { method: 'POST', body: { ...inquiry, name: `Cliente ${i}`, message: 'Otro mensaje' }, headers: { 'Idempotency-Key': randomUUID() } })).status, 201)
    }
    const page1 = await (await request('/admin/inquiries', { headers })).json()
    assert.equal(page1.total, 22); assert.equal(page1.items.length, 20); assert.equal(page1.counts.new, 22)
    assert.equal(page1.items[0].request_key, undefined)
    assert.equal(page1.items[0].fingerprint, undefined)
    const page2 = await (await request('/admin/inquiries?page=2', { headers })).json()
    assert.equal(page2.items.length, 2)
    assert.equal(new Set([...page1.items, ...page2.items].map((row) => row.id)).size, 22)
    const searched = await (await request(`/admin/inquiries?search=${encodeURIComponent('50%_literal')}`, { headers })).json()
    assert.equal(searched.total, 1)
    assert.equal((await (await request(`/admin/inquiries?search=${encodeURIComponent("' OR 1=1 --")}`, { headers })).json()).total, 0)
    const changed = await request(`/admin/inquiries/${inquiryId}`, { method: 'PATCH', headers, body: { status: 'quoted', notes: 'Enviado.', version: 1 } })
    assert.equal(changed.status, 200)
    assert.equal((await changed.json()).version, 2)
    const filtered = await (await request('/admin/inquiries?status=quoted', { headers })).json()
    assert.equal(filtered.total, 1); assert.equal(filtered.items[0].notes, 'Enviado.')
    assert.equal((await request(`/admin/inquiries/${inquiryId}`, { method: 'PATCH', headers, body: { status: 'closed', notes: '', version: 1 } })).status, 409)
    assert.equal((await request(`/admin/inquiries/${randomUUID()}`, { method: 'PATCH', headers, body: { status: 'closed', notes: '', version: 1 } })).status, 404)
  })

  await t.test('password rotation preserves the admin ID and revokes sessions', async () => {
    const updated = await createAdmin(store, { ...credentials, password: randomBytes(24).toString('hex') })
    assert.equal(updated.id, admin.id)
    assert.equal((await request('/auth/session', { headers: { Cookie: cookie } })).status, 401)
    assert.equal((await request('/auth/login', { method: 'POST', body: credentials })).status, 401)
  })

  await t.test('Vercel handler serves original and rewritten API URLs with filters and secure cookies', async () => {
    const password = randomBytes(24).toString('hex')
    await createAdmin(store, { ...credentials, password })
    let initializations = 0
    const handler = createVercelHandler({ env: { APP_ORIGIN: 'https://demo-eventos-liard.vercel.app' }, openStore: async (env) => {
      assert.equal(env.VERCEL, '1'); assert.equal(env.STORAGE_PROVIDER, 'supabase')
      initializations++
      return store
    } })
    const functionServer = createServer(handler)
    functionServer.listen(0, '127.0.0.1')
    await once(functionServer, 'listening')
    const base = `http://127.0.0.1:${functionServer.address().port}`
    try {
      for (const path of ['/api/health', '/api?__travesia_route=health', '/api/index.mjs?__travesia_route=health']) {
        const response = await fetch(`${base}${path}`)
        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), { status: 'ok' })
      }
      const login = await fetch(`${base}/api?__travesia_route=auth%2Flogin`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://demo-eventos-liard.vercel.app' }, body: JSON.stringify({ email: credentials.email, password }),
      })
      assert.equal(login.status, 200)
      assert.ok(login.headers.get('set-cookie').includes('Secure'))
      const response = await fetch(`${base}/api?__travesia_route=admin%2Finquiries&status=quoted&search=50%25_literal`, { headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } })
      assert.equal(response.status, 200)
      const filtered = await response.json()
      assert.equal(filtered.total, 1)
      assert.equal(filtered.items[0].id, inquiryId)
      assert.equal(initializations, 1)
    } finally {
      await new Promise((resolve) => { functionServer.close(resolve); functionServer.closeAllConnections() })
    }
  })
})

test('Vercel rejects SQLite and Supabase fails safely without configuration', async () => {
  await assert.rejects(openStorage({ VERCEL: '1', STORAGE_PROVIDER: 'sqlite' }), /SQLite/)
  await assert.rejects(openStorage({ STORAGE_PROVIDER: 'supabase' }), /SUPABASE_URL/)
  assert.throws(() => supabaseStore({ url: 'https://fixture.supabase.co', key: 'sb_publishable_fixture' }), /clave secreta/)
  assert.throws(() => supabaseStore({ url: 'http://example.test', key: 'sb_secret_fixture' }), /HTTPS/)
})
