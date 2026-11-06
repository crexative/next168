// A D1 stand-in over node:sqlite, in memory: the D1 adapter's exact SQL runs unchanged, and a batch is one
// transaction on one connection, as on D1 (spike L6 checked `changes()` across batch statements on local D1).
import { DatabaseSync } from 'node:sqlite'
import type { D1Like, D1StatementLike } from '../connectionStore'

type Row = Record<string, unknown>
interface Executed { results: Row[]; meta: { changes: number } }

class SqliteStatement implements D1StatementLike {
  constructor(private readonly db: DatabaseSync, readonly sql: string, private readonly values: unknown[] = []) {}

  bind(...values: unknown[]): D1StatementLike {
    return new SqliteStatement(this.db, this.sql, values)
  }

  execute(): Executed {
    const statement = this.db.prepare(this.sql)
    const params = this.values.map((value) => (value === undefined ? null : value)) as (string | number | null)[]
    const isSelect = /^\s*SELECT\b/i.test(this.sql)
    if (isSelect || /\bRETURNING\b/i.test(this.sql)) {
      const results = statement.all(...params).map((row) => ({ ...row }))
      return { results, meta: { changes: isSelect ? 0 : results.length } }
    }
    return { results: [], meta: { changes: Number(statement.run(...params).changes) } }
  }

  async all<T = Row>(): Promise<{ results: T[]; meta: { changes: number } }> {
    return this.execute() as unknown as { results: T[]; meta: { changes: number } }
  }

  async run(): Promise<{ meta: { changes: number } }> {
    return this.execute()
  }
}

export interface SqliteD1 extends D1Like {
  sqlite: DatabaseSync
  rows(table: 'google_pending' | 'google_credentials'): Row[]
}

export function sqliteD1(): SqliteD1 {
  const db = new DatabaseSync(':memory:')
  return {
    sqlite: db,
    prepare: (sql) => new SqliteStatement(db, sql),
    async batch<T = Row>(statements: D1StatementLike[]) {
      db.exec('BEGIN')
      try {
        const results = statements.map((statement) => (statement as SqliteStatement).execute())
        db.exec('COMMIT')
        return results as unknown as { results: T[]; meta: { changes: number } }[]
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    rows(table) {
      try {
        return db.prepare(`SELECT * FROM ${table} ORDER BY device_hash`).all().map((row) => ({ ...row }))
      } catch {
        return []
      }
    },
  }
}
