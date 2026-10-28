import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, money } from './api'

export type StoreProduct = { id: number; name: string; category: string; price: number; emoji?: string; color: string; image_url?: string | null; stock?: number }
export type CartItem = StoreProduct & { quantity: number }

type PaymentPayload = {
  payment_code: string
  method: string
  channel: string
  amount: number
  status: string
  va_number: string | null
  snap_token: string | null
  snap_redirect: string | null
  expires_at: string
  customer_name: string
  recipient_name: string
  address: string
  city: string
  latitude: number | null
  longitude: number | null
  order_status: string
  payment_status: string
  shipping_fee: number
  items: { quantity: number; price: number; name: string; emoji: string }[]
}

const methods = [
  { id: 'cod', title: 'Bayar di tempat (COD)', hint: 'Bayar saat pesanan diterima' },
  { id: 'bank_transfer', title: 'Transfer bank', hint: 'Diarahkan ke halaman pembayaran Midtrans' },
]

function loadSnap(clientKey: string, production: boolean) {
  const id = 'midtrans-snap'
  if (document.getElementById(id)) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.id = id
    script.src = production
      ? 'https://app.midtrans.com/snap/snap.js'
      : 'https://app.sandbox.midtrans.com/snap/snap.js'
    script.setAttribute('data-client-key', clientKey)
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Gagal memuat Midtrans'))
    document.body.appendChild(script)
  })
}

export function CheckoutModal({
  cart,
  totalPrice,
  onClose,
  onComplete,
}: {
  cart: CartItem[]
  totalPrice: number
  onClose: () => void
  onComplete: (code: string, paymentStatus: 'paid' | 'cod') => void
}) {
  const [method, setMethod] = useState('cod')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [paymentCode, setPaymentCode] = useState<string | null>(null)
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!event.currentTarget.reportValidity()) {
      setError('Lengkapi nama, nomor WhatsApp, alamat, dan kota dengan benar sebelum melanjutkan.')
      return
    }
    setBusy(true)
    setError('')
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const created = await api<{
        paymentCode: string
        provider?: string
        payment: { snap_token?: string | null; snap_redirect?: string | null }
      }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerName: values.customerName,
          recipientName: values.recipientName,
          phone: values.phone,
          address,
          city: values.city || city,
          postalCode: values.postalCode,
          notes: values.notes,
          paymentMethod: method,
          items: cart.map((item) => ({ productId: item.id, quantity: item.quantity })),
        }),
      })
      const redirectUrl = created.payment?.snap_redirect
      if (method === 'bank_transfer' && redirectUrl) {
        window.location.assign(redirectUrl)
        return
      }
      setPaymentCode(created.paymentCode)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pesanan gagal dibuat')
    } finally {
      setBusy(false)
    }
  }

  if (paymentCode) {
    return (
      <div className="modal-backdrop checkout-backdrop">
        <div className="checkout-modal checkout-wide">
          <PaymentScreen code={paymentCode} onClose={onClose} onComplete={onComplete} />
        </div>
      </div>
    )
  }

  const shipping = /jakarta/i.test(city) ? 0 : 25000

  return (
    <div className="modal-backdrop checkout-backdrop">
      <form className="checkout-modal checkout-wide" noValidate onSubmit={(event) => void submit(event)}>
        <button type="button" className="close-button" onClick={onClose}>×</button>
        <p className="eyebrow">Langkah pembayaran</p>
        <h2>Checkout</h2>
        <div className="checkout-grid">
          <div>
            <label>Nama pemesan<input required name="customerName" placeholder="Nama kamu" /></label>
            <label>Nama penerima<input required name="recipientName" placeholder="Nama yang menerima bunga" /></label>
            <label>Nomor WhatsApp<input required type="tel" name="phone" pattern="\+?[0-9]{9,15}" placeholder="08xxxxxxxxxx" /></label>
            <label>Alamat lengkap<textarea required name="address" placeholder="Jalan, nomor rumah/gedung, kelurahan, dan patokan" value={address} onChange={(event) => setAddress(event.target.value)} /></label>
            <div className="form-row">
              <label>Kota<input required name="city" placeholder="Jakarta Selatan" value={city} onChange={(event) => setCity(event.target.value)} /></label>
              <label>Kode pos<input name="postalCode" placeholder="12190" /></label>
            </div>
            <label>Catatan florist<textarea name="notes" placeholder="Ucapan kartu, waktu kirim, permintaan khusus" /></label>
          </div>
          <div>
            <p className="map-title">Metode pembayaran</p>
            <div className="pay-methods">
              {methods.map((item) => (
                <button type="button" key={item.id} className={method === item.id ? 'selected' : ''} onClick={() => setMethod(item.id)}>
                  <strong>{item.title}</strong>
                  <small>{item.hint}</small>
                </button>
              ))}
            </div>
            <div className="cart-total"><span>Subtotal</span><strong>{money(totalPrice)}</strong></div>
            <div className="cart-total slim"><span>Ongkir</span><strong>{shipping ? money(shipping) : 'Gratis'}</strong></div>
            <div className="cart-total"><span>Total bayar</span><strong>{money(totalPrice + shipping)}</strong></div>
            {error && <p className="auth-message" role="alert">{error}</p>}
            <button className="primary-button full-button" disabled={busy}>{busy ? 'Memproses...' : 'Lanjut pembayaran'}</button>
          </div>
        </div>
      </form>
    </div>
  )
}

function PaymentScreen({ code, onClose, onComplete }: { code: string; onClose: () => void; onComplete: (code: string, paymentStatus: 'paid' | 'cod') => void }) {
  const [payment, setPayment] = useState<PaymentPayload | null>(null)
  const [message, setMessage] = useState('')

  const refresh = async () => {
    const data = await api<PaymentPayload>(`/api/payments/${code}`)
    setPayment(data)
    if (data.status === 'paid' || data.payment_status === 'paid') onComplete(code, 'paid')
  }

  useEffect(() => {
    void refresh().catch((err: Error) => setMessage(err.message))
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 4000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  useEffect(() => {
    const startSnap = async () => {
      if (!payment?.snap_token) return
      const config = await api<{ midtransClientKey: string | null; midtransProduction: boolean }>('/api/config')
      if (!config.midtransClientKey) return
      await loadSnap(config.midtransClientKey, config.midtransProduction)
      const snap = (window as { snap?: { pay: (token: string, opts: object) => void } }).snap
      snap?.pay(payment.snap_token, {
        onSuccess: () => void refresh(),
        onPending: () => setMessage('Menunggu pembayaran Midtrans...'),
        onError: () => setMessage('Pembayaran Midtrans gagal'),
      })
    }
    void startSnap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment?.snap_token])

  if (!payment) return <p className="empty-state">{message || 'Menyiapkan pembayaran...'}</p>

  return (
    <>
      <button type="button" className="close-button" onClick={onClose}>×</button>
      <p className="eyebrow">Payment gateway</p>
      <h2>Selesaikan pembayaran</h2>
      <p className="pay-code">Kode transaksi <strong>{payment.payment_code}</strong></p>
      <div className="pay-box">
        {payment.method === 'cod' && <p>Pesanan kamu sudah dicatat. Silakan bayar {money(Number(payment.amount))} kepada kurir saat pesanan diterima.</p>}
        {payment.method === 'bank_transfer' && <p>Selesaikan transfer melalui halaman pembayaran Midtrans. Status akan diperbarui otomatis setelah Midtrans mengonfirmasi pembayaran.</p>}
        {payment.channel === 'midtrans' && payment.snap_redirect && (
          <a className="primary-button full-button" href={payment.snap_redirect} target="_blank" rel="noreferrer">
            Lanjut ke Midtrans
          </a>
        )}
      </div>
      <div className="cart-total"><span>Total</span><strong>{money(Number(payment.amount))}</strong></div>
      <p className="map-meta">Kirim ke {payment.recipient_name} · {payment.city}</p>
      {message && <p className="auth-message">{message}</p>}
      {payment.status === 'paid' && <p className="auth-message success">Pembayaran diterima. Pesanan masuk antrian florist.</p>}
      {payment.method === 'cod' && (
        <button className="primary-button full-button" onClick={() => onComplete(code, 'cod')}>Selesai</button>
      )}
    </>
  )
}
