import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'

export function supabaseStore({ url, key, client, fetch: fetchImplementation } = {}) {
  if (!client) {
    if (!url || !key) throw new Error('Configura SUPABASE_URL y SUPABASE_SECRET_KEY en las variables del servidor.')
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) throw new Error('SUPABASE_URL debe usar HTTPS.')
    if (key.startsWith('sb_publishable_')) throw new Error('La API necesita la clave secreta de servidor, no la clave pública.')
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetchImplementation || ((input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) })) },
    })
  }
  async function rpc(name, parameters = {}) {
    const { data, error } = await client.rpc(`travesia_${name}`, parameters)
    if (error) {
      const failure = new Error('No se pudo completar la operación en Supabase.')
      failure.code = error.code || 'SUPABASE_UNAVAILABLE'
      throw failure
    }
    return data
  }
  return {
    kind: 'supabase',
    close() {},
    health: () => rpc('health'),
    findAdmin: (email) => rpc('find_admin', { p_email: email }),
    saveAdmin: ({ id, email, passwordHash, now }) => rpc('save_admin', { p_id: id, p_email: email, p_password_hash: passwordHash, p_now: now }),
    findSession: (hash, now) => rpc('find_session', { p_hash: hash, p_now: now }),
    createSession: ({ hash, adminId, expiresAt, now }) => rpc('create_session', { p_hash: hash, p_admin_id: adminId, p_expires_at: expiresAt, p_now: now }),
    deleteSession: (hash) => rpc('delete_session', { p_hash: hash }),
    submitInquiry: ({ id, key: requestKey, fingerprint, input, now }) => rpc('submit_inquiry', {
      p_id: id, p_request_key: requestKey, p_fingerprint: fingerprint,
      p_name: input.name, p_email: input.email, p_phone: input.phone, p_type: input.type,
      p_guests: input.guests, p_event_date: input.eventDate, p_message: input.message, p_now: now,
    }),
    listInquiries: ({ page, status, search }) => rpc('list_inquiries', { p_page: page, p_status: status ?? null, p_search: search }),
    updateInquiry: (id, input, now) => rpc('update_inquiry', { p_id: id, p_status: input.status, p_notes: input.notes, p_version: input.version, p_now: now }),
    // All Vercel instances share atomic rate counters in Postgres. No raw IPs are stored.
    rateLimitStore(scope) {
      let windowMs
      const hashKey = (ipKey) => createHmac('sha256', key).update(`${scope}:${ipKey}`).digest('hex')
      return {
        localKeys: false,
        prefix: `travesia:${scope}:`,
        init(options) { windowMs = options.windowMs },
        async increment(ipKey) {
          const result = await rpc('rate_hit', { p_key: hashKey(ipKey), p_window_ms: windowMs })
          return { totalHits: result.hits, resetTime: new Date(result.expiresAt) }
        },
        async decrement(ipKey) { await rpc('rate_decrement', { p_key: hashKey(ipKey) }) },
        async resetKey(ipKey) { await rpc('rate_reset', { p_key: hashKey(ipKey) }) },
      }
    },
  }
}
