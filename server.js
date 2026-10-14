'use strict';
// CIS-DF Exam Simulator — punkt wejścia. Node.js >= 18, bez zależności zewnętrznych.
// Konfiguracja: zmienne środowiskowe (patrz .env.example), opis warstw: README.md.
const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');

const config = loadConfig(process.env);
let app;
try { app = createApp(config); }
catch (e) { console.error(e.message); process.exit(1); }

const { server } = app;
server.on('error', e => {
  if (e.code === 'EAFNOSUPPORT' && config.host === '::') {
    console.warn('Brak IPv6 — nasłuch na 0.0.0.0');
    server.listen(config.port, '0.0.0.0');
  } else { console.error(e); process.exit(1); }
});
server.on('listening', () => console.log('CIS-DF simulator nasłuchuje na', server.address()));
server.listen(config.port, config.host);
