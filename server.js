'use strict';
// CIS-DF Exam Simulator — Node.js >= 18, bez zależności zewnętrznych.
// Pytania: ./questions/*.md (format LearnWise), obrazki: ./questions/img/
// Konfiguracja przez zmienne środowiskowe (patrz .env.example).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const Q_DIR = process.env.QUESTIONS_DIR || path.join(ROOT, 'questions');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '::';
const PASSWORD = process.env.APP_PASSWORD || '';
const DURATION_MIN = parseFloat(process.env.DURATION_MIN || '90');
const PASS_PCT = parseFloat(process.env.PASS_PCT || '80');
const GRACE_MS = 30 * 1000;

if (!PASSWORD) { console.error('Brak APP_PASSWORD — ustaw hasło w .env'); process.exit(1); }
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- sekret do podpisywania ciasteczek ----------
const SECRET_FILE = path.join(DATA_DIR, 'secret');
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();

// ---------- parser LearnWise ----------
function parseExam(text) {
  const cfg = {}; const qs = [];
  let q = null, params = '', inParams = false;
  const newQ = () => ({ text: [], answers: [], params: {}, expl: [] });
  const flush = () => { if (q && q.answers.length) qs.push(q); q = null; };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (inParams || line[0] === '{') {
      params += line; inParams = true;
      if (line.endsWith('}')) {
        try { Object.assign((q || (q = newQ())).params, JSON.parse(params)); } catch (e) { console.warn('Zły JSON parametrów:', params); }
        params = ''; inParams = false;
      }
      continue;
    }
    const c = line[0];
    if (c === '#') { const i = line.indexOf(':'); if (i > 0) cfg[line.slice(1, i).trim()] = line.slice(i + 1).trim(); continue; }
    if (c === '+' || c === '-') {
      if (!q) continue;
      q.answers.push({ ok: c === '+', name: line.slice(1).trim().replace(/\s*\[most voted\]\s*/gi, ' ').trim() });
      continue;
    }
    if (c === '>') { (q || (q = newQ())).expl.push(line.slice(1).trim()); continue; }
    if (c === '@') continue;
    if (!q || q.answers.length) { flush(); q = newQ(); }
    q.text.push(line);
  }
  flush();
  return { cfg, qs };
}

let EXAMS = {};   // id -> {id, title, desc, questions:[...]}
let QINDEX = {};  // qid -> question
function loadQuestions() {
  const exams = {}, index = {};
  const files = fs.readdirSync(Q_DIR).filter(f => f.endsWith('.md')).sort();
  for (const f of files) {
    const id = f.replace(/^cis_df_/, '').replace(/\.md$/, '');
    const { cfg, qs } = parseExam(fs.readFileSync(path.join(Q_DIR, f), 'utf8'));
    const questions = qs.map((q, i) => {
      const matching = q.params.type === 'matching' || q.answers.some(a => a.ok && a.name.includes('=='));
      const stem = q.text.join('\n');
      const qid = id + ':' + (i + 1);
      const base = { qid, exam: id, n: i + 1, stem, expl: q.expl.join('\n'), comment: q.params.comment || '',
        key: crypto.createHash('sha1').update(stem + '\n' + q.answers.map(a => (a.ok ? '+' : '-') + a.name).join('\n')).digest('hex').slice(0, 12) };
      if (matching) {
        const pairs = q.answers.filter(a => a.ok).map(a => { const k = a.name.indexOf('=='); return [a.name.slice(0, k).trim(), a.name.slice(k + 2).trim()]; });
        return Object.assign(base, { type: 'matching', pairs });
      }
      const correct = q.answers.map((a, j) => a.ok ? j : -1).filter(j => j >= 0);
      return Object.assign(base, { type: correct.length > 1 ? 'multi' : 'single', options: q.answers.map(a => a.name), correct });
    });
    exams[id] = { id, file: f, title: cfg.exam || id, desc: cfg.description || '', questions };
    questions.forEach(q => { index[q.qid] = q; });
  }
  EXAMS = exams; QINDEX = index;
  console.log('Wczytano', Object.keys(exams).length, 'arkuszy,', Object.keys(index).length, 'pytań');
}
loadQuestions();

// ---------- baza (plik JSON) ----------
const DB_FILE = path.join(DATA_DIR, 'db.json');
let db = { attempts: [] };
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- logika egzaminu ----------
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function publicQuestion(q, attempt) {
  const o = { qid: q.qid, src: q.exam + ':' + q.n, type: q.type, stem: q.stem };
  if (q.type === 'matching') { o.left = q.pairs.map(p => p[0]); o.right = attempt.rightOrder[q.qid]; }
  else { o.options = q.options; o.choose = q.correct.length; }
  return o;
}

function isCorrect(q, ans) {
  if (ans == null) return false;
  if (q.type === 'matching') return Array.isArray(ans) && q.pairs.every((p, i) => ans[i] === p[1]);
  if (!Array.isArray(ans)) return false;
  const s = [...new Set(ans)].sort((a, b) => a - b);
  return s.length === q.correct.length && s.every((v, i) => v === q.correct[i]);
}

function lastResults() {
  // ostatni wynik każdego pytania (po kluczu treści) z zakończonych podejść
  const last = {};
  for (const a of db.attempts.filter(a => a.submitted).sort((x, y) => x.submitted - y.submitted)) {
    for (const d of a.detail) last[d.key] = { ok: d.ok, qid: d.qid };
  }
  return last;
}

function createAttempt(examId, mode) {
  let qids, title;
  if (examId === '__errors__') {
    const last = lastResults();
    const byKey = {}; Object.values(QINDEX).forEach(q => { byKey[q.key] = byKey[q.key] || q.qid; });
    qids = Object.entries(last).filter(([, v]) => !v.ok).map(([k, v]) => QINDEX[v.qid] ? v.qid : byKey[k]).filter(Boolean);
    if (!qids.length) return null;
    title = 'Powtórka błędów (' + qids.length + ')';
  } else {
    const ex = EXAMS[examId]; if (!ex) return null;
    qids = ex.questions.map(q => q.qid); title = ex.title;
  }
  const now = Date.now();
  const a = { id: crypto.randomBytes(8).toString('hex'), exam: examId, title, started: now,
    deadline: now + DURATION_MIN * 60000, qids, answers: {}, flags: {}, rightOrder: {}, submitted: null,
    mode: mode === 'exam' ? 'exam' : 'learn', checked: {} };
  qids.forEach(id => { const q = QINDEX[id]; if (q.type === 'matching') a.rightOrder[id] = shuffle(q.pairs.map(p => p[1])); });
  db.attempts.push(a); save();
  return a;
}

function grade(a) {
  if (a.submitted) return a;
  a.detail = a.qids.map(id => { const q = QINDEX[id]; return { qid: id, key: q ? q.key : '', ok: q ? isCorrect(q, a.answers[id]) : false }; });
  a.score = a.detail.filter(d => d.ok).length;
  a.total = a.qids.length;
  a.pct = a.total ? Math.round(1000 * a.score / a.total) / 10 : 0;
  a.passed = a.pct >= PASS_PCT;
  a.submitted = Math.min(Date.now(), a.deadline + GRACE_MS);
  save();
  return a;
}

function expireOverdue() {
  let n = 0;
  db.attempts.forEach(a => { if (!a.submitted && Date.now() > a.deadline + GRACE_MS) { grade(a); n++; } });
  return n;
}

function summary(a) {
  return { id: a.id, exam: a.exam, title: a.title, started: a.started, deadline: a.deadline, submitted: a.submitted,
    score: a.score, total: a.total || a.qids.length, pct: a.pct, passed: a.passed,
    answered: Object.keys(a.answers).length, mode: a.mode || 'exam' };
}

function attemptView(a) {
  const base = summary(a);
  base.passPct = PASS_PCT;
  if (!a.submitted) {
    base.remainingMs = Math.max(0, a.deadline - Date.now());
    base.questions = a.qids.map(id => publicQuestion(QINDEX[id], a));
    base.answers = a.answers; base.flags = a.flags;
    base.checked = {};
    Object.keys(a.checked || {}).forEach(id => { base.checked[id] = feedback(QINDEX[id], a.answers[id]); });
    return base;
  }
  base.review = a.qids.map((id, i) => {
    const q = QINDEX[id];
    const pq = publicQuestion(q, a);
    pq.your = a.answers[id] == null ? null : a.answers[id];
    pq.ok = a.detail[i].ok;
    pq.expl = q.expl; pq.comment = q.comment;
    if (q.type === 'matching') pq.correctPairs = q.pairs.map(p => p[1]); else pq.correct = q.correct;
    return pq;
  });
  return base;
}

function feedback(q, ans) {
  const f = { ok: isCorrect(q, ans), expl: q.expl, comment: q.comment };
  if (q.type === 'matching') f.correctPairs = q.pairs.map(p => p[1]); else f.correct = q.correct;
  return f;
}

function stats() {
  const per = {};
  for (const a of db.attempts.filter(a => a.submitted)) {
    for (const d of a.detail) {
      const s = per[d.key] || (per[d.key] = { key: d.key, qid: d.qid, ok: 0, bad: 0, last: null });
      d.ok ? s.ok++ : s.bad++; s.last = d.ok; s.qid = d.qid;
    }
  }
  const byKey = {}; Object.values(QINDEX).forEach(q => { byKey[q.key] = q; });
  const list = Object.values(per).filter(s => s.bad > 0).map(s => {
    const q = byKey[s.key] || QINDEX[s.qid];
    if (!q) return null;
    const correct = q.type === 'matching' ? q.pairs.map(p => p[0] + ' → ' + p[1]) : q.correct.map(j => q.options[j]);
    return { src: q.exam + ':' + q.n, stem: q.stem, correct, ok: s.ok, bad: s.bad, last: s.last };
  }).filter(Boolean).sort((x, y) => (y.last === false) - (x.last === false) || y.bad - x.bad);
  return { pendingErrors: list.filter(s => s.last === false).length, list };
}

// ---------- HTTP ----------
function sign(v) { return crypto.createHmac('sha256', SECRET).update(v).digest('hex'); }
function makeCookie(req) {
  const exp = String(Date.now() + 30 * 24 * 3600 * 1000);
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return 'sid=' + exp + '.' + sign(exp) + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + 30 * 24 * 3600 + secure;
}
function authed(req) {
  const m = /(?:^|;\s*)sid=(\d+)\.([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m || +m[1] < Date.now()) return false;
  const a = Buffer.from(m[2]), b = Buffer.from(sign(m[1]));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function send(res, code, body, headers) {
  const isStr = typeof body === 'string' || Buffer.isBuffer(body);
  res.writeHead(code, Object.assign({ 'Content-Type': isStr ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, headers || {}));
  res.end(isStr ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((ok, fail) => {
    let s = ''; req.on('data', c => { s += c; if (s.length > 1e6) { req.destroy(); fail(new Error('too big')); } });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { fail(e); } });
  });
}
const INDEX_HTML = path.join(ROOT, 'public', 'index.html');
let failedLogins = 0;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, fs.readFileSync(INDEX_HTML));
    if (req.method === 'POST' && p === '/api/login') {
      const b = await readBody(req);
      const a = Buffer.from(String(b.password || '')), e = Buffer.from(PASSWORD);
      if (a.length === e.length && crypto.timingSafeEqual(a, e)) { failedLogins = 0; return send(res, 200, { ok: true }, { 'Set-Cookie': makeCookie(req) }); }
      failedLogins++; await new Promise(r => setTimeout(r, Math.min(10000, 500 * failedLogins)));
      return send(res, 401, { error: 'Złe hasło' });
    }
    if (p === '/api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
    if (!authed(req)) return send(res, 401, { error: 'auth' });

    if (req.method === 'GET' && p.startsWith('/img/')) {
      const f = path.join(Q_DIR, 'img', path.basename(p));
      if (!fs.existsSync(f)) return send(res, 404, { error: 'nie ma' });
      const ext = path.extname(f).toLowerCase();
      res.writeHead(200, { 'Content-Type': { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' }[ext] || 'application/octet-stream', 'Cache-Control': 'max-age=86400' });
      return fs.createReadStream(f).pipe(res);
    }
    expireOverdue();
    if (req.method === 'GET' && p === '/api/home') {
      const exams = Object.values(EXAMS).map(e => {
        const done = db.attempts.filter(a => a.exam === e.id && a.submitted);
        return { id: e.id, title: e.title, desc: e.desc, count: e.questions.length,
          matching: e.questions.filter(q => q.type === 'matching').length,
          best: done.length ? Math.max(...done.map(a => a.pct)) : null,
          last: done.length ? done[done.length - 1].pct : null, tries: done.length };
      });
      const attempts = db.attempts.slice().sort((a, b) => b.started - a.started).map(summary);
      return send(res, 200, { exams, attempts, durationMin: DURATION_MIN, passPct: PASS_PCT, pendingErrors: stats().pendingErrors });
    }
    if (req.method === 'GET' && p === '/api/stats') return send(res, 200, stats());
    if (req.method === 'POST' && p === '/api/reload') { loadQuestions(); return send(res, 200, { ok: true, questions: Object.keys(QINDEX).length }); }
    if (req.method === 'POST' && p === '/api/attempts') {
      const b = await readBody(req);
      const a = createAttempt(String(b.exam || ''), String(b.mode || 'learn'));
      if (!a) return send(res, 400, { error: 'Nie ma takiego arkusza albo brak błędów do powtórki' });
      return send(res, 200, { id: a.id });
    }
    let m;
    if ((m = /^\/api\/attempts\/([a-f0-9]{16})(\/(answer|check|reset|submit|delete))?$/.exec(p))) {
      const a = db.attempts.find(x => x.id === m[1]);
      if (!a) return send(res, 404, { error: 'Nie ma takiego podejścia' });
      if (req.method === 'GET' && !m[2]) return send(res, 200, attemptView(a));
      if (req.method === 'POST' && m[3] === 'answer') {
        if (a.submitted) return send(res, 409, { error: 'Egzamin już zakończony' });
        if (Date.now() > a.deadline + GRACE_MS) { grade(a); return send(res, 409, { error: 'Czas minął' }); }
        const b = await readBody(req);
        if (!a.qids.includes(b.qid)) return send(res, 400, { error: 'qid' });
        if ('answer' in b && a.checked && a.checked[b.qid]) return send(res, 409, { error: 'Odpowiedź już sprawdzona' });
        if ('answer' in b) { if (b.answer == null) delete a.answers[b.qid]; else a.answers[b.qid] = b.answer; }
        if ('flag' in b) { if (b.flag) a.flags[b.qid] = true; else delete a.flags[b.qid]; }
        save();
        return send(res, 200, { ok: true, remainingMs: Math.max(0, a.deadline - Date.now()) });
      }
      if (req.method === 'POST' && m[3] === 'check') {
        if (a.submitted) return send(res, 409, { error: 'Egzamin już zakończony' });
        if (a.mode !== 'learn') return send(res, 403, { error: 'Tylko w trybie nauki' });
        if (Date.now() > a.deadline + GRACE_MS) { grade(a); return send(res, 409, { error: 'Czas minął' }); }
        const b = await readBody(req);
        if (!a.qids.includes(b.qid)) return send(res, 400, { error: 'qid' });
        a.checked = a.checked || {};
        if (!a.checked[b.qid]) { if (b.answer != null) a.answers[b.qid] = b.answer; a.checked[b.qid] = true; save(); }
        return send(res, 200, feedback(QINDEX[b.qid], a.answers[b.qid]));
      }
      if (req.method === 'POST' && m[3] === 'reset') {
        if (a.submitted) return send(res, 409, { error: 'Egzamin już zakończony' });
        if (a.mode !== 'learn') return send(res, 403, { error: 'Tylko w trybie nauki' });
        const now = Date.now();
        a.answers = {}; a.checked = {}; a.flags = {}; a.started = now; a.deadline = now + DURATION_MIN * 60000;
        save();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && m[3] === 'submit') { grade(a); return send(res, 200, attemptView(a)); }
      if (req.method === 'POST' && m[3] === 'delete') { db.attempts = db.attempts.filter(x => x !== a); save(); return send(res, 200, { ok: true }); }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Błąd serwera' });
  }
});
server.on('error', e => {
  if (e.code === 'EAFNOSUPPORT' && HOST === '::') { console.warn('Brak IPv6 — nasłuch na 0.0.0.0'); server.listen(PORT, '0.0.0.0'); }
  else { console.error(e); process.exit(1); }
});
server.on('listening', () => console.log('CIS-DF simulator nasłuchuje na', server.address()));
server.listen(PORT, HOST);
