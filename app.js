
/* ---------- Workflow definition ---------- */
const STEPS = [
 {n:'Client Inquiry & 3D Design',dept:'Design',f:[['url','SketchUp / Design URL','url'],['meas','Measurements','text'],['spec','Specifications','area']]},
 {n:'Material Sourcing & Estimation',dept:'Procurement',f:[['sheets','18mm HMR / MDF sheet count','text'],['tape','Edging tape','text'],['hw','Hardware list','area']]},
 {n:'Cutting & Edge Banding',dept:'Cutting',f:[['cut','Cutting list specs','area'],['edge','Edge banding thickness','sel',['1mm','2mm']],['opt','Sheet optimization','text']]},
 {n:'Assembly & Carpentry',dept:'Carpentry',f:[['carc','Carcase assembly','area'],['fit','Hinge / drawer slider fitting','text'],['qc','Quality check','sel',['Pending','Passed','Failed - rework']]]},
 {n:'Finishing & Packaging',dept:'Finishing',f:[['sand','Sanding grade','text'],['finish','Polish / paint specs','text'],['wrap','Protective wrapping','text']]},
 {n:'Site Installation & Handover',dept:'Installation',f:[['lorry','Transport / lorry assignment','text'],['site','On-site assembly','area'],['pay','Final payment','sel',['Pending','Received']],['sign','Client sign-off (name)','text']]}
];
const CATS = ['Material Shortage','Missing Hardware','Design Flaw','Machine Breakdown','Quality Rejection','Client Delay'];
const SL = {LOCKED:'Locked',PENDING:'Ready to start',IN_PROGRESS:'In progress',PENDING_TAKEOVER:'Awaiting takeover',DONE:'Done'};
const DAY = 864e5, LS = 'sp_jobs_v1';

/* ---------- State & persistence ---------- */
let jobs = {}, open = null, firstSnap = true, useGS = false, dirty = {}, lastRaw = '';
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
let view = 'jobs', dip = null;
let user = null, users = [], pin = lsGet('sp_pin') || '';
try { user = JSON.parse(lsGet('sp_user') || 'null'); } catch (e) { user = null; }
let role = user ? user.role : 'worker';
const myName = () => user ? user.name : '';
const LSK = () => 'sp_jobs_' + (user ? user.id : '');
const ERR = {auth: 'Wrong PIN', locked: 'Too many wrong tries - wait 10 minutes', dup: 'That PIN is already used', badpin: 'PIN must be 4-8 digits', badname: 'Enter a valid name', forbidden: 'Not allowed', conflict: 'Job was changed by someone else - reloaded'};

const store = () => lsSet(LSK(), JSON.stringify(jobs));
const icons = () => { if (window.lucide) lucide.createIcons(); };
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const now = () => new Date().toISOString();
const uid = () => 'J' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
const fdt = t => t ? new Date(t).toLocaleString([], {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '-';
const dur = ms => { if (ms == null || ms < 0) return '-'; const m = Math.floor(ms / 6e4); return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; };
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.add('hidden'), 2400); }

function norm(j) {
  j.steps = Array.isArray(j.steps) ? j.steps : Object.values(j.steps || {});
  while (j.steps.length < 6) j.steps.push({state: j.steps.length ? 'LOCKED' : 'PENDING', worker: '', takeover: '', start: null, end: null, d: {}});
  j.steps.forEach(s => { s.d = s.d || {}; s.uid = s.uid || ''; });
  j.notes = Array.isArray(j.notes) ? j.notes : [];
  j.pos = Array.isArray(j.pos) ? j.pos : [];
  j.step = Math.min(5, Math.max(0, +j.step || 0));
  j.createdAt = j.createdAt || now();
  if (j.issue) j.issue.comments = Object.values(j.issue.comments || {});
  j.issues = Object.values(j.issues || {});
  j.issues.forEach(i => { i.comments = Object.values(i.comments || {}); });
  return j;
}
const validId = id => /^[A-Za-z0-9_-]{1,40}$/.test(String(id));
function cleanMap(v) {
  const o = {};
  Object.keys(v && typeof v === 'object' ? v : {}).forEach(k => { const j = v[k]; if (j && typeof j === 'object' && validId(k)) { j.id = k; o[k] = norm(j); } });
  return o;
}
function loadLocal() { try { jobs = cleanMap(JSON.parse(lsGet(LSK()) || '{}')); } catch (e) { jobs = {}; } }
function persist(j) {
  store();
  if (useGS && j) { dirty[j.id] = 'save:' + j.updatedAt; storeDirty(); flush(); }
}
function save(j) { j.updatedAt = now(); jobs[j.id] = j; persist(j); render(); }
function setSync(on, txt) { $('sync').className = 'inline-block w-2 h-2 rounded-full ' + (on ? 'bg-emerald-300' : 'bg-amber-400'); $('syncTxt').textContent = txt; }


function storeDirty() { lsSet('sp_dirty', JSON.stringify(dirty)); }
function applyRemote(v, merge) {
  const seen = new Set(Object.values(jobs).filter(x => x.issue).map(x => x.id + x.issue.at));
  if (merge) {
    Object.keys(dirty).forEach(id => { if (dirty[id].startsWith('save') && jobs[id]) v[id] = jobs[id]; else if (dirty[id].startsWith('del')) delete v[id]; });
  }
  const u0 = role === 'admin' ? unread() : 0;
  jobs = v; store(); render();
  if (!firstSnap && role === 'admin' && unread() > u0) alertNew(inboxItems()[0]);
  firstSnap = false;
}
const gsPost = body => fetch(APPS_SCRIPT_URL, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify(Object.assign({pin: pin}, body))})
  .then(r => r.json()).then(r => { if (!r.ok) { if (r.error === 'auth' && user) doLogout(); throw new Error(r.error); } return r; });
let flushing = false;
async function flush() {
  if (flushing) return; flushing = true;
  for (const id of Object.keys(dirty)) {
    const tag = dirty[id];
    try {
      if (tag.startsWith('del')) await gsPost({action: 'delete', id});
      else if (jobs[id]) { const r = await gsPost({action: 'save', job: JSON.parse(JSON.stringify(jobs[id]))}); if (dirty[id] === tag && jobs[id]) jobs[id].sv = r.updatedAt; }
      if (dirty[id] === tag) delete dirty[id];
      storeDirty();
    } catch (e) {
      if (e instanceof TypeError || e instanceof SyntaxError) { setSync(false, 'Offline - will sync when online'); break; }
      delete dirty[id]; storeDirty(); delete jobs[id]; lastRaw = ''; toast(ERR[e.message] || 'Could not save - reloaded'); render();
    }
  }
  flushing = false;
}
async function gsPull(force) {
  if (!user || (document.hidden && !force)) return;
  await flush();
  try {
    const r = await gsPost({action: 'list'});
    setSync(true, 'Synced');
    if (r.user) { user = r.user; role = user.role; lsSet('sp_user', JSON.stringify(user)); }
    users = r.users || [];
    const raw = JSON.stringify(r.jobs || {}) + JSON.stringify(users);
    if (raw === lastRaw && !Object.keys(dirty).length) return;
    lastRaw = raw;
    const v = cleanMap(r.jobs); Object.values(v).forEach(j => { j.sv = j.updatedAt; });
    applyRemote(v, true);
  } catch (e) { if (e instanceof TypeError || e instanceof SyntaxError) setSync(false, 'Offline - using local copy'); }
}
function initGS() {
  if (useGS) return;
  useGS = true;
  try { dirty = JSON.parse(lsGet('sp_dirty') || '{}'); } catch (e) { dirty = {}; }
  setSync(false, 'Connecting to Google Sheet...');
  gsPull(); setInterval(gsPull, 12000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) gsPull(); });
  window.addEventListener('online', gsPull);
}

/* ---------- Domain helpers ---------- */
function clock(j) {
  const s = j.steps[j.step];
  if (s.state === 'IN_PROGRESS') return s.start;
  if (s.state === 'PENDING_TAKEOVER') return j.steps[j.step - 1].end;
  return j.step === 0 ? j.createdAt : null;
}
const isDelayed = j => { if (j.done) return false; const c = clock(j); return c && Date.now() - new Date(c) > DAY; };
const status = j => j.done ? 'done' : j.issue ? 'issue' : isDelayed(j) ? 'delayed' : 'active';

/* ---------- Actions ---------- */
function readForm(j) {
  const s = j.steps[j.step];
  document.querySelectorAll('#mbody [data-k]').forEach(el => { s.d[el.dataset.k] = el.value.trim(); });
}
function A_start(id) {
  const j = jobs[id]; readForm(j); const s = j.steps[j.step];
  s.worker = myName(); s.start = now(); s.state = 'IN_PROGRESS'; save(j); toast('Task started');
}
function A_finish(id) {
  const j = jobs[id]; readForm(j); const s = j.steps[j.step];
  if (j.step === 3 && s.d.qc !== 'Passed') return toast('Quality check must be set to Passed');
  if (j.step === 5 && (s.d.pay !== 'Received' || !s.d.sign)) return toast('Final payment must be Received and client sign-off entered');
  s.end = now(); s.state = 'DONE';
  if (j.step < 5) { j.step++; j.steps[j.step].state = 'PENDING_TAKEOVER'; toast('Forwarded to: ' + STEPS[j.step].n); }
  else { j.done = true; j.completedAt = now(); toast('Job completed'); }
  save(j);
}
function A_takeover(id) {
  const j = jobs[id]; readForm(j); const s = j.steps[j.step];
  s.worker = myName(); s.takeover = myName(); s.start = now(); s.state = 'IN_PROGRESS'; save(j); toast('Takeover confirmed - timer started');
}
function A_saveDetails(id) { const j = jobs[id]; readForm(j); save(j); toast('Details saved'); }
function A_issue(id) {
  const j = jobs[id], note = $('inote').value.trim();
  j.issue = {cat: $('icat').value, note, by: myName(), uid: user.id, at: now(), step: j.step, comments: []};
  save(j); M.job(id); toast('Issue sent to Admin ✓');
}
function A_note(id) {
  const j = jobs[id], t = $('ntx').value.trim(); if (!t) return toast('Write a message');
  j.notes.push({id: uid(), uid: user.id, by: myName(), kind: $('nk').value, text: t, at: now()});
  save(j); M.job(id); toast('Sent ✓ Admin has been notified');
}
function A_memo(id) { if (role !== 'admin') return; const j = jobs[id]; j.memo = $('memo').value.trim(); save(j); toast('Memo saved'); }
function A_assign(id, i, v) {
  if (role !== 'admin') return; const j = jobs[id]; if (j.steps[i].state === 'DONE') return toast('Step already completed');
  const u = users.find(x => x.id === v); j.steps[i].uid = v; j.steps[i].an = u ? u.name : ''; save(j); toast('Assigned');
}
function A_comment(id) {
  const j = jobs[id], t = $('cmt').value.trim(); if (!t || !j.issue) return;
  j.issue.comments.push({by: role === 'admin' ? 'Admin' : myName(), text: t, at: now()});
  save(j); M.job(id);
}
function A_resolve(id) {
  const j = jobs[id], t = $('cmt') ? $('cmt').value.trim() : '';
  if (role !== 'admin' || !j.issue) return toast('Admin only');
  if (t) j.issue.comments.push({by: 'Admin', text: t, at: now()});
  j.issue.resolvedAt = now(); j.issues.push(j.issue); j.issue = null;
  save(j); M.job(id); toast('Issue resolved - workflow unblocked');
}
function A_create() {
  if (role !== 'admin') return;
  const c = $('nc').value.trim(), t = $('nt').value.trim(); if (!c || !t) return toast('Client and item are required');
  const j = {id: uid(), client: c, title: t, address: $('na').value.trim(), createdAt: now(), step: 0, done: false, issue: null, issues: [], notes: [], pos: [], memo: '',
    steps: STEPS.map((_, i) => ({state: i ? 'LOCKED' : 'PENDING', worker: '', takeover: '', start: null, end: null, d: {}, uid: $('as' + i).value}))};
  save(j); M.job(j.id);
}
function A_delete(id) { if (role !== 'admin' || !confirm('Delete this job permanently?')) return; delete jobs[id]; store();
  if (useGS) { dirty[id] = 'del:' + Date.now(); storeDirty(); flush(); } M.close(); render(); }

function A_csv(id) {
  if (role !== 'admin') return;
  const j = jobs[id], q = v => '"' + String(v == null ? '' : v).replace(/^[=+\-@]/, "'$&").replace(/"/g, '""') + '"';
  const rows = [['Step', 'Worker', 'Start', 'Finish', 'Minutes', 'Status']].concat(j.steps.map((x, i) => [STEPS[i].n, x.worker, x.start, x.end, x.start && x.end ? Math.round((new Date(x.end) - new Date(x.start)) / 6e4) : '', SL[x.state]]));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(q).join(',')).join('\n')], {type: 'text/csv'}));
  a.download = j.id + '-audit.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const jstatus = j => j.done ? 'Completed' : (j.issue ? 'BLOCKED - ' + j.issue.cat : 'Step ' + (j.step + 1) + ' of 6: ' + STEPS[j.step].n);
function A_share(id) {
  const j = jobs[id]; if (!j || role !== 'admin') return;
  const L = ['*SP Home Construction (Pvt) Ltd*', '*' + j.title + '*', 'Client: ' + j.client + (j.address ? ' (' + j.address + ')' : ''), 'Job: ' + j.id, 'Status: ' + jstatus(j), ''];
  j.steps.forEach((x, i) => L.push((x.state === 'DONE' ? '[done] ' : '[ ] ') + (i + 1) + '. ' + STEPS[i].n + (x.worker ? ' - ' + x.worker : '') + (x.start && x.end ? ' (' + dur(new Date(x.end) - new Date(x.start)) + ')' : '')));
  if (j.issue) L.push('', 'Issue: ' + j.issue.note);
  const w = window.open('https://wa.me/?text=' + encodeURIComponent(L.join('\n')), '_blank');
  if (!w) toast('Allow pop-ups to open WhatsApp');
}
function A_card(id) {
  const j = jobs[id]; if (!j || role !== 'admin') return;
  const rows = j.steps.map((x, i) => {
    const det = STEPS[i].f.filter(f => x.d[f[0]]).map(f => esc(f[1]) + ': ' + esc(x.d[f[0]])).join('<br>');
    return '<tr><td>' + (i + 1) + '. ' + esc(STEPS[i].n) + '</td><td>' + esc(x.worker || x.an || '-') + '</td><td>' + fdt(x.start) + '</td><td>' + fdt(x.end) + '</td><td>' + (x.start && x.end ? dur(new Date(x.end) - new Date(x.start)) : '-') + '</td><td>' + esc(SL[x.state]) + (det ? '<div class="d">' + det + '</div>' : '') + '</td></tr>';
  }).join('');
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(j.id) + '</title><style>@page{size:A4;margin:14mm}body{font:12px/1.4 Arial,sans-serif;color:#0f172a}h1{margin:0;font-size:20px;color:#064e3b}.m{color:#475569;margin:2px 0 10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:5px;text-align:left;vertical-align:top}th{background:#ecfdf5}.d{font-size:10px;color:#475569;margin-top:3px}.b{padding:6px;margin:8px 0;border:1px solid #64748b;font-weight:bold}.r{border-color:#dc2626;color:#b91c1c}.s{margin-top:28px;display:flex;justify-content:space-between}.s div{width:40%;border-top:1px solid #0f172a;padding-top:4px}</style></head><body><h1>SP Home Construction (Pvt) Ltd</h1><div class="m">Job Card - Narammala - printed ' + esc(new Date().toLocaleString()) + '</div><h2 style="margin:6px 0">' + esc(j.title) + '</h2><div class="m">Client: <b>' + esc(j.client) + '</b>' + (j.address ? ' - ' + esc(j.address) : '') + ' - Job ID: <b>' + esc(j.id) + '</b> - Created: ' + fdt(j.createdAt) + '</div><div class="b ' + (j.issue ? 'r' : '') + '">Status: ' + esc(jstatus(j)) + (j.issue ? '<div style="font-weight:normal">' + esc(j.issue.note) + '</div>' : '') + '</div><table><thead><tr><th>Step</th><th>Worker</th><th>Start</th><th>Finish</th><th>Time</th><th>Status / details</th></tr></thead><tbody>' + rows + '</tbody></table><div class="s"><div>Prepared by</div><div>Approved by</div></div></body></html>';
  printDoc(html);
}

const asel = (idAttr, val, extra) => '<select ' + (idAttr ? 'id="' + idAttr + '" ' : '') + 'class="inp" ' + (extra || '') + '><option value="">Unassigned (Admin does it)</option>' + users.filter(u => u.active && u.role === 'worker').map(u => '<option value="' + u.id + '"' + (u.id === val ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('') + '</select>';
const wFilter = (j, f) => { const m = j.steps.filter(x => x.uid === user.id); if (!m.length) return false; const fin = m.every(x => x.state === 'DONE'); return f === 'arch' ? fin : !fin; };
function workerMetrics(all) {
  const mine = all.filter(j => j.steps.some(x => x.uid === user.id)), fin = j => j.steps.filter(x => x.uid === user.id).every(x => x.state === 'DONE');
  const now_ = mine.filter(j => !j.done && j.steps[j.step].uid === user.id).length, arch = mine.filter(fin).length;
  return [['Do now', now_, 'text-em-dark', 'hammer'], ['Upcoming', mine.length - arch - now_, 'text-char', 'clock'], ['Archived', arch, 'text-slate-500', 'check-circle']]
    .map(m => `<div class="card p-3"><div class="flex justify-between text-xs text-slate-500">${m[0]}<i data-lucide="${m[3]}" class="w-4 h-4"></i></div><div class="text-3xl font-bold ${m[2]}">${Math.max(0, m[1])}</div></div>`).join('');
}
function extraBlock(j, id) {
  const admin = role === 'admin'; let h = '';
  if (admin) h += overviewBlock(j, id);
  if (j.notes.length) h += '<div><div class="font-bold mb-2">' + (admin ? 'Messages from workers' : 'My messages to Admin') + '</div>' + j.notes.slice().reverse().map(n => '<div class="text-sm border-t py-2"><b>' + esc(n.kind) + '</b> - ' + esc(n.by) + ' <span class="text-xs text-slate-500">' + fdt(n.at) + '</span><div>' + esc(n.text) + '</div></div>').join('') + '</div>';
  if (admin) {
    h += '<div><div class="flex items-center mb-2"><div class="font-bold flex-1">Purchase orders</div><button class="btn bg-em text-white !min-h-[40px] !py-1" onclick="M.po(\'' + id + '\')">+ New PO</button></div>' + (j.pos.length ? j.pos.map((p, k) => '<div class="border rounded-xl p-3 mb-2"><div class="flex"><b class="flex-1">' + esc(p.no) + ' - ' + esc(p.supplier) + '</b><span class="text-xs text-slate-500">' + fdt(p.at) + '</span></div><div class="text-xs text-slate-500">' + p.items.length + ' item(s)' + (p.date ? ' - needed ' + esc(p.date) : '') + '</div><div class="flex gap-5 mt-2 text-sm"><button class="underline text-em-dark" onclick="A_poPrint(\'' + id + '\',' + k + ')">Print / PDF</button><button class="underline text-em-dark" onclick="A_poWa(\'' + id + '\',' + k + ')">WhatsApp</button><button class="underline text-red-600" onclick="A_poDel(\'' + id + '\',' + k + ')">Delete</button></div></div>').join('') : '<div class="text-sm text-slate-500">No purchase orders yet.</div>') + '</div>';
    h += '<div><div class="font-bold mb-1">Assigned team</div>' + j.steps.map((x, i) => '<label class="lbl">' + (i + 1) + '. ' + esc(STEPS[i].n) + '</label>' + asel('', x.uid, 'onchange="A_assign(\'' + id + '\',' + i + ',this.value)"' + (x.state === 'DONE' ? ' disabled' : ''))).join('') + '</div>';
    h += '<div><div class="font-bold mb-1">Private memo (Admin only)</div><textarea id="memo" rows="3" class="inp" placeholder="Only you can see this">' + esc(j.memo || '') + '</textarea><button class="btn bg-char text-white w-full mt-2" onclick="A_memo(\'' + id + '\')">Save memo</button></div>';
  }
  return h;
}
const FS_ADMIN = $('fS').innerHTML;
function showLogin(msg, init) {
  $('login').classList.remove('hidden');
  $('lbox').innerHTML = '<div class="text-center mb-4"><div class="w-14 h-14 rounded-xl bg-em text-white font-bold text-xl flex items-center justify-center mx-auto mb-2">SP</div><div class="font-bold text-em-dark">SP Home Construction (Pvt) Ltd</div><div class="text-xs text-slate-500">Workshop Tracker - ' + (APP_ROLE === 'admin' ? 'Admin' : 'Worker') + '</div></div>' +
    (/iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone ? '<div class="text-xs text-slate-500 mb-2">Tip: tap Share, then <b>Add to Home Screen</b> to install this app.</div>' : '') +
    (msg ? '<div class="text-sm text-red-600 mb-2">' + esc(msg) + '</div>' : '') +
    (init === true ? '<div class="text-sm mb-2">First time setup: create the Admin account.</div><label class="lbl">Admin name</label><input id="ln" class="inp">' : '') +
    (init === undefined ? '' : '<label class="lbl">PIN (4-8 digits)</label><input id="lp" type="password" inputmode="numeric" maxlength="8" autocomplete="off" class="inp text-center text-xl tracking-widest" onkeydown="if(event.key===\'Enter\')A_login(' + (init === true) + ')"><button class="btn bg-em text-white w-full mt-4" onclick="A_login(' + (init === true) + ')">' + (init === true ? 'Create Admin' : 'Log in') + '</button>');
}
async function A_login(init) {
  const p = $('lp').value.trim(); if (!/^\d{4,8}$/.test(p)) return toast('PIN must be 4-8 digits');
  try {
    if (init) { const n = $('ln').value.trim(); if (!n) return toast('Enter your name'); await gsPost({action: 'init', name: n, newPin: p}); }
    const r = await gsPost({action: 'login', pin: p});
    if (r.user.role !== APP_ROLE) return toast('This is the ' + APP_ROLE + ' app - please use the ' + r.user.role + ' app.');
    pin = p; user = r.user; role = user.role; lsSet('sp_pin', p); lsSet('sp_user', JSON.stringify(user));
    $('login').classList.add('hidden'); jobs = {}; loadLocal(); render(); initGS();
  } catch (e) { toast(ERR[e.message] || 'Could not connect - check internet'); }
}
function doLogout() {
  try { if (user) localStorage.removeItem(LSK()); ['sp_pin', 'sp_user', 'sp_dirty'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
  user = null; location.reload();
}
function boot() {
  if (!APPS_SCRIPT_URL.startsWith('https://')) return showLogin('Set APPS_SCRIPT_URL in index.html first.');
  if (user && pin && user.role !== APP_ROLE) return doLogout();
  if (user && pin) { $('login').classList.add('hidden'); loadLocal(); render(); initGS(); return; }
  gsPost({action: 'status'}).then(r => r.init && APP_ROLE !== 'admin' ? showLogin('The Admin must set up the system first.') : showLogin('', !!r.init)).catch(() => showLogin('Cannot reach the server. Check internet and reload.'));
}
async function adm(body, okMsg) {
  try { await gsPost(body); lastRaw = ''; await gsPull(true); toast(okMsg); M.team(); } catch (e) { toast(ERR[e.message] || 'Failed - check internet'); }
}
function A_addUser() { adm({action: 'addUser', name: $('un').value.trim(), newPin: $('up').value.trim()}, 'Worker added'); }
function A_setPin(id) {
  const p = prompt('New PIN (4-8 digits)'); if (!p) return;
  if (id === user.id && /^\d{4,8}$/.test(p)) { gsPost({action: 'setPin', uid: id, newPin: p}).then(() => { pin = p; lsSet('sp_pin', p); toast('PIN changed'); }).catch(e => toast(ERR[e.message] || 'Failed')); return; }
  adm({action: 'setPin', uid: id, newPin: p}, 'PIN changed');
}
function A_delUser(id) { if (confirm('Remove this worker? Their jobs must be reassigned.')) adm({action: 'delUser', uid: id}, 'Worker removed'); }

const normPhone = p => { p = String(p || '').replace(/\D/g, ''); return p.startsWith('0') ? '94' + p.slice(1) : p; };
function printDoc(html) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Could not open print dialog'); } setTimeout(() => f.remove(), 60000); };
  f.srcdoc = html; document.body.appendChild(f);
}
function overviewBlock(j, id) {
  const end = j.done && j.completedAt ? new Date(j.completedAt) : Date.now(), work = j.steps.reduce((t, x) => t + (x.start && x.end ? new Date(x.end) - new Date(x.start) : 0), 0);
  return '<div class="grid grid-cols-3 gap-2 text-center">' + [['Open for', dur(end - new Date(j.createdAt))], ['Work time', dur(work)], ['Steps done', j.steps.filter(x => x.state === 'DONE').length + '/6']].map(m => '<div class="bg-emerald-50 rounded-xl p-2"><div class="text-xs text-slate-500">' + m[0] + '</div><div class="font-bold text-em-dark">' + m[1] + '</div></div>').join('') + '</div>' +
    '<div class="grid grid-cols-2 gap-2"><button class="btn bg-em text-white" onclick="A_card(\'' + id + '\')">🖨 Print job card</button><button class="btn border border-slate-300" onclick="A_share(\'' + id + '\')">WhatsApp status</button></div>';
}
const poRow = () => '<div class="border rounded-xl p-2 mb-2 poRow"><input class="inp pd" placeholder="Material / description"><div class="grid grid-cols-3 gap-2 mt-2"><input class="inp pq" inputmode="decimal" placeholder="Qty"><input class="inp pu" placeholder="Unit"><input class="inp pr" inputmode="decimal" placeholder="Rate (opt.)"></div></div>';
async function A_poSave(id) {
  if (role !== 'admin') return;
  const j = jobs[id], sup = $('ps').value.trim();
  const items = [...document.querySelectorAll('.poRow')].map(r => ({d: r.querySelector('.pd').value.trim(), q: r.querySelector('.pq').value.trim(), u: r.querySelector('.pu').value.trim(), r: parseFloat(r.querySelector('.pr').value) || 0})).filter(x => x.d);
  if (!sup || !items.length) return toast('Supplier and at least one material are required');
  let no; try { no = (await gsPost({action: 'poNo'})).no; } catch (e) { return toast('Internet needed to number the purchase order'); }
  j.pos.push({no, at: now(), supplier: sup, phone: normPhone($('pp').value), deliver: $('pl').value.trim(), date: $('pdt').value, items, notes: $('pn').value.trim(), by: myName()});
  save(j); M.job(id); toast(no + ' created');
}
function poHtml(j, p) {
  const amt = x => x.r && parseFloat(x.q) ? x.r * parseFloat(x.q) : 0, tot = p.items.reduce((t, x) => t + amt(x), 0), hasR = p.items.some(x => x.r), n = v => v.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const rows = p.items.map((x, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(x.d) + '</td><td>' + esc(x.q) + '</td><td>' + esc(x.u) + '</td>' + (hasR ? '<td class="r">' + (x.r ? n(x.r) : '') + '</td><td class="r">' + (amt(x) ? n(amt(x)) : '') + '</td>' : '') + '</tr>').join('');
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(p.no) + '</title><style>@page{size:A4;margin:14mm}body{font:12px/1.45 Arial,sans-serif;color:#0f172a}h1{margin:0;font-size:20px;color:#064e3b}h2{margin:14px 0 6px;font-size:16px;letter-spacing:2px}.m{color:#475569}.g{display:flex;gap:20px;margin:10px 0}.g>div{flex:1;border:1px solid #cbd5e1;border-radius:6px;padding:8px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left}th{background:#ecfdf5}.r{text-align:right}.s{margin-top:40px;display:flex;justify-content:space-between}.s div{width:40%;border-top:1px solid #0f172a;padding-top:4px}</style></head><body><h1>SP Home Construction (Pvt) Ltd</h1><div class="m">Narammala, Sri Lanka</div><h2>PURCHASE ORDER</h2><div class="g"><div><b>PO No:</b> ' + esc(p.no) + '<br><b>Date:</b> ' + fdt(p.at) + '<br><b>Job:</b> ' + esc(j.title) + ' (' + esc(j.client) + ')</div><div><b>Supplier:</b> ' + esc(p.supplier) + '<br><b>Deliver to:</b> ' + esc(p.deliver || '-') + '<br><b>Required by:</b> ' + esc(p.date || '-') + '</div></div><table><thead><tr><th>#</th><th>Material / description</th><th>Qty</th><th>Unit</th>' + (hasR ? '<th class="r">Rate (LKR)</th><th class="r">Amount (LKR)</th>' : '') + '</tr></thead><tbody>' + rows + (hasR ? '<tr><td colspan="5" class="r"><b>Total</b></td><td class="r"><b>' + n(tot) + '</b></td></tr>' : '') + '</tbody></table>' + (p.notes ? '<p><b>Notes:</b> ' + esc(p.notes) + '</p>' : '') + '<div class="s"><div>Authorized by (' + esc(p.by || 'Admin') + ')</div><div>Supplier acknowledgement</div></div></body></html>';
}
function A_poPrint(id, k) { const j = jobs[id]; if (role === 'admin' && j && j.pos[k]) printDoc(poHtml(j, j.pos[k])); }
function A_poWa(id, k) {
  const j = jobs[id], p = j && j.pos[k]; if (role !== 'admin' || !p) return;
  const L = ['*SP Home Construction (Pvt) Ltd*', '*Purchase Order ' + p.no + '*', 'Job: ' + j.title, 'Deliver to: ' + (p.deliver || '-'), 'Required by: ' + (p.date || '-'), ''];
  p.items.forEach((x, i) => L.push((i + 1) + '. ' + x.d + ' - ' + x.q + ' ' + x.u + (x.r ? ' @ LKR ' + x.r : '')));
  if (p.notes) L.push('', 'Note: ' + p.notes);
  L.push('', 'Please confirm. Thank you.');
  if (!window.open('https://wa.me/' + p.phone + '?text=' + encodeURIComponent(L.join('\n')), '_blank')) toast('Allow pop-ups to open WhatsApp');
}
function A_poDel(id, k) { if (role !== 'admin' || !confirm('Delete this purchase order?')) return; const j = jobs[id]; j.pos.splice(k, 1); save(j); M.job(id); }

const seen = () => lsGet('sp_seen') || '';
function inboxItems() {
  const o = [];
  Object.values(jobs).forEach(j => { j.notes.forEach(n => o.push({t: n.at, kind: n.kind, by: n.by, text: n.text, j})); if (j.issue) o.push({t: j.issue.at, kind: 'Issue: ' + j.issue.cat, by: j.issue.by, text: j.issue.note, j, issue: true}); });
  return o.sort((x, y) => String(y.t).localeCompare(String(x.t)));
}
const unread = () => inboxItems().filter(x => String(x.t) > seen()).length;
function alertNew(x) {
  if (!x) return;
  toast('🔔 ' + x.by + ': ' + x.kind + ' - ' + x.j.title);
  if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
  if (window.Notification && Notification.permission === 'granted') { try { new Notification('SP Workshop: ' + x.kind, {body: x.by + ' - ' + x.j.title + ': ' + x.text, icon: 'icon-admin-192.png'}); } catch (e) {} }
}
function inboxHtml() {
  const s0 = seen(), items = inboxItems();
  if (items.length) lsSet('sp_seen', items[0].t);
  const bell = window.Notification && Notification.permission === 'default' ? '<button class="btn bg-em text-white w-full mb-3" onclick="Notification.requestPermission().then(render)">🔔 Turn on alerts on this phone</button>' : '';
  return '<div class="col-span-full md:col-span-2 lg:col-span-3">' + bell + (items.length ? items.map(x => { const nw = String(x.t) > s0; return `<button onclick="M.job('${x.j.id}')" class="card w-full text-left p-4 mb-3 border-l-[6px] ${x.issue ? 'border-red-500' : 'border-amber-400'} ${nw ? 'ring-2 ring-em/40' : ''}"><div class="flex items-center gap-2"><b class="flex-1 truncate">${esc(x.kind)}</b>${nw ? '<span class="text-[10px] font-bold bg-red-600 text-white rounded px-1.5">NEW</span>' : ''}<span class="text-xs text-slate-500">${fdt(x.t)}</span></div><div class="text-sm mt-1">${esc(x.text || '(no details)')}</div><div class="text-xs text-slate-500 mt-1">${esc(x.by)} - ${esc(x.j.title)} (${esc(x.j.client)})</div></button>`; }).join('') : '<div class="text-center text-slate-500 py-12">No messages yet. Delay reasons, issues and notes from workers appear here.</div>') + '</div>';
}
function setView(v) { view = v; render(); window.scrollTo(0, 0); }
function setW(v) { $('fS').value = v; render(); window.scrollTo(0, 0); }
function renderNav() {
  const admin = role === 'admin', n = admin ? unread() : 0, wv = $('fS').value;
  const tabs = admin ? [['jobs', 'Jobs', 'clipboard-list', 0, "setView('jobs')"], ['inbox', 'Inbox', 'bell', n, "setView('inbox')"], ['team', 'Team', 'users', 0, 'M.team()']] : [['mine', 'My tasks', 'hammer', 0, "setW('mine')"], ['arch', 'Archive', 'archive', 0, "setW('arch')"]];
  $('nav').innerHTML = tabs.map(t => `<button onclick="${t[4]}" class="flex-1 flex flex-col items-center gap-0.5 pt-2 pb-1.5 relative ${(admin ? view === t[0] : wv === t[0]) ? 'text-em' : 'text-slate-500'}"><i data-lucide="${t[2]}" class="w-6 h-6"></i><span class="text-[11px] font-semibold">${t[1]}</span>${t[3] ? `<span class="absolute top-1 left-1/2 ml-2 bg-red-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center">${t[3]}</span>` : ''}</button>`).join('');
  if (navigator.setAppBadge) { try { n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch (e) {} }
}
function workerHero(all) {
  if ($('fS').value === 'arch') return '';
  return all.filter(j => !j.done && !j.issue && j.steps[j.step].uid === user.id).map(j => `<button onclick="M.job('${j.id}')" class="w-full text-left rounded-2xl p-4 mb-3 text-white shadow-lg" style="background:linear-gradient(135deg,#059669,#047857)"><div class="text-xs opacity-80">👉 YOUR TURN</div><div class="text-lg font-bold">${esc(j.title)}</div><div class="text-sm opacity-90">${esc(STEPS[j.step].n)} - ${esc(j.client)}</div><div class="mt-3 bg-white text-em-dark font-bold rounded-xl py-3 text-center">${j.steps[j.step].state === 'IN_PROGRESS' ? 'Continue task' : 'Open &amp; start'}</div></button>`).join('');
}
const ONBOARD = '<div class="card p-5 text-left max-w-md mx-auto text-slate-700"><div class="font-bold text-em-dark mb-2">Welcome! Get started in 3 steps</div><div class="mb-2">1. Tap <b>Team</b> and add each worker with their own PIN.</div><div class="mb-2">2. Tap <b>+ New job</b> and assign a person to every step.</div><div>3. Send workers the link ending in <b>worker.html</b>.</div></div>';
const WEMPTY = '<div class="card p-5 max-w-md mx-auto text-slate-700">No tasks here yet. When Admin assigns you a job it appears automatically. Tap the green dot at the top to refresh.</div>';
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); dip = e; const b = $('inst'); if (b) b.classList.remove('hidden'); });

/* ---------- Modals---------- */
const M = {
  show(h) { open = null; $('mbody').innerHTML = h; $('modal').classList.remove('hidden'); $('modal').classList.add('flex'); icons(); },
  close() { open = null; $('modal').classList.add('hidden'); $('modal').classList.remove('flex'); },
  head(t, sub) { return `<div class="sticky top-0 hd text-white px-4 py-4 flex items-start gap-3 z-10"><div class="flex-1 min-w-0"><div class="font-bold">${t}</div>${sub ? `<div class="text-xs text-emerald-200">${sub}</div>` : ''}</div><button class="p-2 -m-2" aria-label="Close" onclick="M.close()"><i data-lucide="x" class="w-5 h-5"></i></button></div>`; },
  newJob() {
    M.show(M.head('New job') + `<div class="p-4"><label class="lbl">Client name</label><input id="nc" class="inp"><label class="lbl">Furniture item</label><input id="nt" class="inp" placeholder="e.g. Master bedroom wardrobe"><label class="lbl">Site address</label><input id="na" class="inp">
    <div class="font-bold mt-4">Assign people to steps</div>${STEPS.map((s, i) => '<label class="lbl">' + (i + 1) + '. ' + s.n + '</label>' + asel('as' + i, '')).join('')}
    <button class="btn bg-em text-white w-full mt-4" onclick="A_create()">Create job</button></div>`);
  },
  issue(id) {
    M.show(M.head('Report issue / delay', esc(jobs[id].title)) + `<div class="p-4"><label class="lbl">Category</label><select id="icat" class="inp">${CATS.map(c => `<option>${c}</option>`).join('')}</select>
    <label class="lbl">What happened?</label><textarea id="inote" rows="3" class="inp"></textarea>
    <button class="btn bg-red-600 text-white w-full mt-4" onclick="A_issue('${id}')"><i data-lucide="flag" class="w-4 h-4"></i>Flag job in red</button></div>`);
  },
  job(id) {
    const j = jobs[id]; if (!j) return M.close();
    const s = j.steps[j.step], st = s.state, admin = role === 'admin', blocked = !!j.issue, can = admin || s.uid === user.id, dis = can ? '' : 'disabled';
    let h = M.head(esc(j.title), esc(j.client) + (j.address ? ' - ' + esc(j.address) : '') + ' - ' + j.id);
    h += '<div class="p-4 space-y-4">';
    if (j.issue && (admin || j.issue.uid === user.id)) {
      const i = j.issue;
      h += `<div class="border-2 border-red-500 bg-red-50 rounded-xl p-3"><div class="font-bold text-red-700 flex items-center gap-2"><i data-lucide="flag" class="w-4 h-4"></i>${esc(i.cat)} - blocked</div>
      <div class="text-sm mt-1">${esc(i.note) || 'No description'}<div class="text-xs text-slate-500">Reported by ${esc(i.by)}, ${fdt(i.at)}, at step ${i.step + 1}</div></div>
      ${i.comments.map(c => `<div class="text-sm bg-white rounded-lg p-2 mt-2"><b>${esc(c.by)}</b> <span class="text-xs text-slate-500">${fdt(c.at)}</span><br>${esc(c.text)}</div>`).join('')}
      <textarea id="cmt" rows="2" class="inp mt-2" placeholder="Add comment"></textarea>
      <div class="flex gap-2 mt-2"><button class="btn bg-char text-white flex-1" onclick="A_comment('${id}')">Add comment</button>
      ${admin ? `<button class="btn bg-em text-white flex-1" onclick="A_resolve('${id}')">Resolve issue</button>` : ''}</div>
      ${admin ? '' : '<div class="text-xs text-slate-500 mt-2">Only Admin can resolve issues.</div>'}</div>`;
    } else if (j.issue) h += '<div class="border-2 border-red-500 bg-red-50 rounded-xl p-3 font-bold text-red-700">On hold - waiting for Admin</div>';
    if (j.done) h += `<div class="bg-emerald-50 border border-em rounded-xl p-3 text-em-dark font-semibold">Completed ${fdt(j.completedAt)}. Total ${dur(new Date(j.completedAt) - new Date(j.createdAt))}</div>`;
    else {
      h += `<div class="border rounded-xl p-3"><div class="font-bold text-em-dark">Step ${j.step + 1} of 6: ${STEPS[j.step].n}</div><div class="text-xs text-slate-500 mb-1">${SL[st]}${clock(j) ? ' - ' + dur(Date.now() - new Date(clock(j))) + ' in this step' : ''}</div>`;
      h += STEPS[j.step].f.map(([k, l, t, o]) => {
        const v = s.d[k] || '', a = `data-k="${k}" ${dis}`;
        return `<label class="lbl">${l}</label>` + (t === 'area' ? `<textarea ${a} rows="2" class="inp">${esc(v)}</textarea>` :
          t === 'sel' ? `<select ${a} class="inp"><option value="">Select</option>${o.map(x => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('')}</select>` :
          `<input ${a} type="${t === 'url' ? 'url' : 'text'}" class="inp" value="${esc(v)}">`);
      }).join('');
      if (!can) h += `<div class="text-sm mt-3 text-slate-600">Waiting for: <b>${esc(s.an || 'Admin (unassigned)')}</b></div>`;
      else if (st === 'IN_PROGRESS') h += `<div class="text-sm mt-3">Responsible: <b>${esc(s.worker)}</b> - started ${fdt(s.start)}</div>
        <div class="flex gap-2 mt-3"><button class="btn bg-char text-white flex-1" onclick="A_saveDetails('${id}')">Save details</button>
        <button class="btn bg-em text-white flex-1" ${blocked ? 'disabled' : ''} onclick="A_finish('${id}')">${j.step < 5 ? 'Finish &amp; forward' : 'Finish &amp; hand over'}</button></div>`;
      else {
        const takeover = st === 'PENDING_TAKEOVER';
        h += `<div class="text-sm mt-3">${takeover ? 'Taking over from <b>' + esc(j.steps[j.step - 1].worker) + '</b> as ' : 'Starting as '}<b>${esc(myName())}</b></div>
        <div class="flex gap-2 mt-3"><button class="btn bg-char text-white flex-1" onclick="A_saveDetails('${id}')">Save details</button>
        <button class="btn bg-em text-white flex-1" ${blocked ? 'disabled' : ''} onclick="A_${takeover ? 'takeover' : 'start'}('${id}')">${takeover ? 'Confirm takeover &amp; begin' : 'Start task'}</button></div>`;
      }
      h += blocked ? '<div class="text-xs text-red-600 mt-2">Workflow blocked until the issue is resolved.</div>' : '';
      h += '</div>';
    }
    if (!admin && !j.done) h += `<button class="btn border border-slate-300 w-full" onclick="M.note('${id}')">✉ Message to Admin (delay reason / note)</button>`;
    if (!blocked && !j.done && can) h += `<button class="btn border border-red-300 text-red-700 w-full" onclick="M.issue('${id}')">🚩 Report Issue / Delay</button>`;
    h += `<div><div class="flex items-center justify-between mb-2"><div class="font-bold">Audit log</div><span class="flex gap-3 ${admin ? '' : 'hidden'}"><button class="text-xs underline text-em-dark" onclick="A_share('${id}')">WhatsApp</button><button class="text-xs underline text-em-dark" onclick="A_card('${id}')">PDF job card</button>${admin ? `<button class="text-xs underline text-em-dark" onclick="A_csv('${id}')">Export CSV</button>` : ''}</span></div><div class="overflow-x-auto"><table class="w-full text-sm min-w-[560px]"><thead class="text-left text-xs text-slate-500"><tr><th class="py-1">Step</th><th>Worker</th><th>Start</th><th>Finish</th><th>Duration</th></tr></thead><tbody>`;
    h += j.steps.map((x, i) => {
      const d = x.start ? (x.end ? new Date(x.end) - new Date(x.start) : Date.now() - new Date(x.start)) : null;
      const det = STEPS[i].f.filter(f => x.d[f[0]]).map(f => `${f[1]}: ${esc(x.d[f[0]])}`).join(' | ');
      return `<tr class="border-t align-top"><td class="py-2 pr-2"><b>${i + 1}.</b> ${STEPS[i].n}<div class="text-xs text-slate-500">${SL[x.state]}</div>${det ? `<div class="text-xs text-slate-600 mt-1">${det}</div>` : ''}</td>
      <td>${esc(x.worker) || '-'}${x.takeover && i ? '<div class="text-xs text-slate-500">took over</div>' : ''}</td><td>${fdt(x.start)}</td><td>${fdt(x.end)}</td><td>${dur(d)}${x.start && !x.end ? ' (running)' : ''}</td></tr>`;
    }).join('') + '</tbody></table></div></div>';
    if (j.issues.length) h += `<div><div class="font-bold mb-2">Resolved issues</div>${j.issues.map(i => `<div class="text-sm border-t py-2"><b>${esc(i.cat)}</b> (step ${i.step + 1}) by ${esc(i.by)}, ${fdt(i.at)} - resolved ${fdt(i.resolvedAt)}<div class="text-xs text-slate-500">${esc(i.note)} ${i.comments.map(c => '| ' + esc(c.by) + ': ' + esc(c.text)).join(' ')}</div></div>`).join('')}</div>`;
    h += extraBlock(j, id);
    if (admin) h += `<button class="text-xs text-red-600 underline" onclick="A_delete('${id}')">Delete job</button>`;
    h += '</div>';
    M.show(h); open = id;
  }
};
M.po = id => { const j = jobs[id]; M.show(M.head('New purchase order', esc(j.title)) + '<div class="p-4"><label class="lbl">Supplier name</label><input id="ps" class="inp"><label class="lbl">Supplier WhatsApp number (optional)</label><input id="pp" class="inp" inputmode="tel" placeholder="07x xxx xxxx"><label class="lbl">Deliver to</label><input id="pl" class="inp" value="' + esc(j.address || 'SP Home workshop, Narammala') + '"><label class="lbl">Required by</label><input id="pdt" type="date" class="inp"><div class="font-bold mt-4 mb-1">Materials</div><div id="prows">' + poRow() + poRow() + poRow() + '</div><button class="btn border border-slate-300 w-full" onclick="$(\'prows\').insertAdjacentHTML(\'beforeend\', poRow())">+ Add material</button><label class="lbl">Notes</label><textarea id="pn" rows="2" class="inp"></textarea><button class="btn bg-em text-white w-full mt-4" onclick="A_poSave(\'' + id + '\')">Create purchase order</button></div>'); };
M.note = id => M.show(M.head('Message to Admin', esc(jobs[id].title)) + '<div class="p-4"><label class="lbl">Type</label><select id="nk" class="inp"><option>Delay reason</option><option>Problem / issue</option><option>General note</option></select><label class="lbl">Message (only Admin can see this)</label><textarea id="ntx" rows="4" class="inp"></textarea><button class="btn bg-em text-white w-full mt-4" onclick="A_note(\'' + id + '\')">Send to Admin</button></div>');
M.team = () => M.show(M.head('Team & PINs') + '<div class="p-4">' + users.filter(u => u.active).map(u => '<div class="flex items-center gap-3 py-2 border-b"><div class="flex-1"><b>' + esc(u.name) + '</b> <span class="text-xs text-slate-500">' + u.role + '</span></div><button class="text-xs underline" onclick="A_setPin(\'' + u.id + '\')">Reset PIN</button>' + (u.role === 'admin' ? '' : '<button class="text-xs underline text-red-600" onclick="A_delUser(\'' + u.id + '\')">Remove</button>') + '</div>').join('') + '<div class="font-bold mt-4">Add worker</div><label class="lbl">Name</label><input id="un" class="inp"><label class="lbl">PIN (4-8 digits, must be unique)</label><input id="up" class="inp" inputmode="numeric" maxlength="8"><button class="btn bg-em text-white w-full mt-3" onclick="A_addUser()">Add worker</button></div>');

/* ---------- Rendering ---------- */
function render() {
  if (!user) return;
  const inbox = role === 'admin' && view === 'inbox';
  ['metrics', 'alerts', 'fbar'].forEach(id => $(id).classList.toggle('hidden', inbox));
  $('fS').classList.toggle('hidden', role !== 'admin');
  $('who').textContent = user.name + ' - ' + role;
  const all = Object.values(jobs).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const cnt = {active: all.filter(j => !j.done).length, done: all.filter(j => j.done).length, issue: all.filter(j => j.issue).length, delayed: all.filter(isDelayed).length};
  const admin = role === 'admin';
  { const h = new Date().getHours(), n = admin ? unread() : 0, w = all.filter(j => !j.done && !j.issue && j.steps[j.step].uid === user.id).length;
    $('hello').innerHTML = '<div class="text-2xl font-bold text-em-dark">' + (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + ', ' + esc(user.name.split(' ')[0]) + '</div><div class="text-sm text-slate-500">' +
      (admin ? cnt.active + ' active job' + (cnt.active === 1 ? '' : 's') + (n ? ' - <button class="text-red-600 font-bold underline" onclick="setView(\'inbox\')">' + n + ' new message' + (n === 1 ? '' : 's') + '</button>' : '') : (w ? w + ' task' + (w === 1 ? '' : 's') + ' waiting for you' : 'Nothing waiting for you right now')) + '</div>'; }
  $('metrics').innerHTML = admin ? [['Active jobs', cnt.active, 'text-em-dark', 'hammer'], ['Completed', cnt.done, 'text-char', 'check-circle'], ['Issues pending', cnt.issue, 'text-red-600', 'flag'], ['Delayed (>24h)', cnt.delayed, 'text-amber-600', 'clock']]
    .map(m => `<div class="card p-3"><div class="flex justify-between text-xs text-slate-500">${m[0]}<i data-lucide="${m[3]}" class="w-4 h-4"></i></div><div class="text-3xl font-bold ${m[2]}">${m[1]}</div></div>`).join('') : workerMetrics(all);
  const iss = admin ? all.filter(j => j.issue) : [];
  $('alerts').innerHTML = !admin ? workerHero(all) : iss.length ? `<div class="bg-red-50 border border-red-300 rounded-xl p-3"><div class="font-bold text-red-700 mb-1">Issue alerts (${iss.length})</div>${iss.map(j => `<button onclick="M.job('${j.id}')" class="w-full text-left text-sm py-2 border-t border-red-200 flex gap-2"><span class="font-semibold">${esc(j.title)}</span><span class="text-red-700">${esc(j.issue.cat)}</span><span class="ml-auto text-xs text-slate-500">${esc(j.issue.by)}, ${fdt(j.issue.at)}</span></button>`).join('')}</div>` : '';
  const fd = $('fD'), fv = fd.value || 'all';
  if (!fd.options.length) fd.innerHTML = '<option value="all">All departments</option>' + STEPS.map((s, i) => `<option value="${i}">${s.dept}</option>`).join('');
  fd.value = fv;
  const fsEl = $('fS'), mode = admin ? 'a' : 'w';
  if (fsEl.dataset.m !== mode) { fsEl.dataset.m = mode; fsEl.innerHTML = admin ? FS_ADMIN : '<option value="mine">My tasks</option><option value="arch">Archive (done by me)</option>'; }
  fd.classList.toggle('hidden', !admin); $('bNew').classList.toggle('hidden', !admin); $('bTeam').classList.toggle('hidden', !admin);
  const q = $('fQ').value.toLowerCase(), fs = admin ? $('fS').value : 'all';
  const list = (admin ? all : all.filter(j => wFilter(j, $('fS').value))).filter(j => (fs === 'all' || (fs === 'active' ? !j.done : fs === 'done' ? j.done : status(j) === fs || (fs === 'delayed' && isDelayed(j)))) &&
    (fv === 'all' || (!j.done && j.step === +fv)) && (j.title + j.client).toLowerCase().includes(q));
  $('list').innerHTML = inbox ? inboxHtml() : list.length ? list.map(j => {
    const s = j.steps[j.step], red = !!j.issue, d = isDelayed(j) && (admin || s.uid === user.id);
    return `<button onclick="M.job('${j.id}')" class="card text-left p-4 border-l-[6px] ${red ? 'border-red-500 pulse-red' : d ? 'border-amber-500' : j.done ? 'border-emerald-300' : 'border-em'}">
    <div class="flex items-start gap-2"><div class="flex-1 min-w-0"><div class="font-bold truncate">${esc(j.title)}</div><div class="text-xs text-slate-500 truncate">${esc(j.client)} - ${j.id}</div></div>
    ${red ? '<span class="text-xs font-bold bg-red-600 text-white rounded px-2 py-0.5">' + (admin || j.issue.uid === user.id ? 'ISSUE' : 'ON HOLD') + '</span>' : d ? '<span class="text-xs font-bold bg-amber-500 text-white rounded px-2 py-0.5">DELAYED</span>' : j.done ? '<span class="text-xs font-bold bg-em text-white rounded px-2 py-0.5">DONE</span>' : ''}</div>
    <div class="flex gap-1 my-2">${j.steps.map(x => `<div class="h-1.5 flex-1 rounded ${x.state === 'DONE' ? 'bg-em' : x.state === 'IN_PROGRESS' ? 'bg-em/50' : x.state === 'PENDING_TAKEOVER' ? 'bg-amber-400' : 'bg-slate-200'}"></div>`).join('')}</div>
    <div class="text-sm">${j.done ? 'All 6 steps complete' : `Step ${j.step + 1}: ${STEPS[j.step].n}`}</div>
    <div class="text-xs text-slate-500">${j.done ? '' : SL[s.state] + (s.worker ? ' - ' + esc(s.worker) : s.an ? ' - ' + esc(s.an) : '')}</div>${red ? `<div class="text-xs text-red-700 font-semibold mt-1">${esc(j.issue.cat)}</div>` : ''}</button>`;
  }).join('') : '<div class="col-span-full text-center text-slate-500 py-12">' + (admin ? (Object.keys(jobs).length ? 'No jobs match your filters.' : ONBOARD) : WEMPTY) + '</div>';
  renderNav(); icons();
  if (open && !jobs[open]) M.close();
  else if (open && !(document.activeElement && $('mbody').contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) {
    const keep = [...document.querySelectorAll('#mbody [data-k],#memo,#cmt')].map(e => [e.dataset.k ? '[data-k="' + e.dataset.k + '"]' : '#' + e.id, e.value]);
    const sc = $('mbody').scrollTop, id = open;
    M.job(id); $('mbody').scrollTop = sc;
    keep.forEach(([sel, v]) => { const e = document.querySelector('#mbody ' + sel); if (e && v) e.value = v; });
  }
}

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
document.addEventListener('keydown', e => { if (e.key === 'Escape') M.close(); });
window.addEventListener('unhandledrejection', () => toast('Something went wrong - please retry'));
window.addEventListener('error', () => toast('Something went wrong - please retry'));
boot();
setInterval(render, 60000);
