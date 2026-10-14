'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseExam, toQuestion, loadQuestions } = require('../src/questions');
const { SAMPLE, tmpDirs } = require('./helpers');

test('parseExam: konfiguracja i liczba pytań', () => {
  const { cfg, qs } = parseExam(SAMPLE);
  assert.equal(cfg.exam, 'Test');
  assert.equal(cfg.description, 'arkusz testowy');
  assert.equal(qs.length, 3);
});

test('parseExam: odpowiedzi, wyjaśnienie i parametry JSON trafiają do właściwego pytania', () => {
  const { qs } = parseExam(SAMPLE);
  assert.deepEqual(qs[0].answers, [{ ok: true, name: 'Right' }, { ok: false, name: 'Wrong' }]);
  assert.deepEqual(qs[0].expl, ['because']);
  assert.deepEqual(qs[0].params, {});
  assert.equal(qs[2].params.type, 'matching');
  assert.equal(qs[2].params.comment, 'uwaga');
});

test('parseExam: wielolinijkowa treść, linie @ ignorowane, "[most voted]" usuwane', () => {
  const { qs } = parseExam('Line one\nLine two\n@ ignore\n+ Yes [Most Voted]\n- No\n');
  assert.deepEqual(qs[0].text, ['Line one', 'Line two']);
  assert.equal(qs[0].answers[0].name, 'Yes');
});

test('parseExam: wielolinijkowy JSON parametrów', () => {
  const { qs } = parseExam('Q?\n{"type":\n"matching"}\n+ a == b\n');
  assert.equal(qs[0].params.type, 'matching');
});

test('parseExam: pytanie bez odpowiedzi jest pomijane', () => {
  const { qs } = parseExam('Orphan text\n');
  assert.equal(qs.length, 0);
});

test('toQuestion: typy single / multi / matching', () => {
  const { qs } = parseExam(SAMPLE);
  const [s, m, x] = qs.map((q, i) => toQuestion(q, 't1', i));
  assert.equal(s.type, 'single'); assert.deepEqual(s.correct, [0]); assert.equal(s.qid, 't1:1');
  assert.equal(m.type, 'multi'); assert.deepEqual(m.correct, [0, 2]);
  assert.equal(x.type, 'matching'); assert.deepEqual(x.pairs, [['L1', 'R1'], ['L2', 'R2']]);
});

test('toQuestion: matching rozpoznawany po "==" nawet bez JSON', () => {
  const { qs } = parseExam('Q?\n+ a == b\n+ c == d\n');
  assert.equal(toQuestion(qs[0], 'x', 0).type, 'matching');
});

test('toQuestion: klucz treści stały i zależny od treści', () => {
  const { qs } = parseExam(SAMPLE);
  assert.equal(toQuestion(qs[0], 'a', 0).key, toQuestion(qs[0], 'b', 5).key);
  assert.notEqual(toQuestion(qs[0], 'a', 0).key, toQuestion(qs[1], 'a', 1).key);
});

test('loadQuestions: id arkusza bez prefiksu cis_df_, indeks po qid', () => {
  const d = tmpDirs();
  try {
    const { exams, index } = loadQuestions(d.questionsDir);
    assert.deepEqual(Object.keys(exams), ['t1']);
    assert.equal(exams.t1.title, 'Test');
    assert.deepEqual(Object.keys(index), ['t1:1', 't1:2', 't1:3']);
  } finally { d.cleanup(); }
});
