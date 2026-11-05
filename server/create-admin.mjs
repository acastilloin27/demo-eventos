import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { openDatabase } from './database.mjs'
import { createAdmin } from './auth.mjs'

// Mask terminal output while reading the password; never store a plaintext password.
let hidden = false
const output = new Writable({ write(chunk, _encoding, done) { if (!hidden) process.stdout.write(chunk); done() } })
const rl = createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY })
let db
try {
  if (!process.stdin.isTTY) throw new Error('Ejecuta este comando en una terminal interactiva.')
  const email = await rl.question('Email del administrador: ')
  process.stdout.write('Contraseña (12 a 128 caracteres; entrada oculta): ')
  hidden = true
  const password = await rl.question('')
  hidden = false
  process.stdout.write('\nRepite la contraseña: ')
  hidden = true
  const confirmation = await rl.question('')
  hidden = false
  process.stdout.write('\n')
  if (password !== confirmation) throw new Error('Las contraseñas no coinciden.')
  db = openDatabase()
  await createAdmin(db, { email, password })
  console.log('Cuenta guardada. Puedes ingresar en /admin. Las sesiones anteriores de esta cuenta se cerraron.')
} catch (error) {
  hidden = false
  console.error(error.name === 'ZodError' ? '\nUsa un email válido y una contraseña de 12 a 128 caracteres.' : `\n${error.message}`)
  process.exitCode = 1
} finally {
  hidden = false
  rl.close()
  db?.close()
}
