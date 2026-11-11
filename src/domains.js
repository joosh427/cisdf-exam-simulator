'use strict';
/**
 * Domeny egzaminu CIS-DF (blueprint ServiceNow) z wagami — do wyniku per domena,
 * takiego jak w raporcie po prawdziwym egzaminie.
 *
 * Domenę pytania podaje się na dwa sposoby (pierwszy wygrywa):
 *  1. parametr pytania w pliku .md:  {"domain": "Ingest"}
 *  2. plik questions/domains.json:   {"final-03:12": "Ingest", "<klucz treści>": "Govern", ...}
 *     (klucz = id pytania „arkusz:numer” albo 12-znakowy skrót treści `key`)
 * Pytania bez domeny trafiają do grupy „Bez domeny”.
 */
const fs = require('fs');
const path = require('path');

/** @type {{name: string, weight: number}[]} kolejność jak w raporcie egzaminu */
const DOMAINS = [
  { name: 'Configuration', weight: 15 },
  { name: 'Ingest', weight: 19 },
  { name: 'Govern', weight: 35 },
  { name: 'Insight', weight: 20 },
  { name: 'CSDM Fundamentals', weight: 11 },
];
const NONE = 'Bez domeny';

/** Ujednolica nazwę: „csdm” → „CSDM Fundamentals”, wielkość liter jak w blueprincie. */
function normalize(name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  if (n === 'csdm' || n.startsWith('csdm ')) return 'CSDM Fundamentals';
  const d = DOMAINS.find(x => x.name.toLowerCase() === n);
  return d ? d.name : String(name).trim();
}

/** Wczytuje questions/domains.json (jeśli jest). */
function loadDomainMap(dir) {
  const f = path.join(dir, 'domains.json');
  if (!fs.existsSync(f)) return {};
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { console.warn('Zły domains.json:', e.message); return {}; }
}

/**
 * Wynik per domena dla ocenionego podejścia.
 * @param {{qid: string, ok: boolean}[]} detail
 * @param {(qid: string) => string|null} domainOf
 * @returns {{domain: string, weight: number|null, ok: number, total: number, pct: number}[]}
 */
function breakdown(detail, domainOf) {
  const acc = {};
  for (const d of detail) {
    const name = domainOf(d.qid) || NONE;
    const s = acc[name] || (acc[name] = { ok: 0, total: 0 });
    s.total++; if (d.ok) s.ok++;
  }
  const order = DOMAINS.map(d => d.name).concat(Object.keys(acc).filter(n => !DOMAINS.some(d => d.name === n)));
  return order.filter(n => acc[n]).map(n => {
    const d = DOMAINS.find(x => x.name === n);
    return { domain: n, weight: d ? d.weight : null, ok: acc[n].ok, total: acc[n].total, pct: Math.round(100 * acc[n].ok / acc[n].total) };
  });
}

module.exports = { DOMAINS, NONE, normalize, loadDomainMap, breakdown };
