import { Pool, type PoolClient, type QueryResultRow } from 'pg'

export type DbRow = Record<string, unknown>
type DbRows = DbRow[] & { affectedRows?: number }

let pool: Pool | undefined

function getPool() {
  if (pool) return pool

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL belum diatur. Tambahkan Supabase Transaction Pooler connection string pada environment server.')
  }

  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  })

  return pool
}

export function postgresSql(sql: string) {
  return sql
    .replace(/"([^"]*)"/g, "'$1'")
    .replace(/\bDATE_ADD\(NOW\(\),\s*INTERVAL\s+(\d+)\s+MINUTE\)/gi, "NOW() + INTERVAL '$1 minutes'")
    .replace(/\bDATE_SUB\(CURDATE\(\),\s*INTERVAL\s+(\d+)\s+DAY\)/gi, "CURRENT_DATE - INTERVAL '$1 days'")
    .replace(/\bDATE\(created_at\)\s*=\s*CURDATE\(\)/gi, 'created_at::date = CURRENT_DATE')
    .replace(/\bactive\s*=\s*1\b/gi, 'active = TRUE')
    .replace(/\?/g, (_, offset: number, original: string) => {
      const before = original.slice(0, offset)
      return `$${(before.match(/\?/g)?.length || 0) + 1}`
    })
}

function adaptRows(rows: QueryResultRow[], rowCount: number | null): DbRows {
  const result = rows as DbRows
  result.affectedRows = rowCount || 0
  return result
}

class DatabaseConnection {
  private readonly client: PoolClient

  constructor(client: PoolClient) {
    this.client = client
  }

  async query(sql: string, values: unknown[] = []): Promise<[DbRows]> {
    const result = await this.client.query(postgresSql(sql), values)
    return [adaptRows(result.rows, result.rowCount)]
  }

  execute(sql: string, values: unknown[] = []) {
    return this.query(sql, values)
  }

  async beginTransaction() {
    await this.client.query('BEGIN')
  }

  async commit() {
    await this.client.query('COMMIT')
  }

  async rollback() {
    await this.client.query('ROLLBACK')
  }

  release() {
    this.client.release()
  }
}

const poolAdapter = {
  async query(sql: string, values: unknown[] = []): Promise<[DbRows]> {
    const result = await getPool().query(postgresSql(sql), values)
    return [adaptRows(result.rows, result.rowCount)]
  },
  execute(sql: string, values: unknown[] = []) {
    return this.query(sql, values)
  },
  async getConnection() {
    return new DatabaseConnection(await getPool().connect())
  },
  end() {
    return pool?.end() ?? Promise.resolve()
  },
}

export default poolAdapter
