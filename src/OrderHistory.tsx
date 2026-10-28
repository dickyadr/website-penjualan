import { useEffect, useState } from 'react'
import { api, money } from './api'
import { getProductImage } from './product-images'

type Order = {
  id: number
  customer_name: string
  recipient_name: string
  address: string
  city: string
  total: number
  shipping_fee: number
  status: string
  payment_method: string
  payment_status: string
  payment_code: string
  created_at: string
}

type OrderDetail = Order & {
  phone: string
  postal_code: string
  notes: string
  items: { quantity: number; price: number; name: string; image_url: string | null }[]
}

const orderStatusLabels: Record<string, string> = {
  pending: 'Menunggu diproses',
  processing: 'Sedang diproses',
  packed: 'Sedang dikemas',
  shipped: 'Dalam pengiriman',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
}

const paymentStatusLabels: Record<string, string> = {
  unpaid: 'Belum dibayar',
  pending: 'Diproses',
  paid: 'Dibayar',
  expired: 'Selesai',
  failed: 'Gagal',
  refunded: 'Cancel',
}

const activeStatuses = ['pending', 'processing', 'packed', 'shipped']

function formatDate(value: string) {
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

export function OrderHistory({ onLogin }: { onLogin: () => void }) {
  const token = localStorage.getItem('jelita_token')
  const [orders, setOrders] = useState<Order[]>([])
  const [details, setDetails] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    void api<Order[]>('/api/my/orders')
      .then(setOrders)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [token])

  const showDetails = async (code: string) => {
    if (details?.payment_code === code) {
      setDetails(null)
      return
    }
    setError('')
    try {
      setDetails(await api<OrderDetail>(`/api/my/orders/${encodeURIComponent(code)}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengambil detail pesanan')
    }
  }

  const activeCount = orders.filter((order) => activeStatuses.includes(order.status)).length
  const completedCount = orders.filter((order) => order.status === 'completed').length

  return (
    <div className="site-shell orders-shell">
      <header className="navbar">
        <a className="brand" href="/">
          <span className="brand-mark">✽</span>
          <span>
            jelita<span>flower</span>
          </span>
        </a>
        <nav className="desktop-nav">
          <a href="/">Toko</a>
          <a href="/pesanan">Pesanan</a>
        </nav>
        <div className="nav-actions">
          <a className="login-link" href="/">
            Kembali ke toko
          </a>
        </div>
      </header>

      <main className="orders-page">
        <section className="orders-hero">
          <div className="orders-hero-copy">
            <p className="eyebrow">Akun Kamu</p>
            <h1>
              Riwayat <em>Pesanan</em>
            </h1>
            <p className="orders-intro">
              Pantau status, rincian, dan perjalanan setiap buket yang kamu pesan dari atelier kami.
            </p>
          </div>

          {token && !loading && orders.length > 0 && (
            <div className="orders-stats">
              <div className="order-stat">
                <span>Total Pesanan</span>
                <strong>{orders.length}</strong>
              </div>
              <div className="order-stat">
                <span>Sedang Berjalan</span>
                <strong>{activeCount}</strong>
              </div>
              <div className="order-stat">
                <span>Selesai</span>
                <strong>{completedCount}</strong>
              </div>
            </div>
          )}
        </section>

        {!token ? (
          <div className="orders-message">
            <span className="orders-message-icon">🔐</span>
            <h2>Masuk ke akunmu</h2>
            <p>Masuk untuk melihat daftar pesanan dan melacak status pengiriman bunga.</p>
            <button className="primary-button" onClick={onLogin}>
              Masuk Sekarang
            </button>
          </div>
        ) : loading ? (
          <div className="orders-list" aria-busy="true" aria-label="Memuat pesanan">
            {[0, 1, 2].map((item) => (
              <div className="order-skeleton" key={item}>
                <div className="sk-line sk-sm" />
                <div className="sk-line sk-lg" />
                <div className="sk-line sk-md" />
                <div className="sk-line sk-sm" />
              </div>
            ))}
          </div>
        ) : error && orders.length === 0 ? (
          <div className="orders-message" role="alert">
            <span className="orders-message-icon">⚠️</span>
            <h2>Gagal memuat pesanan</h2>
            <p>{error}</p>
            <button className="primary-button" onClick={onLogin}>
              Masuk kembali
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="orders-empty">
            <span className="orders-empty-icon">🌷</span>
            <h2>Belum ada pesanan</h2>
            <p>Setiap momen indah dimulai dari satu buket. Yuk pilih bunga pertamamu.</p>
            <a className="primary-button" href="/">
              Jelajahi Koleksi ↗
            </a>
          </div>
        ) : (
          <div className="orders-list">
            {orders.map((order, index) => {
              const isOpen = details?.payment_code === order.payment_code
              return (
                <article
                  className={`order-card${isOpen ? ' is-open' : ''}`}
                  key={order.id}
                  style={{ animationDelay: `${index * 0.07}s` }}
                >
                  <div className="order-card-heading">
                    <div className="order-card-id">
                      <span className="order-code-label">Kode Pesanan</span>
                      <strong>{order.payment_code || `#JF-${order.id}`}</strong>
                      <small>{formatDate(order.created_at)}</small>
                    </div>
                    <span className={`status ${order.status}`}>
                      <i className="status-dot" aria-hidden="true" />
                      {orderStatusLabels[order.status] || order.status}
                    </span>
                  </div>

                  <div className="order-card-meta">
                    <span className="meta-chip">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="8" r="3.6" />
                        <path d="M4.5 20c.7-3.6 3.8-5.6 7.5-5.6s6.8 2 7.5 5.6" />
                      </svg>
                      {order.recipient_name || order.customer_name}
                    </span>
                    <span className="meta-chip">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11Z" />
                        <circle cx="12" cy="10" r="2.4" />
                      </svg>
                      {order.city}
                    </span>
                    <span className="meta-chip">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
                        <path d="M2.5 10h19" />
                      </svg>
                      {order.payment_method === 'cod' ? 'Bayar di Tempat' : 'Transfer Bank'}
                    </span>
                  </div>

                  <div className="order-card-footer">
                    <div className="order-payment">
                      <small>{paymentStatusLabels[order.payment_status] || order.payment_status}</small>
                      <strong>{money(Number(order.total))}</strong>
                    </div>
                    <button
                      className={`link-button order-detail-toggle${isOpen ? ' is-open' : ''}`}
                      onClick={() => void showDetails(order.payment_code)}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? 'Tutup detail' : 'Lihat detail'}
                      <span className="order-chevron" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </span>
                    </button>
                  </div>

                  {isOpen && details && (
                    <div className="order-card-details">
                      <div className="order-detail-grid">
                        <div className="order-detail-block">
                          <span className="detail-label">Alamat Pengiriman</span>
                          <p>
                            {details.address}, {details.city} {details.postal_code}
                          </p>
                        </div>
                        <div className="order-detail-block">
                          <span className="detail-label">Kontak Penerima</span>
                          <p>{details.phone}</p>
                        </div>
                        {details.notes && (
                          <div className="order-detail-block">
                            <span className="detail-label">Catatan</span>
                            <p>{details.notes}</p>
                          </div>
                        )}
                      </div>

                      <div className="order-detail-items">
                        <span className="detail-label">Rincian Bunga</span>
                        <ul>
                          {details.items.map((item, itemIndex) => (
                            <li key={`${item.name}-${itemIndex}`}>
                              <span className="order-item-name">
                                <img src={getProductImage(item)} alt={item.name} />
                                <span className="order-item-copy">
                                  <strong>{item.name}</strong>
                                  <small>
                                    {item.quantity} × {money(Number(item.price))}
                                  </small>
                                </span>
                              </span>
                              <strong className="order-item-subtotal">{money(Number(item.price) * item.quantity)}</strong>
                            </li>
                          ))}
                        </ul>

                        <div className="order-detail-summary">
                          <div>
                            <span>Ongkos kirim</span>
                            <strong>{money(Number(details.shipping_fee))}</strong>
                          </div>
                          <div className="order-detail-grand">
                            <span>Total Pesanan</span>
                            <strong>{money(Number(details.total))}</strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}

        {error && orders.length > 0 && (
          <p className="auth-message" role="alert">
            {error}
          </p>
        )}
      </main>

      <footer className="orders-footer">
        <a className="brand" href="/">
          <span className="brand-mark">✽</span>
          <span>
            jelita<span>flower</span>
          </span>
        </a>
        <p>Merangkai cerita, satu bunga pada satu waktu.</p>
        <small>© 2025 Jelita Flower Floral Atelier. Dibuat dengan cinta.</small>
      </footer>
    </div>
  )
}
