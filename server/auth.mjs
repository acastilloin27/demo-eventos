import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { z } from 'zod'

const scrypt = promisify(scryptCallback)
export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
})

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const key = await scrypt(password, salt, 64)
  return `${salt}:${key.toString('hex')}`
}

export async function verifyPassword(password, encoded) {
  const [salt, hash] = encoded.split(':')
  const actual = await scrypt(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return expected.length === actual.length && timingSafeEqual(actual, expected)
}

export const tokenHash = (token) => createHash('sha256').update(token).digest('hex')
export const newToken = () => randomBytes(32).toString('hex')

export async function createAdmin(db, input) {
  const credentials = credentialsSchema.parse(input)
  const id = randomUUID()
  const passwordHash = await hashPassword(credentials.password)
  // Running the command again rotates the password and revokes existing sessions.
  db.exec('BEGIN IMMEDIATE')
  try {
    const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(credentials.email)
    if (existing) {
      db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(passwordHash, existing.id)
      db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(existing.id)
    } else {
      db.prepare('INSERT INTO admins (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(id, credentials.email, passwordHash, new Date().toISOString())
    }
    db.exec('COMMIT')
    return { id: existing?.id || id, email: credentials.email }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
