'use strict';
/**
 * Warstwa logiki podejść (egzaminów): tworzenie, zapis odpowiedzi, zatwierdzanie
 * w trybie nauki, reset, ocena, statystyki błędów. Nie wie nic o HTTP.
 */
const crypto = require('crypto');
const { isCorrect, feedback, publicQuestion } = require('./grading');

/** Tasowanie Fishera–Yatesa (kryptograficzny generator). */
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Błąd biznesowy z kodem HTTP — warstwa HTTP zamienia go na odpowiedź. */
class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Tworzy serwis podejść.
 * @param {object} deps
 * @param {{db: {attempts: import('./store').Attempt[]}, save: () => void}} deps.store
 * @param {() => {exams: Object<string, import('./questions').Exam>, index: Object<string, import('./questions').Question>}} deps.questions  zwraca aktualny zestaw pytań
 * @param {import('./config').Config} deps.config
 * @param {() => number} [deps.now]  zegar (podmieniany w testach)
 */
function createAttemptService({ store, questions, config, now = Date.now }) {
  const { db, save } = store;
  const Q = () => questions().index;

  /** Ostatni wynik każdego pytania (po kluczu treści) ze wszystkich zakończonych podejść. */
  function lastResults() {
    const last = {};
    for (const a of db.attempts.filter(a => a.submitted).sort((x, y) => x.submitted - y.submitted)) {
      for (const d of a.detail) last[d.key] = { ok: d.ok, qid: d.qid };
    }
    return last;
  }

  /**
   * Nowe podejście do arkusza albo powtórka błędów ("__errors__").
   * @param {string} examId
   * @param {'learn'|'exam'} mode
   * @returns {import('./store').Attempt|null} null, gdy nie ma arkusza / błędów
   */
  function create(examId, mode) {
    const index = Q();
    let qids, title;
    if (examId === '__errors__') {
      const byKey = {};
      Object.values(index).forEach(q => { byKey[q.key] = byKey[q.key] || q.qid; });
      qids = Object.entries(lastResults()).filter(([, v]) => !v.ok)
        .map(([k, v]) => (index[v.qid] ? v.qid : byKey[k])).filter(Boolean);
      if (!qids.length) return null;
      title = 'Powtórka błędów (' + qids.length + ')';
    } else {
      const ex = questions().exams[examId];
      if (!ex) return null;
      qids = ex.questions.map(q => q.qid); title = ex.title;
    }
    const t = now();
    const a = {
      id: crypto.randomBytes(8).toString('hex'), exam: examId, title, started: t,
      deadline: t + config.durationMin * 60000, qids, answers: {}, flags: {}, rightOrder: {},
      submitted: null, mode: mode === 'exam' ? 'exam' : 'learn', checked: {},
    };
    qids.forEach(id => { const q = index[id]; if (q.type === 'matching') a.rightOrder[id] = shuffle(q.pairs.map(p => p[1])); });
    db.attempts.push(a); save();
    return a;
  }

  /** @param {string} id */
  const find = id => db.attempts.find(x => x.id === id) || null;

  /** Ocenia podejście (idempotentnie) i zamyka je. */
  function grade(a) {
    if (a.submitted) return a;
    const index = Q();
    a.detail = a.qids.map(id => { const q = index[id]; return { qid: id, key: q ? q.key : '', ok: q ? isCorrect(q, a.answers[id]) : false }; });
    a.score = a.detail.filter(d => d.ok).length;
    a.total = a.qids.length;
    a.pct = a.total ? Math.round(1000 * a.score / a.total) / 10 : 0;
    a.passed = a.pct >= config.passPct;
    a.submitted = Math.min(now(), a.deadline + config.graceMs);
    save();
    return a;
  }

  /** Zamyka podejścia, którym minął czas (wywoływane przy każdym żądaniu). */
  function expireOverdue() {
    db.attempts.forEach(a => { if (!a.submitted && now() > a.deadline + config.graceMs) grade(a); });
  }

  /** Wspólne sprawdzenie przed modyfikacją podejścia. */
  function assertOpen(a, qid) {
    if (a.submitted) throw new AppError(409, 'Egzamin już zakończony');
    if (now() > a.deadline + config.graceMs) { grade(a); throw new AppError(409, 'Czas minął'); }
    if (qid !== undefined && !a.qids.includes(qid)) throw new AppError(400, 'qid');
  }

  /**
   * Zapis odpowiedzi i/lub flagi ★. Zatwierdzonej odpowiedzi (tryb nauki) nie da się zmienić.
   * @param {import('./store').Attempt} a
   * @param {{qid: string, answer?: *, flag?: boolean}} body
   */
  function answer(a, body) {
    assertOpen(a, body.qid);
    if ('answer' in body && a.checked && a.checked[body.qid]) throw new AppError(409, 'Odpowiedź już sprawdzona');
    if ('answer' in body) { if (body.answer == null) delete a.answers[body.qid]; else a.answers[body.qid] = body.answer; }
    if ('flag' in body) { if (body.flag) a.flags[body.qid] = true; else delete a.flags[body.qid]; }
    save();
    return { ok: true, remainingMs: Math.max(0, a.deadline - now()) };
  }

  /** Tryb nauki: zatwierdza odpowiedź i zwraca ocenę z kluczem. */
  function check(a, { qid, answer: ans }) {
    assertOpen(a, qid);
    if (a.mode !== 'learn') throw new AppError(403, 'Tylko w trybie nauki');
    a.checked = a.checked || {};
    if (!a.checked[qid]) { if (ans != null) a.answers[qid] = ans; a.checked[qid] = true; save(); }
    return feedback(Q()[qid], a.answers[qid]);
  }

  /** Tryb nauki: „Od początku” — czyści odpowiedzi, flagi i licznik czasu. */
  function reset(a) {
    assertOpen(a);
    if (a.mode !== 'learn') throw new AppError(403, 'Tylko w trybie nauki');
    const t = now();
    a.answers = {}; a.checked = {}; a.flags = {}; a.started = t; a.deadline = t + config.durationMin * 60000;
    save();
    return { ok: true };
  }

  /** Usuwa podejście (np. porzucony egzamin). */
  function remove(a) {
    const i = db.attempts.indexOf(a);
    if (i >= 0) db.attempts.splice(i, 1);
    save();
    return { ok: true };
  }

  /** Skrót podejścia do listy / historii. */
  function summary(a) {
    return {
      id: a.id, exam: a.exam, title: a.title, started: a.started, deadline: a.deadline, submitted: a.submitted,
      score: a.score, total: a.total || a.qids.length, pct: a.pct, passed: a.passed,
      answered: Object.keys(a.answers).length, mode: a.mode || 'exam',
    };
  }

  /** Pełny widok podejścia: w trakcie bez klucza (poza zatwierdzonymi), po ocenie z kluczem. */
  function view(a) {
    const index = Q();
    const base = summary(a);
    base.passPct = config.passPct;
    if (!a.submitted) {
      base.remainingMs = Math.max(0, a.deadline - now());
      base.questions = a.qids.map(id => publicQuestion(index[id], a));
      base.answers = a.answers; base.flags = a.flags;
      base.checked = {};
      Object.keys(a.checked || {}).forEach(id => { base.checked[id] = feedback(index[id], a.answers[id]); });
      return base;
    }
    base.review = a.qids.map((id, i) => {
      const q = index[id];
      const pq = publicQuestion(q, a);
      pq.your = a.answers[id] == null ? null : a.answers[id];
      pq.ok = a.detail[i].ok;
      pq.expl = q.expl; pq.comment = q.comment;
      if (q.type === 'matching') pq.correctPairs = q.pairs.map(p => p[1]); else pq.correct = q.correct;
      return pq;
    });
    return base;
  }

  /** Statystyki błędów: pytania choć raz złe, na górze te ostatnio złe. */
  function stats() {
    const per = {};
    for (const a of db.attempts.filter(a => a.submitted)) {
      for (const d of a.detail) {
        const s = per[d.key] || (per[d.key] = { key: d.key, qid: d.qid, ok: 0, bad: 0, last: null });
        if (d.ok) s.ok++; else s.bad++;
        s.last = d.ok; s.qid = d.qid;
      }
    }
    const index = Q();
    const byKey = {}; Object.values(index).forEach(q => { byKey[q.key] = q; });
    const list = Object.values(per).filter(s => s.bad > 0).map(s => {
      const q = byKey[s.key] || index[s.qid];
      if (!q) return null;
      const correct = q.type === 'matching' ? q.pairs.map(p => p[0] + ' → ' + p[1]) : q.correct.map(j => q.options[j]);
      return { src: q.exam + ':' + q.n, stem: q.stem, correct, ok: s.ok, bad: s.bad, last: s.last };
    }).filter(Boolean).sort((x, y) => (y.last === false) - (x.last === false) || y.bad - x.bad);
    return { pendingErrors: list.filter(s => s.last === false).length, list };
  }

  /** Dane strony głównej: arkusze z wynikami + lista podejść. */
  function home() {
    const exams = Object.values(questions().exams).map(e => {
      const done = db.attempts.filter(a => a.exam === e.id && a.submitted);
      return {
        id: e.id, title: e.title, desc: e.desc, count: e.questions.length,
        matching: e.questions.filter(q => q.type === 'matching').length,
        best: done.length ? Math.max(...done.map(a => a.pct)) : null,
        last: done.length ? done[done.length - 1].pct : null, tries: done.length,
      };
    });
    const attempts = db.attempts.slice().sort((a, b) => b.started - a.started).map(summary);
    return { exams, attempts, durationMin: config.durationMin, passPct: config.passPct, pendingErrors: stats().pendingErrors };
  }

  return { create, find, grade, expireOverdue, answer, check, reset, remove, summary, view, stats, home };
}

module.exports = { createAttemptService, AppError, shuffle };
