'use strict';
/**
 * Warstwa oceny — czyste funkcje bez stanu (łatwe do testowania).
 * Zasada egzaminu: pytanie liczy się tylko przy w pełni poprawnej odpowiedzi.
 */

/**
 * Odpowiedź użytkownika:
 *  - single/multi: tablica indeksów opcji, np. [0, 2]
 *  - matching: tablica prawych stron w kolejności lewych, np. ["B", "A"]
 * @typedef {number[]|string[]|null|undefined} Answer
 */

/**
 * Pytanie w kolejności odpowiedzi wylosowanej dla danego podejścia.
 * attempt.optOrder[qid] = permutacja: na pozycji i wyświetlana jest oryginalna opcja optOrder[i].
 * Odpowiedzi użytkownika i klucz zwracany do przeglądarki są w tej (wyświetlanej) kolejności.
 * Podejścia sprzed wprowadzenia losowania (bez optOrder) dostają pytanie bez zmian.
 * @param {import('./questions').Question} q
 * @param {{optOrder?: Object<string,number[]>}} attempt
 * @returns {import('./questions').Question}
 */
function localize(q, attempt) {
  const order = q && q.type !== 'matching' && attempt.optOrder && attempt.optOrder[q.qid];
  if (!order) return q;
  return Object.assign({}, q, {
    options: order.map(j => q.options[j]),
    correct: q.correct.map(c => order.indexOf(c)).sort((x, y) => x - y),
  });
}

/**
 * Czy odpowiedź jest w pełni poprawna.
 * @param {import('./questions').Question} q
 * @param {Answer} ans
 * @returns {boolean}
 */
function isCorrect(q, ans) {
  if (ans == null) return false;
  if (q.type === 'matching') return Array.isArray(ans) && q.pairs.every((p, i) => ans[i] === p[1]);
  if (!Array.isArray(ans)) return false;
  const s = [...new Set(ans)].sort((a, b) => a - b);
  return s.length === q.correct.length && s.every((v, i) => v === q.correct[i]);
}

/**
 * Informacja zwrotna po zatwierdzeniu (tryb nauki) — wynik + poprawny klucz + wyjaśnienie.
 * @param {import('./questions').Question} q
 * @param {Answer} ans
 */
function feedback(q, ans) {
  const f = { ok: isCorrect(q, ans), expl: q.expl, comment: q.comment };
  if (q.type === 'matching') f.correctPairs = q.pairs.map(p => p[1]);
  else f.correct = q.correct;
  return f;
}

/**
 * Wersja pytania wysyłana do przeglądarki W TRAKCIE podejścia — bez klucza odpowiedzi.
 * Dla matchingu prawe strony podawane są w kolejności wylosowanej dla danego podejścia.
 * @param {import('./questions').Question} q
 * @param {{rightOrder: Object<string,string[]>}} attempt
 */
function publicQuestion(q, attempt) {
  const o = { qid: q.qid, src: q.exam + ':' + q.n, type: q.type, stem: q.stem };
  if (q.type === 'matching') { o.left = q.pairs.map(p => p[0]); o.right = attempt.rightOrder[q.qid]; }
  else { o.options = q.options; o.choose = q.correct.length; }
  return o;
}

module.exports = { localize, isCorrect, feedback, publicQuestion };
