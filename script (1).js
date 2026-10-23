/* APAAR SmartVerify - client-side demo application
   Validation engine, role-based UI, audit log, exports. Synthetic data only. */
(() => {
'use strict';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */
const STORE_KEY = 'apaar_smartverify_v1';
const SESSION_KEY = 'apaar_smartverify_session';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;
const PAGE_SIZE = 10;

const FIELDS = [
  { k: 'ref', l: 'Institution Student Reference' },
  { k: 'name', l: 'Student Name' },
  { k: 'apaar', l: 'APAAR ID' },
  { k: 'dob', l: 'Date of Birth' },
  { k: 'admYear', l: 'Admission Year' },
  { k: 'course', l: 'Course / Program' },
  { k: 'dept', l: 'Department' },
  { k: 'acadYear', l: 'Academic Year' },
  { k: 'docStatus', l: 'Required Document Status' }
];
const FIELD_LABEL = Object.fromEntries(FIELDS.map(f => [f.k, f.l]));

const SYNONYMS = {
  ref: ['ref', 'reference', 'studentref', 'institutionstudentreference', 'rollno', 'rollnumber', 'studentid', 'regno', 'registerno'],
  name: ['name', 'studentname', 'fullname'],
  apaar: ['apaar', 'apaarid', 'apaarno'],
  dob: ['dob', 'dateofbirth', 'birthdate'],
  admYear: ['admyear', 'admissionyear', 'yearofadmission', 'joinyear'],
  course: ['course', 'program', 'programme', 'courseorprogram', 'degree'],
  dept: ['dept', 'department', 'branch'],
  acadYear: ['acadyear', 'academicyear', 'ay', 'session'],
  docStatus: ['docstatus', 'documentstatus', 'requireddocumentstatus', 'documents']
};

const RULES = [
  { id: 'REQ-001', name: 'Mandatory field present', cat: 'Missing data', sev: 'error' },
  { id: 'FMT-DOB', name: 'Date of birth is a valid date', cat: 'Format', sev: 'error' },
  { id: 'FMT-ID', name: 'Identifier matches configured pattern', cat: 'Format', sev: 'error' },
  { id: 'FMT-YEAR', name: 'Admission year within configured range', cat: 'Format', sev: 'error' },
  { id: 'DUP-ID', name: 'Duplicate APAAR ID within dataset', cat: 'Exact duplicate', sev: 'error' },
  { id: 'DUP-REF', name: 'Duplicate institution reference', cat: 'Exact duplicate', sev: 'error' },
  { id: 'DUP-FUZZY', name: 'Possible duplicate (name similarity)', cat: 'Possible duplicate', sev: 'warning' },
  { id: 'XF-ACAD', name: 'Academic year consistent with admission year', cat: 'Cross-field', sev: 'error' },
  { id: 'XF-AGE', name: 'Age at admission not below configured minimum', cat: 'Cross-field', sev: 'warning' },
  { id: 'DOC-STATUS', name: 'Document status reported as complete', cat: 'Document', sev: 'warning' },
  { id: 'DOC-CMP', name: 'Document text matches record fields', cat: 'Document', sev: 'warning' },
  { id: 'UNU-AGE', name: 'Age at admission not above configured maximum', cat: 'Unusual pattern', sev: 'warning' }
];
const CATS = [...new Set(RULES.map(r => r.cat))];

const USERS = [
  { email: 'admin@demo.edu', pw: 'Admin@123', name: 'Demo Administrator', role: 'Administrator' },
  { email: 'staff@demo.edu', pw: 'Staff@123', name: 'Demo Data Entry', role: 'Data Entry Staff' },
  { email: 'reviewer@demo.edu', pw: 'Review@123', name: 'Demo Reviewer', role: 'Reviewer' }
];
const PERMS = {
  'Administrator': ['view', 'upload', 'edit', 'review', 'validate', 'export', 'settings', 'audit'],
  'Data Entry Staff': ['view', 'upload', 'edit', 'validate', 'export', 'audit'],
  'Reviewer': ['view', 'review', 'validate', 'export', 'audit']
};

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (() => { let n = Date.now(); return p => p + (n++).toString(36) + Math.floor(Math.random() * 1296).toString(36); })();
const nowISO = () => new Date().toISOString();
const fmtTime = iso => { try { return new Date(iso).toLocaleString(); } catch (e) { return iso || ''; } };
const blank = v => v === undefined || v === null || String(v).trim() === '';
const pad = (n, w) => String(n).padStart(w, '0');

function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */
function defaultSettings() {
  const severity = {};
  RULES.forEach(r => severity[r.id] = r.sev);
  return {
    institution: 'Demo Institute of Technology (synthetic)',
    required: ['ref', 'name', 'dob', 'admYear', 'dept'],
    apaarPattern: '^\\d{12}$',
    dupThreshold: 88, minYear: 2000, minAge: 16, maxAge: 40,
    weights: { completeness: 30, format: 30, consistency: 25, review: 15 },
    severity,
    retentionDays: 90,
    ruleVersion: 1,
    ruleHistory: [{ version: 1, at: nowISO(), by: 'system', summary: 'Initial default rule set' }],
    checklist: [
      { id: uid('c'), text: 'Mandatory fields completed for every student', source: 'Institution-defined (demo)', effective: '', verified: false },
      { id: uid('c'), text: 'Dates of birth in a valid date format', source: 'Institution-defined (demo)', effective: '', verified: false },
      { id: uid('c'), text: 'Identifier pattern (12 digits) - assumed demo pattern', source: 'Not verified against any official specification', effective: '', verified: false }
    ]
  };
}
function freshState() {
  return { records: [], findings: [], decisions: {}, runs: [], audit: [], versions: [], exports: [],
           datasetName: '', importedAt: '', settings: defaultSettings() };
}
let state = freshState();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      state = Object.assign(freshState(), s);
      state.settings = Object.assign(defaultSettings(), s.settings || {});
    }
  } catch (e) { state = freshState(); }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Could not save to browser storage (storage full or blocked).', 'error'); }
}
let session = null;
function loadSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (s && Date.now() - s.at < 8 * 3600 * 1000) session = s; else session = null;
  } catch (e) { session = null; }
}
const can = a => !!session && (PERMS[session.role] || []).includes(a);

function audit(action, target = '', detail = '') {
  state.audit.push({ id: uid('a'), at: nowISO(), user: session ? session.email : 'system', role: session ? session.role : '', action, target, detail });
  if (state.audit.length > 2000) state.audit.splice(0, state.audit.length - 2000);
  save();
}

/* ------------------------------------------------------------------ */
/* Date + similarity helpers                                           */
/* ------------------------------------------------------------------ */
function parseDate(s) {
  if (blank(s)) return null;
  s = String(s).trim();
  let y, m, d, mt;
  if ((mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || dt.getTime() > Date.now()) return null;
  return `${y}-${pad(m, 2)}-${pad(d, 2)}`;
}
function tokenSort(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).sort().join(' '); }
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function similarity(a, b) {
  const x = tokenSort(a), y = tokenSort(b);
  const L = Math.max(x.length, y.length);
  if (!L) return 0;
  return Math.round((1 - lev(x, y) / L) * 100);
}

/* ------------------------------------------------------------------ */
/* Validation engine                                                   */
/* ------------------------------------------------------------------ */
function validate(records, S, decisions) {
  const out = [];
  const thisYear = new Date().getFullYear();
  let apaarRe = null;
  try { apaarRe = new RegExp(S.apaarPattern); } catch (e) { apaarRe = null; }

  const add = (rec, ruleId, field, message, action, extra = '') => {
    const rule = RULES.find(r => r.id === ruleId);
    const key = [ruleId, rec.id, field, extra].join('|');
    const d = decisions[key];
    out.push({ key, recId: rec.id, ref: rec.v.ref || '(no reference)', field, cat: rule.cat, ruleId,
      severity: S.severity[ruleId] || rule.sev, message, action, extra,
      status: d ? d.status : 'open', note: d ? d.note : '' });
  };

  records.forEach(rec => {
    const v = rec.v;
    S.required.forEach(f => {
      if (blank(v[f])) add(rec, 'REQ-001', f, `${FIELD_LABEL[f]} is missing or blank.`, `Enter the correct ${FIELD_LABEL[f]} from the source record. Do not guess values.`);
    });
    if (!blank(v.dob) && !parseDate(v.dob))
      add(rec, 'FMT-DOB', 'dob', `Date of birth "${v.dob}" is not a valid past date (expected DD-MM-YYYY or YYYY-MM-DD).`, 'Verify the date against the source record and correct it.');
    if (!blank(v.apaar) && apaarRe && !apaarRe.test(String(v.apaar).trim()))
      add(rec, 'FMT-ID', 'apaar', `APAAR ID "${v.apaar}" does not match the configured pattern (${S.apaarPattern}).`, 'Check the identifier at source. Never generate or guess an ID.');
    if (!blank(v.admYear)) {
      const y = String(v.admYear).trim();
      if (!/^\d{4}$/.test(y) || +y < S.minYear || +y > thisYear)
        add(rec, 'FMT-YEAR', 'admYear', `Admission year "${v.admYear}" is outside the configured range ${S.minYear}-${thisYear}.`, 'Correct the admission year from admission records.');
    }
    // cross-field
    const adm = /^\d{4}$/.test(String(v.admYear || '').trim()) ? +String(v.admYear).trim() : null;
    if (!blank(v.acadYear)) {
      const m = String(v.acadYear).trim().match(/^(\d{4})/);
      if (!m) add(rec, 'XF-ACAD', 'acadYear', `Academic year "${v.acadYear}" is not recognised (expected e.g. 2025-26).`, 'Use the format YYYY-YY.');
      else if (adm !== null && (+m[1] < adm || +m[1] > adm + 4))
        add(rec, 'XF-ACAD', 'acadYear', `Academic year ${v.acadYear} starts outside admission year ${adm} to ${adm + 4}.`, 'Check admission year and academic year together.');
    }
    const dob = parseDate(v.dob);
    if (dob && adm !== null) {
      const age = adm - +dob.slice(0, 4);
      if (age < S.minAge) add(rec, 'XF-AGE', 'dob', `Age at admission is about ${age}, below the configured minimum of ${S.minAge}.`, 'Confirm date of birth and admission year.');
      if (age > S.maxAge) add(rec, 'UNU-AGE', 'dob', `Age at admission is about ${age}, above the configured maximum of ${S.maxAge}. Flagged for review only; this is not proof of an error.`, 'Reviewer should confirm the dates are correct.');
    }
    const ds = String(v.docStatus || '').trim().toLowerCase();
    if (ds === 'mismatch') add(rec, 'DOC-STATUS', 'docStatus', 'Document status was reported as a mismatch.', 'Review the supporting document and record values.');
    else if (ds === 'pending' || ds === 'missing') add(rec, 'DOC-STATUS', 'docStatus', `Required document status is "${v.docStatus}".`, 'Obtain and check the required document.');
    if (rec.docResult && rec.docResult.mismatches && rec.docResult.mismatches.length)
      add(rec, 'DOC-CMP', rec.docResult.mismatches[0], `Document text differs from record for: ${rec.docResult.mismatches.map(f => FIELD_LABEL[f]).join(', ')}. Text matching is not proof of authenticity.`, 'Human review required.');
  });

  // exact duplicates
  const group = (field, ruleId, label) => {
    const map = new Map();
    records.forEach(r => { const val = String(r.v[field] ?? '').trim().toLowerCase(); if (val) { if (!map.has(val)) map.set(val, []); map.get(val).push(r); } });
    map.forEach(list => {
      if (list.length > 1) list.forEach(r => {
        const others = list.filter(o => o.id !== r.id).map(o => o.v.ref || '?').join(', ');
        add(r, ruleId, field, `${label} "${r.v[field]}" is also used by: ${others}.`, 'Check which record is correct; correct or remove the duplicate at source.');
      });
    });
  };
  group('apaar', 'DUP-ID', 'APAAR ID');
  group('ref', 'DUP-REF', 'Institution reference');

  // possible duplicates
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i], b = records[j];
      if (blank(a.v.name) || blank(b.v.name)) continue;
      if (String(a.v.dept || '').trim().toLowerCase() !== String(b.v.dept || '').trim().toLowerCase()) continue;
      const sim = similarity(a.v.name, b.v.name);
      if (sim < S.dupThreshold) continue;
      const sameDob = parseDate(a.v.dob) && parseDate(a.v.dob) === parseDate(b.v.dob);
      if (!sameDob && sim < 95) continue;
      add(b, 'DUP-FUZZY', 'name',
        `Name "${b.v.name}" is ${sim}% similar to "${a.v.name}" (ref ${a.v.ref || '?'}) in the same department${sameDob ? ' with the same date of birth' : ''}. This is a suggestion only.`,
        'Reviewer: mark as confirmed duplicate, not a duplicate, or unresolved. Records are never merged automatically.', a.id);
    }
  }
  return out;
}

const closed = f => ['resolved', 'rejected', 'notdup'].includes(f.status);
const decided = f => closed(f) || f.status === 'confirmed';
const blocking = f => f.severity === 'error' && !closed(f);
const isDupCat = f => f.cat === 'Exact duplicate' || f.cat === 'Possible duplicate';
const pendingReview = f => (f.severity === 'warning' || isDupCat(f)) && !decided(f) && !blocking(f);

function metrics() {
  const recs = state.records, F = state.findings;
  const by = {};
  recs.forEach(r => by[r.id] = { err: 0, rev: 0, warn: 0 });
  F.forEach(f => {
    const m = by[f.recId]; if (!m) return;
    if (blocking(f)) m.err++;
    else if (pendingReview(f)) m.rev++;
    if (f.severity === 'warning' && !closed(f)) m.warn++;
  });
  let errors = 0, review = 0, warn = 0, pass = 0;
  recs.forEach(r => { const m = by[r.id]; if (m.err) errors++; else if (m.rev) review++; else pass++; if (m.warn) warn++; });
  const blockingCount = F.filter(blocking).length;
  const pending = F.filter(pendingReview).length;
  return { total: recs.length, errors, review, warn, pass, by, blockingCount, pending,
           eligible: recs.length > 0 && blockingCount === 0 && pending === 0, score: computeScore() };
}
function statusOf(recId) {
  let err = 0, rev = 0;
  state.findings.forEach(f => { if (f.recId !== recId) return; if (blocking(f)) err++; else if (pendingReview(f)) rev++; });
  return err ? 'error' : rev ? 'review' : 'pass';
}

/* Data-quality score: weighted average of applicable dimensions. */
function computeScore() {
  const S = state.settings, recs = state.records, F = state.findings;
  if (!recs.length) return { value: null, dims: [], note: 'No records loaded.' };
  const dims = [];
  const reqCells = recs.length * S.required.length;
  if (reqCells) {
    const missing = F.filter(f => f.ruleId === 'REQ-001' && !closed(f)).length;
    dims.push({ key: 'completeness', label: 'Mandatory-field completeness', weight: S.weights.completeness, value: Math.max(0, (reqCells - missing) / reqCells), detail: `${reqCells - missing} of ${reqCells} required cells complete` });
  } else dims.push({ key: 'completeness', label: 'Mandatory-field completeness', weight: S.weights.completeness, value: null, detail: 'Not applicable (no required fields configured)' });
  let fmtTotal = 0;
  recs.forEach(r => { ['dob', 'apaar', 'admYear'].forEach(f => { if (!blank(r.v[f])) fmtTotal++; }); });
  if (fmtTotal) {
    const bad = F.filter(f => ['FMT-DOB', 'FMT-ID', 'FMT-YEAR'].includes(f.ruleId) && !closed(f)).length;
    dims.push({ key: 'format', label: 'Valid field formats', weight: S.weights.format, value: Math.max(0, (fmtTotal - bad) / fmtTotal), detail: `${Math.max(0, fmtTotal - bad)} of ${fmtTotal} checked values valid` });
  } else dims.push({ key: 'format', label: 'Valid field formats', weight: S.weights.format, value: null, detail: 'Not applicable (no values to check)' });
  const badRecs = new Set(F.filter(f => ['Cross-field', 'Exact duplicate'].includes(f.cat) && !closed(f)).map(f => f.recId));
  dims.push({ key: 'consistency', label: 'Consistency (no unresolved cross-field/duplicate issues)', weight: S.weights.consistency, value: 1 - badRecs.size / recs.length, detail: `${recs.length - badRecs.size} of ${recs.length} records free of such issues` });
  const reviewable = F.filter(f => f.severity === 'warning' || isDupCat(f));
  if (reviewable.length) {
    const done = reviewable.filter(decided).length;
    dims.push({ key: 'review', label: 'Review completion', weight: S.weights.review, value: done / reviewable.length, detail: `${done} of ${reviewable.length} review items decided` });
  } else dims.push({ key: 'review', label: 'Review completion', weight: S.weights.review, value: null, detail: 'Not applicable (nothing needs review)' });
  const app = dims.filter(d => d.value !== null && d.weight > 0);
  const wsum = app.reduce((a, d) => a + d.weight, 0);
  if (!wsum) return { value: null, dims, note: 'No applicable checks - score not calculated.' };
  const value = Math.round(app.reduce((a, d) => a + d.value * d.weight, 0) / wsum * 100);
  return { value, dims, note: '' };
}

function runValidation(manual = true) {
  const prev = state.runs[state.runs.length - 1];
  state.findings = validate(state.records, state.settings, state.decisions);
  const m = metrics();
  const run = {
    id: uid('run'), at: nowISO(), by: session ? session.email : 'system', dataset: state.datasetName,
    total: m.total, errors: m.errors, review: m.review, pass: m.pass, warn: m.warn,
    score: m.score.value, blocking: m.blockingCount, pending: m.pending,
    keys: state.findings.filter(f => !closed(f)).map(f => f.key),
    ruleVersion: state.settings.ruleVersion, rules: RULES.map(r => r.id),
    resolvedSincePrev: prev ? prev.keys.filter(k => !state.findings.some(f => f.key === k && !closed(f))).length : 0,
    newSincePrev: prev ? state.findings.filter(f => !closed(f) && !prev.keys.includes(f.key)).length : 0
  };
  state.runs.push(run);
  if (state.runs.length > 40) state.runs.shift();
  audit('Validation run', state.datasetName, `records=${run.total}, errors=${run.errors}, review=${run.review}, score=${run.score ?? 'N/A'}`);
  if (manual) toast(`Validation run complete: ${run.errors} record(s) with errors, ${run.review} awaiting review.`, 'success');
  return run;
}

/* ------------------------------------------------------------------ */
/* Sample data                                                         */
/* ------------------------------------------------------------------ */
function sampleRows() {
  const first = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Sana', 'Vivaan', 'Isha', 'Arjun', 'Nila', 'Tarun', 'Ritu', 'Kavin', 'Lakshmi', 'Dev', 'Anika', 'Harsh', 'Pooja', 'Yash', 'Zoya'];
  const last = ['Rao', 'Nair', 'Iyer', 'Menon', 'Das', 'Paul', 'Khan', 'Shah', 'Bose', 'Pillai', 'Reddy', 'Singh', 'Joshi', 'Mehta', 'Naidu', 'Gill', 'Sethi', 'Verma', 'Kapoor', 'Bhat'];
  const depts = ['CSE', 'ECE', 'IT', 'MECH', 'AI&DS'];
  const rows = [];
  for (let i = 1; i <= 60; i++) {
    const adm = i % 2 ? 2023 : 2024;
    rows.push({
      ref: 'DEMO' + pad(i, 3),
      name: `${first[i % 20]} ${last[(i * 7 + Math.floor(i / 20)) % 20]}`,
      apaar: '99000000' + pad(i, 4),
      dob: `${pad(1 + (i * 3) % 28, 2)}-${pad(1 + (i * 5) % 12, 2)}-${i % 3 ? 2005 : 2006}`,
      admYear: String(adm),
      course: 'B.E./B.Tech (demo)',
      dept: depts[i % 5],
      acadYear: '2025-26',
      docStatus: 'Verified'
    });
  }
  const set = (i, o) => Object.assign(rows[i - 1], o);
  set(5, { name: '' });
  set(9, { dob: '' });
  set(14, { dob: '31-02-2005' });
  set(17, { dob: '2005/13/45' });
  set(22, { apaar: '12345' });
  set(27, { apaar: rows[25].apaar });
  set(31, { ref: rows[29].ref });
  set(34, { name: 'Aarav Rao', dept: 'IT', dob: '10-03-2005' });
  set(35, { name: 'Aaraav Rao', dept: 'IT', dob: '10-03-2005' });
  set(40, { admYear: '2031' });
  set(43, { dob: '12-05-2015', admYear: '2023' });
  set(46, { acadYear: '2019-20', admYear: '2023' });
  set(50, { docStatus: 'Mismatch' });
  set(52, { docStatus: 'Pending' });
  set(53, { docStatus: 'Pending' });
  set(57, { dob: '04-04-1975', admYear: '2023' });
  set(58, { dept: '' });
  return rows;
}
function loadSample() {
  const rows = sampleRows();
  state.records = rows.map(v => ({ id: uid('r'), v: { ...v }, orig: { ...v }, docResult: null }));
  state.decisions = {}; state.versions = []; state.runs = [];
  state.datasetName = 'Synthetic demo dataset (sample)';
  state.importedAt = nowISO();
  audit('Dataset loaded', state.datasetName, `${rows.length} synthetic records`);
  runValidation(false);
  toast('Synthetic demo dataset loaded and validated.', 'success');
}
function isSample() { return state.datasetName.startsWith('Synthetic demo'); }

/* ------------------------------------------------------------------ */
/* CSV / XLSX I/O                                                      */
/* ------------------------------------------------------------------ */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const c of firstLine) if (c in counts) counts[c]++;
  const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += c;
  }
  if (q) throw new Error('Malformed CSV: a quoted field is never closed.');
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}
function csvEscape(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // formula-injection guard
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCSV(rows) { return '\uFEFF' + rows.map(r => r.map(csvEscape).join(',')).join('\r\n'); }
function safeCell(v) { let s = v === null || v === undefined ? '' : v; if (typeof s === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return s; }
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function downloadCSV(name, rows) { download(name, new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' })); }
function downloadXLSX(name, sheets) {
  if (typeof XLSX === 'undefined') { toast('XLSX library not loaded (offline?). Use the CSV option instead.', 'error'); return false; }
  const wb = XLSX.utils.book_new();
  sheets.forEach(s => {
    const aoa = s.rows.map(r => r.map(safeCell));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const widths = (aoa[0] || []).map((_, c) => ({ wch: Math.min(60, Math.max(10, ...aoa.map(r => String(r[c] ?? '').length)) + 2) }));
    ws['!cols'] = widths;
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  });
  XLSX.writeFile(wb, name);
  return true;
}

let up = null; // upload wizard state
async function readUpload(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['csv', 'xlsx'].includes(ext)) throw new Error('Unsupported file type. Please upload a .csv or .xlsx file.');
  if (file.size === 0) throw new Error('The file is empty.');
  if (file.size > MAX_BYTES) throw new Error(`File is too large (limit ${MAX_BYTES / 1024 / 1024} MB).`);
  let rows;
  if (ext === 'csv') {
    const text = await file.text();
    if ((text.match(/\uFFFD/g) || []).length > 3) throw new Error('The file does not look like valid UTF-8 text. Re-save it as CSV UTF-8.');
    rows = parseCSV(text);
  } else {
    if (typeof XLSX === 'undefined') throw new Error('XLSX support did not load (offline?). Save the sheet as CSV and upload that.');
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }).filter(r => r.some(c => String(c).trim() !== ''));
    } catch (e) { throw new Error('The Excel file could not be read. It may be corrupt or password-protected.'); }
  }
  if (rows.length < 2) throw new Error('No data rows found. The file needs a header row and at least one record.');
  const headers = rows[0].map(h => String(h).trim());
  if (headers.some(h => !h)) throw new Error('One or more column headers are empty.');
  const seen = new Set();
  for (const h of headers) { const k = h.toLowerCase(); if (seen.has(k)) throw new Error(`Duplicate column name detected: "${h}".`); seen.add(k); }
  const data = rows.slice(1);
  if (data.length > MAX_ROWS) throw new Error(`Too many rows (${data.length}). Limit is ${MAX_ROWS}.`);
  let ragged = 0;
  const norm = data.map(r => { if (r.length !== headers.length) ragged++; const o = r.slice(0, headers.length).map(c => String(c ?? '').trim()); while (o.length < headers.length) o.push(''); return o; });
  const mapping = {};
  FIELDS.forEach(f => {
    const idx = headers.findIndex(h => SYNONYMS[f.k].includes(h.toLowerCase().replace(/[^a-z0-9]/g, '')));
    mapping[f.k] = idx >= 0 ? String(idx) : '';
  });
  return { fileName: file.name, headers, rows: norm, mapping, ragged };
}

/* ------------------------------------------------------------------ */
/* Routing + shell                                                     */
/* ------------------------------------------------------------------ */
const ui = { q: '', cat: '', sev: '', status: '', dept: '', run: '', sort: 'ref', dir: 1, page: 1, auditQ: '', recQ: '' };
const NAV = [
  ['dashboard', 'Dashboard', 'view'], ['upload', 'Upload Dataset', 'upload'], ['results', 'Validation Results', 'view'],
  ['reports', 'Reports & Exports', 'export'], ['audit', 'Audit History', 'audit'], ['settings', 'Settings & Rules', 'settings']
];
const TITLES = { dashboard: 'Dashboard', upload: 'Upload Dataset', results: 'Validation Results', reports: 'Reports & Exports', audit: 'Audit History', settings: 'Settings & Rules' };

function currentRoute() {
  const h = location.hash;
  if (!h) return 'landing';
  if (!h.startsWith('#/')) return null; // in-page anchor
  return h.slice(2).split('?')[0] || 'landing';
}
function router() {
  let r = currentRoute();
  if (r === null) return;
  const valid = ['landing', 'login', ...NAV.map(n => n[0])];
  if (!valid.includes(r)) r = 'landing';
  if (r !== 'landing' && r !== 'login' && !session) { location.hash = '#/login'; return; }
  if (r === 'login' && session) { location.hash = '#/dashboard'; return; }
  const nav = NAV.find(n => n[0] === r);
  if (nav && !can(nav[2])) { toast('You do not have permission to open that page.', 'error'); location.hash = '#/dashboard'; return; }
  ['landing', 'login', 'shell'].forEach(id => $('#' + id).hidden = true);
  closeModal();
  if (r === 'landing') { $('#landing').hidden = false; window.scrollTo(0, 0); return; }
  if (r === 'login') { $('#login').hidden = false; return; }
  $('#shell').hidden = false;
  $('#uName').textContent = session.name;
  $('#uRole').textContent = session.role;
  $('#sideNav').innerHTML = NAV.filter(n => can(n[2])).map(n => `<a href="#/${n[0]}" class="${n[0] === r ? 'active' : ''}">${n[1]}</a>`).join('');
  $('#crumbs').innerHTML = `Home / <b>${TITLES[r]}</b>`;
  $('#sidebar').classList.remove('open');
  PAGES[r]();
  window.scrollTo(0, 0);
}
function rerender() { const r = currentRoute(); if (r && PAGES[r]) PAGES[r](); }

/* ------------------------------------------------------------------ */
/* View helpers                                                        */
/* ------------------------------------------------------------------ */
const sevBadge = s => `<span class="badge b-${s === 'error' ? 'error' : 'warning'}">${s === 'error' ? 'Error' : 'Warning'}</span>`;
const stBadge = s => ({ error: '<span class="badge b-error">Errors</span>', review: '<span class="badge b-warning">Needs review</span>', pass: '<span class="badge b-pass">Passing</span>' }[s]);
const STATUS_LABEL = { open: 'Open', resolved: 'Resolved', rejected: 'Rejected', further: 'Needs further review', confirmed: 'Confirmed duplicate', notdup: 'Not a duplicate', unresolved: 'Unresolved' };
const revBadge = s => `<span class="badge ${['resolved', 'rejected', 'notdup', 'confirmed'].includes(s) ? 'b-pass' : s === 'open' ? 'b-gray' : 'b-info'}">${STATUS_LABEL[s] || s}</span>`;
function bars(items, cls = '') {
  const max = Math.max(1, ...items.map(i => i[1]));
  return items.map(([l, n]) => `<div class="bar-row"><span>${esc(l)}</span><div class="bar ${cls}"><i style="width:${Math.round(n / max * 100)}%"></i></div><b>${n}</b></div>`).join('');
}
function emptyState() {
  return `<div class="panel empty"><h2>No dataset loaded</h2><p>Upload a CSV/XLSX file or load the synthetic demo dataset to begin.</p>
  <div class="actions" style="justify-content:center">${can('upload') ? '<button class="btn btn-primary" data-act="loadSample">Load synthetic demo dataset</button><a class="btn btn-ghost" href="#/upload">Upload a file</a>' : '<span class="muted">Ask an Administrator or Data Entry Staff user to load data.</span>'}</div></div>`;
}
function scoreBlock(m) {
  const sc = m.score;
  const ring = sc.value === null ? '<div class="score-ring" style="--p:0"><div>N/A</div></div>' : `<div class="score-ring" style="--p:${sc.value}"><div>${sc.value}</div></div>`;
  const dims = sc.dims.map(d => `<tr><td>${esc(d.label)}</td><td>${d.weight}</td><td>${d.value === null ? '<span class="badge b-gray">N/A</span>' : Math.round(d.value * 100) + '%'}</td><td class="muted">${esc(d.detail)}</td></tr>`).join('');
  return `<div class="panel"><h2>Data-quality score <span class="sample-tag">indicator only</span></h2>
  <div class="score-wrap">${ring}<div style="flex:1;min-width:260px"><div class="table-wrap"><table class="t"><thead><tr><th>Dimension</th><th>Weight</th><th>Result</th><th>Detail</th></tr></thead><tbody>${dims}</tbody></table></div></div></div>
  <p class="muted small">Formula: score = &Sigma;(weight &times; dimension result) &divide; &Sigma;(weights of applicable dimensions). Dimensions that cannot be assessed are excluded, never counted as passed. If nothing is applicable the score is N/A. This is a data-quality indicator, not an official APAAR verification, identity-authenticity or approval score. ${esc(sc.note)}</p></div>`;
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */
const PAGES = {
  dashboard() {
    const el = $('#page');
    if (!state.records.length) {
      el.innerHTML = `<div class="page-head"><div><h1>Dashboard</h1><p>Overview of your latest validation work.</p></div></div>${emptyState()}`;
      return;
    }
    const m = metrics();
    const last = state.runs[state.runs.length - 1];
    const tag = isSample() ? '<span class="sample-tag">sample data</span>' : '';
    const catCounts = CATS.map(c => [c, state.findings.filter(f => f.cat === c && !closed(f)).length]);
    const recent = state.runs.slice(-5).reverse();
    const actions = state.audit.slice(-6).reverse();
    const ret = state.importedAt && (Date.now() - new Date(state.importedAt).getTime()) / 864e5 > state.settings.retentionDays;
    el.innerHTML = `
    <div class="page-head"><div><h1>Dashboard ${tag}</h1><p>${esc(state.datasetName)} &middot; imported ${esc(fmtTime(state.importedAt))}</p></div>
      <div class="actions">${can('validate') ? '<button class="btn btn-primary" data-act="revalidate">Run validation</button>' : ''}<a class="btn btn-ghost" href="#/results">Open results</a></div></div>
    ${ret ? '<div class="alert warn">This dataset is older than the configured retention period. Consider deleting it from Settings.</div>' : ''}
    <div class="grid g4">
      <div class="panel stat"><div class="v">${m.total}</div><div class="l">Total records processed</div></div>
      <div class="panel stat amber"><div class="v">${m.review}</div><div class="l">Records requiring review</div></div>
      <div class="panel stat red"><div class="v">${m.errors}</div><div class="l">Records with errors</div></div>
      <div class="panel stat green"><div class="v">${m.pass}</div><div class="l">Records passing all configured checks</div></div>
      <div class="panel stat"><div class="v">${m.score.value === null ? 'N/A' : m.score.value + '/100'}</div><div class="l">Data-quality score</div></div>
      <div class="panel stat"><div class="v" style="font-size:1.05rem">${last ? esc(fmtTime(last.at)) : 'No run yet'}</div><div class="l">Latest validation run</div></div>
    </div>
    <div class="alert ${m.eligible ? 'ok' : 'warn'}" style="margin-top:16px">${m.eligible ? 'All blocking errors resolved and review decisions complete: clean export is available.' : `Clean export not yet available: ${m.blockingCount} blocking issue(s) and ${m.pending} review decision(s) remain. A completed run does not mean the dataset has passed every check.`}</div>
    <div class="grid g2" style="margin-top:16px">
      <div class="panel"><h2>Open issues by category</h2>${bars(catCounts)}</div>
      <div class="panel"><h2>Validation activity (data-quality score per run)</h2>${recent.length ? bars(recent.slice().reverse().map((r, i) => [`Run ${state.runs.length - recent.length + i + 1}`, r.score ?? 0])) : '<p class="muted">No runs yet.</p>'}</div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="panel"><h2>Recent validation runs</h2><div class="table-wrap"><table class="t"><thead><tr><th>When</th><th>By</th><th>Errors</th><th>Review</th><th>Score</th></tr></thead><tbody>
      ${recent.map(r => `<tr><td>${esc(fmtTime(r.at))}</td><td>${esc(r.by)}</td><td>${r.errors}</td><td>${r.review}</td><td>${r.score ?? 'N/A'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">None</td></tr>'}</tbody></table></div></div>
      <div class="panel"><h2>Recent actions</h2><div class="table-wrap"><table class="t"><thead><tr><th>When</th><th>User</th><th>Action</th></tr></thead><tbody>
      ${actions.map(a => `<tr><td>${esc(fmtTime(a.at))}</td><td>${esc(a.user)}</td><td>${esc(a.action)}</td></tr>`).join('')}</tbody></table></div>
      <p style="margin:10px 0 0"><a href="#/audit">View full audit history</a></p></div>
    </div>
    ${scoreBlock(m)}`;
  },

  upload() {
    const el = $('#page');
    let body = '';
    if (!up) {
      body = `<div class="drop" id="drop" tabindex="0" role="button" aria-label="Choose a file to upload"><strong>Drag &amp; drop a CSV or XLSX file here</strong><p class="muted">or click to choose &middot; max ${MAX_BYTES / 1024 / 1024} MB &middot; max ${MAX_ROWS} rows &middot; first row must be headers</p>
      <input type="file" id="fileInput" accept=".csv,.xlsx" hidden></div>
      <div class="actions" style="margin-top:14px">
        <button class="btn btn-ghost" data-act="tplCSV">Download sample CSV template</button>
        <button class="btn btn-ghost" data-act="tplXLSX">Download sample Excel template</button>
        <button class="btn btn-primary" data-act="loadSample">Load synthetic demo dataset</button></div>
      <div id="uploadMsg"></div>`;
    } else {
      const opts = sel => '<option value="">- not mapped -</option>' + up.headers.map((h, i) => `<option value="${i}" ${String(i) === sel ? 'selected' : ''}>${esc(h)}</option>`).join('');
      body = `<div class="alert info">File: <b>${esc(up.fileName)}</b> &middot; ${up.rows.length} rows${up.ragged ? ` &middot; ${up.ragged} row(s) had an unexpected number of columns and were padded/truncated` : ''}. Confirm the column mapping, then import.</div>
      <div class="panel"><h2>Column mapping</h2><div class="map-grid">${FIELDS.map(f => `<div><label for="map_${f.k}">${esc(f.l)}${state.settings.required.includes(f.k) ? ' *' : ''}</label><select id="map_${f.k}" data-map="${f.k}">${opts(up.mapping[f.k])}</select></div>`).join('')}</div>
      <p class="muted small">* required by current rules. Identifiers are kept as text so leading zeros are preserved.</p></div>
      <div class="panel" style="margin-top:16px"><h2>Data preview (first 5 rows)</h2><div class="table-wrap"><table class="t"><thead><tr>${up.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
      ${up.rows.slice(0, 5).map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
      <div class="actions" style="margin-top:14px"><button class="btn btn-primary" data-act="importUp">Confirm mapping &amp; import</button><button class="btn btn-ghost" data-act="cancelUp">Cancel</button></div><div id="uploadMsg"></div>`;
    }
    el.innerHTML = `<div class="page-head"><div><h1>Upload Student Dataset</h1><p>Supported: CSV (UTF-8) and XLSX. Use synthetic or authorized data only.</p></div></div>${body}`;
    const drop = $('#drop'), inp = $('#fileInput');
    if (drop) {
      drop.addEventListener('click', () => inp.click());
      drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
      inp.addEventListener('change', () => { handleFile(inp.files[0]); inp.value = ''; });
    }
  },

  results() {
    const el = $('#page');
    if (!state.records.length) { el.innerHTML = `<div class="page-head"><div><h1>Validation Results</h1></div></div>${emptyState()}`; return; }
    const m = metrics();
    const depts = [...new Set(state.records.map(r => String(r.v.dept || '').trim()).filter(Boolean))].sort();
    const recById = Object.fromEntries(state.records.map(r => [r.id, r]));
    const q = ui.q.toLowerCase();
    let rows = state.findings.filter(f => {
      const r = recById[f.recId]; if (!r) return false;
      if (ui.cat && f.cat !== ui.cat) return false;
      if (ui.sev && f.severity !== ui.sev) return false;
      if (ui.status && f.status !== ui.status) return false;
      if (ui.dept && String(r.v.dept || '').trim() !== ui.dept) return false;
      if (q && !(`${r.v.ref} ${r.v.name} ${r.v.apaar} ${f.message} ${f.ruleId}`.toLowerCase().includes(q))) return false;
      return true;
    });
    const keyFn = { ref: f => f.ref, field: f => f.field, cat: f => f.cat, sev: f => f.severity, status: f => f.status, rule: f => f.ruleId }[ui.sort] || (f => f.ref);
    rows.sort((a, b) => String(keyFn(a)).localeCompare(String(keyFn(b)), undefined, { numeric: true }) * ui.dir);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    ui.page = Math.min(Math.max(1, ui.page), pages);
    const slice = rows.slice((ui.page - 1) * PAGE_SIZE, ui.page * PAGE_SIZE);
    const sel = (id, label, opts, val) => `<div><label for="${id}">${label}</label><select id="${id}" data-filter="${id}"><option value="">All</option>${opts.map(o => `<option value="${esc(o[0])}" ${o[0] === val ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div>`;
    const th = (k, l) => `<th class="sortable" data-sort="${k}">${l}${ui.sort === k ? (ui.dir > 0 ? ' &#9650;' : ' &#9660;') : ''}</th>`;
    const run = state.runs[state.runs.length - 1];
    el.innerHTML = `
    <div class="page-head"><div><h1>Validation Results</h1><p>${esc(state.datasetName)} &middot; ${run ? 'last run ' + esc(fmtTime(run.at)) : ''}</p></div>
      <div class="actions">${can('validate') ? '<button class="btn btn-primary" data-act="revalidate">Re-run validation</button>' : ''}<a class="btn btn-ghost" href="#/reports">Reports</a></div></div>
    <div class="grid g4">
      <div class="panel stat"><div class="v">${m.total}</div><div class="l">Records checked</div></div>
      <div class="panel stat green"><div class="v">${m.pass}</div><div class="l">Passing all applicable checks</div></div>
      <div class="panel stat red"><div class="v">${m.errors}</div><div class="l">Records with errors</div></div>
      <div class="panel stat amber"><div class="v">${m.warn}</div><div class="l">Records with warnings</div></div>
      <div class="panel stat amber"><div class="v">${m.review}</div><div class="l">Records needing human review</div></div>
      <div class="panel stat"><div class="v">${m.score.value === null ? 'N/A' : m.score.value}</div><div class="l">Data-quality score</div></div>
    </div>
    ${run && state.runs.length > 1 ? `<div class="alert info" style="margin-top:16px">Compared with the previous run: <b>${run.resolvedSincePrev}</b> issue(s) resolved, <b>${run.newSincePrev}</b> new, <b>${run.keys.length}</b> remaining open. Rule set v${run.ruleVersion}.</div>` : ''}
    <div class="panel" style="margin-top:16px"><h2>Issues by category <span class="sample-tag">issue counts; one record can have several</span></h2>
      ${bars(CATS.map(c => [c, state.findings.filter(f => f.cat === c && !closed(f)).length]))}</div>
    <div class="panel" style="margin-top:16px"><h2>Findings</h2>
      <div class="filters">
        <div><label for="fq">Search</label><input id="fq" type="search" value="${esc(ui.q)}" placeholder="Name, reference, rule..."></div>
        ${sel('cat', 'Issue category', CATS.map(c => [c, c]), ui.cat)}
        ${sel('sev', 'Severity', [['error', 'Error'], ['warning', 'Warning']], ui.sev)}
        ${sel('status', 'Review status', Object.entries(STATUS_LABEL), ui.status)}
        ${sel('dept', 'Department', depts.map(d => [d, d]), ui.dept)}
        ${sel('runf', 'Validation run', state.runs.slice(-1).map(r => [r.id, 'Latest: ' + fmtTime(r.at)]), ui.run)}
      </div>
      <div class="table-wrap"><table class="t"><thead><tr>${th('ref', 'Record')}${th('field', 'Field')}${th('cat', 'Category')}${th('sev', 'Severity')}<th>Explanation</th><th>Suggested action</th>${th('rule', 'Rule')}${th('status', 'Review status')}</tr></thead><tbody>
      ${slice.map(f => `<tr class="click" data-rec="${esc(f.recId)}"><td><b>${esc(f.ref)}</b><br><span class="muted">${esc((recById[f.recId].v.name) || '')}</span></td><td>${esc(FIELD_LABEL[f.field] || f.field)}</td><td>${esc(f.cat)}</td><td>${sevBadge(f.severity)}</td><td>${esc(f.message)}</td><td>${esc(f.action)}</td><td><code>${esc(f.ruleId)}</code></td><td>${revBadge(f.status)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">No findings match these filters.</td></tr>'}</tbody></table></div>
      <div class="pager"><span>${rows.length} finding(s) &middot; page ${ui.page} of ${pages}</span><span class="actions"><button class="btn btn-ghost btn-sm" data-act="prev" ${ui.page <= 1 ? 'disabled' : ''}>Previous</button><button class="btn btn-ghost btn-sm" data-act="next" ${ui.page >= pages ? 'disabled' : ''}>Next</button></span></div>
    </div>
    <div class="panel" style="margin-top:16px"><h2>Compliance checklist &amp; applied rules (rule set v${state.settings.ruleVersion})</h2>
      <div class="table-wrap"><table class="t"><thead><tr><th>Rule</th><th>Severity</th><th>Status</th></tr></thead><tbody>
      ${RULES.map(r => `<tr><td><code>${r.id}</code> ${esc(r.name)}</td><td>${sevBadge(state.settings.severity[r.id] || r.sev)}</td><td>${state.findings.some(f => f.ruleId === r.id && !closed(f)) ? '<span class="badge b-warning">Open issues</span>' : '<span class="badge b-pass">No open issues</span>'}</td></tr>`).join('')}</tbody></table></div>
      <h3 style="margin-top:16px">Configured checklist items</h3>
      <div class="table-wrap"><table class="t"><thead><tr><th>Item</th><th>Source</th><th>Effective date</th><th>Verified source</th></tr></thead><tbody>
      ${state.settings.checklist.map(c => `<tr><td>${esc(c.text)}</td><td>${esc(c.source || 'Not provided')}</td><td>${esc(c.effective || 'Not provided')}</td><td>${c.verified ? '<span class="badge b-pass">Verified by admin</span>' : '<span class="badge b-gray">Unverified</span>'}</td></tr>`).join('')}</tbody></table></div>
    </div>
    ${scoreBlock(m)}`;
    const fq = $('#fq');
    fq.addEventListener('input', () => { ui.q = fq.value; ui.page = 1; const pos = fq.selectionStart; rerender(); const n = $('#fq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });
  },

  reports() {
    const el = $('#page');
    if (!state.records.length) { el.innerHTML = `<div class="page-head"><div><h1>Reports &amp; Exports</h1></div></div>${emptyState()}`; return; }
    const m = metrics();
    const hasX = typeof XLSX !== 'undefined';
    const btn = (label, a) => `<div class="actions" style="margin:6px 0"><span style="min-width:220px;font-weight:600">${label}</span><button class="btn btn-ghost btn-sm" data-act="${a}" data-fmt="csv">CSV</button><button class="btn btn-ghost btn-sm" data-act="${a}" data-fmt="xlsx" ${hasX ? '' : 'disabled title="XLSX library not loaded"'}>XLSX</button></div>`;
    el.innerHTML = `<div class="page-head"><div><h1>Reports &amp; Exports</h1><p>Locally generated reports. They are not official APAAR certificates.</p></div></div>
    <div class="alert ${m.eligible ? 'ok' : 'warn'}">${m.eligible ? 'Dataset is eligible for a clean export.' : `Not eligible for a clean export: ${m.blockingCount} blocking error(s) and ${m.pending} pending review decision(s). You can still export with issues disclosed (confirmation required).`}</div>
    <div class="panel">${btn('Corrected-format dataset', 'expData')}${btn('Detailed issue report', 'expIssues')}${btn('Validation summary report', 'expSummary')}${btn('Validation-run history', 'expRuns')}
      <p class="muted small">Spreadsheet text cells that begin with = + - @ are prefixed with an apostrophe to prevent formula injection. Corrected dataset dates are normalised to YYYY-MM-DD where valid; original imported values are retained in the record history.${hasX ? ' Note: the free SheetJS build does not apply cell colours or frozen panes in XLSX output.' : ''}</p></div>
    <div class="panel" style="margin-top:16px"><h2>Export history</h2><div class="table-wrap"><table class="t"><thead><tr><th>When</th><th>User</th><th>Report</th><th>Format</th><th>Clean?</th></tr></thead><tbody>
    ${state.exports.slice(-10).reverse().map(x => `<tr><td>${esc(fmtTime(x.at))}</td><td>${esc(x.user)}</td><td>${esc(x.name)}</td><td>${esc(x.fmt)}</td><td>${x.clean ? 'Yes' : 'No (issues disclosed)'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No exports yet</td></tr>'}</tbody></table></div></div>`;
  },

  audit() {
    const el = $('#page');
    const q = ui.auditQ.toLowerCase();
    const rows = state.audit.slice().reverse().filter(a => !q || `${a.user} ${a.action} ${a.target} ${a.detail}`.toLowerCase().includes(q));
    el.innerHTML = `<div class="page-head"><div><h1>Audit History</h1><p>Append-only log. There are no edit or delete controls for entries. Passwords and tokens are never recorded.</p></div></div>
    <div class="panel"><label for="aq">Search audit log</label><input id="aq" type="search" value="${esc(ui.auditQ)}" placeholder="User, action, record...">
    <div class="table-wrap" style="margin-top:12px"><table class="t"><thead><tr><th>Timestamp</th><th>User</th><th>Role</th><th>Action</th><th>Target</th><th>Details (before / after)</th></tr></thead><tbody>
    ${rows.slice(0, 200).map(a => `<tr><td>${esc(fmtTime(a.at))}</td><td>${esc(a.user)}</td><td>${esc(a.role)}</td><td>${esc(a.action)}</td><td>${esc(a.target)}</td><td>${esc(a.detail)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No entries</td></tr>'}</tbody></table></div>
    <p class="muted small">Showing up to 200 most recent matching entries of ${state.audit.length}.</p></div>`;
    const aq = $('#aq');
    aq.addEventListener('input', () => { ui.auditQ = aq.value; const pos = aq.selectionStart; rerender(); const n = $('#aq'); n.focus(); n.setSelectionRange(pos, pos); });
  },

  settings() {
    const S = state.settings, el = $('#page');
    el.innerHTML = `<div class="page-head"><div><h1>Settings &amp; Validation Rules</h1><p>Administrator only. Rule changes are versioned (currently v${S.ruleVersion}).</p></div></div>
    <form id="settingsForm" novalidate>
    <div class="panel"><h2>Institution profile</h2><label for="s_inst">Institution name</label><input id="s_inst" type="text" value="${esc(S.institution)}"></div>
    <div class="panel" style="margin-top:16px"><h2>Required fields</h2><div class="checks">${FIELDS.map(f => `<label><input type="checkbox" name="req" value="${f.k}" ${S.required.includes(f.k) ? 'checked' : ''}>${esc(f.l)}</label>`).join('')}</div></div>
    <div class="panel" style="margin-top:16px"><h2>Thresholds &amp; patterns</h2><div class="form-grid">
      <div><label for="s_pat">Identifier pattern (regex)</label><input id="s_pat" type="text" value="${esc(S.apaarPattern)}"><small class="muted">Demo assumption only - not an official specification.</small></div>
      <div><label for="s_dup">Duplicate similarity threshold (50-100)</label><input id="s_dup" type="number" min="50" max="100" value="${S.dupThreshold}"></div>
      <div><label for="s_miny">Earliest valid admission year</label><input id="s_miny" type="number" min="1950" max="2100" value="${S.minYear}"></div>
      <div><label for="s_mina">Minimum age at admission</label><input id="s_mina" type="number" min="0" max="100" value="${S.minAge}"></div>
      <div><label for="s_maxa">Maximum age at admission (unusual-pattern flag)</label><input id="s_maxa" type="number" min="0" max="100" value="${S.maxAge}"></div>
      <div><label for="s_ret">Retention period (days)</label><input id="s_ret" type="number" min="1" max="3650" value="${S.retentionDays}"></div></div></div>
    <div class="panel" style="margin-top:16px"><h2>Rule severities</h2><div class="form-grid">${RULES.map(r => `<div><label for="sev_${r.id}"><code>${r.id}</code> ${esc(r.name)}</label><select id="sev_${r.id}"><option value="error" ${S.severity[r.id] === 'error' ? 'selected' : ''}>Error (blocking)</option><option value="warning" ${S.severity[r.id] === 'warning' ? 'selected' : ''}>Warning</option></select></div>`).join('')}</div></div>
    <div class="panel" style="margin-top:16px"><h2>Score weights</h2><div class="form-grid">${[['completeness', 'Completeness'], ['format', 'Format validity'], ['consistency', 'Consistency'], ['review', 'Review completion']].map(([k, l]) => `<div><label for="w_${k}">${l}</label><input id="w_${k}" type="number" min="0" max="100" value="${S.weights[k]}"></div>`).join('')}</div></div>
    <div class="panel" style="margin-top:16px"><h2>Compliance checklist items</h2><div id="chk">${S.checklist.map(c => checklistRow(c)).join('')}</div><button type="button" class="btn btn-ghost btn-sm" data-act="addChk">+ Add item</button>
      <p class="muted small">Only mark an item "verified" when you have confirmed its source. Unverified items are shown as such.</p></div>
    <div class="alert error" id="setErr" hidden></div>
    <div class="actions" style="margin-top:16px"><button class="btn btn-primary" type="submit">Save rules (new version) &amp; re-validate</button></div></form>
    <div class="panel" style="margin-top:16px"><h2>Rule version history</h2><div class="table-wrap"><table class="t"><thead><tr><th>Version</th><th>When</th><th>By</th><th>Summary</th></tr></thead><tbody>${S.ruleHistory.slice().reverse().map(h => `<tr><td>v${h.version}</td><td>${esc(fmtTime(h.at))}</td><td>${esc(h.by)}</td><td>${esc(h.summary)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel" style="margin-top:16px"><h2>Data management</h2><div class="actions"><button class="btn btn-danger" data-act="deleteData">Delete current dataset</button><button class="btn btn-danger" data-act="resetAll">Reset entire demo (all data, rules, audit log)</button></div></div>`;
    $('#settingsForm').addEventListener('submit', saveSettings);
  }
};
function checklistRow(c) {
  return `<div class="form-grid chk-row" data-id="${esc(c.id)}" style="margin-bottom:10px;border-bottom:1px solid var(--line);padding-bottom:8px">
  <div><label>Item</label><input type="text" class="c-text" value="${esc(c.text)}"></div><div><label>Source</label><input type="text" class="c-src" value="${esc(c.source)}"></div>
  <div><label>Effective date</label><input type="date" class="c-eff" value="${esc(c.effective)}"></div><div><label class="checks" style="margin-top:28px"><span style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="c-ver" ${c.verified ? 'checked' : ''} style="width:auto"> Source verified</span></label></div></div>`;
}

/* ------------------------------------------------------------------ */
/* Modal: record details, correction, review, document comparison      */
/* ------------------------------------------------------------------ */
function closeModal() { $('#modalRoot').innerHTML = ''; }
function openRecord(recId) {
  const rec = state.records.find(r => r.id === recId);
  if (!rec) return;
  const fs = state.findings.filter(f => f.recId === recId);
  const canEdit = can('edit'), canRev = can('review');
  const changed = k => String(rec.orig[k] ?? '') !== String(rec.v[k] ?? '');
  const hist = state.versions.filter(v => v.recId === recId).slice().reverse();
  const dr = rec.docResult;
  $('#modalRoot').innerHTML = `<div class="modal-back" role="dialog" aria-modal="true" aria-label="Record details"><div class="modal">
    <div class="modal-head"><h2>${esc(rec.v.ref || '(no reference)')} &middot; ${esc(rec.v.name || '(no name)')} ${stBadge(statusOf(recId))}</h2><button class="btn btn-ghost btn-sm" data-act="closeModal">Close</button></div>
    <h3>Imported values ${canEdit ? '' : '<span class="muted small">(read-only for your role)</span>'}</h3>
    <form id="recForm" data-id="${esc(recId)}" novalidate><div class="form-grid">
    ${FIELDS.map(f => `<div><label for="rf_${f.k}">${esc(f.l)}</label><input id="rf_${f.k}" data-f="${f.k}" type="text" value="${esc(rec.v[f.k])}" ${canEdit ? '' : 'disabled'}>${changed(f.k) ? `<div class="orig">Original import: ${esc(rec.orig[f.k] === '' ? '(blank)' : rec.orig[f.k])} &middot; manually corrected</div>` : ''}</div>`).join('')}
    </div><div class="alert error" id="recErr" hidden></div>
    ${canEdit ? '<div class="actions" style="margin-top:12px"><button class="btn btn-primary" type="submit">Save corrections</button><button class="btn btn-ghost" type="button" data-act="saveRerun">Save &amp; re-run validation</button></div>' : ''}</form>
    <hr class="sep"><h3>Findings (${fs.length})</h3>
    ${fs.length ? fs.map((f, i) => {
      const dup = isDupCat(f);
      const opts = dup ? ['open', 'confirmed', 'notdup', 'unresolved', 'resolved', 'rejected'] : ['open', 'resolved', 'rejected', 'further'];
      return `<div class="panel" style="margin-bottom:10px;padding:12px"><div>${sevBadge(f.severity)} <b>${esc(FIELD_LABEL[f.field] || f.field)}</b> &middot; ${esc(f.cat)} &middot; <code>${esc(f.ruleId)}</code> ${revBadge(f.status)}</div>
      <p style="margin:6px 0">${esc(f.message)}</p><p class="muted" style="margin:0 0 8px"><b>Suggested action:</b> ${esc(f.action)}</p>
      ${canRev ? `<div class="form-grid"><div><label for="rs_${i}">Review decision</label><select id="rs_${i}" data-fkey="${esc(f.key)}">${opts.map(o => `<option value="${o}" ${f.status === o ? 'selected' : ''}>${STATUS_LABEL[o]}</option>`).join('')}</select></div>
      <div><label for="rn_${i}">Explanation (optional)</label><input id="rn_${i}" type="text" data-nkey="${esc(f.key)}" value="${esc(f.note)}" maxlength="300"></div></div><button class="btn btn-ghost btn-sm" style="margin-top:8px" data-act="saveDecision" data-key="${esc(f.key)}">Save decision</button>` : (f.note ? `<p class="muted small">Note: ${esc(f.note)}</p>` : '')}
      ${dup && f.extra ? dupCompare(rec, f.extra) : ''}</div>`;
    }).join('') : '<p class="muted">No findings for this record.</p>'}
    <hr class="sep"><h3>Supporting-document comparison</h3>
    <p class="muted small">Paste text extracted from a supporting document (PDF text extraction and OCR need a server component and are not available in this browser demo). Matching text is <b>not</b> proof that a document is genuine, and nothing is sent to any third party.</p>
    ${canEdit || canRev ? `<label for="docText">Extracted document text</label><textarea id="docText" placeholder="Paste text from the document here...">${esc(dr ? dr.text : '')}</textarea><div class="actions" style="margin-top:8px"><button class="btn btn-ghost" data-act="compareDoc">Compare with record fields</button></div>` : ''}
    ${dr ? docResultHtml(rec, dr) : ''}
    <hr class="sep"><h3>Change history</h3>
    ${hist.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>When</th><th>By</th><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${hist.map(h => `<tr><td>${esc(fmtTime(h.at))}</td><td>${esc(h.by)}</td><td>${esc(FIELD_LABEL[h.field] || h.field)}</td><td>${esc(h.old === '' ? '(blank)' : h.old)}</td><td>${esc(h.new === '' ? '(blank)' : h.new)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No manual corrections yet.</p>'}
  </div></div>`;
  $('#recForm').addEventListener('submit', e => { e.preventDefault(); saveRecord(false); });
}
function dupCompare(rec, otherId) {
  const o = state.records.find(r => r.id === otherId);
  if (!o) return '';
  return `<div class="diff" style="margin-top:8px"><div><b>This record</b><br>${esc(rec.v.name)}<br>${esc(rec.v.ref)} &middot; DOB ${esc(rec.v.dob)}</div><div><b>Possible match</b><br>${esc(o.v.name)}<br>${esc(o.v.ref)} &middot; DOB ${esc(o.v.dob)}</div></div>`;
}
function docResultHtml(rec, dr) {
  if (!dr.extracted) return '<div class="alert warn">Text could not be extracted / no text provided. This is not a mismatch.</div>';
  return `<div class="table-wrap" style="margin-top:8px"><table class="t"><thead><tr><th>Field</th><th>Record value</th><th>Result</th></tr></thead><tbody>${dr.results.map(r => `<tr><td>${esc(FIELD_LABEL[r.f])}</td><td>${esc(r.val)}</td><td>${r.ok === null ? '<span class="badge b-gray">Not checked (blank)</span>' : r.ok ? '<span class="badge b-pass">Appears to match</span>' : '<span class="badge b-warning">Differs - needs review</span>'}</td></tr>`).join('')}</tbody></table></div>
  <p class="muted small">Checked ${esc(fmtTime(dr.at))}. The document has not been independently authenticated.</p>`;
}
function compareDoc(rec) {
  const text = ($('#docText') || {}).value || '';
  if (blank(text)) { rec.docResult = { at: nowISO(), text: '', extracted: false, results: [], mismatches: [] }; return; }
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const t = norm(text);
  const results = [];
  const name = rec.v.name;
  results.push({ f: 'name', val: name, ok: blank(name) ? null : norm(name).split(' ').every(w => t.includes(w)) });
  const dob = parseDate(rec.v.dob);
  if (blank(rec.v.dob)) results.push({ f: 'dob', val: '', ok: null });
  else if (!dob) results.push({ f: 'dob', val: rec.v.dob, ok: false });
  else {
    const [y, m, d] = dob.split('-');
    const variants = [`${d}-${m}-${y}`, `${d}/${m}/${y}`, `${y}-${m}-${d}`, `${d}.${m}.${y}`].map(norm);
    results.push({ f: 'dob', val: rec.v.dob, ok: variants.some(v => t.includes(v)) });
  }
  if (!blank(rec.v.apaar)) results.push({ f: 'apaar', val: rec.v.apaar, ok: t.replace(/ /g, '').includes(String(rec.v.apaar).replace(/\D/g, '')) });
  rec.docResult = { at: nowISO(), text: text.slice(0, 5000), extracted: true, results, mismatches: results.filter(r => r.ok === false).map(r => r.f) };
}

function saveRecord(rerun) {
  if (!can('edit')) return;
  const form = $('#recForm'); if (!form) return;
  const rec = state.records.find(r => r.id === form.dataset.id); if (!rec) return;
  const nv = {};
  form.querySelectorAll('[data-f]').forEach(i => nv[i.dataset.f] = i.value.trim());
  const errs = [];
  if (!blank(nv.dob) && !parseDate(nv.dob)) errs.push('Date of birth must be a valid past date (DD-MM-YYYY or YYYY-MM-DD).');
  if (!blank(nv.admYear) && !/^\d{4}$/.test(nv.admYear)) errs.push('Admission year must be a 4-digit year.');
  if (!blank(nv.apaar)) { try { if (!new RegExp(state.settings.apaarPattern).test(nv.apaar)) errs.push(`APAAR ID must match ${state.settings.apaarPattern}. Do not guess IDs.`); } catch (e) { /* invalid pattern ignored */ } }
  if (blank(nv.ref)) errs.push('Institution reference cannot be blank.');
  const box = $('#recErr');
  if (errs.length) { box.hidden = false; box.innerHTML = errs.map(esc).join('<br>'); return; }
  box.hidden = true;
  const changes = FIELDS.map(f => f.k).filter(k => String(rec.v[k] ?? '') !== nv[k]);
  if (!changes.length) { toast('No changes to save.'); if (rerun) { runValidation(); closeModal(); rerender(); } return; }
  changes.forEach(k => {
    state.versions.push({ id: uid('v'), recId: rec.id, ref: rec.v.ref, field: k, old: rec.v[k] ?? '', new: nv[k], by: session.email, at: nowISO() });
    clearDecisions(rec.id, k);
    audit('Record corrected', rec.v.ref, `${FIELD_LABEL[k]}: "${rec.v[k] ?? ''}" -> "${nv[k]}"`);
    rec.v[k] = nv[k];
  });
  save();
  toast(`Saved ${changes.length} correction(s). Re-run validation to confirm the issues are resolved.`, 'success');
  if (rerun) { runValidation(); }
  closeModal(); rerender();
  if (!rerun) openRecord(rec.id);
}
function clearDecisions(recId, field) {
  Object.keys(state.decisions).forEach(k => {
    const [rule, rid, fld, extra] = k.split('|');
    if ((rid === recId && fld === field) || (rule === 'DUP-FUZZY' && extra === recId)) delete state.decisions[k];
  });
}
function saveDecision(key) {
  if (!can('review')) return;
  const f = state.findings.find(x => x.key === key); if (!f) return;
  const sel = $(`[data-fkey="${CSS.escape(key)}"]`), note = $(`[data-nkey="${CSS.escape(key)}"]`);
  const status = sel.value, n = (note.value || '').trim().slice(0, 300);
  const before = f.status;
  if (status === 'open') delete state.decisions[key];
  else state.decisions[key] = { status, note: n, by: session.email, at: nowISO() };
  f.status = status; f.note = n;
  audit('Review decision', f.ref, `${f.ruleId} (${FIELD_LABEL[f.field] || f.field}): ${STATUS_LABEL[before]} -> ${STATUS_LABEL[status]}${n ? '; note: ' + n : ''}`);
  toast('Decision saved.', 'success');
  const rid = f.recId; rerender(); openRecord(rid);
}

/* ------------------------------------------------------------------ */
/* Settings save, import, exports                                      */
/* ------------------------------------------------------------------ */
function saveSettings(e) {
  e.preventDefault();
  if (!can('settings')) return;
  const S = JSON.parse(JSON.stringify(state.settings));
  const err = $('#setErr'); const errs = [];
  S.institution = $('#s_inst').value.trim() || S.institution;
  S.required = [...document.querySelectorAll('input[name=req]:checked')].map(i => i.value);
  S.apaarPattern = $('#s_pat').value;
  try { new RegExp(S.apaarPattern); } catch (x) { errs.push('Identifier pattern is not a valid regular expression.'); }
  const num = (id, lo, hi, label) => { const v = Number($(id).value); if (!Number.isFinite(v) || v < lo || v > hi) { errs.push(`${label} must be between ${lo} and ${hi}.`); return null; } return v; };
  S.dupThreshold = num('#s_dup', 50, 100, 'Duplicate threshold') ?? S.dupThreshold;
  S.minYear = num('#s_miny', 1950, 2100, 'Earliest admission year') ?? S.minYear;
  S.minAge = num('#s_mina', 0, 100, 'Minimum age') ?? S.minAge;
  S.maxAge = num('#s_maxa', 0, 100, 'Maximum age') ?? S.maxAge;
  S.retentionDays = num('#s_ret', 1, 3650, 'Retention days') ?? S.retentionDays;
  if (S.minAge > S.maxAge) errs.push('Minimum age cannot exceed maximum age.');
  RULES.forEach(r => S.severity[r.id] = $('#sev_' + r.id).value);
  ['completeness', 'format', 'consistency', 'review'].forEach(k => { S.weights[k] = num('#w_' + k, 0, 100, 'Weight (' + k + ')') ?? S.weights[k]; });
  if (Object.values(S.weights).reduce((a, b) => a + b, 0) <= 0) errs.push('At least one score weight must be greater than 0.');
  S.checklist = [...document.querySelectorAll('.chk-row')].map(r => ({ id: r.dataset.id, text: r.querySelector('.c-text').value.trim(), source: r.querySelector('.c-src').value.trim(), effective: r.querySelector('.c-eff').value, verified: r.querySelector('.c-ver').checked })).filter(c => c.text);
  if (errs.length) { err.hidden = false; err.innerHTML = errs.map(esc).join('<br>'); return; }
  err.hidden = true;
  const diff = Object.keys(S).filter(k => !['ruleVersion', 'ruleHistory'].includes(k) && JSON.stringify(S[k]) !== JSON.stringify(state.settings[k]));
  if (!diff.length) { toast('No changes to save.'); return; }
  S.ruleVersion = state.settings.ruleVersion + 1;
  S.ruleHistory = state.settings.ruleHistory.concat([{ version: S.ruleVersion, at: nowISO(), by: session.email, summary: 'Changed: ' + diff.join(', ') }]);
  state.settings = S;
  audit('Rules updated', 'v' + S.ruleVersion, 'Changed: ' + diff.join(', '));
  if (state.records.length) runValidation(false);
  save(); toast(`Rules saved as version ${S.ruleVersion}.`, 'success'); rerender();
}

function importUpload() {
  if (!up) return;
  const idx = {}; let missing = [];
  FIELDS.forEach(f => { const el = $('#map_' + f.k); idx[f.k] = el && el.value !== '' ? Number(el.value) : -1; });
  state.settings.required.forEach(k => { if (idx[k] < 0) missing.push(FIELD_LABEL[k]); });
  const used = Object.values(idx).filter(i => i >= 0);
  if (new Set(used).size !== used.length) { $('#uploadMsg').innerHTML = '<div class="alert error">Each file column can be mapped to only one field.</div>'; return; }
  if (missing.length) { $('#uploadMsg').innerHTML = `<div class="alert error">Missing required column mapping: ${esc(missing.join(', '))}. Map the column(s), or an Administrator can change required fields in Settings.</div>`; return; }
  if (state.records.length && !confirm('Importing will replace the current dataset, findings and decisions. Continue?')) return;
  state.records = up.rows.map(r => {
    const v = {}; FIELDS.forEach(f => v[f.k] = idx[f.k] >= 0 ? String(r[idx[f.k]] ?? '').trim() : '');
    return { id: uid('r'), v, orig: { ...v }, docResult: null };
  });
  state.decisions = {}; state.versions = []; state.runs = [];
  state.datasetName = up.fileName; state.importedAt = nowISO();
  audit('Dataset imported', up.fileName, `${state.records.length} records`);
  up = null;
  runValidation(false);
  toast('Dataset imported and validated.', 'success');
  location.hash = '#/results';
}
async function handleFile(file) {
  if (!file) return;
  if (!can('upload')) { toast('You do not have permission to upload.', 'error'); return; }
  try { up = await readUpload(file); rerender(); }
  catch (err) { up = null; const m = $('#uploadMsg'); if (m) m.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; toast(err.message, 'error'); }
}

function logExport(name, fmt) {
  const m = metrics();
  state.exports.push({ id: uid('x'), at: nowISO(), user: session.email, name, fmt, clean: m.eligible });
  audit('Export', name, `${fmt}${m.eligible ? '' : ' (issues disclosed)'}`);
}
function doExport(kind, fmt) {
  if (!can('export')) { toast('You do not have permission to export.', 'error'); return; }
  const m = metrics();
  if (kind === 'expData' && !m.eligible && !confirm(`This dataset is NOT clean: ${m.blockingCount} blocking error(s), ${m.pending} pending review decision(s). The export will include a validation_status column. Export anyway?`)) return;
  const stamp = new Date().toISOString().slice(0, 10);
  let name, sheets;
  const recById = Object.fromEntries(state.records.map(r => [r.id, r]));
  if (kind === 'expData') {
    const head = FIELDS.map(f => f.l).concat(['Validation status', 'Open issues']);
    const rows = state.records.map(r => FIELDS.map(f => f.k === 'dob' ? (parseDate(r.v.dob) || r.v.dob) : r.v[f.k]).concat([{ error: 'Errors', review: 'Needs review', pass: 'Passing' }[statusOf(r.id)], state.findings.filter(f => f.recId === r.id && !closed(f)).length]));
    name = `corrected_dataset_${stamp}`; sheets = [{ name: 'Corrected dataset', rows: [head, ...rows] }];
  } else if (kind === 'expIssues') {
    const head = ['Record reference', 'Student name', 'Field', 'Category', 'Severity', 'Rule ID', 'Explanation', 'Suggested action', 'Review status', 'Reviewer note'];
    const rows = state.findings.map(f => [f.ref, recById[f.recId] ? recById[f.recId].v.name : '', FIELD_LABEL[f.field] || f.field, f.cat, f.severity, f.ruleId, f.message, f.action, STATUS_LABEL[f.status], f.note]);
    name = `detailed_issue_report_${stamp}`; sheets = [{ name: 'Summary', rows: summaryRows(m) }, { name: 'Issues', rows: [head, ...rows] }];
  } else if (kind === 'expSummary') {
    name = `validation_summary_${stamp}`; sheets = [{ name: 'Summary', rows: summaryRows(m) }];
  } else {
    const head = ['Run time', 'Run by', 'Dataset', 'Records', 'Records with errors', 'Needs review', 'Passing', 'Score', 'Rule set version'];
    name = `validation_run_history_${stamp}`;
    sheets = [{ name: 'Run history', rows: [head, ...state.runs.map(r => [r.at, r.by, r.dataset, r.total, r.errors, r.review, r.pass, r.score ?? 'N/A', 'v' + r.ruleVersion])] }];
  }
  if (fmt === 'xlsx') { if (!downloadXLSX(name + '.xlsx', sheets)) return; }
  else downloadCSV(name + '.csv', sheets[sheets.length - 1].rows.length && sheets.length > 1 && kind === 'expIssues' ? sheets[1].rows : sheets[0].rows);
  logExport(name, fmt.toUpperCase());
  toast('Export created. This is a local report, not an official APAAR certificate.', 'success');
  rerender();
}
function summaryRows(m) {
  const rows = [['Metric', 'Value'], ['Dataset', state.datasetName], ['Generated', nowISO()], ['Generated by', session.email], ['Rule set version', 'v' + state.settings.ruleVersion],
    ['Total records', m.total], ['Records passing', m.pass], ['Records with errors', m.errors], ['Records needing review', m.review], ['Records with warnings', m.warn],
    ['Blocking issues', m.blockingCount], ['Pending review decisions', m.pending], ['Eligible for clean export', m.eligible ? 'Yes' : 'No'],
    ['Data-quality score', m.score.value === null ? 'N/A' : m.score.value], ['Note', 'Data-quality indicator only; not an official APAAR score or certificate.'], ['', ''], ['Issues by category (open)', 'Count']];
  CATS.forEach(c => rows.push([c, state.findings.filter(f => f.cat === c && !closed(f)).length]));
  return rows;
}
function template(fmt) {
  const head = FIELDS.map(f => f.l);
  const rows = sampleRows().slice(0, 3).map(r => FIELDS.map(f => r[f.k]));
  if (fmt === 'xlsx') downloadXLSX('student_template.xlsx', [{ name: 'Template', rows: [head, ...rows] }]);
  else downloadCSV('student_template.csv', [head, ...rows]);
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */
const ACTIONS = {
  loadSample() { if (!can('upload')) return toast('You do not have permission to load data.', 'error'); if (state.records.length && !confirm('Replace the current dataset with the synthetic demo data?')) return; up = null; loadSample(); location.hash = '#/dashboard'; rerender(); },
  revalidate() { if (!can('validate')) return; if (!state.records.length) return toast('Load a dataset first.', 'error'); runValidation(); rerender(); },
  tplCSV() { template('csv'); }, tplXLSX() { template('xlsx'); },
  importUp: importUpload,
  cancelUp() { up = null; rerender(); },
  prev() { ui.page--; rerender(); }, next() { ui.page++; rerender(); },
  closeModal,
  saveRerun() { saveRecord(true); },
  saveDecision(t) { saveDecision(t.dataset.key); },
  compareDoc() {
    const form = $('#recForm'); const rec = state.records.find(r => r.id === form.dataset.id); if (!rec) return;
    compareDoc(rec); audit('Document comparison', rec.v.ref, rec.docResult.extracted ? `mismatches: ${rec.docResult.mismatches.join(', ') || 'none'}` : 'no text provided');
    state.findings = validate(state.records, state.settings, state.decisions); save();
    rerender(); openRecord(rec.id);
  },
  addChk() { const c = { id: uid('c'), text: '', source: '', effective: '', verified: false }; $('#chk').insertAdjacentHTML('beforeend', checklistRow(c)); },
  deleteData() {
    if (!can('settings')) return;
    if (!confirm('Delete the current dataset, findings and corrections? The audit log is kept. This cannot be undone.')) return;
    state.records = []; state.findings = []; state.decisions = {}; state.versions = []; state.runs = []; state.datasetName = ''; state.importedAt = '';
    audit('Dataset deleted', '', 'Manual deletion by administrator'); toast('Dataset deleted.'); location.hash = '#/dashboard'; rerender();
  },
  resetAll() {
    if (!can('settings')) return;
    if (!confirm('Reset EVERYTHING including rules and the audit log? This cannot be undone.')) return;
    state = freshState(); save(); audit('Demo reset', '', 'All data cleared'); toast('Demo reset.'); location.hash = '#/dashboard'; rerender();
  },
  expData(t) { doExport('expData', t.dataset.fmt); }, expIssues(t) { doExport('expIssues', t.dataset.fmt); },
  expSummary(t) { doExport('expSummary', t.dataset.fmt); }, expRuns(t) { doExport('expRuns', t.dataset.fmt); }
};

document.addEventListener('click', e => {
  const act = e.target.closest('[data-act]');
  if (act) { const fn = ACTIONS[act.dataset.act]; if (fn) { e.preventDefault(); fn(act); } return; }
  const sort = e.target.closest('[data-sort]');
  if (sort) { const k = sort.dataset.sort; if (ui.sort === k) ui.dir *= -1; else { ui.sort = k; ui.dir = 1; } rerender(); return; }
  const row = e.target.closest('tr[data-rec]');
  if (row) { openRecord(row.dataset.rec); return; }
  if (e.target.classList && e.target.classList.contains('modal-back')) closeModal();
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset && t.dataset.map && up) { up.mapping[t.dataset.map] = t.value; return; }
  if (t.dataset && t.dataset.filter) {
    const map = { cat: 'cat', sev: 'sev', status: 'status', dept: 'dept', runf: 'run' };
    ui[map[t.dataset.filter]] = t.value; ui.page = 1; rerender();
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ------------------------------------------------------------------ */
/* Login / logout / init                                               */
/* ------------------------------------------------------------------ */
function initLogin() {
  const form = $('#loginForm');
  $('#togglePw').addEventListener('click', () => {
    const p = $('#password'); const show = p.type === 'password';
    p.type = show ? 'text' : 'password'; $('#togglePw').textContent = show ? 'Hide' : 'Show';
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const email = $('#email').value.trim().toLowerCase(), pw = $('#password').value;
    $('#emailErr').textContent = ''; $('#pwErr').textContent = ''; $('#loginErr').hidden = true;
    let bad = false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('#emailErr').textContent = 'Enter a valid email address.'; bad = true; }
    if (pw.length < 1) { $('#pwErr').textContent = 'Enter your password.'; bad = true; }
    if (bad) return;
    const btn = $('#loginBtn'); btn.disabled = true; btn.textContent = 'Signing in...';
    setTimeout(() => {
      const u = USERS.find(x => x.email === email && x.pw === pw);
      btn.disabled = false; btn.textContent = 'Sign in';
      if (!u) { $('#loginErr').hidden = false; $('#loginErr').textContent = 'Invalid email or password.'; return; }
      session = { email: u.email, name: u.name, role: u.role, at: Date.now() };
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (x) { /* ignore */ }
      audit('Login', u.email, u.role);
      form.reset(); location.hash = '#/dashboard'; router();
    }, 350);
  });
}

function init() {
  $('#yr').textContent = new Date().getFullYear();
  const img = $('#aicteLogo');
  img.addEventListener('error', () => { img.hidden = true; $('#logoFallback').hidden = false; });
  load(); loadSession(); initLogin();
  $('#logoutBtn').addEventListener('click', () => { audit('Logout', session ? session.email : '', ''); session = null; try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } toast('You have been signed out.'); location.hash = '#/login'; router(); });
  $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#globalSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { ui.q = e.target.value; ui.page = 1; if (currentRoute() === 'results') rerender(); else location.hash = '#/results'; } });
  window.addEventListener('hashchange', router);
  router();
}
document.addEventListener('DOMContentLoaded', init);
})();
