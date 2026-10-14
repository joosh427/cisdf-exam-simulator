'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadQuestions } = require('../src/questions');
const { openStore } = require('../src/store');
const { createAttemptService, AppError } = require('../src/attempts');
const { tmpDirs, fakeClock, testConfig } = require('./helpers');

/** Świeży serwis na tymczasowych katalogach. */
function setup(t) {
  const dirs = tmpDirs();
  t.after(dirs.cleanup);
  const clock = fakeClock();
  const config = testConfig(dirs);
  const qs = loadQuestions(dirs.questionsDir);
  const store = openStore(dirs.dataDir);
  const svc = createAttemptService({ store, questions: () => qs, config, now: clock.now });
  return { svc, store, clock, config, dirs };
}

const ALL_RIGHT = { 't1:1': [0], 't1:2': [0, 2], 't1:3': ['R1', 'R2'] };
const answerAll = (svc, a, answers) => Object.entries(answers).forEach(([qid, answer]) => svc.answer(a, { qid, answer }));
const throwsApp = (fn, status) => assert.throws(fn, e => e instanceof AppError && e.status === status);

test('create: nowe podejście z trybem, terminem i wylosowanym matchingiem', t => {
  const { svc, clock, store } = setup(t);
  const a = svc.create('t1', 'exam');
  assert.match(a.id, /^[a-f0-9]{16}$/);
  assert.equal(a.mode, 'exam');
  assert.equal(a.deadline, clock.now() + 10 * 60000);
  assert.deepEqual([...a.rightOrder['t1:3']].sort(), ['R1', 'R2']);
  assert.equal(store.db.attempts.length, 1);
  assert.equal(svc.create('t1', 'cokolwiek').mode, 'learn');
  assert.equal(svc.create('nie-ma', 'exam'), null);
});

test('zapis: baza trafia na dysk i jest czytana po ponownym otwarciu', t => {
  const { svc, dirs } = setup(t);
  const a = svc.create('t1', 'exam');
  assert.ok(fs.existsSync(path.join(dirs.dataDir, 'db.json')));
  assert.equal(openStore(dirs.dataDir).db.attempts[0].id, a.id);
});

test('answer: zapis, kasowanie odpowiedzi i flaga ★', t => {
  const { svc } = setup(t);
  const a = svc.create('t1', 'exam');
  svc.answer(a, { qid: 't1:1', answer: [1], flag: true });
  assert.deepEqual(a.answers['t1:1'], [1]);
  assert.equal(a.flags['t1:1'], true);
  svc.answer(a, { qid: 't1:1', answer: null, flag: false });
  assert.equal('t1:1' in a.answers, false);
  assert.equal('t1:1' in a.flags, false);
  throwsApp(() => svc.answer(a, { qid: 'obce:1', answer: [0] }), 400);
});

test('grade: komplet dobrych = 100% i zaliczenie; ocena idempotentna', t => {
  const { svc } = setup(t);
  const a = svc.create('t1', 'exam');
  answerAll(svc, a, ALL_RIGHT);
  svc.grade(a);
  assert.equal(a.score, 3); assert.equal(a.pct, 100); assert.equal(a.passed, true);
  const when = a.submitted;
  svc.grade(a);
  assert.equal(a.submitted, when);
});

test('grade: 2/3 = 66,7% poniżej progu 80%', t => {
  const { svc } = setup(t);
  const a = svc.create('t1', 'exam');
  answerAll(svc, a, Object.assign({}, ALL_RIGHT, { 't1:2': [0] }));
  svc.grade(a);
  assert.equal(a.pct, 66.7); assert.equal(a.passed, false);
});

test('po zakończeniu nie można odpowiadać (409)', t => {
  const { svc } = setup(t);
  const a = svc.create('t1', 'exam');
  svc.grade(a);
  throwsApp(() => svc.answer(a, { qid: 't1:1', answer: [0] }), 409);
});

test('czas: po terminie + tolerancji odpowiedź zamyka podejście (409), expireOverdue ocenia porzucone', t => {
  const { svc, clock } = setup(t);
  const a = svc.create('t1', 'exam');
  const b = svc.create('t1', 'exam');
  clock.advance(10 * 60000 + 20000); // w tolerancji
  svc.answer(a, { qid: 't1:1', answer: [0] });
  clock.advance(20000);              // po tolerancji
  throwsApp(() => svc.answer(a, { qid: 't1:1', answer: [0] }), 409);
  assert.ok(a.submitted);
  svc.expireOverdue();
  assert.ok(b.submitted);
  assert.ok(b.submitted <= b.deadline + 30000, 'czas zakończenia przycięty do terminu + tolerancji');
});

test('check (nauka): zwraca ocenę z kluczem i blokuje zmianę odpowiedzi', t => {
  const { svc } = setup(t);
  const a = svc.create('t1', 'learn');
  const f = svc.check(a, { qid: 't1:1', answer: [1] });
  assert.equal(f.ok, false); assert.deepEqual(f.correct, [0]); assert.equal(f.expl, 'because');
  throwsApp(() => svc.answer(a, { qid: 't1:1', answer: [0] }), 409);
  // ponowne zatwierdzenie nie nadpisuje pierwszej odpowiedzi
  assert.equal(svc.check(a, { qid: 't1:1', answer: [0] }).ok, false);
  // flagę nadal można zmieniać
  svc.answer(a, { qid: 't1:1', flag: true });
  assert.equal(a.flags['t1:1'], true);
});

test('check / reset: tylko w trybie nauki (403)', t => {
  const { svc } = setup(t);
  const a = svc.create('t1', 'exam');
  throwsApp(() => svc.check(a, { qid: 't1:1', answer: [0] }), 403);
  throwsApp(() => svc.reset(a), 403);
});

test('reset (nauka): czyści odpowiedzi, zatwierdzenia, flagi i zegar', t => {
  const { svc, clock } = setup(t);
  const a = svc.create('t1', 'learn');
  svc.check(a, { qid: 't1:1', answer: [0] });
  svc.answer(a, { qid: 't1:2', flag: true });
  clock.advance(60000);
  svc.reset(a);
  assert.deepEqual([a.answers, a.checked, a.flags], [{}, {}, {}]);
  assert.equal(a.started, clock.now());
  assert.equal(a.deadline, clock.now() + 10 * 60000);
});

test('view: w trakcie bez klucza (poza zatwierdzonymi), po ocenie z kluczem', t => {
  const { svc } = setup(t);
  const a = svc.create('t1', 'learn');
  svc.check(a, { qid: 't1:1', answer: [0] });
  const v = svc.view(a);
  assert.equal(v.questions.length, 3);
  assert.ok(v.questions.every(q => !('correct' in q) && !('pairs' in q)));
  assert.deepEqual(Object.keys(v.checked), ['t1:1']);
  assert.equal(v.checked['t1:1'].ok, true);
  svc.grade(a);
  const r = svc.view(a);
  assert.equal(r.review.length, 3);
  assert.deepEqual(r.review[0].correct, [0]);
  assert.deepEqual(r.review[2].correctPairs, ['R1', 'R2']);
  assert.equal(r.review[1].your, null);
});

test('powtórka błędów: tylko pytania, których ostatni wynik był zły', t => {
  const { svc } = setup(t);
  assert.equal(svc.create('__errors__', 'learn'), null, 'bez historii nie ma czego powtarzać');
  const a = svc.create('t1', 'exam');
  answerAll(svc, a, Object.assign({}, ALL_RIGHT, { 't1:2': [1] }));
  svc.grade(a);
  const e = svc.create('__errors__', 'learn');
  assert.deepEqual(e.qids, ['t1:2']);
  assert.equal(e.title, 'Powtórka błędów (1)');
  // poprawione w kolejnym podejściu → znika z powtórki
  const b = svc.create('t1', 'exam');
  answerAll(svc, b, ALL_RIGHT);
  svc.grade(b);
  assert.equal(svc.create('__errors__', 'learn'), null);
});

test('stats i home: liczniki błędów, najlepszy i ostatni wynik', t => {
  const { svc } = setup(t);
  const a = svc.create('t1', 'exam');
  answerAll(svc, a, { 't1:1': [0] });
  svc.grade(a);
  const s = svc.stats();
  assert.equal(s.pendingErrors, 2);
  assert.equal(s.list[0].bad, 1);
  const h = svc.home();
  assert.equal(h.exams[0].tries, 1);
  assert.equal(h.exams[0].best, 33.3);
  assert.equal(h.exams[0].matching, 1);
  assert.equal(h.pendingErrors, 2);
});

test('remove: usuwa podejście z bazy', t => {
  const { svc, store } = setup(t);
  const a = svc.create('t1', 'exam');
  svc.remove(a);
  assert.equal(store.db.attempts.length, 0);
  assert.equal(svc.find(a.id), null);
});
