export const money = (value: number) => `Rp ${Number(value || 0).toLocaleString('id-ID')}`

export function authHeaders() {
  const token = localStorage.getItem('jelita_token')
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { ...authHeaders(), ...(options?.headers || {}) },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((data as { message?: string }).message || 'Permintaan gagal')
  return data as T
}
