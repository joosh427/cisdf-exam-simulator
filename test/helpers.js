'use strict';
// Wspólne narzędzia testów: tymczasowe katalogi, przykładowy arkusz, sterowany zegar.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SAMPLE = `# exam: Test
# description: arkusz testowy
Single question?
+ Right
- Wrong
> because

Multi question? (Choose 2)
+ A
- B
+ C

Match them.
{"type": "matching", "comment": "uwaga"}
+ L1 == R1
+ L2 == R2
`;

/** Tworzy katalog z pytaniami (cis_df_t1.md) i pusty katalog danych. */
function tmpDirs(text = SAMPLE) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cisdf-test-'));
  const questionsDir = path.join(base, 'questions');
  const dataDir = path.join(base, 'data');
  fs.mkdirSync(questionsDir);
  fs.writeFileSync(path.join(questionsDir, 'cis_df_t1.md'), text);
  return { base, questionsDir, dataDir, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

/** Zegar, który przesuwamy ręcznie: clock.now(), clock.advance(ms). */
function fakeClock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: ms => { t += ms; } };
}

/** Konfiguracja testowa (krótki egzamin, próg 80%). */
function testConfig(dirs, extra = {}) {
  return Object.assign({
    root: path.join(__dirname, '..'), questionsDir: dirs.questionsDir, dataDir: dirs.dataDir,
    port: 0, host: '127.0.0.1', password: 'tajne', durationMin: 10, passPct: 80, graceMs: 30000,
  }, extra);
}

module.exports = { SAMPLE, tmpDirs, fakeClock, testConfig };
