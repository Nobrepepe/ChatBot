import Database from 'better-sqlite3'
import { dbPath } from '../paths'
import { migrate } from './migrate'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(dbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

/** Test hook: close and forget the connection (e.g. between temp data dirs). */
export function closeDbForTests(): void {
  db?.close()
  db = null
}
