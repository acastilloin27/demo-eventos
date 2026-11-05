import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { z } from 'zod'
import { sqliteStore } from './sqlite-store.mjs'

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

export async function createAdmin(storage, input) {
  const store = storage.prepare ? sqliteStore(storage) : storage
  const credentials = credentialsSchema.parse(input)
  const id = randomUUID()
  const passwordHash = await hashPassword(credentials.password)
  return store.saveAdmin({ id, email: credentials.email, passwordHash, now: new Date().toISOString() })
}
