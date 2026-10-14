'use strict';
/**
 * Warstwa pytań: parser formatu LearnWise i wczytywanie arkuszy z katalogu.
 *
 * Format pliku .md:
 *   # exam: Nazwa            ← konfiguracja arkusza
 *   Treść pytania            ← jedna lub więcej linii
 *   {"type": "matching"}     ← opcjonalne parametry pytania (JSON)
 *   + poprawna / - błędna    ← odpowiedzi; matching: "+ lewa == prawa"
 *   > wyjaśnienie            ← pokazywane po ocenie
 *   @ ...                    ← ignorowane (dodatkowe opcje LearnWise)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * @typedef {object} RawQuestion
 * @property {string[]} text
 * @property {{ok: boolean, name: string}[]} answers
 * @property {object} params
 * @property {string[]} expl
 */

/**
 * Parsuje tekst jednego arkusza. Nowe pytanie zaczyna się od linii treści
 * po odpowiedziach poprzedniego (puste linie są ignorowane).
 * @param {string} text
 * @returns {{cfg: Object<string,string>, qs: RawQuestion[]}}
 */
function parseExam(text) {
  const cfg = {};
  const qs = [];
  let q = null, params = '', inParams = false;
  const newQ = () => ({ text: [], answers: [], params: {}, expl: [] });
  const flush = () => { if (q && q.answers.length) qs.push(q); q = null; };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    // parametry JSON (mogą zajmować kilka linii)
    if (inParams || line[0] === '{') {
      params += line; inParams = true;
      if (line.endsWith('}')) {
        try { Object.assign((q || (q = newQ())).params, JSON.parse(params)); }
        catch (e) { console.warn('Zły JSON parametrów:', params); }
        params = ''; inParams = false;
      }
      continue;
    }

    const c = line[0];
    if (c === '#') {                       // # klucz: wartość
      const i = line.indexOf(':');
      if (i > 0) cfg[line.slice(1, i).trim()] = line.slice(i + 1).trim();
      continue;
    }
    if (c === '+' || c === '-') {          // odpowiedź
      if (!q) continue;
      q.answers.push({ ok: c === '+', name: line.slice(1).trim().replace(/\s*\[most voted\]\s*/gi, ' ').trim() });
      continue;
    }
    if (c === '>') { (q || (q = newQ())).expl.push(line.slice(1).trim()); continue; }
    if (c === '@') continue;

    // linia treści: po odpowiedziach oznacza początek nowego pytania
    if (!q || q.answers.length) { flush(); q = newQ(); }
    q.text.push(line);
  }
  flush();
  return { cfg, qs };
}

/**
 * @typedef {object} Question
 * @property {string} qid      identyfikator "arkusz:numer" (numeracja od 1)
 * @property {string} exam     id arkusza
 * @property {number} n        numer w arkuszu
 * @property {string} stem     treść
 * @property {string} expl     wyjaśnienie
 * @property {string} comment  dodatkowa uwaga z parametrów
 * @property {string} key      skrót treści — wiąże statystyki z pytaniem niezależnie od numeracji
 * @property {'single'|'multi'|'matching'} type
 * @property {string[]} [options]   (single/multi)
 * @property {number[]} [correct]   indeksy poprawnych (single/multi)
 * @property {[string,string][]} [pairs] pary lewa→prawa (matching)
 */

/**
 * Zamienia surowe pytanie na model aplikacji.
 * @param {RawQuestion} q
 * @param {string} examId
 * @param {number} i indeks od 0
 * @returns {Question}
 */
function toQuestion(q, examId, i) {
  const stem = q.text.join('\n');
  const matching = q.params.type === 'matching' || q.answers.some(a => a.ok && a.name.includes('=='));
  const base = {
    qid: examId + ':' + (i + 1), exam: examId, n: i + 1, stem,
    expl: q.expl.join('\n'), comment: q.params.comment || '',
    key: crypto.createHash('sha1')
      .update(stem + '\n' + q.answers.map(a => (a.ok ? '+' : '-') + a.name).join('\n'))
      .digest('hex').slice(0, 12),
  };
  if (matching) {
    const pairs = q.answers.filter(a => a.ok).map(a => {
      const k = a.name.indexOf('==');
      return [a.name.slice(0, k).trim(), a.name.slice(k + 2).trim()];
    });
    return Object.assign(base, { type: 'matching', pairs });
  }
  const correct = q.answers.map((a, j) => (a.ok ? j : -1)).filter(j => j >= 0);
  return Object.assign(base, { type: correct.length > 1 ? 'multi' : 'single', options: q.answers.map(a => a.name), correct });
}

/**
 * @typedef {object} Exam
 * @property {string} id
 * @property {string} file
 * @property {string} title
 * @property {string} desc
 * @property {Question[]} questions
 */

/**
 * Wczytuje wszystkie arkusze *.md z katalogu.
 * Id arkusza = nazwa pliku bez rozszerzenia i bez prefiksu "cis_df_".
 * @param {string} dir
 * @returns {{exams: Object<string,Exam>, index: Object<string,Question>}}
 */
function loadQuestions(dir) {
  const exams = {}, index = {};
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
  for (const f of files) {
    const id = f.replace(/^cis_df_/, '').replace(/\.md$/, '');
    const { cfg, qs } = parseExam(fs.readFileSync(path.join(dir, f), 'utf8'));
    const questions = qs.map((q, i) => toQuestion(q, id, i));
    exams[id] = { id, file: f, title: cfg.exam || id, desc: cfg.description || '', questions };
    questions.forEach(q => { index[q.qid] = q; });
  }
  return { exams, index };
}

module.exports = { parseExam, toQuestion, loadQuestions };
