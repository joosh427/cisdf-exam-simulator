'use strict';
/**
 * Warstwa HTTP: routing, parsowanie JSON, pliki statyczne. Cała logika biznesowa
 * siedzi w serwisie podejść — tutaj tylko tłumaczymy żądania na wywołania serwisu
 * i wyniki (lub AppError) na odpowiedzi.
 *
 * API (wszystko poza logowaniem i plikami strony wymaga sesji):
 *   POST /api/login {password}           GET  /api/home        GET /api/stats
 *   POST /api/logout                     POST /api/reload      (ponowne wczytanie pytań)
 *   POST /api/attempts {exam, mode}      → {id}
 *   GET  /api/attempts/:id               → widok podejścia
 *   POST /api/attempts/:id/answer {qid, answer?, flag?}
 *   POST /api/attempts/:id/check  {qid, answer}   (tylko tryb nauki)
 *   POST /api/attempts/:id/reset                  (tylko tryb nauki)
 *   POST /api/attempts/:id/submit | /delete
 *   GET  /img/<plik>                     obrazki z questions/img/
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { AppError } = require('./attempts');

const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
};

/** Odpowiedź JSON (obiekt) albo plik (Buffer z podanym typem). */
function send(res, code, body, headers = {}) {
  const raw = Buffer.isBuffer(body);
  res.writeHead(code, Object.assign({
    'Content-Type': raw ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  }, headers));
  res.end(raw ? body : JSON.stringify(body));
}

/** Ciało żądania jako JSON (limit 1 MB). */
function readBody(req) {
  return new Promise((ok, fail) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e6) { req.destroy(); fail(new AppError(413, 'Za duże żądanie')); } });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { fail(new AppError(400, 'Zły JSON')); } });
  });
}

/**
 * Buduje handler żądań.
 * @param {object} deps
 * @param {import('./config').Config} deps.config
 * @param {ReturnType<import('./auth').createAuth>} deps.auth
 * @param {ReturnType<import('./attempts').createAttemptService>} deps.attempts
 * @param {() => {questions: number}} deps.reloadQuestions
 */
function createHandler({ config, auth, attempts, reloadQuestions }) {
  const publicDir = path.join(config.root, 'public');
  const imgDir = path.join(config.questionsDir, 'img');

  /** Plik z dysku (czytany przy każdym żądaniu — zmiana frontu nie wymaga restartu). */
  function file(res, f, cache) {
    if (!fs.existsSync(f)) return send(res, 404, { error: 'nie ma' });
    send(res, 200, fs.readFileSync(f), {
      'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': cache || 'no-store',
    });
  }

  /** Trasy podejścia: /api/attempts/:id[/akcja] */
  async function attemptRoute(req, res, id, action) {
    const a = attempts.find(id);
    if (!a) return send(res, 404, { error: 'Nie ma takiego podejścia' });
    if (req.method === 'GET' && !action) return send(res, 200, attempts.view(a));
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
    switch (action) {
      case 'answer': return send(res, 200, attempts.answer(a, await readBody(req)));
      case 'check': return send(res, 200, attempts.check(a, await readBody(req)));
      case 'reset': return send(res, 200, attempts.reset(a));
      case 'submit': attempts.grade(a); return send(res, 200, attempts.view(a));
      case 'delete': return send(res, 200, attempts.remove(a));
    }
    send(res, 404, { error: 'not found' });
  }

  async function route(req, res) {
    const p = new URL(req.url, 'http://x').pathname;

    // --- bez logowania ---
    if (req.method === 'GET' && STATIC[p]) return file(res, path.join(publicDir, STATIC[p]));
    if (req.method === 'POST' && p === '/api/login') {
      const b = await readBody(req);
      if (auth.checkPassword(b.password)) return send(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(req) });
      await new Promise(r => setTimeout(r, auth.penaltyMs()));
      return send(res, 401, { error: 'Złe hasło' });
    }
    if (p === '/api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': auth.logoutCookie() });
    if (!auth.isAuthed(req)) return send(res, 401, { error: 'auth' });

    // --- po zalogowaniu ---
    if (req.method === 'GET' && p.startsWith('/img/')) return file(res, path.join(imgDir, path.basename(p)), 'max-age=86400');
    attempts.expireOverdue();
    if (req.method === 'GET' && p === '/api/home') return send(res, 200, attempts.home());
    if (req.method === 'GET' && p === '/api/stats') return send(res, 200, attempts.stats());
    if (req.method === 'POST' && p === '/api/reload') return send(res, 200, Object.assign({ ok: true }, reloadQuestions()));
    if (req.method === 'POST' && p === '/api/attempts') {
      const b = await readBody(req);
      const a = attempts.create(String(b.exam || ''), String(b.mode || 'learn'));
      if (!a) return send(res, 400, { error: 'Nie ma takiego arkusza albo brak błędów do powtórki' });
      return send(res, 200, { id: a.id });
    }
    const m = /^\/api\/attempts\/([a-f0-9]{16})(?:\/(answer|check|reset|submit|delete))?$/.exec(p);
    if (m) return attemptRoute(req, res, m[1], m[2]);
    send(res, 404, { error: 'not found' });
  }

  return async (req, res) => {
    try { await route(req, res); }
    catch (e) {
      if (e instanceof AppError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Błąd serwera' });
    }
  };
}

/** Serwer HTTP z podanym handlerem. */
const createServer = handler => http.createServer(handler);

module.exports = { createHandler, createServer, send, readBody };
