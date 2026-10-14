'use strict';
/**
 * Konfiguracja aplikacji ze zmiennych środowiskowych.
 * Wszystkie wartości mają rozsądne domyślne — wymagane jest tylko APP_PASSWORD.
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');

/**
 * @typedef {object} Config
 * @property {string} root          katalog aplikacji (tam leży public/)
 * @property {string} questionsDir  katalog z arkuszami *.md (+ img/)
 * @property {string} dataDir       katalog z db.json i sekretem ciasteczek
 * @property {number} port
 * @property {string} host
 * @property {string} password      hasło logowania
 * @property {number} durationMin   czas na jedno podejście (minuty)
 * @property {number} passPct       próg zaliczenia w %
 * @property {number} graceMs       tolerancja po upływie czasu (opóźnienia sieci)
 */

/**
 * Buduje konfigurację z obiektu zmiennych środowiskowych.
 * @param {NodeJS.ProcessEnv} env
 * @returns {Config}
 */
function loadConfig(env = process.env) {
  return {
    root: ROOT,
    questionsDir: env.QUESTIONS_DIR || path.join(ROOT, 'questions'),
    dataDir: env.DATA_DIR || path.join(ROOT, 'data'),
    port: parseInt(env.PORT || '3000', 10),
    host: env.HOST || '::',
    password: env.APP_PASSWORD || '',
    durationMin: parseFloat(env.DURATION_MIN || '90'),
    passPct: parseFloat(env.PASS_PCT || '80'),
    graceMs: 30 * 1000,
  };
}

module.exports = { loadConfig };
