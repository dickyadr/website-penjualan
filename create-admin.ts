import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'

const [, , name, email, password] = process.argv
if (!name || !email || !password || password.length < 6) throw new Error('Gunakan: npm run create:admin -- "Nama Admin" email password-minimal-6-karakter')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diatur pada file .env')
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const passwordHash = await bcrypt.hash(password, 12)
await pool.query(
  `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')
   ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, role='admin'`,
  [name, email.toLowerCase().trim(), passwordHash],
)
await pool.end()
console.log(`Akun admin ${email} berhasil disiapkan.`)
