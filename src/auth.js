'use strict';
/**
 * Warstwa uwierzytelniania: jedno hasło dla całej aplikacji, sesja w ciasteczku
 * "sid=<wygaśnięcie>.<HMAC>". Serwer nie trzyma sesji — wystarczy sekret do podpisu.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSION_S = 30 * 24 * 3600; // 30 dni

/** Porównanie odporne na ataki czasowe. */
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Wczytuje sekret z data/secret albo go generuje przy pierwszym uruchomieniu.
 * @param {string} dataDir
 */
function loadSecret(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

/**
 * @param {{password: string, secret: string, now?: () => number}} opts
 */
function createAuth({ password, secret, now = Date.now }) {
  const sign = v => crypto.createHmac('sha256', secret).update(v).digest('hex');
  let failedLogins = 0;

  return {
    /** Czy hasło jest poprawne. */
    checkPassword(given) {
      const ok = safeEqual(given || '', password);
      failedLogins = ok ? 0 : failedLogins + 1;
      return ok;
    },
    /** Opóźnienie po złym haśle rośnie z każdą próbą (max 10 s) — hamuje zgadywanie. */
    penaltyMs: () => Math.min(10000, 500 * failedLogins),

    /** Nagłówek Set-Cookie z nową sesją. Secure, gdy przed aplikacją stoi HTTPS. */
    sessionCookie(req) {
      const exp = String(now() + SESSION_S * 1000);
      const secure = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
      return 'sid=' + exp + '.' + sign(exp) + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + SESSION_S + secure;
    },
    logoutCookie: () => 'sid=; Path=/; Max-Age=0',

    /** Czy żądanie ma ważne, poprawnie podpisane ciasteczko. */
    isAuthed(req) {
      const m = /(?:^|;\s*)sid=(\d+)\.([a-f0-9]{64})/.exec(req.headers.cookie || '');
      return !!m && +m[1] >= now() && safeEqual(m[2], sign(m[1]));
    },
  };
}

module.exports = { createAuth, loadSecret, safeEqual };
