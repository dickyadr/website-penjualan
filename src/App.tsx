import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { AdminDashboard } from './Admin'
import { api, money } from './api'
import { CheckoutModal, type CartItem, type StoreProduct } from './Checkout'
import { OrderHistory } from './OrderHistory'
import { getProductImage } from './product-images'

function useScrollReveal() {
  const init = useCallback(() => {
    const els = document.querySelectorAll('[data-reveal]')
    if (!('IntersectionObserver' in window)) {
      els.forEach((element) => element.classList.add('is-visible'))
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            io.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    )
    for (const el of els) {
      io.observe(el)
    }
    return io
  }, [])
  return init
}

const fallbackProducts: StoreProduct[] = [
  {
    id: 1,
    name: 'Rosy Garden Premium',
    category: 'Buket bunga',
    price: 349000,
    color: 'rose',
    image_url: 'https://images.unsplash.com/photo-1561181286-d3fee7d55364?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 2,
    name: 'Blush Peony Elegance',
    category: 'Buket bunga',
    price: 425000,
    color: 'blush',
    image_url: 'https://images.unsplash.com/photo-1526047932273-341f2a7631f9?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 3,
    name: 'Spring Meadow Sunshine',
    category: 'Buket bunga',
    price: 289000,
    color: 'meadow',
    image_url: 'https://images.unsplash.com/photo-1582794543139-8ac9cb0f7b11?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 4,
    name: 'Sweet Love Velvet',
    category: 'Buket spesial',
    price: 499000,
    color: 'sweet',
    image_url: 'https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 5,
    name: 'Golden Sunflower Glow',
    category: 'Buket spesial',
    price: 325000,
    color: 'sweet',
    image_url: 'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 6,
    name: 'White Lily Symphony',
    category: 'Buket bunga',
    price: 465000,
    color: 'blush',
    image_url: 'https://images.unsplash.com/photo-1508610048659-a06b669e3321?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 7,
    name: 'Pastel Dream Bloombox',
    category: 'Bloom box',
    price: 520000,
    color: 'rose',
    image_url: 'https://images.unsplash.com/photo-1525310072745-f49212b5ac6d?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 8,
    name: 'Eternal French Lavender',
    category: 'Bunga kering',
    price: 245000,
    color: 'meadow',
    image_url: 'https://images.unsplash.com/photo-1516205651411-aef33a44f7c2?auto=format&fit=crop&w=800&q=80',
  },
]

const faqs = [
  {
    q: 'Apakah bisa pengiriman di hari yang sama (Same-day)?',
    a: 'Bisa! Untuk pesanan yang dikonfirmasi sebelum pukul 14.00 WIB, kurir kami siap mengantarkan buket segar langsung ke alamat tujuan pada hari yang sama.',
  },
  {
    q: 'Apakah sudah termasuk kartu ucapan dan cetak pesan?',
    a: 'Ya, setiap pemesanan di Jelita Flower sudah mendapatkan GRATIS kartu ucapan eksklusif berdesain elegan. Anda bisa menulis pesan personal saat checkout.',
  },
  {
    q: 'Bagaimana cara menjaga buket bunga agar tetap awet dan segar?',
    a: 'Potong miring ujung batang sekitar 1-2 cm setiap 2 hari, letakkan dalam vas berisi air bersih dingin, dan jauhkan dari paparan sinar matahari langsung serta hembusan AC.',
  },
  {
    q: 'Metode pembayaran apa saja yang didukung?',
    a: 'Kami menerima pembayaran Cash on Delivery (COD) saat barang sampai, serta Transfer Bank & QRIS otomatis melalui gerbang pembayaran resmi Midtrans.',
  },
]

function App() {
  const [products, setProducts] = useState<StoreProduct[]>(fallbackProducts)
  const [cart, setCart] = useState<CartItem[]>([])
  const [activeCategory, setActiveCategory] = useState('Semua')
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const [showCart, setShowCart] = useState(false)
  const [showCheckout, setShowCheckout] = useState(false)
  const [directCheckoutItem, setDirectCheckoutItem] = useState<CartItem | null>(null)
  const [pendingPurchase, setPendingPurchase] = useState<{ type: 'cart' | 'buy'; product: StoreProduct } | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'info' | 'order'; icon: string; title: string; message: string } | null>(null)
  const [showAuth, setShowAuth] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authMessage, setAuthMessage] = useState('')
  const [isLoggedIn, setIsLoggedIn] = useState(() => Boolean(localStorage.getItem('jelita_token')))
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  const isAdmin = window.location.pathname.startsWith('/admin')
  const isOrdersPage = window.location.pathname === '/pesanan'
  const initReveal = useScrollReveal()

  const categories = ['Semua', ...Array.from(new Set(products.map((product) => product.category)))]
  const visibleProducts = products.filter((product) => {
    const matchesCategory = activeCategory === 'Semua' || product.category === activeCategory
    const query = searchQuery.trim().toLocaleLowerCase('id-ID')
    const matchesSearch = !query || `${product.name} ${product.category}`.toLocaleLowerCase('id-ID').includes(query)
    return matchesCategory && matchesSearch
  })
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0)
  const totalPrice = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const freeShippingThreshold = 500000
  const freeShippingDiff = Math.max(0, freeShippingThreshold - totalPrice)
  const freeShippingPercent = Math.min(100, Math.round((totalPrice / freeShippingThreshold) * 100))

  useEffect(() => {
    void api<StoreProduct[]>('/api/products')
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setProducts(data)
        }
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const io = initReveal()
    return () => io?.disconnect()
  }, [initReveal, products, activeCategory, searchQuery])

  useEffect(() => {
    if (isOrdersPage && !isLoggedIn) window.location.replace('/')
  }, [isOrdersPage, isLoggedIn])

  useEffect(() => {
    if (showSearch) searchInput.current?.focus()
  }, [showSearch])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => {
      setToast(null)
    }, 4500)
    return () => clearTimeout(timer)
  }, [toast])

  const addProductToCart = (product: StoreProduct) =>
    setCart((items) => {
      const existing = items.find((item) => item.id === product.id)
      return existing
        ? items.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item))
        : [...items, { ...product, quantity: 1 }]
    })

  const requestPurchase = (type: 'cart' | 'buy', product: StoreProduct) => {
    if (!localStorage.getItem('jelita_token')) {
      setPendingPurchase({ type, product })
      setAuthMode('login')
      setAuthMessage(
        type === 'cart'
          ? 'Silakan masuk untuk menambahkan produk ke keranjang.'
          : 'Silakan masuk untuk melanjutkan pembelian.',
      )
      setShowAuth(true)
      return
    }
    if (type === 'cart') {
      addProductToCart(product)
      setShowCart(true)
      return
    }
    setDirectCheckoutItem({ ...product, quantity: 1 })
    setShowCheckout(true)
  }

  const changeQuantity = (id: number, amount: number) =>
    setCart((items) =>
      items
        .map((item) => (item.id === id ? { ...item, quantity: item.quantity + amount } : item))
        .filter((item) => item.quantity > 0),
    )

  const logout = () => {
    localStorage.removeItem('jelita_token')
    setIsLoggedIn(false)
    setCart([])
    setPendingPurchase(null)
    setShowCart(false)
    setShowCheckout(false)
    setDirectCheckoutItem(null)
    setShowAuth(false)
    setToast({
      type: 'info',
      icon: '👋',
      title: 'Berhasil Keluar',
      message: 'Kamu telah berhasil keluar dari akun. Sampai jumpa lagi!',
    })
  }

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthMessage('Memproses...')
    const data = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const result = await api<{ token: string; user: { name?: string; email: string } }>(`/api/auth/${authMode}`, {
        method: 'POST',
        body: JSON.stringify(data),
      })
      localStorage.setItem('jelita_token', result.token)
      setIsLoggedIn(true)
      const isLogin = authMode === 'login'
      const userName = result.user.name || result.user.email
      setToast({
        type: 'success',
        icon: isLogin ? '🌸' : '✨',
        title: isLogin ? 'Berhasil Masuk' : 'Pendaftaran Berhasil',
        message: isLogin
          ? `Selamat datang kembali, ${userName}!`
          : `Akunmu berhasil dibuat. Selamat datang di Jelita Flower!`,
      })
      setShowAuth(false)
      if (pendingPurchase) {
        const { type, product } = pendingPurchase
        setPendingPurchase(null)
        if (type === 'cart') {
          addProductToCart(product)
          setShowCart(true)
        } else {
          setDirectCheckoutItem({ ...product, quantity: 1 })
          setShowCheckout(true)
        }
      } else if (isOrdersPage) {
        window.location.href = '/pesanan'
      }
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : 'Terjadi kesalahan')
    }
  }

  const authDialog = showAuth && (
    <div className="modal-backdrop" onClick={() => setShowAuth(false)}>
      <form
        className="checkout-modal auth-modal"
        onSubmit={(event) => void submitAuth(event)}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="close-button" onClick={() => setShowAuth(false)} aria-label="Tutup modal">
          ×
        </button>
        <p className="eyebrow">Jelita Flower Atelier</p>
        <h2>{authMode === 'login' ? 'Selamat Datang Kembali' : 'Buat Akun Baru'}</h2>
        <p className="auth-subtext">
          {authMode === 'login'
            ? 'Masuk untuk mengelola keranjang & melacak pesanan bungamu.'
            : 'Daftar sekarang untuk kemudahan pemesanan & promo eksklusif.'}
        </p>
        {authMode === 'register' && (
          <label>
            Nama lengkap
            <input required name="name" placeholder="Nama lengkap kamu" />
          </label>
        )}
        <label>
          Email
          <input required type="email" name="email" placeholder="nama@email.com" />
        </label>
        <label>
          Password
          <input required type="password" minLength={6} name="password" placeholder="Minimal 6 karakter" />
        </label>
        {authMessage && <p className="auth-message">{authMessage}</p>}
        <button className="primary-button full-button">{authMode === 'login' ? 'Masuk ke Akun' : 'Daftar Sekarang'}</button>
        <button
          type="button"
          className="switch-auth"
          onClick={() => {
            setAuthMode(authMode === 'login' ? 'register' : 'login')
            setAuthMessage('')
          }}
        >
          {authMode === 'login' ? 'Belum punya akun? Daftar gratis' : 'Sudah punya akun? Masuk di sini'}
        </button>
      </form>
    </div>
  )

  const toastDialog = toast && (
    <div
      key={`${toast.type}-${toast.title}`}
      className={`app-toast toast-${toast.type}`}
      role="status"
      aria-live="polite"
    >
      <span className="toast-icon" aria-hidden="true">
        {toast.icon}
      </span>
      <div className="toast-text">
        <strong>{toast.title}</strong>
        <p>{toast.message}</p>
      </div>
      <button className="toast-close" aria-label="Tutup notifikasi" onClick={() => setToast(null)}>
        ×
      </button>
      <span className="toast-progress" aria-hidden="true" />
    </div>
  )

  if (isAdmin) return <AdminDashboard />
  if (isOrdersPage) {
    return (
      <div className="site-shell">
        <OrderHistory
          onLogin={() => {
            setAuthMode('login')
            setAuthMessage('')
            setShowAuth(true)
          }}
        />
        {authDialog}
        {toastDialog}
      </div>
    )
  }

  return (
    <div className="site-shell">
      {/* Main Navigation */}
      <header className="navbar">
        <a className="brand" href="#top">
          <span className="brand-mark">✽</span>
          <span>
            jelita<span>flower</span>
          </span>
        </a>
        <nav className="desktop-nav">
          <a href="#koleksi">Koleksi Bunga</a>
          <a href="#cara-pesan">Cara Pesan</a>
          <a href="#tentang">Tentang Kami</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="nav-actions">
          <button
            className="icon-button"
            aria-label={showSearch ? 'Tutup pencarian' : 'Cari produk'}
            aria-expanded={showSearch}
            onClick={() => {
              setShowSearch((open) => !open)
              setSearchQuery('')
            }}
          >
            <span className="search-toggle-icon" aria-hidden="true">
              {showSearch ? '×' : '⌕'}
            </span>
          </button>
          {isLoggedIn ? (
            <>
              <button className="cart-button" onClick={() => setShowCart(true)} aria-label="Buka keranjang">
                <svg
                  className="cart-bag-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="9" cy="20" r="1.5" />
                  <circle cx="18" cy="20" r="1.5" />
                  <path d="M2.5 3h2.2l2.3 11.3a2 2 0 0 0 2 1.7h8.6a2 2 0 0 0 2-1.6L21.5 7H6.2" />
                </svg>
                {totalItems > 0 && <b>{totalItems}</b>}
              </button>
              <a className="orders-link" href="/pesanan">
                Pesanan Saya
              </a>
              <button className="login-link login-button" onClick={logout}>
                Keluar
              </button>
            </>
          ) : (
            <button
              className="login-link login-button"
              onClick={() => {
                setAuthMode('login')
                setAuthMessage('')
                setShowAuth(true)
              }}
            >
              Masuk / Daftar
            </button>
          )}
        </div>
      </header>

      {/* Expandable Search Drawer */}
      <div className={`store-search-shell ${showSearch ? 'is-open' : ''}`} aria-hidden={!showSearch}>
        <div className="store-search-clip">
          <form
            className="store-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              document.getElementById('koleksi')?.scrollIntoView({ behavior: 'smooth' })
            }}
          >
            <label htmlFor="product-search">Cari rangkaian</label>
            <input
              ref={searchInput}
              id="product-search"
              type="search"
              placeholder="Cari mawar, peony, sunflower, bloom box..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              tabIndex={showSearch ? 0 : -1}
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} tabIndex={showSearch ? 0 : -1}>
                Hapus
              </button>
            )}
          </form>
        </div>
      </div>

      <main id="top">
        {/* Hero Section */}
        <section className="hero">
          <div className="hero-copy" data-reveal>
            <p className="eyebrow">
              <span className="hero-eyebrow-mark">✳</span> FLORAL STUDIO & ATELIER RESMI
            </p>
            <h1>
              Hadiah kecil,
              <br />
              <em>makna</em> yang abadi.
            </h1>
            <p className="hero-text">
              Rangkaian bunga segar grade A yang dirangkai dengan sepenuh hati oleh florist ahli. Hadirkan kehangatan di
              setiap momen wisuda, anniversary, dan hari bahagia.
            </p>
            <div className="hero-actions">
              <a className="primary-button hero-cta" href="#koleksi">
                Pilih Buket Favorit <span>↗</span>
              </a>
              <a className="hero-secondary-link" href="#tentang">
                Cerita Kami <span>↓</span>
              </a>
            </div>
            <div className="hero-metrics">
              <div className="metric-item">
                <strong>15.000+</strong>
                <small>Buket Bahagia Terkirim</small>
              </div>
              <div className="metric-divider" />
              <div className="metric-item">
                <strong>4.9 ★</strong>
                <small>1.200+ Ulasan Pelanggan</small>
              </div>
              <div className="metric-divider" />
              <div className="metric-item">
                <strong>100%</strong>
                <small>Garansi Segar Tiap Hari</small>
              </div>
            </div>
          </div>

          <div className="hero-visual" data-reveal>
            <div className="hero-image-frame">
              <img
                src="https://images.unsplash.com/photo-1561181286-d3fee7d55364?auto=format&fit=crop&w=1000&q=85"
                alt="Rangkaian bunga mewah Jelita Flower"
                className="hero-main-photo"
              />
              <div className="hero-badge hero-badge-top">
                <span className="badge-icon">🌸</span>
                <div>
                  <strong>Dipetik Pagi Ini</strong>
                  <small>100% Bunga Segar Pilihan</small>
                </div>
              </div>
              <div className="hero-badge hero-badge-bottom">
                <span className="badge-icon">⭐</span>
                <div>
                  <strong>Rating 4.9 / 5.0</strong>
                  <small>Pilihan #1 Momen Spesial</small>
                </div>
              </div>
              <div className="hero-seal-stamp">
                <span>✳</span>
                <small>
                  SAME DAY
                  <br />
                  DELIVERY
                </small>
              </div>
            </div>
          </div>
        </section>

        {/* Product Catalog */}
        <section className="collection" id="koleksi">
          <div className="section-heading" data-reveal>
            <div>
              <p className="eyebrow">Katalog Pilihan</p>
              <h2>
                Koleksi Bunga <em>Terbaru</em>
              </h2>
              <p className="section-subtitle">Pilih gaya buket yang paling mewakili pesan dan isi hatimu.</p>
            </div>
            <button
              className="link-button"
              onClick={() => {
                setActiveCategory('Semua')
                setSearchQuery('')
              }}
            >
              Lihat semua koleksi ↗
            </button>
          </div>

          <div className="category-tabs" data-reveal>
            {categories.map((category) => (
              <button
                className={activeCategory === category ? 'active' : ''}
                onClick={() => setActiveCategory(category)}
                key={category}
              >
                {category}
              </button>
            ))}
          </div>

          {visibleProducts.length > 0 ? (
            <div className="product-grid">
              {visibleProducts.map((product) => {
                const imageUrl = getProductImage(product)
                return (
                  <article className="product-card" key={product.id} data-reveal>
                    <div className={`product-image ${product.color || 'rose'}`}>
                      <span className="product-tag-badge">Pilihan Favorit</span>
                      <img className="product-photo" src={imageUrl} alt={product.name} loading="lazy" />
                    </div>
                    <div className="product-info">
                      <div className="product-meta">
                        <span className="product-category-label">{product.category}</span>
                        <span className="product-rating">★ 4.9</span>
                      </div>
                      <h3>{product.name}</h3>
                      <div className="product-price-row">
                        <strong>{money(product.price)}</strong>
                        <span className="original-price">{money(Math.round(product.price * 1.15))}</span>
                      </div>
                      <div className="product-actions">
                        <button
                          className="add-button"
                          onClick={() => requestPurchase('cart', product)}
                          aria-label={`Tambah ${product.name} ke keranjang`}
                          title="Tambah ke keranjang"
                        >
                          +
                        </button>
                        <button className="buy-now-button" onClick={() => requestPurchase('buy', product)}>
                          Beli Langsung
                        </button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="empty-search" data-reveal>
              <span className="empty-search-icon">🔍</span>
              <h3>Produk tidak ditemukan</h3>
              <p>Coba gunakan kata kunci lain seperti "mawar", "peony", atau "spesial".</p>
              <button
                className="primary-button"
                onClick={() => {
                  setSearchQuery('')
                  setActiveCategory('Semua')
                }}
              >
                Reset Pencarian
              </button>
            </div>
          )}
        </section>

        {/* How It Works */}
        <section className="how-it-works" id="cara-pesan" data-reveal>
          <div className="section-header-center">
            <p className="eyebrow">Mudah & Cepat</p>
            <h2>
              Cara Memesan di <em>Jelita Flower</em>
            </h2>
            <p className="section-subtitle">3 langkah sederhana untuk mengirimkan kebahagiaan bagi orang terkasih.</p>
          </div>
          <div className="steps-grid">
            <div className="step-card">
              <span className="step-number">01</span>
              <div className="step-icon">💐</div>
              <h3>Pilih Buket Favorit</h3>
              <p>Eksplorasi koleksi mawar, peony, sunflower, hingga bloom box dengan desain modern.</p>
            </div>
            <div className="step-card">
              <span className="step-number">02</span>
              <div className="step-icon">✍️</div>
              <h3>Tulis Kartu Ucapan</h3>
              <p>Tambahkan pesan tulus dari hati. Kami cetak gratis dengan kartu ucapan eksklusif.</p>
            </div>
            <div className="step-card">
              <span className="step-number">03</span>
              <div className="step-icon">🚀</div>
              <h3>Bunga Diantar Segar</h3>
              <p>Kurir kami mengantar bunga dengan perlakuan khusus agar tiba segar dan sempurna.</p>
            </div>
          </div>
        </section>

        {/* Story Section */}
        <section className="story" id="tentang">
          <div className="story-art" data-reveal>
            <img
              src="https://images.unsplash.com/photo-1589244159943-460088ed5c92?auto=format&fit=crop&w=900&q=80"
              alt="Florist Jelita Flower merangkai bunga"
              className="story-image"
            />
            <div className="story-art-overlay">
              <span>JELITA FLOWER · EST. 2020</span>
              <strong>
                Merangkai rasa,
                <br />
                menjadi cerita.
              </strong>
            </div>
          </div>
          <div className="story-copy" data-reveal>
            <p className="eyebrow">Filosofi Kami</p>
            <h2>
              Dibuat untuk membuat
              <br />
              <em>hari lebih indah.</em>
            </h2>
            <p>
              Kami percaya, bunga bukan sekadar hadiah seremonial. Ia adalah cara paling elegan dan tulus untuk
              menyampaikan rasa cinta, rindu, dan apresiasi yang terkadang sulit diungkapkan dengan kata-kata.
            </p>
            <p>
              Setiap kelopak bunga di Jelita Flower dipilih dengan standar ketat pada subuh hari, dirangkai dengan
              sentuhan artistik florist kami, dan dikemas dengan bahan ramah lingkungan bermutu tinggi.
            </p>
            <div className="story-badges">
              <span>🌿 100% Organik & Segar</span>
              <span>🎨 Desain Kontemporer</span>
              <span>🚚 Pengiriman Tepat Waktu</span>
            </div>
            <a className="text-link" href="#koleksi">
              Jelajahi Buket Jelita Flower →
            </a>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="faq-section" id="faq" data-reveal>
          <div className="section-header-center">
            <p className="eyebrow">Pusat Bantuan</p>
            <h2>
              Pertanyaan yang <em>Sering Diajukan</em>
            </h2>
            <p className="section-subtitle">Semua informasi penting seputar pemesanan dan pengiriman bunga.</p>
          </div>
          <div className="faq-list">
            {faqs.map((faq, index) => {
              const isOpen = openFaq === index
              return (
                <div
                  className={`faq-item ${isOpen ? 'is-open' : ''}`}
                  key={faq.q}
                  onClick={() => setOpenFaq(isOpen ? null : index)}
                >
                  <div className="faq-question">
                    <strong>{faq.q}</strong>
                    <span className="faq-toggle">{isOpen ? '−' : '+'}</span>
                  </div>
                  {isOpen && <p className="faq-answer">{faq.a}</p>}
                </div>
              )
            })}
          </div>
        </section>
      </main>

      {/* Floating WhatsApp Consultation Button */}
      <a
        href="https://wa.me/6281234567890?text=Halo%20Jelita%20Flower,%20saya%20ingin%20konsultasi%20pesanan%20bunga"
        target="_blank"
        rel="noreferrer"
        className="floating-wa"
        aria-label="Konsultasi via WhatsApp"
      >
        <span className="wa-icon">💬</span>
        <span className="wa-text">Tanya Florist</span>
      </a>

      {/* Footer */}
      <footer id="kontak" data-reveal>
        <div className="footer-top">
          <div className="footer-col brand-col">
            <a className="brand footer-brand" href="#top">
              <span className="brand-mark">✽</span>
              <span>
                jelita<span>flower</span>
              </span>
            </a>
            <p className="footer-tagline">
              Atelier bunga segar premium yang merangkai setiap cerita dengan keindahan alami dan sentuhan kasih.
            </p>
            <div className="social-links">
              <span className="social-pill">📸 @jelitaflower</span>
              <span className="social-pill">💬 WhatsApp Support</span>
            </div>
          </div>
          <div className="footer-col">
            <h4>Layanan Pelanggan</h4>
            <a href="#faq">FAQ & Bantuan</a>
            <a href="/pesanan">Lacak Status Pesanan</a>
            <a href="#kontak">Syarat & Ketentuan</a>
          </div>
          <div className="footer-col">
            <h4>Jam Operasional Studio</h4>
            <p>Senin – Sabtu: 08.00 – 20.00 WIB</p>
            <p>Minggu & Hari Libur: 08.00 – 17.00 WIB</p>
            <small>Pengiriman Same-Day tersedia setiap hari.</small>
          </div>
        </div>
        <div className="footer-bottom">
          <small>© 2025 Jelita Flower Floral Atelier. All rights reserved. Dibuat dengan cinta untuk momen berharga.</small>
        </div>
      </footer>

      {/* Cart Drawer */}
      {showCart && isLoggedIn && (
        <div className="modal-backdrop" onClick={() => setShowCart(false)}>
          <aside className="side-panel cart-drawer" onClick={(event) => event.stopPropagation()} aria-label="Keranjang belanja">
            <header className="cart-drawer-head">
              <div>
                <p className="eyebrow">Keranjang Belanja</p>
                <h2>
                  Pilihan Bungamu
                  {cart.length > 0 && (
                    <span className="cart-count-pill">{cart.reduce((sum, item) => sum + item.quantity, 0)} item</span>
                  )}
                </h2>
              </div>
              <button className="close-button" onClick={() => setShowCart(false)} aria-label="Tutup keranjang">
                ×
              </button>
            </header>

            <div className="cart-drawer-body">
              {cart.length > 0 && (
                <div className="free-shipping-card">
                  <div className="free-shipping-header">
                    <span>{freeShippingDiff === 0 ? '🎉 Selamat! Kamu dapat BEBAS ONGKIR' : `Tambah ${money(freeShippingDiff)} lagi untuk Bebas Ongkir`}</span>
                    <small>{freeShippingPercent}%</small>
                  </div>
                  <div className="free-shipping-progress">
                    <div className="free-shipping-bar" style={{ width: `${freeShippingPercent}%` }} />
                  </div>
                </div>
              )}

              {cart.length === 0 ? (
                <div className="empty-cart-state">
                  <span className="empty-cart-icon">🛒</span>
                  <h3>Keranjangmu masih kosong</h3>
                  <p>Belum ada bunga yang dipilih. Yuk pilih buket cantik untuk hari ini!</p>
                  <button
                    className="primary-button"
                    onClick={() => {
                      setShowCart(false)
                      document.getElementById('koleksi')?.scrollIntoView({ behavior: 'smooth' })
                    }}
                  >
                    Mulai Belanja ↗
                  </button>
                </div>
              ) : (
                <div className="cart-list">
                  {cart.map((item, index) => (
                    <div className="cart-item" key={item.id} style={{ animationDelay: `${index * 60}ms` }}>
                      <span className={`mini-image ${item.color}`}>
                        <img src={getProductImage(item)} alt={item.name} />
                      </span>
                      <div className="cart-item-info">
                        <strong>{item.name}</strong>
                        <small>{money(item.price)}</small>
                        <div className="cart-item-controls">
                          <div className="quantity">
                            <button onClick={() => changeQuantity(item.id, -1)} aria-label="Kurangi jumlah">
                              −
                            </button>
                            <span>{item.quantity}</span>
                            <button onClick={() => changeQuantity(item.id, 1)} aria-label="Tambah jumlah">
                              +
                            </button>
                          </div>
                          <span className="cart-item-total">{money(item.price * item.quantity)}</span>
                        </div>
                      </div>
                      <button
                        className="cart-item-remove"
                        onClick={() => changeQuantity(item.id, -item.quantity)}
                        aria-label={`Hapus ${item.name} dari keranjang`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {cart.length > 0 && (
              <footer className="cart-drawer-foot">
                <div className="cart-total-row">
                  <span>Subtotal</span>
                  <strong>{money(totalPrice)}</strong>
                </div>
                <div className="cart-total-row free-tag">
                  <span>Kartu Ucapan Kustom</span>
                  <strong>GRATIS</strong>
                </div>
                <div className="cart-total">
                  <span>Total Estimasi</span>
                  <strong>{money(totalPrice)}</strong>
                </div>
                <button className="primary-button full-button cart-checkout-btn" onClick={() => setShowCheckout(true)}>
                  Lanjut ke Checkout →
                </button>
                <p className="cart-secure-note">🔒 Pembayaran aman & terenkripsi</p>
              </footer>
            )}
          </aside>
        </div>
      )}

      {/* Checkout Modal */}
      {showCheckout && (
        <CheckoutModal
          cart={directCheckoutItem ? [directCheckoutItem] : cart}
          totalPrice={directCheckoutItem ? directCheckoutItem.price : totalPrice}
          onClose={() => {
            setShowCheckout(false)
            setDirectCheckoutItem(null)
          }}
          onComplete={(code, paymentStatus) => {
            if (!directCheckoutItem) setCart([])
            setDirectCheckoutItem(null)
            setShowCheckout(false)
            setShowCart(false)
            setToast({
              type: 'order',
              icon: '🌸',
              title: 'Pesanan Berhasil!',
              message:
                paymentStatus === 'cod'
                  ? `Pesanan ${code} berhasil dibuat! Silakan bayar saat kurir mengantar pesanan.`
                  : `Pembayaran berhasil diterima! Simpan kode ${code} untuk melacak pesanan.`,
            })
          }}
        />
      )}

      {/* Authentication Dialog */}
      {authDialog}

      {/* Toast Notification */}
      {toastDialog}
    </div>
  )
}

export default App
