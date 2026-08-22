import type { Database } from 'better-sqlite3'

// Numbered .sql files applied in order against PRAGMA user_version.
// 001_init.sql is version 1, 002_*.sql is version 2, and so on.
// Vite inlines the SQL at build time, so migrations ship inside the bundle.

const migrationModules = import.meta.glob('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

export function migrate(db: Database): void {
  const files = Object.keys(migrationModules).sort()
  const current = db.pragma('user_version', { simple: true }) as number
  for (const file of files) {
    const name = file.split('/').pop()!
    const version = Number(name.split('_')[0])
    if (!Number.isInteger(version) || version <= current) continue
    const sql = migrationModules[file]!
    const apply = db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${version}`)
    })
    apply()
  }
}
