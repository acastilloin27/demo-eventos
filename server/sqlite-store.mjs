const columns = `id, name, email, phone, type, guests, event_date AS eventDate, message,
  status, notes, version, created_at AS createdAt, updated_at AS updatedAt`

// Keep SQLite available for local development without a Supabase account.
export function sqliteStore(db) {
  return {
    kind: 'sqlite',
    close: () => db.close(),
    health: async () => { db.prepare('SELECT 1').get() },
    findAdmin: async (email) => db.prepare('SELECT * FROM admins WHERE email = ?').get(email),
    saveAdmin: async ({ id, email, passwordHash, now }) => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(email)
        if (existing) {
          db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(passwordHash, existing.id)
          db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(existing.id)
        } else {
          db.prepare('INSERT INTO admins (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(id, email, passwordHash, now)
        }
        db.exec('COMMIT')
        return { id: existing?.id || id, email }
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    findSession: async (hash, now) => db.prepare(`SELECT a.id, a.email FROM sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).get(hash, now),
    createSession: async ({ hash, adminId, expiresAt, now }) => {
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
      db.prepare('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)').run(hash, adminId, expiresAt)
    },
    deleteSession: async (hash) => { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash) },
    submitInquiry: async ({ id, key, fingerprint, input, now }) => {
      const previous = db.prepare('SELECT id, fingerprint FROM inquiries WHERE request_key = ?').get(key)
      if (previous) return { kind: previous.fingerprint === fingerprint ? 'duplicate' : 'conflict', id: previous.id }
      db.prepare(`INSERT INTO inquiries (id, request_key, fingerprint, name, email, phone, type, guests, event_date, message, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, key, fingerprint, input.name, input.email, input.phone, input.type, input.guests, input.eventDate, input.message, now, now)
      return { kind: 'created', id }
    },
    listInquiries: async ({ page, status, search }) => {
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`
      const where = `WHERE (? IS NULL OR status = ?) AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\')`
      const args = [status ?? null, status ?? null, pattern, pattern, pattern]
      const total = db.prepare(`SELECT COUNT(*) AS total FROM inquiries ${where}`).get(...args).total
      const pageSize = 20
      const items = db.prepare(`SELECT ${columns} FROM inquiries ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize)
      const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS count FROM inquiries GROUP BY status').all().map((row) => [row.status, row.count]))
      return { items, total, page, pageSize, counts }
    },
    updateInquiry: async (id, input, now) => {
      const result = db.prepare('UPDATE inquiries SET status = ?, notes = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?')
        .run(input.status, input.notes, now, id, input.version)
      if (!result.changes) return { kind: db.prepare('SELECT id FROM inquiries WHERE id = ?').get(id) ? 'conflict' : 'missing' }
      return { kind: 'updated', item: db.prepare(`SELECT ${columns} FROM inquiries WHERE id = ?`).get(id) }
    },
  }
}
