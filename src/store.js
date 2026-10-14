'use strict';
/**
 * Warstwa danych: cała baza to jeden plik JSON (data/db.json) trzymany w pamięci.
 * Zapis jest atomowy (plik tymczasowy + rename), więc awaria w trakcie zapisu nie psuje bazy.
 */
const fs = require('fs');
const path = require('path');

/**
 * @typedef {object} Attempt
 * @property {string} id
 * @property {string} exam        id arkusza albo "__errors__"
 * @property {string} title
 * @property {'learn'|'exam'} mode
 * @property {number} started     ms
 * @property {number} deadline    ms
 * @property {string[]} qids
 * @property {Object<string,*>} answers
 * @property {Object<string,boolean>} flags    pytania oznaczone ★
 * @property {Object<string,boolean>} checked  pytania zatwierdzone (tryb nauki)
 * @property {Object<string,string[]>} rightOrder  wylosowana kolejność prawych stron matchingu
 * @property {number|null} submitted
 * @property {{qid:string,key:string,ok:boolean}[]} [detail]  wynik per pytanie (po ocenie)
 * @property {number} [score] @property {number} [total] @property {number} [pct] @property {boolean} [passed]
 */

/**
 * Otwiera (lub tworzy) bazę w podanym katalogu.
 * @param {string} dataDir
 * @returns {{db: {attempts: Attempt[]}, save: () => void}}
 */
function openStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'db.json');
  const db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { attempts: [] };
  function save() {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, file);
  }
  return { db, save };
}

module.exports = { openStore };
