import { createApp } from './app.mjs'
import { openStorage } from './storage.mjs'

export function createVercelHandler({ env = process.env, openStore = openStorage } = {}) {
  let appPromise
  async function getApp() {
    if (!appPromise) {
      appPromise = (async () => {
        // Never fall back to a local SQLite file on a serverless instance.
        const store = await openStore({ ...env, VERCEL: '1', STORAGE_PROVIDER: 'supabase' })
        const origin = env.APP_ORIGIN || 'https://demo-eventos-liard.vercel.app'
        if (new URL(origin).protocol !== 'https:') throw new Error('APP_ORIGIN debe usar HTTPS en Vercel.')
        return createApp({ store, production: true, origins: [new URL(origin).origin], trustProxyHops: 1, staticDir: null })
      })().catch((error) => { appPromise = undefined; throw error })
    }
    return appPromise
  }

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store')
    try {
      const app = await getApp()
      // Support Vercel's original and rewritten request URLs without losing filters.
      const url = new URL(req.url, 'http://localhost')
      if (['/api', '/api/', '/api/index', '/api/index.mjs'].includes(url.pathname) && url.searchParams.has('__travesia_route')) {
        const route = url.searchParams.get('__travesia_route')
        url.searchParams.delete('__travesia_route')
        url.pathname = `/api/${route}`
        req.url = url.pathname + url.search
      }
      return app(req, res)
    } catch (error) {
      console.error('No se pudo iniciar la API:', error.code || error.name)
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'La API todavía no está configurada. Revisa las variables de Supabase del servidor.' }))
    }
  }
}
