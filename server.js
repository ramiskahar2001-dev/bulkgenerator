'use strict';
/* ==========================================================================
   RK Bulkfile Generator – Web-App mit Login
   Keine externen Abhängigkeiten: läuft mit „node server.js" (Node 18+).
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';   // auf 1 setzen, sobald die Seite über HTTPS läuft
const SESSION_HOURS = 8;
const MAX_FAILS = 5;                 // Fehlversuche …
const LOCK_MINUTES = 15;             // … danach Sperre
const GENERATOR_FILE = path.join(__dirname, 'public', 'generator.html');

/* ---------------- Benutzer (Passwörter nur als scrypt-Hash) ---------------- */
fs.mkdirSync(DATA_DIR, { recursive: true });

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function verifyPassword(pw, user) {
  const calc = crypto.scryptSync(pw, user.salt, 64);
  const ref = Buffer.from(user.hash, 'hex');
  return ref.length === calc.length && crypto.timingSafeEqual(calc, ref);
}
function saveUsers(list) {
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, USERS_FILE);
}
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    const { salt, hash } = hashPassword(process.env.ADMIN_PASSWORD || 'bulkgenerator');
    const list = [{ username: 'admin', role: 'admin', salt, hash, defaultPassword: !process.env.ADMIN_PASSWORD, created: new Date().toISOString() }];
    saveUsers(list);
    console.log('» Admin-Konto angelegt (Benutzer: admin)');
    return list;
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}
let users = loadUsers();
const findUser = name => users.find(u => u.username.toLowerCase() === String(name || '').toLowerCase());

/* ---------------- Sessions (im Speicher) ---------------- */
const sessions = new Map(); // token -> {username, csrf, expires}
function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, csrf: crypto.randomBytes(24).toString('hex'), expires: Date.now() + SESSION_HOURS * 3600e3 });
  return token;
}
function getSession(req) {
  const token = parseCookies(req).rk_sid;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) { sessions.delete(token); return null; }
  const user = findUser(s.username);
  if (!user) { sessions.delete(token); return null; }
  return { token, ...s, user };
}
function destroyUserSessions(username, exceptToken) {
  for (const [t, s] of sessions) if (s.username === username && t !== exceptToken) sessions.delete(t);
}
setInterval(() => { const now = Date.now(); for (const [t, s] of sessions) if (s.expires < now) sessions.delete(t); }, 10 * 60e3).unref();

/* ---------------- Schutz gegen Passwort-Raten ---------------- */
const fails = new Map(); // ip -> {count, until}
function isLocked(ip) { const f = fails.get(ip); return f && f.until && f.until > Date.now(); }
function registerFail(ip) {
  const f = fails.get(ip) || { count: 0, until: 0 };
  f.count++;
  if (f.count >= MAX_FAILS) { f.until = Date.now() + LOCK_MINUTES * 60e3; f.count = 0; }
  fails.set(ip, f);
}

/* ---------------- Hilfsfunktionen ---------------- */
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('='); if (i < 0) return;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function cookie(name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${COOKIE_SECURE ? '; Secure' : ''}`;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 20000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(data))));
    req.on('error', reject);
  });
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clientIp = req => (process.env.TRUST_PROXY === '1' && (req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...headers,
  });
  res.end(body);
}
const redirect = (res, to, headers = {}) => send(res, 303, '', { Location: to, ...headers });

/* ---------------- Seiten-Layout (Gold & Grau) ---------------- */
const CSS = `
:root{--bg:#0d0e11;--card:#161922;--card2:#1b1f2a;--border:#272c38;--text:#eef0f3;--muted:#9aa2b1;--muted2:#6b7280;
--gold:#c9a24b;--gold2:#e4c877;--ink:#1a1405;--danger:#ff7a7a;--ok:#6fd39b}
*{box-sizing:border-box}html,body{margin:0}
body{min-height:100vh;color:var(--text);font-family:Manrope,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
background:radial-gradient(900px 500px at 85% -10%,rgba(201,162,75,.13),transparent 60%),radial-gradient(700px 400px at -5% 5%,rgba(154,162,177,.07),transparent 55%),var(--bg)}
a{color:var(--gold2)}
.center{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 16px}
.card{width:100%;max-width:400px;background:linear-gradient(180deg,var(--card),#141620);border:1px solid var(--border);border-radius:18px;padding:32px;box-shadow:0 20px 50px -25px rgba(0,0,0,.8)}
.wide{max-width:760px}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:28px}
.logo{width:42px;height:42px;border-radius:12px;background:linear-gradient(145deg,var(--gold2),var(--gold));display:flex;align-items:center;justify-content:center;font-family:Sora,sans-serif;font-weight:800;color:#fff;font-size:15px}
.brand b{display:block;font-family:Sora,sans-serif;font-size:15px}
.brand span{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted2)}
h1{font-family:Sora,sans-serif;font-size:22px;margin:0 0 6px}
p.sub{color:var(--muted);font-size:13px;margin:0 0 22px}
label{display:block;font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--muted);margin:0 0 7px}
input,select{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:11px;padding:11px 12px;font-size:14px;font-family:inherit;outline:none}
input:focus,select:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,162,75,.15)}
.field{margin-bottom:16px}
.btn{appearance:none;border:0;cursor:pointer;font-family:Sora,sans-serif;font-weight:600;border-radius:11px;padding:12px 16px;font-size:14px}
.btn-gold{width:100%;background:linear-gradient(180deg,var(--gold2),var(--gold));color:var(--ink)}
.btn-gold:hover{filter:brightness(1.05)}
.btn-ghost{background:#20242f;color:var(--text);border:1px solid var(--border);padding:8px 12px;font-size:12.5px}
.btn-danger{background:rgba(255,90,90,.08);color:var(--danger);border:1px solid rgba(255,90,90,.35);padding:7px 11px;font-size:12px}
.msg{border-radius:11px;padding:11px 13px;font-size:13px;margin-bottom:16px}
.msg.err{background:rgba(255,90,90,.08);border:1px solid rgba(255,90,90,.3);color:var(--danger)}
.msg.ok{background:rgba(111,211,155,.08);border:1px solid rgba(111,211,155,.3);color:var(--ok)}
.msg.warn{background:rgba(201,162,75,.08);border:1px solid rgba(201,162,75,.35);color:var(--gold2)}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:560px){.row{grid-template-columns:1fr}.card{padding:24px}}
table{width:100%;border-collapse:collapse;font-size:13px;margin:6px 0 22px}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--border)}
th{color:var(--muted);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.08em}
.tag{font-size:11px;border:1px solid var(--border);border-radius:999px;padding:2px 8px;color:var(--muted)}
.tag.admin{border-color:rgba(201,162,75,.5);color:var(--gold2)}
.nav{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px}
h2{font-family:Sora,sans-serif;font-size:15px;margin:22px 0 10px}
.foot{margin-top:22px;font-size:11.5px;color:var(--muted2);text-align:center}
`;
function page(title, inner, wide = false) {
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | RK Bulkfile Generator</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Manrope:wght@400;500;600&display=swap">
<style>${CSS}</style></head><body><div class="center"><div class="card ${wide ? 'wide' : ''}">
<div class="brand"><span class="logo">RK</span><div><b>Ramis Kaharmanov</b><span>Bulkfile Generator</span></div></div>
${inner}</div></div></body></html>`;
}

/* ---------------- Seiten ---------------- */
function loginPage(msg) {
  return page('Anmeldung', `
<h1>Anmeldung</h1><p class="sub">Bitte melde dich an, um den Generator zu nutzen.</p>
${msg ? `<div class="msg err">${esc(msg)}</div>` : ''}
<form method="post" action="/login" autocomplete="on">
  <div class="field"><label for="u">Benutzername</label><input id="u" name="username" autocomplete="username" required autofocus></div>
  <div class="field"><label for="p">Passwort</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
  <button class="btn btn-gold" type="submit">Anmelden</button>
</form>
<div class="foot">Zugang nur für berechtigte Nutzer.</div>`);
}

function accountPage(s, msg, ok) {
  return page('Konto', `
<div class="nav"><a class="btn btn-ghost" href="/app">← Zum Generator</a>${s.user.role === 'admin' ? '<a class="btn btn-ghost" href="/admin">Benutzer verwalten</a>' : ''}</div>
<h1>Passwort ändern</h1><p class="sub">Angemeldet als <b>${esc(s.user.username)}</b></p>
${s.user.defaultPassword ? '<div class="msg warn">Du nutzt noch das Start-Passwort. Bitte jetzt ein eigenes vergeben.</div>' : ''}
${msg ? `<div class="msg ${ok ? 'ok' : 'err'}">${esc(msg)}</div>` : ''}
<form method="post" action="/konto">
  <input type="hidden" name="csrf" value="${s.csrf}">
  <div class="field"><label>Aktuelles Passwort</label><input name="current" type="password" autocomplete="current-password" required></div>
  <div class="field"><label>Neues Passwort (mind. 10 Zeichen)</label><input name="next" type="password" autocomplete="new-password" minlength="10" required></div>
  <div class="field"><label>Neues Passwort wiederholen</label><input name="next2" type="password" autocomplete="new-password" minlength="10" required></div>
  <button class="btn btn-gold" type="submit">Passwort speichern</button>
</form>`);
}

function adminPage(s, msg, ok) {
  const rows = users.map(u => `<tr><td><b>${esc(u.username)}</b></td><td><span class="tag ${u.role === 'admin' ? 'admin' : ''}">${u.role === 'admin' ? 'Admin' : 'Nutzer'}</span></td>
<td style="color:var(--muted)">${esc((u.created || '').slice(0, 10))}</td>
<td style="text-align:right">${u.username === s.user.username ? '<span style="color:var(--muted2);font-size:12px">du</span>' :
    `<form method="post" action="/admin/delete" style="display:inline" onsubmit="return confirm('Benutzer ${esc(u.username)} löschen?')">
<input type="hidden" name="csrf" value="${s.csrf}"><input type="hidden" name="username" value="${esc(u.username)}">
<button class="btn btn-danger" type="submit">Löschen</button></form>`}</td></tr>`).join('');
  return page('Benutzer', `
<div class="nav"><a class="btn btn-ghost" href="/app">← Zum Generator</a><a class="btn btn-ghost" href="/konto">Mein Passwort</a></div>
<h1>Benutzer verwalten</h1><p class="sub">Wer Zugriff auf den Generator hat.</p>
${msg ? `<div class="msg ${ok ? 'ok' : 'err'}">${esc(msg)}</div>` : ''}
<table><thead><tr><th>Benutzer</th><th>Rolle</th><th>Angelegt</th><th></th></tr></thead><tbody>${rows}</tbody></table>
<h2>Neuen Benutzer anlegen</h2>
<form method="post" action="/admin/add">
  <input type="hidden" name="csrf" value="${s.csrf}">
  <div class="row">
    <div class="field"><label>Benutzername</label><input name="username" pattern="[A-Za-z0-9._-]{3,32}" title="3–32 Zeichen: Buchstaben, Zahlen, . _ -" required></div>
    <div class="field"><label>Rolle</label><select name="role"><option value="user">Nutzer</option><option value="admin">Admin</option></select></div>
  </div>
  <div class="field"><label>Start-Passwort (mind. 10 Zeichen)</label><input name="password" type="password" minlength="10" autocomplete="new-password" required></div>
  <button class="btn btn-gold" type="submit">Benutzer anlegen</button>
</form>`, true);
}

/* Generator ausliefern – mit Kopfleiste (Konto / Abmelden) */
function generatorPage(s) {
  let html = fs.readFileSync(GENERATOR_FILE, 'utf8');
  const bar = `
<style>
.rk-sessionbar{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;max-width:1500px;margin:0 auto;padding:12px 22px 0;font-family:Manrope,system-ui,sans-serif;font-size:12.5px;color:#9aa2b1}
.rk-sessionbar b{color:#eef0f3}
.rk-sessionbar a,.rk-sessionbar button{font:inherit;font-weight:600;color:#eef0f3;background:#20242f;border:1px solid #272c38;border-radius:9px;padding:6px 11px;text-decoration:none;cursor:pointer}
.rk-sessionbar a:hover,.rk-sessionbar button:hover{border-color:#c9a24b}
.rk-warn{flex:1 1 100%;max-width:1500px;margin:10px auto 0;padding:10px 14px;border-radius:11px;background:rgba(201,162,75,.08);border:1px solid rgba(201,162,75,.35);color:#e4c877}
</style>
<div class="rk-sessionbar">
  <span>Angemeldet als <b>${esc(s.user.username)}</b></span>
  <a href="/konto">Passwort ändern</a>
  ${s.user.role === 'admin' ? '<a href="/admin">Benutzer</a>' : ''}
  <form method="post" action="/logout" style="margin:0"><input type="hidden" name="csrf" value="${s.csrf}"><button type="submit">Abmelden</button></form>
  ${s.user.defaultPassword ? '<div class="rk-warn">Du nutzt noch das Start-Passwort. <a href="/konto" style="background:none;border:0;padding:0;color:#e4c877;text-decoration:underline">Jetzt ändern</a></div>' : ''}
</div>`;
  html = html.replace(/<body>/i, '<body>' + bar);
  return html;
}

/* ---------------- Routing ---------------- */
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const s = getSession(req);
  const ip = clientIp(req);

  // Öffentlich: Login
  if (p === '/login' && req.method === 'GET') {
    if (s) return redirect(res, '/app');
    return send(res, 200, loginPage(url.searchParams.get('e') === 'lock' ? `Zu viele Fehlversuche. Bitte in ${LOCK_MINUTES} Minuten erneut versuchen.` : url.searchParams.get('e') ? 'Benutzername oder Passwort ist falsch.' : ''));
  }
  if (p === '/login' && req.method === 'POST') {
    if (isLocked(ip)) return redirect(res, '/login?e=lock');
    const b = await readBody(req);
    const u = findUser(b.username);
    // Immer einen Hash berechnen, damit die Antwortzeit nichts über existierende Benutzer verrät
    const ok = u ? verifyPassword(String(b.password || ''), u) : (verifyPassword('x', { salt: 'x', hash: '00'.repeat(64) }), false);
    if (!ok) { registerFail(ip); return redirect(res, isLocked(ip) ? '/login?e=lock' : '/login?e=1'); }
    fails.delete(ip);
    const token = createSession(u.username);
    return redirect(res, u.defaultPassword ? '/konto' : '/app', { 'Set-Cookie': cookie('rk_sid', token, SESSION_HOURS * 3600) });
  }

  if (p === '/' ) return redirect(res, s ? '/app' : '/login');
  if (p === '/health') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });

  // Ab hier nur mit Anmeldung
  if (!s) return redirect(res, '/login');

  const checkCsrf = b => b.csrf && crypto.timingSafeEqual(Buffer.from(String(b.csrf).padEnd(48).slice(0, 48)), Buffer.from(s.csrf.padEnd(48).slice(0, 48)));

  if (p === '/app' && req.method === 'GET') return send(res, 200, generatorPage(s));

  if (p === '/logout' && req.method === 'POST') {
    const b = await readBody(req);
    if (!checkCsrf(b)) return send(res, 403, page('Fehler', '<h1>Ungültige Anfrage</h1><p class="sub"><a href="/app">Zurück</a></p>'));
    sessions.delete(s.token);
    return redirect(res, '/login', { 'Set-Cookie': cookie('rk_sid', '', 0) });
  }

  if (p === '/konto' && req.method === 'GET') return send(res, 200, accountPage(s));
  if (p === '/konto' && req.method === 'POST') {
    const b = await readBody(req);
    if (!checkCsrf(b)) return send(res, 403, accountPage(s, 'Sitzung abgelaufen – bitte erneut versuchen.'));
    if (!verifyPassword(String(b.current || ''), s.user)) return send(res, 400, accountPage(s, 'Das aktuelle Passwort ist falsch.'));
    if (String(b.next || '').length < 10) return send(res, 400, accountPage(s, 'Das neue Passwort muss mindestens 10 Zeichen haben.'));
    if (b.next !== b.next2) return send(res, 400, accountPage(s, 'Die neuen Passwörter stimmen nicht überein.'));
    if (b.next === b.current) return send(res, 400, accountPage(s, 'Das neue Passwort muss sich vom alten unterscheiden.'));
    Object.assign(s.user, hashPassword(b.next), { defaultPassword: false });
    saveUsers(users);
    destroyUserSessions(s.user.username, s.token);  // andere Geräte abmelden
    return send(res, 200, accountPage(getSession(req), 'Passwort gespeichert.', true));
  }

  // Admin-Bereich
  if (p.startsWith('/admin')) {
    if (s.user.role !== 'admin') return send(res, 403, page('Kein Zugriff', '<h1>Kein Zugriff</h1><p class="sub">Nur für Admins. <a href="/app">Zum Generator</a></p>'));
    if (p === '/admin' && req.method === 'GET') return send(res, 200, adminPage(s));
    if (p === '/admin/add' && req.method === 'POST') {
      const b = await readBody(req);
      if (!checkCsrf(b)) return send(res, 403, adminPage(s, 'Sitzung abgelaufen – bitte erneut versuchen.'));
      const name = String(b.username || '').trim();
      if (!/^[A-Za-z0-9._-]{3,32}$/.test(name)) return send(res, 400, adminPage(s, 'Ungültiger Benutzername (3–32 Zeichen: Buchstaben, Zahlen, . _ -).'));
      if (findUser(name)) return send(res, 400, adminPage(s, `Benutzer „${name}" existiert bereits.`));
      if (String(b.password || '').length < 10) return send(res, 400, adminPage(s, 'Das Passwort muss mindestens 10 Zeichen haben.'));
      users.push({ username: name, role: b.role === 'admin' ? 'admin' : 'user', ...hashPassword(b.password), defaultPassword: true, created: new Date().toISOString() });
      saveUsers(users);
      return send(res, 200, adminPage(s, `Benutzer „${name}" angelegt. Er wird beim ersten Login gebeten, sein Passwort zu ändern.`, true));
    }
    if (p === '/admin/delete' && req.method === 'POST') {
      const b = await readBody(req);
      if (!checkCsrf(b)) return send(res, 403, adminPage(s, 'Sitzung abgelaufen – bitte erneut versuchen.'));
      const u = findUser(b.username);
      if (!u) return send(res, 404, adminPage(s, 'Benutzer nicht gefunden.'));
      if (u.username === s.user.username) return send(res, 400, adminPage(s, 'Du kannst dich nicht selbst löschen.'));
      if (u.role === 'admin' && users.filter(x => x.role === 'admin').length <= 1) return send(res, 400, adminPage(s, 'Der letzte Admin kann nicht gelöscht werden.'));
      users = users.filter(x => x !== u);
      saveUsers(users);
      destroyUserSessions(u.username);
      return send(res, 200, adminPage(s, `Benutzer „${u.username}" gelöscht.`, true));
    }
  }

  return send(res, 404, page('Nicht gefunden', '<h1>Seite nicht gefunden</h1><p class="sub"><a href="/app">Zum Generator</a></p>'));
}

http.createServer((req, res) => {
  handle(req, res).catch(err => { console.error(err); if (!res.headersSent) send(res, 500, 'Interner Fehler'); });
}).listen(PORT, () => console.log(`» RK Bulkfile Generator läuft auf http://localhost:${PORT}`));
