import { createApp } from './app.mjs'
import { openDatabase } from './database.mjs'

const production = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT || 3001)
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválido.')
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) throw new Error('TRUST_PROXY_HOPS inválido.')
if (production && !process.env.APP_ORIGIN?.startsWith('https://')) throw new Error('Configura APP_ORIGIN con tu dominio HTTPS en producción.')
const origins = production ? [new URL(process.env.APP_ORIGIN).origin] : [...new Set([
  'http://localhost:5173', 'http://127.0.0.1:5173', `http://localhost:${port}`, `http://127.0.0.1:${port}`,
  ...(process.env.APP_ORIGIN ? [new URL(process.env.APP_ORIGIN).origin] : []),
])]
const db = openDatabase()
const app = await createApp({ db, production, origins, trustProxyHops })
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Travesía API: http://${process.env.HOST || '127.0.0.1'}:${port}`))
server.on('error', (error) => { console.error('No se pudo iniciar el servidor:', error.code); db.close(); process.exitCode = 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(() => { db.close(); process.exit(0) })
  setTimeout(() => process.exit(1), 10_000).unref()
})
