import "server-only";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = path.join(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "accounts.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);

export type UserRecord = { id: number; first_name: string; last_name: string; email: string };

export function validatePassword(password: string) {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function checkPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createUser(firstName: string, lastName: string, email: string, password: string) {
  try {
    const result = db.prepare("INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)")
      .run(firstName.trim(), lastName.trim(), email.trim().toLowerCase(), hashPassword(password));
    return { id: Number(result.lastInsertRowid), first_name: firstName.trim(), last_name: lastName.trim(), email: email.trim().toLowerCase() } satisfies UserRecord;
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return null;
    throw error;
  }
}

export function findUserByEmail(email: string) {
  return db.prepare("SELECT id, first_name, last_name, email, password_hash FROM users WHERE email = ? COLLATE NOCASE")
    .get(email.trim().toLowerCase()) as (UserRecord & { password_hash: string }) | undefined;
}

export function authenticateUser(email: string, password: string) {
  const user = findUserByEmail(email);
  if (!user || !checkPassword(password, user.password_hash)) return null;
  const { password_hash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

export function updatePassword(email: string, password: string) {
  const result = db.prepare("UPDATE users SET password_hash = ? WHERE email = ? COLLATE NOCASE")
    .run(hashPassword(password), email.trim().toLowerCase());
  return result.changes > 0;
}

export function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 14;
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, userId, expiresAt);
  return { token, expiresAt };
}

export function getSessionUser(token: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return db.prepare(`SELECT users.id, users.first_name, users.last_name, users.email
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(tokenHash, Date.now()) as UserRecord | undefined;
}

export function deleteSession(token: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}
