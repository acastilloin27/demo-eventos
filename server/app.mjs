import express from 'express'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { credentialsSchema, hashPassword, verifyPassword, tokenHash, newToken } from './auth.mjs'
import { inquirySchema, listSchema, updateSchema } from './validation.mjs'

const cookieName = 'travesia_session'
const sessionDuration = 8 * 60 * 60 * 1000
const uuid = z.string().uuid()
const inquiryColumns = `id, name, email, phone, type, guests, event_date AS eventDate, message,
  status, notes, version, created_at AS createdAt, updated_at AS updatedAt`

export async function createApp({ db, production = false, origins = ['http://localhost:5173', 'http://127.0.0.1:5173'], trustProxyHops = 0,
  limits = {}, staticDir = resolve('dist') }) {
  const app = express()
  const dummyHash = await hashPassword(newToken())
  app.disable('x-powered-by')
  if (trustProxyHops) app.set('trust proxy', trustProxyHops)
  app.use(helmet({
    strictTransportSecurity: production ? undefined : false,
    contentSecurityPolicy: production ? { directives: {
      'img-src': ["'self'", 'data:', 'https://images.unsplash.com'],
      'style-src': ["'self'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'script-src': ["'self'"],
      'connect-src': ["'self'"],
    } } : false,
  }))
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  app.use('/api', rateLimit({ windowMs: 60_000, limit: limits.api ?? 120, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Intenta nuevamente en un minuto.' } }))
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if ((req.get('origin') && !origins.includes(req.get('origin'))) || req.get('sec-fetch-site') === 'cross-site') {
        return res.status(403).json({ error: 'Origen no autorizado.' })
      }
      if (!req.is('application/json')) return res.status(415).json({ error: 'Se requiere JSON.' })
    }
    next()
  })
  app.use(express.json({ limit: '24kb' }))

  const cookieOptions = { httpOnly: true, secure: production, sameSite: 'strict', path: '/api' }
  const requireAdmin = (req, res, next) => {
    const token = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({ error: 'Inicia sesión para continuar.' })
    const session = db.prepare(`SELECT a.id, a.email FROM sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).get(tokenHash(token), Date.now())
    if (!session) {
      res.clearCookie(cookieName, cookieOptions)
      return res.status(401).json({ error: 'Tu sesión venció. Inicia sesión nuevamente.' })
    }
    req.admin = session
    req.sessionHash = tokenHash(token)
    next()
  }

  app.get('/api/health', (_req, res) => {
    db.prepare('SELECT 1').get()
    res.json({ status: 'ok' })
  })

  app.post('/api/inquiries', rateLimit({ windowMs: 15 * 60_000, limit: limits.inquiries ?? 5,
    standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Has enviado varias solicitudes. Espera 15 minutos antes de intentar nuevamente.' } }), (req, res) => {
    const input = inquirySchema.parse(req.body)
    const key = uuid.parse(req.get('Idempotency-Key'))
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const previous = db.prepare('SELECT id, fingerprint FROM inquiries WHERE request_key = ?').get(key)
    if (previous) {
      if (previous.fingerprint !== fingerprint) return res.status(409).json({ error: 'Esta solicitud ya fue enviada con otros datos. Inicia una nueva consulta.' })
      return res.status(200).json({ id: previous.id })
    }
    const id = randomUUID()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO inquiries (id, request_key, fingerprint, name, email, phone, type, guests, event_date, message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, key, fingerprint, input.name, input.email, input.phone, input.type, input.guests, input.eventDate, input.message, now, now)
    res.status(201).json({ id })
  })

  app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60_000, limit: limits.login ?? 5, skipSuccessfulRequests: true,
    standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Demasiados intentos. Espera 15 minutos.' } }), async (req, res) => {
    const credentials = credentialsSchema.safeParse(req.body)
    if (!credentials.success) return res.status(401).json({ error: 'Email o contraseña incorrectos.' })
    const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(credentials.data.email)
    const valid = await verifyPassword(credentials.data.password, admin?.password_hash || dummyHash)
    if (!admin || !valid) return res.status(401).json({ error: 'Email o contraseña incorrectos.' })
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
    const token = newToken()
    db.prepare('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), admin.id, Date.now() + sessionDuration)
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: sessionDuration })
    res.json({ email: admin.email })
  })

  app.get('/api/auth/session', requireAdmin, (req, res) => res.json({ email: req.admin.email }))
  app.post('/api/auth/logout', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash)
    res.clearCookie(cookieName, cookieOptions)
    res.status(204).end()
  })

  app.get('/api/admin/inquiries', requireAdmin, (req, res) => {
    const { page, status, search } = listSchema.parse(req.query)
    // Escape LIKE metacharacters so searches are literal and always parameterized.
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`
    const where = `WHERE (? IS NULL OR status = ?) AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\')`
    const args = [status ?? null, status ?? null, pattern, pattern, pattern]
    const total = db.prepare(`SELECT COUNT(*) AS total FROM inquiries ${where}`).get(...args).total
    const pageSize = 20
    const items = db.prepare(`SELECT ${inquiryColumns} FROM inquiries ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize)
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS count FROM inquiries GROUP BY status').all().map((row) => [row.status, row.count]))
    res.json({ items, total, page, pageSize, counts })
  })

  app.patch('/api/admin/inquiries/:id', requireAdmin, (req, res) => {
    const id = uuid.parse(req.params.id)
    const input = updateSchema.parse(req.body)
    const result = db.prepare(`UPDATE inquiries SET status = ?, notes = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`)
      .run(input.status, input.notes, new Date().toISOString(), id, input.version)
    if (!result.changes) {
      const exists = db.prepare('SELECT id FROM inquiries WHERE id = ?').get(id)
      return res.status(exists ? 409 : 404).json({ error: exists ? 'Otra persona modificó esta solicitud. Actualiza la lista antes de guardar.' : 'Solicitud no encontrada.' })
    }
    res.json(db.prepare(`SELECT ${inquiryColumns} FROM inquiries WHERE id = ?`).get(id))
  })

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }))
  if (existsSync(resolve(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false }))
    app.get(['/', '/admin'], (_req, res) => res.sendFile(resolve(staticDir, 'index.html')))
  }
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) return res.status(422).json({ error: 'Revisa los datos enviados.', fields: error.flatten().fieldErrors })
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'La solicitud es demasiado extensa.' })
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' })
    console.error('Error interno:', error.code || error.name)
    res.status(500).json({ error: 'No pudimos procesar la solicitud. Intenta nuevamente.' })
  })
  return app
}
