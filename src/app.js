'use strict';
/**
 * Składanie aplikacji z warstw (kompozycja zależności):
 *
 *   config ─┬─> questions (pliki .md) ─┐
 *           ├─> store (db.json) ───────┼─> attempts (logika) ─┐
 *           └─> auth (hasło, cookie) ──┴──────────────────────┴─> http (routing)
 *
 * Zwraca gotowy serwer HTTP (jeszcze nie nasłuchuje) — dzięki temu testy mogą
 * uruchomić aplikację na losowym porcie z tymczasowym katalogiem danych.
 */
const { loadQuestions } = require('./questions');
const { openStore } = require('./store');
const { createAttemptService } = require('./attempts');
const { createAuth, loadSecret } = require('./auth');
const { createHandler, createServer } = require('./http');

/**
 * @param {import('./config').Config} config
 * @param {{now?: () => number, log?: (...a: any[]) => void}} [opts]
 */
function createApp(config, { now = Date.now, log = console.log } = {}) {
  if (!config.password) throw new Error('Brak APP_PASSWORD — ustaw hasło w .env');

  let questions = loadQuestions(config.questionsDir);
  const count = () => Object.keys(questions.index).length;
  log('Wczytano', Object.keys(questions.exams).length, 'arkuszy,', count(), 'pytań');
  const reloadQuestions = () => { questions = loadQuestions(config.questionsDir); return { questions: count() }; };

  const store = openStore(config.dataDir);
  const attempts = createAttemptService({ store, questions: () => questions, config, now });
  const auth = createAuth({ password: config.password, secret: loadSecret(config.dataDir), now });
  const server = createServer(createHandler({ config, auth, attempts, reloadQuestions }));

  return { server, attempts, store };
}

module.exports = { createApp };
