import crypto from 'node:crypto';
import { db } from './db.js';

const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

function readCookie(req, name) {
  const match = (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name);
  return match ? decodeURIComponent(match[1] || '') : null;
}

export function startSession(req, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(token, Date.now() + maxAge * 1000);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
}

export function endSession(req, res) {
  const token = readCookie(req, 'sid');
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

export function isLogged(req) {
  const token = readCookie(req, 'sid');
  if (!token) return false;
  return Boolean(db.prepare('SELECT 1 FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now()));
}

export function requireAdmin(req, res, next) {
  if (isLogged(req)) return next();
  res.status(401).json({ error: 'Faça login para continuar.' });
}

// Limite simples contra força bruta: 10 tentativas erradas a cada 15 minutos por IP.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;

export function loginBlocked(ip) {
  const entry = failures.get(ip);
  return Boolean(entry && entry.count >= 10 && Date.now() - entry.first < WINDOW_MS);
}

export function registerLoginFailure(ip) {
  const entry = failures.get(ip);
  if (!entry || Date.now() - entry.first >= WINDOW_MS) failures.set(ip, { count: 1, first: Date.now() });
  else entry.count++;
}

export const clearLoginFailures = (ip) => failures.delete(ip);
