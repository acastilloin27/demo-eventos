import express from 'express'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { credentialsSchema, hashPassword, verifyPassword, tokenHash, newToken } from './auth.mjs'
import { inquirySchema, listSchema, updateSchema } from './validation.mjs'
import { sqliteStore } from './sqlite-store.mjs'

const cookieName = 'travesia_session'
const sessionDuration = 8 * 60 * 60 * 1000
const uuid = z.string().uuid()
export async function createApp({ db, store = db ? sqliteStore(db) : null, production = false, origins = ['http://localhost:5173', 'http://127.0.0.1:5173'], trustProxyHops = 0,
  limits = {}, staticDir = resolve('dist') }) {
  if (!store) throw new Error('Se necesita un almacén de datos.')
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
    store: store.rateLimitStore?.('api'), message: { error: 'Demasiadas solicitudes. Intenta nuevamente en un minuto.' } }))
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
  const requireAdmin = async (req, res, next) => {
    const token = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({ error: 'Inicia sesión para continuar.' })
    const session = await store.findSession(tokenHash(token), Date.now())
    if (!session) {
      res.clearCookie(cookieName, cookieOptions)
      return res.status(401).json({ error: 'Tu sesión venció. Inicia sesión nuevamente.' })
    }
    req.admin = session
    req.sessionHash = tokenHash(token)
    next()
  }

  app.get('/api/health', async (_req, res) => {
    await store.health()
    res.json({ status: 'ok' })
  })

  app.post('/api/inquiries', rateLimit({ windowMs: 15 * 60_000, limit: limits.inquiries ?? 5,
    standardHeaders: 'draft-8', legacyHeaders: false, store: store.rateLimitStore?.('inquiries'),
    message: { error: 'Has enviado varias solicitudes. Espera 15 minutos antes de intentar nuevamente.' } }), async (req, res) => {
    const input = inquirySchema.parse(req.body)
    const key = uuid.parse(req.get('Idempotency-Key'))
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const result = await store.submitInquiry({ id: randomUUID(), key, fingerprint, input, now: new Date().toISOString() })
    if (result.kind === 'conflict') return res.status(409).json({ error: 'Esta solicitud ya fue enviada con otros datos. Inicia una nueva consulta.' })
    res.status(result.kind === 'created' ? 201 : 200).json({ id: result.id })
  })

  app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60_000, limit: limits.login ?? 5, skipSuccessfulRequests: !store.rateLimitStore,
    standardHeaders: 'draft-8', legacyHeaders: false, store: store.rateLimitStore?.('login'),
    message: { error: 'Demasiados intentos. Espera 15 minutos.' } }), async (req, res) => {
    const credentials = credentialsSchema.safeParse(req.body)
    if (!credentials.success) return res.status(401).json({ error: 'Email o contraseña incorrectos.' })
    const admin = await store.findAdmin(credentials.data.email)
    const valid = await verifyPassword(credentials.data.password, admin?.password_hash || dummyHash)
    if (!admin || !valid) return res.status(401).json({ error: 'Email o contraseña incorrectos.' })
    const token = newToken()
    await store.createSession({ hash: tokenHash(token), adminId: admin.id, expiresAt: Date.now() + sessionDuration, now: Date.now() })
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: sessionDuration })
    res.json({ email: admin.email })
  })

  app.get('/api/auth/session', requireAdmin, (req, res) => res.json({ email: req.admin.email }))
  app.post('/api/auth/logout', requireAdmin, async (req, res) => {
    await store.deleteSession(req.sessionHash)
    res.clearCookie(cookieName, cookieOptions)
    res.status(204).end()
  })

  app.get('/api/admin/inquiries', requireAdmin, async (req, res) => {
    res.json(await store.listInquiries(listSchema.parse(req.query)))
  })

  app.patch('/api/admin/inquiries/:id', requireAdmin, async (req, res) => {
    const id = uuid.parse(req.params.id)
    const input = updateSchema.parse(req.body)
    const result = await store.updateInquiry(id, input, new Date().toISOString())
    if (result.kind !== 'updated') {
      return res.status(result.kind === 'conflict' ? 409 : 404).json({ error: result.kind === 'conflict' ? 'Otra persona modificó esta solicitud. Actualiza la lista antes de guardar.' : 'Solicitud no encontrada.' })
    }
    res.json(result.item)
  })

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }))
  if (staticDir && existsSync(resolve(staticDir, 'index.html'))) {
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
