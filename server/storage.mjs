export async function openStorage(env = process.env) {
  const provider = env.STORAGE_PROVIDER || (env.SUPABASE_URL ? 'supabase' : 'sqlite')
  if (provider === 'supabase') {
    const { supabaseStore } = await import('./supabase-store.mjs')
    return supabaseStore({ url: env.SUPABASE_URL, key: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY })
  }
  if (provider !== 'sqlite') throw new Error('STORAGE_PROVIDER debe ser sqlite o supabase.')
  if (env.VERCEL) throw new Error('SQLite local no es persistente en Vercel. Configura STORAGE_PROVIDER=supabase y sus variables.')
  const [{ openDatabase }, { sqliteStore }] = await Promise.all([import('./database.mjs'), import('./sqlite-store.mjs')])
  return sqliteStore(openDatabase(env.DATABASE_PATH))
}
