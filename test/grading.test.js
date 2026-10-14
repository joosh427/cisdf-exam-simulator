'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isCorrect, feedback, publicQuestion } = require('../src/grading');

const single = { qid: 'e:1', exam: 'e', n: 1, stem: 'S', type: 'single', options: ['a', 'b'], correct: [1], expl: 'x', comment: '' };
const multi = { qid: 'e:2', exam: 'e', n: 2, stem: 'M', type: 'multi', options: ['a', 'b', 'c'], correct: [0, 2], expl: '', comment: '' };
const match = { qid: 'e:3', exam: 'e', n: 3, stem: 'X', type: 'matching', pairs: [['L1', 'R1'], ['L2', 'R2']], expl: '', comment: '' };

test('isCorrect: brak odpowiedzi = źle', () => {
  assert.equal(isCorrect(single, null), false);
  assert.equal(isCorrect(single, undefined), false);
  assert.equal(isCorrect(single, 'nie-tablica'), false);
});

test('isCorrect: single', () => {
  assert.equal(isCorrect(single, [1]), true);
  assert.equal(isCorrect(single, [0]), false);
});

test('isCorrect: multi wymaga dokładnie kompletu (kolejność i duplikaty bez znaczenia)', () => {
  assert.equal(isCorrect(multi, [2, 0]), true);
  assert.equal(isCorrect(multi, [0, 0, 2]), true);
  assert.equal(isCorrect(multi, [0]), false);
  assert.equal(isCorrect(multi, [0, 1, 2]), false);
});

test('isCorrect: matching po kolei lewych stron', () => {
  assert.equal(isCorrect(match, ['R1', 'R2']), true);
  assert.equal(isCorrect(match, ['R2', 'R1']), false);
  assert.equal(isCorrect(match, ['R1']), false);
});

test('feedback: wynik + klucz + wyjaśnienie', () => {
  assert.deepEqual(feedback(single, [0]), { ok: false, expl: 'x', comment: '', correct: [1] });
  assert.deepEqual(feedback(match, ['R1', 'R2']).correctPairs, ['R1', 'R2']);
});

test('publicQuestion: nie zdradza klucza', () => {
  const p = publicQuestion(multi, { rightOrder: {} });
  assert.equal(p.choose, 2);
  assert.equal('correct' in p, false);
  assert.equal(p.src, 'e:2');
  const pm = publicQuestion(match, { rightOrder: { 'e:3': ['R2', 'R1'] } });
  assert.deepEqual(pm.left, ['L1', 'L2']);
  assert.deepEqual(pm.right, ['R2', 'R1']);
  assert.equal('pairs' in pm, false);
});
