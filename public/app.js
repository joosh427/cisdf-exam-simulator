/* CIS-DF Exam Simulator — logika interfejsu (SPA bez frameworka).
   Komunikuje się z serwerem wyłącznie przez /api/* (JSON). */
// ---------- pomocnicze: DOM, formatowanie, tempo (72 s/pytanie = 60 pytań w 72 min) ----------
const $ = s => document.querySelector(s);
const app = $('#app'), hdr = $('#hdr');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stemHtml = s => esc(s).replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => '<img alt="' + alt + '" src="' + src.replace(/^.*img\//, '/img/') + '">');
const fmtDate = t => new Date(t).toLocaleString('pl-PL', {dateStyle:'short', timeStyle:'short'});
const PACE_S = 72;
const perQ = (ms, n) => n ? fmtTime(ms / n) : '—';
const paceTag = (ms, n) => { if (!n) return ''; const s = ms / n / 1000; return `<span class="pill ${s <= PACE_S ? 'ok' : 'bad'}">${s <= PACE_S ? 'w tempie' : 'za wolno'}</span>`; };
const fmtTime = ms => { const s = Math.max(0, Math.round(ms/1000)); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60; return (h? h+':' : '') + String(m).padStart(h?2:1,'0') + ':' + String(x).padStart(2,'0'); };
let timerInt = null;

// ---------- komunikacja z serwerem: 401 → ekran logowania ----------
async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/api/login') { showLogin(); throw new Error('auth'); }
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
// ---------- routing po #hash: #/ (start), #/a/<id> (podejście), #/errors (statystyki) ----------
function go(h) { location.hash = h; }
window.addEventListener('hashchange', route);

function route() {
  clearInterval(timerInt); hdr.innerHTML = '';
  const h = location.hash.slice(1);
  if (h.startsWith('a/')) return showAttempt(h.slice(2)).catch(e => { if (e.message !== 'auth') app.innerHTML = '<div class="card">Błąd: ' + esc(e.message) + '</div>'; });
  const p = h === 'errors' ? showErrors() : showHome();
  p.catch(e => { if (e.message !== 'auth') app.innerHTML = '<div class="card">Błąd: ' + esc(e.message) + '</div>'; });
}

// ---------- ekrany ----------
function showLogin() {
  clearInterval(timerInt); hdr.innerHTML = '';
  app.innerHTML = `<div class="card" style="max-width:360px;margin:60px auto"><h2 style="margin-top:0">Logowanie</h2>
  <form id="lf"><input type="password" id="pw" placeholder="Hasło" autofocus><p id="le" class="mut"></p><button class="primary" style="width:100%">Wejdź</button></form></div>`;
  $('#lf').onsubmit = async e => { e.preventDefault(); try { await api('/api/login', {password: $('#pw').value}); route(); } catch (err) { $('#le').textContent = err.message; } };
}

async function showHome() {
  const d = await api('/api/home');
  hdr.innerHTML = `<button id="lo">Wyloguj</button>`;
  $('#lo').onclick = async () => { await api('/api/logout', {}); showLogin(); };
  const running = d.attempts.filter(a => !a.submitted);
  app.innerHTML = `
  ${running.length ? `<div class="card"><h3 style="margin-top:0">Trwające egzaminy</h3>${running.map(a => `<div class="row" style="margin:4px 0"><span class="pill run">w toku</span><b>${esc(a.title)}</b><span class="mut">zostało ${fmtTime(a.deadline - Date.now())} · odpowiedzi ${a.answered}/${a.total}</span><span class="spacer"></span><button class="primary" onclick="go('a/${a.id}')">Wróć</button></div>`).join('')}</div>` : ''}
  <div class="card"><div class="row"><div><h3 style="margin:0">Wybierz arkusz</h3><div class="mut">${d.durationMin} minut na egzamin · zaliczenie od ${d.passPct}% · liczy się tylko pełna poprawna odpowiedź</div></div><span class="spacer"></span>
  <button onclick="go('errors')">Moje błędy (${d.pendingErrors})</button>
  <button ${d.pendingErrors ? '' : 'disabled'} class="learn" onclick="start('__errors__','learn')">Błędy — nauka</button>
  <button ${d.pendingErrors ? '' : 'disabled'} class="primary" onclick="start('__errors__','exam')">Błędy — egzamin</button></div>
  <p class="mut" style="margin:8px 0 0"><b>Nauka</b>: zaznaczasz, klikasz <b>Zatwierdź</b> i widzisz, czy dobrze (zielone/czerwone) + wyjaśnienie. <b>Egzamin</b>: jak na prawdziwym egzaminie, wynik dopiero na końcu.</p></div>
  <div class="grid">${d.exams.map(e => `<div class="card exam"><h3>${esc(e.title)}</h3>
    <div class="mut">${e.count} pytań${e.matching ? ' · ' + e.matching + ' matching' : ''}</div>
    <div class="mut">${e.tries ? `podejść: ${e.tries} · najlepszy ${e.best}% · ostatni <span class="pill ${e.last >= d.passPct ? 'ok' : 'bad'}">${e.last}%</span>` : 'jeszcze nie podchodziłeś'}</div>
    <div class="btns"><button class="learn" onclick="start('${e.id}','learn')">Nauka</button><button class="primary" onclick="start('${e.id}','exam')">Egzamin</button></div></div>`).join('')}</div>
  <div class="card"><h3 style="margin-top:0">Historia</h3>${(() => { const f = d.attempts.filter(a => a.submitted && a.total); if (!f.length) return ''; const tot = f.reduce((x, a) => x + (a.submitted - a.started), 0), nq = f.reduce((x, a) => x + a.total, 0); return `<p class="mut">Średni czas egzaminu: <b>${fmtTime(tot / f.length)}</b> · średnio <b>${perQ(tot, nq)}</b> na pytanie (tempo egzaminu: ${fmtTime(PACE_S * 1000)} na pytanie, 75 pytań / 90 min)</p>`; })()}${d.attempts.filter(a => a.submitted).length ? `<table><tr><th>Data</th><th>Arkusz</th><th>Wynik</th><th>Czas</th><th>Śr./pytanie</th><th></th></tr>
  ${d.attempts.filter(a => a.submitted).map(a => `<tr><td>${fmtDate(a.started)}</td><td>${esc(a.title)}${a.mode === 'learn' ? ' <span class="tag">nauka</span>' : ''}</td><td><span class="pill ${a.passed ? 'ok' : 'bad'}">${a.score}/${a.total} · ${a.pct}%</span></td><td>${fmtTime(a.submitted - a.started)}</td><td>${perQ(a.submitted - a.started, a.total)} ${paceTag(a.submitted - a.started, a.total)}</td><td><a href="#a/${a.id}">przegląd</a></td></tr>`).join('')}</table>` : '<p class="mut">Brak zakończonych egzaminów.</p>'}</div>`;
}

async function start(exam, mode) {
  mode = mode || 'learn';
  if (!confirm((mode === 'learn' ? 'Tryb NAUKI — ocena po kliknięciu Zatwierdź przy każdym pytaniu.' : 'Tryb EGZAMINU — wynik dopiero na końcu.') + '\nRozpocząć? Licznik ruszy od razu.')) return;
  const {id} = await api('/api/attempts', {exam, mode}); go('a/' + id);
}

// Podejście w toku: nawigacja po pytaniach, Zatwierdź (nauka), ★, przegląd i zakończenie.
// Po zakończeniu przechodzi do wyniku (showResult).
async function showAttempt(id) {
  const a = await api('/api/attempts/' + id);
  if (a.submitted) return showResult(a);
  let cur = 0, fromReview = false;
  const qs = a.questions, ans = a.answers, flags = a.flags;
  const learn = a.mode === 'learn', checked = a.checked || {};
  const tally = () => { const v = Object.values(checked); return { ok: v.filter(x => x.ok).length, bad: v.filter(x => !x.ok).length }; };
  async function doCheck(q, answer) {
    try { const f = await api('/api/attempts/' + id + '/check', {qid: q.qid, answer}); checked[q.qid] = f; ans[q.qid] = answer; render(); }
    catch (e) { if (/Czas|zakończony/.test(e.message)) { clearInterval(timerInt); showAttempt(id); } else alert('Nie sprawdzono: ' + e.message); }
  }
  const end = Date.now() + a.remainingMs;
  const start0 = end - (a.deadline - a.started);
  hdr.innerHTML = `<span class="mut">${esc(a.title)}${learn ? ' · <b>nauka</b>' : ''}</span><span class="mut" id="sc"></span><span class="mut" id="el"></span><span class="timer" id="tm"></span>${learn ? '<button id="rst" title="Wyczyść wszystkie odpowiedzi i zacznij od pytania 1 (licznik czasu od nowa)">↺ Od początku</button>' : ''}<button class="primary" id="sub">Przegląd i zakończenie</button>`;
  const tick = () => { const left = end - Date.now(); const t = $('#tm'); if (!t) return; t.textContent = fmtTime(left); t.classList.toggle('low', left < 5*60000); const el = $('#el'); if (el) { const n = qs.filter(answered).length; el.textContent = 'upłynęło ' + fmtTime(Date.now() - start0) + (n ? ' · śr. ' + perQ(Date.now() - start0, n) + '/pyt.' : ''); } if (left <= 0) { clearInterval(timerInt); finish(true); } };
  $('#sub').onclick = () => finish(false);
  if (learn) { let warn = false, wt = null; $('#rst').onclick = async () => {
    const b = $('#rst');
    if (!warn && Object.keys(ans).length) { warn = true; b.textContent = 'Na pewno? Kliknij jeszcze raz'; b.style.color = 'var(--bad)'; wt = setTimeout(() => { warn = false; b.textContent = '↺ Od początku'; b.style.color = ''; }, 4000); return; }
    clearTimeout(wt); clearInterval(timerInt);
    try { await api('/api/attempts/' + id + '/reset', {}); } catch (e) { alert('Nie udało się: ' + e.message); }
    showAttempt(id); }; }

  const finish = auto => auto ? submitNow(true) : renderReview();
  async function submitNow(auto) {
    clearInterval(timerInt);
    const r = await api('/api/attempts/' + id + '/submit', {});
    if (auto) alert('Czas minął — egzamin został zakończony automatycznie.');
    showResult(r);
  }
  const answered = q => { const v = ans[q.qid]; return q.type === 'matching' ? Array.isArray(v) && v.every(Boolean) && v.length === q.left.length : Array.isArray(v) && v.length > 0; };
  async function persist(q, body) {
    try { await api('/api/attempts/' + id + '/answer', Object.assign({qid: q.qid}, body)); }
    catch (e) { if (/Czas|zakończony/.test(e.message)) { clearInterval(timerInt); showAttempt(id); } else alert('Nie zapisano odpowiedzi: ' + e.message); }
  }

  function renderReview() {
    fromReview = false;
    const snip = t => { t = String(t).replace(/!\[[^\]]*\]\([^)]*\)/g, '[obrazek]').replace(/\s+/g, ' ').trim(); return t.length > 220 ? t.slice(0, 220) + '…' : t; };
    const un = [], fl = [];
    qs.forEach((q, i) => { if (!answered(q)) un.push(i); if (flags[q.qid]) fl.push(i); });
    const item = (i, kind) => { const q = qs[i], a = answered(q);
      return `<div class="rv" data-go="${i}"><span class="n">${i + 1}.</span><span class="s">${esc(snip(q.stem))}</span>${kind === 'un' ? '<span class="pill bad">bez odpowiedzi</span>' : `<span class="pill run">★ do sprawdzenia</span>${a ? '' : ' <span class="pill bad">bez odpowiedzi</span>'}`}</div>`; };
    const all = un.length + fl.length;
    app.innerHTML = `<div class="card" style="max-width:820px;margin:0 auto">
      <h2 style="margin:0">Przegląd przed zakończeniem</h2>
      <p class="mut" style="margin:4px 0 0">Kliknij pytanie, żeby do niego wrócić. Czas nadal leci.</p>
      <div class="legend">${learn ? '<span class="l-ok">dobrze</span><span class="l-bad">źle</span>' : '<span class="l-ans">z odpowiedzią</span>'}<span class="l-un">bez odpowiedzi</span><span>★ oznaczone</span></div>
      <div class="board">${qs.map((q, i) => { const c = checked[q.qid]; const cls = learn && c ? (c.ok ? 'b-ok' : 'b-bad') : (answered(q) ? 'b-ans' : 'b-un'); return `<button class="${cls}${flags[q.qid] ? ' b-fl' : ''}" data-go="${i}" title="${esc(snip(q.stem))}">${i + 1}</button>`; }).join('')}</div>
      <div class="sumtiles"><div><b>${qs.filter(answered).length}/${qs.length}</b><span class="mut">odpowiedzi${learn ? ` · ✓ ${tally().ok} ✗ ${tally().bad}` : ''}</span></div>
        <div style="${un.length ? 'border-color:var(--bad);background:var(--bad-weak)' : ''}"><b>${un.length}</b><span class="mut">bez odpowiedzi</span></div>
        <div style="${fl.length ? 'border-color:var(--warn);background:var(--warn-weak)' : ''}"><b>${fl.length}</b><span class="mut">oznaczone ★</span></div></div>
      ${un.length ? `<h3 style="margin:14px 0 4px">Bez odpowiedzi (${un.length})</h3>${un.map(i => item(i, 'un')).join('')}` : ''}
      ${fl.length ? `<h3 style="margin:14px 0 4px">Oznaczone do sprawdzenia (${fl.length})</h3>${fl.map(i => item(i, 'fl')).join('')}` : ''}
      ${all ? '' : '<p style="margin:14px 0">✓ Wszystkie pytania mają odpowiedź i nic nie jest oznaczone do sprawdzenia.</p>'}
      <div class="row" style="margin-top:16px"><button id="rvback">← Wróć do egzaminu</button><span class="spacer"></span>
      <button class="primary" id="rvsub">Zakończ egzamin i oceń${un.length ? ` (${un.length} bez odpowiedzi)` : ''}</button></div></div>`;
    app.querySelectorAll('[data-go]').forEach(el => el.onclick = () => { cur = +el.dataset.go; fromReview = true; render(); window.scrollTo(0, 0); });
    $('#rvback').onclick = () => render();
    $('#rvsub').onclick = () => submitNow(false);
    window.scrollTo(0, 0);
  }

  tick(); timerInt = setInterval(tick, 1000);
  function render() {
    const q = qs[cur], v = ans[q.qid];
    const sc = $('#sc'); if (sc) sc.textContent = learn ? '✓ ' + tally().ok + ' · ✗ ' + tally().bad : '';
    const fb = learn ? checked[q.qid] : null;
    let body = '';
    if (fb) {
      if (q.type === 'matching') {
        body = q.left.map((l, k) => { const y = v && v[k], c = fb.correctPairs[k];
          return `<div class="match"><div>${esc(l)}</div><div class="opt ${y === c ? 'r-ok' : 'r-bad'}" style="cursor:default">${y === c ? '✓ ' + esc(c) : '✗ ' + (y ? esc(y) : '<i>brak</i>') + '<br><b>→ ' + esc(c) + '</b>'}</div></div>`; }).join('');
      } else {
        body = q.options.map((o, j) => { const y = Array.isArray(v) && v.includes(j), c = fb.correct.includes(j);
          const cls = c ? (y ? 'r-ok' : 'r-miss') : (y ? 'r-bad' : '');
          return `<div class="opt ${cls}" style="cursor:default"><span>${c ? '✓' : (y ? '✗' : '·')}</span><span>${esc(o)}${y ? ' <span class="mut">(Twoja)</span>' : ''}</span></div>`; }).join('');
      }
      body += `<div class="fb ${fb.ok ? 'ok' : 'bad'}"><b>${fb.ok ? 'Dobrze.' : 'Źle.'}</b>${fb.expl ? ' ' + esc(fb.expl) : ''}${fb.comment ? '\nUwaga: ' + esc(fb.comment) : ''}</div>`;
    } else if (q.type === 'matching') {
      const L = k => String.fromCharCode(65 + k);
      body = `<p class="mut">Dopasuj do każdego elementu odpowiedź A–${L(q.right.length - 1)}.</p>`
        + q.right.map((r, k) => `<div class="opt" style="cursor:default"><b>${L(k)}.</b><span>${esc(r)}</span></div>`).join('')
        + '<div style="margin-top:12px">' + q.left.map((l, i) => `<div class="match"><div><b>${esc(l)}</b></div><select data-i="${i}"><option value="">— wybierz —</option>${q.right.map((r, k) => `<option value="${k}" ${v && v[i] === r ? 'selected' : ''}>${L(k)}. ${esc(r.length > 70 ? r.slice(0, 70) + '…' : r)}</option>`).join('')}</select></div>`).join('') + '</div>';
    } else {
      const multi = q.choose > 1;
      body = (multi ? `<p class="mut"><b>Wybierz ${q.choose} odpowiedzi.</b></p>` : '') + q.options.map((o, j) => { const on = Array.isArray(v) && v.includes(j);
        return `<label class="opt ${on ? 'sel' : ''}"><input type="${multi ? 'checkbox' : 'radio'}" name="o" value="${j}" ${on ? 'checked' : ''}><span>${esc(o)}</span></label>`; }).join('');
    }
    app.innerHTML = `<div class="card" style="max-width:820px;margin:0 auto">
      <div class="row"><b>Pytanie ${cur+1} / ${qs.length}</b><span class="mut">odpowiedzi ${qs.filter(answered).length}/${qs.length} · oznaczone ${Object.keys(flags).length}</span><span class="spacer"></span><span class="tag">${q.src}</span></div>
      <p class="stem">${stemHtml(q.stem)}</p>${body}
      <div class="row" style="margin-top:14px">${learn && !fb ? '<button class="primary" id="zat">Zatwierdź ✓</button>' : ''}
      <button id="fl">${flags[q.qid] ? '★ Oznaczone' : '☆ Oznacz do sprawdzenia'}</button><span id="zerr" style="color:var(--bad);font-size:13px"></span><span class="spacer"></span>
      ${fromReview ? '<button id="torv">↩ Wróć do przeglądu</button>' : ''}
      <button id="pv" ${cur ? '' : 'disabled'}>← Poprzednie</button>
      <button class="primary" id="nx">${cur < qs.length - 1 ? 'Następne →' : 'Przegląd i zakończenie'}</button></div></div>`;
    if (fromReview) $('#torv').onclick = () => renderReview();
    $('#pv').onclick = () => { cur--; render(); };
    $('#nx').onclick = () => { if (cur < qs.length - 1) { cur++; render(); window.scrollTo(0, 0); } else finish(false); };
    $('#fl').onclick = () => { if (flags[q.qid]) delete flags[q.qid]; else flags[q.qid] = true; persist(q, {flag: !!flags[q.qid]}); render(); };
    if (learn && !fb) $('#zat').onclick = () => {
      const e = $('#zerr');
      if (!answered(q)) { e.textContent = q.type === 'matching' ? 'Dopasuj wszystkie pozycje' : 'Zaznacz odpowiedź'; return; }
      if (q.type !== 'matching' && ans[q.qid].length !== q.choose) { e.textContent = 'Zaznacz dokładnie ' + q.choose; return; }
      doCheck(q, ans[q.qid]);
    };
    if (fb) return;
    if (q.type === 'matching') {
      app.querySelectorAll('select').forEach(s => s.onchange = () => {
        const arr = Array.isArray(ans[q.qid]) ? ans[q.qid].slice() : q.left.map(() => null);
        arr[+s.dataset.i] = s.value === '' ? null : q.right[+s.value]; ans[q.qid] = arr;
        persist(q, {answer: arr}); render(); });
    } else {
      app.querySelectorAll('input[name=o]').forEach(inp => inp.onchange = () => {
        const sel = [...app.querySelectorAll('input[name=o]:checked')].map(x => +x.value);
        if (sel.length) ans[q.qid] = sel; else delete ans[q.qid];
        persist(q, {answer: sel.length ? sel : null}); render(); });
    }
  }
  document.onkeydown = e => { if (!location.hash.startsWith('#a/') || e.target.tagName === 'SELECT' || !$('#nx')) return;
    if (e.key === 'ArrowRight' && cur < qs.length - 1) { cur++; render(); } if (e.key === 'ArrowLeft' && cur > 0) { cur--; render(); } };
  render();
}

// Wynik + przegląd odpowiedzi z kluczem.
function showResult(a) {
  document.onkeydown = null;
  hdr.innerHTML = `<button onclick="go('')">← Arkusze</button>`;
  if (location.hash !== '#a/' + a.id) history.replaceState(null, '', '#a/' + a.id);
  const bad = a.review.filter(q => !q.ok);
  app.innerHTML = `<div class="card"><div class="row"><div><div class="mut">${esc(a.title)} · ${fmtDate(a.started)} · czas <b>${fmtTime(a.submitted - a.started)}</b> z ${fmtTime(a.deadline - a.started)} · średnio ${perQ(a.submitted - a.started, a.total)} na pytanie ${paceTag(a.submitted - a.started, a.total)}</div>
    <p class="big" style="color:var(--${a.passed ? 'ok' : 'bad'})">${a.pct}%</p>
    <div><span class="pill ${a.passed ? 'ok' : 'bad'}">${a.passed ? 'ZALICZONE' : 'NIEZALICZONE'}</span> ${a.score}/${a.total} poprawnych · próg ${a.passPct}%</div></div>
    <span class="spacer"></span><label class="row"><input type="checkbox" id="onlybad" checked> tylko błędne (${bad.length})</label>
    <button onclick="start('${a.exam}')">Jeszcze raz</button></div>
    <div class="nav" style="grid-template-columns:repeat(auto-fill,minmax(36px,1fr));margin-top:12px">${a.review.map((q, i) => `<button class="${q.ok ? 'r-ok' : 'r-bad'}" onclick="document.getElementById('q${i}').scrollIntoView({behavior:'smooth'})">${i+1}</button>`).join('')}</div></div>
  <div id="rev">${a.review.map((q, i) => reviewCard(q, i)).join('')}</div>`;
  const apply = () => { const only = $('#onlybad').checked; app.querySelectorAll('[data-ok]').forEach(c => c.classList.toggle('hidden', only && c.dataset.ok === '1')); };
  $('#onlybad').onchange = apply; apply();
}

function reviewCard(q, i) {
  let body = '';
  if (q.type === 'matching') {
    body = q.left.map((l, k) => { const y = q.your && q.your[k], c = q.correctPairs[k];
      return `<div class="match"><div>${esc(l)}</div><div class="opt ${y === c ? 'r-ok' : 'r-bad'}" style="cursor:default">${y === c ? '✓ ' + esc(c) : '✗ ' + (y ? esc(y) : '<i>brak</i>') + '<br><b>→ ' + esc(c) + '</b>'}</div></div>`; }).join('');
  } else {
    body = q.options.map((o, j) => { const y = Array.isArray(q.your) && q.your.includes(j), c = q.correct.includes(j);
      const cls = c ? 'r-ok' : (y ? 'r-bad' : '');
      return `<div class="opt ${cls}" style="cursor:default"><span>${c ? '✓' : (y ? '✗' : '·')}</span><span>${esc(o)}${y ? ' <span class="mut">(Twoja)</span>' : ''}</span></div>`; }).join('');
  }
  return `<div class="card" id="q${i}" data-ok="${q.ok ? 1 : 0}"><div class="row"><b>${i+1}.</b><span class="pill ${q.ok ? 'ok' : 'bad'}">${q.ok ? 'dobrze' : (q.your == null ? 'brak odpowiedzi' : 'źle')}</span><span class="spacer"></span><span class="tag">${q.src}</span></div>
    <p class="stem">${stemHtml(q.stem)}</p>${body}
    ${q.expl ? `<div class="expl">${esc(q.expl)}</div>` : ''}${q.comment ? `<div class="expl">Uwaga: ${esc(q.comment)}</div>` : ''}</div>`;
}

// Statystyki błędów ze wszystkich podejść.
async function showErrors() {
  const s = await api('/api/stats');
  hdr.innerHTML = `<button onclick="go('')">← Arkusze</button>`;
  app.innerHTML = `<div class="card"><h3 style="margin-top:0">Moje błędy</h3><p class="mut">Pytania, które choć raz poszły źle. Na górze te, które ostatnio też były złe (${s.pendingErrors}) — trafiają do „Egzaminu z błędów”.</p></div>
  ${s.list.map(x => `<div class="card"><div class="row"><span class="pill ${x.last ? 'ok' : 'bad'}">${x.last ? 'ostatnio dobrze' : 'ostatnio źle'}</span><span class="mut">✓ ${x.ok} · ✗ ${x.bad}</span><span class="spacer"></span><span class="tag">${x.src}</span></div>
  <p class="stem">${stemHtml(x.stem)}</p><div class="expl">${x.correct.map(esc).join('<br>')}</div></div>`).join('') || '<div class="card mut">Brak błędów — jeszcze 😉</div>'}`;
}

route();
