import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { openDatabase } from '../database.mjs'
import { createApp } from '../app.mjs'
import { createAdmin, tokenHash } from '../auth.mjs'

const credentials = { email: 'admin@example.test', password: randomBytes(24).toString('hex') }
const input = { name: 'María Pérez', email: 'maria@example.test', phone: '+56 9 1234 5678', type: 'Matrimonio', guests: 120, eventDate: null, message: 'Quisiera una cotización.', website: '' }

async function setup(t, options = {}) {
  const db = openDatabase(':memory:')
  await createAdmin(db, credentials)
  const app = await createApp({ db, limits: { api: 1000, inquiries: 1000, login: 1000 }, ...options })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections() })
    db.close()
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const request = (path, { body, headers, ...rest } = {}) => fetch(`${base}/api${path}`, {
    ...rest, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const login = async () => {
    const response = await request('/auth/login', { method: 'POST', body: credentials })
    assert.equal(response.status, 200)
    return response.headers.get('set-cookie').split(';')[0]
  }
  return { db, request, login, base }
}

test('public submission persists and retries do not duplicate records', async (t) => {
  const { db, request } = await setup(t)
  const headers = { 'Idempotency-Key': randomUUID() }
  const first = await request('/inquiries', { method: 'POST', body: input, headers })
  assert.equal(first.status, 201)
  const result = await first.json()
  const retry = await request('/inquiries', { method: 'POST', body: input, headers })
  assert.equal(retry.status, 200)
  assert.equal((await retry.json()).id, result.id)
  const record = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(result.id)
  assert.equal(record.name, input.name)
  assert.equal(record.status, 'new')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inquiries').get().n, 1)
  const mismatch = await request('/inquiries', { method: 'POST', body: { ...input, name: 'Otro nombre' }, headers })
  assert.equal(mismatch.status, 409)
})

test('server validates fields, dates, capacity, spam traps and request IDs', async (t) => {
  const { db, request } = await setup(t)
  for (const body of [
    { ...input, name: '' }, { ...input, email: 'invalid' }, { ...input, guests: 281 },
    { ...input, guests: 10.5 }, { ...input, guests: '100' }, { ...input, type: 'Invalid' },
    { ...input, eventDate: '2020-01-01' }, { ...input, eventDate: '2030-02-30' },
    { ...input, website: 'spam' }, { ...input, message: 'a'.repeat(5001) }, { ...input, status: 'closed' },
  ]) {
    const response = await request('/inquiries', { method: 'POST', body, headers: { 'Idempotency-Key': randomUUID() } })
    assert.equal(response.status, 422)
  }
  const missingKey = await request('/inquiries', { method: 'POST', body: input })
  assert.equal(missingKey.status, 422)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inquiries').get().n, 0)
})

test('private endpoints reject anonymous access and do not expose records', async (t) => {
  const { request } = await setup(t)
  assert.equal((await request('/admin/inquiries')).status, 401)
  assert.equal((await request('/auth/session')).status, 401)
  assert.equal((await request(`/admin/inquiries/${randomUUID()}`, { method: 'PATCH', body: { status: 'closed', notes: '', version: 1 } })).status, 401)
  assert.equal((await request('/inquiries')).status, 404)
})

test('login, hashed sessions, logout and invalid credentials', async (t) => {
  const { db, request, login } = await setup(t)
  const badLogin = await request('/auth/login', { method: 'POST', body: { ...credentials, password: 'wrong-password-123' } })
  assert.equal(badLogin.status, 401)
  const cookie = await login()
  const session = await request('/auth/session', { headers: { Cookie: cookie } })
  assert.equal(session.status, 200)
  assert.equal((await session.json()).email, credentials.email)
  const stored = db.prepare('SELECT * FROM sessions').get()
  assert.notEqual(stored.token_hash, cookie.split('=')[1])
  assert.equal(stored.token_hash, tokenHash(cookie.split('=')[1]))
  const password = db.prepare('SELECT password_hash FROM admins').get().password_hash
  assert.notEqual(password, credentials.password)
  assert.equal((await request('/auth/logout', { method: 'POST', body: {}, headers: { Cookie: cookie } })).status, 204)
  assert.equal((await request('/auth/session', { headers: { Cookie: cookie } })).status, 401)
})

test('sessions expire and rotating credentials revokes sessions', async (t) => {
  const { db, request, login } = await setup(t)
  const expiredCookie = await login()
  db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1)
  assert.equal((await request('/auth/session', { headers: { Cookie: expiredCookie } })).status, 401)
  const cookie = await login()
  await createAdmin(db, { ...credentials, password: randomBytes(24).toString('hex') })
  assert.equal((await request('/auth/session', { headers: { Cookie: cookie } })).status, 401)
})

test('admin can filter, search, paginate and update notes and statuses', async (t) => {
  const { request, login } = await setup(t)
  let firstId
  for (let i = 0; i < 23; i++) {
    const result = await request('/inquiries', { method: 'POST', body: { ...input, name: `Cliente ${i}`, message: i === 0 ? 'Oferta al 50%_literal' : input.message }, headers: { 'Idempotency-Key': randomUUID() } })
    assert.equal(result.status, 201)
    const { id } = await result.json()
    if (!i) firstId = id
  }
  const headers = { Cookie: await login() }
  const page1 = await (await request('/admin/inquiries', { headers })).json()
  assert.equal(page1.total, 23); assert.equal(page1.items.length, 20); assert.equal(page1.counts.new, 23)
  assert.equal(page1.items[0].fingerprint, undefined)
  assert.equal(page1.items[0].request_key, undefined)
  const page2 = await (await request('/admin/inquiries?page=2', { headers })).json()
  assert.equal(page2.items.length, 3)
  assert.equal(new Set([...page1.items, ...page2.items].map((item) => item.id)).size, 23)
  const update = await request(`/admin/inquiries/${firstId}`, { method: 'PATCH', headers, body: { status: 'quoted', notes: 'Cotización enviada.', version: 1 } })
  assert.equal(update.status, 200)
  const changed = await update.json()
  assert.equal(changed.notes, 'Cotización enviada.'); assert.equal(changed.version, 2)
  const filtered = await (await request('/admin/inquiries?status=quoted', { headers })).json()
  assert.equal(filtered.total, 1); assert.equal(filtered.items[0].id, firstId)
  const searched = await (await request(`/admin/inquiries?search=${encodeURIComponent('50%_literal')}`, { headers })).json()
  assert.equal(searched.total, 1)
  const injection = await (await request(`/admin/inquiries?search=${encodeURIComponent("' OR 1=1 --")}`, { headers })).json()
  assert.equal(injection.total, 0)
  assert.equal((await request('/admin/inquiries?page=-1', { headers })).status, 422)
  assert.equal((await request(`/admin/inquiries/${firstId}`, { method: 'PATCH', headers, body: { status: 'closed', notes: '', version: 1 } })).status, 409)
  assert.equal((await request(`/admin/inquiries/${randomUUID()}`, { method: 'PATCH', headers, body: { status: 'closed', notes: '', version: 1 } })).status, 404)
})

test('cross-site writes and form posts are blocked', async (t) => {
  const { request, login } = await setup(t)
  const headers = { 'Idempotency-Key': randomUUID(), Origin: 'https://untrusted.example' }
  assert.equal((await request('/inquiries', { method: 'POST', body: input, headers })).status, 403)
  assert.equal((await request('/auth/login', { method: 'POST', body: credentials, headers })).status, 403)
  const cookie = await login()
  assert.equal((await request('/auth/logout', { method: 'POST', body: {}, headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
  assert.equal((await request('/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415)
  const allowed = await request('/inquiries', { method: 'POST', body: input, headers: { 'Idempotency-Key': randomUUID(), Origin: 'http://localhost:5173' } })
  assert.equal(allowed.status, 201)
})

test('submission and authentication rate limits apply', async (t) => {
  const { request } = await setup(t, { limits: { api: 1000, inquiries: 1, login: 1 } })
  assert.equal((await request('/inquiries', { method: 'POST', body: input, headers: { 'Idempotency-Key': randomUUID() } })).status, 201)
  assert.equal((await request('/inquiries', { method: 'POST', body: input, headers: { 'Idempotency-Key': randomUUID() } })).status, 429)
  const bad = { ...credentials, password: 'wrong-password-123' }
  assert.equal((await request('/auth/login', { method: 'POST', body: bad })).status, 401)
  assert.equal((await request('/auth/login', { method: 'POST', body: bad })).status, 429)
})

test('JSON errors, size limits and API 404 return safe JSON', async (t) => {
  const { request, base } = await setup(t)
  const malformed = await fetch(`${base}/api/inquiries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })
  assert.equal(malformed.status, 400)
  assert.deepEqual(await malformed.json(), { error: 'JSON inválido.' })
  assert.equal((await request('/missing')).status, 404)
  assert.equal((await request('/inquiries', { method: 'POST', body: { message: 'x'.repeat(25000) } })).status, 413)
  const response = await request('/health')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { status: 'ok' })
})

test('production cookies are HttpOnly, Secure, SameSite and scoped to API', async (t) => {
  const { request } = await setup(t, { production: true, origins: ['https://travesia.example'] })
  const response = await request('/auth/login', { method: 'POST', body: credentials, headers: { Origin: 'https://travesia.example' } })
  assert.equal(response.status, 200)
  const cookie = response.headers.get('set-cookie')
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api']) assert.ok(cookie.includes(flag))
})

test('SQLite records survive closing and reopening the database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'travesia-test-'))
  const filename = join(directory, 'test.sqlite')
  let db
  let server
  try {
    db = openDatabase(filename)
    await createAdmin(db, credentials)
    const app = await createApp({ db })
    server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/inquiries`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify(input),
    })
    assert.equal(response.status, 201)
    const { id } = await response.json()
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections() })
    server = null
    db.close()
    db = openDatabase(filename)
    assert.equal(db.prepare('SELECT email FROM admins').get().email, credentials.email)
    assert.equal(db.prepare('SELECT name FROM inquiries WHERE id = ?').get(id).name, input.name)
  } finally {
    if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections() })
    db?.close()
    // The path comes directly from mkdtemp inside the OS temporary directory.
    assert.ok(directory.startsWith(join(tmpdir(), 'travesia-test-')))
    rmSync(directory, { recursive: true, force: true })
  }
})
