import 'dotenv/config'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import webpush from 'web-push'
import crypto from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import pool, { type DbRow } from './db.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const productImageDirectory = resolve(process.cwd(), 'uploads', 'products')
const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabaseStorageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'products'
const jwtSecret = process.env.JWT_SECRET || 'change-this-secret'
const midtransServerKey = process.env.MIDTRANS_SERVER_KEY || ''
const midtransClientKey = process.env.MIDTRANS_CLIENT_KEY || ''
const midtransProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true'
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || ''
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || ''
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@jelitaflower.com'
const pushNotificationsConfigured = Boolean(vapidPublicKey && vapidPrivateKey)
let storageBucketReady: Promise<void> | null = null
if (pushNotificationsConfigured) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
} else {
  console.warn('Push notification belum aktif. Isi VAPID_PUBLIC_KEY dan VAPID_PRIVATE_KEY untuk mengaktifkannya.')
}
app.use(cors())
app.use('/uploads/products', express.static(productImageDirectory, { dotfiles: 'deny', index: false, maxAge: '1d' }))
app.use(express.json({ limit: '8mb' }))

type AuthRequest = Request & { user?: { id: number; email: string; role: string } }
type SqlRow = DbRow
const tokenFor = (user: { id: number; email: string; role: string }) => jwt.sign(user, jwtSecret, { expiresIn: '7d' })
const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ message: 'Login diperlukan' })
  try {
    req.user = jwt.verify(header.slice(7), jwtSecret) as AuthRequest['user']
    next()
  } catch {
    res.status(401).json({ message: 'Token tidak valid' })
  }
}
const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Akses admin diperlukan' })
  next()
}
const admin = [requireAuth, requireAdmin]
const adminEventClients = new Set<Response>()
function broadcastAdminEvent() {
  const message = `data: ${JSON.stringify({ type: 'refresh', at: Date.now() })}\n\n`
  for (const client of adminEventClients) {
    try {
      client.write(message)
    } catch {
      adminEventClients.delete(client)
    }
  }
}
const PAYMENT_METHODS = ['cod', 'bank_transfer'] as const
type PaymentMethod = (typeof PAYMENT_METHODS)[number]
const ORDER_STATUSES = ['pending', 'processing', 'packed', 'shipped', 'completed', 'cancelled']
const PAYMENT_STATUSES = ['unpaid', 'pending', 'paid', 'expired', 'failed', 'refunded']

function parseProductImage(imageData: unknown) {
  if (typeof imageData !== 'string') return null
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageData)
  if (!match) return null
  const image = Buffer.from(match[2], 'base64')
  if (image.length === 0 || image.length > 3 * 1024 * 1024) return null
  const isPng = match[1] === 'png' && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const isJpeg = match[1] === 'jpeg' && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff
  const isWebp = match[1] === 'webp' && image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP'
  if (!isPng && !isJpeg && !isWebp) return null
  return { image, extension: match[1] === 'jpeg' ? 'jpg' : match[1] }
}

async function ensureProductStorageBucket() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    if (process.env.VERCEL || supabaseUrl || supabaseServiceRoleKey) {
      throw new Error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY harus diatur bersama untuk unggah foto.')
    }
    return
  }
  if (!storageBucketReady) {
    storageBucketReady = (async () => {
      const baseUrl = supabaseUrl.replace(/\/$/, '')
      const headers = { Authorization: `Bearer ${supabaseServiceRoleKey}`, apikey: supabaseServiceRoleKey }
      const bucketUrl = `${baseUrl}/storage/v1/bucket/${encodeURIComponent(supabaseStorageBucket)}`
      const existing = await fetch(bucketUrl, { headers })
      if (existing.ok) {
        const bucket = await existing.json() as { public?: boolean }
        if (!bucket.public) throw new Error(`Bucket ${supabaseStorageBucket} harus diatur sebagai public agar foto produk dapat dilihat pelanggan.`)
        return
      }
      if (existing.status !== 404) {
        throw new Error(`Gagal memeriksa Supabase Storage bucket: ${await existing.text()}`)
      }
      const created = await fetch(`${baseUrl}/storage/v1/bucket`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: supabaseStorageBucket,
          name: supabaseStorageBucket,
          public: true,
          file_size_limit: 3 * 1024 * 1024,
          allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'],
        }),
      })
      if (!created.ok && created.status !== 409) {
        throw new Error(`Gagal membuat Supabase Storage bucket: ${await created.text()}`)
      }
    })().catch((error: unknown) => {
      storageBucketReady = null
      throw error
    })
  }
  await storageBucketReady
}

async function saveProductImage(image: Buffer, extension: string) {
  const filename = `${crypto.randomUUID()}.${extension}`
  if (process.env.VERCEL || supabaseUrl || supabaseServiceRoleKey) {
    await ensureProductStorageBucket()
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(supabaseStorageBucket)}/${filename}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        apikey: supabaseServiceRoleKey,
        'Content-Type': extension === 'jpg' ? 'image/jpeg' : `image/${extension}`,
        'x-upsert': 'true',
      },
      body: new Uint8Array(image),
    })
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Gagal mengunggah foto ke Supabase Storage: ${error}`)
    }
    return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${encodeURIComponent(supabaseStorageBucket)}/${filename}`
  }

  await mkdir(productImageDirectory, { recursive: true })
  await writeFile(join(productImageDirectory, filename), image, { flag: 'wx' })
  return `/uploads/products/${filename}`
}

function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const allowedHost =
      host === 'fcm.googleapis.com' ||
      host === 'web.push.apple.com' ||
      host === 'updates.push.services.mozilla.com' ||
      host.endsWith('.push.services.mozilla.com') ||
      (host.endsWith('.notify.windows.com') && host.startsWith('wns'))
    return url.protocol === 'https:' && url.port === '' && !url.username && !url.password && allowedHost
  } catch {
    return false
  }
}

async function sendNewOrderPush(orderId: number) {
  if (!pushNotificationsConfigured) return
  const [rows] = await pool.query('SELECT endpoint_hash, endpoint, p256dh, auth FROM push_subscriptions')
  const subscriptions = rows as { endpoint_hash: string; endpoint: string; p256dh: string; auth: string }[]
  const payload = JSON.stringify({
    title: 'Pesanan baru masuk',
    body: 'Ada pesanan baru yang perlu diperiksa di dashboard.',
    url: '/admin',
    orderId,
  })
  const results = await Promise.allSettled(
    subscriptions.map((subscription) =>
      webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payload,
      ),
    ),
  )
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') continue
    const subscription = subscriptions[index]
    const statusCode = (result.reason as { statusCode?: number })?.statusCode
    if (statusCode === 404 || statusCode === 410) {
      await pool.execute('DELETE FROM push_subscriptions WHERE endpoint_hash = ?', [subscription.endpoint_hash])
      continue
    }
    console.error('Gagal mengirim push notification pesanan:', result.reason)
  }
}

function shippingFeeFor(city: string) {
  return /jakarta/i.test(city) ? 0 : 25000
}

async function createMidtransSnap(payload: {
  paymentCode: string
  amount: number
  customerName: string
  phone: string
  finishUrl: string
  items: { id: string; name: string; price: number; quantity: number }[]
}) {
  const host = midtransProduction ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com'
  const response = await fetch(`${host}/snap/v1/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${midtransServerKey}:`).toString('base64')}`,
    },
    body: JSON.stringify({
      transaction_details: { order_id: payload.paymentCode, gross_amount: Math.round(payload.amount) },
      customer_details: { first_name: payload.customerName, phone: payload.phone },
      item_details: payload.items,
      callbacks: { finish: payload.finishUrl },
      enabled_payments: ['bca_va', 'bni_va', 'bri_va', 'permata_va', 'other_va'],
    }),
  })
  const data = (await response.json()) as { token?: string; redirect_url?: string; error_messages?: string[] }
  if (!response.ok || !data.token) {
    throw new Error(data.error_messages?.join(', ') || 'Midtrans gagal membuat transaksi')
  }
  return { token: data.token, redirectUrl: data.redirect_url || '' }
}

async function markPaid(connection: typeof pool | Awaited<ReturnType<typeof pool.getConnection>>, orderId: number, paymentCode: string) {
  await connection.execute('UPDATE payments SET status=?, paid_at=NOW() WHERE payment_code=?', ['paid', paymentCode])
  await connection.execute(
    "UPDATE orders SET payment_status=?, paid_at=NOW(), status=CASE WHEN status='pending' THEN 'processing' ELSE status END WHERE id=?",
    ['paid', orderId],
  )
}

function midtransStatusHost() {
  return midtransProduction ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com'
}

async function checkMidtransStatus(paymentCode: string) {
  if (!midtransServerKey) return null
  try {
    const response = await fetch(`${midtransStatusHost()}/v2/${encodeURIComponent(paymentCode)}/status`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${midtransServerKey}:`).toString('base64')}`,
      },
    })
    const data = (await response.json()) as {
      status_code?: string
      transaction_status?: string
      fraud_status?: string
    }
    if (!response.ok || data.status_code === '404' || !data.transaction_status) return null
    return { transactionStatus: data.transaction_status, fraudStatus: data.fraud_status || '' }
  } catch {
    return null
  }
}

function mapMidtransPaymentStatus(transactionStatus: string, fraudStatus: string) {
  if (transactionStatus === 'settlement' || (transactionStatus === 'capture' && fraudStatus !== 'challenge')) return 'paid'
  if (transactionStatus === 'expire') return 'expired'
  if (transactionStatus === 'deny' || transactionStatus === 'cancel') return 'failed'
  return null
}

async function syncMidtransPayments() {
  if (!midtransServerKey) return { checked: 0, updated: 0 }
  const [rows] = await pool.query(
    `SELECT p.payment_code, p.order_id FROM payments p
     WHERE p.channel = 'midtrans' AND p.status IN ('pending','unpaid')
     ORDER BY p.created_at DESC LIMIT 50`,
  )
  const pending = rows as { payment_code: string; order_id: number }[]
  let updated = 0
  await Promise.all(
    pending.map(async (row) => {
      const result = await checkMidtransStatus(String(row.payment_code))
      if (!result) return
      const mapped = mapMidtransPaymentStatus(result.transactionStatus, result.fraudStatus)
      if (!mapped) return
      if (mapped === 'paid') {
        await markPaid(pool, Number(row.order_id), String(row.payment_code))
      } else {
        await pool.execute('UPDATE payments SET status=? WHERE payment_code=?', [mapped, row.payment_code])
        await pool.execute('UPDATE orders SET payment_status=? WHERE id=?', [mapped, row.order_id])
      }
      updated += 1
    }),
  )
  if (updated > 0) broadcastAdminEvent()
  return { checked: pending.length, updated }
}

let lastMidtransSyncAt = 0
async function syncMidtransPaymentsThrottled(force = false) {
  const now = Date.now()
  if (!force && now - lastMidtransSyncAt < 10_000) return { checked: 0, updated: 0 }
  lastMidtransSyncAt = now
  try {
    return await syncMidtransPayments()
  } catch {
    return { checked: 0, updated: 0 }
  }
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', database: 'connected', payment: midtransServerKey ? 'midtrans' : 'unconfigured' })
  } catch {
    res.status(503).json({ status: 'error', database: 'disconnected' })
  }
})

app.get('/api/admin/events', (req, res) => {
  if (process.env.VERCEL) return res.status(204).end()
  const token = String(req.query.token || '')
  let role = ''
  try {
    role = String((jwt.verify(token, jwtSecret) as { role?: string }).role || '')
  } catch {
    role = ''
  }
  if (role !== 'admin') return res.status(403).json({ message: 'Akses admin diperlukan' })

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`)
  adminEventClients.add(res)

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      // Koneksi sudah tertutup.
    }
  }, 20_000)

  req.on('close', () => {
    clearInterval(heartbeat)
    adminEventClients.delete(res)
  })
})

app.get('/api/admin/push/config', ...admin, (_req, res) => {
  res.json({ enabled: pushNotificationsConfigured, publicKey: pushNotificationsConfigured ? vapidPublicKey : null })
})

app.post('/api/admin/push/subscriptions', ...admin, async (req: AuthRequest, res) => {
  if (!pushNotificationsConfigured) {
    return res.status(503).json({ message: 'Notifikasi belum dikonfigurasi. Admin server perlu mengatur kunci VAPID.' })
  }
  const { endpoint, keys } = req.body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  if (
    !isAllowedPushEndpoint(endpoint) ||
    typeof keys?.p256dh !== 'string' ||
    !/^[A-Za-z0-9_-]{20,200}$/.test(keys.p256dh) ||
    typeof keys.auth !== 'string' ||
    !/^[A-Za-z0-9_-]{16,100}$/.test(keys.auth)
  ) {
    return res.status(400).json({ message: 'Data langganan notifikasi tidak valid' })
  }
  const endpointHash = crypto.createHash('sha256').update(endpoint).digest('hex')
  try {
    await pool.execute(
      `INSERT INTO push_subscriptions (endpoint_hash, endpoint, p256dh, auth, user_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint_hash) DO UPDATE SET endpoint = EXCLUDED.endpoint, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_id = EXCLUDED.user_id`,
      [endpointHash, endpoint, keys.p256dh, keys.auth, req.user!.id],
    )
    res.status(201).json({ message: 'Notifikasi pesanan diaktifkan' })
  } catch (error) {
    console.error('Gagal menyimpan langganan push notification:', error)
    res.status(500).json({ message: 'Gagal mengaktifkan notifikasi' })
  }
})

app.delete('/api/admin/push/subscriptions', ...admin, async (req: AuthRequest, res) => {
  const endpoint = req.body?.endpoint
  if (typeof endpoint !== 'string' || endpoint.length > 2048) {
    return res.status(400).json({ message: 'Alamat langganan notifikasi tidak valid' })
  }
  const endpointHash = crypto.createHash('sha256').update(endpoint).digest('hex')
  try {
    await pool.execute('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?', [endpointHash, req.user!.id])
    res.json({ message: 'Notifikasi pesanan dinonaktifkan' })
  } catch (error) {
    console.error('Gagal menghapus langganan push notification:', error)
    res.status(500).json({ message: 'Gagal menonaktifkan notifikasi' })
  }
})

app.get('/api/geo/search', async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 3) return res.status(400).json({ message: 'Ketik minimal 3 huruf' })
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=id&q=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': 'JelitaFlower/1.0 (local florist checkout)' } },
    )
    res.json(await response.json())
  } catch {
    res.status(502).json({ message: 'Gagal mencari alamat' })
  }
})

app.get('/api/geo/reverse', async (req, res) => {
  const lat = Number(req.query.lat)
  const lon = Number(req.query.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ message: 'Koordinat tidak valid' })
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`,
      { headers: { 'User-Agent': 'JelitaFlower/1.0 (local florist checkout)' } },
    )
    res.json(await response.json())
  } catch {
    res.status(502).json({ message: 'Gagal membaca alamat' })
  }
})

app.get('/api/config', (_req, res) => {
  res.json({
    paymentProvider: midtransServerKey ? 'midtrans' : 'unconfigured',
    midtransClientKey: midtransClientKey || null,
    midtransProduction,
  })
})

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body
  if (!name || !email || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ message: 'Nama, email, dan password minimal 6 karakter wajib diisi' })
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12)
    const [rows] = await pool.execute('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?) RETURNING id', [
      name.trim(),
      email.toLowerCase().trim(),
      passwordHash,
    ])
    const user = { id: Number(rows[0].id), email: email.toLowerCase().trim(), role: 'customer' }
    broadcastAdminEvent()
    res.status(201).json({ token: tokenFor(user), user: { ...user, name: name.trim() } })
  } catch (error) {
    const duplicate = (error as { code?: string }).code === '23505'
    res.status(duplicate ? 409 : 500).json({ message: duplicate ? 'Email sudah terdaftar' : 'Registrasi gagal' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ message: 'Email dan password wajib diisi' })
  try {
    const [rows] = await pool.execute('SELECT id, name, email, password_hash, role FROM users WHERE email = ?', [
      email.toLowerCase().trim(),
    ])
    const user = (rows as { id: number; name: string; email: string; password_hash: string; role: string }[])[0]
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: 'Email atau password salah' })
    }
    res.json({
      token: tokenFor({ id: user.id, email: user.email, role: user.role }),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    })
  } catch {
    res.status(500).json({ message: 'Login gagal' })
  }
})

app.get('/api/products', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, category, price, stock, description, emoji, color, image_url FROM products WHERE active = 1 ORDER BY created_at DESC',
    )
    res.json(rows)
  } catch {
    res.status(500).json({ message: 'Gagal mengambil produk' })
  }
})

app.post('/api/orders', requireAuth, async (req: AuthRequest, res) => {
  const {
    customerName,
    recipientName,
    phone,
    address,
    city,
    postalCode,
    notes,
    latitude,
    longitude,
    paymentMethod,
    items,
  } = req.body
  const method = String(paymentMethod || '') as PaymentMethod
  if (!customerName || !phone || !address || !city || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Data pesanan belum lengkap' })
  }
  if (!PAYMENT_METHODS.includes(method)) return res.status(400).json({ message: 'Metode pembayaran tidak valid' })
  const lat = Number(latitude)
  const lng = Number(longitude)
  const hasLatitude = latitude !== null && latitude !== undefined && latitude !== ''
  const hasLongitude = longitude !== null && longitude !== undefined && longitude !== ''
  if (hasLatitude !== hasLongitude || (hasLatitude && (!Number.isFinite(lat) || !Number.isFinite(lng)))) {
    return res.status(400).json({ message: 'Koordinat lokasi tidak valid' })
  }
  if (method === 'bank_transfer' && !midtransServerKey) {
    return res.status(503).json({ message: 'Pembayaran transfer belum dikonfigurasi. Isi MIDTRANS_SERVER_KEY di konfigurasi server.' })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [createdOrders] = await connection.execute(
      `INSERT INTO orders
        (customer_name, recipient_name, phone, address, city, postal_code, notes, latitude, longitude, total, status, payment_method, payment_status, shipping_fee, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        customerName,
        recipientName || customerName,
        phone,
        address,
        city,
        postalCode || '',
        notes || '',
        lat,
        lng,
        0,
        'pending',
        method,
        method === 'cod' ? 'unpaid' : 'pending',
        shippingFeeFor(city),
        req.user?.id || null,
      ],
    )
    const orderId = Number(createdOrders[0].id)
    let subtotal = 0
    const snapItems: { id: string; name: string; price: number; quantity: number }[] = []
    for (const item of items) {
      const [rows] = await connection.query('SELECT id, name, price, stock FROM products WHERE id = ? AND active = 1 FOR UPDATE', [
        item.productId,
      ])
      const product = (rows as { id: number; name: string; price: number; stock: number }[])[0]
      const quantity = Number(item.quantity)
      if (!product || !Number.isInteger(quantity) || quantity < 1 || product.stock < quantity) {
        throw new Error('Produk tidak tersedia')
      }
      subtotal += Number(product.price) * quantity
      snapItems.push({ id: String(product.id), name: product.name, price: Math.round(Number(product.price)), quantity })
      await connection.execute('INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)', [
        orderId,
        item.productId,
        quantity,
        product.price,
      ])
      await connection.execute('UPDATE products SET stock = stock - ? WHERE id = ?', [quantity, item.productId])
    }
    const shippingFee = shippingFeeFor(city)
    const total = subtotal + shippingFee
    if (shippingFee) snapItems.push({ id: 'SHIPPING', name: 'Ongkir', price: shippingFee, quantity: 1 })
    const paymentCode = `JF-${orderId}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    const appBaseUrl = (process.env.APP_URL || req.get('origin') || 'http://localhost:5173').replace(/\/$/, '')
    const finishUrl = `${appBaseUrl}/pesanan?payment=${encodeURIComponent(paymentCode)}`
    let snap: { token: string; redirectUrl: string } | null = null
    let paymentChannel = 'cod'
    if (method === 'bank_transfer') {
      try {
        snap = await createMidtransSnap({
          paymentCode,
          amount: total,
          customerName,
          phone,
          finishUrl,
          items: snapItems,
        })
        paymentChannel = 'midtrans'
      } catch (error) {
        await connection.rollback()
        return res.status(502).json({ message: error instanceof Error ? error.message : 'Payment gateway gagal' })
      }
    }
    const paymentStatus = method === 'cod' ? 'unpaid' : 'pending'
    await connection.execute('UPDATE orders SET total = ?, payment_code = ? WHERE id = ?', [total, paymentCode, orderId])
    await connection.execute(
      `INSERT INTO payments (order_id, payment_code, method, channel, amount, status, va_number, snap_token, snap_redirect, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NOW() + INTERVAL '60 minutes')`,
      [
        orderId,
        paymentCode,
        method,
        paymentChannel,
        total,
        paymentStatus,
        snap?.token || null,
        snap?.redirectUrl || null,
      ],
    )
    await connection.commit()
    broadcastAdminEvent()
    try {
      await sendNewOrderPush(Number(orderId))
    } catch (error) {
      console.error('Tidak dapat menyiapkan push notification pesanan baru:', error)
    }
    const [paymentRows] = await pool.query('SELECT * FROM payments WHERE payment_code = ?', [paymentCode])
    res.status(201).json({
      id: orderId,
      total,
      subtotal,
      shippingFee,
      paymentCode,
      payment: (paymentRows as SqlRow[])[0],
      provider: paymentChannel,
    })
  } catch {
    await connection.rollback()
    res.status(500).json({ message: 'Pesanan gagal dibuat' })
  } finally {
    connection.release()
  }
})

app.get('/api/my/orders', requireAuth, async (req: AuthRequest, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, customer_name, recipient_name, phone, address, city, postal_code, notes,
              total, shipping_fee, status, payment_method, payment_status, payment_code, paid_at, created_at
       FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
      [req.user!.id],
    )
    res.json(rows)
  } catch {
    res.status(500).json({ message: 'Gagal mengambil daftar pesanan' })
  }
})

app.get('/api/my/orders/:code', requireAuth, async (req: AuthRequest, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, customer_name, recipient_name, phone, address, city, postal_code, notes,
              total, shipping_fee, status, payment_method, payment_status, payment_code, paid_at, created_at
       FROM orders WHERE payment_code = ? AND user_id = ?`,
      [req.params.code, req.user!.id],
    )
    const order = (rows as SqlRow[])[0]
    if (!order) return res.status(404).json({ message: 'Pesanan tidak ditemukan' })
    const [items] = await pool.execute(
      `SELECT oi.quantity, oi.price, p.name, p.emoji, p.image_url
       FROM order_items oi JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?`,
      [order.id],
    )
    res.json({ ...order, items })
  } catch {
    res.status(500).json({ message: 'Gagal mengambil detail pesanan' })
  }
})

app.get('/api/payments/:code', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, o.customer_name, o.recipient_name, o.phone, o.address, o.city, o.postal_code, o.notes,
              o.latitude, o.longitude, o.status AS order_status, o.payment_status, o.total, o.shipping_fee
       FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.payment_code = ?`,
      [req.params.code],
    )
    const payment = (rows as SqlRow[])[0]
    if (!payment) return res.status(404).json({ message: 'Transaksi tidak ditemukan' })
    const [items] = await pool.query(
      `SELECT oi.quantity, oi.price, pr.name, pr.emoji, pr.image_url FROM order_items oi JOIN products pr ON pr.id = oi.product_id WHERE oi.order_id = ?`,
      [payment.order_id],
    )
    res.json({ ...payment, items })
  } catch {
    res.status(500).json({ message: 'Gagal mengambil transaksi' })
  }
})

app.post('/api/payments/midtrans/notification', async (req, res) => {
  const orderId = String(req.body.order_id || '')
  const status = String(req.body.transaction_status || '')
  const fraud = String(req.body.fraud_status || '')
  const statusCode = String(req.body.status_code || '')
  const grossAmount = String(req.body.gross_amount || '')
  const signature = String(req.body.signature_key || '')
  const expectedSignature = crypto.createHash('sha512').update(orderId + statusCode + grossAmount + midtransServerKey).digest('hex')
  if (!midtransServerKey || !signature || signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return res.status(401).json({ message: 'Signature notifikasi Midtrans tidak valid' })
  }
  try {
    const [rows] = await pool.query('SELECT order_id, payment_code, status FROM payments WHERE payment_code = ?', [orderId])
    const payment = (rows as SqlRow[])[0]
    if (!payment) return res.status(404).json({ message: 'Order tidak ditemukan' })
    const paid = status === 'settlement' || (status === 'capture' && fraud !== 'challenge')
    if (paid && payment.status !== 'paid') await markPaid(pool, Number(payment.order_id), String(payment.payment_code))
    if (['expire', 'deny', 'cancel'].includes(status)) {
      await pool.execute('UPDATE payments SET status=? WHERE payment_code=?', [status === 'expire' ? 'expired' : 'failed', orderId])
      await pool.execute('UPDATE orders SET payment_status=? WHERE payment_code=?', [status === 'expire' ? 'expired' : 'failed', orderId])
    }
    broadcastAdminEvent()
    res.json({ received: true })
  } catch {
    res.status(500).json({ message: 'Notifikasi gagal diproses' })
  }
})

app.get('/api/admin/stats', ...admin, async (_req, res) => {
  try {
    await syncMidtransPaymentsThrottled()
    const [[sales]] = await pool.query(
      'SELECT COALESCE(SUM(total),0) AS total FROM orders WHERE DATE(created_at)=CURDATE() AND payment_status = "paid"',
    )
    const [[monthSales]] = await pool.query(
      "SELECT COALESCE(SUM(total),0) AS total FROM orders WHERE date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE) AND payment_status='paid'",
    )
    const [[orders]] = await pool.query(
      'SELECT COUNT(*) AS total FROM orders WHERE status IN ("pending","processing","packed","shipped") AND payment_status NOT IN ("failed","refunded","expired")',
    )
    const [[unpaid]] = await pool.query('SELECT COUNT(*) AS total FROM orders WHERE payment_status IN ("pending","unpaid")')
    const [[products]] = await pool.query('SELECT COUNT(*) AS total FROM products WHERE active=1')
    const [[lowStock]] = await pool.query('SELECT COUNT(*) AS total FROM products WHERE active=1 AND stock <= 5')
    const [[customers]] = await pool.query('SELECT COUNT(*) AS total FROM users WHERE role="customer"')
    const [[avgOrder]] = await pool.query(
      'SELECT COALESCE(AVG(total),0) AS total FROM orders WHERE payment_status="paid"',
    )
    res.json({
      sales: (sales as SqlRow).total,
      monthSales: (monthSales as SqlRow).total,
      orders: (orders as SqlRow).total,
      unpaid: (unpaid as SqlRow).total,
      products: (products as SqlRow).total,
      lowStock: (lowStock as SqlRow).total,
      customers: (customers as SqlRow).total,
      avgOrder: (avgOrder as SqlRow).total,
    })
  } catch {
    res.status(500).json({ message: 'Gagal mengambil statistik' })
  }
})

app.get('/api/admin/analytics', ...admin, async (_req, res) => {
  try {
    const [daily] = await pool.query(
      `SELECT DATE(created_at) AS day, COALESCE(SUM(CASE WHEN payment_status="paid" THEN total ELSE 0 END),0) AS revenue, COUNT(*) AS orders
       FROM orders WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
       GROUP BY DATE(created_at) ORDER BY day`,
    )
    const [methods] = await pool.query(
      `SELECT COALESCE(payment_method,"unknown") AS method, COUNT(*) AS total, COALESCE(SUM(total),0) AS revenue
       FROM orders WHERE payment_status="paid" GROUP BY payment_method`,
    )
    const [statuses] = await pool.query('SELECT status, COUNT(*) AS total FROM orders GROUP BY status')
    res.json({ daily, methods, statuses })
  } catch {
    res.status(500).json({ message: 'Gagal mengambil analitik' })
  }
})

app.get('/api/admin/orders', ...admin, async (req, res) => {
  try {
    await syncMidtransPaymentsThrottled()
    const status = String(req.query.status || '')
    const payment = String(req.query.payment || '')
    const search = String(req.query.q || '').trim()
    const where: string[] = ['1=1']
    const params: Array<string | number> = []
    if (ORDER_STATUSES.includes(status)) {
      where.push('status = ?')
      params.push(status)
    }
    if (PAYMENT_STATUSES.includes(payment)) {
      where.push('payment_status = ?')
      params.push(payment)
    }
    if (search) {
      where.push('(customer_name ILIKE ? OR phone LIKE ? OR payment_code ILIKE ? OR address ILIKE ?)')
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
    }
    const [rows] = await pool.query(
      `SELECT id, customer_name, recipient_name, phone, address, city, postal_code, notes, latitude, longitude,
              total, shipping_fee, status, payment_method, payment_status, payment_code, paid_at, created_at
       FROM orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
      params,
    )
    res.json(rows)
  } catch {
    res.status(500).json({ message: 'Gagal mengambil pesanan' })
  }
})

app.get('/api/admin/orders/:id', ...admin, async (req, res) => {
  try {
    const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [req.params.id])
    const order = (orders as SqlRow[])[0]
    if (!order) return res.status(404).json({ message: 'Pesanan tidak ditemukan' })
    const [items] = await pool.query(
      `SELECT oi.id, oi.quantity, oi.price, pr.name, pr.emoji, pr.image_url, pr.category
       FROM order_items oi JOIN products pr ON pr.id = oi.product_id WHERE oi.order_id = ?`,
      [req.params.id],
    )
    const [payments] = await pool.query('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC', [req.params.id])
    res.json({ ...order, items, payments })
  } catch {
    res.status(500).json({ message: 'Gagal mengambil detail pesanan' })
  }
})

app.patch('/api/admin/orders/:id', ...admin, async (req, res) => {
  const { status, paymentStatus } = req.body
  if (status && !ORDER_STATUSES.includes(status)) return res.status(400).json({ message: 'Status tidak valid' })
  if (paymentStatus && !PAYMENT_STATUSES.includes(paymentStatus)) return res.status(400).json({ message: 'Status pembayaran tidak valid' })
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [req.params.id])
    const order = (rows as SqlRow[])[0]
    if (!order) {
      await connection.rollback()
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' })
    }
    if (status === 'cancelled' && order.status !== 'cancelled') {
      const [items] = await connection.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [req.params.id])
      for (const item of items as { product_id: number; quantity: number }[]) {
        await connection.execute('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id])
      }
    }
    if (status) await connection.execute('UPDATE orders SET status=? WHERE id=?', [status, req.params.id])
    if (paymentStatus) {
      await connection.execute('UPDATE orders SET payment_status=? WHERE id=?', [paymentStatus, req.params.id])
      if (paymentStatus === 'paid') {
        await connection.execute(
          'UPDATE payments SET status="paid", paid_at=NOW() WHERE order_id=? AND status != "paid"',
          [req.params.id],
        )
        await connection.execute('UPDATE orders SET paid_at=NOW() WHERE id=? AND paid_at IS NULL', [req.params.id])
      }
    }
    await connection.commit()
    broadcastAdminEvent()
    res.json({ message: 'Pesanan diperbarui' })
  } catch {
    await connection.rollback()
    res.status(500).json({ message: 'Gagal memperbarui pesanan' })
  } finally {
    connection.release()
  }
})

app.get('/api/admin/payments', ...admin, async (req, res) => {
  try {
    await syncMidtransPaymentsThrottled()
    const status = String(req.query.status || '')
    const where = PAYMENT_STATUSES.includes(status) ? 'WHERE p.status = ?' : ''
    const params = PAYMENT_STATUSES.includes(status) ? [status] : []
    const [rows] = await pool.query(
      `SELECT p.*, o.customer_name, o.phone, o.status AS order_status
       FROM payments p JOIN orders o ON o.id = p.order_id ${where}
       ORDER BY p.created_at DESC LIMIT 200`,
      params,
    )
    res.json(rows)
  } catch {
    res.status(500).json({ message: 'Gagal mengambil pembayaran' })
  }
})

app.post('/api/admin/payments/sync', ...admin, async (_req, res) => {
  try {
    res.json(await syncMidtransPaymentsThrottled(true))
  } catch {
    res.status(500).json({ message: 'Gagal menyinkronkan pembayaran Midtrans' })
  }
})

app.get('/api/admin/customers', ...admin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.created_at,
              COUNT(o.id) AS orders, COALESCE(SUM(CASE WHEN o.payment_status="paid" THEN o.total END),0) AS spent
       FROM users u
       LEFT JOIN orders o ON o.user_id = u.id
       WHERE u.role = "customer"
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
    )
    res.json({ registered: rows })
  } catch {
    res.status(500).json({ message: 'Gagal mengambil pelanggan' })
  }
})

app.get('/api/admin/products', ...admin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id,name,category,price,stock,description,emoji,color,image_url,active FROM products ORDER BY created_at DESC',
    )
    res.json(rows)
  } catch {
    res.status(500).json({ message: 'Gagal mengambil produk' })
  }
})

app.post('/api/admin/products', ...admin, async (req, res) => {
  const { name, category, price, stock, description, emoji, color, imageData } = req.body
  if (!name || !category || Number(price) < 0 || Number(stock) < 0) return res.status(400).json({ message: 'Data produk tidak valid' })
  const parsedImage = imageData ? parseProductImage(imageData) : null
  if (imageData && !parsedImage) return res.status(400).json({ message: 'Foto harus berupa JPEG, PNG, atau WebP dengan ukuran maksimal 5 MB' })
  try {
    const imageUrl = parsedImage ? await saveProductImage(parsedImage.image, parsedImage.extension) : null
    const [rows] = await pool.execute(
      'INSERT INTO products (name,category,price,stock,description,emoji,color,image_url) VALUES (?,?,?,?,?,?,?,?) RETURNING id',
      [name, category, price, stock, description || '', emoji || '💐', color || 'rose', imageUrl],
    )
    broadcastAdminEvent()
    res.status(201).json({ id: Number(rows[0].id) })
  } catch {
    res.status(500).json({ message: 'Gagal menambah produk' })
  }
})

app.patch('/api/admin/products/:id', ...admin, async (req, res) => {
  const { name, category, price, stock, description, active, emoji, color, imageData, removeImage } = req.body
  const parsedImage = imageData ? parseProductImage(imageData) : null
  if (imageData && !parsedImage) return res.status(400).json({ message: 'Foto harus berupa JPEG, PNG, atau WebP dengan ukuran maksimal 5 MB' })
  try {
    const imageUrl = parsedImage
      ? await saveProductImage(parsedImage.image, parsedImage.extension)
      : removeImage ? null : undefined
    await pool.execute(
      `UPDATE products SET name=?,category=?,price=?,stock=?,description=?,active=?,emoji=?,color=?${imageUrl === undefined ? '' : ',image_url=?'} WHERE id=?`,
      [
        name,
        category,
        price,
        stock,
        description || '',
        Boolean(active),
        emoji || '💐',
        color || 'rose',
        ...(imageUrl === undefined ? [] : [imageUrl]),
        req.params.id,
      ],
    )
    broadcastAdminEvent()
    res.json({ message: 'Produk diperbarui' })
  } catch {
    res.status(500).json({ message: 'Gagal memperbarui produk' })
  }
})

export { app }

if (!process.env.VERCEL) {
  void pool.query('SELECT 1')
    .then(() => app.listen(port, () => console.log(`Jelita Flower API terhubung ke Supabase di port ${port}`)))
    .catch((error: unknown) => {
      console.error('Gagal terhubung ke Supabase. Periksa DATABASE_URL pada file .env.', error)
      process.exitCode = 1
    })
}
