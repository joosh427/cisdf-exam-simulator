'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { normalize, breakdown, DOMAINS } = require('../src/domains');
const { loadQuestions } = require('../src/questions');
const { openStore } = require('../src/store');
const { createAttemptService } = require('../src/attempts');
const { tmpDirs, fakeClock, testConfig } = require('./helpers');

test('normalize: CSDM → CSDM Fundamentals, wielkość liter jak w blueprincie', () => {
  assert.equal(normalize('CSDM'), 'CSDM Fundamentals');
  assert.equal(normalize('ingest'), 'Ingest');
  assert.equal(normalize(''), null);
  assert.equal(normalize('Inne'), 'Inne');
});

test('breakdown: kolejność z blueprintu, wagi, procenty, pytania bez domeny na końcu', () => {
  const dom = { a: 'Govern', b: 'Govern', c: 'Ingest', d: null };
  const r = breakdown([{ qid: 'a', ok: true }, { qid: 'b', ok: false }, { qid: 'c', ok: true }, { qid: 'd', ok: false }], q => dom[q]);
  assert.deepEqual(r.map(x => x.domain), ['Ingest', 'Govern', 'Bez domeny']);
  assert.deepEqual(r[1], { domain: 'Govern', weight: 35, ok: 1, total: 2, pct: 50 });
  assert.equal(r[2].weight, null);
  assert.equal(DOMAINS.reduce((s, d) => s + d.weight, 0), 100);
});

test('loadQuestions: domena z parametru pytania i z domains.json (po qid i po kluczu treści)', t => {
  const d = tmpDirs('Q1?\n{"domain": "csdm"}\n+ a\n- b\n\nQ2?\n+ a\n- b\n\nQ3?\n+ a\n- b\n');
  t.after(d.cleanup);
  const key3 = loadQuestions(d.questionsDir).index['t1:3'].key;
  fs.writeFileSync(path.join(d.questionsDir, 'domains.json'), JSON.stringify({ 't1:1': 'Ingest', 't1:2': 'Configuration', [key3]: 'Insight' }));
  const { index } = loadQuestions(d.questionsDir);
  assert.equal(index['t1:1'].domain, 'CSDM Fundamentals', 'parametr w pliku wygrywa z domains.json');
  assert.equal(index['t1:2'].domain, 'Configuration');
  assert.equal(index['t1:3'].domain, 'Insight');
});

test('view po ocenie: wynik per domena i domena przy każdym pytaniu', t => {
  const d = tmpDirs('Q1?\n{"domain": "Govern"}\n+ a\n- b\n\nQ2?\n{"domain": "Govern"}\n+ a\n- b\n\nQ3?\n{"domain": "Ingest"}\n+ a\n- b\n');
  t.after(d.cleanup);
  const qs = loadQuestions(d.questionsDir);
  const svc = createAttemptService({ store: openStore(d.dataDir), questions: () => qs, config: testConfig(d), now: fakeClock().now });
  const a = svc.create('t1', 'exam');
  const right = id => [a.optOrder[id].indexOf(0)];          // „a” jest poprawne, szukamy jego pozycji
  svc.answer(a, { qid: 't1:1', answer: right('t1:1') });
  svc.answer(a, { qid: 't1:3', answer: right('t1:3') });
  svc.grade(a);
  const v = svc.view(a);
  assert.deepEqual(v.domains.map(x => [x.domain, x.ok, x.total, x.pct]), [['Ingest', 1, 1, 100], ['Govern', 1, 2, 50]]);
  assert.equal(v.review[1].domain, 'Govern');
  assert.equal('domains' in svc.view(svc.create('t1', 'exam')), false, 'w trakcie podejścia nie ma wyniku per domena');
});
