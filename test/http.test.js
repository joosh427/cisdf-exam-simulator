'use strict';
// Test end-to-end: prawdziwy serwer HTTP na losowym porcie, prawdziwe żądania fetch.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { tmpDirs, testConfig } = require('./helpers');

async function startApp(t) {
  const dirs = tmpDirs();
  const { server } = createApp(testConfig(dirs), { log: () => {} });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.close(); dirs.cleanup(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(base + p, {
      method, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, type, body: type.includes('json') ? await res.json() : await res.text() };
  };
  return { call };
}

test('strona i pliki frontu są dostępne bez logowania', async t => {
  const { call } = await startApp(t);
  const idx = await call('GET', '/');
  assert.equal(idx.status, 200); assert.match(idx.body, /<script src="app.js">/);
  assert.match((await call('GET', '/app.js')).type, /javascript/);
  assert.match((await call('GET', '/style.css')).type, /css/);
});

test('API wymaga logowania; złe hasło = 401, dobre ustawia sesję', async t => {
  const { call } = await startApp(t);
  assert.equal((await call('GET', '/api/home')).status, 401);
  assert.equal((await call('POST', '/api/login', { password: 'zle' })).status, 401);
  assert.equal((await call('POST', '/api/login', { password: 'tajne' })).status, 200);
  const home = await call('GET', '/api/home');
  assert.equal(home.status, 200);
  assert.equal(home.body.exams[0].id, 't1');
  await call('POST', '/api/logout');
  assert.equal((await call('GET', '/api/home')).status, 401);
});

test('pełny przebieg: nauka (check, blokada, reset) i egzamin (submit, przegląd)', async t => {
  const { call } = await startApp(t);
  await call('POST', '/api/login', { password: 'tajne' });

  const { body: { id } } = await call('POST', '/api/attempts', { exam: 't1', mode: 'learn' });
  const chk = await call('POST', `/api/attempts/${id}/check`, { qid: 't1:1', answer: [0] });
  assert.deepEqual([chk.status, chk.body.ok], [200, true]);
  assert.equal((await call('POST', `/api/attempts/${id}/answer`, { qid: 't1:1', answer: [1] })).status, 409);
  assert.equal((await call('POST', `/api/attempts/${id}/reset`)).status, 200);
  assert.deepEqual((await call('GET', `/api/attempts/${id}`)).body.answers, {});

  const ex = (await call('POST', '/api/attempts', { exam: 't1', mode: 'exam' })).body.id;
  assert.equal((await call('POST', `/api/attempts/${ex}/check`, { qid: 't1:1', answer: [0] })).status, 403);
  await call('POST', `/api/attempts/${ex}/answer`, { qid: 't1:1', answer: [0] });
  const done = await call('POST', `/api/attempts/${ex}/submit`);
  assert.equal(done.body.score, 1);
  assert.equal(done.body.review.length, 3);
  assert.equal((await call('GET', '/api/stats')).body.pendingErrors, 2);

  assert.equal((await call('POST', `/api/attempts/${ex}/delete`)).status, 200);
  assert.equal((await call('GET', `/api/attempts/${ex}`)).status, 404);
});

test('błędne żądania: nieznany arkusz, zły JSON, nieznana ścieżka', async t => {
  const { call } = await startApp(t);
  await call('POST', '/api/login', { password: 'tajne' });
  assert.equal((await call('POST', '/api/attempts', { exam: 'brak' })).status, 400);
  assert.equal((await call('POST', '/api/attempts', '{zły json')).status, 400);
  assert.equal((await call('GET', '/api/nic')).status, 404);
  assert.equal((await call('GET', '/api/attempts/0123456789abcdef')).status, 404);
});

test('reload: ponownie wczytuje pytania', async t => {
  const { call } = await startApp(t);
  await call('POST', '/api/login', { password: 'tajne' });
  assert.deepEqual((await call('POST', '/api/reload')).body, { ok: true, questions: 3 });
});
