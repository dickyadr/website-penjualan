import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, money } from './api'
import { getProductImage } from './product-images'

type Section = 'dashboard' | 'orders' | 'payments' | 'products' | 'customers'
type Stats = {
  sales: number
  monthSales: number
  orders: number
  unpaid: number
  products: number
  lowStock: number
  customers: number
  avgOrder: number
}
type OrderRow = {
  id: number
  customer_name: string
  recipient_name: string
  phone: string
  address: string
  city: string
  postal_code: string
  notes: string
  latitude: number
  longitude: number
  total: number
  shipping_fee: number
  status: string
  payment_method: string
  payment_status: string
  payment_code: string
  paid_at: string | null
  created_at: string
  items?: { id: number; quantity: number; price: number; name: string; emoji: string; image_url: string | null; category: string }[]
  payments?: { id: number; method: string; channel: string; status: string; amount: number; va_number: string | null }[]
}
type ProductRow = {
  id: number
  name: string
  category: string
  price: number
  stock: number
  description: string
  emoji: string
  color: string
  image_url: string | null
  active: number
}
type PaymentRow = {
  id: number
  payment_code: string
  method: string
  channel: string
  amount: number
  status: string
  va_number: string | null
  created_at: string
  customer_name: string
  phone: string
  order_status: string
}
type CustomerPayload = {
  registered: { id: number; name: string; email: string; created_at: string; orders: number; spent: number }[]
}
type Analytics = {
  daily: { day: string; revenue: number; orders: number }[]
  methods: { method: string; total: number; revenue: number }[]
  statuses: { status: string; total: number }[]
}
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}
type PushConfig = { enabled: boolean; publicKey: string | null }

function decodeApplicationServerKey(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const decoded = window.atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding)
  const key = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) key[index] = decoded.charCodeAt(index)
  return key
}

function formatOrderDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Foto tidak dapat dibaca'))
    reader.onerror = () => reject(new Error('Foto tidak dapat dibaca'))
    reader.readAsDataURL(file)
  })
}

const orderStatuses = ['pending', 'processing', 'packed', 'shipped', 'completed', 'cancelled']
const paymentStatuses = ['unpaid', 'pending', 'paid', 'expired', 'failed', 'refunded']
const paymentStatusLabels: Record<string, string> = {
  unpaid: 'belum dibayar',
  pending: 'diproses',
  paid: 'dibayar',
  expired: 'selesai',
  refunded: 'cancel',
}
const paymentStatusText = (status: string) => paymentStatusLabels[status] || status

function AdminLogin() {
  const [message, setMessage] = useState('')
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage('Memproses...')
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const result = await api<{ token: string; user: { role: string } }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      })
      if (result.user.role !== 'admin') {
        setMessage('Akun ini bukan akun admin')
        return
      }
      localStorage.setItem('jelita_token', result.token)
      window.location.reload()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Login gagal')
    }
  }
  return (
    <div className="admin-login-page">
      <form className="checkout-modal admin-login-card" onSubmit={(event) => void submit(event)}>
        <a className="brand admin-login-brand" href="/"><span className="brand-mark">✽</span><span>jelita<span>flower</span></span></a>
        <p className="eyebrow">Area administrator</p>
        <h2>Masuk ke dashboard</h2>
        <label>Email admin<input required type="email" name="email" placeholder="admin@jelitaflower.com" /></label>
        <label>Password<input required type="password" name="password" placeholder="Masukkan password" /></label>
        {message && <p className="auth-message">{message}</p>}
        <button className="primary-button full-button">Masuk sebagai admin</button>
      </form>
    </div>
  )
}

export function AdminDashboard() {
  const token = localStorage.getItem('jelita_token')
  const [section, setSection] = useState<Section>('dashboard')
  const [navOpen, setNavOpen] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [selected, setSelected] = useState<OrderRow | null>(null)
  const [products, setProducts] = useState<ProductRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [customers, setCustomers] = useState<CustomerPayload | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [orderFilter, setOrderFilter] = useState({ q: '', status: '', payment: '' })
  const [editing, setEditing] = useState<ProductRow | null>(null)
  const [productQuery, setProductQuery] = useState('')
  const [showProductForm, setShowProductForm] = useState(false)
  const [imagePreview, setImagePreview] = useState('')
  const [removeProductImage, setRemoveProductImage] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(() => {
    const standaloneNavigator = window.navigator as Navigator & { standalone?: boolean }
    return window.matchMedia('(display-mode: standalone)').matches || standaloneNavigator.standalone === true
  })
  const [installInstructions, setInstallInstructions] = useState('')
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushConfig, setPushConfig] = useState<PushConfig | null>(null)
  const [pushStatus, setPushStatus] = useState('')
  const [pushBusy, setPushBusy] = useState(false)

  const load = useCallback(
    async () => {
      try {
        if (section === 'dashboard') {
          setStats(await api<Stats>('/api/admin/stats'))
          setAnalytics(await api<Analytics>('/api/admin/analytics'))
        }
        if (section === 'orders') {
          const params = new URLSearchParams()
          if (orderFilter.q) params.set('q', orderFilter.q)
          if (orderFilter.status) params.set('status', orderFilter.status)
          if (orderFilter.payment) params.set('payment', orderFilter.payment)
          setOrders(await api<OrderRow[]>(`/api/admin/orders?${params}`))
        }
        if (section === 'products') setProducts(await api<ProductRow[]>('/api/admin/products'))
        if (section === 'payments') setPayments(await api<PaymentRow[]>('/api/admin/payments'))
        if (section === 'customers') setCustomers(await api<CustomerPayload>('/api/admin/customers'))
      } catch (err) {
        if (String(err).includes('401') || String(err).includes('403') || String(err).includes('Login') || String(err).includes('admin')) {
          localStorage.removeItem('jelita_token')
          window.location.href = '/admin'
        }
        setMessage(err instanceof Error ? err.message : 'Gagal memuat data')
      } finally {
        setLoading(false)
      }
    },
    [orderFilter.payment, orderFilter.q, orderFilter.status, section],
  )

  useEffect(() => {
    if (token) void load()
  }, [load, token])

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  useEffect(() => {
    if (!token) return
    const source = new EventSource(`/api/admin/events?token=${encodeURIComponent(token)}`)
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string }
        if (payload.type && payload.type !== 'connected') void loadRef.current()
      } catch {
        // Abaikan pesan yang tidak valid.
      }
    }
    return () => source.close()
  }, [token])

  useEffect(() => {
    if (!token) return
    const timer = window.setInterval(() => void load(), 30000)
    return () => window.clearInterval(timer)
  }, [load, token])

  useEffect(() => {
    if (!token || !('serviceWorker' in navigator)) return
    let active = true
    const checkSubscription = async () => {
      try {
        const config = await api<PushConfig>('/api/admin/push/config')
        const registration = await navigator.serviceWorker.getRegistration()
        const subscription = registration ? await registration.pushManager.getSubscription() : null
        if (!active) return
        setPushConfig(config)
        setPushSubscribed(Boolean(subscription))
        if (!config.enabled) setPushStatus('Notifikasi pesanan perlu dikonfigurasi pada server hosting.')
      } catch (error) {
        if (active) {
          setPushConfig({ enabled: false, publicKey: null })
          setPushStatus(error instanceof Error ? error.message : 'Status notifikasi gagal diperiksa.')
        }
      }
    }
    void checkSubscription()
    return () => {
      active = false
    }
  }, [token])

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const handleAppInstalled = () => {
      setIsInstalled(true)
      setInstallPrompt(null)
      setInstallInstructions('')
    }

    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  useEffect(() => {
    if (!selected) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKey)
    }
  }, [selected])

  useEffect(() => {
    if (!navOpen) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false)
    }
    const handleResize = () => {
      if (window.innerWidth > 900) setNavOpen(false)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKey)
    window.addEventListener('resize', handleResize)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('resize', handleResize)
    }
  }, [navOpen])

  const maxRevenue = useMemo(
    () => Math.max(1, ...(analytics?.daily.map((row) => Number(row.revenue)) || [1])),
    [analytics],
  )
  const filteredProducts = useMemo(() => {
    const query = productQuery.trim().toLocaleLowerCase('id-ID')
    return products.filter((product) => `${product.name} ${product.category}`.toLocaleLowerCase('id-ID').includes(query))
  }, [productQuery, products])

  if (!token) return <AdminLogin />

  const saveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    const imageFile = values.image instanceof File && values.image.size > 0 ? values.image : null
    try {
      const payload = {
        name: values.name,
        category: values.category,
        price: Number(values.price),
        stock: Number(values.stock),
        description: values.description,
        emoji: values.emoji || '💐',
        color: values.color || 'rose',
        active: values.active === '1',
        imageData: imageFile ? await readFileAsDataUrl(imageFile) : undefined,
        removeImage: removeProductImage,
      }
      if (editing) {
        await api(`/api/admin/products/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        setMessage('Produk diperbarui')
        setEditing(null)
        setShowProductForm(false)
        setImagePreview('')
        setRemoveProductImage(false)
      } else {
        await api('/api/admin/products', { method: 'POST', body: JSON.stringify(payload) })
        setMessage('Produk ditambahkan')
        form.reset()
        setShowProductForm(false)
        setImagePreview('')
        setRemoveProductImage(false)
      }
      void load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal menyimpan produk')
    }
  }

  const openOrder = async (id: number) => {
    const detail = await api<OrderRow>(`/api/admin/orders/${id}`)
    setSelected(detail)
  }

  const installAdminApp = async () => {
    if (!installPrompt) {
      const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      setInstallInstructions(
        isAppleMobile
          ? 'Di Safari, tekan Bagikan lalu pilih Tambahkan ke Layar Utama.'
          : 'Buka menu browser (⋮ atau Bagikan), lalu pilih Instal aplikasi atau Tambahkan ke layar utama.',
      )
      return
    }

    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      if (choice.outcome === 'accepted') {
        setInstallPrompt(null)
        setInstallInstructions('')
      }
    } catch (err) {
      setInstallInstructions(err instanceof Error ? `Pemasangan gagal: ${err.message}` : 'Pemasangan aplikasi gagal.')
    }
  }

  const toggleOrderNotifications = async () => {
    if (pushBusy) return
    setPushBusy(true)
    setPushStatus('')
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        throw new Error('Browser ini belum mendukung push notification.')
      }
      if (!window.isSecureContext) {
        throw new Error('Notifikasi memerlukan HTTPS atau localhost.')
      }

      if (pushSubscribed) {
        const registration = await navigator.serviceWorker.register('/sw.js')
        const subscription = await registration.pushManager.getSubscription()
        if (subscription) {
          await api('/api/admin/push/subscriptions', {
            method: 'DELETE',
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          })
          await subscription.unsubscribe()
        }
        setPushSubscribed(false)
        setPushStatus('Notifikasi pesanan dinonaktifkan di perangkat ini.')
        return
      }

      if (!pushConfig?.enabled || !pushConfig.publicKey) {
        throw new Error('Kunci VAPID belum diatur pada server hosting. Notifikasi belum dapat diaktifkan.')
      }
      const permissionRequest = Notification.requestPermission()
      const permission = await permissionRequest
      if (permission !== 'granted') {
        throw new Error('Izin notifikasi belum diberikan. Periksa pengaturan browser perangkat.')
      }
      await navigator.serviceWorker.register('/sw.js')
      const readyRegistration = await navigator.serviceWorker.ready
      const subscription = await readyRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(pushConfig.publicKey),
      })
      await api('/api/admin/push/subscriptions', {
        method: 'POST',
        body: JSON.stringify(subscription.toJSON()),
      })
      setPushSubscribed(true)
      setPushStatus('Notifikasi pesanan aktif di perangkat ini.')
    } catch (error) {
      setPushStatus(error instanceof Error ? error.message : 'Notifikasi pesanan gagal diaktifkan.')
    } finally {
      setPushBusy(false)
    }
  }

  const updateOrder = async (id: number, body: object) => {
    await api(`/api/admin/orders/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
    await load()
    if (selected?.id === id) await openOrder(id)
  }

  return (
    <div className="admin-shell">
      <header className="admin-mobile-bar">
        <a className="brand" href="/"><span className="brand-mark">✽</span><span>jelita<span>flower</span></span></a>
        <div className="admin-mobile-actions">
          <button
            type="button"
            className={`admin-mobile-toggle ${navOpen ? 'is-open' : ''}`}
            onClick={() => setNavOpen((open) => !open)}
            aria-label={navOpen ? 'Tutup menu' : 'Buka menu'}
            aria-expanded={navOpen}
            aria-controls="admin-nav"
          >
            <span /><span /><span />
          </button>
        </div>
      </header>
      {navOpen && <div className="admin-nav-backdrop" onClick={() => setNavOpen(false)} />}
      <aside id="admin-nav" className={`admin-sidebar ${navOpen ? 'mobile-open' : ''}`}>
        <button className="admin-sidebar-close" type="button" aria-label="Tutup menu" onClick={() => setNavOpen(false)}>×</button>
        <div className="admin-sidebar-top">
          <a className="brand" href="/"><span className="brand-mark">✽</span><span>jelita<span>flower</span></span></a>
          <div className="admin-workspace-card">
            <span className="admin-workspace-mark">JF</span>
            <span className="admin-workspace-copy"><strong>Jelita Flower</strong><small>Panel administrator</small></span>
            <i className="admin-workspace-status" aria-label="Status online" />
          </div>
          <p className="admin-workspace-label">WORKSPACE</p>
        </div>
        <nav aria-label="Navigasi administrasi">
          <span className="admin-nav-label">MENU UTAMA</span>
          <button aria-current={section === 'dashboard' ? 'page' : undefined} className={section === 'dashboard' ? 'selected' : ''} onClick={() => { setSection('dashboard'); setNavOpen(false) }}><span className="admin-nav-icon">▦</span>Dashboard</button>
          <button aria-current={section === 'orders' ? 'page' : undefined} className={section === 'orders' ? 'selected' : ''} onClick={() => { setSection('orders'); setNavOpen(false) }}><span className="admin-nav-icon">▤</span>Pesanan</button>
          <button aria-current={section === 'payments' ? 'page' : undefined} className={section === 'payments' ? 'selected' : ''} onClick={() => { setSection('payments'); setNavOpen(false) }}><span className="admin-nav-icon">↗</span>Pembayaran</button>
          <button aria-current={section === 'products' ? 'page' : undefined} className={section === 'products' ? 'selected' : ''} onClick={() => { setSection('products'); setNavOpen(false) }}><span className="admin-nav-icon">▣</span>Produk</button>
          <button aria-current={section === 'customers' ? 'page' : undefined} className={section === 'customers' ? 'selected' : ''} onClick={() => { setSection('customers'); setNavOpen(false) }}><span className="admin-nav-icon">♙</span>Pelanggan</button>
        </nav>
        <div className="admin-sidebar-bottom">
          <button className="logout" onClick={() => { localStorage.removeItem('jelita_token'); window.location.href = '/' }}><span>↪</span>Keluar</button>
        </div>
      </aside>
      <main className="admin-main">
        <div className="admin-header">
          <div>
            <p className="eyebrow">Panel administrasi</p>
            <h1>
              {section === 'dashboard' && 'Ringkasan toko'}
              {section === 'orders' && 'Manajemen pesanan'}
              {section === 'payments' && 'Payment gateway'}
              {section === 'products' && 'Inventaris bunga'}
              {section === 'customers' && 'Pelanggan'}
            </h1>
            <p className="admin-header-subtitle">Kelola aktivitas Jelita Flower dari satu tempat.</p>
          </div>
          <div className="admin-pwa-actions">
            {!isInstalled && (
              <button className="admin-pwa-install" type="button" onClick={() => void installAdminApp()}>
                <span aria-hidden="true">↓</span> Pasang aplikasi
              </button>
            )}
            <button className="admin-push-toggle" type="button" onClick={() => void toggleOrderNotifications()} disabled={pushBusy || !pushConfig}>
              <span aria-hidden="true">{pushSubscribed ? '✓' : '♧'}</span>
              {pushBusy ? 'Memproses...' : !pushConfig ? 'Memeriksa...' : pushSubscribed ? 'Matikan notifikasi' : 'Aktifkan notifikasi'}
            </button>
            {(installInstructions || pushStatus) && (
              <p className="admin-pwa-help" role="status">{[installInstructions, pushStatus].filter(Boolean).join(' ')}</p>
            )}
          </div>
        </div>
        {message && <p className="auth-message admin-notice" role="status">{message}</p>}

        {loading ? (
          <div className="admin-loading" role="status"><span className="admin-spinner" />Memuat data toko...</div>
        ) : <div className="admin-content" key={section}>
        {section === 'dashboard' && stats && (
          <>
            <div className="stats-grid six">
              <div><span>Penjualan hari ini</span><strong>{money(Number(stats.sales))}</strong><small>Sudah dibayar</small></div>
              <div><span>Penjualan bulan ini</span><strong>{money(Number(stats.monthSales))}</strong><small>Akumulasi lunas</small></div>
              <div><span>Pesanan aktif</span><strong>{stats.orders}</strong><small>Belum selesai</small></div>
              <div><span>Menunggu bayar</span><strong>{stats.unpaid}</strong><small>Perlu follow-up</small></div>
              <div><span>Stok menipis</span><strong>{stats.lowStock}</strong><small>Dari {stats.products} produk</small></div>
              <div><span>Rata-rata order</span><strong>{money(Number(stats.avgOrder))}</strong><small>{stats.customers} pelanggan</small></div>
            </div>
            <div className="admin-split">
              <section className="admin-card">
                <div className="admin-card-title"><div><p className="eyebrow">7 hari terakhir</p><h2>Pendapatan</h2></div></div>
                <div className="bar-chart">
                  {(analytics?.daily || []).map((row) => (
                    <div key={String(row.day)}>
                      <div className="bar" style={{ height: `${Math.max(8, (Number(row.revenue) / maxRevenue) * 120)}px` }} />
                      <small>{String(row.day).slice(5, 10)}</small>
                    </div>
                  ))}
                </div>
              </section>
              <section className="admin-card">
                <div className="admin-card-title"><div><p className="eyebrow">Metode</p><h2>Pembayaran lunas</h2></div></div>
                <ul className="method-list">
                  {(analytics?.methods || []).map((row) => (
                    <li key={row.method}><span>{row.method}</span><strong>{money(Number(row.revenue))}</strong><small>{row.total} transaksi</small></li>
                  ))}
                  {!analytics?.methods.length && <li>Belum ada pembayaran lunas.</li>}
                </ul>
              </section>
            </div>
          </>
        )}

        {section === 'orders' && (
          <section className="admin-card">
            <div className="filter-row">
              <input placeholder="Cari nama, telepon, kode bayar..." value={orderFilter.q} onChange={(event) => setOrderFilter({ ...orderFilter, q: event.target.value })} />
              <select value={orderFilter.status} onChange={(event) => setOrderFilter({ ...orderFilter, status: event.target.value })}>
                <option value="">Semua status kirim</option>
                {orderStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              <select value={orderFilter.payment} onChange={(event) => setOrderFilter({ ...orderFilter, payment: event.target.value })}>
                <option value="">Semua pembayaran</option>
                {paymentStatuses.map((status) => <option key={status} value={status}>{paymentStatusText(status)}</option>)}
              </select>
              <button className="primary-button" type="button" onClick={() => void load()}>Terapkan</button>
            </div>
            <div className="admin-table-wrap">
              <table className="orders-table">
                <thead>
                  <tr>
                    <th>Kode Pesanan</th>
                    <th>Penerima</th>
                    <th>Kota</th>
                    <th className="num">Total</th>
                    <th>Pembayaran</th>
                    <th>Pengiriman</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 ? (
                    <tr className="orders-empty-row">
                      <td colSpan={6}>Tidak ada pesanan yang cocok dengan filter.</td>
                    </tr>
                  ) : orders.map((order) => (
                    <tr key={order.id} className={selected?.id === order.id ? 'active-row' : ''} onClick={() => void openOrder(order.id)}>
                      <td>
                        <span className="order-code">{order.payment_code || `#JF-${order.id}`}</span>
                        <small className="order-date">{formatOrderDate(order.created_at)}</small>
                      </td>
                      <td>
                        <span className="order-recipient">{order.recipient_name || order.customer_name}</span>
                        <small className="order-phone">{order.phone}</small>
                      </td>
                      <td>{order.city || '-'}</td>
                      <td className="num"><strong className="order-total">{money(Number(order.total))}</strong></td>
                      <td><span className={`status ${order.payment_status}`}>{paymentStatusText(order.payment_status)}</span></td>
                      <td><span className={`status ${order.status}`}>{order.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {section === 'orders' && selected && (
          <div className="admin-modal-backdrop" onClick={() => setSelected(null)}>
            <aside
              className="admin-order-modal"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Detail pesanan"
            >
              <header className="admin-order-modal-head">
                <div>
                  <p className="eyebrow">Detail pesanan</p>
                  <h3>{selected.payment_code || `#JF-${selected.id}`}</h3>
                </div>
                <button className="order-detail-close" type="button" aria-label="Tutup detail pesanan" onClick={() => setSelected(null)}>×</button>
              </header>

              <div className="admin-order-modal-body">
                <div className="admin-order-meta">
                  <span className={`status ${selected.payment_status}`}>{paymentStatusText(selected.payment_status)}</span>
                  <span className={`status ${selected.status}`}>{selected.status}</span>
                </div>

                <div className="admin-order-block">
                  <span className="detail-label">Penerima</span>
                  <p>{selected.recipient_name} · {selected.phone}</p>
                </div>

                <div className="admin-order-block">
                  <span className="detail-label">Alamat Pengiriman</span>
                  <p className="order-detail-address">{selected.address}, {selected.city} {selected.postal_code}</p>
                </div>

                {selected.notes && (
                  <div className="admin-order-block">
                    <span className="detail-label">Catatan</span>
                    <p>{selected.notes}</p>
                  </div>
                )}

                <div className="admin-order-block">
                  <span className="detail-label">Rincian Bunga</span>
                  <ul className="admin-order-items">
                    {(selected.items || []).map((item) => (
                      <li key={item.id}>
                        <span className="admin-order-item">
                          <img src={getProductImage(item)} alt={item.name} />
                          {item.name} × {item.quantity}
                        </span>
                        <strong>{money(Number(item.price) * item.quantity)}</strong>
                      </li>
                    ))}
                  </ul>
                  <div className="admin-order-total">
                    <span>Total Pesanan</span>
                    <strong>{money(Number(selected.total))}</strong>
                  </div>
                </div>

                <div className="admin-order-controls">
                  <label>
                    Status pengiriman
                    <select value={selected.status} onChange={(event) => void updateOrder(selected.id, { status: event.target.value })}>
                      {orderStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </label>
                  <label>
                    Status pembayaran
                    <select value={selected.payment_status} onChange={(event) => void updateOrder(selected.id, { paymentStatus: event.target.value })}>
                      {paymentStatuses.map((status) => <option key={status} value={status}>{paymentStatusText(status)}</option>)}
                    </select>
                  </label>
                </div>
              </div>

              <footer className="admin-order-modal-foot">
                <button className="order-detail-ok" type="button" onClick={() => setSelected(null)}>Selesai</button>
              </footer>
            </aside>
          </div>
        )}

        {section === 'payments' && (
          <section className="admin-card">
            <p className="admin-sync-note">Status transfer bank Midtrans diverifikasi otomatis setiap 15 detik.</p>
            <div className="admin-table-scroll">
              <table>
                <thead><tr><th>Kode</th><th>Pelanggan</th><th>Metode</th><th>Channel</th><th>Nominal</th><th>Status</th><th>VA / QR</th></tr></thead>
                <tbody>
                  {payments.map((row) => (
                    <tr key={row.id}>
                      <td>{row.payment_code}</td>
                      <td>{row.customer_name}<br /><small>{row.phone}</small></td>
                      <td>{row.method}</td>
                      <td>{row.channel}</td>
                      <td>{money(Number(row.amount))}</td>
                      <td><span className={`status ${row.status}`}>{paymentStatusText(row.status)}</span></td>
                      <td>{row.va_number || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {section === 'products' && (
          <section className="admin-card admin-products-card">
            <div className="admin-products-toolbar">
              <div>
                <p className="eyebrow">Katalog toko</p>
                <h2>Daftar produk <span>{products.length}</span></h2>
                <p className="admin-products-caption">Atur koleksi, harga, dan ketersediaan produk toko.</p>
              </div>
              <div className="admin-products-actions">
                <label className="admin-product-search">
                  <span aria-hidden="true">⌕</span>
                  <input aria-label="Cari produk admin" placeholder="Cari produk..." value={productQuery} onChange={(event) => setProductQuery(event.target.value)} />
                </label>
                <button className="primary-button" type="button" onClick={() => { setEditing(null); setImagePreview(''); setRemoveProductImage(false); setShowProductForm(true) }}>+ Tambah produk</button>
              </div>
            </div>
            <div className="admin-products-table-wrap">
              <table className="admin-products-table">
                <thead><tr><th>Produk</th><th>Kategori</th><th>Harga</th><th>Stok tersedia</th><th>Status</th><th>Aksi</th></tr></thead>
                <tbody>
                  {filteredProducts.map((product) => (
                    <tr key={product.id}>
                      <td><div className="admin-product-name"><span className={`admin-product-avatar ${product.color || 'rose'}`}><img src={getProductImage(product)} alt={product.name} /></span><span><strong>{product.name}</strong><small>{product.description || 'Rangkaian bunga pilihan'}</small></span></div></td>
                      <td><span className="admin-category-tag">{product.category}</span></td>
                      <td className="admin-product-price">{money(Number(product.price))}</td>
                      <td><span className={`admin-stock-count ${product.stock <= 5 ? 'low' : ''}`}><i />{product.stock} pcs</span></td>
                      <td><span className={`status ${product.active ? 'paid' : 'cancelled'}`}>{product.active ? 'Aktif' : 'Nonaktif'}</span></td>
                      <td><button className="admin-edit-button" type="button" aria-label={`Edit ${product.name}`} onClick={() => { setEditing(product); setImagePreview(product.image_url || ''); setRemoveProductImage(false); setShowProductForm(true) }}><span aria-hidden="true">✎</span>Edit</button></td>
                    </tr>
                  ))}
                  {filteredProducts.length === 0 && <tr><td className="admin-product-empty" colSpan={6}>Produk tidak ditemukan. Coba kata kunci lain.</td></tr>}
                </tbody>
              </table>
            </div>
            {showProductForm && (
              <div className="admin-product-modal-backdrop" onClick={() => { setShowProductForm(false); setEditing(null); setImagePreview(''); setRemoveProductImage(false) }}>
                <form key={editing?.id ?? 'new-product'} className="product-form tall admin-product-form admin-product-modal" onSubmit={(event) => void saveProduct(event)} onClick={(event) => event.stopPropagation()}>
                  <button className="admin-product-modal-close" type="button" aria-label="Tutup form" onClick={() => { setShowProductForm(false); setEditing(null); setImagePreview(''); setRemoveProductImage(false) }}>×</button>
                  <div className="admin-form-heading">
                    <span className="admin-form-icon">{editing ? '✎' : '+'}</span>
                    <div>
                      <strong>{editing ? `Ubah ${editing.name}` : 'Tambah produk baru'}</strong>
                      <small>{editing ? 'Perbarui detail produk di katalog.' : 'Lengkapi informasi produk agar siap ditampilkan di toko.'}</small>
                    </div>
                  </div>
                  <div className="admin-product-fields">
                    <label>Nama produk<input required name="name" placeholder="Contoh: Rosy Garden" defaultValue={editing?.name} /></label>
                    <label>Kategori<input required name="category" placeholder="Contoh: Buket bunga" defaultValue={editing?.category} /></label>
                    <label>Harga (Rp)<input required name="price" type="number" min="0" step="1" placeholder="349000" defaultValue={editing?.price} /></label>
                    <label>Stok<input required name="stock" type="number" min="0" placeholder="20" defaultValue={editing?.stock} /></label>
                    <div className="admin-product-image-field"><span>Foto produk</span>
                      <input aria-label="Pilih foto produk" name="image" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                        const file = event.currentTarget.files?.[0]
                        if (!file) return
                        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) {
                          setMessage('Pilih foto JPEG, PNG, atau WebP maksimal 3 MB')
                          event.currentTarget.value = ''
                          return
                        }
                        setRemoveProductImage(false)
                        void readFileAsDataUrl(file).then(setImagePreview).catch(() => setMessage('Foto tidak dapat dibaca'))
                      }} />
                      {imagePreview
                        ? <img className="admin-product-image-preview" src={imagePreview} alt="Pratinjau foto produk" />
                        : <span className="admin-product-image-placeholder">Pratinjau foto akan muncul di sini</span>}
                      {editing?.image_url && !imagePreview.startsWith('data:') && <label className="admin-remove-image"><input type="checkbox" checked={removeProductImage} onChange={(event) => {
                        const checked = event.currentTarget.checked
                        setRemoveProductImage(checked)
                        setImagePreview(checked ? '' : editing.image_url || '')
                      }} /> Hapus foto saat ini</label>}
                    </div>
                    <label>Warna kartu<select name="color" defaultValue={editing?.color || 'rose'}>
                      {editing?.color && !['rose', 'blush', 'meadow', 'sweet'].includes(editing.color) && <option value={editing.color}>{editing.color}</option>}
                      <option value="rose">Rose</option>
                      <option value="blush">Blush</option>
                      <option value="meadow">Meadow</option>
                      <option value="sweet">Sweet</option>
                    </select></label>
                    <label className="admin-product-description">Deskripsi<input name="description" placeholder="Deskripsi singkat produk" defaultValue={editing?.description} /></label>
                    <label>Status produk<select name="active" defaultValue={editing ? String(editing.active) : '1'}>
                      <option value="1">Aktif — tampil di toko</option>
                      <option value="0">Nonaktif — disembunyikan</option>
                    </select></label>
                  </div>
                  <div className="admin-product-form-actions">
                    <button className="admin-secondary-button" type="button" onClick={() => { setShowProductForm(false); setEditing(null); setImagePreview(''); setRemoveProductImage(false) }}>Batal</button>
                    <button className="primary-button">{editing ? 'Simpan perubahan' : 'Tambah produk'}</button>
                  </div>
                </form>
              </div>
            )}
          </section>
        )}

        {section === 'customers' && customers && (
          <section className="admin-card">
              <div className="admin-card-title"><div><p className="eyebrow">Akun</p><h2>Terdaftar</h2></div></div>
              <div className="admin-table-scroll">
                <table>
                  <thead><tr><th>Nama</th><th>Email</th><th>Order</th><th>Belanja</th></tr></thead>
                  <tbody>
                    {customers.registered.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>{row.email}</td>
                        <td>{row.orders}</td>
                        <td>{money(Number(row.spent))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          </section>
        )}
        </div>}
      </main>
    </div>
  )
}
