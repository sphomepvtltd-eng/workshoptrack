/**
 * SP Workshop backend - Google Apps Script (data stored in a Google Sheet in your Drive).
 * Setup: script.google.com > New project > paste > Save > run setup() once > Deploy > New deployment > Web app
 * (Execute as: Me, Who has access: Anyone) > copy the /exec URL. After edits: Manage deployments > Edit > New version.
 * Lost the admin PIN? Run resetAdminPin() in the editor (PIN becomes 0000), then change it in the app.
 */
const JOBS = 'jobs', USERS = 'users', ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const HEAD = {jobs: ['id', 'updatedAt', 'json'], users: ['id', 'name', 'role', 'hash', 'active']};

function setup() { sheet_(JOBS); sheet_(USERS); Logger.log('Sheet ready: ' + ss_().getUrl()); }
function resetAdminPin() {
  const a = users_().find(u => u.role === 'admin');
  if (!a) return Logger.log('No admin yet - create it in the app.');
  sheet_(USERS).getRange(a.row, 4).setValue(hash_('0000')); Logger.log('Admin PIN is now 0000 - change it in the app.');
}
function ss_() {
  const p = PropertiesService.getScriptProperties(); let ss = null, id = p.getProperty('SSID');
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) { ss = SpreadsheetApp.create('SP Workshop Data'); p.setProperty('SSID', ss.getId()); }
  return ss;
}
function sheet_(name) {
  const ss = ss_(); let s = ss.getSheetByName(name);
  if (!s) { s = ss.insertSheet(name); s.appendRow(HEAD[name]); s.setFrozenRows(1); }
  return s;
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function err_(c) { return out_({ok: false, error: c}); }
function doGet() { return ContentService.createTextOutput('SP Workshop API OK'); }

function hash_(pin) {
  const p = PropertiesService.getScriptProperties(); let salt = p.getProperty('SALT');
  if (!salt) { salt = Utilities.getUuid(); p.setProperty('SALT', salt); }
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin));
}
function users_() {
  const s = sheet_(USERS), n = s.getLastRow() - 1; if (n < 1) return [];
  return s.getRange(2, 1, n, 5).getValues().map((r, i) => ({row: i + 2, id: String(r[0]), name: String(r[1]), role: String(r[2]), hash: String(r[3]), active: r[4] === true || r[4] === 'TRUE'}));
}
const pub_ = u => ({id: u.id, name: u.name, role: u.role, active: u.active});
const pinOk_ = p => /^\d{4,8}$/.test(String(p));
function auth_(pin) {
  const c = CacheService.getScriptCache();
  if ((+c.get('fails') || 0) >= 10) throw new Error('locked');
  if (pinOk_(pin)) { const h = hash_(String(pin)), u = users_().find(x => x.active && x.hash === h); if (u) { c.remove('fails'); return u; } }
  c.put('fails', String((+c.get('fails') || 0) + 1), 600); throw new Error('auth');
}
function addUser_(name, role, pin) { sheet_(USERS).appendRow(['U' + Utilities.getUuid().replace(/-/g, '').slice(0, 8), name, role, hash_(String(pin)), true]); }
const name_ = (n, role) => { n = String(n || '').trim().slice(0, 40); return !n || (role === 'worker' && /^admin$/i.test(n)) ? '' : n; };

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const b = JSON.parse(e.postData.contents), a = b.action;
    if (a === 'status') return out_({ok: true, init: users_().length === 0});
    if (a === 'init') {
      if (users_().length) return err_('forbidden');
      const n = name_(b.name, 'admin'); if (!n) return err_('badname'); if (!pinOk_(b.newPin)) return err_('badpin');
      addUser_(n, 'admin', b.newPin); return out_({ok: true});
    }
    const u = auth_(b.pin);
    if (a === 'login') return out_({ok: true, user: pub_(u)});
    if (a === 'list') return list_(u);
    if (a === 'save') return save_(u, b.job);
    if (u.role !== 'admin') return err_('forbidden');
    if (a === 'poNo') { const p = PropertiesService.getScriptProperties(), n = (+p.getProperty('PO') || 0) + 1; p.setProperty('PO', String(n)); return out_({ok: true, no: 'PO-' + ('000' + n).slice(-4)}); }
    if (a === 'delete') { const f = jobs_().find(r => r.job.id === b.id); if (f) sheet_(JOBS).deleteRow(f.row); return out_({ok: true}); }
    if (a === 'addUser') {
      const n = name_(b.name, 'worker'); if (!n) return err_('badname'); if (!pinOk_(b.newPin)) return err_('badpin');
      const h = hash_(String(b.newPin)); if (users_().some(x => x.active && x.hash === h)) return err_('dup');
      addUser_(n, 'worker', b.newPin); return out_({ok: true});
    }
    const t = users_().find(x => x.id === b.uid); if (!t) return err_('forbidden');
    if (a === 'setPin') {
      if (!pinOk_(b.newPin)) return err_('badpin');
      const h = hash_(String(b.newPin)); if (users_().some(x => x.active && x.hash === h && x.id !== t.id)) return err_('dup');
      sheet_(USERS).getRange(t.row, 4).setValue(h); return out_({ok: true});
    }
    if (a === 'delUser') { if (t.role === 'admin') return err_('forbidden'); sheet_(USERS).getRange(t.row, 5).setValue(false); return out_({ok: true}); }
    return err_('badaction');
  } catch (x) { return err_(String(x.message || x)); } finally { try { lock.releaseLock(); } catch (z) {} }
}

function jobs_() {
  const s = sheet_(JOBS), n = s.getLastRow() - 1; if (n < 1) return [];
  return s.getRange(2, 1, n, 3).getValues().map((r, i) => { try { return {row: i + 2, job: JSON.parse(r[2])}; } catch (e) { return null; } }).filter(x => x && x.job && Array.isArray(x.job.steps));
}
function view_(j, u, names) {
  const c = JSON.parse(JSON.stringify(j));
  if (u.role !== 'admin' && !c.steps.some(s => s.uid === u.id)) return null;
  c.steps.forEach(s => { s.an = names[s.uid] || ''; });
  if (u.role === 'admin') return c;
  delete c.memo; delete c.pos;
  c.notes = (c.notes || []).filter(n => n.uid === u.id);
  c.issues = (c.issues || []).filter(i => i.uid === u.id);
  if (c.issue && c.issue.uid !== u.id) c.issue = {cat: 'On hold', note: '', by: '', uid: '', at: c.issue.at, step: c.issue.step, comments: []};
  return c;
}
function list_(u) {
  const us = users_(), names = {}; us.forEach(x => { names[x.id] = x.name; });
  const jobs = {}; jobs_().forEach(r => { const v = view_(r.job, u, names); if (v) jobs[v.id] = v; });
  return out_({ok: true, user: pub_(u), jobs: jobs, users: u.role === 'admin' ? us.map(pub_) : []});
}
function merge_(old, inc, u) {
  const j = JSON.parse(JSON.stringify(old)), me = u.id, cur = old.steps[old.step], t = new Date().toISOString();
  if (!old.steps.some(s => s.uid === me) || !Array.isArray(inc.steps)) return null;
  inc.steps.forEach((x, i) => {
    const o = j.steps[i]; if (!o || !x) return;
    if (o.uid === me && ['LOCKED', 'PENDING', 'PENDING_TAKEOVER', 'IN_PROGRESS', 'DONE'].indexOf(x.state) >= 0) ['state', 'worker', 'takeover', 'start', 'end', 'd'].forEach(k => { o[k] = x[k]; });
    else if (i === old.step + 1 && o.state === 'LOCKED' && x.state === 'PENDING_TAKEOVER' && cur.uid === me) o.state = 'PENDING_TAKEOVER';
  });
  if (cur.uid === me && !old.issue && inc.step >= old.step && inc.step <= old.step + 1 && inc.step <= 5) {
    j.step = inc.step; if (old.step === 5 && inc.done) { j.done = true; j.completedAt = t; }
  }
  j.issue && (j.issue.comments = j.issue.comments || []);
  if (!old.issue && inc.issue && !inc.issue.resolvedAt) {
    const i = inc.issue; j.issue = {cat: String(i.cat || '').slice(0, 60), note: String(i.note || '').slice(0, 500), by: u.name, uid: me, at: t, step: old.step, comments: []};
  } else if (old.issue && old.issue.uid === me && inc.issue) {
    (inc.issue.comments || []).forEach(c => { if (c.by === u.name && !j.issue.comments.some(o => o.at === c.at && o.text === c.text)) j.issue.comments.push({by: u.name, text: String(c.text || '').slice(0, 500), at: c.at}); });
  }
  j.notes = j.notes || [];
  (inc.notes || []).forEach(n => { if (n && n.uid === me && !j.notes.some(o => o.id === n.id)) j.notes.push({id: String(n.id).slice(0, 40), uid: me, by: u.name, kind: String(n.kind || 'Note').slice(0, 30), text: String(n.text || '').slice(0, 500), at: n.at || t}); });
  return j;
}
function save_(u, j) {
  if (!j || !ID_RE.test(String(j.id)) || !Array.isArray(j.steps) || j.steps.length !== 6) return err_('badjob');
  const sv = j.sv; delete j.sv; j.steps.forEach(s => { delete s.an; });
  if (JSON.stringify(j).length > 45000) return err_('toolarge');
  const f = jobs_().find(r => r.job.id === j.id), t = new Date().toISOString();
  let out;
  if (u.role === 'admin') { if (f && sv !== f.job.updatedAt) return err_('conflict'); out = j; }
  else { if (!f) return err_('conflict'); out = merge_(f.job, j, u); if (!out) return err_('forbidden'); }
  out.updatedAt = t;
  const row = [out.id, t, JSON.stringify(out)], s = sheet_(JOBS);
  if (f) s.getRange(f.row, 1, 1, 3).setValues([row]); else s.appendRow(row);
  return out_({ok: true, updatedAt: t});
}
