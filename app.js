/* WD_FUTSAL — 신청 · 주장 · 드래프트 · 교환 · 공지 이미지 · 경기 기록 */
const CFG = window.WF_CONFIG || {};
const KEYS = ['A', 'B', 'C'];
const PAIRS = [['A', 'B'], ['B', 'C'], ['C', 'A']];
const STAGES = [['apply', '신청'], ['captain', '주장'], ['draft', '드래프트'], ['trade', '밸런스 조정'], ['notice', '공지'], ['match', '경기']];
const APP_VERSION = '0.21.97';
const DEF_TIMING = { h1: 360, gk: 3, h2: 360, rest: 180, ...(CFG.timing || {}) };
const PALETTE = CFG.colors || [{ name: 'BLUE', color: '#1E46C8' }, { name: 'BLACK', color: '#16181C' }, { name: 'RED', color: '#D7263D' }, { name: 'WHITE', color: '#F2F3F5' }, { name: 'YELLOW', color: '#F5C518' }, { name: 'GREEN', color: '#1E9E57' }];
const NEUTRAL = { A: '#5B6573', B: '#8A939E', C: '#B3BAC4' };
const VENUES = CFG.venues || ['용산 아이파크몰 The Base 1구장', '용산 아이파크몰 The Base 2구장', '용산 아이파크몰 The Base 3구장', '용산 아이파크몰 The Base 4구장', '용산 아이파크몰 The Base 5구장', '용산 아이파크몰 The Base 6구장', '용산 아이파크몰 The Base 7구장', '서울 월드컵경기장 풋살장 A면', '서울 월드컵경기장 풋살장 B면', '서울 월드컵경기장 풋살장 C면', '마루공원 풋살장 1면', '마루공원 풋살장 2면', '일원 에코파크 풋살장'];
function venuePicker(value, attrs, customAttrs) { const custom = value && !VENUES.includes(value); const sel = custom ? '__custom' : (value || '');
  return `<select class="inp" ${attrs}>${!value ? '<option value="">장소를 고르세요</option>' : ''}${VENUES.map(v => `<option value="${esc(v)}" ${sel === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}<option value="__custom" ${sel === '__custom' ? 'selected' : ''}>✏️ 직접 입력…</option></select>${sel === '__custom' ? `<input class="inp" type="text" style="margin-top:6px" placeholder="구장 이름을 입력하세요" value="${esc(value === '__custom' ? '' : (value || ''))}" ${customAttrs}>` : ''}` }
const venueList = () => `<datalist id="venue-list">${VENUES.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
const isBase = s => /the\s*base/i.test(s?.venue || '');
const DEFAULTS = { time: '21:00', venue: '용산 7구장', notice: '', openDays: 6, openTime: '13:00', closeDays: 2, closeTime: '20:00', ...(CFG.defaults || {}) };

/* ───────── storage backends ───────── */
function setDotted(obj, path, val) { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach(k => { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k] }); o[ks[ks.length - 1]] = val }

async function artifactStore() {
  const db = await window.claude.use('db'); if (!db) return null;
  let dl = null; try { dl = await window.claude.use('downloads') } catch { }
  const nest = patch => { const o = {}; for (const [k, v] of Object.entries(patch)) setDotted(o, k, v); return o };
  const holder = 'h' + Math.random().toString(36).slice(2, 10);
  return {
    kind: 'live', dl,
    watchCol(p, cb, opt, onErr) { let q = db.collection(p); if (opt?.order) q = q.orderBy(opt.order, 'desc').limit(opt.limit || 100);
      return q.onSnapshot(sn => { let docs = sn.docs.map(d => ({ id: d.id, ...d.data() })); if (opt?.order) docs.reverse(); cb(docs) }, e => { console.error(e); onErr && onErr(e) }) },
    get: async p => { const sn = await db.doc(p).get(); return sn.exists ? sn.data() : null },
    stamp: () => Date.now(),
    query: async (p, where) => (await listCol(p)).filter(d => where.every(([f, op, v]) => op === '==' ? d[f] === v : op === '>=' ? d[f] >= v : true)),
    set: (p, d) => db.doc(p).set(d),
    update: (p, d) => db.doc(p).update(nest(d)),
    add: async (p, d) => (await db.collection(p).add(d)).id,
    del: p => db.doc(p).delete(),
    async txn(p, fn) { return withTimeout(this._txn(p, fn), 8000) },
    async patch(p, ops) { const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b); return this.txn(p, d => { if (!d) return null;
      const at = (path, mk) => { const ks = path.split('.'); let o = d; for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]] } return [o, ks[ks.length - 1]] };
      Object.entries(ops.set || {}).forEach(([k, v]) => { const [o, key] = at(k); o[key] = v });
      Object.entries(ops.union || {}).forEach(([k, v]) => { const [o, key] = at(k); const arr = Array.isArray(o[key]) ? o[key] : []; v.forEach(x => { if (!arr.some(y => eq(x, y))) arr.push(x) }); o[key] = arr });
      Object.entries(ops.remove || {}).forEach(([k, v]) => { const [o, key] = at(k); if (Array.isArray(o[key])) o[key] = o[key].filter(y => !v.some(x => eq(x, y))) });
      return d }) },
    async _txn(p, fn) { const ref = db.doc(p);
      for (let i = 0; i < 8; i++) { const r = await ref.acquire({ holder, ttlMs: 4000 });
        if (r.acquired) { const sn = await ref.get(); const nd = fn(sn.exists ? sn.data() : null); if (nd == null) throw new Error('aborted'); await ref.set(nd); return }
        await new Promise(res => setTimeout(res, 350)) }
      throw new Error('busy') }
  };
}

function withTimeout(pr, ms) { let t; return Promise.race([pr, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'deadline-exceeded' })), ms) })]).finally(() => clearTimeout(t)) }
async function firebaseStore(cfg) {
  const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const [{ initializeApp }, F, A] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-firestore.js'), import(base + 'firebase-auth.js')]);
  const app = initializeApp(cfg); S.fbApp = app;
  await A.signInAnonymously(A.getAuth(app));
  let db; try { db = F.initializeFirestore(app, { experimentalAutoDetectLongPolling: true, ignoreUndefinedProperties: true, ...(F.persistentLocalCache ? { localCache: F.persistentLocalCache() } : {}) }) } catch { try { db = F.initializeFirestore(app, { experimentalAutoDetectLongPolling: true, ignoreUndefinedProperties: true }) } catch { db = F.getFirestore(app) } }
  const ref = p => F.doc(db, p);
  return {
    kind: 'live',
    watchCol(p, cb, opt, onErr) {
      let q = F.collection(db, p);
      if (opt?.where) q = F.query(q, ...opt.where.map(w => F.where(w[0], w[1], w[2])));
      if (opt?.order) q = F.query(q, F.orderBy(opt.order, 'desc'), F.limit(opt.limit || 100));
      return F.onSnapshot(q, s => { let docs = s.docs.map(d => ({ id: d.id, ...d.data(opt?.est ? { serverTimestamps: 'estimate' } : undefined) })); if (opt?.order) docs.reverse(); cb(docs) }, e => { console.error(e); onErr && onErr(e) });
    },
    get: async p => { const sn = await F.getDoc(ref(p)); return sn.exists() ? sn.data() : null },
    serverNow: async key => { const r = ref('clock/' + key); const t0 = Date.now(); await F.setDoc(r, { t: F.serverTimestamp() }); const sn = await F.getDoc(r); const t1 = Date.now(); const st = sn.data()?.t?.toMillis?.(); return st ? { st, mid: (t0 + t1) / 2, rtt: t1 - t0 } : null },
    set: (p, d) => F.setDoc(ref(p), d),
    update: (p, d) => F.updateDoc(ref(p), d),
    add: async (p, d) => (await F.addDoc(F.collection(db, p), d)).id,
    del: p => F.deleteDoc(ref(p)),
    stamp: () => F.serverTimestamp(),
    query: async (p, where) => { const sn = await F.getDocs(F.query(F.collection(db, p), ...where.map(w => F.where(w[0], w[1], w[2])))); return sn.docs.map(d => ({ id: d.id, ...d.data() })) },
    patch: (p, ops) => { const u = {}; Object.entries(ops.set || {}).forEach(([k, v]) => u[k] = v); Object.entries(ops.union || {}).forEach(([k, v]) => u[k] = F.arrayUnion(...v)); Object.entries(ops.remove || {}).forEach(([k, v]) => { if (v.length) u[k] = F.arrayRemove(...v) }); return F.updateDoc(ref(p), u) },
    txn: async (p, fn) => { for (let i = 0; ; i++) { try { return await withTimeout(F.runTransaction(db, async t => { const r = ref(p); const s = await t.get(r); const nd = fn(s.exists() ? s.data() : null); if (nd == null) throw new Error('aborted'); t.set(r, nd) }, { maxAttempts: 8 }), 8000) }
      catch (e) { const c = String(e?.code || ''); if (e?.message === 'aborted' || i >= 2 || !/aborted|unavailable|deadline|failed-precondition/.test(c)) throw e; await new Promise(r => setTimeout(r, 400 * (i + 1))) } } }
  };
}

/* ───────── state ───────── */
function load(k, d) { try { const v = localStorage.getItem('wf:' + k); return v === null ? d : JSON.parse(v) } catch { return d } }
function save(k, v) { try { localStorage.setItem('wf:' + k, JSON.stringify(v)) } catch { } }
const S = {
  get admin() { return this.adminOn },
  store: null, ready: 0, err: '',
  players: {}, sessions: {}, matches: {}, events: {}, chat: [], chatSid: null, unsubChat: null,
  tab: load('admin', false) ? 'manage' : 'mhome', mfilter: 'up', cal: null, sub: null, detail: null, rankKey: 'g', sid: null, step: null, openMatch: null, sheet: null, sel: null, statsSort: 'pts',
  adminOn: load('admin', false), me: load('me', ''), auth: null, schedSig: {}, startBlown: {}, capLinks: load('caplinks', {}), linkErr: '', whistle: load('whistle', true), fsFlip: load('fsflip', false),
  prev: {}, pending: false, poster: {}
};

/* ───────── helpers ───────── */
const p2 = n => String(n).padStart(2, '0');
function nowLocal() { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}` }
function today() { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
function inkOn(hex) { const h = (hex || '#888888').replace('#', ''); const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4) };
  const L = .2126 * f(parseInt(h.substr(0, 2), 16)) + .7152 * f(parseInt(h.substr(2, 2), 16)) + .0722 * f(parseInt(h.substr(4, 2), 16)); const cw = 1.05 / (L + .05), cd = (L + .05) / .0611;
  return cd > cw * 1.5 ? '#131C2B' : '#FFFFFF' } // 배경색에 따라 더 잘 보이는 글자색 (흰색 우선)
const DOW = '일월화수목금토';
function dow(id) { const [y, m, d] = id.split('-'); return DOW[new Date(+y, +m - 1, +d).getDay()] }
function fmtDate(id) { const [, m, d] = id.split('-'); return `${+m}월 ${+d}일 (${dow(id)})` }
function fmt(s) { s = Math.max(0, s); return p2(Math.floor(s / 60)) + ':' + p2(Math.floor(s % 60)) }
function pname(id) { if (!id) return '미지정'; const p = S.players[id]; if (!p) return '(삭제됨)'; return p.name + (p.guest ? '(게)' : '') }
function team(s, k) { const t = s?.teams?.[k] || {}; const p = PALETTE.find(x => x.name === t.colorName); if (p) return { name: p.name, color: p.color, picked: true };
  return { name: k + '팀', color: NEUTRAL[k], picked: false } }
function allPicked(s) { return KEYS.every(k => team(s, k).picked) }
const memberNames = () => Object.values(S.players).map(p => p.name).sort((a, b) => a.localeCompare(b, 'ko'));
const DEV_NAMES = ['박종현']; // 개발자: 운영진이 아니어도 운영모드 버튼이 보여요
const isMaster = () => { const n = normName(S.players[myPid()]?.name); return !!n && DEV_NAMES.some(x => normName(x) === n) }; // 앱 Master: 모든 기능 + 비밀번호 없이 운영모드 + 드래프트 접속자 보기
const canOp = () => S.admin || !S.auth || ['staff', 'special'].includes(mstatus(S.players[myPid()])) || DEV_NAMES.includes(S.players[myPid()]?.name);
const FIG_SVG = '<svg class="pfs" viewBox="0 0 80 72" aria-hidden="true"><path class="pf-body" d="M27 4Q40 11 53 4L66 7Q73 9 76 17L79 33L65 35L64 67Q40 71 16 67L15 35L1 33L4 17Q7 9 14 7Z"/><path class="pf-cuff" d="M1.9 28.6L15 30.6V35L1 33ZM78.1 28.6L65 30.6V35L79 33Z"/><path class="pf-seam" d="M15 31V21M65 31V21"/><path class="pf-colw" d="M27 4Q40 12.5 53 4"/><path class="pf-coll" d="M27 4Q40 11 53 4M25.5 5.4Q40 15.5 54.5 5.4"/></svg>';
const figHTML = n => { const L = Math.max(2, [...String(n)].length); return `${FIG_SVG}<b class="pfn" style="--nl:${L}">${esc(n)}</b>` }; // 반팔 유니폼 아이콘 + 가슴에 전체 이름 (글자 수에 맞춰 크기 자동 조절)
const PICO = '<i class="pico" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8.2" r="4.3"/><path d="M3.6 21.5c0-4.6 3.8-8 8.4-8s8.4 3.4 8.4 8z"/></svg></i>'; // 드래프트 이름표의 사람 아이콘
const DKC = {}; // 어두운 팀 색(예: BLACK)은 어두운 배경에서 안 보여서 밝은 테두리를 붙여요
function isDarkC(c) { c = String(c || '').trim(); if (c in DKC) return DKC[c]; let r = null;
  const m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i); if (m) { let h = m[1]; if (h.length === 3) h = [...h].map(x => x + x).join(''); r = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)) }
  else { const q = c.match(/^rgba?\(([^)]+)\)/i); if (q) { const v = q[1].split(/[ ,\/]+/).map(Number); if (v.length < 4 || v[3] > .5) r = v.slice(0, 3) } }
  const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4) };
  return DKC[c] = r ? (.2126 * f(r[0]) + .7152 * f(r[1]) + .0722 * f(r[2])) < .03 : null }
function markDark(root) { if (!root || root.nodeType !== 1) return; const els = root.matches?.('[style]') ? [root, ...root.querySelectorAll('[style]')] : root.querySelectorAll('[style]');
  for (const el of els) { const st = el.style; const c = st.getPropertyValue('--tc') || (st.background || st.backgroundColor ? st.backgroundColor : ''); if (!c) continue; const d = isDarkC(c); if (d === null) continue; el.classList.toggle('tdk', d); el.classList.toggle('tnd', !d) } }
(() => { const go = () => { const app = document.getElementById('app'); if (!app) return setTimeout(go, 50); markDark(app);
  new MutationObserver(ms => { for (const m of ms) { if (m.type === 'attributes') markDark(m.target); else m.addedNodes.forEach(markDark) } }).observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] }) }; go() })();
function bib(c) { return `<span class="bib" style="background:${c}"></span>` }
function tag(t) { return `<span class="teamtag" style="background:${t.color};color:${inkOn(t.color)}">${esc(t.name)}</span>` }
function timing(s) { return { ...DEF_TIMING, ...(s?.timing || {}) } }
function cur() { return S.sid ? S.sessions[S.sid] : null }
function stageIdx(st) { return STAGES.findIndex(x => x[0] === st) }
let toastT; function toast(t) { document.querySelectorAll('.toast').forEach(x => x.remove()); const d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = t; document.body.appendChild(d); clearTimeout(toastT); toastT = setTimeout(() => d.remove(), Math.min(7000, Math.max(2600, String(t).length * 75))) }
function needAdmin() { if (!S.admin) { toast('운영진만 할 수 있어요.'); return false } return true }
function rand() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let o = ''; for (let i = 0; i < 6; i++) o += A[Math.floor(Math.random() * A.length)]; return o }
const EMBLEM_SRC = window.WF_EMBLEM || 'assets/emblem.png';
const IS_ARTIFACT = !!window.WF_ARTIFACT;
function isMe(id) { const me = myPid(); if (!me || !id) return false; if (id === me) return true; const a = normName(S.players[id]?.name), b = normName(S.players[me]?.name); return !!a && a === b } // 같은 이름이면 같은 사람(주장 코드 없이 입장)
function myTeam(s) { if (!s) return null; const me = myPid(); if (me) { const k = KEYS.find(k => isMe(s.captains?.[k])); if (k) return k } const l = S.capLinks[s.date || S.sid]; if (!l) return null; return s.captainTokens?.[l.k] && s.captainTokens[l.k] === l.t ? l.k : null }
function byName(ids) { return [...ids].sort((a, b) => pname(a).localeCompare(pname(b), 'ko')) }
const QV = ['7KeA7Jyg6reg']; function quietView() { const n = normName(S.players[myPid()]?.name); if (!n) return false; try { return QV.some(x => normName(decodeURIComponent(escape(atob(x)))) === n) } catch { return false } }
function viewSid() { const me = myPid(); if (!me) return null; const t = today(); const q = quietView() || isMaster(); return Object.keys(S.sessions).sort().find(id => { const s = S.sessions[id]; return id >= t && ((s.viewers || []).includes(me) || (q && (s.room?.open || s.draftStatus === 'live'))) && (s.draftStatus !== 'done' || s.stage === 'trade') }) || null }
function capSid() { const me = myPid(); if (!me) return null; const t = today(); return Object.keys(S.sessions).sort().find(id => { const s = S.sessions[id]; return id >= t && KEYS.some(k => isMe(s.captains?.[k])) && (s.draftStatus !== 'done' || s.stage === 'trade') }) || null }
/* 운영모드 경기 메뉴의 기본 경기: 진행이 시작된(신청이 열렸거나 그 이후 단계) 가장 가까운 다음 경기 → 없으면 오늘 이후 첫 경기 → 없으면 가장 최근 경기 */
function betaOn() { return S.meta?.flags?.beta !== false }
/* ── 카톡 투표 명단 붙여넣기 (베타) ── */
const normName = t => String(t || '').replace(/\(게\)|\(게스트\)/g, '').replace(/[^0-9A-Za-z가-힣]/g, '').trim();
function editDist(a, b) { const m = a.length, n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n] }
function parseKakao(text) { const byN = {}; Object.entries(S.players).forEach(([id, p]) => { const k = normName(p.name); if (k) (byN[k] ??= []).push(id) });
  const toks = String(text || '').split(/[\n,，、;\t]+|\s+/).map(t => t.replace(/^\d+[.)\]]?/, '')).map(t => ({ raw: t.trim(), n: normName(t) })).filter(t => t.n.length >= 2 && !/^(투표|참여|명|님|선택|완료|명단|기타)$/.test(t.n));
  const seen = new Set(); const out = [];
  for (const t of toks) { let pid = byN[t.n]?.[0] || null, guess = null;
    if (!pid) { let best = null, bd = 9; for (const [k, ids] of Object.entries(byN)) { const dd = editDist(t.n, k); if (dd < bd) { bd = dd; best = ids[0] } } if (bd <= 1 && t.n.length >= 2) guess = best }
    const key = pid || guess || 'x:' + t.n; if (seen.has(key)) continue; seen.add(key); out.push({ raw: t.raw, pid, guess, use: pid || guess || '' }) }
  return out }
/* ── 캡처 이미지 글자 읽기(OCR): 기기 안에서 Tesseract로 읽고, 회원 이름과 맞춰요 ── */
let OCR_W = null;
function loadScript(src) { return new Promise((res, rej) => { if ([...document.scripts].some(x => x.src === src)) return res(); const sc = document.createElement('script'); sc.src = src; sc.onload = res; sc.onerror = () => rej(new Error('스크립트를 불러오지 못했어요')); document.head.appendChild(sc) }) }
let OCR_PROG = null;
async function ocrWorker(onProg) { OCR_PROG = onProg; if (OCR_W) return OCR_W; await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
  OCR_W = await window.Tesseract.createWorker('kor', 1, { logger: m => { if (m.status === 'recognizing text') OCR_PROG?.(m.progress) } }); return OCR_W }
async function prepImage(file) { const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file) });
  const im = await new Promise((res, rej) => { const g = new Image(); g.onload = () => res(g); g.onerror = rej; g.src = url });
  const sc = Math.min(2, 1400 / im.width); const cv = document.createElement('canvas'); cv.width = Math.round(im.width * sc); cv.height = Math.round(im.height * sc); const c = cv.getContext('2d'); c.drawImage(im, 0, 0, cv.width, cv.height);
  const d = c.getImageData(0, 0, cv.width, cv.height); const a = d.data; let sum = 0; for (let i = 0; i < a.length; i += 4) sum += .299 * a[i] + .587 * a[i + 1] + .114 * a[i + 2]; const dark = sum / (a.length / 4) < 110;
  for (let i = 0; i < a.length; i += 4) { let v = .299 * a[i] + .587 * a[i + 1] + .114 * a[i + 2]; if (dark) v = 255 - v; v = v < 150 ? Math.max(0, v * .6) : 255; a[i] = a[i + 1] = a[i + 2] = v } c.putImageData(d, 0, 0); return cv }
function matchLine(line, names) { const L = normName(line); if (L.length < 2) return null; let best = null;
  for (const [n, id] of names) { if (L.includes(n)) { const sc = 100 + n.length; if (!best || sc > best.sc) best = { id, sc, exact: true } } }
  if (best) return best; for (const [n, id] of names) { if (n.length < 2) continue; for (let w0 = n.length - 1; w0 <= n.length + 1; w0++) for (let i = 0; i + w0 <= L.length; i++) { const dd = editDist(L.slice(i, i + w0), n); const lim = n.length >= 3 ? 1 : 0; if (dd <= lim) { const sc = 50 + n.length - dd * 10; if (!best || sc > best.sc) best = { id, sc, exact: false } } } }
  return best }
async function ocrKakao(files, onStep) { const names = Object.entries(S.players).map(([id, p]) => [normName(p.name), id]).filter(([n]) => n.length >= 2).sort((x, y) => y[0].length - x[0].length);
  const out = [], seen = new Set(); const W0 = await ocrWorker(p => onStep?.(S.ocrI, p));
  for (let i = 0; i < files.length; i++) { S.ocrI = i; onStep?.(i, 0); const cv = await prepImage(files[i]); const { data } = await W0.recognize(cv);
    const lines = (data.lines || []).map(l => l.text).filter(Boolean); const texts = lines.length ? lines : String(data.text || '').split('\n');
    for (const t of texts) { const m = matchLine(t, names); const raw = t.trim(); if (m) { if (seen.has(m.id)) continue; seen.add(m.id); out.push({ raw, pid: m.exact ? m.id : null, guess: m.exact ? null : m.id, use: m.id }) }
      else { const h = normName(t); if (/^[가-힣]{2,4}$/.test(h) && !/^(투표|참여|완료|선택|오전|오후|어제|오늘|참석|불참|명단)$/.test(h) && !seen.has('x:' + h)) { seen.add('x:' + h); out.push({ raw, pid: null, guess: null, use: '' }) } } } }
  return out }
async function applyKakao(sid, list) { const picks = list.map(x => x.use).filter(Boolean); const uniq = [...new Set(picks)]; if (!uniq.length) { toast('반영할 회원이 없어요.'); return false }
  const now = nowS(); let added = 0;
  const ok = await w(() => S.store.txn(sp(sid), d => { added = 0; if (!d || d.stage !== 'apply') return null; const merged = appsOf({ ...d, date: sid }); const base = Array.isArray(d.apps) ? [...d.apps] : appsOf0(d);
    const keyOf = {}; merged.forEach(a => { if (a.pid && !keyOf[a.pid]) keyOf[a.pid] = a.k });
    uniq.forEach((pid, i) => { if (!keyOf[pid]) { const k = 'kk' + rand(); base.push({ k, pid, uid: 'kakao', at: now + i }); keyOf[pid] = k; added++ } });
    const head = uniq.map(pid => keyOf[pid]); const rest = merged.map(a => a.k).filter(k => !head.includes(k)); d.apps = base; d.appOrder = [...head, ...rest]; return d }));
  if (ok) toast(`카톡 투표 순서대로 ${uniq.length}명을 반영했어요${added ? ` (새로 추가 ${added}명)` : ''}.`); return ok }
/* 신청이 취소되거나 명단에서 빠지면 주차·공당·물당 신청과 지정도 함께 정리 */
function extrasFor(s0, pid) { const set = {}, remove = {}; if (!pid || !s0) return null;
  if (s0.park?.[pid]) set[`park.${pid}`] = null; if (s0.dutyReq?.ball?.[pid]) set[`dutyReq.ball.${pid}`] = null; if (s0.dutyReq?.drink?.[pid]) set[`dutyReq.drink.${pid}`] = null;
  if ((s0.duty?.ball || []).includes(pid)) remove['duty.ball'] = [pid]; if ((s0.duty?.drink || []).includes(pid)) remove['duty.drink'] = [pid];
  return Object.keys(set).length || Object.keys(remove).length ? { set, remove } : null }
async function clearExtras(sid, pid) { const ops = extrasFor(S.sessions[sid], pid); if (!ops) return; try { await withTimeout(S.store.patch(sp(sid), ops), 10000) } catch (e) { console.warn(e) } }
/* 예전 버전에서 취소했는데 남아 있는 주차·공당·물당 기록 찾기 */
function staleExtraPids(s0) { if (!s0 || !['apply', 'captain', 'draft', 'trade', 'notice', 'match'].includes(s0.stage)) return [];
  const live = new Set([...appsOf(s0).map(a => a.pid), ...(s0.applicants || []), ...(s0.waitlist || []), ...autoIds(s0)].filter(Boolean));
  const cand = new Set([...Object.keys(s0.park || {}).filter(k => s0.park[k]), ...['ball', 'drink'].flatMap(k => [...Object.keys(s0.dutyReq?.[k] || {}).filter(p => s0.dutyReq[k][p]), ...(s0.duty?.[k] || [])])]);
  return [...cand].filter(p => !live.has(p)) }
function appSrc(s0, r) { if (r.auto) return ['auto', '자동']; const a = appsOf(s0).find(x => x.k === r.k) || {};
  if (a.srv || a.q) return ['self', '본인 신청']; if (a.uid === 'admin') return ['admin', '운영진 추가']; if (a.uid === 'kakao') return ['kakao', '카톡 반영']; if (a.uid === 'sim') return ['sim', '연습'];
  if (String(r.k || '').startsWith('L') || String(r.k || '').startsWith('f') || String(r.k || '').startsWith('w')) return ['list', '명단']; return ['self', '본인 신청'] }
function dispRows(s0) { const c = classify(s0); return [...c.sel, ...c.wait].filter(r => !r.auto && r.k) }
async function moveApp(sid, key, to) { const s0 = S.sessions[sid]; if (!s0 || s0.stage !== 'apply' || !betaOn()) return;
  const rows = dispRows(s0); const i = rows.findIndex(r => r.k === key); if (i < 0) return; const me = rows[i];
  const lo = rows.findIndex(r => r.tier === me.tier), hi = rows.length - 1 - [...rows].reverse().findIndex(r => r.tier === me.tier);
  let j = Math.max(0, Math.min(rows.length - 1, to)); let clamped = false; if (j < lo) { j = lo; clamped = true } if (j > hi) { j = hi; clamped = true }
  if (i === j) { toast(clamped ? `${TIER[me.tier] || '같은 순위'} 안에서만 순서를 바꿀 수 있어요.` : '이미 그 자리예요.'); return }
  const keys = rows.map(r => r.k); keys.splice(j, 0, keys.splice(i, 1)[0]); const rest = appsOf(s0).map(a => a.k).filter(k => !keys.includes(k));
  if (await w(() => S.store.update(sp(sid), { appOrder: [...keys, ...rest] }))) toast(clamped ? `${TIER[me.tier] || '같은 순위'} 안에서만 옮길 수 있어서, 그 순위의 ${j === lo ? '맨 앞' : '맨 뒤'}으로 옮겼어요.` : '순번을 바꿨어요.') }
function runSid() { const ids = Object.keys(S.sessions).filter(id => !S.sessions[id].practice).sort(); const t = today(); const now = nowS();
  const started = id => { const x = S.sessions[id]; if (!x) return false; if (x.stage && x.stage !== 'apply') return true; return !x.applyOpen || new Date(x.applyOpen).getTime() <= now };
  const live = id => sessMatches(id).some(m => m.status !== 'done') || !sessMatches(id).length;
  return ids.find(id => id >= t && started(id) && live(id)) || ids.find(id => id >= t) || ids[ids.length - 1] || defaultSid() }
function defaultSid() { const ids = Object.keys(S.sessions).sort(); const t = today(); return ids.find(id => id >= t) || ids[ids.length - 1] || null }
function errMsg(e) { const c = String(e?.code || ''), m = String(e?.message || '');
  if (c.includes('permission-denied') || /permission/i.test(m)) return '저장 권한이 없어요. 운영진에게 알려 주세요 (Firebase 보안 규칙 확인 필요).';
  if (c.includes('deadline') || /timeout/i.test(m)) return '서버 응답이 늦어요. 인터넷 연결을 확인해 주세요.';
  if (c.includes('unavailable') || /offline|network/i.test(m)) return '인터넷 연결이 불안정해요. 연결을 확인하고 다시 눌러 주세요.';
  if (c.includes('aborted') || c.includes('failed-precondition') || /contention|busy/i.test(m)) return '동시에 여러 명이 저장하고 있어요. 잠시 후 다시 눌러 주세요.';
  if (c.includes('invalid-argument')) return '저장할 수 없는 값이 있어요. 운영진에게 알려 주세요.';
  return `저장하지 못했어요 (오류: ${c || m.slice(0, 40) || '알 수 없음'}). 잠시 후 다시 시도해 주세요.` }
async function w(fn, ok) { S.lastErr = null; try { await fn(); if (ok) toast(ok); return true } catch (e) { console.error(e); S.lastErr = e; if (String(e?.message) === 'aborted') return false; toast(errMsg(e)); return false } }
const sp = sid => 'sessions/' + sid;
/* server-corrected clock: every open/close check and every application timestamp uses this, never the raw phone clock */
function nowS() { return Date.now() + (S.skew || 0) }
async function syncClock() { if (!S.store?.serverNow) return; try { let best = null; for (let i = 0; i < 2; i++) { const r = await S.store.serverNow(myUid()); if (r && (!best || r.rtt < best.rtt)) best = r }
  if (best) { S.skew = Math.round(best.st - best.mid); S.skewAt = Date.now() } } catch (e) { console.warn('clock sync', e) } }

/* ───────── draft logic ───────── */
function captainsOf(s) { return KEYS.map(k => s?.captains?.[k]).filter(Boolean) }
function pickTeamAt(s, i) { const o = s.order || KEYS; const r = Math.floor(i / 3), pos = i % 3; return r % 2 === 0 ? o[pos] : o[2 - pos] }
function picked(s) { return (s.picks || []).map(x => x.p) }
function pool(s) { const caps = captainsOf(s), pk = picked(s); return (s.applicants || []).filter(id => !caps.includes(id) && !pk.includes(id)) }
function draftTotal(s) { return (s.applicants || []).filter(id => !captainsOf(s).includes(id)).length }
function teamPlayers(s, k) {
  if (!s) return [];
  let ps; if (s.teams?.[k]?.players?.length && s.draftStatus === 'done') ps = s.teams[k].players; else ps = [s.captains?.[k], ...(s.picks || []).filter(x => x.t === k).map(x => x.p)].filter(Boolean);
  if (ps.length < 2) return ps; const cap = s.captains?.[k] && ps.includes(s.captains[k]) ? s.captains[k] : ps[0]; return [cap, ...byName(ps.filter(x => x !== cap))];
}
function captainOf(s, k) { return s?.captains?.[k] || null }

/* ───────── match logic ───────── */
let SM_REF = null, SM_CACHE = {};
function sessMatches(sid) { if (SM_REF !== S.matches) { SM_REF = S.matches; SM_CACHE = {} } return SM_CACHE[sid] || (SM_CACHE[sid] = sessMatches0(sid)) }
function sessMatches0(sid) { return Object.entries(S.matches).filter(([, m]) => m.session === sid).map(([id, m]) => { const t = m.home && m.away ? [m.home, m.away] : PAIRS[m.slot - 1]; return { id, ...m, home: t[0], away: t[1] } }).sort((a, b) => a.n - b.n) }
function M(id) { const m = S.matches[id]; if (!m) return null; const t = m.home && m.away ? [m.home, m.away] : PAIRS[m.slot - 1]; return { id, ...m, home: t[0], away: t[1] } }
function evsOf(mid) { return Object.entries(S.events).filter(([, e]) => e.match === mid).map(([id, e]) => ({ id, ...e })).sort((a, b) => a.sec - b.sec || a.at - b.at) }
let SC_REF = null, SC = {}; // 경기별 팀 득점 캐시 (events 스냅샷이 바뀔 때만 다시 계산)
function score(m) { if (SC_REF !== S.events) { SC_REF = S.events; SC = {}; for (const e of Object.values(S.events)) { const t = (SC[e.match] ??= {}); t[e.team] = (t[e.team] || 0) + 1 } } const t = SC[m.id] || {}; return [t[m.home] || 0, t[m.away] || 0] }
function elapsed(m) { const t = m.timer || {}; return (t.acc || 0) + (t.running && t.startedAt ? Math.max(0, (nowS() - t.startedAt) / 1000) : 0) }
function prevMatch(m) { return sessMatches(m.session).filter(x => x.n < m.n).pop() || null }
function clockInfo(m) {
  const T = timing(S.sessions[m.session]); const run = !!m.timer?.running; const e = elapsed(m);
  const a = T.h1, b = a + T.gk, c = b + T.h2; const ps = !run && m.status === 'live' ? ' 일시정지' : '';
  if (m.status === 'done') return { label: '종료', time: fmt(Math.min(e, c)), phase: 'done', e, a, b, c };
  if (m.status === 'pending' && !run && e < .5) {
    const pr = prevMatch(m);
    if (pr && pr.status === 'done' && pr.endedAt) { const restEnd = pr.endedAt + T.rest * 1000; const r = (restEnd - nowS()) / 1000;
      return { label: '시작 대기', time: fmt(a), phase: 'ready', e, a, b, c, restEnd } }
    return { label: '시작 전', time: fmt(a), phase: 'ready', e, a, b, c };
  }
  if (e < a) return { label: '전반' + ps, time: fmt(Math.ceil(a - e)), phase: 'h1', e, a, b, c };
  if (e < b) return { label: 'GK 교체' + ps, time: '00:' + p2(Math.ceil(b - e)), phase: 'gk', e, a, b, c };
  if (e < c) return { label: '후반' + ps, time: fmt(Math.ceil(c - e)), phase: 'h2', e, a, b, c };
  return { label: '경기 시간 종료' + ps, time: '+' + fmt(Math.floor(e - c)), phase: 'full', over: true, e, a, b, c };
}
function table(sid, filter) {
  const rows = {}; KEYS.forEach(k => rows[k] = { k, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
  for (const m of sessMatches(sid)) { if (m.status !== 'done' || (filter && !filter(m))) continue; const [h, a] = score(m); const H = rows[m.home], A = rows[m.away];
    H.p++; A.p++; H.gf += h; H.ga += a; A.gf += a; A.ga += h;
    if (h > a) { H.w++; A.l++; H.pts += 3 } else if (h < a) { A.w++; H.l++; A.pts += 3 } else { H.d++; A.d++; H.pts++; A.pts++ } }
  return rows;
}
function standings(sid) {
  const list = Object.values(table(sid)); const base = (a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf;
  list.sort(base); let i = 0;
  while (i < list.length) { let j = i + 1; while (j < list.length && base(list[i], list[j]) === 0) j++;
    if (j - i > 1) { const grp = list.slice(i, j).map(r => r.k); const mini = table(sid, m => grp.includes(m.home) && grp.includes(m.away));
      list.splice(i, j - i, ...list.slice(i, j).sort((a, b) => mini[b.k].pts - mini[a.k].pts || (mini[b.k].gf - mini[b.k].ga) - (mini[a.k].gf - mini[a.k].ga))) }
    i = j }
  let rank = 0; list.forEach((r, x) => { if (x === 0 || base(list[x - 1], r) !== 0) rank = x + 1; r.rank = rank }); return list;
}
function isComplete(sid) { const ms = sessMatches(sid); return ms.length === 9 && ms.every(m => m.status === 'done') }
let PS_KEY = null, PS_VAL = null;
function playerStats() { const key = [S.sessions, S.matches, S.events, S.players]; if (PS_KEY && PS_KEY.every((x, i) => x === key[i])) return PS_VAL; PS_KEY = key; return (PS_VAL = playerStats0()) }
function playerStats0() {
  const st = {}; const g = id => st[id] || (st[id] = { id, days: 0, gp: 0, w: 0, d: 0, l: 0, g: 0, a: 0, wins: 0, mom: 0, cap: 0 });
  for (const [sid, s] of Object.entries(S.sessions)) {
    const ms = sessMatches(sid); if (!ms.length) continue;
    const champ = isComplete(sid) ? standings(sid).filter(r => r.rank === 1).map(r => r.k) : [];
    for (const k of KEYS) for (const pid of teamPlayers(s, k)) { const r = g(pid); r.days++; if (captainOf(s, k) === pid) r.cap++; if (champ.includes(k)) r.wins++;
      for (const m of ms) { if (m.status !== 'done' || (m.home !== k && m.away !== k)) continue; const [h, a] = score(m); const mine = m.home === k ? h : a, opp = m.home === k ? a : h;
        r.gp++; if (mine > opp) r.w++; else if (mine < opp) r.l++; else r.d++ } }
    for (const pid of Object.values(s.mom || {})) if (pid) g(pid).mom++;
  }
  for (const e of Object.values(S.events)) { if (e.og) continue; if (e.scorer) g(e.scorer).g++; if (e.assist) g(e.assist).a++ }
  return Object.values(st).filter(r => S.players[r.id]);
}

/* ───────── whistle (web audio) ───────── */
let AC = null, MASTER = null;
function audio() { if (AC) return AC; try { const C = window.AudioContext || window.webkitAudioContext; AC = new C(); const comp = AC.createDynamicsCompressor(); comp.threshold.value = -6; comp.knee.value = 4; comp.ratio.value = 20; comp.attack.value = .002; comp.release.value = .08; MASTER = AC.createGain(); MASTER.gain.value = 3.2; MASTER.connect(comp); comp.connect(AC.destination) } catch { AC = null } return AC }
function blow(t, d) { const ctx = AC; const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = 'square'; o2.type = 'sawtooth'; o1.frequency.value = 2900; o2.frequency.value = 2980;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 34; const fm = ctx.createGain(); fm.gain.value = 180; lfo.connect(fm); fm.connect(o1.frequency); fm.connect(o2.frequency);
  const am = ctx.createGain(); am.gain.value = .25; lfo.connect(am);
  const amp = ctx.createGain(); amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(.95, t + .02); amp.gain.setValueAtTime(.95, t + d - .05); amp.gain.linearRampToValueAtTime(0, t + d);
  am.connect(amp.gain); o1.connect(amp); o2.connect(amp); amp.connect(MASTER); [o1, o2, lfo].forEach(o => { o.start(t); o.stop(t + d + .05) }) }
function whistle(pattern) { if (!S.whistle) return; if (!(mmIsCtl() || S.admin)) return; const ctx = audio(); if (!ctx) return; if (ctx.state === 'suspended') ctx.resume(); let t = ctx.currentTime + .03; for (const d of pattern) { blow(t, d); t += d + .14 }
  try { navigator.vibrate && navigator.vibrate(pattern.flatMap((d, i) => i ? [140, Math.round(d * 1000)] : [Math.round(d * 1000)])) } catch { } }
document.addEventListener('pointerdown', () => { const c = audio(); if (c && c.state === 'suspended') c.resume() }, { capture: true });
let wake = null, wakeBusy = false; async function keepAwake(on) { try { if (on && !wake && !wakeBusy && navigator.wakeLock && !document.hidden) { wakeBusy = true; try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null }) } finally { wakeBusy = false } } else if (!on && wake) { const w0 = wake; wake = null; await w0.release() } } catch { } }
function mmHeartbeat() { const s = S.sessions[S.mmSid]; if (!s || document.hidden || !mmCtl(s).mine) return; if (Date.now() - (S.mmBeat || 0) < 20000) return; S.mmBeat = Date.now(); S.store.update(sp(S.mmSid), { 'mmCtl.beat': nowS() }).catch(() => { }) }
function statusWatch() { if (S.inStatusWatch || Date.now() - (S.stAt || 0) < 1000) return; S.stAt = Date.now(); const sig = Object.keys(S.sessions).map(id => id + ':' + sStatus(S.sessions[id]).k).join('|'); const prev = S.stSig; S.stSig = sig; if (prev && sig !== prev && !isTyping()) { S.inStatusWatch = true; try { render() } finally { S.inStatusWatch = false } } }
function awakeCheck() {
  statusWatch();
  mmHeartbeat();
  const want = (S.tab === 'mm' && !document.hidden) || (liveAny() && !!S.openMatch);
  keepAwake(want);
  const KA = CAP()?.KeepAwake; if (KA && want !== S.nativeAwake) { S.nativeAwake = want; try { want ? KA.keepAwake() : KA.allowSleep() } catch { } }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { awakeCheck(); if (Date.now() - (S.skewAt || 0) > 60000) syncClock() } });
window.addEventListener('online', () => { syncClock(); toast('인터넷이 다시 연결됐어요.') });
window.addEventListener('offline', () => toast('인터넷 연결이 끊겼어요. 신청·취소는 연결된 뒤에 해 주세요.'));
function watchPhases() {
  awakeCheck();
  scheduleWhistles(); const sid = S.mmSid || S.sid; if (!sid || !S.sessions[sid]) return; let run = false;
  for (const m of sessMatches(sid)) { const ci = clockInfo(m); const prev = S.prev[m.id]; S.prev[m.id] = ci.phase; if (m.timer?.running) run = true;
    if (prev === undefined || prev === ci.phase) continue; const e = ci.e;
    const sch = !!S.schedSig[m.id]; if ((prev === 'ready' || prev === 'rest') && ci.phase === 'h1' && e < 3) { if (!(S.startBlown[m.id] && Date.now() - S.startBlown[m.id] < 8000)) whistle([.9]) }
    else if (sch) { } // 휘슬 엔진이 경기 시계에 맞춰 울려요
    else if (prev === 'h1' && ci.phase === 'gk' && e - ci.a < 3) whistle([.3, .3]);
    else if (prev === 'gk' && ci.phase === 'h2' && e - ci.b < 3) whistle([.9]);
    else if (prev === 'h2' && ci.phase === 'full' && e - ci.c < 3) whistle([.3, .3, 1.3]); }
}

/* ───────── actions ───────── */
function findPlayer(name) { const n = name.trim(), k = normName(n); const E = Object.entries(S.players); return E.find(([, p]) => p.name === n)?.[0] || (k ? E.find(([, p]) => normName(p.name) === k)?.[0] : null) || null } // 띄어쓰기·(게) 차이도 같은 사람으로 봐요
async function ensurePlayer(raw) {
  const guest = /\(\s*게(스트)?\s*\)/.test(raw); const name = raw.replace(/\(\s*게(스트)?\s*\)/g, '').trim().slice(0, 20); if (!name) return null;
  const ex = findPlayer(name); if (ex) return ex;
  const id = await S.store.add('players', { name, guest, createdAt: Date.now() }); S.players[id] = { name, guest }; return id;
}
async function setStage(st) { const s = cur(); if (stageIdx(st) > stageIdx(s.stage)) await w(() => S.store.update(sp(S.sid), { stage: st })); if (st === 'notice') { S.tab = 'run'; S.step = 'trade'; render(); window.scrollTo(0, 0); return } S.step = st; render(); window.scrollTo(0, 0) }
async function addApplicants(names) {
  const s = cur(); const ids = [], rejected = [];
  for (const nm of names) { const guest = /\(\s*게(스트)?\s*\)/.test(nm); const name = nm.replace(/\(\s*게(스트)?\s*\)/g, '').trim(); if (!name) continue;
    const ex = findPlayer(name); if (ex) { ids.push(ex); continue }
    if (!guest) { rejected.push(name); continue } const id = await ensurePlayer(nm); if (id) ids.push(id) }
  S.rejNames = rejected.length ? rejected : null; if (rejected.length) toast(`회원 명단에 없는 이름이에요: ${rejected.join(', ')}. 오타가 아니라면 아래 "게스트로 추가"를 눌러 주세요.`);
  if (!ids.length) { render(); return }
  if (s.stage === 'apply') { let n = 0; if (await w(() => S.store.txn(sp(S.sid), d => { const apps = appsOf(d); n = 0; for (const id of ids) if (!apps.some(a => a.pid === id)) { apps.push({ k: rand() + rand(), pid: id, uid: 'admin', at: nowS() }); n++ } d.apps = apps; return d })) && !rejected.length) toast(n === ids.length ? `${n}명을 반영했어요.` : n ? `${n}명을 반영했어요. (${ids.length - n}명은 이미 신청돼 있어요)` : '이미 모두 신청돼 있어요.'); render(); return }
  const cur0 = [...(s.applicants || [])]; let n = 0; for (const id of ids) if (!cur0.includes(id)) { cur0.push(id); n++ }
  await w(() => S.store.update(sp(S.sid), { applicants: cur0 }), rejected.length ? null : `${n}명을 추가했어요.`); render();
}
async function sysChat(text) { if (!S.sid) return; try { await S.store.add(sp(S.sid) + '/chat', { name: '', uid: 'sys', text, at: Date.now() }) } catch { } }
async function undoPick(byCap) {
  if (!byCap && !needAdmin()) return; const s = cur(); if (!(s.picks || []).length) return;
  const last = s.picks[s.picks.length - 1];
  if (await w(() => S.store.txn(sp(S.sid), d => { const lp = (d.picks || []).slice(-1)[0]; if (!lp || lp.p !== last.p) return null; d.picks = (d.picks || []).slice(0, -1); d.draftStatus = 'live'; d.pending = null; if (d.stage === 'trade') d.stage = 'draft'; KEYS.forEach(t => { if (d.teams?.[t]) d.teams[t].players = [] }); return d })))
    { if (!byCap) sysChat(`운영진이 ${pname(last.p)} 지명을 되돌렸어요.`) }
}
async function swapPlayers(a, b) {
  const s = cur(); const ta = KEYS.find(k => teamPlayers(s, k).includes(a)), tb = KEYS.find(k => teamPlayers(s, k).includes(b));
  if (!ta || !tb || ta === tb) return;
  const pa = teamPlayers(s, ta).map(x => x === a ? b : x), pb = teamPlayers(s, tb).map(x => x === b ? a : x);
  if (await w(() => S.store.update(sp(S.sid), { [`teams.${ta}.players`]: pa, [`teams.${tb}.players`]: pb }), '선수를 맞바꿨어요.'))
    sysChat(`교환: ${pname(a)}(${team(s, ta).name}) ↔ ${pname(b)}(${team(s, tb).name})`);
}
async function createMatches() {
  const s = cur(); if (sessMatches(S.sid).length) { await setStage('match'); S.tab = 'run'; render(); return }
  const ok = await w(async () => { const jobs = []; let n = 0;
    for (let r = 1; r <= 3; r++) for (let sl = 1; sl <= 3; sl++) { n++; jobs.push(S.store.set('matches/' + S.sid + '_' + n, { session: S.sid, n, round: r, slot: sl, status: 'pending', timer: { running: false, acc: 0, startedAt: 0 }, endedAt: 0 })) }
    await Promise.all(jobs); await S.store.update(sp(S.sid), { stage: 'match' }) }, '9경기 일정을 만들었어요.');
  if (ok) { S.tab = 'run'; S.step = 'match'; render(); window.scrollTo(0, 0) }
}
const mp = id => 'matches/' + id;
async function startClock(m, at) { audio(); await w(() => S.store.update(mp(m.id), { status: 'live', timer: { running: true, startedAt: at || nowS(), acc: m.timer?.acc || 0 } })) } // 시작 휘슬이 울린 순간을 0초로
async function pauseClock(m) { await w(() => S.store.update(mp(m.id), { timer: { running: false, startedAt: 0, acc: Math.floor(elapsed(m)) } })) }
async function resetClock(m) { if (!confirm('타이머를 처음으로 되돌릴까요?')) return; await w(() => S.store.update(mp(m.id), { timer: { running: false, startedAt: 0, acc: 0 } })) }
async function endMatch(m) { await w(() => S.store.update(mp(m.id), { status: 'done', endedAt: nowS(), timer: { running: false, startedAt: 0, acc: Math.floor(elapsed(m)) } }), '경기를 종료했어요.') }
async function addGoal(m, t, scorer, assist, og) { await w(() => S.store.add('events', { session: m.session, match: m.id, team: t, scorer: scorer || null, assist: assist || null, og: !!og, sec: Math.floor(elapsed(m)), half: clockInfo(m).phase, at: Date.now() }), '골을 기록했어요.') }

/* ───────── poster (canvas) ───────── */
let EMBLEM = null; function emblem() { if (EMBLEM) return Promise.resolve(EMBLEM); return new Promise(r => { const i = new Image(); i.onload = () => { EMBLEM = i; r(i) }; i.onerror = () => r(null); i.src = EMBLEM_SRC }) }
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath() }
function fitFont(g, text, font, size, maxW) { let s = size; g.font = font.replace('{s}', s); while (g.measureText(text).width > maxW && s > 10) { s -= 2; g.font = font.replace('{s}', s) } return s }
function crown(g, x, y, s) { g.save(); g.fillStyle = '#FFC61A'; g.strokeStyle = '#8A5A00'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y + s * .78); g.lineTo(x, y + s * .22); g.lineTo(x + s * .27, y + s * .5); g.lineTo(x + s * .5, y); g.lineTo(x + s * .73, y + s * .5); g.lineTo(x + s, y + s * .22); g.lineTo(x + s, y + s * .78); g.closePath(); g.fill(); g.stroke(); g.fillRect(x, y + s * .84, s, s * .16); g.strokeRect(x, y + s * .84, s, s * .16); g.restore() }
function badge(g, img, cx, cy, r) { g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = Math.max(2, r * .08); g.strokeStyle = '#000'; g.stroke(); if (img) { g.clip(); g.drawImage(img, cx - r * .92, cy - r * .92, r * 1.84, r * 1.84) } g.restore() }
/* ───────── poster fonts (full Korean glyph sets) ───────── */
const FONT_FILES = [
  ['PaperlogyH', '100 900', 'https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/Paperlogy-8ExtraBold.woff2'],
  ['Pretendard', '400', 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/woff2/Pretendard-Regular.woff2'],
  ['Pretendard', '600', 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/woff2/Pretendard-SemiBold.woff2'],
  ['Pretendard', '800', 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/woff2/Pretendard-ExtraBold.woff2'],
  ['PretendardH', '100 900', 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/woff2/Pretendard-ExtraBold.woff2'],
  ['PaperlogyK', '100 900', 'https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/Paperlogy-9Black.woff2'],
  ['SCDreamH', '100 900', 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_six@1.2/S-CoreDream-8Heavy.woff', 'woff'],
  ['SCDreamM', '100 900', 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_six@1.2/S-CoreDream-6Bold.woff', 'woff']];
// 포스터 글꼴 (모두 무료 폰트). 'auto'는 디자인마다 어울리는 글꼴을 골라요.
const POSTER_FONTS = [['auto', '디자인 추천', ''], ['paperlogy', '페이퍼로지', '"PaperlogyH"'], ['paperlogyk', '페이퍼로지 블랙', '"PaperlogyK"'], ['scdream', '에스코어드림', '"SCDreamH"'], ['pretendard', '프리텐다드', '"PretendardH"'], ['nanumgothic', '나눔고딕', '"Nanum Gothic"'], ['nanummyeongjo', '나눔명조', '"Nanum Myeongjo"'], ['nanumpen', '나눔손글씨 펜', '"Nanum Pen Script"'], ['nanumbrush', '나눔손글씨 붓', '"Nanum Brush Script"']];
const THEME_FONT = { stadium: 'paperlogy', night: 'scdream', clean: 'pretendard', stripe: 'paperlogyk' };
function posterFontOf(s, th) { const f = s?.posterFont || S.meta?.poster?.font || 'auto'; const k = POSTER_FONTS.some(x => x[0] === f) ? f : 'auto'; return k === 'auto' ? THEME_FONT[th] || 'paperlogy' : k }
function loadNanum() { if (S.nanumCss) return S.nanumCss; S.nanumCss = new Promise(res => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Nanum+Brush+Script&family=Nanum+Gothic:wght@800&family=Nanum+Myeongjo:wght@800&family=Nanum+Pen+Script&display=block'; l.onload = () => res(true); l.onerror = () => res(false); document.head.appendChild(l); setTimeout(() => res(false), 6000) }); return S.nanumCss }
function loadFam(fam) { S.wf ??= {}; if (S.wf[fam]) return S.wf[fam]; // 필요한 글꼴만 그때그때 받아요
  return (S.wf[fam] = Promise.all(FONT_FILES.filter(f => f[0] === fam).map(async ([f0, wt, url, fmt]) => { const f = new FontFace(f0, `url(${url}) format('${fmt || 'woff2'}')`, { weight: wt, display: 'block' }); await Promise.race([f.load(), new Promise((_, rej) => setTimeout(() => rej('timeout'), 8000))]); document.fonts.add(f) })).then(() => true, () => false)) }
async function loadWebFonts(extra) { const fams = ['PaperlogyH', 'Pretendard', ...(extra || [])]; const r = await Promise.all(fams.map(loadFam)); const ok = {}; fams.forEach((f, i) => { if (r[i]) ok[f] = true }); return ok }
async function posterFonts(texts, fontKey) {
  const pick = POSTER_FONTS.find(x => x[0] === fontKey); const fam = pick?.[2]?.replace(/"/g, ''); const ok = await loadWebFonts(fam && FONT_FILES.some(f => f[0] === fam) ? [fam] : []); const fb = '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif'; if (pick && fontKey.startsWith('nanum')) await loadNanum();
  const base = ok.PaperlogyH ? '"PaperlogyH"' : ok.PretendardH ? '"PretendardH"' : '"Black Han Sans"'; const H = pick && pick[2] && (fontKey.startsWith('nanum') || ok[pick[2].replace(/"/g, '')]) ? `${pick[2]},${base}` : base, B = ok.Pretendard ? '"Pretendard"' : '"IBM Plex Sans KR"';
  const all = [...new Set((texts || []).join(' ') + ' 0123456789월화수목금토일요일회차일시장소신청예약자구장비밀번호공지')].join('');
  try { await Promise.all([`900 80px ${H}`, `800 60px ${H}`, `80px ${H}`, `400 40px ${B}`, `700 40px ${B}`, `80px "Anton"`].map(f => document.fonts.load(f, all))) } catch { }
  return { LAT: `"Anton",${H},Impact,sans-serif`, KR: `${H},${fb}`, BD: `${B},${fb}`, H, B };
}
const POSTER_THEMES = [['stadium', '스타디움', '#1B4AA8', '#23692C'], ['night', '나이트', '#05070F', '#FFD21F'], ['clean', '클린', '#F4F6FA', '#0B1E5B'], ['stripe', '팀 컬러', '#D7263D', '#1E46C8']];
function posterTheme(s) { const t = s?.posterTheme || S.meta?.poster?.theme; return POSTER_THEMES.some(x => x[0] === t) ? t : 'stadium' }
function wrapText(g, text, maxW, maxLines) { const out = []; for (const para of String(text || '').split('\n')) { let line = ''; for (const ch of para) { if (g.measureText(line + ch).width > maxW && line) { out.push(line); line = ch } else line += ch } out.push(line) } return out.filter((l, i, a) => l.trim() || (i > 0 && i < a.length - 1)).slice(0, maxLines) }
async function drawPoster(s, theme, font) {
  const th = theme || posterTheme(s); const fk = font || posterFontOf(s, th);
  const W = 1086, H = 1448; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const PF = await posterFonts([s.venue || '', s.notice || '', s.evpw || '', ...KEYS.flatMap(k => teamPlayers(s, k).map(pname)), ...KEYS.map(k => team(s, k).name)], fk);
  const img = await emblem(); const LAT = PF.LAT, KR = PF.KR;
  const light = th === 'clean';
  const T = { stadium: { head: '#fff', stroke: '#0A0F1E', acc: '#FFD600', card: 'solid', bar: 'rgba(8,10,16,.93)', barInk: '#fff', barLine: 'rgba(255,255,255,.9)' },
    night: { head: '#fff', stroke: null, glow: '#FFD21F', acc: '#FFD21F', card: 'band', panel: 'rgba(255,255,255,.06)', name: '#F2F5FF', bar: 'rgba(255,255,255,.06)', barInk: '#fff', barLine: '#FFD21F' },
    clean: { head: '#fff', stroke: null, acc: '#FFD21F', card: 'band', panel: '#FFFFFF', name: '#131C2B', bar: '#0B1E5B', barInk: '#fff', barLine: '#0B1E5B' },
    stripe: { head: '#fff', stroke: '#0A0F1E', acc: '#FFD600', card: 'band', panel: 'rgba(255,255,255,.94)', name: '#131C2B', bar: 'rgba(8,10,16,.92)', barInk: '#fff', barLine: 'rgba(255,255,255,.9)' } }[th];
  if (th === 'stadium') {
  // sky + stadium
  let gr = g.createLinearGradient(0, 0, 0, 560); gr.addColorStop(0, '#081A55'); gr.addColorStop(.7, '#123A96'); gr.addColorStop(1, '#1B4AA8'); g.fillStyle = gr; g.fillRect(0, 0, W, 560);
  for (const [lx, ly] of [[70, 60], [W - 70, 60]]) { const rg = g.createRadialGradient(lx, ly, 4, lx, ly, 260); rg.addColorStop(0, 'rgba(255,255,255,.95)'); rg.addColorStop(.12, 'rgba(190,215,255,.6)'); rg.addColorStop(1, 'rgba(120,160,255,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, 400);
    g.fillStyle = '#fff'; for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { g.beginPath(); g.arc(lx - 24 + i * 24, ly - 12 + j * 26, 8, 0, 7); g.fill() } }
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 1800; i++) { const y = 250 + rnd() * 140; g.fillStyle = `rgba(${150 + rnd() * 100},${170 + rnd() * 80},255,${.08 + rnd() * .25})`; g.fillRect(rnd() * W, y, 2 + rnd() * 3, 2 + rnd() * 3) }
  // pitch
  gr = g.createLinearGradient(0, 380, 0, H); gr.addColorStop(0, '#2E7A35'); gr.addColorStop(.3, '#23692C'); gr.addColorStop(1, '#174F20'); g.fillStyle = gr; g.fillRect(0, 380, W, H - 380);
  for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.05)'; g.fillRect(0, 380 + i * 90, W, 90) }
  for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(${rnd() > .5 ? '120,200,110' : '10,50,15'},${.12 + rnd() * .2})`; g.fillRect(rnd() * W, 380 + rnd() * (H - 380), 2, 3) }
  g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(W / 2 - 3, 440, 6, H - 440);
  const fade = g.createLinearGradient(0, 360, 0, 470); fade.addColorStop(0, 'rgba(20,60,150,.9)'); fade.addColorStop(1, 'rgba(20,60,150,0)'); g.fillStyle = fade; g.fillRect(0, 360, W, 110);
  } else if (th === 'night') {
    const bg = g.createRadialGradient(W / 2, 260, 40, W / 2, 600, 1100); bg.addColorStop(0, '#16245A'); bg.addColorStop(.55, '#0A1030'); bg.addColorStop(1, '#03050C'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1; for (let x = 0; x <= W; x += 54) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke() } for (let y = 0; y <= H; y += 54) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() }
    g.strokeStyle = 'rgba(255,210,31,.18)'; g.lineWidth = 3; g.beginPath(); g.arc(W / 2, 300, 230, 0, Math.PI * 2); g.stroke();
  } else if (th === 'clean') {
    g.fillStyle = '#EEF1F6'; g.fillRect(0, 0, W, H); g.fillStyle = '#0B1E5B'; g.fillRect(0, 0, W, 470);
    g.fillStyle = '#FFD21F'; g.fillRect(0, 466, W, 8);
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 2; g.beginPath(); g.arc(W / 2, 470, 200, Math.PI, 0); g.stroke(); g.beginPath(); g.moveTo(0, 470); g.lineTo(W, 470); g.stroke();
  } else {
    const cols = KEYS.map(k => team(s, k).color); g.fillStyle = '#0A0F1E'; g.fillRect(0, 0, W, H);
    g.save(); g.translate(W / 2, H / 2); g.rotate(-Math.PI / 9); const sw = 260; for (let i = -6; i <= 6; i++) { g.fillStyle = cols[((i % 3) + 3) % 3]; g.fillRect(i * sw - sw / 2, -H, sw, H * 2) } g.restore();
    const ov = g.createLinearGradient(0, 0, 0, H); ov.addColorStop(0, 'rgba(6,10,24,.78)'); ov.addColorStop(.4, 'rgba(6,10,24,.45)'); ov.addColorStop(1, 'rgba(6,10,24,.7)'); g.fillStyle = ov; g.fillRect(0, 0, W, H);
  }
  const outline = (txt, x, y, lw) => { g.save(); if (T.glow) { g.shadowColor = T.glow; g.shadowBlur = 26 } if (T.stroke) { g.lineWidth = lw; g.strokeStyle = T.stroke; g.lineJoin = 'round'; g.strokeText(txt, x, y) } g.fillText(txt, x, y); g.restore() };
  // headline
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = T.head;
  g.font = `44px ${LAT}`; const club = (CFG.club?.name || 'WEEKDAYS FUTSAL CLUB').toUpperCase(); const cw = g.measureText(club).width; g.fillText(club, W / 2, 72);
  g.fillStyle = th === 'night' ? T.acc : T.head; g.fillRect(175, 50, W / 2 - cw / 2 - 195, 4); g.fillRect(W / 2 + cw / 2 + 20, 50, W / 2 - cw / 2 - 195, 4);
  g.fillStyle = T.head; g.font = `172px ${LAT}`; const tW = g.measureText('MATCH DAY').width; g.save(); if (th === 'stadium') { g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowOffsetY = 6; g.shadowBlur = 14 } outline('MATCH DAY', W / 2, 212, 10); g.restore();
  g.fillStyle = th === 'night' ? T.acc : T.head; const sideL = W / 2 - tW / 2 - 20; if (sideL > 60) { g.fillRect(24, 136, sideL - 24, 4); g.fillRect(W - sideL, 136, sideL - 24, 4) }
  g.fillRect(24, 236, W / 2 - 84, 4); g.fillRect(W / 2 + 60, 236, W / 2 - 84, 4);
  badge(g, img, W / 2, 238, 48);
  // date line
  const [, mm, dd] = s.date.split('-'); const parts = [[`${mm}.${dd}. `, T.head], [dow(s.date) + '요일', T.acc], [`  ${s.time || ''}`, T.head]];
  g.font = `96px ${KR}`; const tw = parts.reduce((a, [t]) => a + g.measureText(t).width, 0); let x = W / 2 - tw / 2; g.textAlign = 'left';
  for (const [t, col] of parts) { g.fillStyle = col; outline(t, x, 362, 12); x += g.measureText(t).width }
  g.textAlign = 'center'; fitFont(g, s.venue || '', `{s}px ${KR}`, 72, W - 120); g.fillStyle = T.head; outline(s.venue || '', W / 2, 448, 11);
  // team cards
  const top = th === 'clean' ? 492 : 472, bot = 1186, gap = 14, cwid = (W - 48 - gap * 2) / 3; const lists = KEYS.map(k => teamPlayers(s, k)); const rows = Math.max(6, ...lists.map(l => l.length));
  KEYS.forEach((k, i) => { const t = team(s, k); const x0 = 24 + i * (cwid + gap); const ink = inkOn(t.color);
    if (T.card === 'solid') {
      g.save(); rr(g, x0, top, cwid, bot - top, 16); g.fillStyle = t.color; g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 16; g.fill(); g.restore();
      g.save(); rr(g, x0, top, cwid, bot - top, 16); g.lineWidth = 4; g.strokeStyle = ink === '#FFFFFF' ? (i === 0 ? '#4FB2FF' : 'rgba(255,255,255,.85)') : 'rgba(0,0,0,.55)'; g.stroke(); g.restore();
    } else {
      g.save(); rr(g, x0, top, cwid, bot - top, 18); g.fillStyle = T.panel; g.shadowColor = light ? 'rgba(11,30,91,.16)' : 'rgba(0,0,0,.4)'; g.shadowBlur = light ? 22 : 16; g.shadowOffsetY = light ? 6 : 0; g.fill(); g.restore();
      g.save(); rr(g, x0, top, cwid, bot - top, 18); g.clip(); g.fillStyle = t.color; g.fillRect(x0, top, cwid, 150); g.restore();
      if (th === 'night') { g.save(); rr(g, x0, top, cwid, bot - top, 18); g.lineWidth = 3; g.strokeStyle = t.color; g.shadowColor = t.color; g.shadowBlur = 18; g.stroke(); g.restore() }
      if (light) { g.save(); rr(g, x0, top, cwid, bot - top, 18); g.lineWidth = 2; g.strokeStyle = '#D6DCE4'; g.stroke(); g.restore() }
    }
    badge(g, img, x0 + 68, top + 76, 50);
    g.fillStyle = ink; g.textAlign = 'left'; fitFont(g, t.name, `{s}px ${LAT}`, 66, cwid - 138); g.fillText(t.name, x0 + 128, top + 100);
    if (T.card === 'solid') g.fillRect(x0 + 24, top + 144, cwid - 48, 4);
    const nameCol = T.card === 'solid' ? ink : T.name; g.fillStyle = nameCol;
    const avail = bot - top - 190, step = Math.min(84, avail / rows), fs = Math.min(50, step * .66); g.textAlign = 'center';
    lists[i].forEach((pid, j) => { const nm = pname(pid); const y = top + 190 + step * j + step * .62; const f = fitFont(g, nm, `{s}px ${KR}`, fs, cwid - 70); g.fillText(nm, x0 + cwid / 2 - (j === 0 ? 18 : 0), y);
      if (j === 0 && captainOf(s, k) === pid) { const nw = g.measureText(nm).width; crown(g, x0 + cwid / 2 - 18 + nw / 2 + 10, y - f * .78, f * .8) }
      if (T.card !== 'solid' && j < lists[i].length - 1) { g.fillStyle = light ? '#EEF1F6' : 'rgba(127,140,170,.18)'; g.fillRect(x0 + 30, top + 190 + step * (j + 1), cwid - 60, 2); g.fillStyle = nameCol } });
  });
  // info bar
  const by = 1212, bh = 176; g.save(); rr(g, 24, by, W - 48, bh, 16); g.fillStyle = T.bar; g.fill(); g.lineWidth = 3; g.strokeStyle = T.barLine; g.stroke(); g.restore();
  g.fillStyle = th === 'night' ? 'rgba(255,210,31,.5)' : 'rgba(255,255,255,.85)'; g.fillRect(24, by + 70 - 1.5, W - 48, 3);
  const r1 = by + 35, r2 = by + 70 + 53; g.textBaseline = 'middle';
  g.fillStyle = T.barInk; rr(g, 70, r1 - 12, 44, 36, 6); g.fill(); g.lineWidth = 7; g.strokeStyle = T.barInk; g.beginPath(); g.arc(92, r1 - 14, 14, Math.PI, 0); g.stroke(); g.fillStyle = T.bar.startsWith('#') ? T.bar : '#111'; g.fillRect(89, r1 - 2, 6, 14);
  g.textAlign = 'left'; g.fillStyle = T.barInk; g.font = `36px ${LAT}`; g.fillText('E/V Password', 144, r1 + 2); const d1 = 144 + g.measureText('E/V Password').width + 26; g.fillRect(d1, r1 - 22, 3, 44);
  g.fillStyle = T.acc; fitFont(g, s.evpw || '-', `{s}px ${LAT}`, 60, W - 48 - d1 - 40); g.fillText(s.evpw || '-', d1 + 34, r1 + 4);
  g.fillStyle = T.barInk; g.beginPath(); g.moveTo(70, r2 - 10); g.lineTo(88, r2 - 10); g.lineTo(114, r2 - 26); g.lineTo(114, r2 + 24); g.lineTo(88, r2 + 8); g.lineTo(70, r2 + 8); g.closePath(); g.fill(); g.fillRect(78, r2 + 8, 8, 16);
  g.font = `36px ${LAT}`; g.fillText('NOTICE', 144, r2 + 2); const d2 = 144 + g.measureText('NOTICE').width + 26; g.fillRect(d2, r2 - 40, 3, 80);
  // notice: up to 3 lines, { } = highlight
  const nW = W - 48 - d2 - 44; const raw = s.notice || ''; const plain = raw.replace(/[{}]/g, '');
  let nf = 36, lines; for (; nf >= 22; nf -= 2) { g.font = `${nf}px ${KR}`; lines = wrapText(g, plain, nW, 9); if (lines.length * nf * 1.25 <= 96 && lines.length <= 3) break } lines = (lines || []).slice(0, 3);
  const hl = []; let on = false; for (const ch of raw) { if (ch === '{') { on = true; continue } if (ch === '}') { on = false; continue } hl.push(on) }
  let ci0 = 0; const lh = nf * 1.25, y0 = r2 + 2 - (lines.length - 1) * lh / 2; g.font = `${nf}px ${KR}`;
  lines.forEach((ln, li) => { let nx = d2 + 24; const idx = plain.indexOf(ln, ci0); const base = idx >= 0 ? idx : ci0; for (let q = 0; q < ln.length; q++) { g.fillStyle = hl[base + q] ? T.acc : T.barInk; g.fillText(ln[q], nx, y0 + li * lh); nx += g.measureText(ln[q]).width } ci0 = base + ln.length });
  g.textBaseline = 'alphabetic';
  return c;
}
/* ───────── 포스터 시안 엔진: 레이아웃 × 팔레트 × 글꼴 조합으로 서로 다른 시안을 만들어요 ───────── */
const PAL = {
  navy: { n: '네이비', bg: '#0B1E5B', bg2: '#16348F', ink: '#FFFFFF', sub: '#AFC2FF', acc: '#FFD21F', card: '#FFFFFF', cardInk: '#0B1E5B', dark: true },
  pitch: { n: '피치', bg: '#123F22', bg2: '#1F6B38', ink: '#FFFFFF', sub: '#B8E6C4', acc: '#FDE047', card: '#F6FFF8', cardInk: '#123F22', dark: true },
  ink: { n: '잉크', bg: '#111114', bg2: '#26262E', ink: '#F4F4F6', sub: '#9A9AA6', acc: '#FF5A36', card: '#1C1C22', cardInk: '#F4F4F6', dark: true },
  snow: { n: '스노우', bg: '#F5F7FB', bg2: '#E3E8F2', ink: '#0B1E5B', sub: '#5D6B8A', acc: '#E11D48', card: '#FFFFFF', cardInk: '#0B1E5B', dark: false },
  sunset: { n: '선셋', bg: '#3A0D4A', bg2: '#E2562F', ink: '#FFFFFF', sub: '#FFD9C2', acc: '#FFC93C', card: '#FFF6EE', cardInk: '#3A0D4A', dark: true },
  mint: { n: '민트', bg: '#E4F5EE', bg2: '#BFE8D6', ink: '#063B2A', sub: '#3E7563', acc: '#0E7CC9', card: '#FFFFFF', cardInk: '#063B2A', dark: false },
  retro: { n: '레트로', bg: '#F1E2C4', bg2: '#E3C893', ink: '#2B1B0E', sub: '#7A5C3A', acc: '#C8202F', card: '#FFF8EA', cardInk: '#2B1B0E', dark: false },
  electric: { n: '일렉트릭', bg: '#08081F', bg2: '#2626D9', ink: '#FFFFFF', sub: '#A9B4FF', acc: '#00E5FF', card: '#12123A', cardInk: '#FFFFFF', dark: true }
};
const TEAM_LAYS = { stadium: '클래식', magazine: '매거진', ticket: '티켓', split: '스플릿', board: '전광판', swiss: '타이포' };
const SCHED_LAYS = { classic: '클래식', calendar: '달력', list: '리스트', board: '전광판', swiss: '타이포' };
const LAY_FONT = { magazine: 'scdream', ticket: 'paperlogyk', split: 'paperlogy', board: 'pretendard', swiss: 'pretendard', calendar: 'paperlogy', list: 'scdream', stadium: 'paperlogy', classic: 'pretendard' };
const DESIGN_PRESETS = {
  team: [{ lay: 'stadium', pal: 'navy', font: 'auto', seed: 1 }, { lay: 'magazine', pal: 'snow', font: 'auto', seed: 2 }, { lay: 'ticket', pal: 'retro', font: 'auto', seed: 3 }, { lay: 'split', pal: 'ink', font: 'auto', seed: 4 }, { lay: 'board', pal: 'electric', font: 'auto', seed: 5 }, { lay: 'swiss', pal: 'mint', font: 'auto', seed: 6 }],
  sched: [{ lay: 'classic', pal: 'pitch', font: 'auto', seed: 1 }, { lay: 'calendar', pal: 'navy', font: 'auto', seed: 2 }, { lay: 'list', pal: 'retro', font: 'auto', seed: 3 }, { lay: 'board', pal: 'ink', font: 'auto', seed: 4 }, { lay: 'swiss', pal: 'snow', font: 'auto', seed: 5 }]
};
const dKey = d => `${d.lay}.${d.pal}.${d.font}.${d.seed}`;
function dName(kind, d) { return `${(kind === 'team' ? TEAM_LAYS : SCHED_LAYS)[d.lay] || d.lay} · ${PAL[d.pal]?.n || ''}` }
function newDesigns(kind, n) { const lays = Object.keys(kind === 'team' ? TEAM_LAYS : SCHED_LAYS).filter(l => l !== 'stadium' && l !== 'classic'), pals = Object.keys(PAL), fonts = POSTER_FONTS.map(x => x[0]).filter(k => k !== 'auto'); const out = [], seen = new Set();
  while (out.length < n) { const seed = 1 + Math.floor(Math.random() * 99999); const lay = lays[Math.floor(Math.random() * lays.length)]; const d = { lay, pal: pals[Math.floor(Math.random() * pals.length)], font: fonts[Math.floor(Math.random() * fonts.length)], seed }; const k = d.lay + d.pal; if (seen.has(k) && seen.size < lays.length * pals.length) continue; seen.add(k); out.push(d) } return out }
function legacyTeam(t) { return t === 'night' ? { lay: 'board', pal: 'ink', font: 'auto', seed: 5 } : t === 'clean' ? { lay: 'swiss', pal: 'snow', font: 'auto', seed: 6 } : t === 'stripe' ? { lay: 'split', pal: 'ink', font: 'auto', seed: 4 } : null }
function teamDesign(s) { const d = s?.posterDesign || legacyTeam(s?.posterTheme) || S.meta?.poster?.design; return d && TEAM_LAYS[d.lay] && PAL[d.pal] ? d : DESIGN_PRESETS.team[0] }
function schedDesign() { const d = S.meta?.sched?.design; return d && SCHED_LAYS[d.lay] && PAL[d.pal] ? d : DESIGN_PRESETS.sched[0] }
const fontOf = d => (d.font && d.font !== 'auto' && POSTER_FONTS.some(x => x[0] === d.font)) ? d.font : (LAY_FONT[d.lay] || 'paperlogy');
function seeded(seed) { let x = (seed || 1) % 2147483647; return () => (x = (x * 16807) % 2147483647) / 2147483647 }
function teamData(s) { return KEYS.map(k => { const t = team(s, k); return { k, name: t.name, color: t.color, ink: inkOn(t.color), list: teamPlayers(s, k), cap: captainOf(s, k) } }) }
function bgFill(g, P, W, H, rnd, mode) { const gr = g.createLinearGradient(0, 0, mode === 'diag' ? W : 0, H); gr.addColorStop(0, P.bg); gr.addColorStop(1, mode === 'flat' ? P.bg : mix(P.bg, P.bg2, .55)); g.fillStyle = gr; g.fillRect(0, 0, W, H) }
function mix(a, b, t) { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('') }
function alpha(h, a) { const p = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); return `rgba(${p.join(',')},${a})` }
function namesGrid(g, list, cap, x, y, w, h, cols, font, ink, maxFs, top) { const rows = Math.max(1, Math.ceil(list.length / cols)); const cw = w / cols, rh = Math.min(h / rows, maxFs * 1.7); const fs0 = Math.min(maxFs, rh * .62);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = ink;
  list.forEach((pid, i) => { const r = Math.floor(i / cols), c = i % cols; const cx = x + cw * c + cw / 2, cy = y + rh * r + rh / 2 + (top ? 0 : (h - rh * rows) / 2); const nm = pname(pid); const f = fitFont(g, nm, font, fs0, cw - (pid === cap ? 46 : 14)); g.fillText(nm, cx - (pid === cap ? 16 : 0), cy);
    if (pid === cap) { const nw = g.measureText(nm).width; crown(g, cx - 16 + nw / 2 + 8, cy - f * .55, f * .74) } });
  g.textBaseline = 'alphabetic' }
function infoBlock(g, s, PF, x, y, w, h, o) { // E/V 비밀번호 + 공지(최대 3줄, { } 강조)
  g.save(); if (o.fill) { rr(g, x, y, w, h, o.r ?? 16); g.fillStyle = o.fill; g.fill() } if (o.line) { rr(g, x, y, w, h, o.r ?? 16); g.lineWidth = 3; g.strokeStyle = o.line; if (o.dash) g.setLineDash([12, 9]); g.stroke(); g.setLineDash([]) } g.restore();
  const half = Math.round(h * .4); g.fillStyle = o.sep || alpha(o.ink.startsWith('#') ? o.ink : '#FFFFFF', .35); g.fillRect(x + 20, y + half - 1, w - 40, 2);
  g.textBaseline = 'middle'; g.textAlign = 'left'; const r1 = y + half / 2, r2 = y + half + (h - half) / 2;
  g.fillStyle = o.ink; g.font = `30px ${PF.LAT}`; const l1 = o.labels?.[0] || 'E/V PASSWORD'; g.fillText(l1, x + 34, r1 + 2); const d1 = x + 34 + g.measureText(l1).width + 26;
  g.fillStyle = o.acc; fitFont(g, s.evpw || '-', `{s}px ${PF.LAT}`, 58, x + w - d1 - 30); g.fillText(s.evpw || '-', d1, r1 + 4);
  g.fillStyle = o.ink; g.font = `30px ${PF.LAT}`; const l2 = o.labels?.[1] || 'NOTICE'; g.fillText(l2, x + 34, r2 + 2); const d2 = x + 34 + Math.max(g.measureText(l2).width, g.measureText(l1).width * 0) + 26;
  const nW = x + w - d2 - 30, raw = s.notice || '', plain = raw.replace(/[{}]/g, ''); let nf = 34, lines = []; const avail = h - half - 20;
  for (; nf >= 20; nf -= 2) { g.font = `${nf}px ${PF.KR}`; lines = wrapText(g, plain, nW, 9); if (lines.length <= 3 && lines.length * nf * 1.25 <= avail) break } lines = lines.slice(0, 3);
  const hl = []; let on = false; for (const ch of raw) { if (ch === '{') { on = true; continue } if (ch === '}') { on = false; continue } hl.push(on) }
  let ci0 = 0; const lh = nf * 1.25, y0 = r2 + 2 - (lines.length - 1) * lh / 2; g.font = `${nf}px ${PF.KR}`;
  if (!plain.trim()) { g.fillStyle = alpha(o.ink.startsWith('#') ? o.ink : '#FFFFFF', .45); g.fillText('-', d2, r2 + 2) }
  lines.forEach((ln, li) => { let nx = d2; const idx = plain.indexOf(ln, ci0); const base = idx >= 0 ? idx : ci0; for (let q = 0; q < ln.length; q++) { g.fillStyle = hl[base + q] ? o.acc : o.ink; g.fillText(ln[q], nx, y0 + li * lh); nx += g.measureText(ln[q]).width } ci0 = base + ln.length });
  g.textBaseline = 'alphabetic' }
async function drawTeam(s, d) {
  d = d || teamDesign(s); const fk = fontOf(d);
  if (d.lay === 'stadium') return drawPoster(s, 'stadium', fk);
  const W = 1086, H = 1448, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); const P = PAL[d.pal] || PAL.navy; const rnd = seeded(d.seed);
  const PF = await posterFonts([s.venue || '', s.notice || '', s.evpw || '', ...KEYS.flatMap(k => teamPlayers(s, k).map(pname))], fk); const img = await emblem(); const LAT = PF.LAT, KR = PF.KR;
  const T = teamData(s); const [, mm, dd] = s.date.split('-'); const club = (CFG.club?.name || 'WEEKDAYS FUTSAL CLUB').toUpperCase(); const wd = dow(s.date) + '요일', tm = s.time || '';
  if (d.lay === 'magazine') {
    bgFill(g, P, W, H, rnd, 'flat'); const ang = rnd() * .5 - .25;
    g.save(); g.globalAlpha = P.dark ? .07 : .06; g.fillStyle = P.ink; g.font = `620px ${LAT}`; g.textAlign = 'right'; g.translate(W + 40, 760); g.rotate(ang); g.fillText(dd, 0, 0); g.restore();
    g.fillStyle = P.ink; g.textAlign = 'left'; g.font = `34px ${LAT}`; g.fillText(club, 56, 92); g.textAlign = 'right'; g.fillStyle = P.acc; g.fillText(`${s.no ? s.no + 'TH · ' : ''}MATCH DAY`, W - 56, 92);
    g.fillStyle = P.ink; g.fillRect(56, 116, W - 112, 4);
    g.textAlign = 'left'; const dt = `${mm}.${dd}`; fitFont(g, dt, `{s}px ${LAT}`, 320, 700); const dw = g.measureText(dt).width; g.fillText(dt, 46, 420);
    const rx = 46 + dw + 34; g.fillStyle = P.acc; fitFont(g, wd, `{s}px ${KR}`, 70, W - 56 - rx); g.fillText(wd, rx, 250); g.fillStyle = P.ink; fitFont(g, tm, `{s}px ${LAT}`, 120, W - 56 - rx); g.fillText(tm, rx, 400);
    g.fillStyle = P.sub; fitFont(g, s.venue || '', `{s}px ${KR}`, 50, W - 112); g.fillText(s.venue || '', 56, 500); g.fillStyle = P.ink; g.fillRect(56, 534, W - 112, 2);
    const top = 566, bh = 196, gap = 14;
    T.forEach((t, i) => { const y = top + i * (bh + gap); g.save(); rr(g, 56, y, W - 112, bh, 18); g.fillStyle = P.card; g.shadowColor = 'rgba(0,0,0,.18)'; g.shadowBlur = 18; g.fill(); g.restore();
      g.save(); rr(g, 56, y, W - 112, bh, 18); g.clip(); g.fillStyle = t.color; g.fillRect(56, y, 250, bh); g.restore();
      badge(g, img, 56 + 125, y + 66, 38); g.fillStyle = t.ink; g.textAlign = 'center'; fitFont(g, t.name, `{s}px ${LAT}`, 54, 220); g.fillText(t.name, 56 + 125, y + 160);
      namesGrid(g, t.list, t.cap, 330, y + 14, W - 112 - 290, bh - 28, 3, `{s}px ${KR}`, P.cardInk, 46) });
    infoBlock(g, s, PF, 56, 1212, W - 112, 196, { fill: P.ink, ink: P.bg, acc: P.acc, sep: alpha(P.bg, .3) });
  } else if (d.lay === 'ticket') {
    bgFill(g, P, W, H, rnd, 'diag'); g.save(); g.globalAlpha = .08; g.strokeStyle = P.ink; g.lineWidth = 14; const a = (rnd() > .5 ? 1 : -1) * (Math.PI / 5); g.translate(W / 2, H / 2); g.rotate(a); for (let i = -14; i <= 14; i++) { g.beginPath(); g.moveTo(i * 60, -H); g.lineTo(i * 60, H); g.stroke() } g.restore();
    const tk = (x, y, w, h, notchX, fill) => { g.save(); g.beginPath(); const r = 22, n = 22; g.moveTo(x + r, y); g.lineTo(notchX - n, y); g.arc(notchX, y, n, Math.PI, 0, true); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r); g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r); g.lineTo(notchX + n, y + h); g.arc(notchX, y + h, n, 0, Math.PI, true); g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r); g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath(); g.fillStyle = fill; g.shadowColor = 'rgba(0,0,0,.28)'; g.shadowBlur = 20; g.shadowOffsetY = 6; g.fill(); g.restore() };
    tk(40, 40, W - 80, 430, W - 300, P.card); g.save(); g.setLineDash([10, 10]); g.strokeStyle = alpha(P.cardInk, .35); g.lineWidth = 3; g.beginPath(); g.moveTo(W - 300, 70); g.lineTo(W - 300, 440); g.stroke(); g.restore();
    g.fillStyle = P.cardInk; g.textAlign = 'left'; g.font = `30px ${LAT}`; g.fillText(club, 80, 100); g.fillStyle = P.acc; fitFont(g, 'MATCH DAY', `{s}px ${LAT}`, 150, W - 420); g.fillText('MATCH DAY', 74, 250);
    g.fillStyle = P.cardInk; fitFont(g, `${mm}.${dd} ${wd}`, `{s}px ${KR}`, 64, W - 420); g.fillText(`${mm}.${dd} ${wd}`, 80, 340); fitFont(g, s.venue || '', `{s}px ${KR}`, 40, W - 420); g.fillStyle = alpha(P.cardInk, .75); g.fillText(s.venue || '', 80, 410);
    g.textAlign = 'center'; g.fillStyle = P.cardInk; g.font = `28px ${LAT}`; g.fillText('KICK OFF', W - 170, 150); fitFont(g, tm, `{s}px ${LAT}`, 96, 220); g.fillText(tm, W - 170, 260); badge(g, img, W - 170, 360, 46);
    T.forEach((t, i) => { const y = 500 + i * 236, h = 220, nx = 270; tk(40, y, W - 80, h, nx, P.card); g.save(); g.beginPath(); rr(g, 40, y, nx - 40 - 22, h, 22); g.clip(); g.fillStyle = t.color; g.fillRect(40, y, nx - 40, h); g.restore();
      g.fillStyle = t.ink; g.textAlign = 'center'; fitFont(g, t.name, `{s}px ${LAT}`, 56, 190); g.fillText(t.name, 145, y + 92); for (let b = 0; b < 26; b++) { const bw = 2 + Math.floor(rnd() * 4); g.fillStyle = alpha(t.ink === '#FFFFFF' ? '#FFFFFF' : '#000000', .65); g.fillRect(60 + b * 7, y + 130, bw, 56) }
      g.save(); g.setLineDash([9, 9]); g.strokeStyle = alpha(P.cardInk, .35); g.lineWidth = 3; g.beginPath(); g.moveTo(nx, y + 26); g.lineTo(nx, y + h - 26); g.stroke(); g.restore();
      namesGrid(g, t.list, t.cap, nx + 20, y + 12, W - 80 - nx - 40, h - 24, 3, `{s}px ${KR}`, P.cardInk, 44) });
    infoBlock(g, s, PF, 40, 1216, W - 80, 192, { fill: P.dark ? alpha('#000000', .55) : P.cardInk, ink: P.dark ? P.ink : P.card, acc: P.acc, dash: true, line: P.acc });
  } else if (d.lay === 'split') {
    const cw = W / 3; T.forEach((t, i) => { g.fillStyle = t.color; g.fillRect(i * cw, 0, cw + 1, H) }); const sh = g.createLinearGradient(0, 0, 0, H); sh.addColorStop(0, 'rgba(0,0,0,.25)'); sh.addColorStop(.45, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.3)'); g.fillStyle = sh; g.fillRect(0, 0, W, H);
    g.save(); g.globalAlpha = .12; T.forEach((t, i) => { g.fillStyle = t.ink; g.font = `300px ${LAT}`; g.textAlign = 'center'; g.save(); g.translate(i * cw + cw / 2, 1020); g.rotate(-Math.PI / 2); fitFont(g, t.name, `{s}px ${LAT}`, 300, 560); g.fillText(t.name, 0, 90); g.restore() }); g.restore();
    g.save(); rr(g, 40, 40, W - 80, 470, 26); g.fillStyle = P.bg; g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 30; g.fill(); g.restore();
    g.textAlign = 'center'; g.fillStyle = P.sub; g.font = `32px ${LAT}`; g.fillText(club, W / 2, 104); g.fillStyle = P.ink; fitFont(g, 'MATCH DAY', `{s}px ${LAT}`, 168, W - 160); g.fillText('MATCH DAY', W / 2, 270);
    g.fillStyle = P.acc; g.fillRect(W / 2 - 60, 296, 120, 6); g.fillStyle = P.ink; fitFont(g, `${mm}.${dd} ${wd} ${tm}`, `{s}px ${KR}`, 70, W - 160); g.fillText(`${mm}.${dd} ${wd} ${tm}`, W / 2, 390); g.fillStyle = P.sub; fitFont(g, s.venue || '', `{s}px ${KR}`, 44, W - 160); g.fillText(s.venue || '', W / 2, 462);
    T.forEach((t, i) => { const cx = i * cw + cw / 2; badge(g, img, cx, 590, 44); g.fillStyle = t.ink; g.textAlign = 'center'; fitFont(g, t.name, `{s}px ${LAT}`, 62, cw - 40); g.fillText(t.name, cx, 690); g.fillRect(cx - 40, 712, 80, 4);
      namesGrid(g, t.list, t.cap, i * cw + 10, 736, cw - 20, 440, 1, `{s}px ${KR}`, t.ink, 50, true) });
    infoBlock(g, s, PF, 40, 1210, W - 80, 198, { fill: P.bg, ink: P.ink, acc: P.acc, r: 26 });
  } else if (d.lay === 'board') {
    g.fillStyle = mix(P.bg, '#000000', P.dark ? .35 : .85); g.fillRect(0, 0, W, H); g.fillStyle = alpha(P.acc, .07); for (let y = 8; y < H; y += 16) for (let x = 8; x < W; x += 16) g.fillRect(x, y, 4, 4);
    g.save(); rr(g, 22, 22, W - 44, H - 44, 22); g.lineWidth = 6; g.strokeStyle = P.acc; g.shadowColor = P.acc; g.shadowBlur = 22; g.stroke(); g.restore();
    const glow = (txt, x, y, col, blur) => { g.save(); g.shadowColor = col; g.shadowBlur = blur; g.fillStyle = col; g.fillText(txt, x, y); g.restore() };
    g.textAlign = 'center'; g.font = `30px ${LAT}`; glow(club, W / 2, 96, alpha('#FFFFFF', .8), 0); fitFont(g, 'MATCH DAY', `{s}px ${LAT}`, 170, W - 140); glow('MATCH DAY', W / 2, 262, P.acc, 30);
    g.save(); rr(g, 120, 300, W - 240, 120, 16); g.fillStyle = 'rgba(0,0,0,.55)'; g.fill(); g.lineWidth = 3; g.strokeStyle = alpha(P.acc, .6); g.stroke(); g.restore();
    fitFont(g, `${mm}.${dd}  ${wd}  ${tm}`, `{s}px ${KR}`, 66, W - 300); glow(`${mm}.${dd}  ${wd}  ${tm}`, W / 2, 384, '#FFFFFF', 12); g.fillStyle = alpha('#FFFFFF', .7); fitFont(g, s.venue || '', `{s}px ${KR}`, 42, W - 160); g.fillText(s.venue || '', W / 2, 486);
    T.forEach((t, i) => { const y = 530 + i * 222; g.save(); rr(g, 60, y, W - 120, 200, 16); g.fillStyle = 'rgba(255,255,255,.04)'; g.fill(); g.lineWidth = 2; g.strokeStyle = alpha(t.color, .9); g.shadowColor = t.color; g.shadowBlur = 14; g.stroke(); g.restore();
      g.fillStyle = t.color; g.fillRect(60, y + 22, 14, 156); g.textAlign = 'left'; g.font = `58px ${LAT}`; fitFont(g, t.name, `{s}px ${LAT}`, 58, 230); glow(t.name, 100, y + 120, '#FFFFFF', 8);
      namesGrid(g, t.list, t.cap, 340, y + 10, W - 120 - 300, 180, 3, `{s}px ${KR}`, alpha('#FFFFFF', .92), 42) });
    infoBlock(g, s, PF, 60, 1210, W - 120, 196, { fill: 'rgba(0,0,0,.55)', ink: '#FFFFFF', acc: P.acc, line: alpha(P.acc, .7) });
  } else { // swiss
    g.fillStyle = P.bg; g.fillRect(0, 0, W, H); const sw = 176; g.fillStyle = P.dark ? P.bg2 : P.ink; g.fillRect(0, 0, sw, H);
    g.save(); g.translate(sw / 2 + 52, H - 60); g.rotate(-Math.PI / 2); g.fillStyle = P.acc; g.textAlign = 'left'; fitFont(g, 'MATCH DAY', `{s}px ${LAT}`, 200, H - 140); g.fillText('MATCH DAY', 0, 0); g.restore();
    badge(g, img, sw / 2, 96, 52); const x0 = sw + 48, xw = W - x0 - 48;
    g.fillStyle = P.sub; g.textAlign = 'left'; g.font = `30px ${LAT}`; g.fillText(club, x0, 92); g.fillStyle = P.ink; g.fillRect(x0, 112, xw, 3);
    fitFont(g, `${mm}.${dd}`, `{s}px ${LAT}`, 250, xw); g.fillText(`${mm}.${dd}`, x0 - 6, 350); g.fillStyle = P.acc; fitFont(g, `${wd}  ${tm}`, `{s}px ${KR}`, 66, xw); g.fillText(`${wd}  ${tm}`, x0, 440);
    g.fillStyle = P.sub; fitFont(g, s.venue || '', `{s}px ${KR}`, 42, xw); g.fillText(s.venue || '', x0, 506); g.fillStyle = P.ink; g.fillRect(x0, 540, xw, 2);
    const cwid = xw / 3; T.forEach((t, i) => { const cx = x0 + i * cwid; g.fillStyle = t.color; g.fillRect(cx, 572, 40, 40); g.fillStyle = P.ink; g.textAlign = 'left'; fitFont(g, t.name, `{s}px ${LAT}`, 46, cwid - 64); g.fillText(t.name, cx + 54, 608);
      g.fillStyle = alpha(P.ink, .25); g.fillRect(cx, 634, cwid - 22, 2); g.save(); namesGrid(g, t.list, t.cap, cx - 4, 650, cwid - 18, 520, 1, `{s}px ${KR}`, P.ink, 44, true); g.restore() });
    infoBlock(g, s, PF, x0, 1212, xw, 196, { line: P.ink, ink: P.ink, acc: P.acc, r: 0, sep: alpha(P.ink, .25) });
  }
  return c;
}
async function drawSched(ym, d) {
  d = d || schedDesign(); const fk = fontOf(d); if (d.lay === 'classic') return drawSchedule(ym, fk);
  const ss = Object.keys(S.sessions).filter(id => id.startsWith(ym)).sort().map(id => S.sessions[id]); const cf = schedCfg(); const foot = cf.footer.split('\n').slice(0, 8).filter((l, i, a) => l.trim() || i < a.length - 1);
  const PF = await posterFonts([cf.footer, cf.tag, ...ss.map(x => (x.venue || '') + idsToNames(x.p0))], fk); const img = await emblem(); const LAT = PF.LAT, KR = PF.KR; const P = PAL[d.pal] || PAL.navy; const rnd = seeded(d.seed);
  const [y, m] = ym.split('-'); const W = 1080; const openH = [...new Set(ss.map(s => (s.applyOpen || '').slice(11, 13)).filter(Boolean))]; const fixedH = openH.length === 1 ? +openH[0] : null;
  const vshort = v => { const t = String(v || '').split(/\s+/); return t.length > 3 ? t.slice(-3).join(' ') : (v || '') };
  const openTxt = s => s.applyOpen ? md(s.applyOpen.slice(0, 10)) + (fixedH == null ? ' ' + s.applyOpen.slice(11, 16) : '') : '-'; const hr = s => `${+String(s.time || '00').slice(0, 2)}시`;
  let H; const footH = foot.length * 48 + 60;
  if (d.lay === 'calendar') { const first = new Date(+y, +m - 1, 1).getDay(), days = new Date(+y, +m, 0).getDate(); const rows = Math.ceil((first + days) / 7); H = 470 + 60 + rows * 158 + 40 + footH; }
  else if (d.lay === 'list') H = 480 + Math.max(4, ss.length) * 150 + 30 + footH;
  else H = 520 + 90 + Math.max(6, ss.length) * 84 + 40 + footH;
  H = Math.max(1350, H); const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const head = (ty, light) => { g.textAlign = 'left'; g.fillStyle = P.sub; g.font = `30px ${PF.BD}`; g.fillText(cf.tag, 56, 70); badge(g, img, W - 104, 112, 58);
    g.fillStyle = P.acc; g.font = `150px ${LAT}`; g.fillText(`${y}.${m}`, 50, ty); g.fillStyle = P.ink; fitFont(g, 'MATCH SCHEDULE', `{s}px ${LAT}`, 96, W - 110); g.fillText('MATCH SCHEDULE', 54, ty + 104) };
  const footer = fy => { g.textAlign = 'left'; g.fillStyle = P.ink; foot.forEach((l, i) => { fitFont(g, l, `{s}px ${PF.BD}`, 32, W - 112); g.fillText(l, 56, fy + i * 48) }) };
  if (d.lay === 'calendar') {
    bgFill(g, P, W, H, rnd, 'diag'); head(250); const first = new Date(+y, +m - 1, 1).getDay(), days = new Date(+y, +m, 0).getDate(); const cw = (W - 100) / 7, ch = 150, gy = 470;
    ['일', '월', '화', '수', '목', '금', '토'].forEach((n, i) => { g.textAlign = 'center'; g.fillStyle = i === 0 ? '#FF6B6B' : i === 6 ? (P.dark ? '#8AB4FF' : '#2F5BD3') : P.sub; g.font = `30px ${PF.BD}`; g.fillText(n, 50 + cw * i + cw / 2, gy + 40) });
    const byDay = {}; ss.forEach(s => byDay[+s.date.slice(8, 10)] = s);
    for (let dd = 1; dd <= days; dd++) { const idx = first + dd - 1, r = Math.floor(idx / 7), col = idx % 7; const x = 50 + col * cw + 4, yy = gy + 60 + r * (ch + 8); const s = byDay[dd];
      g.save(); rr(g, x, yy, cw - 8, ch, 14); g.fillStyle = s ? P.acc : alpha(P.dark ? '#FFFFFF' : '#000000', .05); g.fill(); g.restore();
      g.textAlign = 'left'; g.fillStyle = s ? (P.dark ? '#111' : '#FFF') : alpha(P.ink, .6); g.font = `40px ${LAT}`; g.fillText(String(dd), x + 14, yy + 48);
      if (s) { const ink = P.dark ? '#111' : '#FFF'; g.fillStyle = ink; fitFont(g, hr(s), `{s}px ${PF.BD}`, 30, cw - 30); g.fillText(hr(s), x + 14, yy + 90); fitFont(g, s.no ? `${s.no}회` : vshort(s.venue), `{s}px ${PF.BD}`, 24, cw - 30); g.fillText(s.no ? `${s.no}회` : vshort(s.venue), x + 14, yy + 126) } }
    const rows = Math.ceil((first + days) / 7); const ly = gy + 60 + rows * (ch + 8) + 20; const venues = [...new Set(ss.map(s => s.venue).filter(Boolean))];
    const vtxt = `${venues.join(' · ')}${fixedH != null ? `   ·   신청 오픈 ${fixedH}시` : ''}`; g.fillStyle = P.sub; g.textAlign = 'left'; fitFont(g, vtxt, `{s}px ${PF.BD}`, 30, W - 112); g.fillText(vtxt, 56, ly + 20);
    footer(ly + 90);
  } else if (d.lay === 'list') {
    bgFill(g, P, W, H, rnd, 'flat'); head(260); g.fillStyle = P.ink; g.fillRect(56, 410, W - 112, 4);
    ss.forEach((s, i) => { const yy = 440 + i * 150; g.save(); rr(g, 56, yy, W - 112, 132, 20); g.fillStyle = P.card; g.shadowColor = 'rgba(0,0,0,.15)'; g.shadowBlur = 14; g.fill(); g.restore();
      g.save(); rr(g, 56, yy, 190, 132, 20); g.clip(); g.fillStyle = P.acc; g.fillRect(56, yy, 190, 132); g.restore(); const ai = P.dark ? '#111' : '#FFF';
      g.fillStyle = ai; g.textAlign = 'center'; g.font = `70px ${LAT}`; g.fillText(s.date.slice(8, 10), 151, yy + 80); g.font = `26px ${PF.BD}`; g.fillText(`${+s.date.slice(5, 7)}월 ${dow(s.date)}`, 151, yy + 114);
      g.textAlign = 'left'; g.fillStyle = P.cardInk; fitFont(g, `${s.no ? s.no + '회 · ' : ''}${hr(s)}`, `{s}px ${KR}`, 44, 420); g.fillText(`${s.no ? s.no + '회 · ' : ''}${hr(s)}`, 276, yy + 60); g.fillStyle = alpha(P.cardInk, .7); fitFont(g, s.venue || '', `{s}px ${PF.BD}`, 30, 440); g.fillText(s.venue || '', 276, yy + 104);
      g.textAlign = 'right'; g.fillStyle = P.cardInk; g.font = `24px ${PF.BD}`; g.fillText('신청 오픈', W - 86, yy + 46); g.font = `34px ${PF.BD}`; g.fillText(openTxt(s), W - 86, yy + 88); const rs = idsToNames(s.p0); if (rs) { g.font = `22px ${PF.BD}`; g.fillStyle = alpha(P.cardInk, .6); fitFont(g, `예약 ${rs}`, `{s}px ${PF.BD}`, 22, 260); g.fillText(`예약 ${rs}`, W - 86, yy + 118) } });
    footer(440 + Math.max(4, ss.length) * 150 + 40);
  } else {
    const dark = d.lay === 'board'; if (dark) { g.fillStyle = mix(P.bg, '#000000', P.dark ? .35 : .85); g.fillRect(0, 0, W, H); g.fillStyle = alpha(P.acc, .07); for (let yy = 8; yy < H; yy += 16) for (let x = 8; x < W; x += 16) g.fillRect(x, yy, 4, 4); g.save(); rr(g, 20, 20, W - 40, H - 40, 20); g.lineWidth = 6; g.strokeStyle = P.acc; g.shadowColor = P.acc; g.shadowBlur = 20; g.stroke(); g.restore() } else { g.fillStyle = P.bg; g.fillRect(0, 0, W, H); g.fillStyle = P.acc; g.fillRect(0, 0, 24, H) }
    const Pk = dark ? { ...P, ink: '#FFFFFF', sub: alpha('#FFFFFF', .7) } : P; const ink = Pk.ink;
    g.textAlign = 'left'; g.fillStyle = Pk.sub; g.font = `30px ${PF.BD}`; g.fillText(cf.tag, 60, 76); badge(g, img, W - 104, 112, 58); g.save(); if (dark) { g.shadowColor = P.acc; g.shadowBlur = 26 } g.fillStyle = P.acc; g.font = `160px ${LAT}`; g.fillText(`${y}.${m}`, 54, 270); g.restore(); g.fillStyle = ink; fitFont(g, 'MATCH SCHEDULE', `{s}px ${LAT}`, 92, W - 120); g.fillText('MATCH SCHEDULE', 58, 380);
    const cols = [['회차', 120], ['일시', 250], ['장소', 260], [fixedH != null ? `신청(${fixedH}시)` : '신청 오픈', 190], ['예약자', 148]]; const tx = (W - cols.reduce((a, x) => a + x[1], 0)) / 2, ty = 450, rh = 84;
    g.fillStyle = dark ? alpha(P.acc, .9) : ink; g.fillRect(tx, ty, W - 2 * tx, 64); let cx = tx; g.textAlign = 'center'; cols.forEach(([t, w0]) => { g.fillStyle = dark ? '#111' : P.bg; g.font = `28px ${PF.BD}`; g.fillText(t, cx + w0 / 2, ty + 42); cx += w0 });
    const nr = Math.max(6, ss.length); for (let r = 0; r < nr; r++) { const yy = ty + 64 + r * rh; if (r % 2 === 0) { g.fillStyle = alpha(dark ? '#FFFFFF' : P.ink, .05); g.fillRect(tx, yy, W - 2 * tx, rh) } g.fillStyle = alpha(dark ? '#FFFFFF' : P.ink, .18); g.fillRect(tx, yy + rh - 1, W - 2 * tx, 1); const s = ss[r]; if (!s) continue; let x2 = tx;
      [[s.no ? `${s.no}회` : '', ink], [`${md(s.date)} ${hr(s)}`, P.acc], [vshort(s.venue), ink], [openTxt(s), ink], [idsToNames(s.p0), ink]].forEach(([v, col], i) => { const w0 = cols[i][1]; g.fillStyle = col; fitFont(g, v, `{s}px ${i === 1 ? KR : PF.BD}`, 32, w0 - 16); g.fillText(v, x2 + w0 / 2, yy + rh / 2 + 11); x2 += w0 }) }
    g.fillStyle = ink; const fy = ty + 64 + nr * rh + 70; g.textAlign = 'left'; foot.forEach((l, i) => { fitFont(g, l, `{s}px ${PF.BD}`, 32, W - 112); g.fillText(l, tx + 6, fy + i * 48) });
  }
  return c;
}
async function thumbOf(kind, d, key) { S.dthumb ??= {}; const k = `${kind}:${key}:${dKey(d)}`; if (S.dthumb[k]) return S.dthumb[k]; const big = kind === 'team' ? await drawTeam(cur(), d) : await drawSched(key, d); const t = document.createElement('canvas'); const r = big.height / big.width; t.width = 200; t.height = Math.round(200 * r); t.getContext('2d').drawImage(big, 0, 0, t.width, t.height); return (S.dthumb[k] = t.toDataURL('image/jpeg', .8)) }
function candList(kind) { S.cand ??= {}; return S.cand[kind] || (S.cand[kind] = DESIGN_PRESETS[kind].map(x => ({ ...x }))) }
function designPanel(kind, key, curD) { const L = candList(kind); const on = dKey(curD); const curF = curD.font || 'auto';
  return `<h2>포스터 시안<small>마음에 드는 시안을 고르세요</small></h2><div class="pthemes dz" data-kind="${kind}">${L.map((d, i) => { const t = S.dthumb?.[`${kind}:${key}:${dKey(d)}`]; const sel = dKey(d) === on || (d.lay === curD.lay && d.pal === curD.pal && d.seed === curD.seed); return `<button class="pth ${sel ? 'on' : ''}" data-act="pdesign" data-k="${kind}" data-i="${i}" aria-pressed="${sel}">${t ? `<img src="${t}" alt="">` : `<span class="pth-ph" style="background:linear-gradient(160deg,${PAL[d.pal].bg} 0 55%,${PAL[d.pal].acc} 55%)"></span>`}<b>${dName(kind, d)}</b></button>` }).join('')}</div>
  <div class="row" style="margin:4px 0 14px;gap:8px"><button class="btn" data-act="pnew" data-k="${kind}">🎲 새 시안 보기</button>${S.candNew?.[kind] ? `<button class="btn sm" data-act="preset" data-k="${kind}">기본 시안으로</button>` : ''}</div>
  <h2>포스터 글꼴<small>모두 무료 글꼴이에요</small></h2><div class="pfonts">${POSTER_FONTS.map(([k, n, fam]) => `<button class="pfo ${k === curF ? 'on' : ''}" data-act="pfont" data-k="${kind}" data-v="${k}" aria-pressed="${k === curF}" ${fam ? `style="font-family:${fam.replace(/"/g, "'")},inherit"` : ''}>${n}${k === 'auto' ? `<small>${POSTER_FONTS.find(x => x[0] === fontOf({ ...curD, font: 'auto' }))?.[1] || ''}</small>` : ''}</button>`).join('')}</div>` }
async function fillThumbs(kind, key) { if (S.thumbBusy?.[kind]) return; (S.thumbBusy ??= {})[kind] = 1; try { const L = candList(kind); for (let i = 0; i < L.length; i++) { const d = L[i]; const box = document.querySelector(`.pth[data-k="${kind}"][data-i="${i}"]`); if (!box || box.querySelector('img')) continue; const t = await thumbOf(kind, d, key); const b2 = document.querySelector(`.pth[data-k="${kind}"][data-i="${i}"]`); if (b2 && !b2.querySelector('img')) b2.insertAdjacentHTML('afterbegin', `<img src="${t}" alt="">`), b2.querySelector('.pth-ph')?.remove() } } catch (e) { console.error(e) } finally { S.thumbBusy[kind] = 0 } }
function clearThumbs(kind, key) { for (const k in (S.dthumb || {})) if (k.startsWith(`${kind}:${key}:`)) delete S.dthumb[k] }
async function applyDesign(kind, d) { if (kind === 'team') { const s = cur(); if (!s) return; await w(() => S.store.update(sp(S.sid), { posterDesign: d, posterTheme: null })); S.store.set('meta/poster', { ...(S.meta?.poster || {}), design: d }).catch(() => { }); const cv = await drawTeam({ ...s, posterDesign: d }, d); S.poster[S.sid] = cv.toDataURL('image/png'); const im = document.querySelector('img.poster:not(.schedimg)'); if (im) im.src = S.poster[S.sid] }
  else { const ym = S.schedYm || defaultMonth(); S.meta = S.meta || {}; S.meta.sched = { ...schedCfg(), design: d }; await w(() => S.store.set('meta/sched', S.meta.sched)); const cv = await drawSched(ym, d); (S.schedImg ??= {})[ym] = cv.toDataURL('image/png'); const im = document.querySelector('img.schedimg'); if (im) im.src = S.schedImg[ym] } }

async function posterBlob() { const s = cur(); const c = await drawTeam(s); return new Promise(r => c.toBlob(b => r(b), 'image/png')) }
async function refreshPoster() { const s = cur(); if (!s) return; const c = await drawTeam(s); S.poster[S.sid] = c.toDataURL('image/png'); const el = document.querySelector('img.poster:not(.schedimg)'); if (el) el.src = S.poster[S.sid]; else if (!document.querySelector('img.schedimg')) render() }
async function sharePoster(download) {
  const b = await posterBlob(); const s0 = cur(); const name = `WF_매치데이_${S.sid.slice(5).replace('-', '')}${s0?.no ? `_${s0.no}회` : ''}.png`; const file = new File([b], name, { type: 'image/png' });
  if (!download && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'WF MATCH DAY' }); return } catch (e) { if (e.name === 'AbortError') return } }
  if (S.store?.dl) { try { await S.store.dl.save({ filename: name, data: b }); toast('이미지를 저장했어요.') } catch (e) { if (e?.code !== 'declined') toast('이 화면에서는 저장할 수 없어요.') } return }
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000); toast('이미지를 저장했어요.');
}
function noticeText(s) {
  const lines = [`[${CFG.club?.short || 'WF'}] ${fmtDate(s.date)} ${s.time || ''} ${s.venue || ''}`.trim(), ''];
  for (const k of KEYS) { const t = team(s, k); lines.push(`■ ${t.name}`); lines.push(teamPlayers(s, k).map((id, i) => i === 0 && captainOf(s, k) === id ? pname(id) + '(C)' : pname(id)).join(' ')); lines.push('') }
  if (s.evpw) lines.push(`E/V 비밀번호: ${s.evpw}`); if (s.notice) lines.push(`공지: ${s.notice.replace(/[{}]/g, '')}`); return lines.join('\n');
}

/* ───────── rendering ───────── */
const DESK_Q = '(min-width:1024px) and (hover:hover) and (pointer:fine)';
function isDesk() { try { return matchMedia(DESK_Q).matches } catch { return false } }
function isTyping() { const a = document.activeElement; if (a && a.id === 'chatin') return !!S.composing; return a && a.id !== 'chatin' && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /text|search|tel|password|number|time|datetime-local/.test(a.type))) && document.getElementById('app').contains(a) }
window.addEventListener('error', e => { try { toast('오류가 생겼어요: ' + (e.message || '알 수 없음')) } catch { } });
window.addEventListener('unhandledrejection', e => { try { console.error(e.reason); toast('처리 중 오류: ' + (e.reason?.message || e.reason?.code || '알 수 없음')) } catch { } });
/* ── 특별 인증(이벤트) ── */
const BOOT_T0 = performance.now();
/* 스타일 파일이 옛 버전이면(서버 반영 지연·폰 저장본) 최신 파일을 다시 받아요 */
setTimeout(() => { try { const v = getComputedStyle(document.documentElement).getPropertyValue('--cssv').replace(/["'\s]/g, ''); if (!IS_ARTIFACT && v !== APP_VERSION) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `style.css?v=${APP_VERSION}&r=${Date.now()}`; document.head.appendChild(l); console.warn('style.css 다시 받기', v, '→', APP_VERSION) } } catch { } }, 1500);
function hideBoot() { const b = document.getElementById('boot'); if (!b || b.dataset.out) return; b.dataset.out = '1'; const wait = Math.max(0, 1100 - (performance.now() - BOOT_T0)); setTimeout(() => { b.classList.add('out'); setTimeout(() => b.remove(), 500) }, wait) }
(() => { const im = document.querySelector('#boot img'); if (im) im.src = EMBLEM_SRC })();
let RENDER_Q = 0; function renderSoon() { if (RENDER_Q) return; RENDER_Q = requestAnimationFrame(() => { RENDER_Q = 0; render() }) }
/* 드래프트: 이름표가 주장 카드 안으로 날아 들어가는 애니메이션 */
function draftSnap() { if (S.flySnap && Date.now() - S.flySnap.at < 600) return; const pool = document.querySelectorAll('.namegrid [data-id]'); const stk = document.querySelectorAll('.seat [data-pid]'); if (!pool.length && !stk.length) { S.flySnap = null; return }
  const r = {}; pool.forEach(b => { const q = b.getBoundingClientRect(); if (q.width) r[b.dataset.id] = { x: q.left, y: q.top, w: q.width, h: q.height, cs: getComputedStyle(b) } }); S.flySnap = { at: Date.now(), pool: r, had: new Set([...stk].map(e => e.dataset.pid)) } }
function draftFly() { const snap = S.flySnap; S.flySnap = null; if (!snap || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('.seat [data-pid]').forEach(el => { const pid = el.dataset.pid, from = snap.pool[pid]; if (snap.had.has(pid) || !from) return; const to = el.getBoundingClientRect(); if (!to.width) return;
    const f = document.createElement('div'); f.className = 'flytag jf'; f.innerHTML = figHTML(pname(pid)); Object.assign(f.style, { left: from.x + 'px', top: from.y + 'px', width: from.w + 'px', height: from.h + 'px' });
    const seat = el.closest('.seat'); const tc = seat ? getComputedStyle(seat).getPropertyValue('--tc').trim() : ''; const ti = seat ? getComputedStyle(seat).getPropertyValue('--ti').trim() : ''; if (tc) { f.style.setProperty('--tc', tc); f.style.setProperty('--ti', ti || '#fff') } document.body.appendChild(f); setTimeout(() => f.classList.add('vest'), 280); el.style.visibility = 'hidden';
    const dx = to.left + to.width / 2 - (from.x + from.w / 2), dy = to.top + to.height / 2 - (from.y + from.h / 2), sc = Math.max(.45, Math.min(1.2, to.height / from.h)), lift = -Math.min(140, 60 + Math.abs(dx) * .15);
    const an = f.animate([{ transform: 'translate(0,0) scale(1) rotate(0deg)', offset: 0 }, { transform: `translate(${dx * .5}px,${dy * .5 + lift}px) scale(1.18) rotate(${dx > 0 ? 8 : -8}deg)`, offset: .45 }, { transform: `translate(${dx}px,${dy}px) scale(${sc}) rotate(0deg)`, offset: 1 }], { duration: 720, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
    const done = () => { f.remove(); el.style.visibility = ''; el.animate?.([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' }) }; an.onfinish = done; setTimeout(() => { if (f.isConnected) done() }, 1200) }) }
/* 채팅 말풍선: 최상위 레이어로 옮겨서 다른 요소에 가려지지 않게 */
function liftBubbles() { let L = document.getElementById('bubLayer'); if (!L) { L = document.createElement('div'); L.id = 'bubLayer'; L.setAttribute('aria-live', 'polite'); document.body.appendChild(L) } L.innerHTML = ''; S.bubA = [];
  document.querySelectorAll('#app .bubble').forEach(b => { const a = b.parentElement; b.remove(); L.appendChild(b); S.bubA.push({ a, b }) }); placeBubbles() }
function placeBubbles() { const vw = innerWidth, top0 = (document.querySelector('.appbar')?.offsetHeight || 0) + 4, placed = [];
  (S.bubA || []).forEach(({ a, b }) => { if (!a.isConnected) { b.remove(); return } const r = a.getBoundingClientRect(); if (!r.width) { b.style.display = 'none'; return } b.style.display = '';
    const w = b.offsetWidth, h = b.offsetHeight, cx = r.left + r.width / 2, left = Math.max(8, Math.min(vw - w - 8, cx - w / 2)); const toField = a.classList?.contains('hostbox') || !!a.closest?.('.tradehost'); let top = r.top - h - 10; const below = toField || top < top0; if (below) top = r.bottom + 10;
    for (let k = 0; k < 6; k++) { const hit = placed.find(q => left < q.l + q.w + 4 && left + w + 4 > q.l && top < q.t + q.h + 4 && top + h + 4 > q.t); if (!hit) break; top = below ? hit.t + hit.h + 6 : hit.t - h - 6 } placed.push({ l: left, t: top, w, h });
    b.classList.toggle('below', below); b.style.left = left + 'px'; b.style.top = top + 'px'; b.style.setProperty('--ax', Math.max(16, Math.min(w - 16, cx - left)) + 'px') }) }
window.addEventListener('scroll', () => { if (S.bubA?.length) placeBubbles(); if (S.ballK) placeBall() }, { passive: true, capture: true });
/* 차례 축구공: 차례인 팀 카드 위에서 통통 튀고, 차례가 넘어가면 다음 팀으로 패스 */
const BALL_SVG = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18.5" fill="#fff" stroke="#131C2B" stroke-width="2"/><path d="M20 12.5l7 5.1-2.7 8.2h-8.6L13 17.6z" fill="#131C2B"/><path d="M20 12.5V3.2M27 17.6l8.6-2.9M24.3 25.8l5.4 7.4M15.7 25.8l-5.4 7.4M13 17.6l-8.6-2.9" stroke="#131C2B" stroke-width="2" fill="none"/><path d="M14.5 2.6L20 3.2l5.5-.6M35.6 14.7l2 5.3-.9 5.6M29.7 33.2l-4.7 3-5.4.9M10.3 33.2l4.7 3M4.4 14.7l-2 5.3.9 5.6" stroke="#131C2B" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
function placeBall() { const seat = document.querySelector('.board-table .seat.balltgt'); let el = document.getElementById('turnBall');
  if (!seat) { if (el) el.remove(); S.ballK = null; S.ballPos = null; clearInterval(S.ballT); S.ballT = null; return }
  if (!S.ballT) S.ballT = setInterval(() => { if (!document.querySelector('#turnBall.passing')) placeBall() }, 400); // 레이아웃이 나중에 바뀌어도 카드 위에 붙어 있게
  if (!el) { el = document.createElement('div'); el.id = 'turnBall'; el.innerHTML = `<i class="tb-sh"></i><b class="tb-b">${BALL_SVG}</b>`; document.body.appendChild(el) }
  const r = seat.getBoundingClientRect(); const sz = S.dm ? 26 : 32; const x = r.left + r.width / 2 - sz / 2, y = r.top - sz + 5; const k = seat.dataset.k;
  el.style.width = el.style.height = sz + 'px'; el.style.left = x + 'px'; el.style.top = y + 'px';
  if (S.ballK && S.ballK !== k && S.ballPos && !matchMedia('(prefers-reduced-motion: reduce)').matches) { const dx = S.ballPos.x - x, dy = S.ballPos.y - y, lift = -Math.min(150, 70 + Math.abs(dx) * .3);
    const N = 18, D = 760, kf = []; for (let i = 0; i <= N; i++) { const t = i / N; kf.push({ transform: `translate(${dx * (1 - t)}px,${dy * (1 - t) + lift * 4 * t * (1 - t)}px)` }) }
    el.classList.add('passing'); S.ballAn?.cancel(); S.ballSpin?.cancel();
    S.ballAn = el.animate(kf, { duration: D, easing: 'linear' });
    S.ballSpin = el.querySelector('.tb-b').animate([{ transform: 'scale(1.15,.85)', rotate: '0deg', offset: 0 }, { transform: 'scale(1,1)', offset: .08 }, { transform: 'scale(1,1)', rotate: (dx > 0 ? '-' : '') + '360deg', offset: .92 }, { transform: 'scale(1.18,.82)', rotate: (dx > 0 ? '-' : '') + '360deg', offset: 1 }], { duration: D, easing: 'linear' });
    S.ballAn.onfinish = () => { el.classList.remove('passing'); el.querySelectorAll('.tb-b,.tb-sh').forEach(n => { n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; n.style.animationDelay = '-.42s' }) } }
  S.ballK = k; S.ballPos = { x, y } }
/* 드래프트 접속자: 각 접속 화면이 15초마다 표시를 남기고, Master만 목록을 봐요 */
function presRole() { const s = cur(); if (S.admin) return '운영진'; const k = s && myTeam(s); if (k) return `${team(s, k).name} 주장`; if (quietView()) return '숨김 참관'; if (isMaster()) return 'Master'; if (s && (s.viewers || []).includes(myPid())) return '참관'; return '보는 중' }
function presTick() { const on = !!document.querySelector('.board-table') && !!S.sid && !!S.store; const sid = S.sid;
  if (on) { const id = `${sid}__${myUid()}`; if (S.presId && S.presId !== id) { S.store.del('pres/' + S.presId).catch(() => { }) } S.presId = id;
    const beat = () => S.store.set('pres/' + id, { sid, uid: myUid(), name: S.me || pname(myPid()) || '(이름 없음)', role: presRole(), at: Date.now(), dev: /Mobi/i.test(navigator.userAgent) ? '📱' : '💻' }).catch(() => { });
    if (!S.presT || S.presSid !== sid || S.presRole !== presRole()) { clearInterval(S.presT); S.presSid = sid; S.presRole = presRole(); beat(); S.presT = setInterval(beat, 15000) } }
  else if (S.presT) { clearInterval(S.presT); S.presT = null; if (S.presId) S.store.del('pres/' + S.presId).catch(() => { }); S.presId = null }
  // Master: 접속자 목록
  if (on && !S.unPres) S.unPres = S.store.watchCol('pres', docs => { S.presAll = docs; const a = presAdmins().join('|'); if (a !== S.presAdm) { S.presAdm = a; renderSoon() } drawPres() });
  if (!on && S.unPres) { try { S.unPres() } catch { } S.unPres = null }
  const el = document.getElementById('presBox'); if (!(on && isMaster())) { if (el) el.remove(); return } drawPres() }
function presAdmins() { const now = Date.now(); return [...new Set((S.presAll || []).filter(d => d.sid === S.sid && d.role === '운영진' && now - (d.at || 0) < 45000).map(d => d.name || '운영진'))].sort() }
function drawPres() { if (!isMaster() || !document.querySelector('.board-table')) return; const now = Date.now(); const list = (S.presAll || []).filter(d => d.sid === S.sid && now - (d.at || 0) < 45000).sort((a, b) => (a.role > b.role ? 1 : -1));
  let el = document.getElementById('presBox'); if (!el) { el = document.createElement('div'); el.id = 'presBox'; document.body.appendChild(el) }
  el.innerHTML = `<button class="pres-pill" data-act="presopen">👥 접속 ${list.length}</button>${S.presOpen ? `<div class="pres-list"><b>지금 드래프트 화면에 있는 사람 <small>Master 전용</small></b>${list.length ? list.map(d => `<div class="pres-row ${d.role === '숨김 참관' ? 'hid' : ''}"><span>${d.dev || ''} ${esc(d.name || '')}${d.uid === myUid() ? ' <i>(나)</i>' : ''}</span><em>${esc(d.role || '')}</em><small>${Math.max(0, Math.round((now - d.at) / 1000))}초 전</small></div>`).join('') : '<p>아무도 없어요</p>'}</div>` : ''}` }
window.addEventListener('pagehide', () => { if (S.presId) try { S.store.del('pres/' + S.presId) } catch { } });
function fitPool() { const short = innerHeight < 760; const sr = document.querySelector('.dmroot .seatrow'); if (sr) { const hd = sr.querySelector('.seat .sv2'); if (hd) sr.style.setProperty('--seatmin', Math.ceil(hd.offsetHeight + (short ? 52 : 100)) + 'px') }
  const g = document.querySelector('.dmroot .felt .pool .namegrid'); if (g && g.children.length) { let fw = 52; g.style.setProperty('--pfw', fw + 'px'); while (fw > 34 && g.scrollHeight > g.clientHeight + 1) { fw -= 3; g.style.setProperty('--pfw', fw + 'px') } }
}
function render() {
  if (isTyping()) { S.pending = true; return } S.pending = false; draftSnap();
  S.dm = !isDesk();
  if (S.ready >= 3 || S.err) hideBoot();
  if (S.ready >= 3) ensureQueues();
  if (S.fs) requestAnimationFrame(() => { fsFit(); setTimeout(fsFit, 120) });
  if (S.ready >= 3 && S.auth && !S.admin) { loadPrefs(); pushListen(); watchInbox() }
  if (!S.admin && S.auth && S.ready >= 3) { const cs = capSid(); if (cs && S.tab !== 'draft' && !(S.capPop ??= {})[cs] && !S.sheet) { S.capPop[cs] = 1; S.sheet = { type: 'cappop', sid: cs } } }
  if (!S.admin && !S.auth && S.ready >= 3) { document.body.classList.remove('dm-on'); document.getElementById('app').innerHTML = loginScreen() + (S.sheet ? viewSheet() : ''); return }
  if (S.ready >= 3 && (!S.sid || !S.sessions[S.sid])) S.sid = defaultSid();
  if (S.store && S.chatSid !== S.sid) watchChat();
  if (S.admin) { watchContacts(); if (!S.unRules && S.store) S.unRules = S.store.watchCol('pushRules', docs => { const o = {}; docs.forEach(d => { const { id, ...r } = d; o[id] = r }); S.rules = o; renderSoon() }, null, () => { }) }
  const ov = document.querySelector('.overlay')?.scrollTop;
  const ci = document.getElementById('chatin'); const ciState = ci ? { v: ci.value, f: document.activeElement === ci, a: ci.selectionStart, b: ci.selectionEnd } : null;
  let h = appbar() + '<div class="wrap">';
  if (S.err) h += `<div class="notice warn">${esc(S.err)}</div>`;
  if (S.ready < 3) h += '<p class="empty">불러오는 중…</p>';
  else if (S.tab === 'manage') h += viewPlan();
  else if (S.tab === 'run') h += viewRun();
  else if (S.tab === 'notice') h += viewNoticeMenu();
  else if (S.tab === 'members') h += viewMembers();
  else if (S.tab === 'home') h += viewManage();
  else if (S.tab === 'draft' && (capSid() || viewSid()) && (S.sid = capSid() || viewSid()) && S.dm && cur().draftStatus !== 'done') h += `<div class="dmroot">${myTeam(cur()) ? '' : '<div class="viewbar">👀 참관 중 · 보기만 할 수 있어요</div>'}${vDraft(cur())}</div>`;
  else if (S.tab === 'draft' && !capSid() && viewSid() && (S.sid = viewSid()) && cur().draftStatus !== 'done') h += `<div class="viewbar">👀 참관 중 · 보기만 할 수 있어요</div>${vDraft(cur())}`; // PC 참관자
  else if (S.tab === 'draft') h += withSession(s => myTeam(s) ? (s.draftStatus === 'done' ? vTrade(s) : vDraft(s)) : vMemberNotice(s));
  else if (S.tab === 'mhome') h += S.sub === 'applist' && cur() ? viewApplicants() : viewMHome();
  else if (S.tab === 'sched') h += viewSchedule();
  else if (S.tab === 'results') h += viewResults();
  else if (S.tab === 'mm') h += viewMatchMode();
  else h += viewSettings();
  h += '</div>' + tabs();
  if (S.openMatch && S.matches[S.openMatch]) h += viewMatch();
  if (S.sheet) h += viewSheet();
  document.getElementById('app').innerHTML = h + (S.admin ? venueList() : ''); fitPool(); liftBubbles(); placeBall(); presTick(); sheetAutoSync(); { const tb = isDesk() && document.querySelector('.tabs'); document.documentElement.style.setProperty('--tabsb', (tb ? tb.getBoundingClientRect().bottom : (document.querySelector('.appbar')?.offsetHeight || 0)) + 'px') } if (S.flySnap) requestAnimationFrame(draftFly);
  if (S.slideDir) { const wr = document.querySelector('.wrap'); if (wr) { wr.classList.add('tabslide-' + S.slideDir) } }
  const nNow = S.chat.length; const grew = nNow !== S.lastChatN; S.lastChatN = nNow; if (grew) S.chatUp = false;
  const toBottom = () => document.querySelectorAll('.msgs').forEach(nb => { if (!S.chatUp) nb.scrollTop = nb.scrollHeight });
  toBottom(); requestAnimationFrame(toBottom);
  const dock = document.querySelector('.chatdock'); if (dock) document.documentElement.style.setProperty('--dockh', dock.offsetHeight + 'px');
  const ad = document.querySelector('.applydock'); document.documentElement.style.setProperty('--adock', (ad ? ad.offsetHeight : 0) + 'px');
  if (ov) document.querySelector('.overlay')?.scrollTo(0, ov);
  if (ciState) { const n = document.getElementById('chatin'); if (n) { n.value = ciState.v; if (ciState.f) { n.focus({ preventScroll: true }); try { n.setSelectionRange(ciState.a, ciState.b) } catch { } } } }
  scheduleBubbles();
  saveNav();
  if (S.swAnim) { const tgt = document.querySelector('.homefit, .schfit, .dmroot') || document.querySelector('.wrap'); if (tgt) { tgt.classList.remove('sw-fromR', 'sw-fromL'); void tgt.offsetWidth; tgt.classList.add('sw-' + S.swAnim) } S.swAnim = '' }
  const dmOn = !!document.querySelector('.dmroot, .homefit, .schfit'); document.body.classList.toggle('dm-on', dmOn); document.body.classList.toggle('hasmm', !!document.querySelector('.mmtab'));
  { const ab = document.querySelector('.appbar'); if (ab) document.documentElement.style.setProperty('--abh', ab.offsetHeight + 'px') }
  tick();
}
function adminBar() {
  if (!S.admin || S.ready < 3 || S.tab !== 'run') return ''; const ids = Object.keys(S.sessions).sort(); if (!ids.length) return '';
  if (!S.sid || !S.sessions[S.sid]) S.sid = defaultSid(); const sid = S.sid, s = S.sessions[sid]; const i = ids.indexOf(sid); const st = sStatus(s); const c = appCounts(s);
  const ms = sessMatches(sid); const cur0 = S.tab === 'run' ? (S.step || (s.stage === 'match' && ms.length && ms.every(m => m.status === 'done') ? 'result' : s.stage)) : null;
  const flow = RUN_STEPS.map(([k, n], j) => { const done = stepDone(s, k); const now = cur0 ? cur0 === k : (!done && RUN_STEPS.slice(0, j).every(([kk]) => stepDone(s, kk)));
    return `<li class="${done ? 'done' : ''} ${now ? 'now' : ''}"><button data-act="flowgo" data-v="${k}"><i>${done ? '✓' : j + 1}</i><span>${n}</span></button></li>` }).join('');
  return `<div class="abar"><div class="actx"><button class="navb sm" data-act="ctxgo" data-id="${ids[i - 1] || ''}" ${ids[i - 1] ? '' : 'disabled'} aria-label="이전 경기">‹</button>
    <label class="actx-t"><b>${fmtDate(sid)} ${esc(s.time || '')}${s.no ? ` · ${s.no}회` : ''}</b><small>📍 ${esc(s.venue || '-')} · <span class="st st-${st.k}">${st.label}</span> 신청 ${c.sel + c.wait}${s.capacity ? '/' + s.capacity : ''}${c.wait ? ` · 대기 ${c.wait}` : ''}</small>
      <select data-in="ctxpick" aria-label="경기 선택">${ids.slice().reverse().map(id => `<option value="${id}" ${id === sid ? 'selected' : ''}>${fmtDate(id)} ${esc(S.sessions[id].time || '')}${S.sessions[id].no ? ` · ${S.sessions[id].no}회` : ''} · ${esc(S.sessions[id].venue || '')}</option>`).join('')}</select><em class="actx-dd">▾</em></label>
    <button class="navb sm" data-act="ctxgo" data-id="${ids[i + 1] || ''}" ${ids[i + 1] ? '' : 'disabled'} aria-label="다음 경기">›</button></div>
    <ol class="aflow">${flow}</ol></div>`;
}
function capStrip() { if (S.admin || S.tab === 'draft') return ''; const cs = capSid(); if (!cs) return ''; const s = S.sessions[cs]; const k = myTeam(s);
  return `<button class="capstrip" data-act="gocap" data-id="${cs}">👑 ${fmtDate(cs)} 경기 <b>${esc(team(s, k).name)} 주장</b>이에요 · ${s.room?.open && s.draftStatus !== 'done' ? '드래프트 방이 열렸어요' : s.draftStatus === 'done' ? '밸런스 조정 중' : '팀 선정 준비 중'} <span>팀 선정 화면 ›</span></button>` }
function appbar() {
  const s = S.sid ? S.sessions[S.sid] : null; const back = false;
  return `<header class="appbar"><div class="in">${back ? '<button class="back" data-act="home" aria-label="경기일 목록">‹</button>' : `<img src="${EMBLEM_SRC}" alt="홈으로" data-act="gohome" style="cursor:pointer">`}
  <div class="ttl" data-act="gohome" role="button" tabindex="0" aria-label="홈으로"><b>${esc(CFG.club?.name || 'WEEKDAYS FUTSAL CLUB')}</b><span></span></div>
  ${!S.dm && !S.admin && S.auth ? `<button class="mmtop ${S.tab === 'mm' ? 'on' : ''}" data-act="mmtoggle" aria-label="${S.tab === 'mm' ? '일반모드로 돌아가기' : '경기모드 열기'}"><span class="mmball">${XICO.mm}</span><b>${S.tab === 'mm' ? '일반모드' : '경기모드'}</b>${liveAny() ? '<i class="mmlive"></i>' : ''}</button>` : ''}${S.auth && !S.admin ? (() => { const n = (S.inbox || []).filter(x => !x.read).length; return `<button class="bell" data-act="inbox" aria-label="받은 알림${n ? ' ' + n + '개 안 읽음' : ''}">${XICO.bell}${n ? `<i>${n > 9 ? '9+' : n}</i>` : ''}</button>` })() : ''}${!S.admin && capSid() ? `<button class="capico" data-act="gocap" data-id="${capSid()}" aria-label="팀 드래프트 입장" title="팀 드래프트 입장">👑<b>드래프트</b></button>` : !S.admin && viewSid() && S.sessions[viewSid()]?.draftStatus !== 'done' ? `<button class="capico view" data-act="gocap" data-id="${viewSid()}" aria-label="드래프트 참관" title="드래프트 참관">👀<b>참관</b></button>` : ''}${canOp() ? `<button class="opbtn ${S.admin ? 'on' : ''}" data-act="opmode">운영모드</button>` : ''}</div>${capStrip()}</header>`;
}
function tabs() {
  const t = S.admin ? [['manage', '일정'], ['run', '경기'], ['notice', '공지'], ['members', '회원'], ['settings', '설정']] : [['mhome', '홈'], ['sched', '일정'], ...(isDesk() ? [] : [['mm', '경기모드']]), ['results', '기록실'], ['settings', '내 정보']]; // 아래 메뉴는 항상 고정 — 드래프트는 오른쪽 위 버튼으로 입장
  return `<div class="tabs"><nav style="grid-template-columns:repeat(${t.length},1fr)">${t.map(([k, n]) => k === 'mm' ? `<button class="mmtab ${S.tab === 'mm' ? 'on' : ''}" data-act="mmtoggle" ${S.tab === 'mm' ? 'aria-current="page"' : ''}><span class="mmball">${XICO.mm}</span><span>${S.tab === 'mm' ? '일반모드' : n}</span>${liveAny() ? '<i class="mmlive"></i>' : ''}</button>` : `<button data-act="tab" data-v="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${XICO[S.admin && k === 'settings' ? 'gear' : TAB_ICO[k]] || ''}<span>${n}</span></button>`).join('')}</nav></div>` }
const TAB_ICO = { mhome: 'home', sched: 'cal', results: 'chart', settings: 'user', draft: 'run', manage: 'cal', run: 'run', notice: 'mega', members: 'users' }; // 하단 메뉴 아이콘
function liveAny() { return Object.values(S.matches).some(m => m.status === 'live' && m.timer?.running) }
function sessionPicker() { const ids = Object.keys(S.sessions).sort().reverse(); if (ids.length < 2) return '';
  return `<label class="sr" for="sidpick">경기일 선택</label><select id="sidpick" class="inp" style="margin-top:12px" data-in="sidpick">${ids.map(id => `<option value="${id}" ${id === S.sid ? 'selected' : ''}>${fmtDate(id)} ${esc(S.sessions[id].time || '')}</option>`).join('')}</select>` }
function withSession(fn) { const s = cur(); if (!s) return `<p class="empty">아직 경기일이 없어요. 운영진이 만들면 여기에 보여요.</p>`; return sessionPicker() + fn(s) }
function vMemberNotice(s) {
  if (stageIdx(s.stage) >= stageIdx('notice')) return vNotice(s);
  if (s.draftStatus === 'live') return `<div class="notice"><span class="dot"></span> 지금 드래프트가 진행 중이에요. 실시간으로 볼 수 있어요.</div>` + vDraft(s);
  if (s.draftStatus === 'done') return `<div class="notice">드래프트가 끝나고 팀 밸런스를 조정하는 중이에요. 곧 공지가 올라와요.</div>` + vTrade(s);
  const ids = s.applicants || []; const caps = KEYS.filter(k => s.captains?.[k]);
  return `<h2>${fmtDate(s.date)} 경기</h2><div class="panel list2"><div><span>시간</span><b>${esc(s.time || '-')}</b></div><div><span>장소</span><b>${esc(s.venue || '-')}</b></div><div><span>진행 단계</span><b>${STAGES[stageIdx(s.stage)][1]}</b></div></div>
  ${caps.length ? `<h2>주장</h2><div class="panel list2">${caps.map(k => `<div><span>${tag(team(s, k))}</span><b>👑 ${esc(pname(s.captains[k]))}</b></div>`).join('')}</div>` : ''}
  <h2>신청자<small>${ids.length}명</small></h2><div class="panel"><div class="chips">${byName(ids).map(id => `<span class="chip ${id === myPid() ? 'sel' : ''}">${esc(pname(id))}</span>`).join('') || '<span class="muted">아직 신청자가 없어요.</span>'}</div></div>
  <p class="note">드래프트가 시작되면 이 화면에서 실시간으로 볼 수 있어요.</p>` + chatPanel();
}

function vApply(s) {
  const ad = S.admin; const ids = s.applicants || [];
  let h = `<h2>신청 조건<small>수정은 일정 메뉴에서</small></h2><div class="panel apinfo ro">${[['정원', s.capacity ? s.capacity + '명' : '-'], ['신청 오픈', s.applyOpen ? fmtDT(s.applyOpen) : '-'], ['신청 마감', s.applyClose ? fmtDT(s.applyClose) : '-'], ['순위 규칙', isBase(s) ? 'The Base 0~3순위' : '선착순'], ['구장 예약자', idsToNames(s.p0) || '-'], ['경기 운영자', idsToNames(s.ops) || '-']].map(([k, v]) => `<div class="field"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
  const ast = sStatus(s); const cc = appCounts(s);
  h += `<h2>신청자<small>신청 ${cc.sel + cc.wait}${s.capacity ? ' / ' + s.capacity : ''}명${cc.wait ? `, 대기 ${cc.wait}명` : ''}</small><span class="st st-${ast.k}">${ast.label}</span></h2>
  <p class="note" style="margin:-4px 2px 10px">${ast.k === 'open' ? `회원들이 앱에서 직접 신청하는 중이에요. ${s.applyClose ? fmtDT(s.applyClose) + '에 자동 마감돼요.' : ''}` : ast.k === 'soon' ? `${fmtDT(s.applyOpen)}에 앱 신청이 열려요.` : '앱 신청이 마감됐어요.'}</p>`;
  h += vApplyTable(s);
  if (ad && s.stage === 'apply') h += `<div class="panel pad" style="display:flex;gap:8px;margin-top:10px"><input class="inp" type="text" placeholder="한 명씩 추가 (게스트는 이름(게))" data-in="addone" id="addone"><button class="btn" data-act="addone">추가</button></div>`;
  if (ad && S.rejNames?.length && ['apply', 'captain'].includes(s.stage)) h += `<div class="panel pad rejbox"><span>명단에 없는 이름: <b>${S.rejNames.map(esc).join(', ')}</b></span><div class="row"><button class="btn sm primary" data-act="rejguest">게스트로 추가</button><button class="btn sm" data-act="rejclose">닫기</button></div></div>`;
  if (ad && ast.k === 'open') h += `<div class="row" style="margin-top:10px"><button class="btn" data-act="closenow">지금 신청 마감하기</button></div>`;
  if (s.stage !== 'apply' && ids.length % 3 && ids.length) h += `<p class="note">${ids.length}명은 3팀으로 딱 나눠지지 않아서 ${[0, 1, 2].map(i => Math.floor(ids.length / 3) + (i < ids.length % 3 ? 1 : 0)).join('·')}명으로 나뉘어요.</p>`;
  if (ad) h += `<div style="height:14px"></div><button class="btn primary block" data-act="gostage" data-v="captain" ${(s.stage === 'apply' ? cc.sel : ids.length) < 3 ? 'disabled' : ''}>${s.stage === 'apply' ? '신청 확정하고 주장 정하기' : '다음: 주장 정하기'}</button>`;
  if (ad && s.stage !== 'apply') h += resetBar(s);
  return h;
}
function vCaptain(s) {
  const ad = S.admin && s.draftStatus === 'ready' && !s.ladder; const sid = s.date; const closed = applyClosed(s);
  let h = `<div class="helpers"><div class="hp-intro"><b>경기 도우미 지정</b><span>주장 3명과 주차 · 공당 · 물당을 이 화면에서 한 번에 정해요.</span></div>`;
  // 주장 (가로 3칸)
  h += `<section class="hp-sec"><div class="hp-hd"><b>👑 주장</b><small>${KEYS.filter(k => s.captains?.[k]).length}/3명 · 카드를 눌러서 정해요</small></div><div class="capgrid">${KEYS.map(k => { const c = s.captains?.[k];
    return `<button class="capcard ${c ? 'on' : ''}" data-act="capslot" data-k="${k}" ${ad ? '' : 'disabled'}><span class="cc-tag" style="background:${NEUTRAL[k]};color:${inkOn(NEUTRAL[k])}">${k}팀</span><b class="cc-name">${c ? esc(pname(c)) : '＋ 주장 선택'}</b>${ad && c ? '<small class="cc-edit">눌러서 변경</small>' : ''}</button>` }).join('')}</div>
    ${S.admin && s.draftStatus === 'ready' ? `<button class="btn primary block cta hp-open" data-act="openroom" ${KEYS.some(k => !s.captains?.[k]) ? 'disabled' : ''}>${KEYS.some(k => !s.captains?.[k]) ? '주장 3명을 정하면 드래프트 방을 열 수 있어요' : '🎯 드래프트 방 열기'}</button>` : ''}</section>`;
  if (S.admin) {
    // 주차
    const pa = parkApps(s), win = s.parkWin || [];
    h += `<section class="hp-sec"><div class="hp-hd"><b>🚗 주차</b><small>신청 ${pa.length}명 · ${PARK_SLOTS}자리</small></div><div class="hp-card">
      <div class="hp-list">${win.length ? win.map(id => { const a = (s.park || {})[id] || {}; return `<span class="hp-pill win"><b>${esc(pname(id))}</b>${a.car ? `<small>${esc(a.car)}</small>` : ''}</span>` }).join('') : `<span class="hp-empty">${pa.length ? '아직 당첨자가 없어요' : '주차 신청자가 없어요'}</span>`}</div>
      <div class="hp-btns">${closed && pa.length ? `<button class="btn primary" data-act="parkdraw" data-id="${sid}">🎲 ${win.length ? '다시 추첨' : '추첨하기'}</button>` : ''}<button class="btn" data-act="parkedit" data-id="${sid}">명단 · 직접 지정</button></div>
      ${closed ? '' : '<p class="hp-note">신청이 마감되면 추첨할 수 있어요.</p>'}</div></section>`;
    // 공당 · 물당 (2칸)
    const d = s.duty || {}; const ps = new Set(participants(s));
    const ps0 = participants(s); const spin = S.dspin && S.dspin.sid === sid ? S.dspin : null;
    const duty = (kind, ico, nm) => { const sel = d[kind] || [], other = kind === 'drink' ? (d.ball || []) : (d.drink || []); const n = dutyN(s, kind); const req = dutyReqs(s, kind).filter(id => ps0.includes(id) && !other.includes(id));
      const sp0 = spin && spin.kind === kind; const show = sp0 ? dutyPool(s, kind) : [...new Set([...sel, ...req])];
      return `<div class="hp-card"><div class="hp-sub"><b>${ico} ${nm}</b><small>${sel.length ? `${sel.length}명 확정` : '미확정'} · 🙋 신청 ${req.length}명</small></div>
        <div class="hp-list">${show.length ? show.map(id => sp0 ? `<span class="hp-pill ${spin.hl.includes(id) ? 'win spin' : ''}"><b>${esc(pname(id))}</b></span>`
          : closed ? `<button class="hp-pill tog ${sel.includes(id) ? 'win' : ''}" data-act="dutytog" data-kind="${kind}" data-id="${id}" data-sid="${sid}">${sel.includes(id) ? '✓ ' : ''}<b>${esc(pname(id))}</b>${req.includes(id) ? '<small>🙋 신청</small>' : ''}</button>` : `<span class="hp-pill"><b>${esc(pname(id))}</b><small>🙋 신청</small></span>`).join('') : '<span class="hp-empty">아직 신청자가 없어요</span>'}</div>
        <div class="dn-row"><span>인원</span><div class="stepper"><button class="btn sm" data-act="dutyn" data-kind="${kind}" data-d="-1" data-id="${sid}" ${n <= 1 ? 'disabled' : ''} aria-label="줄이기">−</button><b>${n}명</b><button class="btn sm" data-act="dutyn" data-kind="${kind}" data-d="1" data-id="${sid}" aria-label="늘리기">＋</button></div></div>
        <p class="hp-note">${req.length === n ? `신청자 ${n}명을 그대로 확정해요.` : req.length > n ? `신청자 ${req.length}명 중 ${n}명을 추첨해요.` : req.length ? `신청자 ${req.length}명은 자동 포함, 부족한 ${n - req.length}명은 추첨해요.` : `참가자 중에서 ${n}명을 추첨해요.`}${kind === 'drink' ? ' 공당은 제외돼요.' : ''}</p>
        <div class="hp-btns"><button class="btn primary" data-act="dutydraw" data-kind="${kind}" data-id="${sid}" ${closed && !spin && dutyPool(s, kind).length ? '' : 'disabled'}>${sel.length ? '🎲 다시 확정' : `🎲 ${nm} ${n}명 확정`}</button><button class="btn" data-act="dutyedit" data-id="${sid}">직접 고르기</button></div></div>` };
    h += `<section class="hp-sec"><div class="hp-hd"><b>🧺 공당 · 물당</b><small>신청자는 자동 포함 · 인원이 넘치거나 모자라면 추첨 · 공당 먼저, 물당은 공당 제외</small></div><div class="hp-two">${duty('ball', '⚽', '공당')}${duty('drink', '🥤', '물당')}</div>${closed ? `<button class="btn primary block hp-both" data-act="dutyboth" data-id="${sid}" ${spin ? 'disabled' : ''}>🎲 공당 → 물당 한 번에 확정</button>` : '<p class="hp-note">신청이 마감되면 확정할 수 있어요.</p>'}</section>`;
    // 참관자
    const vs = s.viewers || []; const pool = byName(Object.keys(S.players).filter(id => mstatus(S.players[id]) !== 'dormant' && !captainsOf(s).includes(id)));
    h += `<section class="hp-sec"><div class="hp-hd"><b>👀 드래프트 참관자</b><small>지정한 회원만 드래프트를 볼 수 있어요 · ${vs.length}명</small></div><div class="hp-card"><div class="dpick">${pool.map(id => `<button class="chip ${vs.includes(id) ? 'sel' : ''}" data-act="viewertog" data-id="${id}">${vs.includes(id) ? '👀 ' : ''}${esc(pname(id))}</button>`).join('')}</div></div></section>`;
  }
  h += `<p class="note">주장으로 지정된 회원은 로그인하면 오른쪽 위 👑 버튼으로 드래프트 방에 바로 들어와요. 드래프트는 ① 팀 색 선택 → ② 순번 정하기 → ③ 팀원 선택 순서로 진행해요.</p></div>`;
  if (S.admin) h += resetBar(s);
  return h;
}
/* ───────── draft room (board game) ───────── */
const LADDER_MS = 4200;
const CARD_REVEAL_MS = 2600;
function orderDecided(s) { return !!(s.ladder || s.cardgame?.doneAt) }
function roomPhase(s) {
  if (s.draftStatus === 'done') return 'done';
  if (!s.room?.open && s.draftStatus !== 'live') return 'closed';
  if (!allPicked(s)) return s.room?.colorOpen ? 'color' : 'lobby';
  if (s.cardgame && !s.cardgame.doneAt) return 'cards';
  if (s.cardgame?.doneAt && nowS() < s.cardgame.doneAt + CARD_REVEAL_MS) return 'cardsrev';
  if (!orderDecided(s)) return 'order';
  if (s.ladder && nowS() < s.ladder.at + LADDER_MS) return 'ladder';
  return s.draftStatus === 'live' ? 'draft' : 'order';
}
function joinedCount(s) { return KEYS.filter(k => s.room?.[k]?.in).length }
function makeLadder() {
  const rows = 9; const rungs = [];
  for (let r = 0; r < rows; r++) { const x = Math.random(); if (x < .4) rungs.push({ r, c: 0 }); else if (x < .8) rungs.push({ r, c: 1 }) }
  if (rungs.length < 4) return makeLadder();
  return { rows, rungs, at: nowS() };
}
function rungList(L) { return (L.rungs || []).map(g => Array.isArray(g) ? { r: g[0], c: g[1] } : g) }
function ladderPaths(L) { let RG;
  const X = [60, 170, 280], top = 34, bot = 206; const ry = r => top + (bot - top) * (r + 1) / (L.rows + 1);
  const res = []; for (let c0 = 0; c0 < 3; c0++) { let c = c0; const pts = [[X[c], top]];
    for (let r = 0; r < L.rows; r++) { const y = ry(r); const g0 = (RG ??= rungList(L)).find(x => x.r === r && (x.c === c || x.c === c - 1)); const g = g0 && [g0.r, g0.c];
      if (g) { pts.push([X[c], y]); c = g[1] === c ? c + 1 : c - 1; pts.push([X[c], y]) } }
    pts.push([X[c], bot]); res.push({ from: c0, to: c, pts }) }
  return { X, top, bot, ry, res };
}
function ladderOrder(L) { const { res } = ladderPaths(L); const o = []; res.forEach(p => o[p.to] = KEYS[p.from]); return o }
function ladderSVG(s) {
  const L = s.ladder; const P = ladderPaths(L); const el = nowS() - L.at; const done = el >= LADDER_MS;
  const cols = ['#FFD21F', '#6FD3FF', '#FF7A9A'];
  const len = pts => pts.reduce((a, p, i) => i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);
  let g = `<svg viewBox="0 0 340 250" class="ladder" role="img" aria-label="사다리 타기">`;
  P.X.forEach((x, i) => { const t = team(s, KEYS[i]); g += `<line x1="${x}" y1="${P.top}" x2="${x}" y2="${P.bot}" class="lg"/><rect x="${x - 36}" y="4" width="72" height="22" rx="6" fill="${t.color}" stroke="rgba(255,255,255,.8)"/><text x="${x}" y="20" class="lt" style="fill:${inkOn(t.color)}">${esc(t.name)}</text><text x="${x}" y="${P.bot + 30}" class="lb">${i + 1}번</text>` });
  rungList(L).forEach(({ r, c }) => { g += `<line x1="${P.X[c]}" y1="${P.ry(r)}" x2="${P.X[c + 1]}" y2="${P.ry(r)}" class="lg"/>` });
  P.res.forEach(p => { const l = len(p.pts); const off = done ? 0 : Math.max(0, l * (1 - el / LADDER_MS)); const tc = team(s, KEYS[p.from]).color;
    const anim = `stroke-dasharray:${l};stroke-dashoffset:${off};${done ? '' : `animation:ladder ${Math.max(0, LADDER_MS - el)}ms linear forwards`}`; const pts = p.pts.map(q => q.join(',')).join(' ');
    g += `<polyline points="${pts}" class="lp under" style="${anim}"/><polyline points="${pts}" class="lp" style="stroke:${tc};${anim}"/>` });
  return g + '</svg>';
}
function seatHTML(s, k, ph) {
  const cap = s.captains?.[k]; const t = team(s, k); const o = (s.order || []).indexOf(k); const inRoom = !!s.room?.[k]?.in;
  const turn = ph === 'draft' && !allIn(s) && (s.picks || []).length < draftTotal(s) && pickTeamAt(s, (s.picks || []).length) === k; const cturn = ph === 'color' && !t.picked && inRoom; const me = myTeam(s) === k;
  const ps = byName(teamPlayers(s, k).slice(1));
  return `<div class="seat ${t.picked ? 'picked' : ''} ${turn || cturn ? 'onturn' : ''} ${turn ? 'balltgt' : ''} ${me ? 'me' : ''} ${inkOn(t.color) === '#131C2B' ? 'light' : ''}" data-k="${k}" style="--tc:${t.color};--ti:${inkOn(t.color)}">
    ${bubbleFor(m => m.team === k)}
    <div class="sv2 shd"><div class="snm">${orderDecided(s) && o >= 0 && ph !== 'ladder' && ph !== 'cards' ? `<em class="ord2">${o + 1}</em>` : ''}<b>${esc(pname(cap) || '미정')}</b><i class="dot ${inRoom ? 'on' : ''}" title="${inRoom ? '입장' : '대기'}"></i>${me ? '<span class="meb">나</span>' : ''}</div>
      <div class="sinfo"><span class="tok">${esc(t.name)}</span><b class="cnt2">${cap ? ps.length + 1 : 0}<small>명</small></b></div></div>
    ${(() => { const mine = me || S.admin; const adm = S.admin; const pend = s.pending && s.pending.t === k ? s.pending.p : null; const last = (s.picks || []).slice(-1)[0]; const seen = (S.seenStk ??= new Set());
      const items = ps.map(id => { const key = s.date + ':' + id; const nw = !seen.has(key); seen.add(key); const can = adm && last && last.p === id && last.t === k;
        return can ? `<button class="jf mini vest ${nw ? 'new' : ''} ${can ? 'undo' : ''}" data-act="unpick" data-id="${id}" data-pid="${id}" title="${can ? '눌러서 선택 취소' : ''}">${figHTML(pname(id) + (can ? ' ✕' : ''))}</button>` : `<div class="jf mini vest ${nw ? 'new' : ''}" data-pid="${id}">${figHTML(pname(id))}</div>` });
      if (pend) items.push(mine ? `<button class="jf mini vest pendstk" data-act="unpick" data-id="${pend}" data-pid="${pend}">${figHTML(pname(pend) + ' ✕')}</button>` : `<div class="jf mini vest pendstk" data-pid="${pend}">${figHTML(pname(pend))}</div>`);
      return items.length ? `<div class="stk pfs-row">${items.join('')}</div>` : '' })()}
    ${me && !inRoom && ph !== 'done' ? `<button class="btn sm primary cta" data-act="joinroom" data-k="${k}">입장하기</button>` : ''}</div>`;
}
const BUBBLE_MS = 9000;
function bubbleFor(pred) { const now = Date.now(); for (let i = S.chat.length - 1; i >= 0; i--) { const m = S.chat[i]; if (now - (m.at || 0) > BUBBLE_MS) break; if (m.uid !== 'sys' && pred(m)) { const bk = m.id || (m.at + m.text); const nw = !(S.seenBub ??= new Set()).has(bk); S.seenBub.add(bk); return `<div class="bubble ${nw ? 'new' : ''}" role="status">${esc(m.text)}</div>` } } return '' }
function scheduleBubbles() { if (S.bubT) return; const now = Date.now(); const live = S.chat.filter(m => m.uid !== 'sys' && (m.team || m.admin) && now - (m.at || 0) < BUBBLE_MS); if (!live.length) return;
  const next = Math.min(...live.map(m => m.at + BUBBLE_MS - now)) + 50; S.bubT = setTimeout(() => { S.bubT = null; render() }, Math.max(100, next)) }
function recolorBtns(s, my) {
  if (orderDecided(s) || s.cardgame) return '';
  if (S.admin) { const ks = KEYS.filter(k => team(s, k).picked); return ks.length ? `<div class="admsel"><small>색 다시 고르기</small>${ks.map(k => `<button class="btn sm" data-act="recolor" data-k="${k}">${esc(team(s, k).name)} 해제</button>`).join('')}</div>` : '' }
  return my && team(s, my).picked ? `<button class="btn sm" data-act="recolor" data-k="${my}">↺ 우리 팀 색 다시 고르기</button>` : '';
}
function feltHTML(s, ph) {
  const my = myTeam(s);
  if (ph === 'closed') return `<div class="fx"><b>드래프트 방이 아직 열리지 않았어요</b><p>운영진이 방을 열면 입장할 수 있어요.</p></div>`;
  if (ph === 'lobby') { const n = joinedCount(s);
    return `<div class="fx"><div class="rnd">READY</div><div class="big">${n}<small>/3</small></div><b>${n < 3 ? '주장 입장을 기다리는 중' : '주장 3명이 모두 입장했어요'}</b><p>${S.admin ? '준비되면 색 선택을 시작해 주세요.' : '운영진이 색 선택을 시작하면 팀 색을 고를 수 있어요.'}</p>
      ${S.admin ? `<button class="btn primary" data-act="coloropen">색 선택 시작</button>` : ''}</div>` }
  if (ph === 'color') { const n = joinedCount(s); const can = S.admin ? !!S.adminTeam : (my && s.room?.[my]?.in && !team(s, my).picked);
    return `<div class="fx"><div class="rnd">STEP 1 · 팀 색 선택</div><b>${my && !s.room?.[my]?.in ? '입장하기를 누르면 팀 색을 고를 수 있어요' : my && team(s, my).picked ? '다른 주장들이 색을 고르는 중이에요' : my ? '우리 팀 색을 골라 주세요!' : '주장들이 팀 색을 고르는 중이에요'}</b><p>주장 입장 ${n}/3, 먼저 고른 팀이 그 색을 가져가요.</p>
      <div class="cswatch sm">${PALETTE.map(p => { const by = KEYS.find(o => s.teams?.[o]?.colorName === p.name);
        return `<button class="csw" style="background:${p.color};color:${inkOn(p.color)}" data-act="pickcolor" data-c="${p.name}" ${by || !can ? 'disabled' : ''}>${p.name}${by ? `<small>${by}팀</small>` : ''}</button>` }).join('')}</div>
      ${S.admin ? `<div class="admsel"><small>대신 고르기</small>${KEYS.filter(k => !team(s, k).picked).map(k => `<button class="btn sm${S.adminTeam === k ? ' primary' : ''}" data-act="adminteam" data-k="${k}">${k}팀</button>`).join('')}</div>` : ''}${recolorBtns(s, my)}</div>` }
  if (ph === 'order') { const n = joinedCount(s); const rc = recolorBtns(s, my);
    return `<div class="fx"><div class="rnd">STEP 2 · 순번 정하기</div><b>팀 색이 모두 정해졌어요!</b><p>${S.admin ? '순번 정하는 방법을 골라 주세요.' : '운영진이 순번 정하기를 시작하면 참여할 수 있어요.'}</p>${rc}
      ${S.admin ? `<div class="row" style="justify-content:center"><button class="btn primary" data-act="cardstart">🃏 카드 뽑기${n < 3 ? ` (입장 ${n}/3)` : ''}</button><button class="btn" data-act="ladder">사다리 타기</button></div>` : ''}</div>` }
  if (ph === 'cards') { const g = s.cardgame; const drawn = KEYS.filter(k => g.picks?.[k] != null).length; const my2 = S.admin ? S.adminTeam : my;
    const canDraw = my2 && g.picks?.[my2] == null && (S.admin || s.room?.[my2]?.in);
    return `<div class="fx"><div class="rnd">STEP 2 · 순번 카드 뽑기 ${drawn}/3</div><b>${my && g.picks?.[my] != null ? `${g.deck[g.picks[my]]}번 카드! 다른 주장을 기다리는 중` : my ? '카드를 한 장 골라 뒤집어 주세요!' : '주장들이 카드를 뽑는 중이에요'}</b>
      <div class="ocards">${[0, 1, 2].map(i => { const by = KEYS.find(k => g.picks?.[k] === i);
        if (by) { const t = team(s, by); const rk = s.date + ':oc' + i; const nw = !(S.seenStk ??= new Set()).has(rk); S.seenStk.add(rk); return `<div class="ocard up ${nw ? 'new' : ''}" style="--tc:${t.color};--ti:${inkOn(t.color)}"><em>${g.deck[i]}</em><small>${esc(t.name)}</small></div>` }
        return `<button class="ocard back" data-act="drawcard" data-i="${i}" ${canDraw ? '' : 'disabled'} aria-label="${i + 1}번째 카드 뽑기"><span>WF</span></button>` }).join('')}</div>
      ${S.admin ? `<div class="admsel"><small>대신 뽑기</small>${KEYS.filter(k => g.picks?.[k] == null).map(k => `<button class="btn sm${S.adminTeam === k ? ' primary' : ''}" data-act="adminteam" data-k="${k}">${esc(team(s, k).name)}</button>`).join('')}</div>` : ''}</div>` }
  if (ph === 'cardsrev') { if (!S.revT) S.revT = setTimeout(() => { S.revT = null; render() }, Math.max(50, s.cardgame.doneAt + CARD_REVEAL_MS - Date.now() + 60)); const g = s.cardgame;
    return `<div class="fx"><div class="rnd">STEP 2 · 순번 결정</div><div class="ocards">${(s.order || KEYS).map(k => { const t = team(s, k); return `<div class="ocard up big2" style="--tc:${t.color};--ti:${inkOn(t.color)}"><em>${g.deck[g.picks[k]]}</em><small>${esc(t.name)}</small></div>` }).join('')}</div><b>곧 팀원 선택을 시작해요!</b></div>` }
  if (ph === 'ladder') { if (!S.ladderT) S.ladderT = setTimeout(() => { S.ladderT = null; render() }, Math.max(50, s.ladder.at + LADDER_MS - Date.now() + 60)); return `<div class="fx"><div class="rnd">STEP 2 · 순번 정하기</div>${ladderSVG(s)}<p>순번을 정하는 중…</p></div>` }
  if (ph === 'draft' && allIn(s)) return `<div class="fx fx-allin"><div class="ai-ico">🏁</div><b>모든 선수 배치 완료!</b><div class="ai-sub">${S.admin ? '배치를 확인하고 확정하면 드래프트가 끝나요. 고칠 게 있으면 되돌리기를 눌러 주세요.' : '운영진이 확정하면 드래프트가 끝나요. 잠시만 기다려 주세요.'}</div>${S.admin ? '<button class="btn primary cta done-btn" data-act="finishdraft">✅ 드래프트 확정</button>' : '<div class="ai-wait">운영진 확정 대기 중…</div>'}</div>`;
  if (ph === 'draft') { const i = (s.picks || []).length, tot = draftTotal(s); const k = pickTeamAt(s, i); const pd = s.pending && s.pending.t === k ? s.pending.p : null;
    const from = Math.max(0, i - 3), to = Math.min(tot, from + 10);
    const flow = `<div class="flow2" aria-label="지명 순서 ${i + 1} / ${tot}">${from > 0 ? '<em>…</em>' : ''}${Array.from({ length: to - from }, (_, x) => { const j = from + x; const tt = team(s, pickTeamAt(s, j));
      return `<i class="${j < i ? 'past' : j === i ? 'cur' : ''}" style="--tc:${tt.color}" title="${j + 1}번째 · ${esc(tt.name)}">${j === i ? `<b>${j + 1}</b>` : ''}</i>` }).join('')}${to < tot ? '<em>…</em>' : ''}<small>${i + 1}/${tot}</small></div>`;
    return `<div class="fx fx-draft">${flow}
      ${S.poolHTML || ''}
      ${my === k || S.admin ? `<div class="row" style="justify-content:center"><button class="btn primary cta done-btn" data-act="nextturn" ${pd ? '' : 'disabled'}>${pd ? `${esc(pname(pd))} 선택 완료 ▶` : '선수를 고르세요'}</button></div>` : ''}</div>` }
  return `<div class="fx"><b>드래프트 완료! 🎉</b><p>팀원조정 단계에서 밸런스를 맞춰요.</p></div>`;
}
function vDraft(s) {
  const ph = roomPhase(s); const my = myTeam(s); const turnK = ph === 'draft' && pool(s).length ? pickTeamAt(s, (s.picks || []).length) : null;
  { const mine = !!my && turnK === my; if (mine && !S.wasMyTurn) { try { navigator.vibrate?.([120, 80, 120]) } catch { } toast('내 차례예요! 선수를 골라 주세요.') } S.wasMyTurn = mine }
  const canPick = ph === 'draft' && (S.admin || (my && my === turnK && s.room?.[my]?.in));
  if (S.admin && s.room?.open && !s.room?.admin?.in && !S.adminJoin?.[S.sid]) { (S.adminJoin ??= {})[S.sid] = 1; w(() => S.store.update(sp(S.sid), { 'room.admin': { in: true, name: S.me || '운영진', at: Date.now() } })) }
  let h = '';
  // (0.21.54) 상단 단계·주장 정보 바는 없앰 — 아래 영역을 여유롭게
  // top: applicant buttons
  const pk = {}; (s.picks || []).forEach((x, i) => pk[x.p] = { t: x.t, n: i + 1 }); const caps = captainsOf(s);
  const inTeam = new Set(KEYS.flatMap(k => teamPlayers(s, k))); const list = byName((s.applicants || []).filter(id => !caps.includes(id) && !pk[id] && !inTeam.has(id)));
  S.poolHTML = ph === 'draft' ? `<div class="pool"><div class="pool-hd">남은 선수 ${list.length}명 · ${canPick ? '눌러서 선택' : '내 차례에만 선택할 수 있어요'}</div><div class="namegrid">${list.map(id => { const pend = s.pending?.p === id; const pt = pend ? team(s, s.pending.t) : null;
    return `<button class="jf pfb ${pend ? 'pend vest' : ''}" ${pt ? `style="--tc:${pt.color};--ti:${inkOn(pt.color)}"` : ''} data-act="pick" data-id="${id}" ${canPick ? '' : 'disabled'}>${figHTML(pname(id))}</button>` }).join('')}</div></div>` : '';
  // middle: board
  const o = s.order && orderDecided(s) && ph !== 'ladder' && ph !== 'cards' ? s.order : KEYS; const [L, B, R] = o;
  const hIn = !!s.room?.admin?.in, hNm = s.room?.admin?.name && s.room.admin.name !== '운영진' ? s.room.admin.name : '', np = (s.picks || []).length;
  const hostH = `<div class="seat host hostbox ${hIn ? '' : 'off'}">${bubbleFor(m => m.admin)}<div class="hb-id"><span class="hb-av">운영</span><span class="hb-nm"><b>운영진${presAdmins().length > 1 ? ` ${presAdmins().length}명` : ''}</b>${(() => { const ns = presAdmins().filter(n => n !== '운영진'); const list = ns.length ? ns : hNm ? [hNm] : []; return list.length ? `<span class="hb-names">${list.map(n => `<i>${esc(n)}</i>`).join('')}</span>` : '' })()}</span><i class="dot ${hIn ? 'on' : ''}" title="${hIn ? '진행 중' : '대기 중'}"></i></div>
    ${S.admin && ph !== 'closed' ? `<div class="hb-act">${ph === 'draft' && allIn(s) ? '<button class="hbtn ok" data-act="finishdraft">✅ 확정</button>' : ''}${ph === 'draft' && np ? '<button class="hbtn undo" data-act="undo">↶ 되돌리기</button>' : ''}${ph === 'draft' && !np ? '<button class="hbtn" data-act="ordedit">✎ 순번 바꾸기</button>' : ''}<button class="hbtn more" data-act="roommenu" aria-label="진행 메뉴">⋯ 메뉴</button></div>` : `<span class="hb-st">${hIn ? '진행 중' : '대기 중'}</span>`}</div>`;
  h += S.dm ? `<div class="board-table dmbt">${hostH}<div class="felt">${feltHTML(s, ph)}</div><div class="seatrow"><div class="pos-l">${seatHTML(s, L, ph)}</div><div class="pos-b">${seatHTML(s, B, ph)}</div><div class="pos-r">${seatHTML(s, R, ph)}</div></div></div>`
    : `<h2>드래프트 테이블</h2><div class="board-table">${hostH}
    <div class="pos-l">${seatHTML(s, L, ph)}</div><div class="felt">${feltHTML(s, ph)}</div><div class="pos-r">${seatHTML(s, R, ph)}</div><div class="pos-b">${seatHTML(s, B, ph)}</div></div>`;
  if ((S.chatSeen ??= {})[S.sid] === undefined && S.chatSid === S.sid && S.chat.length) S.chatSeen[S.sid] = S.chat.length;
  // bottom: chat
  h += chatPanel(true);
  return h;
}
async function redoDraft() { const s = cur(); if (!s) return; if (sessMatches(s.date).some(m => m.status !== 'pending')) { toast('이미 진행된 경기가 있어서 드래프트를 다시 할 수 없어요.'); return }
  if (!confirm('드래프트를 다시 할까요?\n주장과 팀 색은 그대로 두고, 순번 정하기부터 팀원 선택까지 다시 해요. 지금 팀 구성은 지워져요.')) return;
  const teams = Object.fromEntries(KEYS.map(k => [k, { ...(s.teams?.[k] || {}), players: [] }]));
  const ok = await w(() => S.store.update(sp(S.sid), { stage: 'draft', draftStatus: 'ready', picks: [], pending: null, ladder: null, cardgame: null, order: [...KEYS], teams,
    room: { open: true, A: { in: false }, B: { in: false }, C: { in: false }, admin: { in: true, name: S.me || '운영진', at: Date.now() } } }));
  if (ok) { sysChat('드래프트를 다시 해요. 주장님들 다시 입장해 주세요! 순번부터 새로 정해요.'); toast('드래프트를 다시 시작했어요.'); S.step = 'draft'; render(); window.scrollTo(0, 0) } }
async function openRoom() {
  const s = cur(); if (KEYS.some(k => !s.captains?.[k])) { toast('주장 3명을 먼저 정하세요.'); return }
  const tokens = { ...(s.captainTokens || {}) }; KEYS.forEach(k => { if (!tokens[k]) tokens[k] = rand() });
  const ok = await w(() => S.store.update(sp(S.sid), { stage: 'draft', draftStatus: 'ready', picks: [], pending: null, ladder: null, cardgame: null, order: [...KEYS], captainTokens: tokens,
    room: { open: true, A: { in: false }, B: { in: false }, C: { in: false }, admin: { in: true, name: S.me || '운영진', at: Date.now() } }, teams: Object.fromEntries(KEYS.map(k => [k, { players: [], colorName: null }])) }));
  if (ok) { sysChat('드래프트 방이 열렸어요. 주장님들 입장해 주세요!'); S.step = 'draft'; render() }
}
async function joinRoom(k) { const s = cur(); if (myTeam(s) !== k) return; if (await w(() => S.store.update(sp(S.sid), { [`room.${k}`]: { in: true, at: Date.now() } }))) sysChat(`👑 ${pname(s.captains[k])} 주장 입장`) }
async function leaveRoom() {
  const s = cur(); const k = myTeam(s);
  if (k && s.room?.[k]?.in) { await w(() => S.store.update(sp(S.sid), { [`room.${k}`]: { in: false, at: Date.now() } })); sysChat(`${pname(s.captains[k])} 주장이 나갔어요`) }
  if (S.admin && s.room?.admin?.in) { await w(() => S.store.update(sp(S.sid), { 'room.admin': { in: false, at: Date.now() } })); if (S.adminJoin) delete S.adminJoin[S.sid] }
  if (S.admin) { S.step = 'captain' } else { S.tab = 'mhome'; S.sub = null } render(); window.scrollTo(0, 0);
}
async function startCards() {
  const s = cur(); if (!allPicked(s)) { toast('팀 색을 먼저 모두 정해 주세요.'); return }
  if (joinedCount(s) < 3 && !confirm('아직 모든 주장이 입장하지 않았어요. 그래도 카드 뽑기를 시작할까요?')) return;
  const deck = [1, 2, 3]; for (let i = 2; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]] }
  if (await w(() => S.store.update(sp(S.sid), { cardgame: { deck, picks: { A: null, B: null, C: null }, at: Date.now(), doneAt: null }, ladder: null, draftStatus: 'ready', picks: [], pending: null })))
    sysChat('순번 카드 뽑기! 각 주장님이 카드를 한 장씩 골라 주세요. 숫자가 작을수록 먼저 뽑아요.');
}
async function drawCard(i) {
  const s = cur(); const k = S.admin ? S.adminTeam : myTeam(s);
  if (!k) { toast(S.admin ? '먼저 어느 팀 대신 뽑을지 고르세요.' : '주장만 뽑을 수 있어요.'); return }
  if (!S.admin && !s.room?.[k]?.in) { toast('먼저 입장해 주세요.'); return }
  let got = null, order = null;
  const ok = await w(() => S.store.txn(sp(S.sid), d => { const g = d?.cardgame; if (!g || g.doneAt) return null; g.picks = g.picks || {};
    if (g.picks[k] != null || Object.values(g.picks).includes(i)) return null; g.picks[k] = i; got = g.deck[i];
    if (KEYS.every(t => g.picks[t] != null)) { order = [...KEYS].sort((a, b) => g.deck[g.picks[a]] - g.deck[g.picks[b]]); d.order = order; g.doneAt = nowS(); d.draftStatus = 'live'; d.picks = []; d.pending = null }
    d.cardgame = g; return d }));
  if (!ok) { if (String(S.lastErr?.message || 'aborted') === 'aborted') toast('이미 뽑힌 카드예요. 다른 카드를 골라 주세요.'); return }
  S.adminTeam = null; sysChat(`${team(s, k).name}(${pname(s.captains[k])}) ${got}번 카드!`);
  if (order) sysChat(`순번 결정: ${order.map((t, n) => `${n + 1}번 ${team(s, t).name}`).join(', ')}. 1순위부터 팀원을 골라요!`);
}
async function resetOrder() {
  const s = cur(); if ((s.picks || []).length) { toast('이미 지명이 시작돼서 순번을 다시 정할 수 없어요.'); return }
  if (await w(() => S.store.update(sp(S.sid), { ladder: null, cardgame: null, draftStatus: 'ready', order: [...KEYS], picks: [], pending: null }))) sysChat('순번을 다시 정해요.');
}
async function runLadder() {
  const s = cur(); if (!allPicked(s)) { toast('팀 색을 먼저 모두 정해 주세요.'); return }
  if (joinedCount(s) < 3 && !confirm('아직 모든 주장이 입장하지 않았어요. 그래도 사다리를 탈까요?')) return;
  const L = makeLadder(); const order = ladderOrder(L);
  if (await w(() => S.store.update(sp(S.sid), { ladder: L, order, cardgame: null, draftStatus: 'live', picks: [], pending: null }))) {
    setTimeout(() => sysChat(`사다리 결과: ${order.map((k, i) => `${i + 1}번 ${team(s, k).name}(${pname(s.captains[k])})`).join(', ')}. 1순위부터 팀원을 골라요!`), LADDER_MS) }
}
async function setPending(pid) {
  const s = cur(); const k = pickTeamAt(s, (s.picks || []).length);
  if (!(S.admin || (myTeam(s) === k && s.room?.[k]?.in))) { toast('내 차례에만 고를 수 있어요.'); return }
  await w(() => S.store.txn(sp(S.sid), d => { if (!d || d.draftStatus !== 'live') return null; if (pickTeamAt(d, (d.picks || []).length) !== k || !pool(d).includes(pid)) return null; d.pending = { t: k, p: pid, at: Date.now() }; return d }));
}
async function nextTurn() {
  const s = cur(); if (!s.pending) return; let info = null, done = false;
  const ok = await w(() => S.store.txn(sp(S.sid), d => { if (!d || d.draftStatus !== 'live' || !d.pending) return null; const k = pickTeamAt(d, (d.picks || []).length);
    if (d.pending.t !== k || !pool(d).includes(d.pending.p)) return null; info = { ...d.pending, n: (d.picks || []).length + 1 };
    d.picks = [...(d.picks || []), { t: k, p: d.pending.p, at: Date.now() }]; d.pending = null;
    if (!pool(d).length) done = true; // 마지막 선수까지 배치돼도 자동 종료하지 않고 운영진 확정을 기다림
    return d }));
  if (ok && info) { sysChat(`${info.n}순위 ${team(s, info.t).name}: ${pname(info.p)}`); if (done) sysChat('모든 선수 배치 완료! 운영진이 확정하면 드래프트가 끝나요.') }
}
function allIn(s) { return !!s && s.draftStatus === 'live' && (s.picks || []).length > 0 && !pool(s).length && !s.pending }
async function finishDraft() { if (!needAdmin()) return; const s = cur(); if (!allIn(s)) { toast('아직 배치되지 않은 선수가 있어요.'); return }
  if (!confirm('이 팀 구성으로 드래프트를 확정할까요?\n확정하면 팀원조정 단계로 넘어가요.')) return;
  const ok = await w(() => S.store.txn(sp(S.sid), d => { if (!d || d.draftStatus !== 'live' || pool(d).length || d.pending) return null; d.draftStatus = 'done'; d.stage = 'trade'; d.teams = d.teams || {};
    KEYS.forEach(t => { d.teams[t] = { ...(d.teams[t] || {}), players: [d.captains[t], ...(d.picks || []).filter(x => x.t === t).map(x => x.p)] } }); return d }));
  if (ok) { sysChat('드래프트 완료! 🎉'); toast('드래프트를 확정했어요.') } }

function myUid() { return load('uid', null) || (() => { const u = Math.random().toString(36).slice(2, 10); save('uid', u); return u })() }
function chatMsgs() { const uid = myUid();
  return `<div class="msgs" aria-live="polite">${S.chat.length ? S.chat.map(m => m.uid === 'sys' ? `<div class="msg sys"><div class="b">${esc(m.text)}</div></div>` :
    `<div class="msg ${m.uid === uid ? 'me' : ''}"><div class="n">${m.team ? '👑 ' : m.admin ? '🛡️ ' : ''}${esc(m.name)}${m.team ? ` (${esc(team(cur(), m.team).name)} 주장)` : m.admin && m.name !== '운영진' ? ' (운영진)' : ''}<time>${new Date(m.at).toTimeString().slice(0, 5)}</time></div><div class="b">${esc(m.text)}</div></div>`).join('') : '<p class="empty">아직 메시지가 없어요.</p>'}</div>` }
function chatLines() {
  const uid = myUid(); const c = cur(); const list = S.chat.slice(-60);
  if (!list.length) return '<p class="cl-empty">아직 메시지가 없어요. 첫 메시지를 남겨 보세요.</p>';
  return list.map(m => { if (m.uid === 'sys') return `<div class="cl sys">${esc(m.text)}</div>`;
    const t = m.team ? team(c, m.team) : null; const who = m.team ? `${esc(m.name)}` : m.admin ? `운영진${m.name && m.name !== '운영진' ? ' ' + esc(m.name) : ''}` : esc(m.name);
    return `<div class="cl ${m.uid === uid ? 'me' : ''}"><b ${t ? `style="--tc:${t.color};--ti:${inkOn(t.color)}" class="tm"` : m.admin ? 'class="ad"' : ''}>${who}</b><span>${esc(m.text)}</span><time>${new Date(m.at).toTimeString().slice(0, 5)}</time></div>` }).join('');
}
function chatPanel(room, nolog) {
  const me = S.me; const mk = myTeam(cur());
  const ph = mk ? esc(pname(cur().captains[mk])) + ' 주장으로 보내기' : S.admin ? '운영진으로 보내기' : me ? esc(me) + '(으)로 보내기' : '메시지 (처음엔 이름을 물어봐요)';
  if (!S.admin && !mk && quietView()) return `<div class="chatdock${nolog ? ' nolog' : ''}"><div class="cd-log msgs" aria-live="polite" aria-label="최근 채팅">${chatLines()}</div><div class="cd-bar"><button type="button" class="btn cd-ic" data-act="chatlog" aria-label="메시지 전체 내역">💬</button><span class="cd-ro">보기 전용이에요</span></div></div><div class="chatdock-space"></div>`;
  return `<div class="chatdock${nolog ? ' nolog' : ''}"><div class="cd-log msgs" aria-live="polite" aria-label="최근 채팅">${chatLines()}</div>
    <form data-form="chat" class="cd-bar"><button type="button" class="btn cd-ic" data-act="chatlog" aria-label="메시지 전체 내역">💬</button><label class="sr" for="chatin">메시지</label><input id="chatin" class="inp" type="text" placeholder="${ph}" maxlength="300" autocomplete="off" enterkeyhint="send"><button class="btn primary" type="submit">보내기</button>${room ? '<button type="button" class="btn cd-out" data-act="leaveroom">나가기</button>' : ''}</form></div><div class="chatdock-space"></div>`;
}
function vTrade(s) {
  const ad = S.admin && s.draftStatus === 'done'; const my = myTeam(s);
  let h = s.draftStatus !== 'done' ? `<div class="notice">드래프트가 끝나면 팀 구성을 볼 수 있어요.</div>` : '';
  h += `<div class="tradehd"><b>밸런스 조정</b><small>${ad ? '선수 한 명을 누르고 다른 팀 선수를 누르면 맞바꿔요. 팀 색 이름을 누르면 색을 바꿀 수 있어요.' : my ? '팀 색 이름을 누르면 우리 팀 색을 바꿀 수 있어요. 운영진이 밸런스를 조정하는 중이에요.' : '운영진이 팀 밸런스를 조정하는 중이에요.'}</small></div>`;
  h += `<div class="tradehost">${bubbleFor(m => m.admin)}<span class="av on hostav">운영</span><b>운영진</b></div>`;
  h += `<div class="tcards">${KEYS.map(k => { const t = team(s, k); const ps = teamPlayers(s, k); const canC = S.admin || my === k;
    return `<div class="tcard ${my === k ? 'me' : ''}" style="--tc:${t.color};--ti:${inkOn(t.color)}">${bubbleFor(m => m.team === k)}
      <button class="tchd" data-act="${canC ? 'colorpick' : 'noop'}" data-k="${k}" ${canC ? '' : 'tabindex="-1"'}><span>${esc(t.name)}</span>${canC ? '<i>색 변경 ▾</i>' : ''}<small>${ps.length}명</small></button>
      <ol>${ps.map((id, j) => j === 0 ? `<li class="cap"><em>C</em><span>${esc(pname(id))}</span></li>`
        : `<li class="${S.sel === id ? 'swap' : ''}">${ad ? `<button data-act="selswap" data-id="${id}"><span>${esc(pname(id))}</span></button>` : `<span>${esc(pname(id))}</span>`}</li>`).join('')}</ol></div>` }).join('')}</div>`;
  if (ad) h += `<div class="row" style="margin-top:14px"><button class="btn" data-act="goposter" data-id="${s.date}" ${allPicked(s) ? '' : 'disabled'}>👥 팀 공지 이미지 (공지 메뉴)</button><button class="btn primary" data-act="mkmatches" ${allPicked(s) ? '' : 'disabled'}>${sessMatches(s.date).length ? '경기진행으로 →' : '팀 확정하고 경기 일정 만들기 →'}</button></div>`;
  h += chatPanel(!!(my || S.admin), S.dm);
  if (ad) h += `<div class="panel pad redobar"><div><b>↺ 드래프트 다시하기</b><p class="note" style="margin:4px 0 0">주장과 팀 색은 그대로 두고, 순번 정하기부터 팀원 선택까지 다시 해요. 지금 팀 구성은 지워져요.</p></div><button class="btn primary" data-act="redodraft">드래프트 다시하기</button></div>`;
  if (S.admin) h += resetBar(s);
  return h;
}
function vNotice(s, inMenu) {
  const ad = S.admin; const img = S.poster[S.sid]; const ready = allPicked(s);
  const form = ad ? `<h2>포스터에 들어갈 내용<small>입력하면 바로 반영돼요</small></h2><div class="panel pad pform">
    <div class="field"><label for="f-ev">🔒 엘리베이터(E/V) 비밀번호</label><input id="f-ev" class="inp" type="text" inputmode="text" maxlength="20" placeholder="예: 1234*" value="${esc(s.evpw || '')}" data-in="sfield" data-f="evpw"></div>
    <div class="field"><label for="f-nt">📢 공지사항 <small class="muted">최대 3줄 · { }로 감싼 글자는 강조색</small></label><textarea id="f-nt" class="inp" rows="3" maxlength="120" placeholder="예: {조끼 지참} 부탁드려요\n주차는 B2 이용" data-in="sfield" data-f="notice">${esc(s.notice || '')}</textarea></div></div>` : '';
  if (!ready) return form + `<div class="notice warn" style="margin-top:12px">아직 팀 색을 고르지 않은 팀이 있어요. 팀 색이 정해지면 포스터가 만들어져요. 위 내용은 미리 입력해 둘 수 있어요.</div>`;
  if (!img) queueMicrotask(refreshPoster);
  const picker = ad ? designPanel('team', S.sid, teamDesign(s)) : '';
  if (ad) queueMicrotask(() => fillThumbs('team', S.sid));
  let h = `<div class="dgrid"><section>${form}${picker}</section><section><h2>포스터 미리보기</h2><img class="poster" alt="매치데이 공지 이미지 미리보기" src="${img || ''}" width="1086" height="1448">
  <div class="row" style="margin-top:10px"><button class="btn primary" data-act="share">공유하기</button><button class="btn" data-act="download">이미지 저장</button></div>
  <button class="btn block" style="margin-top:8px" data-act="copytext">공지 텍스트 복사</button>`;
  if (ad && !inMenu) h += sessMatches(s.date).length ? `<div style="height:14px"></div><button class="btn block" data-act="gorun" data-id="${s.date}" data-step="match">경기 진행 화면으로</button>` : `<div style="height:14px"></div><button class="btn primary block" data-act="mkmatches">경기 일정 만들기 (9경기)</button>`;
  return h + '</section></div>';
}
function pairSheet() { const s = cur(); const ms = s ? sessMatches(s.date) : []; const D = S.pairDraft || {};
  const opt = (sel, mid, side) => `<select class="inp" data-in="pairsel" data-id="${mid}" data-side="${side}" aria-label="${side === 'h' ? '왼쪽' : '오른쪽'} 팀">${KEYS.map(k => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(team(s, k).name)}</option>`).join('')}</select>`;
  return `<h4>1~9경기 대진 변경</h4><p>경기마다 맞붙는 두 팀을 골라요. 좌우만 바꾸면 골 기록은 그대로예요. 끝난 경기에서 한 팀을 다른 팀으로 바꾸면, 빠진 팀의 골 기록이 새로 들어온 팀으로 옮겨져서 점수는 그대로 유지돼요.</p><div class="pairlist">${ms.map(m => { const [hh, aa] = D[m.id] || [m.home, m.away]; const bad = hh === aa; const ch = hh !== m.home || aa !== m.away; const [a, b] = (() => { const [x, y] = score(m); return hh === m.away && aa === m.home ? [y, x] : [x, y] })();
    return `<div class="pairrow${bad ? ' bad' : ''}${ch ? ' ch' : ''}"><b class="pn">${m.n}경기<small>${m.status === 'done' ? `종료 ${a}:${b}` : m.status === 'live' ? '진행 중' : `${m.round}R`}</small></b>${bib(team(s, hh).color)}${opt(hh, m.id, 'h')}<button class="btn sm" data-act="pairswap" data-id="${m.id}" aria-label="좌우 바꾸기">⇄</button>${opt(aa, m.id, 'a')}${bib(team(s, aa).color)}</div>` }).join('')}</div>
    <div class="row" style="margin-top:12px"><button class="btn primary cta" data-act="pairsave">변경 저장</button></div>` }
async function pairSave() { const s = cur(); const ms = sessMatches(s.date); const D = S.pairDraft || {};
  const ch = ms.filter(m => D[m.id] && (D[m.id][0] !== m.home || D[m.id][1] !== m.away));
  if (!ch.length) { S.sheet = null; S.pairDraft = null; render(); return }
  const bad = ch.find(m => D[m.id][0] === D[m.id][1]); if (bad) { toast(`${bad.n}경기는 같은 팀끼리 붙을 수 없어요.`); return }
  const started = ch.filter(m => m.status !== 'pending'); if (started.length && !confirm(`${started.map(m => m.n + '경기').join(', ')}는 이미 진행됐거나 끝난 경기예요. 대진을 바꾸고 골 기록도 바뀐 팀으로 옮길까요?`)) return;
  const ok = await w(async () => { for (const m of ch) { const [nh, na] = D[m.id]; const nw = [nh, na], od = [m.home, m.away]; const add = nw.find(t => !od.includes(t)); const map = Object.fromEntries(od.map(t => [t, nw.includes(t) ? t : add])); // 남은 팀은 골 유지, 빠진 팀의 골만 새 팀으로
    await withTimeout(S.store.update(mp(m.id), { home: nh, away: na }), 10000);
    for (const e of evsOf(m.id)) if (map[e.team] && map[e.team] !== e.team) await withTimeout(S.store.update('events/' + e.id, { team: map[e.team] }), 10000) } });
  if (ok) { S.sheet = null; S.pairDraft = null; toast(`${ch.map(m => m.n + '경기').join(', ')} 대진을 바꿨어요.`); render() } }
function vMatchDay(s) {
  const ms = sessMatches(S.sid); if (!ms.length) return `<div class="notice">아직 경기 일정이 없어요. ${S.admin ? '<button class="btn sm primary" data-act="mkmatches">9경기 일정 만들기</button>' : ''}</div>`;
  const done = ms.filter(m => m.status === 'done').length; const T = timing(s);
  let h = `<p class="note" style="margin-top:12px">전반 ${T.h1 / 60}분, GK 교체 ${T.gk}초, 후반 ${T.h2 / 60}분, 휴식 ${T.rest / 60}분</p>`;
  const live = ms.filter(m => m.status === 'live'); const nx = live.length ? live : ms.filter(m => m.status === 'pending').slice(0, 1);
  if (nx.length) h += `<h2>${live.length ? '<span class="dot"></span> 지금 경기' : '다음 경기'}</h2>${nx.map(m => { const [a, b] = score(m);
    return `<button class="live" data-act="open" data-id="${m.id}"><span class="ph" data-phase="${m.id}"></span><span class="sc">${bib(team(s, m.home).color)}<span class="n">${esc(team(s, m.home).name)}</span><b>${a}</b>:<b>${b}</b><span class="n">${esc(team(s, m.away).name)}</span>${bib(team(s, m.away).color)}</span><span class="tm" data-clock="${m.id}"></span></button>` }).join('')}`;
  h += `<h2>순위${done === 9 ? '<span class="final">최종</span>' : `<small>${done}/9경기 반영</small>`}</h2><div class="panel tblwrap"><table><thead><tr><th>순위</th><th class="l">팀</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>득</th><th>실</th><th>득실</th><th>승점</th></tr></thead><tbody>
  ${standings(S.sid).map(r => { const t = team(s, r.k); return `<tr><td class="rank">${r.p ? r.rank : '-'}</td><td class="l"><span class="teamcell">${bib(t.color)}${esc(t.name)}</span></td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}</td><td>${r.ga}</td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td><td class="pts">${r.pts}</td></tr>` }).join('')}</tbody></table></div>
  <p class="note">승 3점, 무 1점. 승점이 같으면 골득실, 다득점, 승자승 순.</p>`;
  let sch = `<h2>경기 일정</h2>`;
  for (let r = 1; r <= 3; r++) sch += `<div class="round"><h3>${r}라운드</h3><div class="panel">${ms.filter(m => m.round === r).map(m => { const H = team(s, m.home), A = team(s, m.away); const [a, b] = score(m); const win = m.status === 'done' ? (a > b ? 'win-h' : a < b ? 'win-a' : '') : '';
    return `<button class="mrow ${m.status === 'live' ? 'is-live' : ''} ${win}" data-act="open" data-id="${m.id}"><span class="side">${bib(H.color)}<span>${esc(H.name)}</span></span><span class="mid"><span class="sc">${m.status === 'pending' ? 'vs' : a + ' : ' + b}</span><span class="st">${m.status === 'done' ? '종료' : `<span data-phase="${m.id}"></span>${m.status === 'live' ? ` <span data-clock="${m.id}"></span>` : ''}`}</span></span><span class="side r"><span>${esc(A.name)}</span>${bib(A.color)}</span></button>` }).join('')}</div></div>`;
  if (S.admin) { const st = (key, lab, val, unit) => `<div class="stepper"><button data-act="tstep" data-key="${key}" data-d="-1" aria-label="${lab} 줄이기">−</button><span><small>${lab}</small>${val}${unit}</span><button data-act="tstep" data-key="${key}" data-d="1" aria-label="${lab} 늘리기">+</button></div>`;
    sch += `<h2>경기 시간 설정</h2><div class="grid2">${st('h1', '전반', T.h1 / 60, '분')}${st('gk', 'GK 교체', T.gk, '초')}${st('h2', '후반', T.h2 / 60, '분')}${st('rest', '쉬는 시간', T.rest / 60, '분')}</div>
    <h2>관리</h2><button class="btn primary block" data-act="pairedit" style="margin-bottom:8px">⇄ 1~9경기 대진 변경</button><button class="btn danger block" data-act="delmatches">경기 대진(1~9경기) 삭제</button><p class="note">경기 일정(대진표)과 경기 기록만 지워요. 신청자, 팀 구성, 공지는 그대로 남고, 다시 "경기 일정 만들기"로 새 대진을 만들 수 있어요. 경기일 자체 삭제는 경기관리 메뉴에서 해요.</p>` }
  return `<div class="dgrid"><section>${h}</section><section>${sch}</section></div>`;
}
function viewMatch() {
  const m = M(S.openMatch); const s = S.sessions[m.session]; if (!s) return ''; const H = team(s, m.home), A = team(s, m.away); const [a, b] = score(m); const run = !!m.timer?.running; const T = timing(s);
  const next = sessMatches(m.session).find(x => x.n > m.n && x.status !== 'done'); const can = S.admin;
  let h = `<div class="overlay" role="dialog" aria-label="${m.round}라운드 ${m.slot}경기"><div class="wrap"><div class="obar"><button class="btn sm" data-act="close">← 목록</button><span class="muted">${m.round}라운드 ${m.slot}경기</span></div>
  <div class="dgrid ovgrid"><section><div class="board"><div class="teams"><div class="t"><div class="bar" style="background:${H.color}"></div><div class="num">${a}</div><div class="nm">${esc(H.name)}</div></div><div class="colon">:</div><div class="t"><div class="bar" style="background:${A.color}"></div><div class="num">${b}</div><div class="nm">${esc(A.name)}</div></div></div>
  <div class="phase" data-phase="${m.id}"></div><div class="clock" data-bigclock="${m.id}"></div>
  <div class="prog" style="grid-template-columns:${T.h1}fr ${Math.max(T.gk, T.h1 / 20)}fr ${T.h2}fr" aria-hidden="true"><span class="seg"><i data-seg="${m.id}:0"></i></span><span class="seg"><i data-seg="${m.id}:1"></i></span><span class="seg"><i data-seg="${m.id}:2"></i></span></div></div>`;
  if (can) {
    if (m.status !== 'done') h += `<div class="goalbtns"><button class="goalbtn" style="background:${H.color};color:${inkOn(H.color)}" data-act="goal" data-team="${m.home}">+ 골<small>${esc(H.name)}</small></button><button class="goalbtn" style="background:${A.color};color:${inkOn(A.color)}" data-act="goal" data-team="${m.away}">+ 골<small>${esc(A.name)}</small></button></div>`;
    h += `<div class="row ctrl">`;
    if (m.status !== 'done') { h += run ? `<button class="btn" data-act="pause">일시정지</button>` : `<button class="btn primary" data-act="start">${m.status === 'pending' ? '휘슬, 경기 시작' : '다시 시작'}</button>`;
      h += `<button class="btn" data-act="reset" ${elapsed(m) < 1 ? 'disabled' : ''}>초기화</button></div><div class="row ctrl"><button class="btn block" data-act="end" ${m.status === 'pending' ? 'disabled' : ''}>경기 종료, 순위 반영</button>` }
    else { h += `<button class="btn" data-act="reopen">종료 취소</button>`; if (next) h += `<button class="btn primary" data-act="open" data-id="${next.id}">다음 경기</button>` }
    h += '</div>' } else h += `<p class="note">기록은 운영진 모드에서 할 수 있어요.</p>`;
  const evs = evsOf(m.id).reverse();
  h += `</section><section><h2>골 기록</h2><div class="panel">${evs.length ? evs.map(e => { const t = team(s, e.team); const second = e.half === 'h2' || e.half === 'full' || e.sec >= T.h1 + T.gk; const mn = second ? Math.floor((e.sec - T.h1 - T.gk) / 60) + 1 : Math.floor(e.sec / 60) + 1;
    return `<div class="ev"><span class="min">${second ? '후' : '전'} ${Math.max(1, mn)}'</span>${bib(t.color)}<span class="who"><b>${e.scorer ? esc(pname(e.scorer)) : esc(t.name) + ' 골'}</b>${e.scorer ? `<small>${e.og ? esc(t.name) + ' 득점 · 자책골' : esc(t.name)}</small>` : ''}${e.assist ? `<small>도움 ${esc(pname(e.assist))}</small>` : ''}</span>${can ? `<button class="x" data-act="delev" data-id="${e.id}" aria-label="골 기록 삭제">×</button>` : ''}</div>` }).join('') : '<p class="empty">골이 나면 위의 팀 버튼을 누르세요.</p>'}</div></section></div></div></div>`;
  return h;
}
function viewSheet() {
  const sh = S.sheet; let h = `<div class="scrim" data-act="closesheet"><div class="sheet" role="dialog" aria-modal="true" data-stop><div class="grab"></div>`;
  if (sh.type === 'adminpin') h += `<h4>운영모드</h4><p>운영진 비밀번호를 입력하세요.</p><div class="panel"><div class="field"><label for="ap-pin">비밀번호</label><input id="ap-pin" class="inp pin" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="••••"></div></div><div class="row" style="margin-top:12px"><button class="btn primary cta" data-act="adminpinok">운영모드 들어가기</button></div>`;
  else if (sh.type === 'cappop') { const s = S.sessions[sh.sid]; const k = myTeam(s);
    h += `<div class="cappop"><div class="cp-crown">👑</div><h4>${esc(pname(myPid()))} 님, 주장으로 지정됐어요!</h4><p>${fmtDate(sh.sid)} ${esc(s.time || '')} 경기의 <b>${esc(team(s, k).name)}</b> 주장이에요.<br>${s.room?.open ? '드래프트 방이 열렸어요. 지금 입장해 주세요.' : '운영진이 드래프트 방을 열면 팀원을 선정해요.'}</p><button class="btn primary block cta" data-act="gocap" data-id="${sh.sid}">팀 선정 화면으로 가기</button></div>` }
  else if (sh.type === 'import') h += importSheet();
  else if (sh.type === 'attimp') h += attImpSheet();
  else if (sh.type === 'attp') h += attPersonSheet(sh.id);
  else if (sh.type === 'duty') h += dutySheet(sh.sid);
  else if (sh.type === 'park') h += parkSheet(sh.sid);
  else if (sh.type === 'parkapply') { h += `<h4>🚗 주차 신청</h4><p>${fmtDate(sh.sid)} 경기 주차를 신청해요. 신청자 중 ${PARK_SLOTS}명을 추첨해요.</p><div class="panel"><div class="field"><label for="pk-car2">차량번호</label><input id="pk-car2" class="inp" type="text" maxlength="12" placeholder="예: 12가3456" value="${esc(myCar())}"></div><p class="note" style="margin:6px 0 0">내 정보에 차량번호를 저장해 두면 자동으로 채워져요.</p></div><div class="row" style="margin-top:12px"><button class="btn primary" data-act="parksave">신청</button></div>` }
  else if (sh.type === 'tier') h += tierSheet(sh);
  else if (sh.type === 'calpick') h += `<h4>📅 캘린더에 추가</h4><p>${fmtDate(sh.id)} ${esc(S.sessions[sh.id]?.time || '')} 경기를 내 캘린더에 넣어요. 경기 2시간 전에 알림이 와요.</p><div class="pick" style="grid-template-columns:1fr"><button data-act="calics" data-id="${sh.id}">🍎 아이폰·기본 캘린더 (일정 파일)</button><button data-act="calgoo" data-id="${sh.id}">📆 구글 캘린더</button></div>`;
  else if (sh.type === 'inbox') h += inboxSheet();
  else if (sh.type === 'rule') h += ruleSheet();
  else if (sh.type === 'kakao') { const L = S.kk || null;
    h += `<h4>📋 카톡 투표 명단 반영</h4>${S.ocrBusy ? `<div class="ocrbox"><div class="ocrspin"></div><b>${S.ocrMsg || '글자 읽는 중…'}</b><small>처음 한 번은 한글 인식 데이터를 받느라 조금 걸려요.</small></div>` : !L ? `<p>카톡 투표 <b>참여자 목록 화면</b>을 캡처해서 올려 주세요. 스크롤해서 여러 장이면 <b>위에서부터 순서대로</b> 모두 골라 주세요. 겹치는 이름은 한 번만 읽어요.</p>
      <label class="btn primary block" style="cursor:pointer">📷 캡처 이미지 올리기 (여러 장 가능)<input type="file" accept="image/*" multiple data-in="kkimg" hidden></label>
      <details class="kk-alt"><summary>글자로 붙여넣기</summary><textarea id="kk-text" class="inp" rows="6" placeholder="예)\n김민혁\n이도형\n안준영"></textarea><button class="btn block" style="margin-top:8px" data-act="kakaoparse">이름 확인하기</button></details>`
      : `<p>${L.filter(x => x.use).length}명을 이 순서대로 맨 앞에 놓아요. 이름이 맞는지 확인하고 반영을 눌러 주세요.${S.kkFromImg ? ' 카톡 화면에 보이는 순서(위→아래)대로 읽었어요. 투표 순서가 반대라면 <b>순서 뒤집기</b>를 눌러 주세요.' : ''}</p>${S.kkFromImg ? '<button class="btn sm" data-act="kakaorev" style="margin-bottom:8px">⇅ 순서 뒤집기</button>' : ''}<div class="kk-list">${L.map((x, i) => `<div class="kk-row ${x.pid ? '' : x.guess ? 'warn' : 'bad'}"><em>${i + 1}</em><span>${esc(x.raw)}</span><select class="inp" data-in="kkpick" data-i="${i}"><option value="">${x.pid || x.guess ? '건너뛰기' : '명단에 없음 · 건너뛰기'}</option>${byName(Object.keys(S.players)).map(id => `<option value="${id}" ${x.use === id ? 'selected' : ''}>${esc(pname(id))}${x.guess === id && !x.pid ? ' (혹시?)' : ''}</option>`).join('')}</select></div>`).join('')}</div>
      <div class="row" style="margin-top:10px"><button class="btn" data-act="kakaoback">← 다시 하기</button><button class="btn primary" data-act="kakaoapply">반영하기</button></div>` }` }
  else if (sh.type === 'colf') h += colFilterSheet(sh.k);
  else if (sh.type === 'rosters') { const s = S.sessions[sh.sid]; h += s ? `<h4>팀 명단 · ${fmtDate(s.date)}</h4>${rosterGrid(s)}` : '' }
  else if (sh.type === 'changelog') h += `<h4>업데이트 내용</h4>${sh.fresh ? `<p class="cl-new">🎉 ${APP_VERSION} 버전으로 업데이트됐어요</p>` : ''}<div class="cl">${CHANGELOG.map(([v, d, items], i) => `<section class="${i === 0 ? 'cur' : ''}"><div class="cl-hd"><b>${v}</b><small>${d}</small>${v === APP_VERSION ? '<em>현재</em>' : ''}</div><ul>${items.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>`).join('')}</div>`;
  else if (sh.type === 'staffedit') { const ss = S.sessions[sh.sid];
    h += `<h4>${fmtDate(sh.sid)} 예약자 · 운영자</h4><p>구장 예약자는 직접 참가 신청을 하면 0순위가 돼요(신청하지 않으면 명단에 나오지 않아요). 경기 운영자는 따로 신청하지 않아도 0순위로 자동 신청돼요. 여러 명은 쉼표로 구분해요.</p><div class="panel">
      <div class="field"><label>구장 예약자<input id="se-res" class="inp" type="text" list="mem-list2" value="${esc(idsToNames(ss.p0))}"></label></div>
      <div class="field"><label>경기 운영자<input id="se-ops" class="inp" type="text" list="mem-list2" value="${esc(idsToNames(ss.ops))}"></label></div>
      <datalist id="mem-list2">${memberNames().map(n => `<option value="${esc(n)}">`).join('')}</datalist></div><div class="row" style="margin-top:12px"><button class="btn primary" data-act="staffsave">저장</button></div>` }
  else if (sh.type === 'appname') { const names = memberNames();
    h += `<h4>신청 순번 확보 완료! 🎉</h4><p>이름과 비밀번호 4자리로 로그인하면 신청이 확정돼요. 팀 명단에 쓰이는 이름 그대로 적어 주세요.</p><div class="panel">${myPid() ? `<div class="field"><span>이름</span><b>${esc(pname(myPid()))}</b></div>` : loginFields('an', S.me)}${parkFields(S.sessions[sh.sid], myPid())}</div><div class="row" style="margin-top:12px"><button class="btn primary" data-act="appnamego">${myPid() ? '신청 확정' : '로그인하고 신청 확정'}</button></div><p class="note">지금 닫아도 순번은 유지돼요. 나중에 홈의 "이름 입력하기"로 입력할 수 있어요.</p>` }
  else if (sh.type === 'colorpick') { const s = cur(); const cur0 = s.teams?.[sh.k]?.colorName;
    h += `<h4>${esc(team(s, sh.k).name)} 팀 색 바꾸기</h4><p>다른 팀이 쓰는 색은 고를 수 없어요.</p><div class="pick cpick">${PALETTE.map(p => { const by = KEYS.find(o => o !== sh.k && s.teams?.[o]?.colorName === p.name);
      return `<button class="${cur0 === p.name ? 'cur' : ''}" style="background:${p.color};color:${inkOn(p.color)}" data-act="colorset" data-c="${p.name}" ${by ? 'disabled' : ''}>${p.name}${by ? '<small>사용 중</small>' : cur0 === p.name ? '<small>지금 색</small>' : ''}</button>` }).join('')}</div>` }
  else if (sh.type === 'roommenu') { const s = cur(); const ph = roomPhase(s);
    h += `<h4>진행 메뉴</h4><p>드래프트 진행을 조정해요.</p><div class="pick" style="grid-template-columns:1fr">${ph === 'draft' && (s.picks || []).length ? '<button data-act="undo">↶ 마지막 지명 되돌리기</button>' : ''}${ph === 'draft' && !(s.picks || []).length ? '<button data-act="ordedit">✎ 순번 직접 바꾸기</button>' : ''}${(ph === 'draft' || ph === 'cards') && !(s.picks || []).length ? '<button data-act="reorder">순번 다시 정하기</button>' : ''}<button class="alt" data-act="resetroom">드래프트 처음부터 다시</button><button class="alt" data-act="stageback" data-v="captain">↺ 주장 지정 단계로 되돌리기</button><button class="alt" data-act="stageback" data-v="apply">↺ 신청 단계로 되돌리기</button></div>` }
  else if (sh.type === 'order') { const s = cur(); const o = S.ordDraft || s.order || KEYS; const can = roomPhase(s) === 'draft' && !(s.picks || []).length;
    h += `<h4>순번 직접 바꾸기</h4><p>${s.ladder ? '사다리' : s.cardgame ? '카드' : ''} 결과로 정해진 순번을 바꿔요. 첫 지명 전까지만 바꿀 수 있고, 지명은 1→2→3→3→2→1 순서로 돌아가요.</p><div class="ordlist">${o.map((k, i) => { const t = team(s, k); return `<div class="ordrow"><b class="ordn">${i + 1}번</b><span class="tok" style="background:${t.color};color:${inkOn(t.color)}">${esc(t.name)}</span><span class="ordc">${esc(pname(s.captains?.[k]))} 주장</span><button class="btn sm" data-act="ordmv" data-i="${i}" data-d="-1" ${i ? '' : 'disabled'} aria-label="위로">▲</button><button class="btn sm" data-act="ordmv" data-i="${i}" data-d="1" ${i < o.length - 1 ? '' : 'disabled'} aria-label="아래로">▼</button></div>` }).join('')}</div>
      <div class="row" style="margin-top:12px"><button class="btn primary cta" data-act="ordsave" ${can ? '' : 'disabled'}>이 순번으로 확정</button></div>${can ? '' : '<p class="note">이미 지명이 시작돼서 바꿀 수 없어요.</p>'}` }
  else if (sh.type === 'pairs') h += pairSheet();
  else if (sh.type === 'chatlog') { (S.chatSeen ??= {})[S.sid] = S.chat.length; h += `<h4>메시지 내역</h4><p>드래프트 방에서 주고받은 메시지예요.</p><div class="panel chat logsheet">${chatMsgs()}</div>` }
  else if (sh.type === 'cal') h += calSheet();
  else if (sh.type === 'madd') h += `<h4>회원 추가</h4><div class="panel"><div class="field"><label>이름<input id="ma-name" class="inp" type="text" maxlength="20"></label></div>
    <div class="field"><label>연락처<input id="ma-phone" class="inp" type="tel" placeholder="010-0000-0000"></label></div>
    <div class="field"><label>구분<select id="ma-st" class="inp">${Object.entries(MSTAT).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label></div>
    <div class="field"><label>메모<input id="ma-memo" class="inp" type="text"></label></div></div><div class="row" style="margin-top:12px"><button class="btn primary" data-act="maddgo">추가</button></div>`;
  else if (sh.type === 'mbulk') h += `<h4>명단 붙여넣기</h4><p>한 줄에 한 명씩 "이름 생년월일" 또는 "이름 연락처" 형식으로 붙여넣으세요(예: 김환석 890331, 나강일 90). 생년월일·연락처는 없어도 되고, 게스트는 이름 뒤에 (게)를 붙여요. 이미 있는 이름은 정보만 보태요. 회원 명단에 있는 사람만 앱에 로그인할 수 있어요.</p>
    <textarea id="mb-txt" class="inp" style="min-height:180px" placeholder="김민혁 010-1234-5678&#10;이도형 01023456789&#10;배기문(게)"></textarea><div class="row" style="margin-top:12px"><button class="btn primary" data-act="mbulkgo">등록</button></div>`;
  else if (sh.type === 'capslot') { const s = cur(); const taken = KEYS.filter(k => k !== sh.k).map(k => s.captains?.[k]);
    h += `<h4>${esc(team(s, sh.k).name)} 주장</h4><p>신청자 중에서 고르세요.</p><div class="pick">${byName(s.applicants || []).map(id => `<button class="${s.captains?.[sh.k] === id ? 'cur' : ''}" data-act="pickcap" data-id="${id}" ${taken.includes(id) ? 'disabled' : ''}>${esc(pname(id))}</button>`).join('')}${s.captains?.[sh.k] ? '<button class="alt" data-act="pickcap" data-id="">선택 취소</button>' : ''}</div>` }
  else if (sh.type === 'goal') { const m = M(sh.match); const s = S.sessions[m.session]; const t = team(s, sh.team); const ps = teamPlayers(s, sh.team); const ci = clockInfo(m);
    if (sh.step === 'scorer') h += `<h4>${esc(t.name)} 골! 누가 넣었나요?</h4><p>${esc(ci.label)} ${esc(ci.time)} 시점으로 기록돼요.</p><div class="pick">${ps.map(id => `<button data-act="pickscorer" data-id="${id}">${captainOf(s, sh.team) === id ? '👑 ' : ''}${esc(pname(id))}</button>`).join('')}<button class="alt" data-act="pickscorer" data-id="">선수 미지정</button><button class="alt" data-act="pickog">상대 자책골</button></div>`;
    else h += `<h4>도움은 누가 했나요?</h4><p>득점 ${esc(pname(sh.scorer))}</p><div class="pick">${ps.filter(id => id !== sh.scorer).map(id => `<button data-act="pickassist" data-id="${id}">${esc(pname(id))}</button>`).join('')}<button class="alt" data-act="pickassist" data-id="">도움 없음</button></div>` }
  h += `<div class="row" style="margin-top:14px"><button class="btn" data-act="closesheet">닫기</button></div></div></div>`; return h;
}
const CHANGELOG = [
  ['0.21.97', '2026.10.23', ['홈 화면에 앱으로 설치하면 앱 이름이 WDFS로 나와요 (이미 설치했다면 지우고 다시 설치하면 바뀌어요)']],
  ['0.21.96', '2026.10.23', ['홈(휴대폰): 지난 경기 한 줄 요약은 원래대로 되돌렸어요. 대신 경기에 신청한 뒤에는 다음 경기와 신청 상태, 주차·공당·물당 신청 버튼이 맨 위에 오고, 지난 경기 결과는 그 아래에 보여요']],
  ['0.21.95', '2026.10.23', ['홈(휴대폰): 경기에 신청한 뒤에는 지난 경기 요약을 한 줄로 줄여서, 신청 상태와 주차·공당·물당 신청 버튼까지 한 화면에 바로 보여요']],
  ['0.21.94', '2026.10.22', ['사용 가이드: 어떤 화면 크기에서도 세로 스크롤 없이 한 장이 한 화면에 꼭 맞게 들어가도록 했어요 (작은 폰은 그 장만 살짝 줄여서 보여 줘요)']],
  ['0.21.93', '2026.10.22', ['사용 가이드: 아래로 길게 내리는 대신 한 화면씩 좌우로 넘겨 보는 방식으로 바꿨어요 (위쪽 목차로 바로 이동, 아래 이전·다음 버튼, PC는 ←·→ 키)']],
  ['0.21.92', '2026.10.22', ['사용 가이드: 앱 설치 방법을 아이폰(사파리)·갤럭시(삼성인터넷)·안드로이드(크롬)별로 실제 화면과 함께 한 단계씩 넘겨 보며 따라 할 수 있게 바꿨어요']],
  ['0.21.91', '2026.10.22', ['사용 가이드: 일부 화면 이미지가 세로로 늘어져 보이던 문제를 고쳤어요']],
  ['0.21.90', '2026.10.22', ['사용 가이드(manual.html)를 지금 화면과 기능으로 새로 만들었어요: 새 디자인 화면·영상, 경기 당일 홈, 공당·물당·주차 신청, 득점 순위·출석 현황, 선수 이름으로 골 기록, 자책골, 전광판 좌우 바꾸기']],
  ['0.21.89', '2026.10.22', ['경기모드 전체화면(보기 전용): 점수가 팀 이름보다 화면 가장자리 쪽에 오도록 바꿨어요 (1 BLUE ······ RED 0)']],
  ['0.21.88', '2026.10.22', ['경기모드 전체화면(보기 전용): 오른쪽에 보이는 팀은 이름과 점수가 오른쪽에 붙도록 좌우 대칭으로 정렬했어요']],
  ['0.21.87', '2026.10.22', ['경기모드 전체화면(크게 보기): 위쪽 ⇄ 좌우 바꾸기 버튼으로 두 팀 자리를 이 기기 화면에서만 바꿀 수 있어요. 반대편에서 보는 전광판용 기기에 쓰면 진영이 맞게 보여요 (점수·기록은 그대로, 설정은 기기에 저장돼요)']],
  ['0.21.86', '2026.10.22', ['경기모드 휘슬을 다시 만들었어요: 시작·전반 종료·후반 시작·경기 종료 휘슬이 화면의 경기 시간에 맞춰 울려요', '경기 중에 전반·GK·후반 시간을 바꾸거나 일시정지·재개해도 남은 휘슬이 바뀐 시간에 맞춰 다시 예약돼요', '울리고 있는 휘슬이 중간에 끊기거나 두 번 울리던 문제를 고쳤고, 블루투스 스피커처럼 소리가 늦게 나는 기기는 그만큼 미리 울려요', '화면 시계를 더 자주(0.1초마다) 고쳐 그려서 휘슬과 숫자가 같이 바뀌어요']],
  ['0.21.85', '2026.10.21', ['디자인: BLACK처럼 어두운 팀 색이 어두운 배경에서 잘 안 보이던 곳(팀 색 표시, 팀 이름표, 드래프트 유니폼·좌석, 경기모드 팀 칸, 득점 칩, 순위 등)에 밝은 테두리를 넣어 구분되게 했어요']],
  ['0.21.84', '2026.10.21', ['경기 기록: 골 기록에 팀 대신 득점한 선수 이름이 나와요 (자책골·도움 표시 포함)', '경기 결과: 경기별 결과 아래에 득점자가 나오고, 그날의 득점 순위(골·도움)를 볼 수 있어요. 자책골은 개인 득점에서 빠져요']],
  ['0.21.83', '2026.10.21', ['경기모드: 게임 사이에 나오던 노란색 휴식 카운트다운을 없앴어요. 경기가 끝나면 바로 다음 경기 \'시작 대기\'로 보여요']],
  ['0.21.82', '2026.10.21', ['경기모드 휘슬이 경기 시간과 정확히 맞게 울리도록 고쳤어요. 화면이 잠깐 꺼지거나 소리가 멈췄다 돌아와도 남은 시간 기준으로 다시 맞춰요']],
  ['0.21.81', '2026.10.21', ['경기모드: 진행자 화면 아래 \'경기 셋팅 초기화\' 버튼으로 대진·경기 시간 설정을 처음부터 다시 할 수 있어요 (진행한 경기와 골 기록이 있으면 두 번 확인한 뒤 함께 지워요)']],
  ['0.21.80', '2026.10.21', ['경기모드: 게임마다 양 팀 선수 목록이 나오고, 이름을 누르면 그 선수 골로 기록돼요. \'자책골\'을 누른 뒤 이름을 누르면 상대 팀 득점(자책)으로 기록돼요', '경기모드: 아래 득점 기록 버튼을 누르면 그 골을 취소할 수 있어요', '경기모드: 게임 시작 전에 왼쪽·오른쪽 팀 색을 바꿀 수 있고, 선수 목록도 따라 바뀌어요. 1라운드에서 바꾸면 2·3라운드 같은 순서 경기도 함께 바뀌어요']],
  ['0.21.78', '2026.10.21', ['홈 경기 카드의 경기 시간과 장소를 크게, 아이콘과 함께 보이게 했어요']],
  ['0.21.77', '2026.10.21', ['팀이 정해진 뒤부터 경기가 끝날 때까지 홈 화면에 공당·물당·주차 담당과 팀 명단이 바로 보여요 (공지 이미지 대신 목록으로). 휴대폰에서는 \'팀 명단 보기\'를 누르면 팀별 명단이 떠요']],
  ['0.21.76', '2026.10.21', ['클럽 엠블럼을 디자인 곳곳에 넣었어요: 홈 경기 카드·지난 경기 카드·나의 출석 카드 배경, 드래프트 축구장 가운데, 운영진 표시, 내 정보 카드']],
  ['0.21.75', '2026.10.21', ['앱 디자인을 새로 바꿨어요: 어두운 바탕에 라임색 강조, 굵은 숫자 글꼴, 이모지 대신 선 아이콘', '홈 경기 카드·하단 메뉴·기록실·출석 카드를 새 디자인으로 정리했어요', '드래프트 화면: 어두운 축구장, 주장 카드 위쪽 팀 이름 영역 전체를 팀 색으로 표시']],
  ['0.21.72', '2026.10.21', ['운영진 화면(기록실·출석 관리·설정)에 기록 시트 원본으로 바로 가는 링크를 넣었어요', '설정 → 기록 시트 연동에서 시트 원본 주소와 웹 앱 주소를 바꿀 수 있어요. 바꾸면 모든 운영진 기기에 함께 적용돼요', '출석 기록은 이제 기록 시트에서만 읽어요. 앱에 함께 올라가 있던 출석부 사본은 지웠어요']],
  ['0.21.71', '2026.10.21', ['경기 기록을 구글 시트(기록 시트)에도 저장해요. 운영진 기기에 연동 키를 넣으면 팀 구성·경기 결과·골·출석이 자동으로 시트에 쌓이고, 기록실 출석 현황은 시트 기록을 읽어 와요', '설정 → 기록 시트 연동에서 지금까지의 경기 기록과 출석부를 한 번에 시트로 옮길 수 있어요']],
  ['0.21.70', '2026.10.21', ['아래 메뉴의 \'경기결과\' 이름을 \'기록실\'로 바꿨어요 (경기 결과 · 출석 현황)']],
  ['0.21.69', '2026.10.21', ['WDFS 출석부(2025·2026 시즌, 88경기)를 출석 현황에 기본으로 넣었어요. 따로 올리지 않아도 바로 반영돼요']],
  ['0.21.68', '2026.10.21', ['출석 관리의 \'지난 출석 기록 올리기\'에서 출석부 엑셀(.xlsx) 파일을 바로 올릴 수 있어요. 이름 뒤 생년월일·(M) 표시는 자동으로 빼고 맞추고, 아직 회원이 아닌 이름도 저장해 뒀다가 나중에 회원을 추가하면 이어져요']],
  ['0.21.67', '2026.10.20', ['공당·물당: 신청자는 자동으로 포함하고, 운영진이 정한 인원보다 신청자가 많으면 신청자 중에서, 모자라면 나머지 참가자 중에서 추첨해 확정해요 (공당 먼저, 물당은 공당 제외). 물당 신청도 다시 할 수 있어요', '드래프트 팀 색 고르기 버튼을 크게 키웠어요', '운영진이 여러 명 들어오면 위쪽 운영진 박스에 이름이 하나씩 보여요', '운영진 말풍선이 축구장 쪽(아래)으로 떠요']],
  ['0.21.65', '2026.10.20', ['화면마다 제각각이던 버튼식 메뉴를 \'상위 메뉴 → 하위 메뉴\' 모양으로 통일했어요 (예: 운영모드 회원 → 회원 관리 · 출석 관리, 일정 → 달력 · 목록, 공지 → 팀 공지 · 월간 일정표 · 신청 안내 글 · 알림 보내기, 경기결과 → 경기 결과 · 출석 현황)']],
  ['0.21.64', '2026.10.20', ['운영모드 회원 메뉴 표에 회원별 출석 횟수·출석률·최근 출석이 나와요. 출석 횟수를 누르면 참석한 경기 날짜를 볼 수 있어요', '지난 출석 기록을 붙여넣기로 올릴 수 있어요 (출석표, 날짜별 명단, 횟수 요약 형식)', '운영모드 화면 아래 \'경기 도구\' 줄을 없앴어요']],
  ['0.21.63', '2026.10.20', ['공당·물당 정하는 방식을 바꿨어요. 공당은 운영진이 먼저 지정하고, 물당은 공당을 뺀 경기 참가자 중에서 운영진이 정한 인원만큼 랜덤으로 추첨해요']],
  ['0.21.62', '2026.10.20', ['경기결과 메뉴에 \'출석 현황\'을 추가했어요. 회원별 출석 수·출석률·최근 출석·연속 출석을 볼 수 있고, 이름을 누르면 출석한 날짜가 나와요 (운영모드는 회원 메뉴에서)', '모바일 팀원조정 화면에서도 채팅 내용 칸을 없애고 팀 현황을 더 넓게 보여줘요', '채팅 입력할 때 화면이 들썩이지 않고 그대로 있고, 입력창만 키보드 위로 올라와요']],
  ['0.21.61', '2026.10.20', ['운영모드 두 번째 단계를 \'도우미 지정\'으로 바꿨어요. 주장 3명을 가로 카드로 크게 보여주고, 같은 화면에서 주차 추첨과 공당·물당 지정까지 바로 할 수 있어요', '버튼 크기와 색을 정리해 누를 곳이 더 잘 보이게 했어요']],
  ['0.21.60', '2026.10.20', ['주차 추첨, 공당·물당, 신청자 관리, 달력 등 배경과 글씨색이 비슷해 잘 안 보이던 곳을 모두 찾아 글씨가 잘 보이게 고쳤어요 (특히 다크 모드)']],
  ['0.21.57', '2026.10.19', ['신청 현황 명단에서 선발자와 대기자를 확실히 나눠 보여줘요. 선발은 초록, 대기는 회색으로 표시하고 그 사이에 \'여기까지 선발\' 구분선을 넣었어요']],
  ['0.21.56', '2026.10.19', ['홈 경기 카드의 \'신청 현황 보기\'를 노란 버튼으로 바꿔 더 눈에 띄게 했어요']],
  ['0.21.55', '2026.10.16', ['드래프트 중에도 아래 메뉴가 바뀌지 않고 항상 홈·일정·경기모드·경기결과·내 정보로 고정돼요. 드래프트 방은 오른쪽 위 버튼으로 들어가요 (주장 👑 드래프트, 참관자 👀 참관)']],
  ['0.21.54', '2026.10.16', ['차례가 넘어갈 때 축구공이 땅을 차고 포물선으로 날아가 다음 팀 카드 가운데에 착지한 뒤 다시 통통 튀도록 자연스럽게 바꿨어요', '드래프트 화면 위쪽의 단계·주장 정보 바를 없애고 그만큼 축구장과 카드를 여유롭게 배치했어요']],
  ['0.21.53', '2026.10.16', ['차례 표시 NOW 대신, 차례인 팀 카드 위에서 축구공이 통통 튀어요. 차례가 넘어가면 공이 다음 팀으로 패스돼요']],
  ['0.21.52', '2026.10.16', ['드래프트 중 축구장 안의 검은 박스를 없애서 순번·선수 목록·선택 버튼이 축구장 위에 바로 보여요']],
  ['0.21.51', '2026.10.16', ['차례 표시를 \'차례 · 내 차례!\' 대신 주장 카드 오른쪽 위에 깜빡이는 NOW로 바꿨어요', '주장 카드에서 위쪽 정보와 선택된 선수 사이 구분선을 더 선명하게 했어요', '모바일 드래프트 화면에서 채팅 내용 칸을 없애고(💬 아이콘으로 보기) 그만큼 화면을 넓혀, 스크롤 없이 한 화면에 모두 보여요']],
  ['0.21.50', '2026.10.16', ['채팅 말풍선이 항상 맨 위에 떠서 축구장·카드·채팅창 등 다른 요소에 가려지지 않아요']],
  ['0.21.49', '2026.10.16', ['드래프트 선수 목록 박스 크기를 고정했어요. 남은 인원이 바뀌어도 박스 크기는 그대로예요', '선수 아이콘은 팀에 들어간 아이콘보다 살짝 큰 고정 크기로 보여요']],
  ['0.21.48', '2026.10.16', ['PC 운영모드 일정 메뉴의 달력이 화면 아래까지 길게 늘어나지 않고 적당한 크기로 보여요', '경기 상세의 회차·시간·신청 날짜 입력칸이 좁게 찌그러지던 문제를 고쳤어요']],
  ['0.21.47', '2026.10.16', ['PC 드래프트 화면에서 주장 카드에 들어간 선수 이름을 크게 키웠어요. 유니폼 위로 넘쳐도 테두리 글씨라 잘 보여요']],
  ['0.21.46', '2026.10.16', ['드래프트 선수 아이콘을 머리 없는 반팔 유니폼 모양으로 단순하게 바꿨어요. 안 뽑힌 선수는 흰 유니폼, 뽑히면 팀색 유니폼이에요', '이름이 길어도 잘리지 않게 글자 크기가 자동으로 맞춰져요']],
  ['0.21.45', '2026.10.16', ['드래프트 선수 아이콘을 사람 상반신 모양으로 바꾸고, 뽑히면 팀색 훈련 조끼를 입어요. 남은 인원에 맞춰 축구장을 꽉 채우는 크기로 보여요', '확정된 지명 되돌리기는 운영진만 할 수 있어요', '축구장 위에 운영진 박스를 주장 카드처럼 두고, 그 안에 되돌리기·확정·진행 메뉴 버튼을 모았어요', '마지막 선수가 배치돼도 자동으로 넘어가지 않고 그대로 멈춰요. 운영진이 드래프트 확정을 눌러야 끝나요']],
  ['0.21.44', '2026.10.16', ['주장으로 지정되면 주장 코드 없이 내 이름으로 로그인만 해도 화면 위에 👑 드래프트 입장 버튼이 보여요', '띄어쓰기 등으로 이름이 조금 달라도 같은 사람이면 주장으로 알아봐요']],
  ['0.21.43', '2026.10.16', ['드래프트 이름표가 사람 상체 모양으로 바뀌고 몸통에 이름이 적혀요. 팀에 뽑히면 그 팀 색 조끼를 입은 모습으로 바뀌어요']],
  ['0.21.42', '2026.10.16', ['[운영진] 회원 관리에 같은 이름 회원이 있으면 "한 사람으로 합치기"가 떠요. 신청·팀·경기 기록·골/도움·연락처·로그인 비밀번호까지 한 사람으로 합쳐져요', '앞으로는 띄어쓰기나 (게) 표시만 다른 이름도 같은 회원으로 찾아서 중복이 생기지 않아요']],
  ['0.21.41', '2026.10.16', ['[운영진] 드래프트가 끝난 뒤 "드래프트 다시하기"로 주장·팀 색은 그대로 두고 순번 정하기부터 다시 할 수 있어요', '[운영진] 월간 일정표 화면을 팀 공지 화면과 같은 배치(왼쪽 입력·시안·글꼴, 오른쪽 미리보기)로 맞췄어요']],
  ['0.21.40', '2026.10.16', ['드래프트 남은 선수 이름표에 사람 아이콘이 붙어요(이름 글자 크기는 그대로)']],
  ['0.21.39', '2026.10.16', ['드래프트 화면을 간단하게: "○○ 주장 차례"·"직전 지명" 안내를 없애고, 지명 순서를 팀 색 동그라미로 보여 줘요. 지금 차례 동그라미가 크게 빛나요']],
  ['0.21.38', '2026.10.16', ['드래프트에서 차례인 팀 카드가 굵은 노란 테두리와 깜빡이는 빛으로 크게 강조되고, 다른 팀 카드는 흐리게 보여요']],
  ['0.21.37', '2026.10.16', ['드래프트에서 주장이 선수를 고르면 이름표가 남은 선수 명단에서 날아와 그 팀 카드 안으로 쏙 들어가요', '드래프트 참관자로 지정된 회원이 PC에서도 드래프트를 실시간으로 볼 수 있어요']],
  ['0.21.36', '2026.10.16', ['신청 현황 표를 순위순과 신청순으로 바꿔 볼 수 있어요']],
  ['0.21.35', '2026.10.16', ['신청 현황 표의 제목과 내용 칸 정렬을 맞췄어요(PC에서는 표 폭도 알맞게 줄였어요)']],
  ['0.21.34', '2026.10.16', ['신청 현황을 표로 보여 줘요: 신청순 · 이름 · 신청 시각 · 순위 · 상태(선발/대기). 취소한 사람과 마감 후 취소한 사람은 표 아래에 따로 보여요']],
  ['0.21.33', '2026.10.16', ['홈 경기 카드의 "신청 인원"이나 일정 카드의 신청 인원을 누르면 지금 신청 현황(선발·대기)을 볼 수 있어요']],
  ['0.21.32', '2026.10.16', ['팀 운영진은 신청 0순위가 아니에요. 0순위는 그 경기의 구장 예약자(신청 시)와 경기 운영자만이에요']],
  ['0.21.31', '2026.10.16', ['PC 화면에서 메뉴가 위쪽 가로 메뉴로 바뀌고, 내용은 화면 가운데에 보여요']],
  ['0.21.30', '2026.10.16', ['[운영진] 공지 포스터 시안을 완전히 새로 만들었어요: 클래식·매거진·티켓·스플릿·전광판·타이포 6가지 구성에 색 조합 8가지', '[운영진] "🎲 새 시안 보기"를 누를 때마다 구성·색·글꼴을 새로 섞은 시안 5개가 나와요', '[운영진] 월간 일정표도 클래식·달력·리스트·전광판·타이포 시안과 글꼴을 골라 만들 수 있어요']],
  ['0.21.29', '2026.10.16', ['[운영진] 회원 관리에서 운영진 체크 대신 회원 유형(운영진·특별회원·정회원·장불회원·게스트)으로 고르도록 바꿨어요', '운영모드는 운영진과 특별회원만 들어갈 수 있어요. 운영진은 지금처럼 신청 0순위예요']],
  ['0.21.28', '2026.10.16', ['[운영진] 공지 포스터 글꼴을 페이퍼로지·에스코어드림·프리텐다드·나눔고딕·나눔명조·나눔손글씨(펜·붓) 중에서 고를 수 있어요. "디자인 추천"을 고르면 디자인마다 어울리는 글꼴이 자동으로 들어가요', '포스터 글꼴은 필요한 것만 그때그때 받아서 더 빨리 그려져요']],
  ['0.21.27', '2026.10.16', ['[운영진] 공지 메뉴 맨 위에서 엘리베이터 비밀번호와 공지사항(최대 3줄)을 입력하면 포스터에 바로 반영돼요. 팀 색이 정해지기 전에도 미리 입력할 수 있어요', '[운영진] 공지 포스터 디자인을 스타디움·나이트·클린·팀 컬러 4가지 중에서 골라 배포할 수 있어요']],
  ['0.21.26', '2026.10.16', ['디자인 다듬기: 운영모드 버튼은 운영진에게만 보이고, 회원은 내 정보 맨 아래에서 들어갈 수 있어요', 'PC 홈의 MATCH REVIEW에 지난 경기 9경기 결과가 한눈에 보여요', '신청자 보기에서 내 상태가 색으로 구분되고, 대기자는 대기 순번과 순위로 보여요', '경기모드에서 고를 경기가 없을 때 불필요한 선택 칸을 숨겼어요', '[운영진] 신청자 표의 순위 규칙 설명을 접어 두고, 당번 요약과 달력 범례가 휴대폰에서 깔끔하게 보여요']],
  ['0.21.25', '2026.10.16', ['일정 카드의 "📅 캘린더에 추가"로 경기 일정을 아이폰·구글 캘린더에 넣을 수 있어요(경기 2시간 전 알림)', '[운영진] 신청자 직접 추가 때 회원 명단에 없는 이름은 "게스트로 추가" 버튼으로 바로 넣을 수 있어요', '공지 이미지 저장 파일명에 날짜와 회차가 들어가요']],
  ['0.21.24', '2026.10.16', ['전체 코드를 다시 점검해 쓰지 않는 코드를 정리하고 더 가볍고 빠르게 만들었어요', '[중요] 경기 운영자가 지정되지 않은 경기에서 신청 인원이 0명으로 보이거나 신청 확정 시 명단이 비는 문제를 고쳤어요', '로그인 전에 신청한 뒤 로그인해도 내 신청이 그대로 이어져요. 이름 나중에 입력하기도 정상 동작해요', '대기자는 순위(1→2→3순위) 순서로 번호가 매겨져요. 대기 상태에서는 마감 후에도 대기 취소를 할 수 있어요', '신청자 보기 맨 위에 내 선발·대기 순번이 보여요', '드래프트에서 내 차례가 되면 진동과 안내가 떠요', '경기 타이머·휘슬·사다리를 모든 기기에서 서버 시각 기준으로 맞춰요', '경기모드에서 휘슬 켜기/끄기가 진행 중인 경기에도 바로 적용되고, 시작 버튼을 두 번 눌러도 한 번만 시작돼요', '경기모드 중에는 화면을 당겨도 새로고침되지 않아요', '사용 설명서 용량을 약 40% 줄였어요']],
  ['0.21.23', '2026.10.16', ['경기모드 크게 보기를 태블릿에서도 스마트폰 화면을 그대로 확대한 모습으로 보여 줘요']],
  ['0.21.22', '2026.10.16', ['[운영진] 주장 지정·드래프트·밸런스 조정 단계에서 "신청 단계" 또는 "주장 지정 단계"로 되돌릴 수 있어요. 신청 단계로 되돌리면 신청자 명단을 다시 고칠 수 있어요']],
  ['0.21.21', '2026.10.16', ['[운영진] 신청자 목록을 순위순과 신청순으로 바꿔 볼 수 있어요']],
  ['0.21.20', '2026.10.16', ['신청 인원을 "전체 신청 인원 / 정원"으로 보여 줘요. 정원이 차도 대기자까지 합친 전체 인원이 보여요']],
  ['0.21.19', '2026.10.15', ['[운영진] 경기진행 화면에서 1~9경기 대진(맞붙는 팀)을 경기마다 바꿀 수 있어요. 끝난 경기는 골 기록도 함께 옮겨져요']],
  ['0.21.18', '2026.10.15', ['[운영진] 드래프트에서 사다리·카드로 정해진 순번을 첫 지명 전까지 직접 바꿀 수 있어요']],
  ['0.21.17', '2026.10.15', ['구장 예약자는 직접 참가 신청을 해야 0순위로 들어가요. 신청하지 않으면 신청자 명단에 나오지 않아요']],
  ['0.21.16', '2026.10.15', ['[운영진] 신청자 표에서 신청을 언제든 삭제할 수 있어요(마감 후에도, 3순위 기록 없이)', '[운영진] The Base 구장 신청자의 0~3순위를 직접 바꿀 수 있어요. 순위 칸을 눌러 고르고, 자동 계산으로 되돌릴 수도 있어요']],
  ['0.21.15', '2026.10.02', ['크게 보기에서 시계를 화면 가득 가장 크게 보여 주도록 배치를 바꿨어요']],
  ['0.21.14', '2026.10.02', ['크게 보기 화면이 일부 폰에서 모양 없이 나오던 문제를 고쳤어요', '업데이트 직후 화면 스타일이 옛 버전으로 남지 않도록 자동으로 다시 받아요']],
  ['0.21.13', '2026.10.02', ['경기모드 "⛶ 크게 보기": 점수와 시간을 화면 가득 크게 보여 주고, 휴대폰을 가로로 돌려 쓸 수 있어요']],
  ['0.21.12', '2026.10.02', ['[운영진] 기본 알림(신청 오픈·마감 임박·경기 당일·대기→선발·주장 지정·팀 발표)도 자동 알림 목록에서 고치거나 끄고 지울 수 있어요', '받은 알림을 하나씩 또는 모두 지울 수 있어요']],
  ['0.21.11', '2026.10.02', ['[운영진] 알림 보내기의 회원 목록을 ㄱ~ㅎ 탭으로 나눠 보여 줘요 (선택됨 탭, 탭별 모두 선택·해제)']],
  ['0.21.10', '2026.10.02', ['오른쪽 위 🔔에서 받은 알림을 모아 볼 수 있어요', '[운영진] 알림 보내기 화면을 발송 그룹 · 회원 목록 · 메시지로 나눴어요', '[운영진] 자동 알림: 내용·대상·보내는 때(특정 날짜, 또는 경기마다 신청 오픈·마감·경기 시작 몇 시간 전후)를 정해 두면 자동으로 보내요']],
  ['0.21.9', '2026.10.02', ['[운영진] 공지 메뉴의 "알림 보내기"에서 전체·신청자·참가자·공당·물당·주차 신청자 또는 원하는 회원만 골라 알림을 보낼 수 있어요']],
  ['0.21.8', '2026.10.02', ['휴대폰 알림: 신청 오픈, 마감 임박, 대기→선발, 주장 지정, 팀 발표, 경기 당일, 운영진 공지 (내 정보에서 켜고 종류별로 고를 수 있어요)']],
  ['0.21.7', '2026.10.02', ['운영모드를 쓰다가 앱을 닫고 다시 열면, 운영모드가 꺼지고 항상 홈에서 시작해요']],
  ['0.21.6', '2026.10.02', ['[운영진] 예전에 취소했는데 남아 있던 주차·공당·물당 기록을 신청자 화면에서 한 번에 정리할 수 있어요']],
  ['0.21.5', '2026.10.02', ['신청을 취소하거나 신청자 명단에서 빠지면 주차·공당·물당 신청과 지정도 자동으로 취소돼요']],
  ['0.21.4', '2026.10.02', ['[운영진] 신청자 목록에 본인 신청 · 운영진 추가 · 카톡 반영을 구분해서 보여요', '업데이트 내용이 앱을 열 때 자동으로 뜨지 않아요(내 정보 → 업데이트 내용에서 볼 수 있어요)']],
  ['0.21.3', '2026.10.02', ['[운영진] 신청자를 직접 추가할 때 회원 명단에 없는 이름은 막고, 게스트는 이름 뒤에 (게)를 붙여야 추가돼요', '[운영진] 직접 추가하면 새로고침 없이 바로 목록에 반영돼요']],
  ['0.21.2', '2026.10.02', ['[운영진·베타] 카톡 투표 참여자 화면 캡처를 여러 장 올리면 이름을 자동으로 읽어서 신청 순서에 반영해요']],
  ['0.21.1', '2026.10.02', ['[운영진·베타] 카톡 투표 명단을 붙여넣으면 회원과 자동으로 맞춰 신청 순서에 한 번에 반영해요', '[운영진·베타] 직접 바꾼 순서를 "실제 신청 순서"로 되돌리는 버튼', '[회원] 신청자 보기는 신청한 순서대로, 순위 표시는 The Base 구장에서만 보여요', '[운영진] 경기 메뉴는 진행이 시작된 다음 경기를 먼저 보여 주고, 신청자 현황에 공당·물당 신청이 보여요', '앱을 새로 열면 항상 홈에서 시작해요']],
  ['0.21', '2026.10.02', ['[운영진] 베타테스트 기간에는 신청자 순번을 바꿀 수 있어요(설정 → 서비스 상태에서 정식 오픈하면 잠겨요)', '경기모드 "일정 경기"에서 경기 일정을 직접 고를 수 있어요. 다음 경기는 시작 1시간 전부터, 지난 경기는 끝나고 1시간까지만 고를 수 있어요', '[운영진] 로딩 화면 배경 사진을 최대 5장까지 올리면, 앱을 열 때마다 무작위로 보여요', '배경 사진은 전체를 어둡게 깔아서 엠블럼과 글자가 또렷해요', '사진 속 주인공이 가운데 엠블럼에 가리지 않게, 사진 크기와 위치를 자동으로 맞춰요']],
  ['0.20', '2026.10.02', ['[운영진] 회원 관리 표에 스프레드시트처럼 열마다 정렬(오름·내림차순)과 값 골라 보기 필터를 넣었어요']],
  ['0.19', '2026.10.02', ['베타테스트 대비 전체 최적화: 다시 열 때 화면·스타일·앱 파일을 폰 저장본에서 바로 불러와 훨씬 빨라졌어요', '서버 연결 준비를 앱 시작과 동시에 해서 첫 화면이 빨라졌어요', '데이터가 한꺼번에 들어와도 화면을 한 번만 다시 그려서 더 부드러워졌어요', '쓰지 않는 코드와 화면 스타일을 정리하고 엠블럼 이미지를 가볍게 줄였어요', '드래프트 화면 아래 채팅 기록 글자가 겹쳐 보이던 문제를 고쳤어요']],
  ['0.18', '2026.10.01', ['업데이트 내용을 내 정보에서 확인할 수 있어요', '로딩 화면은 앱을 처음 열 때만 보이고, 새로고침은 바로 돼요']],
  ['0.17', '2026.10.01', ['신청 순번을 서버에 도착한 시각(1/1000초)으로 정해요. 폰 시계나 조작으로 바꿀 수 없어요', '마감 시각 이후에 도착한 신청은 인정되지 않아요', '앱이 데이터를 폰에 저장해 두고 바뀐 것만 받아서 더 빠르고 가벼워졌어요']],
  ['0.16', '2026.10.01', ['앱을 열 때 클럽 엠블럼 로딩 화면', '경기모드 "직접 설정": 일정 없이 팀·경기 수·시간을 정해 경기 진행과 결과 정리', '운영모드 비밀번호 변경', '드래프트 참관자 지정', '연습 데이터를 항목별로 지우기']],
  ['0.15', '2026.10.01', ['NEXT MATCH 카드 배경을 풋살장으로 바꿨어요']],
  ['0.14', '2026.10.01', ['신청하기 버튼을 NEXT MATCH 카드 바로 아래로 옮겨, 홈 화면이 가려지지 않아요', '폰 크기에 맞춰 홈 화면 크기가 자동으로 조절돼서 신청 버튼이 항상 바로 보여요']],
  ['0.13', '2026.10.01', ['홈·운영·경기모드 화면에서 겹치는 정보를 정리했어요']],
  ['0.12', '2026.10.01', ['경기 추가 때 장소를 목록에서 고르거나 직접 입력', '정식 출시 전이라 버전을 0.x로 표기해요']],
];
/* 로딩 배경 자동 구성: 세로 화면(9:16)에 맞추고, 사진 속 주인공(윤곽이 몰린 곳)이 가운데 엠블럼 자리(세로 36~64%)를 피하도록 배치 */
function composeBootBg(im) { const W = 1080, H = 1920; const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d'); c.imageSmoothingQuality = 'high';
  const sw = 96, sh = Math.max(8, Math.round(96 * im.height / im.width)); const t = document.createElement('canvas'); t.width = sw; t.height = sh; const tc = t.getContext('2d'); tc.drawImage(im, 0, 0, sw, sh);
  const d = tc.getImageData(0, 0, sw, sh).data; const Lm = new Float32Array(sw * sh); for (let i = 0; i < sw * sh; i++) Lm[i] = .299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2];
  const E = []; for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++) { const i = y * sw + x; E.push([Math.abs(Lm[i + 1] - Lm[i - 1]) + Math.abs(Lm[i + sw] - Lm[i - sw]), x / sw, y / sh]) }
  E.sort((a, b) => b[0] - a[0]); const top = E.slice(0, Math.max(10, Math.round(E.length * .12))); let sx = 0, sy = 0, sg = 0; top.forEach(([g, x, y]) => { sx += g * x; sy += g * y; sg += g }); const fx = sg ? sx / sg : .5, fy = sg ? sy / sg : .5;
  // 배경: 같은 사진을 화면 가득 채우고 강하게 흐리게(작게 줄였다가 키움)
  const cov = Math.max(W / im.width, H / im.height); const bl = document.createElement('canvas'); bl.width = 27; bl.height = 48; const bc = bl.getContext('2d'); bc.imageSmoothingQuality = 'high';
  const bw = im.width * cov * bl.width / W, bh = im.height * cov * bl.height / H; bc.drawImage(im, (bl.width - bw) / 2, (bl.height - bh) / 2, bw, bh); c.drawImage(bl, 0, 0, W, H); c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(0, 0, W, H);
  // 본 사진: 가로 사진은 폭에 맞춰 통째로, 세로 사진은 폭에 맞춘 뒤 위아래를 잘라서 — 주인공을 위쪽(24%) 또는 아래쪽(78%)에 둠
  let s = W / im.width; if (im.height * s > H * 1.6) s = H * 1.6 / im.height; const fw = im.width * s, fh = im.height * s; const X = Math.max(W - fw, Math.min(0, W / 2 - fx * fw));
  const target = (fy < .5 ? .24 : .78) * H; const T = fh <= H ? Math.max(0, Math.min(H - fh, target - fy * fh)) : Math.max(H - fh, Math.min(0, target - fy * fh));
  if (fw < W) c.drawImage(im, (W - fw) / 2, T, fw, fh); else c.drawImage(im, X, T, fw, fh);
  // 본 사진 위아래 경계를 부드럽게
  if (fh < H) { const fade = 90; if (T > 0) { const g = c.createLinearGradient(0, T, 0, T + fade); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, T, W, fade) }
    if (T + fh < H) { const g = c.createLinearGradient(0, T + fh - fade, 0, T + fh); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)'); c.fillStyle = g; c.fillRect(0, T + fh - fade, W, fade) } }
  return { cv, fx, fy, T, fh } }
function bootBgs() { const m = S.meta || {}; const out = []; Object.keys(m).filter(k => /^bootbg(_\d+)?$/.test(k)).sort().forEach(k => { if (m[k]?.img) out.push({ id: k, img: m[k].img, at: m[k].at || 0 }) }); return out.slice(0, 5) }
/* ───────── 푸시 알림 (Firebase Cloud Messaging) ───────── */
const VAPID_KEY = 'BDpr-sq8atUkF4gE-k0-yr1mwfcGt3K1vr0ZWI4TDMSsJnPnrFYSm4N-KRS7W6gPQvYHTxCKe3IB8yeoVTANOXk';
const NOTI_TYPES = [['open', '📢 신청 오픈', '신청이 열리면'], ['closing', '⏰ 마감 임박', '아직 신청 안 했을 때 마감 2시간 전'], ['promote', '🎉 대기 → 선발', '내가 선발로 올라갔을 때'], ['captain', '👑 주장 지정', '내가 주장이 됐을 때'], ['team', '📣 팀 발표', '드래프트가 끝나면 내 팀 안내'], ['day', '⚽ 경기 당일', '경기 날 낮 12시에 시간·구장 안내'], ['notice', '📝 운영진 공지', '운영진이 보내는 공지']];
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function pushSupport() { if (IS_ARTIFACT || !S.fbApp) return 'preview'; if (isIOS() && !isStandalone()) return 'ios-browser'; if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'; return 'ok' }
async function fcm() { const M = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js'); if (!(await M.isSupported())) throw new Error('unsupported'); return M }
async function pushEnable() { const sup = pushSupport(); if (sup !== 'ok') { toast(sup === 'ios-browser' ? '아이폰은 "홈 화면에 추가"한 앱에서만 알림을 받을 수 있어요.' : '이 기기·브라우저는 알림을 지원하지 않아요.'); return }
  const pid = myPid(); if (!pid) { toast('로그인한 뒤에 켤 수 있어요.'); return }
  const perm = await Notification.requestPermission(); if (perm !== 'granted') { toast('알림이 허용되지 않았어요. 폰 설정에서 이 앱의 알림을 허용해 주세요.'); render(); return }
  try { const M = await fcm(); const reg = await navigator.serviceWorker.ready; const token = await M.getToken(M.getMessaging(S.fbApp), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) throw new Error('no token'); save('pushToken', token);
    await S.store.set('pushTokens/' + token, { pid, at: Date.now(), ua: navigator.userAgent.slice(0, 120), ios: isIOS() });
    S.np = { ...Object.fromEntries(NOTI_TYPES.map(([k]) => [k, true])), ...(S.np || {}), on: true }; await S.store.set('notifPrefs/' + pid, { ...S.np, at: Date.now() }); pushListen(); toast('알림을 켰어요! 🔔'); render() }
  catch (e) { console.error(e); toast('알림을 켜지 못했어요: ' + (e.code || e.message || '알 수 없음')) } }
async function pushDisable() { const pid = myPid(); const t = load('pushToken', null); try { if (t) await S.store.del('pushTokens/' + t) } catch { } save('pushToken', null); if (pid) { try { await S.store.set('notifPrefs/' + pid, { ...(S.np || {}), on: false, at: Date.now() }) } catch { } S.np = { ...(S.np || {}), on: false } } toast('이 폰의 알림을 껐어요.'); render() }
let PUSH_LISTEN = false; async function pushListen() { if (PUSH_LISTEN || pushSupport() !== 'ok' || Notification.permission !== 'granted') return; PUSH_LISTEN = true; try { const M = await fcm(); M.onMessage(M.getMessaging(S.fbApp), m => { const n = m.notification || {}; toast(`${n.title || '알림'} · ${n.body || ''}`) }) } catch (e) { console.warn(e) } }
async function loadPrefs() { const pid = myPid(); if (!pid || S.npLoaded === pid) return; S.npLoaded = pid; try { S.np = (await S.store.get('notifPrefs/' + pid)) || null } catch { S.np = null } render() }
function notiCard() { const sup = pushSupport(); const on = typeof Notification !== 'undefined' && Notification.permission === 'granted' && !!load('pushToken', null) && S.np?.on !== false;
  if (sup === 'preview') return `<div class="panel pad"><p class="note" style="margin:0">알림은 실제 앱 주소(GitHub)에서 켤 수 있어요.</p></div>`;
  if (sup === 'ios-browser') return `<div class="panel pad"><b>📱 아이폰은 홈 화면 앱에서만 알림을 받을 수 있어요</b><p class="note" style="margin:6px 0 0">사파리 아래 공유 버튼 → <b>홈 화면에 추가</b> → 홈 화면의 WD_FUTSAL 아이콘으로 열고, 여기서 알림을 켜 주세요. (iOS 16.4 이상)</p></div>`;
  if (sup !== 'ok') return `<div class="panel pad"><p class="note" style="margin:0">이 기기·브라우저는 알림을 지원하지 않아요. 크롬이나 홈 화면 앱으로 열어 주세요.</p></div>`;
  const np = S.np || {}; return `<div class="panel pad"><div class="betarow"><div><b>${on ? '🔔 이 폰에서 알림 받는 중' : '🔕 알림 꺼짐'}</b><small>${on ? '아래에서 받을 알림을 고를 수 있어요.' : '켜면 신청 오픈, 선발, 팀 발표 등을 알려 드려요.'}</small></div>${on ? '<button class="btn" data-act="pushoff">끄기</button>' : '<button class="btn primary cta" data-act="pushon">알림 켜기</button>'}</div>
    ${on ? `<div class="ntypes">${NOTI_TYPES.map(([k, n, d]) => `<label class="ntype"><span><b>${n}</b><small>${d}</small></span><input type="checkbox" data-in="npref" data-k="${k}" ${np[k] !== false ? 'checked' : ''}></label>`).join('')}</div>` : ''}</div>` }
function selSet(s0) { if (!s0) return new Set(); return new Set(s0.stage === 'apply' ? classify(s0).sel.map(r => r.pid).filter(Boolean) : (s0.applicants || [])) }
function watchPromote(sid, before, exclude) { const s0 = S.sessions[sid], q0 = S.q?.[sid]; let n = 0; // 서버 반영이 늦어도 최대 12초까지 기다렸다가 확인해요
  const chk = () => { const s1 = S.sessions[sid]; if ((s1 === s0 && S.q?.[sid] === q0) && ++n < 8) return setTimeout(chk, 1500); const after = selSet(s1); const up = [...after].filter(p0 => !before.has(p0) && !(exclude || []).includes(p0)); if (up.length) queuePush({ type: 'promote', pids: up, sid }) }; setTimeout(chk, 1500) }
function watchInbox() { const pid = myPid(); if (!S.store || S.inboxPid === pid) return; try { S.unInbox && S.unInbox() } catch { } S.inboxPid = pid; S.inbox = []; if (!pid) return;
  S.unInbox = S.store.watchCol('inbox/' + pid + '/items', docs => { S.inbox = docs.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 50); renderSoon() }, { order: 'at', limit: 50 }, () => { }) }
function inboxSheet() { const L = S.inbox || []; const ico = { open: '📢', closing: '⏰', promote: '🎉', captain: '👑', team: '📣', day: '⚽', notice: '📝' };
  const when = t => { const d = new Date(t); const diff = (Date.now() - t) / 60000; return diff < 1 ? '방금' : diff < 60 ? Math.floor(diff) + '분 전' : diff < 1440 ? Math.floor(diff / 60) + '시간 전' : `${d.getMonth() + 1}.${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}` };
  return `<h4>🔔 받은 알림</h4>${L.length ? `<div class="inbox">${L.map(x => `<div class="ib ${x.read ? '' : 'new'}"><button class="ib-del" data-act="ibdel" data-id="${x.id}" aria-label="이 알림 지우기">✕</button><span class="ib-ico">${ico[x.type] || '🔔'}</span><div><b>${esc(String(x.title || '').replace(/^[📢⏰🎉👑📣⚽📝]\s*/u, ''))}</b><p>${esc(x.body || '').replace(/\n/g, '<br>')}</p><small>${when(x.at || 0)}</small></div></div>`).join('')}</div>` : '<p class="empty">아직 받은 알림이 없어요.</p>'}${L.length ? '<button class="btn sm danger" style="margin-top:10px" data-act="ibclear">모두 지우기</button>' : ''}<p class="note" style="margin:10px 0 0">최근 50개까지 보여요. 휴대폰 알림을 켜지 않아도 여기에는 쌓여요.</p>` }
async function markInboxRead() { const pid = myPid(); const un = (S.inbox || []).filter(x => !x.read && x.id); un.forEach(x => x.read = true); for (const x of un) { try { await S.store.update(`inbox/${pid}/items/${x.id}`, { read: true }) } catch { } } }
async function queuePush(doc) { try { await S.store.add('pushQueue', { ...doc, by: myPid() || (S.admin ? 'admin' : ''), at: Date.now() }) } catch (e) { console.warn('push queue', e) } }
/* ───────── 기록 시트(구글 시트) 연동: 경기 기록은 시트, 실시간 데이터는 Firebase ───────── */
// 시트 주소: 운영모드 → 설정에서 바꿀 수 있어요 (Firebase meta/sheet). 비어 있으면 config.js 값
const sheetCfg = () => S.meta?.sheet || {};
const sheetUrl = () => String(sheetCfg().exec || CFG.recordSheet || '').trim();
const sheetView = () => String(sheetCfg().view || CFG.recordSheetView || '').trim();
const sheetLink = (cls = 'btn sm') => sheetView() ? `<a class="${cls} sheetlink" href="${esc(sheetView())}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>시트 원본 열기<span class="ext">↗</span></a>` : '';
const sheetKey = () => load('sheetKey', '');
async function sheetGet(q) { if (!sheetUrl()) throw new Error('시트 주소가 없어요'); const r = await fetch(sheetUrl() + '?' + new URLSearchParams(q)); const j = await r.json(); if (!j.ok) throw new Error(j.error || '시트 오류'); return j.data }
async function sheetPost(body) { if (!sheetUrl()) throw new Error('시트 주소가 없어요'); const r = await fetch(sheetUrl(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: sheetKey(), ...body }) }); const j = await r.json(); if (!j.ok) throw new Error(j.error || '시트 오류'); return j.result }
// 시트에 있는 기록 읽기 (기기에 10분 저장)
function loadSheetRec(force) { if (!sheetUrl() || (S.sheetRecP && !force)) return; const c = load('sheetRec', null); if (c && !force) { S.sheetRec = c.d; if (Date.now() - c.at < 6e5) { S.sheetRecP = Promise.resolve(); return } }
  S.sheetRecP = sheetGet({ action: 'all' }).then(d => { S.sheetRec = d; save('sheetRec', { at: Date.now(), d }); render() }).catch(() => { }) }
function sheetAttNamed() { const out = {}; (S.sheetRec?.attendance || []).forEach(r => { if (!r.date || !r.name) return; (out[r.date] ??= []); if (!out[r.date].includes(r.name)) out[r.date].push(r.name) }); return out }
// 한 경기(날짜)의 기록 묶음
function sheetPayload(sid) { const s = S.sessions[sid]; if (!s) return null; const ms = sessMatches(sid); const nm = id => pname(id) || '';
  const rosters = []; KEYS.forEach(k => { const t = team(s, k); teamPlayers(s, k).forEach(pid => { const pk = (s.picks || []).findIndex(x => x.p === pid); rosters.push({ team: k, color: t.name, pid, name: nm(pid), captain: captainOf(s, k) === pid, pickNo: pk >= 0 ? pk + 1 : '' }) }) });
  const caps = new Set(KEYS.map(k => captainOf(s, k)).filter(Boolean));
  const attendance = attPids(s).map(pid => ({ pid, name: nm(pid), type: caps.has(pid) ? '주장' : (s.duty?.ball || []).includes(pid) ? '공당' : (s.duty?.drink || []).includes(pid) ? '물당' : '참석' }));
  const matches = ms.map(m => { const [a, b] = score(m); return { id: m.id, n: m.n, round: m.round || '', home: team(s, m.home).name, away: team(s, m.away).name, homeScore: a, awayScore: b, status: m.status } });
  const events = Object.entries(S.events).filter(([, e]) => e.session === sid).map(([id, e]) => ({ id, match: e.match, team: team(s, e.team).name, scorerId: e.scorer || '', scorer: e.scorer ? nm(e.scorer) : '', assistId: e.assist || '', assist: e.assist ? nm(e.assist) : '', ownGoal: !!e.og, minute: e.sec ? Math.floor(e.sec / 60) : '' }));
  const names = a => (a || []).map(nm).join(', ');
  return { session: { date: sid, no: s.no || '', time: s.time || '', venue: s.venue || '', capacity: s.capacity || '', stage: s.stage || '', players: attPids(s).length, ball: names(s.duty?.ball), drink: names(s.duty?.drink), park: names(s.parkWin) }, rosters, attendance, matches, events } }
async function sheetSyncDate(sid) { const p = sheetPayload(sid); if (!p) return; return sheetPost({ action: 'batch', ops: [{ action: 'saveSession', session: p.session, rosters: p.rosters, attendance: p.attendance }, { action: 'saveMatches', date: sid, matches: p.matches }, { action: 'saveEvents', date: sid, events: p.events }] }) }
// 운영진 기기: 경기 기록이 바뀌면 조용히 시트에 저장 (같은 내용은 다시 안 보냄)
function sheetAutoSync() { if (!S.admin || !sheetUrl() || !sheetKey() || S.ready < 3) return; clearTimeout(S.sheetT); S.sheetT = setTimeout(async () => { const t = today(); const H = load('sheetHash', {});
  for (const sid of Object.keys(S.sessions)) { const s = S.sessions[sid]; if (sid > t || !(s.stage === 'match' || s.draftStatus === 'done')) continue; const p = sheetPayload(sid); if (!p || (!p.matches.length && !p.rosters.length)) continue;
    const h = JSON.stringify(p).length + ':' + [...JSON.stringify(p)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 0); if (H[sid] === h) continue;
    try { await sheetSyncDate(sid); H[sid] = h; save('sheetHash', H); S.sheetLast = Date.now() } catch (e) { S.sheetErr = e.message; break } } }, 4000) }
function sheetCard() { if (!S.admin) return ''; const k = sheetKey(); const st = S.sheetPing; const ex = sheetUrl(), vw = sheetView(); const short = u => u ? esc(u.replace(/^https:\/\//, '').replace(/(.{34}).+(.{10})$/, '$1…$2')) : '<em>없음</em>';
  return `<h2>기록 시트 연동<small>경기 기록은 구글 시트에, 실시간 데이터는 Firebase에</small></h2><div class="panel pad sheetcard">
    <div class="sc-row"><span>시트 원본</span><b class="url">${vw ? short(vw) : '<em>주소 없음</em>'}</b><span class="sc-btns">${sheetLink()}<button class="btn sm" data-act="sheeturl" data-f="view">${vw ? '수정' : '입력'}</button></span></div>
    <div class="sc-row"><span>웹 앱 주소</span><b class="url">${short(ex)}${sheetCfg().exec ? '' : ex ? ' <small class="muted">(기본값)</small>' : ''}</b><button class="btn sm" data-act="sheeturl" data-f="exec">수정</button></div>
    ${ex ? `<div class="sc-row"><span>시트 연결</span><b class="${st === true ? 'ok' : st === false ? 'bad' : ''}">${st === true ? `✅ 연결됨${S.sheetName ? ' · ' + esc(S.sheetName) : ''}` : st === false ? '⚠️ 연결 안 됨' : '확인 전'}</b><button class="btn sm" data-act="sheetping">연결 확인</button></div>` : ''}
    <div class="sc-row"><span>이 기기의 연동 키</span><b>${k ? '입력됨 ••••' + esc(k.slice(-4)) : '없음'}</b><button class="btn sm" data-act="sheetkey">${k ? '바꾸기' : '입력하기'}</button></div>
    <p class="note">시트 주소는 모든 운영진 기기에 함께 적용되고, 연동 키는 기기마다 따로 넣어요. 연동 키가 있는 운영진 기기에서 경기 기록(팀 구성·결과·골·출석)이 바뀌면 자동으로 시트에 저장돼요.${S.sheetLast ? ` 마지막 저장 ${new Date(S.sheetLast).toTimeString().slice(0, 5)}` : ''}${S.sheetErr ? ` · 오류: ${esc(S.sheetErr)}` : ''}</p>
    <div class="row"><button class="btn primary" data-act="sheetmigrate" ${k && ex ? '' : 'disabled'}>⬆ 지금까지 기록 모두 시트로 옮기기</button><button class="btn" data-act="sheetsum" ${k && ex ? '' : 'disabled'}>선수기록 다시 계산</button></div>
    ${S.sheetMig ? `<p class="note">${esc(S.sheetMig)}</p>` : ''}</div>` }
function viewSettings() {
  return `<div class="setwrap"><h2>내 정보<small>이름 + 비밀번호 4자리로 로그인해요</small></h2>${loginCard()}
  ${S.auth && !S.admin ? `<h2>알림</h2>${notiCard()}` : ''}
  ${sheetCard()}
  <h2>휘슬</h2><div class="panel pad"><button class="btn block" data-act="whistle">${S.whistle ? '🔊 이 폰에서 휘슬 켜짐' : '🔇 이 폰에서 휘슬 꺼짐'}</button><p class="note">웹에서는 휘슬이 울리려면 경기 화면을 켜 두어야 해요.</p></div>
    ${S.admin ? `<h2>서비스 상태</h2><div class="panel pad"><div class="betarow"><div><b>${betaOn() ? '🧪 베타테스트 중' : '✅ 정식 서비스'}</b><small>${betaOn() ? '운영진이 신청자 순번을 바꿀 수 있어요(카톡 투표 결과 반영용).' : '신청 순번은 서버 도착 시각으로만 정해지고, 바꿀 수 없어요.'}</small></div><button class="btn ${betaOn() ? 'primary' : ''}" data-act="betatoggle">${betaOn() ? '정식 오픈하기' : '베타로 되돌리기'}</button></div></div>` : ''}
  ${S.admin ? (() => { const L = bootBgs(); const VG = 'linear-gradient(rgba(0,0,0,.62),rgba(0,0,0,.62))';
    return `<h2>로딩 화면 배경<small>최대 5장 · 앱을 열 때마다 무작위로 보여요</small></h2><div class="panel pad"><div class="bggrid">${Array.from({ length: 5 }, (_, i) => { const x = L[i];
      return x ? `<div class="bgslot" style="background-image:${VG},url('${x.img}')"><img src="${EMBLEM_SRC}" alt=""><button class="bgdel" data-act="bootbgdel" data-k="${x.id}" aria-label="${i + 1}번 배경 지우기">✕</button></div>` : `<label class="bgslot empty" style="cursor:pointer">＋<input type="file" accept="image/*" multiple data-in="bootbg" hidden></label>` }).join('')}</div>
    <p class="note" style="margin:8px 0 0">${L.length}/5장 · 사진 속 주인공이 가운데 엠블럼에 가리지 않게 크기와 위치를 자동으로 맞추고, 전체를 어둡게 처리해요. 여러 장을 한 번에 골라도 돼요.</p></div>` })() : ''}
  ${S.admin ? `<h2>운영모드 비밀번호</h2><div class="panel pad"><div class="pinrow"><input id="apc-cur" class="inp pin" type="text" inputmode="numeric" maxlength="8" placeholder="현재"><input id="apc-new" class="inp pin" type="text" inputmode="numeric" maxlength="8" placeholder="새 번호"><input id="apc-new2" class="inp pin" type="text" inputmode="numeric" maxlength="8" placeholder="새 번호 확인"></div><button class="btn block" style="margin-top:8px" data-act="adminpinchange">비밀번호 변경</button><p class="note" style="margin:6px 0 0">숫자 4~8자리. 바꾸면 모든 운영진이 새 번호로 들어와요.</p></div>` : ''}
  ${S.admin ? `<h2>시뮬레이션(연습 데이터)<small>가상 경기를 만들어 미리 해 보고 지워요</small></h2><div class="panel pad"><p class="muted" style="margin:0 0 10px">실제 회원 명단으로 원하는 단계의 가상 경기를 만들어요. 만든 뒤 바로 그 단계 화면으로 이동해요. 실제 경기와 회원 정보는 건드리지 않아요.</p>
    <div class="simgrid">${[...Object.entries(SIM).map(([k, [n]]) => [k, n, { apply: '신청 중인 경기, 신청자 12명', captain: '신청 마감, 18명 확정', draft: '주장 3명 입장한 드래프트 방', trade: '팀 구성이 끝난 상태' }[k], 'mksim']), ['mm', '경기모드', '팀 구성 완료, 오늘 날짜', 'mkpractice']].map(([k, n, d, act]) => { const cnt = Object.values(S.sessions).filter(x => x.practice && x.simKind === k).length;
      return `<div class="simcell"><button class="btn" data-act="${act}" data-k="${k}"><b>${n}</b><small>${d}</small></button><button class="btn sm danger" data-act="clrsim" data-k="${k}" ${cnt ? '' : 'disabled'}>지우기${cnt ? ` (${cnt})` : ''}</button></div>` }).join('')}</div>
    <button class="btn danger block" style="margin-top:10px" data-act="clrpractice">연습 데이터 모두 지우기${Object.values(S.sessions).filter(x => x.practice).length ? ` (${Object.values(S.sessions).filter(x => x.practice).length}개)` : ''}</button></div>` : ''}
  ${S.admin ? `<h2>샘플 데이터</h2><div class="panel pad"><p class="muted" style="margin:0 0 10px">화면 확인용 가상 회원, 지난 경기 2개, 다음 경기 1개를 넣거나 지워요. 직접 입력한 데이터는 건드리지 않아요.</p><div class="row"><button class="btn" data-act="addsample">샘플 데이터 넣기</button><button class="btn danger" data-act="clearsample">샘플 데이터 모두 지우기</button></div></div>` : ''}
  <div class="verbox"><div><span>앱 버전</span><b>${APP_VERSION}</b></div><div class="verbtns"><button class="btn sm" data-act="changelog">업데이트 내용</button><button class="btn sm" data-act="appreload">최신 버전 확인</button></div></div>
  <p class="note" style="text-align:center;margin:8px 0 0">새 기능이 안 보이면 "최신 버전 확인"을 눌러 주세요.</p></div>`;
}
/* ───────── member views ───────── */
function dt(str) { return str ? new Date(str) : null }
function fmtDT(str) { const d = dt(str); if (!d || isNaN(d)) return '-'; return `${d.getMonth() + 1}.${d.getDate()} (${DOW[d.getDay()]}) ${p2(d.getHours())}:${p2(d.getMinutes())}` }
function dday(id) { const [y, m, d] = id.split('-'); const t = new Date(); const a = new Date(+y, +m - 1, +d), b = new Date(t.getFullYear(), t.getMonth(), t.getDate()); const n = Math.round((a - b) / 864e5); return n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : `D+${-n}` }
function sStatus(s) {
  const ms = sessMatches(s.date); const now = nowS();
  if (ms.length && ms.every(m => m.status === 'done')) return { k: 'done', label: '경기 종료' };
  if (ms.some(m => m.status !== 'pending')) return { k: 'live', label: '경기 중' };
  if (stageIdx(s.stage) >= stageIdx('notice')) return { k: 'teams', label: '팀 발표' };
  if (s.draftStatus === 'live') return { k: 'draft', label: '드래프트 중' };
  if (s.room?.open && s.draftStatus === 'ready') return { k: 'draft', label: '드래프트 준비' };
  if (s.draftStatus === 'done') return { k: 'draft', label: '팀 구성 중' };
  const o = s.applyOpen ? dt(s.applyOpen).getTime() : 0, c = s.applyClose ? dt(s.applyClose).getTime() : Infinity;
  if (now < o) return { k: 'soon', label: '신청 예정' };
  if (now < c) return { k: 'open', label: '신청 중' };
  return { k: 'closed', label: '신청 마감' };
}
function nextSid() { const t = today(); const ids = Object.keys(S.sessions).sort(); return ids.find(id => id >= t && !isComplete(id)) || null }
function pastSids() { const t = today(); return Object.keys(S.sessions).filter(id => sessMatches(id).some(m => m.status === 'done') || (S.cut && id < S.cut && id < t && (S.sessions[id].stage === 'match' || S.sessions[id].imported))).sort().reverse() }
async function loadOld(sid) { if (!S.cut || sid >= S.cut || (S.oldLoaded ??= {})[sid] || !S.store?.query) return; S.oldLoaded[sid] = 1;
  try { const [ms, ev] = await Promise.all([S.store.query('matches', [['session', '==', sid]]), S.store.query('events', [['session', '==', sid]])]);
    S.oldMatches ??= {}; S.oldEvents ??= {}; ms.forEach(d => { const { id, ...r } = d; S.oldMatches[id] = r; S.matches[id] = r }); ev.forEach(d => { const { id, ...r } = d; S.oldEvents[id] = r; S.events[id] = r }); render() } catch (e) { S.oldLoaded[sid] = 0; console.warn(e) } }
function myPid() { return S.auth?.pid && S.players[S.auth.pid] ? S.auth.pid : null }
function myTeamIn(s) { const me = myPid(); return me ? KEYS.find(k => teamPlayers(s, k).includes(me)) || null : null }
function backbar(label) { return `<button class="backlink" data-act="sub" data-v="">‹ ${label}</button>` }

const XICO = { park: '<svg class="xi" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17h14M6 17V11l2-5h8l2 5v6"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/></svg>', ball: '<svg class="xi" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m12 7 4.5 3.3-1.7 5.2H9.2L7.5 10.3z"/></svg>', drink: '<svg class="xi" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10l-1 18H8z"/><path d="M7.5 9h9"/></svg>', pin: '<svg class="xi xpin" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>', clock: '<svg class="xi" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>', bell: '<svg class="xi" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>', home: '<svg class="xi" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/></svg>', cal: '<svg class="xi" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>', chart: '<svg class="xi" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>', user: '<svg class="xi" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>', run: '<svg class="xi" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v16M5 5h11l-2 4 2 4H5"/></svg>', mega: '<svg class="xi" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11v2l13 5V6zM16 9.5a3 3 0 0 1 0 5M7 13.5V19h3v-4.3"/></svg>', users: '<svg class="xi" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c1.8.6 3 2.4 3.5 5.5"/></svg>', gear: '<svg class="xi" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>', mm: '<svg class="xi mmi" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m12 7 4.5 3.3-1.7 5.2H9.2L7.5 10.3z"/></svg>' }; // A안 선 아이콘
function viewMHome() {
  if (S.sub) { const s = cur(); if (!s) { S.sub = null } else {
    const body = S.sub === 'draft' ? (s.draftStatus === 'done' ? vTrade(s) : vDraft(s)) : S.sub === 'poster' ? vNotice(s) : vMatchDay(s);
    if (S.sub === 'draft' && S.dm && s.draftStatus !== 'done') return `<div class="dmroot">${backbar('홈으로')}${vDraft(s)}</div>`;
    return backbar('홈으로') + body } }
  const sid = nextSid(); let h = ''; const fit = S.dm; let dock = '';
  const rvDown0 = fit && !!sid && S.sessions[sid]?.draftStatus !== 'done' && applyState(S.sessions[sid]).k !== 'none';
  h += `${fit ? `<div class="homefit${rvDown0 ? ' hf-scroll' : ''}">` : ''}<div class="dgrid homegrid"><section>`;
  // ── MATCH REVIEW ──
  const mdOn = !!(sid && S.sessions[sid]?.draftStatus === 'done'); // 팀 확정 후: 휴대폰에서는 오늘 경기 정보가 먼저 보이게 지난 경기 요약은 숨겨요
  const last = fit && mdOn ? null : pastSids().find(id => id !== sid);
  // 휴대폰에서 이미 신청했으면 신청 상태·주차·공당·물당 버튼이 먼저 보이게, 지난 경기는 아래로 내려요
  const rvDown = rvDown0 && !!last; let rv = '';
  if (!(fit && mdOn)) rv += `<div class="sec-lab"><span>MATCH REVIEW</span>${last ? `<small>${fmtDate(last)}</small>` : ''}</div>`;
  if (fit && mdOn) { }
  else if (!last) rv += `<div class="review empty-r">아직 지난 경기가 없어요.</div>`;
  else { const s = S.sessions[last]; const rows = standings(last); const mt = myTeamIn(s); const done = sessMatches(last).filter(m => m.status === 'done').length;
    rv += `<button class="review" data-act="result" data-id="${last}">${done < 9 ? `<div class="rv-note">${done}/9경기 기준</div>` : ''}
      <div class="rv-rows">${rows.map(r => { const t = team(s, r.k); return `<div class="rc-row ${mt === r.k ? 'mine' : ''} ${r.rank === 1 ? 'first' : ''}"><em class="rk rk${r.rank}">${r.rank === 1 ? '🏆' : r.rank}</em>${bib(t.color)}<span class="rcn"><b>${esc(t.name)}</b>${mt === r.k ? '<i class="mytag" title="내 팀">MY</i>' : ''}</span><span class="wdl"><i class="w">${r.w}승</i><i class="d">${r.d}무</i><i class="l">${r.l}패</i></span><span class="pt">${r.pts}점</span></div>` }).join('')}</div>
      ${(() => { const ms = sessMatches(last); if (!ms.length) return ''; return `<div class="rv-games">${ms.map(m => { const [a, b] = score(m); const H = team(s, m.home), A = team(s, m.away); return `<span class="rg ${m.status === 'done' ? '' : 'pend'}"><em>${m.n}</em>${bib(H.color)}<b>${m.status === 'pending' ? '-' : a}</b><i>:</i><b>${m.status === 'pending' ? '-' : b}</b>${bib(A.color)}</span>` }).join('')}</div>` })()}
      <span class="more">경기 결과 자세히 보기 ›</span></button>` }
  if (!rvDown) h += rv;
  h += '</section><section>';
  // ── NEXT MATCH ──
  h += `<div class="sec-lab"><span>NEXT MATCH</span></div>`;
  h += '<div class="nextwrap">';
  if (!sid) h += `<div class="hero"><div class="hero-empty">예정된 경기가 없어요</div><p>새 경기일이 열리면 여기에 보여요.</p></div>`;
  else { S.sid = sid; const s = S.sessions[sid]; const st = sStatus(s); const n = appTotal(s); const cap = s.capacity || 0; const [, m, d] = sid.split('-');
    h += `<div class="hero ${s.draftStatus === 'done' ? 'md' : ''}"><div class="hero-top"><span class="st st-${st.k}">${st.label}</span><span class="dday">${dday(sid)}</span></div>
      <div class="hero-date">${m}.${d}<small>${dow(sid)}요일</small></div><div class="hero-info"><div class="hi-row hi-time"><span class="hi-ico">${XICO.clock}</span><b>${esc(s.time || '시간 미정')}</b><small>킥오프</small></div>
      <div class="hi-row hi-venue"><span class="hi-ico">${XICO.pin}</span><b>${esc(s.venue || '장소 미정')}</b></div></div>
      ${st.k === 'open' && s.applyClose ? `<div class="hero-status"><span>${fmtDT(s.applyClose)} 신청 마감</span></div>` : st.k === 'soon' && s.applyOpen ? `<div class="hero-status"><span>${fmtDT(s.applyOpen)} 신청 오픈</span></div>` : ''}
      <div class="cap capbtn" role="button" tabindex="0" data-act="applist" data-id="${sid}" aria-label="신청 현황 보기"><div class="cap-row"><span>신청 인원${appCounts(s).wait ? ` · 대기 ${appCounts(s).wait}` : ''}<em class="caplink">신청 현황 ›</em></span><b>${n}<small> / ${cap || '-'}명</small></b></div>${cap ? `<div class="bar"><i style="width:${Math.min(100, n / cap * 100)}%"></i></div>` : ''}</div></div>`;
    h += homeAction(s, st, fit);
    if (fit) { const a = applyState(s); if (st.k === 'open' || st.k === 'soon' || (st.k === 'closed' && a.k !== 'none' && s.stage !== 'match')) { const ab = applyBox(s, true); if (ab) h += `<div class="inline-apply">${ab}</div>` } }
  }
  if (rvDown) h += `</div><div class="rv-down">${rv}`;
  return h + `</div></section></div>${fit ? '</div>' : ''}${dock}`;
}
function homeAction(s, st, fit) {
  const mt = myTeamIn(s); const AB = fit ? () => '' : applyBox;
  if (fit && (st.k === 'open' || st.k === 'soon')) return '';
  if (st.k === 'soon') return `<div class="act"><b>신청 오픈 전이에요</b><p>${fmtDT(s.applyOpen)}부터 앱에서 신청할 수 있어요.</p>${AB(s)}</div>`;
  if (st.k === 'open') { const ac = appCounts(s); const left = (s.capacity || 0) - ac.sel; return `<div class="act"><b>지금 신청 받는 중이에요</b><p>${[s.capacity ? (left > 0 ? `남은 자리 ${left}명` : `정원이 찼어요, 대기 ${ac.wait}명`) : '', s.applyClose ? `${fmtDT(s.applyClose)} 마감` : ''].filter(Boolean).join(', ')}</p>${AB(s)}${(s.applicants || []).length ? `<button class="btn sm" data-act="applist">신청자 보기</button>` : ''}</div>` }
  const capHint = '';
  const dl = dutyLine(s);
  if (st.k === 'closed') return `<div class="act"><b>신청이 마감됐어요</b>${dl}<p>선발 ${appCounts(s).sel}명으로 드래프트를 준비해요.</p>${AB(s)}${fit ? '' : capsLine(s)}${capHint}<button class="btn sm" data-act="applist">신청자 보기</button></div>`;
  if (st.k === 'draft' && s.draftStatus === 'done') return `<div class="act"><b>팀이 정해졌어요</b><p>운영진이 팀 밸런스를 마지막으로 맞추고 있어요.</p></div>${matchdayCard(s, fit)}`;
  if (st.k === 'draft') { const live = s.draftStatus !== 'done'; return `<div class="act live">${dl}<b>${live ? `<span class="dot"></span> ${s.draftStatus === 'live' ? '지금 드래프트 중이에요' : '드래프트 방이 열렸어요'}` : '팀 밸런스를 맞추는 중이에요'}</b>${fit ? '' : capsLine(s)}<button class="btn primary block" data-act="sub" data-v="draft">${live ? '드래프트 테이블 구경하기' : '팀 구성 보기'}</button>${live ? capHint : ''}</div>` }
  if (st.k === 'teams') return matchdayCard(s, fit);
  const live = sessMatches(s.date).filter(m => m.status === 'live');
  return `<div class="act live"><b><span class="dot"></span> 경기 진행 중</b>${live.map(m => { const [a, b] = score(m); return `<div class="lv">${bib(team(s, m.home).color)}${esc(team(s, m.home).name)} <b>${a} : ${b}</b> ${esc(team(s, m.away).name)}${bib(team(s, m.away).color)} <span data-clock="${m.id}"></span></div>` }).join('')}<button class="btn primary block" data-act="sub" data-v="match">경기 현황과 순위 보기</button></div>${matchdayCard(s, fit, true)}`;
}
/* 팀 확정 후 ~ 경기 끝: 홈에서 공당·물당·주차와 팀 명단을 바로 보여줘요 */
function mdHelpers(s) { const d = s.duty || {}; const me = myPid(); const car = me ? (s.park || {})[me]?.car : '';
  const tile = (k, nm, ids, sub) => { const mine = ids.includes(me); return `<div class="mdt ${mine ? 'mine' : ''} ${ids.length ? '' : 'none'}"><div class="mdt-hd">${XICO[k]}<b>${nm}</b>${mine ? '<i class="mdt-me">나</i>' : ''}</div><div class="mdt-ns">${ids.length ? ids.map(id => `<span class="${id === me ? 'me' : ''}">${esc(pname(id))}</span>`).join('') : '<em>미정</em>'}</div>${mine && sub ? `<small>${sub}</small>` : ''}</div>` };
  return `<div class="mdh">${tile('ball', '공당', d.ball || [], '공을 챙겨 와 주세요')}${tile('drink', '물당', d.drink || [], '물을 챙겨 와 주세요')}${tile('park', '주차', s.parkWin || [], car ? `내 차 ${esc(car)}` : '주차 등록돼요')}</div>` }
function rosterGrid(s) { const me = myPid(); const mt = myTeamIn(s); const ks = mt ? [mt, ...KEYS.filter(k => k !== mt)] : KEYS;
  return `<div class="rgrid">${ks.map(k => { const t = team(s, k); const ps = teamPlayers(s, k); const cap = captainOf(s, k);
    return `<div class="rcard ${k === mt ? 'mine' : ''}" style="--tc:${t.color};--ti:${inkOn(t.color)}"><div class="rcard-hd"><b>${esc(t.name)}</b><span>${ps.length}명</span></div><ol>${ps.map(id => `<li class="${id === me ? 'me' : ''}">${id === cap ? '<i class="cb">C</i>' : ''}<span>${esc(pname(id))}</span>${id === me ? '<i class="mdt-me">나</i>' : ''}</li>`).join('')}</ol></div>` }).join('')}</div>` }
function matchdayCard(s, fit, live) { const mt = myTeamIn(s); const t = mt && team(s, mt);
  return `<div class="mdcard"><div class="md-lab"><span>MATCHDAY · ${fmtDate(s.date)}</span>${live ? '<i class="mdlive">LIVE</i>' : s.draftStatus === 'done' && s.stage === 'trade' ? '<i class="mdadj">팀 조정 중</i>' : ''}</div>
    ${mdHelpers(s)}
    <div class="md-team">${t ? `<div class="md-my" style="--tc:${t.color};--ti:${inkOn(t.color)}"><span>내 팀</span><b>${esc(t.name)}</b><small>주장 ${esc(pname(captainOf(s, mt)) || '-')} · ${teamPlayers(s, mt).length}명</small></div>` : '<div class="md-my none"><span>팀 명단</span><b>3팀</b></div>'}
    ${fit ? `<button class="btn md-rbtn" data-act="rosters" data-id="${s.date}">팀 명단 보기</button>` : ''}</div>
    ${fit ? '' : rosterGrid(s)}</div>` }
function capsLine(s) { const ks = KEYS.filter(k => s.captains?.[k]); return ks.length ? `<div class="caps">${ks.map(k => `${tag(team(s, k))}<span>👑 ${esc(pname(s.captains[k]))}</span>`).join('')}</div>` : '' }
function rostersMini(s) { const me = myPid(); return `<div class="rosters">${KEYS.map(k => { const t = team(s, k); return `<div><div class="rh" style="background:${t.color};color:${inkOn(t.color)}">${esc(t.name)}</div><ul>${teamPlayers(s, k).map((id, i) => `<li class="${id === me ? 'me' : ''}">${i === 0 && captainOf(s, k) === id ? '👑' : ''}${esc(pname(id))}</li>`).join('')}</ul></div>` }).join('')}</div>` }

function calEvent(id) { const s = S.sessions[id] || {}; const st = new Date(`${id}T${s.time || '21:00'}:00+09:00`), en = new Date(st.getTime() + 2 * 3600e3);
  const z = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); const club = CFG.club?.short || 'WF';
  return { title: `${club} 풋살${s.no ? ` ${s.no}회` : ''}`, loc: s.venue || '', desc: `${CFG.club?.name || 'WEEKDAYS FUTSAL CLUB'} 경기${s.applyClose ? `\n신청 마감: ${fmtDT(s.applyClose)}` : ''}\n${location.origin + location.pathname}`, start: z(st), end: z(en) } }
function calIcs(id) { const e = calEvent(id); const x = t => String(t).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WD_FUTSAL//KO', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:wf-${id}@weekdaysfutsal`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`, `DTSTART:${e.start}`, `DTEND:${e.end}`, `SUMMARY:${x(e.title)}`, `LOCATION:${x(e.loc)}`, `DESCRIPTION:${x(e.desc)}`, 'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${x(e.title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') }
function calGoogle(id) { const e = calEvent(id); return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${e.start}/${e.end}&location=${encodeURIComponent(e.loc)}&details=${encodeURIComponent(e.desc)}` }
async function calDownload(id) { const b = new Blob([calIcs(id)], { type: 'text/calendar' }); const name = `WF_경기_${id.slice(5).replace('-', '')}.ics`;
  if (S.store?.dl) { try { await S.store.dl.save({ filename: name, data: b }); return } catch { } }
  const file = new File([b], name, { type: 'text/calendar' }); if (isIOS() && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return } catch (e) { if (e.name === 'AbortError') return } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1500); toast('일정 파일을 받았어요. 파일을 열면 캘린더에 추가돼요.') }
function schedCard(id, noApply) { let h = '';
  const ids = [id];
  for (const id of ids) { const s = S.sessions[id]; const st = sStatus(s); const now = Date.now();
    const steps = [['신청 오픈', s.applyOpen, s.applyOpen && dt(s.applyOpen) <= now], ['신청 마감', s.applyClose, s.applyClose && dt(s.applyClose) <= now], ['팀 발표', null, stageIdx(s.stage) >= stageIdx('notice')], ['경기', `${id}T${s.time || '00:00'}`, st.k === 'live' || st.k === 'done']];
    const curI = steps.findIndex(x => !x[2]);
    h += `<div class="panel sched"><div class="sched-hd"><div><b>${fmtDate(id)} ${esc(s.time || '')}</b><span>📍 ${esc(s.venue || '')}</span></div><span class="dday sm">${dday(id)}</span></div>
      <ol class="tl">${steps.map(([l, v, done], i) => `<li class="${done ? 'done' : i === curI ? 'now' : ''}"><i></i><span>${l}</span><em>${v ? fmtDT(v) : done ? '완료' : i === 2 ? '신청 마감 후' : '-'}</em></li>`).join('')}</ol>
      <div class="sched-ft"><span class="st st-${st.k}">${st.label}</span><button class="linkbtn appcnt" data-act="applist" data-id="${id}">신청 ${appTotal(s)}${s.capacity ? ' / ' + s.capacity : ''}명${appCounts(s).wait ? `, 대기 ${appCounts(s).wait}` : ''} ›</button>${id >= today() ? `<button class="btn sm calbtn" data-act="caladd2" data-id="${id}">📅 캘린더에 추가</button>` : ''}</div>${noApply ? '' : (st.k === 'open' || applyState(s)?.k === 'in' ? `<div style="margin-top:10px">${applyBox(s, true)}</div>` : '')}</div>` }
  return h }
function viewSchedule() {
  const all = Object.keys(S.sessions).sort(); const nx = nextSid(); const fit = S.dm;
  if (!S.schSel || !S.sessions[S.schSel]) S.schSel = nx || all[all.length - 1] || today();
  const ym = S.schM || S.schSel.slice(0, 7); const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate(), pad = first.getDay(), t = today(); const rows = Math.ceil((pad + days) / 7);
  let cells = ''; for (let i = 0; i < pad; i++) cells += '<span class="scd blank"></span>';
  for (let d = 1; d <= days; d++) { const id = `${y}-${p2(m)}-${p2(d)}`; const s = S.sessions[id]; const wd = (pad + d - 1) % 7; const st = s ? sStatus(s) : null;
    cells += `<button class="scd${s ? ' has st-' + st.k : ''}${id === t ? ' today' : ''}${id === S.schSel ? ' sel' : ''}${id < t ? ' past' : ''}${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}" data-act="schday" data-id="${id}" aria-pressed="${id === S.schSel}"><span class="dn">${d}</span>${s ? `<em class="ev"><b>${esc((s.time || '').slice(0, 5))}</b><small>${esc(s.venue || '')}</small></em>` : ''}</button>` }
  for (let i = pad + days; i < rows * 7; i++) cells += '<span class="scd blank"></span>';
  const cnt = all.filter(id => id.startsWith(ym)).length;
  const cal = `<div class="scal panel"><div class="cal-hd"><button data-act="schm" data-d="-1" aria-label="이전 달">‹</button><b>${y}년 ${m}월<small>${cnt ? ` · 경기 ${cnt}회` : ''}</small></b><button data-act="schm" data-d="1" aria-label="다음 달">›</button></div>
    <div class="scw">${'일월화수목금토'.split('').map((x, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${x}</span>`).join('')}</div>
    <div class="scgrid" style="grid-template-rows:repeat(${rows},minmax(0,1fr))">${cells}</div>
    <div class="cal-leg"><span><i class="lg-open"></i>신청 중</span><span><i class="lg-game"></i>경기</span><span><i class="lg-done"></i>종료</span><span><i class="lg-sel"></i>선택한 날</span></div></div>`;
  const sel = S.sessions[S.schSel];
  const det = sel ? schedCard(S.schSel, fit) : `<div class="panel sched"><p class="empty">${fmtDate(S.schSel)}에는 경기가 없어요.<br>색칠된 날짜를 눌러 보세요.</p></div>`;
  const dock = '';
  return `<div class="schwrap${fit ? ' schfit' : ''}">${cal}<div class="schdetail">${det}</div></div>${dock}`;
}

function sessEvents(s) { const ids = new Set(sessMatches(s.date).map(m => m.id)); return Object.entries(S.events).filter(([, e]) => ids.has(e.match)).map(([id, e]) => ({ id, ...e })).sort((a, b) => (a.sec ?? 0) - (b.sec ?? 0)) }
function pTeamK(s, id) { return KEYS.find(k => (s.teams?.[k]?.players || []).includes(id)) }
function scorerRank(s) { const R = {}; let ogN = 0; const g = id => (R[id] ??= { id, g: 0, a: 0 });
  sessEvents(s).forEach(e => { if (e.og) { ogN++; return } if (e.scorer) g(e.scorer).g++; if (e.assist) g(e.assist).a++ });
  const list = Object.values(R).filter(r => r.g > 0).sort((x, y) => y.g - x.g || y.a - x.a || pname(x.id).localeCompare(pname(y.id), 'ko'));
  list.forEach((r, i) => { r.rank = i && list[i - 1].g === r.g && list[i - 1].a === r.a ? list[i - 1].rank : i + 1; const k = pTeamK(s, r.id); if (k) { const t = team(s, k); r.color = t.color; r.tname = t.name } });
  list.ogN = ogN; return list }
function rdScorers(s, m) { const evs = Object.values(S.events).filter(e => e.match === m.id).sort((a, b) => (a.sec ?? 0) - (b.sec ?? 0)); if (!evs.length) return '';
  const col = k => { const map = new Map(); evs.filter(e => e.team === k).forEach(e => { const key = e.og ? 'og:' + (e.scorer || '') : (e.scorer || '-'); const o = map.get(key) || { n: 0, e }; o.n++; map.set(key, o) });
    return [...map.values()].map(({ n, e }) => `<span class="${e.og ? 'og' : ''}">${e.scorer ? esc(pname(e.scorer)) : '미지정'}${n > 1 ? ` <b>×${n}</b>` : ''}${e.og ? ' <small>자책</small>' : ''}</span>`).join('') };
  return `<div class="rdsc"><div class="h">${col(m.home)}</div><i aria-hidden="true">⚽</i><div class="a">${col(m.away)}</div></div>` }
function vResultDetail(s) {
  const sid = s.date; const ms = sessMatches(sid); const done = ms.filter(m => m.status === 'done').length; const rows = standings(sid); const me = myPid();
  const st = `<div class="panel tblwrap"><table class="rdst"><thead><tr><th>순위</th><th class="l">팀</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>득</th><th>실</th><th>득실</th><th>승점</th></tr></thead><tbody>
    ${rows.map(r => { const t = team(s, r.k); return `<tr class="${r.rank === 1 && done === ms.length && ms.length ? 'champ' : ''}"><td class="rank"><em class="rk rk${r.p ? r.rank : 0}">${r.p ? r.rank : '-'}</em></td><td class="l"><span class="teamcell">${bib(t.color)}<b>${esc(t.name)}</b></span></td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}</td><td>${r.ga}</td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td><td class="pts">${r.pts}</td></tr>` }).join('')}</tbody></table></div>
    <p class="note">승 3점, 무 1점. 승점이 같으면 골득실, 다득점, 승자승 순.</p>`;
  const tm = `<div class="rdteams">${KEYS.map(k => { const t = team(s, k); const ps = teamPlayers(s, k); const rk = rows.find(r => r.k === k);
    return `<div class="rdt" style="--tc:${t.color};--ti:${inkOn(t.color)}"><div class="rdt-hd"><b>${esc(t.name)}</b><small>${rk && rk.p ? rk.rank + '위' : ''}</small></div><ul>${ps.map((id, i) => `<li class="${id === me ? 'me' : ''}">${i === 0 && captainOf(s, k) === id ? '<em>C</em>' : ''}${esc(pname(id))}</li>`).join('')}</ul></div>` }).join('')}</div>`;
  const mrowR = m => { const H = team(s, m.home), A = team(s, m.away); const [a, b] = score(m); const win = m.status === 'done' ? (a > b ? 'win-h' : a < b ? 'win-a' : '') : '';
    return `<button class="mrow ${win}" data-act="open" data-id="${m.id}"><span class="side">${bib(H.color)}<span>${esc(H.name)}</span></span><span class="mid"><span class="sc">${m.status === 'pending' ? 'vs' : a + ' : ' + b}</span><span class="st">${m.n}경기${m.status === 'done' ? '' : m.status === 'live' ? ' · 진행 중' : ' · 예정'}</span></span><span class="side r"><span>${esc(A.name)}</span>${bib(A.color)}</span></button>${rdScorers(s, m)}` };
  const rounds = [1, 2, 3].map(r => { const list = ms.filter(m => m.round === r); return list.length ? `<div class="rdround"><h3>${r}라운드</h3><div class="panel">${list.map(mrowR).join('')}</div></div>` : '' }).join('');
  const rk = scorerRank(s); const myRank = rk.find(r => r.id === me);
  const rkHtml = rk.length ? `<div class="panel rdrank">${rk.map(r => `<div class="rkrow ${r.id === me ? 'me' : ''}" style="--tc:${r.color || 'var(--line)'}"><em class="rkn ${r.rank <= 3 ? 'top' : ''}">${r.rank}</em><i class="rkb"></i><span class="rknm"><b>${esc(pname(r.id))}</b>${r.tname ? `<small>${esc(r.tname)}</small>` : ''}</span><span class="rkst"><span class="g"><b>${r.g}</b><small>골</small></span>${r.a ? `<span class="a"><b>${r.a}</b><small>도움</small></span>` : ''}</span></div>`).join('')}</div>${rk.ogN ? `<p class="note">자책골 ${rk.ogN}골은 개인 득점에서 빠져요.</p>` : ''}` : '<div class="panel"><p class="empty">선수 이름으로 기록된 골이 없어요.</p></div>';
  return `<div class="rdgrid"><section class="rd-st"><h2>팀 순위${done === ms.length && ms.length ? '<span class="final">최종</span>' : ''}</h2>${st}</section>
  <section class="rd-tm"><h2>팀 구성</h2>${tm}</section>
  <section class="rd-rk"><h2>득점 순위${myRank ? `<small>나 ${myRank.rank}위 · ${myRank.g}골</small>` : ''}</h2>${rkHtml}</section>
  <section class="rd-ms"><h2>경기별 결과</h2>${ms.length ? `<div class="rounds3">${rounds}</div>` : '<div class="panel"><p class="empty">경기 기록이 없어요.</p></div>'}</section></div>`;
}
/* ───────── 출석 현황 ───────── */
function attPids(s) { const ps = new Set(); KEYS.forEach(k => (s.teams?.[k]?.players || []).forEach(p => p && ps.add(p))); if (!ps.size) (s.applicants || []).forEach(p => p && ps.add(p)); return [...ps] }
function attFind(n) { const id = findPlayer(n); if (id) return id; const k = normName(String(n).replace(/\(M\)|\d+/gi, '')); if (!k) return null; const hit = Object.entries(S.players).filter(([, p]) => normName(String(p.name || '').replace(/\(M\)|\d+/gi, '')) === k); return hit.length === 1 ? hit[0][0] : null }
function attUp() { return S.meta?.att || {} } // 업로드한 지난 출석 기록 { dates: {날짜: [pid]}, base: {pid: 횟수}, baseTotal }
function attEntries(period) { const t = today(); const up = attUp().dates || {}; const E = {};
  Object.keys(S.sessions).forEach(id => { const s = S.sessions[id]; if (id <= t && (s.stage === 'match' || s.imported)) { const ps = attPids(s); if (ps.length) E[id] = ps } });
  loadSheetRec(); const seed = sheetAttNamed(); const nm0 = attUp().named || {}; const nm = {}; Object.keys(seed).forEach(d => { if (!up[d] && !nm0[d]) nm[d] = seed[d] }); Object.assign(nm, nm0);
  [...new Set([...Object.keys(up), ...Object.keys(nm)])].forEach(d => { if (d > t || E[d]) return; const ps = new Set((up[d] || []).filter(p => S.players[p])); (nm[d] || []).forEach(n => { const id = attFind(n); if (id) ps.add(id) }); if ((up[d] || []).length || (nm[d] || []).length) E[d] = [...ps] });
  let ids = Object.keys(E).sort();
  if (period === 'year') ids = ids.filter(id => id.startsWith(t.slice(0, 4)));
  else if (period === '3m') { const d = new Date(); d.setMonth(d.getMonth() - 3); const cut = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; ids = ids.filter(id => id >= cut) }
  return { ids, E } }
function attSessions(period) { return attEntries(period).ids }
function attRows(period) { const { ids, E } = attEntries(period); const m = {}; ids.forEach(id => E[id].forEach(p => (m[p] ??= []).push(id)));
  const up = attUp(); const useBase = period === 'all'; const base = useBase ? (up.base || {}) : {}; const total = ids.length + (useBase ? (+up.baseTotal || 0) : 0);
  const pids = new Set([...Object.keys(m), ...Object.keys(base).filter(p => S.players[p]), ...Object.keys(S.players).filter(id => !['guest', 'dormant'].includes(mstatus(S.players[id])))]);
  const rows = [...pids].filter(id => S.players[id]).map(id => { const a = m[id] || []; const b = +base[id] || 0; let st = 0; for (let i = ids.length - 1; i >= 0 && a.includes(ids[i]); i--) st++; const n = a.length + b;
    return { id, n, base: b, rate: total ? Math.min(1, n / total) : 0, last: a[a.length - 1] || '', dates: a, streak: st, guest: mstatus(S.players[id]) === 'guest' } });
  rows.sort((x, y) => y.n - x.n || (y.last > x.last ? 1 : y.last < x.last ? -1 : 0) || pname(x.id).localeCompare(pname(y.id), 'ko'));
  let rk = 0, prev = -1; rows.forEach((r, i) => { if (r.n !== prev) { rk = i + 1; prev = r.n } r.rank = rk }); return { ids, rows, total } }
/* 지난 출석 기록 붙여넣기: ① 표(첫 줄 날짜, 각 줄 이름+O/X) ② 날짜 줄(날짜 이름 이름…) ③ 요약(이름 횟수) */
function attDate(t) { t = String(t || '').trim().replace(/[년월]/g, '.').replace(/일/g, '').replace(/\s+/g, ''); let m = t.match(/^(\d{2,4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\.?$/); let y, mo, d;
  if (m) { y = +m[1]; if (y < 100) y += 2000; mo = +m[2]; d = +m[3] } else { m = t.match(/^(\d{1,2})[.\-\/](\d{1,2})\.?$/); if (!m) return null; mo = +m[1]; d = +m[2]; y = +today().slice(0, 4); if (`${y}-${p2(mo)}-${p2(d)}` > today()) y-- }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null; return `${y}-${p2(mo)}-${p2(d)}` }
function attParse(text, total) { const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean); const res = { kind: '', dates: {}, base: {}, unknown: new Set(), baseTotal: 0 }; if (!lines.length) return res;
  const split = l => l.includes('\t') ? l.split('\t') : l.includes(',') ? l.split(',') : l.split(/\s+/); const pid = n => { n = String(n || '').trim(); if (!n) return null; const id = findPlayer(n); if (!id) res.unknown.add(n); return id };
  const head = split(lines[0]).map(x => x.trim()); const hd = head.slice(1).map(attDate);
  if (hd.filter(Boolean).length >= 1 && hd.filter(Boolean).length >= hd.length / 2) { res.kind = 'table'; const yes = /^(o|ㅇ|○|●|◯|v|✓|✔|y|yes|1|출|출석|참|참석|true)$/i;
    lines.slice(1).forEach(l => { const cs = split(l).map(x => x.trim()); const id = pid(cs[0]); if (!id) return; hd.forEach((d, i) => { if (d && yes.test(cs[i + 1] || '')) (res.dates[d] ??= []).push(id) }) }); return res }
  if (attDate(split(lines[0])[0])) { res.kind = 'dates'; lines.forEach(l => { const cs = split(l).map(x => x.trim()).filter(Boolean); const d = attDate(cs[0]); if (!d) return; cs.slice(1).forEach(n => { const id = pid(n); if (id && !(res.dates[d] ??= []).includes(id)) res.dates[d].push(id) }) }); return res }
  res.kind = 'summary'; res.baseTotal = Math.max(0, +total || 0); lines.forEach(l => { const cs = split(l).map(x => x.trim()).filter(Boolean); const num = cs.find(x => /^\d+$/.test(x)); const nm = cs.filter(x => !/^\d+$/.test(x)).join(''); if (!num || !nm) return; const id = pid(nm); if (id) res.base[id] = +num }); return res }
/* 엑셀(.xlsx) 읽기: 외부 라이브러리 없이 압축을 풀고 시트 XML을 읽어요 */
async function readXlsx(buf) { const u8 = new Uint8Array(buf), dv = new DataView(buf); let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('엑셀 파일이 아니에요'); const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const files = {};
  for (let k = 0; k < n; k++) { const meth = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)); files[name] = { meth, csz, lo }; p += 46 + nl + xl + cl }
  const get = async name => { const f = files[name]; if (!f) return null; const ds = f.lo + 30 + dv.getUint16(f.lo + 26, true) + dv.getUint16(f.lo + 28, true); const raw = u8.subarray(ds, ds + f.csz);
    if (f.meth === 0) return new TextDecoder().decode(raw); const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')); return await new Response(s).text() };
  const X = t => new DOMParser().parseFromString(t || '<x/>', 'application/xml'); const ss = [...X(await get('xl/sharedStrings.xml')).getElementsByTagName('si')].map(e => e.textContent);
  const wb = X(await get('xl/workbook.xml')), rel = X(await get('xl/_rels/workbook.xml.rels')); const rmap = {}; [...rel.getElementsByTagName('Relationship')].forEach(r => rmap[r.getAttribute('Id')] = r.getAttribute('Target'));
  const out = []; for (const sh of wb.getElementsByTagName('sheet')) { const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'); let tg = rmap[rid] || ''; tg = tg.replace(/^\/?xl\//, ''); const doc = X(await get('xl/' + tg)); const rows = [];
    for (const c of doc.getElementsByTagName('c')) { const ref = c.getAttribute('r') || ''; const m = ref.match(/^([A-Z]+)(\d+)$/); if (!m) continue; let col = 0; for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64; const row = +m[2] - 1; const t = c.getAttribute('t'); const v = c.getElementsByTagName('v')[0]?.textContent;
      let val = t === 's' ? ss[+v] : t === 'inlineStr' ? c.textContent : t === 'b' ? v === '1' : t === 'str' ? v : v != null && v !== '' ? +v : null; (rows[row] ??= [])[col - 1] = val }
    out.push({ name: sh.getAttribute('name'), rows }) } return out }
function attFromSheets(sheets) { const res = { kind: 'xlsx', dates: {}, named: {}, unknown: new Set(), sheets: [], base: {}, baseTotal: 0 }; const yes = /^(o|ㅇ|○|●|◯|v|✓|✔|y|1|출|출석|참|참석|주|당|true)$/i;
  const toD = v => { if (typeof v === 'number' && v > 30000 && v < 70000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}` } return typeof v === 'string' ? attDate(v) : null };
  const pick = sheets.filter(s => /출결|출석/.test(s.name) && !/용어|설정|test/i.test(s.name)); for (const sh of (pick.length ? pick : sheets.filter(s => !/test/i.test(s.name)))) { const R = sh.rows; let hi = -1, dcols = []; for (let i = 0; i < Math.min(R.length, 15); i++) { const ds = (R[i] || []).map((v, j) => [j, toD(v)]).filter(x => x[1]); if (ds.length >= 3) { hi = i; dcols = ds; break } } if (hi < 0) continue;
    const first = dcols[0][0]; let nc = 0, best = -1; for (let j = 0; j < first; j++) { const cnt = R.slice(hi + 1).filter(r => typeof r?.[j] === 'string' && r[j].trim()).length; if (cnt > best) { best = cnt; nc = j } }
    const yr = {}; dcols.forEach(([, d]) => yr[d.slice(0, 4)] = (yr[d.slice(0, 4)] || 0) + 1); const Y = Object.entries(yr).sort((a, b) => b[1] - a[1])[0][0]; const got = {};
    R.slice(hi + 1).forEach(r => { const raw = r?.[nc]; if (typeof raw !== 'string') return; if (/총인원|표기법|^\s*[(\-]/.test(raw)) return; const nm = raw.replace(/\(M\)|\(m\)|\d+|\?/g, '').trim(); if (!nm) return;
      dcols.forEach(([j, d]) => { const v = r[j]; if ((typeof v === 'number' && v > 0) || (typeof v === 'string' && yes.test(v.trim()))) (got[d] ??= new Set()).add(nm) }) });
    let used = 0; Object.entries(got).forEach(([d, set]) => { const dd = d.slice(0, 4) === Y ? d : Y + d.slice(4); used++; set.forEach(nm => { const id = attFind(nm); if (id) { if (!(res.dates[dd] ??= []).includes(id)) res.dates[dd].push(id) } else { res.unknown.add(nm); if (!(res.named[dd] ??= []).includes(nm)) res.named[dd].push(nm) } }) });
    if (used) res.sheets.push(`${sh.name} ${used}경기`) }
  return res }
function attImpSheet() { const st = S.attImp || {}; const r = st.res; const up = attUp(); const nd = new Set([...Object.keys(up.dates || {}), ...Object.keys(up.named || {})]).size, nb = Object.keys(up.base || {}).length;
  return `<h4>⬆ 지난 출석 기록 올리기</h4><p>엑셀·구글시트에서 복사해서 붙여넣으면 돼요. 아래 세 가지 형식을 자동으로 알아봐요.</p>
  <div class="panel pad att-fmt"><b>① 출석표</b> 첫 줄에 날짜, 각 줄에 이름과 O/X (1, ✓, 출석도 돼요)<pre>이름	9.1	9.14	9.28\n김일	O		O\n이이	O	O	O</pre>
    <b>② 날짜별 명단</b> 줄마다 날짜와 그날 온 사람<pre>2026.09.01 김일 이이 박삼\n2026.09.14 이이 정오</pre>
    <b>③ 횟수 요약</b> 이름과 출석 횟수 (날짜 없이 합계만 있을 때)<pre>김일 12\n이이 15</pre></div>
  <div class="panel pad att-file"><b>📄 엑셀 파일로 올리기</b><p class="muted" style="margin:4px 0 8px">출석부 엑셀(.xlsx)을 고르면 '출결' 시트들을 읽어서 날짜별로 넣어요. 이름 뒤 생년월일·(M) 표시는 자동으로 빼고 맞춰요.</p><input type="file" id="att-file" accept=".xlsx"></div>
  <label class="field"><span>또는 붙여넣기</span><textarea id="att-txt" class="inp" rows="8" placeholder="여기에 붙여넣으세요">${esc(st.text || '')}</textarea></label>
  <label class="field"><span>③ 요약일 때 전체 경기 수 (출석률 계산용)</span><input id="att-tot" class="inp" type="number" min="0" value="${esc(st.total || '')}" placeholder="예: 20"></label>
  <div class="row"><button class="btn" data-act="attparse">확인하기</button></div>
  ${r ? `<div class="panel pad att-prev"><b>${{ xlsx: `엑셀 파일(${esc(st.fname || '')})을`, table: '① 출석표로', dates: '② 날짜별 명단으로', summary: '③ 횟수 요약으로' }[r.kind] || '알 수 없는 형식이에요. 예시를 확인해 주세요'}${r.kind ? ' 읽었어요' : ''}</b>${r.kind === 'xlsx' ? `<p class="muted" style="margin:4px 0 0">${r.sheets.map(esc).join(' · ') || '출결 시트를 찾지 못했어요'}</p>` : ''}
    <p>${r.kind === 'summary' ? `${Object.keys(r.base).length}명의 출석 횟수 · 전체 경기 ${r.baseTotal || '(입력 안 함)'}회` : `${new Set([...Object.keys(r.dates), ...Object.keys(r.named || {})]).size}경기 · 출석 ${Object.values(r.dates).reduce((a, b) => a + b.length, 0) + Object.values(r.named || {}).reduce((a, b) => a + b.length, 0)}건 (${Object.keys(r.dates).sort()[0] || '-'} ~ ${Object.keys(r.dates).sort().slice(-1)[0] || '-'})`}</p>
    ${r.unknown.size && r.kind === 'xlsx' ? `<p class="warn">ℹ️ 지금 회원 명단에 없는 이름 ${r.unknown.size}명도 이름으로 저장해 둬요. 나중에 같은 이름으로 회원을 추가하면 자동으로 출석이 이어져요: ${[...r.unknown].slice(0, 20).map(esc).join(', ')}${r.unknown.size > 20 ? ' …' : ''}</p>` : ''}${r.unknown.size && r.kind !== 'xlsx' ? `<p class="warn">⚠️ 회원 명단에 없는 이름 ${r.unknown.size}개는 빼고 저장해요: ${[...r.unknown].slice(0, 12).map(esc).join(', ')}${r.unknown.size > 12 ? ' …' : ''}</p>` : ''}
    <button class="btn primary block" data-act="attsave" ${(r.kind === 'summary' ? Object.keys(r.base).length : Object.keys(r.dates).length + Object.keys(r.named || {}).length) ? '' : 'disabled'}>저장하기</button></div>` : ''}
  ${nd || nb ? `<div class="panel pad" style="margin-top:10px"><b>지금 올라가 있는 기록</b><p class="muted" style="margin:4px 0 8px">${nd ? `날짜별 ${nd}경기` : ''}${nd && nb ? ' · ' : ''}${nb ? `횟수 요약 ${nb}명 (전체 ${up.baseTotal || 0}경기)` : ''}</p><button class="btn sm danger" data-act="attclear">올린 기록 모두 지우기</button></div>` : ''}
  <p class="note">같은 날짜를 다시 올리면 새 내용으로 바뀌어요. 앱에서 진행한 경기와 날짜가 겹치면 앱 기록이 우선이에요. 횟수 요약은 '전체' 기간에만 더해져요.</p>` }
function attPersonSheet(id) { const { rows, total } = attRows('all'); const r = rows.find(x => x.id === id) || { n: 0, rate: 0, dates: [], base: 0 }; const md = d => { const [y, mm, dd] = d.split('-'); return `${y.slice(2)}.${+mm}.${+dd}` };
  return `<h4>${esc(pname(id))} 출석 현황</h4><div class="att-me"><div class="am-top"><span>전체 출석</span><b>${r.n}<small>/${total}경기</small></b><em>${Math.round(r.rate * 100)}%</em></div><div class="att-bar big"><i style="width:${Math.round(r.rate * 100)}%"></i></div>
    <div class="am-sub">${r.last ? `최근 출석 ${fmtDate(r.last)}` : '날짜가 있는 출석 기록이 없어요'}${r.streak > 1 ? ` · 🔥 ${r.streak}경기 연속` : ''}${r.base ? ` · 이전 기록 ${r.base}회 포함` : ''}</div></div>
    ${r.dates.length ? `<b class="dk">참석한 경기 ${r.dates.length}회</b><div class="att-dates list">${r.dates.slice().reverse().map(d => `<span>${md(d)}</span>`).join('')}</div>` : ''}` }
function viewAttendance() { const per = S.attPer || 'all'; const { ids, rows, total } = attRows(per); const me = myPid(); const mine = rows.find(r => r.id === me);
  const pct = r => Math.round(r.rate * 100); const md = id => { const [, mm, dd] = id.split('-'); return `${+mm}.${+dd}` };
  let h = `<div class="att"><div class="att-hd"><div><b>출석 현황</b><small>끝난 경기 ${total}회 기준${total !== ids.length ? ` (올린 기록 포함)` : ''}</small></div><div class="seg att-seg">${[['all', '전체'], ['year', '올해'], ['3m', '최근 3개월']].map(([k, n]) => `<button role="tab" data-act="attper" data-k="${k}" aria-selected="${per === k}">${n}</button>`).join('')}</div></div>`;
  if (S.admin) h += `<div class="row att-adm"><button class="btn sm" data-act="attimp">⬆ 지난 출석 기록 올리기</button>${sheetLink()}</div>${sheetUrl() && S.sheetRec && !(S.sheetRec.attendance || []).length ? '<p class="notice warn">기록 시트에 아직 출석 기록이 없어요. 설정 → 기록 시트 연동에서 ‘지금까지 기록 모두 시트로 옮기기’를 누르거나, 출석부 엑셀을 다시 올려 주세요.</p>' : ''}`;
  if (!total) return h + `<div class="panel"><p class="empty">이 기간에 끝난 경기가 없어요.</p></div></div>`;
  if (mine && !S.admin) h += `<div class="att-me"><div class="am-top"><span>나의 출석</span><b>${mine.n}<small>/${total}경기</small></b><em>${pct(mine)}%</em></div><div class="att-bar big"><i style="width:${pct(mine)}%"></i></div>
    <div class="am-sub">${mine.last ? `최근 출석 ${fmtDate(mine.last)}` : '아직 출석 기록이 없어요'}${mine.streak > 1 ? ` · 🔥 ${mine.streak}경기 연속 출석 중` : ''}</div>
    ${mine.dates.length ? `<div class="att-dates">${mine.dates.slice().reverse().map(id => `<span>${md(id)}</span>`).join('')}</div>` : ''}</div>`;
  h += `<div class="panel tblwrap"><table class="att-tbl"><thead><tr><th>순위</th><th class="l">이름</th><th>출석</th><th class="l">출석률</th><th>최근</th></tr></thead><tbody>${rows.map(r => { const op = S.attOpen === r.id;
    return `<tr class="${r.id === me ? 'me' : ''} ${r.n ? '' : 'zero'}" data-act="attopen" data-id="${r.id}"><td class="ark">${r.n ? r.rank : '-'}</td><td class="l nm"><b>${esc(pname(r.id))}</b>${r.id === me ? '<i class="metag">나</i>' : ''}${r.streak > 2 ? `<small class="stk3">🔥${r.streak}</small>` : ''}</td><td class="num"><b>${r.n}</b></td><td class="l"><div class="att-rate"><div class="att-bar"><i style="width:${pct(r)}%"></i></div><span>${pct(r)}%</span></div></td><td class="num muted">${r.last ? md(r.last) : '-'}</td></tr>
      ${op ? `<tr class="att-open"><td colspan="5">${r.dates.length ? `<div class="att-dates">${r.dates.slice().reverse().map(id => `<span>${md(id)}</span>`).join('')}</div>` : '<span class="muted">출석한 경기가 없어요.</span>'}</td></tr>` : ''}` }).join('')}</tbody></table></div>
    <p class="note">팀에 들어가 경기를 뛴 날을 출석으로 세요. 이름을 누르면 출석한 날짜를 볼 수 있어요. 출석률은 이 기간의 끝난 경기 수 대비예요.</p></div>`;
  return h }
/* 화면 상단 하위 메뉴 (모든 화면 공통 모양) */
function subnav(items, cur, act) { return `<nav class="subnav" role="tablist">${items.map(([k, n]) => `<button role="tab" data-act="${act}" data-k="${k}" aria-selected="${cur === k}">${n}</button>`).join('')}</nav>` }
function viewResults() { const tg = subnav([['res', '경기 결과'], ['att', '출석 현황']], S.resv === 'att' ? 'att' : 'res', 'resv');
  const lk = canOp() && sheetView() ? `<div class="reslink">${sheetLink('linkbtn')}</div>` : ''; if (S.resv === 'att') return tg + lk + viewAttendance(); return tg + lk + viewResults0() }
function viewResults0() {
  const ids = pastSids(); if (!ids.length) return `<div class="panel"><p class="empty">아직 끝난 경기가 없어요.</p></div>`;
  if (!S.detail || !ids.includes(S.detail)) S.detail = ids[0];
  const i = ids.indexOf(S.detail); const s = S.sessions[S.detail]; S.sid = S.detail; loadOld(S.detail); const older = ids[i + 1], newer = ids[i - 1];
  return `<div class="rdswipe ${S.rdAnim || ''}"><div class="rdnav"><button class="navb" data-act="rdgo" data-id="${older || ''}" ${older ? '' : 'disabled'} aria-label="이전 경기">‹<small>이전</small></button>
    <div class="rdt2"><b>${fmtDate(S.detail)}</b><small>${esc(s.time || '')} · ${esc(s.venue || '')}${s.no ? ` · ${s.no}회` : ''}</small></div>
    <button class="navb" data-act="rdgo" data-id="${newer || ''}" ${newer ? '' : 'disabled'} aria-label="이후 경기"><small>이후</small>›</button></div>
    <div class="rddots">${ids.slice().reverse().map(id => `<i class="${id === S.detail ? 'on' : ''}"></i>`).join('')}</div>${vResultDetail(s)}</div>`;
}

function viewApplicants() { const s = cur(); const me = myPid(); const base = isBase(s); const c = classify(s); const frozen = s.stage !== 'apply';
  let rows = [...c.sel, ...c.wait];
  if (frozen) { const find = pid => c.rows.find(r => r.pid === pid) || { pid, n: '-', tier: 2 }; rows = [...(s.applicants || []).map(pid => ({ ...find(pid), sel: true })), ...(s.waitlist || []).map((pid, i) => ({ ...find(pid), sel: false, wn: i + 1 }))] }
  const byTime = S.apord === 'time'; if (byTime) rows = rows.slice().sort((a, b) => (a.auto ? 0 : 1) - (b.auto ? 0 : 1) || ((typeof a.n === 'number' ? a.n : 1e9) - (typeof b.n === 'number' ? b.n : 1e9)));
  const inList = new Set(rows.map(r => r.pid).filter(Boolean)); const late = Object.entries(s.late || {}).filter(([, v]) => v);
  const lateSet = new Set(late.map(([p0]) => p0)); const canc = Object.entries(s.cancels || {}).filter(([p0, v]) => v && !inList.has(p0) && !lateSet.has(p0));
  const off = [...late.map(([p0, t]) => ({ pid: p0, t, k: 'late' })), ...canc.map(([p0, t]) => ({ pid: p0, t, k: 'cancel' }))].filter(x => S.players[x.pid]).sort((a, b) => a.t - b.t);
  const mine = rows.find(r => r.pid && r.pid === me) || (!frozen && myApp(s) && rows.find(r => r.k === myApp(s).k));
  const myLine = mine ? `<div class="mypos ${mine.sel ? 'in' : 'wt'}">${mine.sel ? `✓ 나는 <b>선발</b>이에요${base ? ` · ${TIER[mine.tier]}` : ''}${typeof mine.n === 'number' ? ` · ${mine.n}번째 신청` : mine.auto ? ' · 자동 신청' : ''}` : `⏳ 나는 <b>대기 ${mine.wn}번</b>이에요${base ? ` · ${TIER[mine.tier]}` : ''}`}</div>` : '';
  const tr = r => `<tr class="${r.sel ? 'srow' : 'wrow'} ${mine && r === mine ? 'me' : ''}"><td class="num">${r.auto ? '자동' : r.n}</td><td class="nm"><b>${r.pid ? esc(pname(r.pid)) : '<i class="muted">이름 입력 대기</i>'}</b>${mine && r === mine ? '<i class="metag">나</i>' : ''}</td><td class="num muted">${r.at ? fmtTS(r.at).replace(/\.\d{3}$/, '') : '-'}</td>${base ? `<td><b class="tb t${r.tier}">${TIER[r.tier]}</b></td>` : ''}<td>${r.sel ? '<b class="ok">선발</b>' : `<b class="tw">대기 ${r.wn}</b>`}</td></tr>`;
  const cols = base ? 5 : 4;
  return '<div class="apwrap">' + backbar('홈으로') + myLine + `<h2>신청 현황<small>신청 ${rows.length}${s.capacity ? ' / ' + s.capacity : ''}명 · 선발 ${rows.filter(r => r.sel).length} · 대기 ${rows.filter(r => !r.sel).length}</small></h2>
  <div class="vtog" role="group" aria-label="정렬"><button class="btn sm${byTime ? '' : ' primary'}" data-act="apord" data-v="rank">순위순</button><button class="btn sm${byTime ? ' primary' : ''}" data-act="apord" data-v="time">신청순</button><small>${byTime ? '신청이 들어온 순서대로 보여요.' : '선발 → 대기 순서로 보여요.'}</small></div><div class="panel sheetwrap"><table class="grid aptbl"><colgroup><col class="c-n"><col class="c-nm"><col class="c-t">${base ? '<col class="c-r">' : ''}<col class="c-s"></colgroup><thead><tr><th>신청순</th><th>이름</th><th>신청 시각</th>${base ? '<th>순위</th>' : ''}<th>상태</th></tr></thead><tbody>
  ${rows.length ? (byTime ? rows.map(tr).join('') : (() => { const sel = rows.filter(r => r.sel), wt = rows.filter(r => !r.sel);
    return `<tr class="aphd in"><td colspan="${cols}">✅ 선발 ${sel.length}명</td></tr>${sel.map(tr).join('')}${wt.length ? `<tr class="apcut"><td colspan="${cols}"><span>✂ 여기까지 선발 · 아래는 대기</span></td></tr><tr class="aphd wt"><td colspan="${cols}">⏳ 대기 ${wt.length}명 <small>선발자가 취소하면 순서대로 올라가요</small></td></tr>${wt.map(tr).join('')}` : ''}` })()) : `<tr><td colspan="${cols}" class="empty">아직 신청자가 없어요.</td></tr>`}
  ${off.length ? `<tr class="offhd"><td colspan="${cols}">취소 ${off.length}명</td></tr>${off.map(x => `<tr class="offrow"><td class="num">-</td><td class="nm">${esc(pname(x.pid))}${x.pid === me ? '<i class="metag">나</i>' : ''}</td><td class="num muted">${fmtTS(x.t).replace(/\.\d{3}$/, '')}</td>${base ? '<td></td>' : ''}<td>${x.k === 'late' ? '<b class="t3">마감 후 취소</b>' : '<b class="muted">취소</b>'}</td></tr>`).join('')}` : ''}
  </tbody></table></div>
  <p class="note">${base ? '순위: 0순위 구장 예약자·경기 운영자 → 1순위 직전 경기 미참여 → 2순위 그 외 선착순 → 3순위 직전 경기 마감 후 취소자. 같은 순위 안에서는 신청 순서대로 선발돼요. ' : '이 구장은 순위 없이 신청한 순서대로 선발해요. '}신청 시각은 서버에 도착한 시각이에요. 취소한 시각은 이 버전부터 기록돼요.</p></div>` }
/* ───────── admin views ───────── */
async function deleteSessionBy(sid) { if (!confirm(fmtDate(sid) + ' 경기를 통째로 지울까요? 신청자, 경기 기록도 함께 지워지고 되돌릴 수 없어요.')) return;
  const ok = await w(async () => { const evs = new Set(Object.entries(S.events).filter(([, ev]) => ev.session === sid).map(([eid]) => eid)), mts = new Set(sessMatches(sid).map(m => m.id));
    try { (await S.store.query('events', [['session', '==', sid]])).forEach(d => evs.add(d.id)); (await S.store.query('matches', [['session', '==', sid]])).forEach(d => mts.add(d.id)) } catch { } // 90일 지난 기록도 함께 지워요
    for (const eid of evs) await S.store.del('events/' + eid); for (const id of mts) await S.store.del(mp(id)); await S.store.del(sp(sid)) }, '삭제했어요.');
  if (ok && S.sid === sid) S.sid = null; render() }
const RUN_STEPS = [['apply', '신청접수'], ['captain', '도우미 지정'], ['draft', '드래프트'], ['trade', '팀원조정'], ['match', '경기진행'], ['result', '경기결과']];
function stepDone(s, k) { if (k === 'result' || k === 'match') { const ms = sessMatches(s.date); return ms.length > 0 && ms.every(m => m.status === 'done') } if (k === 'notice') return stageIdx(s.stage) > stageIdx('notice'); return stageIdx(k) < stageIdx(s.stage) }
function shiftDate(sid, days, time) { const d = new Date(sid + 'T00:00'); d.setDate(d.getDate() - days); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${time || '12:00'}` }
function adminSid() { if (S.sid && S.sessions[S.sid]) return S.sid; return defaultSid() }
function viewManageList() {
  const t = today(); const f = S.mfilter || 'up';
  let ids = Object.keys(S.sessions).sort(); if (f === 'up') ids = ids.filter(id => id >= t); else if (f === 'past') ids = ids.filter(id => id < t).reverse();
  const all = Object.keys(S.sessions); const up = all.filter(id => id >= t).length;
  let h = `<div class="seg" role="tablist" style="margin-top:12px">${[['up', `예정 ${up}`], ['past', `지난 ${all.length - up}`], ['all', `전체 ${all.length}`]].map(([k, n]) => `<button role="tab" data-act="mfilter" data-k="${k}" aria-selected="${f === k}">${n}</button>`).join('')}</div>`;
  if (!ids.length) return h + `<div class="panel"><p class="empty">${f === 'up' ? '예정된 경기가 없어요. 달력에서 경기를 추가해 보세요.' : '경기가 없어요.'}</p></div>`;
  h += `<div class="panel sheetwrap"><table class="grid"><thead><tr><th class="stick">날짜</th><th>회차</th><th>시간</th><th>장소</th><th>정원</th><th>예약자 · 운영자</th><th>신청</th><th>공당 · 물당</th><th>주차</th><th>신청 오픈</th><th>신청 마감</th><th>상태</th><th>관리</th></tr></thead><tbody>
  ${ids.map(id => { const s = S.sessions[id]; const st = sStatus(s); const movable = !sessMatches(id).length;
    return `<tr><td class="stick"><button class="cellbtn" data-act="calmove" data-id="${id}" ${movable ? '' : 'disabled'} title="${movable ? '눌러서 날짜 변경' : '경기 기록이 있어 날짜를 바꿀 수 없어요'}"><b>${id.slice(5).replace('-', '.')}</b> <span class="dw${dow(id) === '일' ? ' sun' : dow(id) === '토' ? ' sat' : ''}">${dow(id)}</span></button></td>
      <td><input class="cell w-num" type="number" min="1" value="${s.no || ''}" placeholder="${(s._nn = nextNoFor(id)) || '-'}" title="비어 있으면 이전 회차 다음 번호(${s._nn || '없음'})를 추천해요" data-in="cell" data-sid="${id}" data-f="no"></td>
      <td><input class="cell" type="time" value="${esc(s.time || '')}" data-in="cell" data-sid="${id}" data-f="time"></td>
      <td><input class="cell w-venue" type="text" value="${esc(s.venue || '')}" list="venue-list" data-in="cell" data-sid="${id}" data-f="venue"></td>
      <td><input class="cell w-num" type="number" min="3" max="60" value="${s.capacity || ''}" data-in="cell" data-sid="${id}" data-f="capacity"></td>
      <td><button class="cellbtn staffcell" data-act="staffedit" data-id="${id}">${(s.p0 || []).length || (s.ops || []).length ? `<span>예약 ${esc(idsToNames(s.p0) || '-')}</span><span>운영 ${esc(idsToNames(s.ops) || '-')}</span>` : '<span class="muted">+ 지정</span>'}</button></td>
      <td class="num"><b>${appTotal(s)}</b>${s.capacity ? `<small class="muted"> / ${s.capacity}</small>` : ''}</td>
      <td><button class="cellbtn staffcell" data-act="dutyedit" data-id="${id}">${(s.duty?.ball || []).length || (s.duty?.drink || []).length ? `<span>공 ${esc(idsToNames(s.duty?.ball) || '-')}</span><span>물 ${esc(idsToNames(s.duty?.drink) || '-')}</span>` : `<span class="muted">${dutyReqLabel(s) || (applyClosed(s) ? '+ 지정' : '신청 없음')}</span>`}</button></td>
      <td><button class="cellbtn staffcell" data-act="parkedit" data-id="${id}"><span>신청 ${parkApps(s).length}명</span><span>${(s.parkWin || []).length ? '당첨 ' + esc(idsToNames(s.parkWin)) : '<span class="muted">추첨 전</span>'}</span></button></td>
      <td><input class="cell w-dt" type="datetime-local" value="${esc(s.applyOpen || '')}" data-in="cell" data-sid="${id}" data-f="applyOpen"></td>
      <td><input class="cell w-dt" type="datetime-local" value="${esc(s.applyClose || '')}" data-in="cell" data-sid="${id}" data-f="applyClose"></td>
      <td><span class="st st-${st.k}">${st.label}</span></td>
      <td class="acts"><button class="btn sm" data-act="gorun" data-id="${id}">진행</button><button class="btn sm" data-act="gonotice" data-id="${id}">공지</button><button class="btn sm danger" data-act="delrow" data-id="${id}" aria-label="삭제">삭제</button></td></tr>` }).join('')}</tbody></table></div>
  <p class="note">칸을 눌러 바로 고치면 저장돼요. 날짜를 누르면 달력에서 바꿀 수 있어요(경기 기록이 생기기 전까지). 표는 옆으로 밀어서 볼 수 있어요.</p>`;
  return h;
}
function calendarHTML() {
  const c = S.cal; const first = new Date(c.y, c.m, 1); const pad = first.getDay(); const days = new Date(c.y, c.m + 1, 0).getDate(); const t = today();
  let cells = ''; for (let i = 0; i < pad; i++) cells += '<span></span>';
  for (let d = 1; d <= days; d++) { const id = `${c.y}-${p2(c.m + 1)}-${p2(d)}`; const has = !!S.sessions[id]; const sel = c.sel.includes(id); const wd = (pad + d - 1) % 7;
    cells += `<button class="cd${sel ? ' sel' : ''}${has ? ' has' : ''}${id === t ? ' today' : ''}${id < t ? ' past' : ''}${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}" data-act="calday" data-id="${id}" ${has ? 'disabled' : ''} aria-pressed="${sel}">${d}</button>` }
  return `<div class="cal"><div class="cal-hd"><button data-act="calnav" data-d="-1" aria-label="이전 달">‹</button><b>${c.y}년 ${c.m + 1}월</b><button data-act="calnav" data-d="1" aria-label="다음 달">›</button></div>
  <div class="cal-grid">${'일월화수목금토'.split('').map((x, i) => `<span class="cw${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${x}</span>`).join('')}${cells}</div>
  <div class="cal-leg"><span><i class="lg-sel"></i>선택</span><span><i class="lg-has"></i>이미 있는 경기</span></div></div>`;
}
function calSheet() {
  const c = S.cal; const f = c.f;
  if (c.mode === 'move') return `<h4>${fmtDate(c.from)} 경기 날짜 변경</h4><p>새 날짜를 누르세요.</p>${calendarHTML()}<div class="row" style="margin-top:12px"><button class="btn primary" data-act="calmovego" ${c.sel.length ? '' : 'disabled'}>${c.sel.length ? fmtDate(c.sel[0]) + '로 변경' : '날짜를 고르세요'}</button></div>`;
  return `<h4>경기 추가</h4><p>날짜를 여러 개 눌러서 한 번에 추가할 수 있어요.</p>${calendarHTML()}
  <div class="panel" style="margin-top:12px"><div class="field grid2c"><label>시간<input class="inp" type="time" value="${esc(f.time)}" data-in="calf" data-f="time"></label><label>정원<input class="inp" type="number" min="3" max="60" value="${f.capacity}" data-in="calf" data-f="capacity"></label></div>
  <div class="field"><label>장소</label>${venuePicker(f.venueCustom ? (f.venue || '__custom') : f.venue, 'data-in="calfvenue"', 'data-in="calf" data-f="venue" id="calf-venue"')}</div>
  <div class="field"><label>회차 ${c.sel.length > 1 ? '(첫 경기, 이후 날짜 순으로 +1)' : ''}<input class="inp w-num" type="number" min="1" placeholder="${c.sel.length ? '이전 회차가 없어요' : '날짜를 먼저 고르세요'}" value="${f.no || ''}" data-in="calf" data-f="no" data-noauto="1"></label><span class="note" style="margin:0">${f.noAuto !== false && f.no ? '이전 회차에 이어서 자동으로 넣었어요. 고칠 수 있어요.' : ''}</span></div>
  <div class="field"><label>구장 예약자 (신청하면 0순위)<input class="inp" type="text" list="mem-list" placeholder="이름 (여러 명은 쉼표로)" value="${esc(f.res || '')}" data-in="calf" data-f="res"></label></div>
  <div class="field"><label>경기 운영자 (0순위, 자동 신청)<input class="inp" type="text" list="mem-list" placeholder="이름 (여러 명은 쉼표로)" value="${esc(f.ops || '')}" data-in="calf" data-f="ops"></label></div>
  <datalist id="mem-list">${memberNames().map(n => `<option value="${esc(n)}">`).join('')}</datalist>
  <div class="field"><span>신청 오픈</span><div class="offs">경기 <input class="inp w-num" type="number" min="0" max="30" value="${f.openD}" data-in="calf" data-f="openD">일 전 <input class="inp" type="time" value="${esc(f.openT)}" data-in="calf" data-f="openT"></div></div>
  <div class="field"><span>신청 마감</span><div class="offs">경기 <input class="inp w-num" type="number" min="0" max="30" value="${f.closeD}" data-in="calf" data-f="closeD">일 전 <input class="inp" type="time" value="${esc(f.closeT)}" data-in="calf" data-f="closeT"></div></div></div>
  ${c.sel.length ? `<p class="note">${c.sel.slice().sort().map(id => fmtDate(id)).join(', ')}</p>` : ''}
  <div class="row" style="margin-top:12px"><button class="btn primary" data-act="caladdgo" ${c.sel.length ? '' : 'disabled'}>${c.sel.length ? `${c.sel.length}개 경기 추가` : '날짜를 고르세요'}</button></div>`;
}
function nextNoFor(date) { const prev = Object.keys(S.sessions).filter(id => id < date && +S.sessions[id].no).sort().pop(); if (prev) return +S.sessions[prev].no + 1;
  const after = Object.keys(S.sessions).filter(id => id > date && +S.sessions[id].no).sort()[0]; if (after) { const k = Object.keys(S.sessions).filter(id => id >= date && id < after).length; return Math.max(1, +S.sessions[after].no - k - 1) } return '' }
async function fillNos() { const ids = Object.keys(S.sessions).sort(); let n = 0; const todo = [];
  for (const id of ids) { const v = +S.sessions[id].no; if (v) { n = v; continue } if (n) { n++; todo.push([id, n]) } }
  if (!todo.length) { toast(Object.values(S.sessions).some(x => +x.no) ? '비어 있는 회차가 없어요.' : '먼저 한 경기에 회차를 입력하면 그 뒤로 이어서 채워져요.'); return }
  if (!confirm(`회차가 빈 ${todo.length}경기에 이전 회차에 이어서 번호를 넣을까요?\n${todo.slice(0, 6).map(([id, v]) => `${fmtDate(id)} → ${v}회`).join('\n')}${todo.length > 6 ? '\n…' : ''}`)) return;
  await w(async () => { for (const [id, v] of todo) await S.store.update(sp(id), { no: v }) }, '회차를 채웠어요.') }
async function addSessions() {
  const c = S.cal; const f = c.f; let n = 0; const res = await namesToIds(f.res), ops = await namesToIds(f.ops); const sorted = c.sel.slice().sort(); let no0 = +f.no || 0;
  const ok = await w(async () => { for (const sid of c.sel.slice().sort()) { if (S.sessions[sid]) continue;
    await S.store.set(sp(sid), { date: sid, time: f.time || DEFAULTS.time, venue: f.venue || DEFAULTS.venue, evpw: '', notice: DEFAULTS.notice || '', capacity: +f.capacity || 18,
      applyOpen: shiftDate(sid, +f.openD || 0, f.openT), applyClose: shiftDate(sid, +f.closeD || 0, f.closeT),
      stage: 'apply', applicants: [], captains: { A: null, B: null, C: null }, captainTokens: { A: null, B: null, C: null }, order: [...KEYS], picks: [], draftStatus: 'ready',
      teams: { A: { players: [] }, B: { players: [] }, C: { players: [] } }, timing: DEF_TIMING, mom: {}, p0: res, ops, no: no0 ? no0 + sorted.indexOf(sid) : 0, createdAt: Date.now() }); n++ } });
  if (ok) { if (c.sel.some(id => id < today())) S.mfilter = 'all'; S.sheet = null; S.cal = null; toast(n ? `${n}개 경기를 추가했어요.` : '이미 경기가 있는 날짜라 추가하지 않았어요.'); render() }
}
async function moveSession() {
  const c = S.cal; const from = c.from, to = c.sel[0]; if (!to || S.sessions[to]) return; const s = S.sessions[from];
  const ok = await w(async () => { const d = JSON.parse(JSON.stringify(s)); d.date = to;
    if (s.applyOpen) { const diff = (new Date(to) - new Date(from)) / 864e5; const mv = x => { const t = new Date(x); t.setDate(t.getDate() + diff); return `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}T${p2(t.getHours())}:${p2(t.getMinutes())}` }; d.applyOpen = mv(s.applyOpen); if (s.applyClose) d.applyClose = mv(s.applyClose) }
    await S.store.set(sp(to), d); await S.store.del(sp(from)) });
  if (ok) { if (S.sid === from) S.sid = to; S.sheet = null; S.cal = null; toast(`${fmtDate(to)}로 옮겼어요.`); render() }
}
function viewRun() {
  const sid = adminSid(); if (!sid) return `<div class="panel" style="margin-top:14px"><p class="empty">경기가 없어요. 일정 메뉴에서 먼저 추가하세요.</p></div>`;
  S.sid = sid; const s = S.sessions[sid]; const ms = sessMatches(sid);
  let step = S.step || (s.stage === 'match' && ms.length && ms.every(m => m.status === 'done') ? 'result' : s.stage);
  if (step === 'draft' && S.dm) return `<div class="dmroot">${adminBar()}${vDraft(s)}</div>`;
  let h = adminBar();
  if (step === 'notice') step = 'trade';
  if (step === 'result') h += ms.length ? vResultDetail(s) + `<p class="note">골과 도움은 "경기" 단계에서 각 경기를 눌러 고쳐요.</p>` : `<div class="panel pad" style="margin-top:14px"><p class="empty" style="padding:8px 0">아직 경기 기록이 없어요. 팀 확정 단계에서 경기 일정을 만들거나, "기록 붙여넣기"로 지난 기록을 넣을 수 있어요.</p><button class="btn sm" style="margin-top:8px" data-act="impopen">📋 기록 붙여넣기</button></div>`;
  else h += ({ apply: vApply, captain: vCaptain, draft: vDraft, trade: vTrade, match: vMatchDay })[step](s);
  return h;
}
function recruitText(s) { return [`[${CFG.club?.short || 'WF'}] ${fmtDate(s.date)} ${s.time || ''} 경기 신청 받아요`, `장소: ${s.venue || '-'}`, `정원: ${s.capacity || '-'}명`, s.applyClose ? `마감: ${fmtDT(s.applyClose)}` : '', s.applyOpen ? `신청 오픈: ${fmtDT(s.applyOpen)}` : '', `앱에서 신청해 주세요 👉 ${location.origin}${location.pathname}`].filter(Boolean).join('\n') }

/* ───────── sample data ───────── */
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
function dstr(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` }
function genSample(existing = {}) {
  const R = rng(20260930); const pick = a => a[Math.floor(R() * a.length)];
  const names = '김민혁 이도형 안준영 한준호 윤창민 이정욱 이준현 김바우 박종현 강인호 양성필 손효석 이태명 김민준 지유균 손준민 이호열 이건 종현 오태훈 장영범'.split(' ');
  const docs = []; const pid = {};
  names.forEach((n, i) => { if (existing[n]) { pid[n] = existing[n]; return } const id = 'smp' + p2(i + 1); pid[n] = id; const guest = n === '장영범';
    docs.push(['players/' + id, { name: n, guest, status: guest ? 'guest' : 'active', createdAt: Date.now() - 864e5 * (90 - i), sample: true }]);
    docs.push(['contacts/' + id, { phone: `010-0000-${1001 + i}`, memo: guest ? '지인 소개' : '', sample: true }]) });
  const t = new Date(); t.setHours(0, 0, 0, 0); const back = ((t.getDay() - 2 + 7) % 7) || 7;
  const d1 = new Date(t); d1.setDate(t.getDate() - back); const d0 = new Date(d1); d0.setDate(d1.getDate() - 7); const dn = new Date(d1); dn.setDate(d1.getDate() + 7);
  const T = { ...DEF_TIMING }; const pairs = [['A', 'B'], ['B', 'C'], ['C', 'A']];
  const base = (sid, extra) => ({ date: sid, time: '21:00', venue: '용산 7구장', evpw: '3310*', notice: DEFAULTS.notice || '', capacity: 18, timing: T, mom: {}, order: [...KEYS], picks: [],
    captainTokens: { A: null, B: null, C: null }, applyOpen: shiftDate(sid, DEFAULTS.openDays, DEFAULTS.openTime), applyClose: shiftDate(sid, DEFAULTS.closeDays, DEFAULTS.closeTime), createdAt: Date.now(), sample: true, ...extra });
  const past = (sid, teams, colors, mom, scores) => {
    docs.push(['sessions/' + sid, base(sid, { stage: 'match', draftStatus: 'done', applicants: teams.flat().map(n => pid[n]),
      captains: { A: pid[teams[0][0]], B: pid[teams[1][0]], C: pid[teams[2][0]] }, teams: Object.fromEntries(KEYS.map((k, i) => [k, { players: teams[i].map(n => pid[n]), colorName: colors[i] }])),
      mom: Object.fromEntries(KEYS.map((k, i) => [k, pid[mom[i]]])) })]);
    let ev = 0;
    scores.forEach(([gh, ga], idx) => { const n = idx + 1, r = Math.floor(idx / 3) + 1, sl = idx % 3 + 1; const mid = `${sid}_${n}`;
      docs.push(['matches/' + mid, { session: sid, n, round: r, slot: sl, status: 'done', timer: { running: false, acc: 605, startedAt: 0 }, endedAt: 1, sample: true }]);
      const [h, a] = pairs[sl - 1];
      for (const [side, g] of [[h, gh], [a, ga]]) { const tm = teams[KEYS.indexOf(side)];
        for (let i = 0; i < g; i++) { const sc = pick(tm); const as = R() < .75 ? pick(tm.filter(x => x !== sc)) : null; const sec = 15 + Math.floor(R() * 585); ev++;
          docs.push([`events/smp${sid.replace(/-/g, '')}e${String(ev).padStart(3, '0')}`, { session: sid, match: mid, team: side, scorer: pid[sc], assist: as ? pid[as] : null, og: false, sec, half: sec < 300 ? 'h1' : 'h2', at: Date.now() + ev, sample: true }]) } } });
  };
  past(dstr(d0), [['김민혁', '종현', '이준현', '강인호', '이호열', '이건'], ['이태명', '이도형', '김바우', '양성필', '지유균', '오태훈'], ['박종현', '안준영', '한준호', '윤창민', '김민준', '손준민']], ['RED', 'BLACK', 'YELLOW'], ['종현', '김바우', '박종현'],
    [[2, 1], [1, 1], [3, 2], [0, 2], [2, 2], [1, 3], [2, 0], [3, 1], [1, 2]]);
  past(dstr(d1), [['김민혁', '이도형', '안준영', '한준호', '윤창민', '이정욱'], ['이준현', '김바우', '박종현', '강인호', '양성필', '손효석'], ['이태명', '김민준', '지유균', '손준민', '이호열', '이건']], ['BLUE', 'BLACK', 'WHITE'], ['이정욱', '박종현', '지유균'],
    [[1, 2], [2, 1], [2, 2], [0, 1], [3, 1], [2, 3], [1, 1], [2, 0], [1, 2]]);
  const nid = dstr(dn);
  docs.push(['sessions/' + nid, base(nid, { stage: 'apply', draftStatus: 'ready', applicants: ['종현', '김민혁', '이도형', '안준영', '이준현', '김바우', '박종현', '강인호', '이태명', '김민준', '지유균', '손준민', '오태훈', '장영범'].map(n => pid[n]),
    captains: { A: null, B: null, C: null }, teams: { A: { players: [] }, B: { players: [] }, C: { players: [] } } })]);
  return docs;
}
async function maybeSeed() {
  if (S.seedTried) return; S.seedTried = true;
  try { const m = await S.store.get('meta/app'); if (m) return;
    if (Object.keys(S.sessions).length || Object.keys(S.players).length) { await S.store.set('meta/app', { seeded: false, at: Date.now() }); return }
    await S.store.set('meta/app', { seeded: true, at: Date.now() });
    const docs = genSample(); for (let i = 0; i < docs.length; i += 12) await Promise.all(docs.slice(i, i + 12).map(([p, d]) => S.store.set(p, d)));
    toast('처음 실행이라 샘플 데이터를 넣었어요. 운영모드 설정에서 지울 수 있어요.') } catch (e) { console.error(e) }
}
async function addSampleManual() {
  if (!confirm('샘플 데이터(가상 회원, 지난 경기 2개, 다음 경기 1개)를 넣을까요? 이미 있는 날짜의 경기와 같은 이름의 회원은 건드리지 않아요.')) return;
  const existing = {}; for (const [id, p] of Object.entries(S.players)) existing[p.name] = id;
  const all = genSample(existing); const skipSid = new Set(all.filter(([p]) => p.startsWith('sessions/') && S.sessions[p.slice(9)]).map(([p]) => p.slice(9)));
  const docs = all.filter(([p, d]) => !(p.startsWith('sessions/') && skipSid.has(p.slice(9))) && !(d.session && skipSid.has(d.session)));
  const ok = await w(async () => { for (let i = 0; i < docs.length; i += 12) await Promise.all(docs.slice(i, i + 12).map(([p, d]) => S.store.set(p, d))) });
  if (ok) toast(skipSid.size ? `샘플을 넣었어요. ${[...skipSid].map(fmtDate).join(', ')}은 이미 경기가 있어서 건너뛰었어요.` : '샘플 데이터를 넣었어요.');
}
async function makePractice() {
  const pool = Object.entries(S.players).filter(([, p]) => mstatus(p) !== 'dormant').map(([id]) => id);
  if (pool.length < 9) { toast('회원이 9명 이상 있어야 연습 경기를 만들 수 있어요.'); return }
  let d = today(); while (S.sessions[d]) { const x = new Date(d + 'T00:00'); x.setDate(x.getDate() + 1); d = `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}` }
  if (!confirm(`${fmtDate(d)}에 경기모드 연습용 경기(팀 구성까지 끝난 상태)를 만들까요?\n회원 중 ${Math.min(18, pool.length)}명을 무작위로 세 팀에 나눠요. 설정 → "연습 경기 지우기"로 언제든 지울 수 있어요.`)) return;
  const pick = [...pool].sort(() => Math.random() - .5).slice(0, Math.min(18, pool.length - pool.length % 3)); const per = pick.length / 3;
  const cols = ['RED', 'BLUE', 'WHITE']; const teams = {}, captains = {};
  KEYS.forEach((k, i) => { const ps = pick.slice(i * per, (i + 1) * per); teams[k] = { players: ps, colorName: cols[i] }; captains[k] = ps[0] });
  const ok = await w(() => S.store.set(sp(d), { date: d, time: '21:00', venue: '용산 아이파크몰 The Base 7구장', evpw: '', notice: DEFAULTS.notice || '', capacity: pick.length,
    applyOpen: shiftDate(d, DEFAULTS.openDays, DEFAULTS.openTime), applyClose: shiftDate(d, DEFAULTS.closeDays, DEFAULTS.closeTime), stage: 'trade', draftStatus: 'done',
    applicants: pick, waitlist: [], captains, captainTokens: { A: null, B: null, C: null }, order: [...KEYS], picks: [], pending: null, teams, timing: { ...DEF_TIMING }, mom: {}, no: 0,
    practice: true, simKind: 'mm', sample: true, createdAt: Date.now() }), `${fmtDate(d)} 연습 경기를 만들었어요. 하단 ⚽ 경기모드에서 시작해 보세요.`);
  if (ok) { S.mmPick = d; render() }
}
function listCol(path) { return new Promise(res => { let un = null, done = false; const t = setTimeout(() => { if (!done) { done = true; try { un && un() } catch { } res([]) } }, 4000);
  un = S.store.watchCol(path, docs => { if (done) return; done = true; clearTimeout(t); setTimeout(() => { try { un && un() } catch { } }, 0); res(docs) }, null, () => { if (!done) { done = true; res([]) } }) }) }
function freeDate(from) { let d = from || today(); const x0 = () => { const x = new Date(d + 'T00:00'); x.setDate(x.getDate() + 1); d = `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}` }; while (S.sessions[d]) x0(); return d }
const SIM = { apply: ['신청접수', 'apply'], captain: ['도우미 지정', 'captain'], draft: ['드래프트', 'draft'], trade: ['팀원조정', 'trade'] };
async function makeSim(kind) {
  const pool = Object.entries(S.players).filter(([, p]) => mstatus(p) !== 'dormant').map(([id]) => id);
  if (pool.length < 12) { toast('회원이 12명 이상 있어야 연습 데이터를 만들 수 있어요.'); return }
  const tmr = new Date(); tmr.setDate(tmr.getDate() + 1); const d = freeDate(`${tmr.getFullYear()}-${p2(tmr.getMonth() + 1)}-${p2(tmr.getDate())}`);
  if (!confirm(`${fmtDate(d)}에 "${SIM[kind][0]}" 연습용 가상 경기를 만들까요?\n설정 → "연습 데이터 모두 지우기"로 언제든 지울 수 있어요.`)) return;
  const mix = [...pool].sort(() => Math.random() - .5); const n = Math.min(18, mix.length - mix.length % 3); const pick = mix.slice(0, n);
  const now = Date.now(); const base = { simKind: kind, date: d, time: '21:00', venue: '용산 아이파크몰 The Base 7구장', evpw: '', notice: DEFAULTS.notice || '', capacity: 18, no: 0,
    captainTokens: { A: null, B: null, C: null }, order: [...KEYS], picks: [], pending: null, timing: { ...DEF_TIMING }, mom: {}, practice: true, sample: true, createdAt: now,
    teams: Object.fromEntries(KEYS.map(k => [k, { players: [], colorName: null }])), captains: { A: null, B: null, C: null } };
  let doc;
  if (kind === 'apply') { const aps = mix.slice(0, 12);
    doc = { ...base, applyOpen: today() + 'T00:00', applyClose: d + 'T18:00', stage: 'apply', draftStatus: 'ready', applicants: [], waitlist: [], p0: [mix[12]].filter(Boolean), ops: [],
      apps: aps.map((pid, i) => ({ k: 'sim' + i, pid, uid: 'sim', at: now - (12 - i) * 60000 })) } }
  else { const closed = { applyOpen: shiftDate(d, 6, '13:00'), applyClose: shiftDate(d, 2, '20:00') }; const per = n / 3;
    if (kind === 'captain') doc = { ...base, ...closed, capacity: n, stage: 'captain', draftStatus: 'ready', applicants: pick, waitlist: [], apps: pick.map((pid, i) => ({ k: 'sim' + i, pid, uid: 'sim', at: now - (n - i) * 60000 })) };
    else if (kind === 'draft') doc = { ...base, ...closed, capacity: n, stage: 'draft', draftStatus: 'ready', applicants: pick, waitlist: [], captains: { A: pick[0], B: pick[1], C: pick[2] },
      room: { open: true, A: { in: true, at: now }, B: { in: true, at: now }, C: { in: true, at: now }, admin: { in: true, name: S.me || '운영진', at: now } } };
    else { const teams = {}, captains = {}; ['RED', 'BLUE', 'WHITE'].forEach((c, i) => { const ps = pick.slice(i * per, (i + 1) * per); teams[KEYS[i]] = { players: ps, colorName: c }; captains[KEYS[i]] = ps[0] });
      doc = { ...base, ...closed, capacity: n, stage: 'trade', draftStatus: 'done', applicants: pick, waitlist: [], teams, captains } } }
  if (await w(() => S.store.set(sp(d), doc), `${fmtDate(d)} ${SIM[kind][0]} 연습 경기를 만들었어요.`)) { if (!S.sessions[d]) S.sessions[d] = doc; S.sid = d; S.tab = 'run'; S.step = SIM[kind][1]; S.planSel = d; render(); window.scrollTo(0, 0) }
}
async function clearPractice(kind) {
  const sids = Object.entries(S.sessions).filter(([, s]) => s.practice && (!kind || s.simKind === kind)).map(([id]) => id); if (!sids.length) { toast('지울 연습 데이터가 없어요.'); return }
  if (!confirm(`연습 경기 ${sids.length}개(${sids.map(fmtDate).join(', ')})와 그 경기의 신청, 드래프트, 채팅, 경기 기록을 모두 지울까요?`)) return;
  const chats = []; for (const sid of sids) for (const c of await listCol(sp(sid) + '/chat')) chats.push(sp(sid) + '/chat/' + c.id);
  const targets = [...chats, ...Object.entries(S.events).filter(([, e]) => sids.includes(e.session)).map(([id]) => 'events/' + id), ...Object.entries(S.matches).filter(([, m]) => sids.includes(m.session)).map(([id]) => 'matches/' + id), ...sids.map(id => 'sessions/' + id)];
  if (await w(async () => { for (const t of targets) await S.store.del(t) }, '연습 데이터를 모두 지웠어요.')) { S.mmPick = null; if (sids.includes(S.sid)) S.sid = null; S.planSel = null; render() }
}
async function clearSample() {
  if (!confirm('샘플 데이터(가상 회원, 경기, 기록)를 모두 지울까요? 직접 입력한 데이터는 남아요.')) return;
  const sids = Object.entries(S.sessions).filter(([, s]) => s.sample).map(([id]) => id);
  const targets = [...Object.entries(S.events).filter(([, e]) => e.sample || sids.includes(e.session)).map(([id]) => 'events/' + id),
    ...Object.entries(S.matches).filter(([, m]) => m.sample || sids.includes(m.session)).map(([id]) => 'matches/' + id),
    ...sids.map(id => 'sessions/' + id), ...Object.entries(S.players).filter(([, p]) => p.sample).map(([id]) => 'players/' + id),
    ...Object.entries(S.contacts || {}).filter(([, c]) => c.sample).map(([id]) => 'contacts/' + id)];
  const ok = await w(async () => { for (let i = 0; i < targets.length; i += 12) await Promise.all(targets.slice(i, i + 12).map(p => S.store.del(p))) });
  if (ok) toast(`샘플 데이터 ${targets.length}건을 지웠어요.`);
}

/* ───────── member application ───────── */
/* ───────── applications (reserve first, name later; priority tiers) ───────── */
const TIER = ['0순위', '1순위', '2순위', '3순위'];
const tsMs = v => v == null ? null : typeof v === 'number' ? v : v.toMillis ? v.toMillis() : v.seconds ? v.seconds * 1000 + (v.nanoseconds || 0) / 1e6 : +v;
function queueApps(s) { const q = S.q?.[s?.date]; if (!q) return []; const open = s.applyOpen ? new Date(s.applyOpen).getTime() : null, close = s.applyClose ? new Date(s.applyClose).getTime() : null;
  return Object.entries(q).map(([id, d]) => ({ k: 'q' + id, q: id, pid: d.pid || null, uid: d.uid, at: tsMs(d.at) ?? d.tap ?? 0, srv: true })).filter(a => (!open || a.at >= open - 1500) && (!close || a.at <= close)) }
function ensureQueues() { if (!S.store) return; S.qUn ??= {}; S.q ??= {}; const want = new Set(Object.keys(S.sessions).filter(id => ['apply', 'captain'].includes(S.sessions[id].stage) && id >= today()));
  for (const id of Object.keys(S.qUn)) if (!want.has(id)) { try { S.qUn[id]() } catch { } delete S.qUn[id]; delete S.q[id] }
  for (const id of want) if (!S.qUn[id]) S.qUn[id] = S.store.watchCol(sp(id) + '/q', docs => { const o = {}; docs.forEach(d => { const { id: di, ...r } = d; o[di] = r }); S.q[id] = o; renderSoon() }, { est: true }, () => { }) }
function appsOf(s) { const qa = queueApps(s); if (qa.length) { const base = Array.isArray(s.apps) ? s.apps : appsOf0(s); return appsOf0({ ...s, apps: [...base, ...qa] }) } return appsOf0(s) }
function appsOf0(s) { if (Array.isArray(s.apps)) { const seen = new Set(); return s.apps.filter(a => a && typeof a === 'object').map((a, i) => ({ a, i })).sort((x, y) => ((x.a.at || 0) - (y.a.at || 0)) || (x.i - y.i)).map(x => x.a).filter(a => { if (!a.pid) return true; if (seen.has(a.pid)) return false; seen.add(a.pid); return true }).map((a, i) => ({ a, i })).sort((x, y) => { const O = s.appOrder; if (!Array.isArray(O) || !O.length) return x.i - y.i; const rx = O.indexOf(x.a.k), ry = O.indexOf(y.a.k); return (rx < 0 ? O.length + x.i : rx) - (ry < 0 ? O.length + y.i : ry) }).map(x => x.a) } return [...(s.applicants || []), ...(s.waitlist || [])].map((pid, i) => ({ k: 'L' + i, pid, at: 0 })) }
function prevSessionId(s) { const ids = Object.keys(S.sessions).filter(id => id < s.date).sort().reverse(); return ids.find(id => KEYS.some(k => teamPlayers(S.sessions[id], k).length)) || null }
function staffSet(s) { return new Set([...(s.p0 || []), ...(s.ops || [])]) } // 0순위: 그 경기의 구장 예약자·경기 운영자만 (팀 운영진은 해당 없음)
function autoIds(s) { return [...new Set([...(s.ops || [])])].filter(id => S.players[id]) } // 구장 예약자는 직접 신청해야 0순위(0.21.17)
function roleOf(s, id) { return (s.p0 || []).includes(id) ? '구장 예약자' : (s.ops || []).includes(id) ? '경기 운영자' : '' }
async function namesToIds(txt) { const out = []; for (const nm of (txt || '').split(/[,，、\n]+/).map(x => x.trim()).filter(Boolean)) { const id = await ensurePlayer(nm); if (id && !out.includes(id)) out.push(id) } return out }
function idsToNames(ids) { return (ids || []).map(id => S.players[id]?.name).filter(Boolean).join(', ') }
const CL_CACHE = new WeakMap();
function classify(s) { const key = S.q?.[s?.date]; const c = s && CL_CACHE.get(s); if (c && c.q === key && c.p === S.players && c.ss === S.sessions && c.m === S.matches) return c.r; const r = classify0(s); if (s) CL_CACHE.set(s, { q: key, p: S.players, ss: S.sessions, m: S.matches, r }); return r }
function classify0(s) {
  const apps = appsOf(s); const prev = prevSessionId(s); const played = prev ? new Set(KEYS.flatMap(k => teamPlayers(S.sessions[prev], k))) : null; const staff = staffSet(s); const late = lateSet(s);
  const base = isBase(s); const applied = new Set(apps.map(a => a.pid).filter(Boolean));
  const autos = (base ? autoIds(s) : []).filter(id => !applied.has(id)).map(id => ({ k: 'auto-' + id, pid: id, auto: true, n: 0, tier: 0 }));
  const ov = (base && s.tierOv) || {};
  const rows = [...autos, ...apps.map((a, i) => { const t0 = !base ? 2 : a.tier != null ? a.tier : !a.pid ? 2 : staff.has(a.pid) ? 0 : late.has(a.pid) ? 3 : (played && !played.has(a.pid)) ? 1 : 2; const o = ov[a.k]; const has = base && [0, 1, 2, 3].includes(o); return { ...a, n: i + 1, tier0: t0, tierOv: has, tier: has ? o : t0 } })];
  const cap = s.capacity || Infinity; const sel = new Set();
  for (const t of [0, 1, 2, 3]) for (const r of rows) if (r.tier === t && ((t === 0 && base) || sel.size < cap)) sel.add(r.k);
  rows.forEach(r => r.sel = sel.has(r.k)); const wait = rows.filter(r => !r.sel).sort((a, b) => a.tier - b.tier || a.n - b.n); wait.forEach((r, i) => r.wn = i + 1);
  return { rows, sel: rows.filter(r => r.sel).sort((a, b) => a.tier - b.tier || a.n - b.n), wait, prev, base };
}
function appTotal(s) { const c = appCounts(s); return c.sel + c.wait }
function hasApps(s) { return Array.isArray(s.apps) || autoIds(s).length > 0 || queueApps(s).length > 0 }
function appCounts(s) { if (!hasApps(s) || s.stage !== 'apply') return { sel: (s.applicants || []).length, wait: (s.waitlist || []).length }; const c = classify(s); return { sel: c.sel.length, wait: c.wait.length } }
function myApp(s) { const uid = myUid(), me = myPid(); return appsOf(s).find(a => me ? (a.pid === me || (!a.pid && a.uid && a.uid === uid)) : (!a.pid && a.uid && a.uid === uid)) || (me && autoIds(s).includes(me) ? { k: 'auto-' + me, pid: me, auto: true } : null) }
function applyState(s) { const me0 = myPid(); if (me0 && s.stage === 'apply' && isBase(s) && autoIds(s).includes(me0)) return { k: 'in', auto: true, tier: 0, role: roleOf(s, me0) }; const a = myApp(s); if (!a) return { k: 'none' }; if (s.stage !== 'apply') { if ((s.applicants || []).includes(a.pid)) return { k: 'in', tier: null }; return { k: 'wait', n: (s.waitlist || []).indexOf(a.pid) + 1 } }
  const r = classify(s).rows.find(x => x.k === a.k); if (!r) return { k: 'none' }; return r.sel ? { k: 'in', tier: r.tier, n: r.n, noname: !a.pid, key: a.k, auto: !!r.auto, role: roleOf(s, a.pid) } : { k: 'wait', n: r.wn, order: r.n, tier: r.tier, noname: !a.pid, key: a.k } }
function applyBox(s, compact) {
  const st = sStatus(s); const a = applyState(s); const c = appCounts(s);
  const nameBtn = a.noname ? `<button class="btn sm primary" data-act="appname" data-id="${s.date}">이름 입력하기</button>` : '';
  if (st.k === 'soon') return `<button class="btn block" disabled>${fmtDT(s.applyOpen)}에 신청이 열려요</button>`;
  if (a.k === 'in' && a.auto) return `<div class="applied"><span>✓ 자동 신청 · 0순위<small>${a.role}(으)로 자동 참가 신청돼 있어요. 빠지려면 운영진에게 ${a.role} 해제를 요청해 주세요.</small></span></div>${(() => { const x = parkBox(s) + dutyBox(s); return x ? `<div class="extras">${x}</div>` : '' })()}`;
  const canLate = !a.auto && st.k !== 'open' && s.draftStatus === 'ready' && ['apply', 'captain'].includes(s.stage);
  if (a.k === 'in') return `<div class="applied"><span>✓ 신청 완료${a.tier != null && isBase(s) ? ` · ${TIER[a.tier]}` : ''}<small>${a.noname ? `${a.n}번째 신청 순번을 확보했어요. 이름을 입력해 주세요!` : a.n ? `${a.n}번째로 신청했어요` : '이번 경기 참가자예요'}</small></span>${nameBtn}${st.k === 'open' ? `<button class="btn sm" data-act="applycancel" data-id="${s.date}">취소</button>` : canLate ? `<button class="btn sm" data-act="applycancel" data-id="${s.date}">참가 취소</button>` : ''}</div>${a.noname ? '' : (() => { const x = parkBox(s) + dutyBox(s); return x ? `<div class="extras">${x}</div>` : '' })()}`;
  if (a.k === 'wait') { const canW = st.k === 'open' || (s.draftStatus === 'ready' && ['apply', 'captain'].includes(s.stage)); return `<div class="applied wait"><span>대기 ${a.n}번${a.tier != null && isBase(s) && s.stage === 'apply' ? ` · ${TIER[a.tier]}` : ''}<small>${a.noname ? '이름을 입력해 주세요!' : st.k === 'open' ? '자리가 나면 자동으로 선발돼요' : '신청이 마감됐어요. 자리가 나면 운영진이 알려 드려요'}</small></span>${nameBtn}${canW ? `<button class="btn sm" data-act="applycancel" data-id="${s.date}">${st.k === 'open' ? '취소' : '대기 취소'}</button>` : ''}</div>` }
  if (st.k !== 'open') return '';
  const full = s.capacity && c.sel >= s.capacity;
  return `<button class="btn primary block applybtn cta" data-act="apply" data-id="${s.date}" ${S.applyBusy === s.date ? 'disabled aria-busy="true"' : ''}>${S.applyBusy === s.date ? '신청 저장 중…' : full ? `대기 신청하기 (대기 ${c.wait}명)` : '신청하기'}</button>${compact ? '' : `<p class="note" style="margin:0">버튼을 누르는 순간 신청 순번이 확보되고, 이름은 그다음에 입력해요.</p>`}`;
}
async function doApply(sid, cancel) {
  const s = S.sessions[sid]; if (!s) { toast('경기 정보를 찾지 못했어요. 화면을 새로고침해 주세요.'); return }
  if (cancel) { const mine = myApp(s); if (!mine) return; if (mine.auto) { toast('자동 신청은 운영진에게 말해 주세요.'); return } await cancelApp(sid, mine.pid, mine.k, false); return }
  if (S.applyBusy && Date.now() - S.applyBusyAt < 20000) return;
  const st = sStatus(s); if (st.k === 'soon') { toast(`아직 신청 시간이 아니에요. ${fmtDT(s.applyOpen)}에 열려요.`); return } if (st.k !== 'open' || s.stage !== 'apply') { toast('신청이 마감됐어요.'); return }
  if (myApp(s) && !myApp(s).auto) { toast('이미 신청돼 있어요.'); return }
  const uid = myUid(), pid = myPid(); const entry = { k: rand() + rand(), pid: pid || null, uid, at: nowS() };
  S.applyBusy = sid; S.applyBusyAt = Date.now(); render();
  let ok = false, err = null, slow = false;
  try {
    if (S.store.stamp) {
      // one tiny per-member record; the SERVER stamps the time it arrived (that is the official order)
      const qid = pid || uid; const pr = S.store.txn(sp(sid) + '/q/' + qid, d => d ? null : { pid: pid || null, uid, at: S.store.stamp(), tap: entry.at });
      try { await withTimeout(pr, 9000); ok = true } catch (e) { if (String(e?.message) === 'aborted') { ok = true } else if (String(e?.code).includes('deadline')) { slow = true; pr.then(() => { toast('신청이 저장됐어요!'); render() }).catch(e2 => { if (String(e2?.message) !== 'aborted') toast(errMsg(e2).replace(/\.$/, '') + '. 신청이 저장되지 않았어요. 다시 눌러 주세요.') }) } else err = e }
    } else if (Array.isArray(s.apps)) {
      const pr = S.store.patch(sp(sid), { union: { apps: [entry] } });
      try { await withTimeout(pr, 9000); ok = true } catch (e) { if (String(e?.code).includes('deadline')) { slow = true; pr.then(() => { toast('신청이 저장됐어요!'); render() }).catch(e2 => toast(errMsg(e2).replace(/\.$/, '') + '. 신청이 저장되지 않았어요. 다시 눌러 주세요.')) } else err = e }
    } else {
      await S.store.txn(sp(sid), d => { if (!d) return null; const apps = appsOf(d); if (apps.some(a => pid ? a.pid === pid : (!a.pid && a.uid === uid))) return null; d.apps = [...apps, entry]; return d }); ok = true
    }
  } catch (e) { if (String(e?.message) !== 'aborted') err = e; else ok = true }
  finally { S.applyBusy = null }
  render();
  if (ok) { const s2 = S.sessions[sid] || s; const cur = appsOf(s2); const mineNow = cur.find(a => pid ? a.pid === pid : a.uid === uid); const pos = mineNow ? cur.indexOf(mineNow) + 1 : appsOf0({ apps: [...cur, entry] }).findIndex(a => a.k === entry.k) + 1;
    toast(pos > 0 ? `${pos}번째 신청 순번을 확보했어요!` : '신청했어요!'); if (!pid) { S.sheet = { type: 'appname', sid, key: S.store.stamp ? 'q' + uid : entry.k }; render() } return }
  if (slow) { toast('연결이 느려서 저장을 기다리고 있어요. 앱을 닫지 말고 잠시만 기다려 주세요.'); return }
  console.error(err); toast(errMsg(err).replace(/\.$/, '') + '. 신청이 저장되지 않았어요. 다시 눌러 주세요.');
}
async function setAppName(sid, key, name) {
  name = name.replace(/\(\s*게(스트)?\s*\)/g, '').trim().slice(0, 20); if (!name) return false;
  let pid = findPlayer(name); if (!pid && !S.admin) { toast('회원 명단에 없는 이름이에요.'); return false } if (!pid) { if (!confirm(`"${name}" 이름이 회원 명단에 없어요. 새 회원으로 등록할까요?`)) return false; pid = await S.store.add('players', { name, guest: false, status: 'active', createdAt: Date.now() }); S.players[pid] = { name } }
  let merged = false;
  if (String(key).startsWith('q') && S.q?.[sid]?.[key.slice(1)]) { const qid = key.slice(1); const all = appsOf(S.sessions[sid]); const me = all.findIndex(a => a.k === key); const j = all.findIndex(a => a.pid === pid && a.k !== key);
    const ok = await w(async () => { if (j >= 0 && j < me) { await S.store.del(sp(sid) + '/q/' + qid); merged = true; return }
      await S.store.update(sp(sid) + '/q/' + qid, { pid }); if (j >= 0) { const o = all[j]; if (o.q) await S.store.del(sp(sid) + '/q/' + o.q); else await S.store.patch(sp(sid), { remove: { apps: (S.sessions[sid].apps || []).filter(a => a && a.k === o.k) } }); merged = true } });
    if (ok) { if (!S.admin) { S.me = name; save('me', name) } toast(merged ? '이미 신청된 이름이라 앞선 순번 하나로 합쳤어요.' : `${name} 이름으로 신청됐어요.`) } return ok }
  const ok = await w(() => S.store.txn(sp(sid), d => { if (!d) return null; const apps = appsOf(d); const i = apps.findIndex(a => a.k === key); if (i < 0) return null;
    const j = apps.findIndex(a => a.pid === pid && a.k !== key);
    if (j >= 0) { if (j < i) { apps.splice(i, 1) } else { apps[i] = { ...apps[i], pid }; apps.splice(j, 1) } merged = true } else apps[i] = { ...apps[i], pid };
    d.apps = apps; return d }));
  if (ok) { if (!S.admin) { S.me = name; save('me', name) } toast(merged ? '이미 신청된 이름이라 앞선 순번 하나로 합쳤어요.' : `${name} 이름으로 신청됐어요.`) }
  return ok;
}
const STAGE_BACK = { apply: '신청 단계', captain: '주장 지정 단계' };
function resetBar(s) { if (!S.admin || !s) return ''; const cur0 = stageIdx(s.stage); const opts = ['apply', 'captain'].filter(st => stageIdx(st) < cur0); if (!opts.length || s.stage === 'match') return '';
  return `<div class="panel pad resetbar"><b>↺ 이전 단계로 되돌리기</b><p class="note" style="margin:4px 0 8px">${opts.includes('captain') ? '주장 지정 단계로 되돌리면 드래프트(팀 색·순번·지명)가 지워지고 주장은 그대로 남아요. ' : ''}신청 단계로 되돌리면 주장 지정과 드래프트가 모두 지워지고, 신청자 명단을 다시 고칠 수 있어요. 신청 기록 자체는 지워지지 않아요.</p><div class="row">${opts.slice().reverse().map(st => `<button class="btn sm${st === 'apply' ? ' danger' : ''}" data-act="stageback" data-v="${st}">${STAGE_BACK[st]}로 되돌리기</button>`).join('')}</div></div>` }
async function stageBack(st) { const s = cur(); if (!s || !STAGE_BACK[st] || stageIdx(st) >= stageIdx(s.stage)) return;
  if (sessMatches(s.date).length) { toast('경기 대진이 이미 만들어져 있어요. 경기진행 화면에서 대진을 먼저 삭제해 주세요.'); return }
  if (!confirm(st === 'apply' ? '신청 단계로 되돌릴까요?\n주장 지정·드래프트(팀 색, 순번, 지명, 팀 구성)가 모두 지워지고 신청자 명단을 다시 고칠 수 있어요.' : '주장 지정 단계로 되돌릴까요?\n드래프트(팀 색, 순번, 지명, 팀 구성)가 지워지고 주장은 그대로 남아요.')) return;
  const clear = { draftStatus: 'ready', picks: [], pending: null, ladder: null, cardgame: null, order: [...KEYS], room: null, teams: Object.fromEntries(KEYS.map(k => [k, { players: [], colorName: null }])), stage: st };
  if (st === 'apply') Object.assign(clear, { captains: { A: null, B: null, C: null }, captainTokens: { A: null, B: null, C: null } });
  if (await w(() => S.store.update(sp(s.date), clear), `${STAGE_BACK[st]}로 되돌렸어요.`)) { if (S.adminJoin) delete S.adminJoin[s.date]; S.step = st; S.sheet = null; render(); window.scrollTo(0, 0) } }
async function freezeApps(s) {
  if (!hasApps(s) || s.stage !== 'apply') return true; const c = classify(s); const nn = c.rows.filter(r => !r.pid).length;
  if (nn && !confirm(`이름을 입력하지 않은 신청 ${nn}건은 드래프트 명단에서 빠져요. 계속할까요?`)) return false;
  return await w(() => S.store.update(sp(s.date), { applicants: c.sel.filter(r => r.pid).map(r => r.pid), waitlist: c.wait.filter(r => r.pid).map(r => r.pid) }));
}

/* ───────── duties & parking ───────── */
const PARK_SLOTS = +(CFG.parkingSlots || 2);
function participants(s) { if (s.stage === 'apply') return classify(s).sel.map(r => r.pid).filter(Boolean); return [...(s.applicants || [])] }
function applyClosed(s) { const st = sStatus(s); return st.k !== 'soon' && st.k !== 'open' }
function prevAnyId(s) { return Object.keys(S.sessions).filter(id => id < s.date).sort().pop() || null }
function parkBanned(s, pid) { const p = prevAnyId(s); return !!(p && (S.sessions[p].parkWin || []).includes(pid)) }
function parkApps(s) { return Object.entries(s.park || {}).filter(([, v]) => v && v.car).map(([pid, v]) => ({ pid, ...v })).sort((a, b) => (a.at || 0) - (b.at || 0)) }
function dutyLine(s) { const d = s.duty || {}; const b = (d.ball || []).map(pname), w = (d.drink || []).map(pname), pw = (s.parkWin || []).map(pname);
  if (!b.length && !w.length && !pw.length) return '';
  return `<div class="duties">${b.length ? `<span><em>⚽ 공당</em>${esc(b.join(', '))}</span>` : ''}${w.length ? `<span><em>🥤 물당</em>${esc(w.join(', '))}</span>` : ''}${pw.length ? `<span><em>🚗 주차</em>${esc(pw.join(', '))}</span>` : ''}</div>` }
function dutyReqs(s, k) { return Object.entries(s.dutyReq?.[k] || {}).filter(([, v]) => v).sort((a, b) => a[1] - b[1]).map(([pid]) => pid) }
function dutyN(s, kind) { return Math.max(1, +(kind === 'drink' ? s.drinkN : s.ballN) || 1) }
function dutyPool(s, kind) { const d = s.duty || {}; const other = kind === 'drink' ? (d.ball || []) : (d.drink || []); return participants(s).filter(id => !other.includes(id)) }
function dutyPick(s, kind) { const n = dutyN(s, kind); const pool = dutyPool(s, kind); const req = dutyReqs(s, kind).filter(id => pool.includes(id)); const sh = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] } return b };
  if (req.length >= n) return sh(req).slice(0, n); return [...req, ...sh(pool.filter(id => !req.includes(id))).slice(0, n - req.length)] }
function dutySpin(sid, kind, done) { const ss = S.sessions[sid]; const pool = dutyPool(ss, kind); const pick = dutyPick(ss, kind); const n = pick.length; const t0 = Date.now(); S.dspin = { sid, kind, hl: [] };
  clearInterval(S.dspinT); S.dspinT = setInterval(() => { if (Date.now() - t0 > 1300) { clearInterval(S.dspinT); S.dspin = null; done(pick); return } S.dspin.hl = pool.slice().sort(() => Math.random() - .5).slice(0, n); render() }, 110) }
function dutyReqLabel(s) { const b = dutyReqs(s, 'ball').length, d = dutyReqs(s, 'drink').length; return b || d ? `신청 공 ${b} · 물 ${d}` : '' }
function dutyBox(s) {
  const me = myPid(); if (!me || s.stage === 'match') return ''; const d = s.duty || {}; const rq = s.dutyReq || {};
  const one = (k, ico, nm) => { const set = d[k] || []; if (set.length) return set.includes(me) ? `<span class="xpill fixed"><b>${XICO[k] || ico} ${nm}</b><small>지정됐어요</small></span>` : '';
    const on = !!rq[k]?.[me]; return `<button class="xpill ${on ? 'on' : ''}" data-act="dutyreq" data-k="${k}" data-id="${s.date}" aria-pressed="${on}"><b>${XICO[k] || ico} ${nm}</b><small>${on ? '신청함 ✓' : '신청하기'}</small></button>` };
  return one('ball', '⚽', '공당') + one('drink', '🥤', '물당');
}
function parkBox(s) {
  const me = myPid(); if (!me) return ''; const mine = s.park?.[me]; const won = (s.parkWin || []).includes(me); const drawn = !!s.parkDrawAt; const open = sStatus(s).k === 'open';
  const pill = (cls, sub, attrs) => `<${attrs ? 'button' : 'span'} class="xpill ${cls}" ${attrs || ''}><b>${XICO.park} 주차</b><small>${sub}</small></${attrs ? 'button' : 'span'}>`;
  if (drawn) return mine?.car ? pill(won ? 'fixed' : 'off', won ? `당첨! ${esc(mine.car)}` : '추첨 미당첨') : '';
  if (mine?.car) return open ? pill('on', `신청함 ✓ ${esc(mine.car)}`, `data-act="parkcancel" data-id="${s.date}" aria-pressed="true"`) : pill('on', `신청함 ✓ ${esc(mine.car)}`);
  if (!open) return '';
  if (parkBanned(s, me)) return pill('off', '지난 경기 당첨자');
  return pill('', '신청하기', `data-act="parkapply" data-id="${s.date}"`);
}
function parkFields(s, pid) { const banned = pid && parkBanned(s, pid);
  return `<div class="field parkf"><label class="ck"><input type="checkbox" id="pk-on" ${banned ? 'disabled' : ''}> 🚗 주차 신청 (선택사항)</label>${banned ? '<span class="note" style="margin:0">지난 경기 주차 당첨자는 이번 경기 주차를 신청할 수 없어요.</span>' : `<input id="pk-car" class="inp" type="text" maxlength="12" placeholder="차량번호 (예: 12가3456)" value="${esc(myCar())}"><span class="note" style="margin:0">신청자 중 ${PARK_SLOTS}명을 추첨해요. 차량번호는 운영진만 볼 수 있어요.</span>`}</div>` }
async function saveParking(sid, pid, car) {
  if (car) save('car', (car || '').replace(/\s+/g, '').slice(0, 12));
  const s = S.sessions[sid]; car = (car || '').replace(/\s+/g, '').slice(0, 12); if (!car) { toast('차량번호를 입력해 주세요.'); return false }
  if (parkBanned(s, pid)) { toast('지난 경기 주차 당첨자는 신청할 수 없어요.'); return false }
  return await w(() => S.store.update(sp(sid), { [`park.${pid}`]: { car, at: Date.now() } }), '주차 신청을 받았어요.');
}
function dutySheet(sid) {
  const s = S.sessions[sid]; const ps = byName(participants(s)); const d = s.duty || {};
  if (!applyClosed(s)) { const lst = k => { const ids = dutyReqs(s, k); return ids.length ? `<div class="dpick">${ids.map((id, i) => `<span class="chip req"><small class="muted">${i + 1}</small> ${esc(pname(id))}</span>`).join('')}</div>` : '<p class="muted" style="margin:6px 0 0">아직 신청한 회원이 없어요.</p>' };
    return `<h4>${fmtDate(sid)} 공당 · 물당 신청 현황</h4><p>회원들이 신청한 순서예요. 경기 신청이 마감되면 이 창에서 신청자 중에서 확정할 수 있어요.</p>
    <div class="panel pad"><b class="dk">⚽ 공 당번 신청 <small>${dutyReqs(s, 'ball').length}명</small></b>${lst('ball')}</div><div style="height:10px"></div>
    <div class="panel pad"><b class="dk">🥤 음료 당번 신청 <small>${dutyReqs(s, 'drink').length}명</small></b>${lst('drink')}</div>` }
  const rq = s.dutyReq || {}; const vol = kind => ps.filter(id => rq[kind]?.[id]);
  const row = kind => `<div class="dpick">${[...vol(kind), ...ps.filter(id => !rq[kind]?.[id])].map(id => `<button class="chip ${(d[kind] || []).includes(id) ? 'sel' : ''} ${rq[kind]?.[id] ? 'req' : ''}" data-act="dutytog" data-kind="${kind}" data-id="${id}">${rq[kind]?.[id] ? '🙋 ' : ''}${esc(pname(id))}</button>`).join('') || '<span class="muted">선발된 신청자가 없어요.</span>'}</div>${vol(kind).length ? `<button class="btn sm" style="margin-top:8px" data-act="dutyfill" data-kind="${kind}" data-id="${sid}">🙋 신청자 ${vol(kind).length}명으로 지정</button>` : ''}`;
  return `<h4>${fmtDate(sid)} 공당 · 물당</h4><p>선발된 신청자 중에서 눌러서 고르세요. 🙋 표시는 직접 신청한 회원이에요. 여러 명을 고를 수 있고, 다시 누르면 빠져요.</p>
    <div class="panel pad"><b class="dk">⚽ 공 당번 <small>${(d.ball || []).length}명</small></b>${row('ball')}</div><div style="height:10px"></div>
    <div class="panel pad"><b class="dk">🥤 음료 당번 <small>${(d.drink || []).length}명</small></b>${row('drink')}</div>`;
}
function parkSheet(sid) {
  const s = S.sessions[sid]; const list = parkApps(s).sort((a, b) => pname(a.pid).localeCompare(pname(b.pid), 'ko')); const ps = new Set(participants(s)); const win = s.parkWin || [];
  const elig = list.filter(a => ps.has(a.pid) && !parkBanned(s, a.pid));
  const spin = S.parkSpin && S.parkSpin.sid === sid;
  let h = `<h4>${fmtDate(sid)} 주차 추첨</h4><p>주차 신청자 ${list.length}명 중 대상 ${elig.length}명에서 ${PARK_SLOTS}명을 뽑아요. 미선발 신청자와 지난 경기 당첨자는 제외돼요.</p>`;
  h += `<div class="panel plist ${spin ? 'spin' : ''}">${list.length ? list.map(a => { const ok = ps.has(a.pid) && !parkBanned(s, a.pid); const w0 = win.includes(a.pid);
    return `<div class="prow ${ok ? '' : 'x'} ${w0 ? 'won' : ''} ${spin && S.parkSpin.hl === a.pid ? 'hl' : ''}"><b>${esc(pname(a.pid))}</b><span class="car">${esc(a.car)}</span><small>${w0 ? '🎉 당첨' : !ps.has(a.pid) ? '미선발 제외' : parkBanned(s, a.pid) ? '지난 경기 당첨 제외' : '추첨 대상'}</small><button class="btn sm" data-act="parkwin" data-id="${a.pid}">${w0 ? '당첨 취소' : '당첨'}</button><button class="btn sm danger" data-act="parkdel" data-id="${a.pid}" aria-label="삭제">×</button></div>` }).join('') : '<p class="empty">아직 주차 신청자가 없어요.</p>'}</div>`;
  h += `<div class="panel pad" style="margin-top:10px"><b class="dk">직접 추가</b><div style="display:flex;gap:6px;flex-wrap:wrap"><input id="pk-nm" class="inp" style="flex:1;min-width:110px" type="text" list="pk-list" placeholder="이름"><datalist id="pk-list">${byName(participants(s)).map(id => `<option value="${esc(pname(id))}">`).join('')}</datalist><input id="pk-cr" class="inp" style="flex:1;min-width:110px" type="text" placeholder="차량번호"><button class="btn" data-act="parkadd" data-id="${sid}">추가</button></div></div>`;
  if (!applyClosed(s)) h += `<p class="note">신청이 마감된 뒤에 추첨할 수 있어요. 당첨자는 목록의 "당첨" 버튼으로 직접 정할 수도 있어요.</p>`;
  else h += `<div class="row" style="margin-top:12px"><button class="btn primary" data-act="parkdraw" data-id="${sid}" ${elig.length && !spin ? '' : 'disabled'}>${win.length ? '🎲 다시 추첨' : `🎲 ${Math.min(PARK_SLOTS, elig.length)}명 추첨하기`}</button></div>`;
  return h;
}
async function drawParking(sid) {
  const s = S.sessions[sid]; const ps = new Set(participants(s)); const elig = parkApps(s).filter(a => ps.has(a.pid) && !parkBanned(s, a.pid)).map(a => a.pid);
  if (!elig.length) return; if ((s.parkWin || []).length && !confirm('이미 추첨 결과가 있어요. 다시 추첨할까요?')) return;
  const pool = [...elig]; for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
  const win = pool.slice(0, PARK_SLOTS); const t0 = Date.now();
  S.parkSpin = { sid, hl: null }; const iv = setInterval(() => { S.parkSpin.hl = elig[Math.floor(Math.random() * elig.length)]; render() }, 120);
  await new Promise(r => setTimeout(r, 1800)); clearInterval(iv); S.parkSpin = null;
  if (await w(() => S.store.update(sp(sid), { parkWin: win, parkDrawAt: Date.now() }))) toast(`주차 당첨: ${win.map(pname).join(', ')}`); render();
}

/* ───────── late cancel (3순위) ───────── */
function fmtTS(ms) { const d = new Date(ms); return `${d.getMonth() + 1}.${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}` }
function lateSet(s) { const p = prevAnyId(s); return new Set(Object.entries((p && S.sessions[p].late) || {}).filter(([, v]) => v).map(([k]) => k)) }
async function cancelApp(sid, pid, key, byAdmin, force) {
  const s = S.sessions[sid]; if (!s) return; const selBefore = selSet(s); const closed = applyClosed(s);
  if (s.draftStatus !== 'ready' || !['apply', 'captain'].includes(s.stage)) { toast(byAdmin ? '드래프트가 시작된 뒤에는 여기서 취소할 수 없어요.' : '드래프트가 시작돼서 앱에서 취소할 수 없어요. 운영진에게 알려 주세요.'); return }
  const wasSel = s.stage === 'apply' ? classify(s).sel.some(r => (key && r.k === key) || (pid && r.pid === pid)) : (s.applicants || []).includes(pid);
  const penal = !force && closed && wasSel && pid;
  const markCancel = () => { if (!force && !penal && pid) S.store.update(sp(sid), { [`cancels.${pid}`]: nowS() }).catch(() => { }) }; // 일반 취소 기록(신청 현황 표에 보여요)
  if (force ? !confirm(`${pid ? pname(pid) + ' 님의 ' : '이름 입력 전 '}신청을 삭제할까요?\n주차·공당·물당 신청도 함께 취소되고, 마감 후 취소(3순위) 기록은 남지 않아요.`) : !confirm(penal ? `${byAdmin ? pname(pid) + ' 님의 ' : ''}신청 마감 후 취소예요. 취소하면 다음 경기 신청 때 3순위가 돼요. 그래도 취소할까요?` : '신청을 취소할까요?')) return;
  const qdel = Object.entries(S.q?.[sid] || {}).filter(([qi, d]) => (pid && d.pid === pid) || (key && 'q' + qi === key)).map(([qi]) => qi);
  if (qdel.length && !Array.isArray(s.apps)) { if (!(await w(() => Promise.all(qdel.map(qi => withTimeout(S.store.del(sp(sid) + '/q/' + qi), 10000)))))) return; if (!(s.applicants || []).includes(pid) && !appsOf0(s).some(a => a.pid === pid)) { if (penal) await w(() => S.store.update(sp(sid), { [`late.${pid}`]: Date.now() })); if (key && s.tierOv?.[key] != null) S.store.update(sp(sid), { [`tierOv.${key}`]: null }).catch(() => { }); if (pid) await clearExtras(sid, pid); markCancel(); toast(force ? '삭제했어요.' : penal ? '취소했어요. 마감 후 취소로 기록됐어요.' : '취소했어요.'); watchPromote(sid, selBefore, [pid]); render(); return } }
  if (s.stage === 'apply' && Array.isArray(s.apps)) {
    const vals = s.apps.filter(a => a && ((key && a.k === key) || (pid && a.pid === pid))); const set = {};
    if (pid && s.park?.[pid]) set[`park.${pid}`] = null; if (penal) set[`late.${pid}`] = Date.now();
    for (const kk of new Set([key, ...vals.map(a => a.k), ...appsOf(s).filter(a => pid && a.pid === pid).map(a => a.k)])) if (kk && s.tierOv?.[kk] != null) set[`tierOv.${kk}`] = null;
    const remove = { apps: vals }; if (pid && (s.duty?.ball || []).includes(pid)) remove['duty.ball'] = [pid]; if (pid && (s.duty?.drink || []).includes(pid)) remove['duty.drink'] = [pid];
    if (pid && s.dutyReq?.ball?.[pid]) set[`dutyReq.ball.${pid}`] = null; if (pid && s.dutyReq?.drink?.[pid]) set[`dutyReq.drink.${pid}`] = null;
    const qids = Object.entries(S.q?.[sid] || {}).filter(([qi, d]) => (pid && d.pid === pid) || (key && 'q' + qi === key)).map(([qi]) => qi);
    const ok2 = await w(async () => { await Promise.all(qids.map(qi => withTimeout(S.store.del(sp(sid) + '/q/' + qi), 10000))); if (vals.length || Object.keys(set).length || remove['duty.ball'] || remove['duty.drink']) await withTimeout(S.store.patch(sp(sid), { set, remove }), 10000) });
    if (ok2) { markCancel(); toast(force ? '삭제했어요.' : penal ? '취소했어요. 마감 후 취소로 기록됐어요.' : '취소했어요.'); watchPromote(sid, selBefore, [pid]) } render(); return }
  const ok = await w(() => S.store.txn(sp(sid), d => { if (!d || d.draftStatus !== 'ready' || !['apply', 'captain'].includes(d.stage)) return null;
    d.apps = appsOf(d).filter(a => !((key && a.k === key) || (pid && a.pid === pid)));
    if (d.stage !== 'apply') { const was = (d.applicants || []).includes(pid); d.applicants = (d.applicants || []).filter(x => x !== pid); d.waitlist = (d.waitlist || []).filter(x => x !== pid); if (was && d.waitlist.length) d.applicants.push(d.waitlist.shift()); KEYS.forEach(k => { if (d.captains?.[k] === pid) d.captains[k] = null }) }
    if (pid && d.park?.[pid]) d.park[pid] = null;
    if (pid && d.duty) ['ball', 'drink'].forEach(k => { if (d.duty[k]) d.duty[k] = d.duty[k].filter(x => x !== pid) });
    if (pid && d.dutyReq) ['ball', 'drink'].forEach(k => { if (d.dutyReq[k]?.[pid]) d.dutyReq[k][pid] = null });
    if (penal) d.late = { ...(d.late || {}), [pid]: Date.now() };
    return d }));
  if (ok) watchPromote(sid, selBefore, [pid]);
  if (ok) markCancel();
  if (ok) { const s2 = S.sessions[sid]; if (!byAdmin && pid && isBase(s) && autoIds(s2 || s).includes(pid)) toast(`신청은 취소했지만 ${roleOf(s2 || s, pid)}(이)라 자동 참가로 남아 있어요. 운영진에게 해제를 요청해 주세요.`); else toast(force ? '삭제했어요.' : penal ? '취소했어요. 마감 후 취소로 기록됐어요.' : '취소했어요.') }
}
const TIER_DESC = ['구장 예약자·경기 운영자급, 정원과 상관없이 선발', '직전 경기 미참여자', '그 외 선착순', '직전 경기 마감 후 취소자'];
function tierSheet(sh) { const ss = S.sessions[sh.sid]; const r = ss && classify(ss).rows.find(x => x.k === sh.k); if (!r) return '<h4>순위 변경</h4><p>신청자를 찾지 못했어요. 이미 삭제됐을 수 있어요.</p>';
  return `<h4>순위 변경 · ${r.pid ? esc(pname(r.pid)) : '이름 입력 대기'}</h4><p>지금 ${TIER[r.tier]}${r.tierOv ? ' (직접 지정)' : ''} · 자동 계산이면 ${TIER[r.tier0]}예요. 바꾸면 선발·대기가 바로 다시 계산돼요.</p><div class="tierpick">${[0, 1, 2, 3].map(t => `<button class="btn${r.tier === t ? ' primary' : ''}" data-act="tierpick" data-v="${t}"><b class="t${t}">${TIER[t]}</b><small>${TIER_DESC[t]}</small></button>`).join('')}</div>${r.tierOv ? '<div class="row" style="margin-top:12px"><button class="btn block" data-act="tierpick" data-v="auto">↺ 자동 계산으로 되돌리기</button></div>' : ''}` }
function vApplyTable(s) {
  const ad = S.admin; const c = classify(s); const frozen = s.stage !== 'apply'; const closed = applyClosed(s); const late = lateSet(s); const prevAny = prevAnyId(s);
  let rows = [...c.sel, ...c.wait];
  const byTime = ad && !frozen && S.aview === 'time'; if (byTime) rows = rows.slice().sort((a, b) => (a.auto ? 0 : 1) - (b.auto ? 0 : 1) || (a.n || 0) - (b.n || 0));
  const mvOn = ad && !frozen && betaOn() && !byTime;
  if (frozen) { const A = s.applicants || [], W = s.waitlist || []; rows = [...A.map(pid => ({ ...(c.rows.find(r => r.pid === pid) || { k: 'f' + pid, pid, tier: 2, n: '-' }), sel: true })), ...W.map((pid, i) => ({ ...(c.rows.find(r => r.pid === pid) || { k: 'w' + pid, pid, tier: 2, n: '-' }), sel: false, wn: i + 1 }))] }
  const tb = t => c.base ? `<b class="t${t}">${TIER[t]}</b>` : '<b class="t2">선착순</b>';
  const canTier = ad && !frozen && c.base; const canRm = ad && s.draftStatus === 'ready' && ['apply', 'captain'].includes(s.stage);
  const tcell = r => canTier && !r.auto ? `<button class="tierbtn t${r.tier}${r.tierOv ? ' ov' : ''}" data-act="tierset" data-k="${r.k}" title="순위 변경">${TIER[r.tier]}${r.tierOv ? ' ✎' : ''}</button>` : tb(r.tier);
  const dline = (k, ico, nm) => { const req = Object.entries(s.dutyReq?.[k] || {}).filter(([, v]) => v).sort((a, b) => a[1] - b[1]).map(([p]) => p); const fix = s.duty?.[k] || [];
    return `<div class="dsum-row"><b>${ico} ${nm}</b><span>${fix.length ? `<em class="ok">지정</em> ${fix.map(p => esc(pname(p))).join(', ')}` : '<em class="muted">미지정</em>'}</span><span>${req.length ? `🙋 신청 ${req.length}명 · ${req.map(p => esc(pname(p))).join(', ')}` : '<span class="muted">신청 없음</span>'}</span>${ad ? `<button class="btn sm" data-act="dutyedit" data-id="${s.date}">${applyClosed(s) ? '지정하기' : '신청 현황'}</button>` : ''}</div>` };
  const stale = ad ? staleExtraPids(s) : [];
  const dsum = `<div class="panel dsum">${dline('ball', '⚽', '공당')}${dline('drink', '🥤', '물당')}${stale.length ? `<div class="dsum-row stale"><b>⚠️ 정리</b><span>신청자가 아닌 ${stale.map(p => esc(pname(p))).join(', ')} 님의 주차·공당·물당 기록이 남아 있어요.</span><span></span><button class="btn sm danger" data-act="stalefix">정리하기</button></div>` : ''}</div>`;
  const betaNote = ad && !frozen && betaOn() ? `<div class="betatools"><button class="btn sm primary" data-act="kakaopaste">📷 카톡 투표 명단 반영</button>${Array.isArray(s.appOrder) && s.appOrder.length ? '<button class="btn sm" data-act="orderreset">↺ 실제 신청 순서로 되돌리기</button>' : ''}</div><p class="note betanote">🧪 베타테스트 기간이라 신청 순번을 바꿀 수 있어요. ▲▼로 한 칸씩, #으로 원하는 자리로 옮겨요. 0~3순위 규칙은 그대로라 같은 순위 안에서만 옮겨져요. (설정에서 정식 오픈하면 잠겨요)</p>` : '';
  const vtog = ad && !frozen ? `<div class="vtog" role="group" aria-label="정렬"><button class="btn sm${byTime ? '' : ' primary'}" data-act="aview" data-v="rank">순위순</button><button class="btn sm${byTime ? ' primary' : ''}" data-act="aview" data-v="time">신청순</button><small>${byTime ? `신청이 들어온 순서대로 보여요. 상태 칸에서 선발·대기를 확인하세요.${betaOn() ? ' (▲▼ 순번 변경은 순위순에서 할 수 있어요)' : ''}` : '순위(0~3순위)에 따라 선발 → 대기 순으로 보여요.'}</small></div>` : '';
  const h = dsum + betaNote + vtog + `<div class="panel sheetwrap"><table class="grid atbl"><thead><tr><th>신청순</th><th class="stick">이름</th><th>순위</th><th>구분</th><th>신청 시각</th>${mvOn ? '<th>순번 변경</th>' : ''}<th>주차</th><th>공당</th><th>물당</th><th>상태</th><th>마감 후 취소</th>${ad ? '<th>관리</th>' : ''}</tr></thead><tbody>
  ${rows.length ? rows.map(r => { const pk = r.pid && s.park?.[r.pid]?.car;
    return `<tr class="${r.sel ? '' : 'wrow'}"><td class="num">${r.auto ? '자동' : r.n}</td><td class="stick"><b>${r.pid ? esc(pname(r.pid)) : '<i class="nn">이름 입력 대기</i>'}</b>${(() => { const [k, t] = appSrc(s, r); return k === 'auto' ? '' : `<span class="src src-${k}">${t}</span>` })()}</td><td>${tcell(r)}</td>
      <td class="muted">${r.auto ? roleOf(s, r.pid) + ' (자동)' : r.pid ? (roleOf(s, r.pid) || (late.has(r.pid) ? '지난 경기 마감 후 취소' : '')) : ''}</td>
      <td class="num muted">${r.at ? fmtTS(r.at) : '-'}</td>
      ${mvOn ? `<td class="mv">${r.auto ? '' : `<button class="btn sm" data-act="appmove" data-k="${r.k}" data-d="-1" aria-label="위로">▲</button><button class="btn sm" data-act="appmove" data-k="${r.k}" data-d="1" aria-label="아래로">▼</button><button class="btn sm" data-act="appmoveto" data-k="${r.k}" aria-label="순번 입력">#</button>`}</td>` : ''}
      <td class="muted">${pk ? `🚗 ${esc(pk)}` : ''}</td>${['ball', 'drink'].map(k => { const fixed = r.pid && (s.duty?.[k] || []).includes(r.pid), req = r.pid && s.dutyReq?.[k]?.[r.pid]; return `<td class="num">${fixed ? '<b class="ok">✓ 지정</b>' : req ? '<span class="dreq">🙋 신청</span>' : ''}</td>` }).join('')}<td>${r.sel ? '<b class="ok">선발</b>' : `<b class="tw">대기 ${r.wn}</b>`}</td>
      <td class="num"><input type="checkbox" class="staffck" ${ad && closed && r.pid && !r.auto ? `data-in="latetoggle" data-id="${r.pid}"` : 'disabled'} aria-label="마감 후 취소"></td>
      ${ad ? `<td class="acts">${r.pid && !r.auto ? `<button class="btn sm" data-act="p0toggle" data-id="${r.pid}">${(s.p0 || []).includes(r.pid) ? '예약자 해제' : '예약자'}</button>` : ''}${r.auto ? `<button class="btn sm" data-act="staffedit" data-id="${s.date}">변경</button>` : ''}${!r.pid ? `<button class="btn sm" data-act="appnameadmin" data-id="${r.k}">이름</button>` : ''}${closed && r.pid && !r.auto ? `<button class="btn sm danger" data-act="latecancel" data-id="${r.pid}">${r.sel ? '마감 후 취소' : '대기 취소'}</button>` : ''}${canRm && !r.auto ? `<button class="btn sm danger" data-act="apprm" data-id="${r.k}" data-pid="${r.pid || ''}" aria-label="삭제" title="신청 삭제 (3순위 기록 없음)">삭제</button>` : ''}</td>` : ''}</tr>` }).join('') : `<tr><td colspan="${10 + (mvOn ? 1 : 0) + (ad ? 1 : 0)}" class="empty">아직 신청자가 없어요.</td></tr>`}${Object.entries(s.late || {}).filter(([, v]) => v).map(([pid, t]) => `<tr class="lrow"><td class="num">-</td><td class="stick"><b>${esc(pname(pid))}</b></td><td></td><td class="muted">신청 마감 후 취소</td><td class="num muted">${fmtTS(t)}</td>${mvOn ? '<td></td>' : ''}<td></td><td></td><td></td><td><b class="t3">취소</b></td><td class="num"><input type="checkbox" class="staffck" checked ${ad ? `data-in="lateuntoggle" data-id="${pid}"` : 'disabled'} aria-label="마감 후 취소 해제"></td>${ad ? '<td></td>' : ''}</tr>`).join('')}</tbody></table></div>`;
  return h
    + (ad && (canTier || canRm) ? `<p class="note">🛠 운영진: ${canTier ? '순위 칸을 누르면 0~3순위를 직접 바꿀 수 있어요(✎ 표시는 직접 바꾼 순위). ' : ''}${canRm ? '“삭제”는 마감 후 취소(3순위) 기록 없이 명단에서 지워요. 다음 경기 3순위로 남기려면 “마감 후 취소”를 쓰세요.' : ''}</p>` : '')
    + `<p class="note">신청 ${c.sel.length + c.wait.length}${s.capacity ? ' / ' + s.capacity : ''}명 (선발 ${c.sel.length}명, 대기 ${c.wait.length}명). ${c.base ? '' : '<b>The Base 구장이 아니라서 순위 없이 신청 순서대로(선착순) 선발해요.</b>'}</p><details class="rules-d"><summary>순위 규칙 보기</summary><p>0순위 구장 예약자·경기 운영자(정원 무관) → 1순위 직전 경기 미참여 → 2순위 선착순 → 3순위 직전 경기(${prevAny ? fmtDate(prevAny) : '없음'}) 신청 마감 후 취소자. 같은 순위 안에서는 신청 순서대로예요. (The Base 구장에만 적용)</p></details>`;
}

/* ───────── monthly schedule poster ───────── */
function monthsWithSessions() { return [...new Set(Object.keys(S.sessions).map(id => id.slice(0, 7)))].sort() }
function defaultMonth() { const ms = monthsWithSessions(); const t = today().slice(0, 7); const d = new Date(); const nx = `${d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear()}-${p2(d.getMonth() === 11 ? 1 : d.getMonth() + 2)}`; return ms.includes(nx) ? nx : ms.includes(t) ? t : ms[ms.length - 1] || t }
function schedCfg() { return { tag: 'WEEKDAYS FUTSAL CLUB', footer: '', ...(S.meta?.sched || {}) } }
function md(id) { const [, m, d] = id.split('-'); return `${+m}/${+d}(${dow(id)})` }
async function drawSchedule(ym, fk) {
  const ss0 = Object.keys(S.sessions).filter(id => id.startsWith(ym)); const fl = schedCfg().footer.split('\n').filter((l, i, a) => i < 8).length;
  const W = 1080, H = Math.max(1515, 895 + 124 + 66 * Math.max(6, ss0.length) + 80 + fl * 50 + 50); const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const ssT = Object.keys(S.sessions).filter(id => id.startsWith(ym)).map(id => S.sessions[id]);
  const PF = await posterFonts([schedCfg().footer, schedCfg().tag, ...ssT.map(x => (x.venue || '') + idsToNames(x.p0))], fk);
  const img = await emblem(); const LAT = PF.LAT, KR = PF.KR, BD = PF.BD;
  let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#2A7A3B'); gr.addColorStop(1, '#2E8744'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = '#23693A'; g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, 520); g.lineTo(0, 150); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.92)'; g.lineWidth = 34; g.beginPath(); g.moveTo(-20, 160); g.lineTo(W + 20, 520); g.stroke(); g.lineWidth = 22; g.beginPath(); g.moveTo(640, 360); g.lineTo(W + 20, 230); g.stroke();
  g.fillStyle = '#fff'; g.font = `30px ${BD}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(schedCfg().tag, 36, 56);
  g.save(); g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 30; g.shadowOffsetY = 12; badge(g, img, W / 2, 272, 170); g.restore(); badge(g, img, W / 2, 272, 170);
  const [y, m] = ym.split('-'); g.textAlign = 'center';
  g.fillStyle = '#FF9F1C'; g.font = `112px ${LAT}`; g.fillText(`${y}. ${m}.`, W / 2, 610);
  g.fillStyle = '#fff'; g.font = `112px ${LAT}`; g.fillText('WEEKDAYS', W / 2, 730); g.fillText('MATCH SCHEDULE', W / 2, 850);
  const ss = Object.keys(S.sessions).filter(id => id.startsWith(ym)).sort().map(id => S.sessions[id]);
  const openHs = [...new Set(ss.map(s => (s.applyOpen || '').slice(11, 13)).filter(Boolean))]; const fixedH = openHs.length === 1 ? +openHs[0] : null;
  const cols = [['회차', 150], ['일시', 270], ['장소', 210], [fixedH != null ? `신청\n(${fixedH}시 고정)` : '신청 오픈', 180], ['예약자', 150]];
  const x0 = (W - cols.reduce((a, c) => a + c[1], 0)) / 2, ty = 895, hh = 124, rh = 66, nrows = Math.max(6, ss.length);
  g.fillStyle = '#A9D18E'; g.fillRect(x0, ty, W - 2 * x0, hh); g.fillStyle = '#fff'; g.fillRect(x0, ty + hh, W - 2 * x0, rh * nrows);
  g.strokeStyle = '#9AA3A0'; g.lineWidth = 2; g.strokeRect(x0, ty, W - 2 * x0, hh + rh * nrows);
  let cx = x0; cols.forEach(([t, w], i) => { if (i) { g.beginPath(); g.moveTo(cx, ty); g.lineTo(cx, ty + hh + rh * nrows); g.stroke() }
    g.fillStyle = '#131C2B'; g.font = `34px ${BD}`; const ls = t.split('\n'); ls.forEach((l, j) => g.fillText(l, cx + w / 2, ty + hh / 2 + 12 + (j - (ls.length - 1) / 2) * 42)); cx += w });
  for (let r = 0; r <= nrows; r++) { g.beginPath(); g.moveTo(x0, ty + hh + r * rh); g.lineTo(W - x0, ty + hh + r * rh); g.stroke() }
  ss.forEach((s, r) => { const yy = ty + hh + r * rh + rh / 2 + 12; let cx2 = x0;
    const vals = [[s.no ? `${s.no}회` : '', '#131C2B'], [`${md(s.date)} ${+String(s.time || '00').slice(0, 2)}시`, '#C0392B'], [s.venue || '', '#131C2B'], [s.applyOpen ? md(s.applyOpen.slice(0, 10)) + (fixedH == null ? ' ' + s.applyOpen.slice(11, 16) : '') : '', '#131C2B'], [idsToNames(s.p0), '#131C2B']];
    vals.forEach(([v, col], i) => { const w = cols[i][1]; g.fillStyle = col; fitFont(g, v, `{s}px ${BD}`, 32, w - 16); g.fillText(v, cx2 + w / 2, yy); cx2 += w }) });
  const fy = ty + hh + rh * nrows + 70; g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `34px ${BD}`;
  schedCfg().footer.split('\n').slice(0, 8).forEach((l, i) => { fitFont(g, l, `{s}px ${BD}`, 34, W - 2 * x0); g.fillText(l, x0 + 10, fy + i * 50) });
  return c;
}
async function refreshSchedule() { const ym = S.schedYm || defaultMonth(); const c = await drawSched(ym); (S.schedImg ??= {})[ym] = c.toDataURL('image/png'); const el = document.querySelector('img.schedimg'); if (el) el.src = S.schedImg[ym]; else render() }
async function shareBlob(b, name, download) {
  const file = new File([b], name, { type: 'image/png' });
  if (!download && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return } catch (e) { if (e.name === 'AbortError') return } }
  if (S.store?.dl) { try { await S.store.dl.save({ filename: name, data: b }); toast('이미지를 저장했어요.') } catch (e) { if (e?.code !== 'declined') toast('이 화면에서는 저장할 수 없어요.') } return }
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000); toast('이미지를 저장했어요.');
}
function schedPanel() {
  const ms = monthsWithSessions(); const ym = S.schedYm || defaultMonth(); const img = S.schedImg?.[ym]; if (!img && !S.schedBusy) { S.schedBusy = 1; queueMicrotask(() => refreshSchedule().catch(e => console.error(e)).finally(() => { S.schedBusy = 0 })) } const cf = schedCfg();
  const ss = Object.keys(S.sessions).filter(id => id.startsWith(ym)); const noNo = ss.filter(id => !S.sessions[id].no).length; if (S.admin) queueMicrotask(() => fillThumbs('sched', ym));
  const monthSel = `<select id="sch-ym" class="inp" style="margin-top:12px;max-width:460px" data-in="schedym">${ms.map(x => `<option value="${x}" ${x === ym ? 'selected' : ''}>${x.replace('-', '년 ')}월 (${Object.keys(S.sessions).filter(id => id.startsWith(x)).length}경기)</option>`).join('')}</select>`;
  const form = `<h2>포스터에 들어갈 내용<small>입력하면 바로 반영돼요</small></h2><div class="panel pad pform">
    <div class="field"><label for="sch-tag">🏷️ 왼쪽 위 문구</label><input id="sch-tag" class="inp" type="text" value="${esc(cf.tag)}" data-in="schedf" data-f="tag"></div>
    <div class="field"><label for="sch-ft">📢 아래 안내 문구 <small class="muted">줄바꿈으로 여러 줄</small></label><textarea id="sch-ft" class="inp" rows="3" data-in="schedf" data-f="footer" placeholder="회장 홍길동 : 010-0000-0000&#10;※매달 변경 가능성 있음">${esc(cf.footer)}</textarea></div>
    <p class="note" style="margin:6px 0 0">경기관리에 입력한 일정(회차, 날짜·시간, 장소, 신청 오픈, 구장 예약자)으로 자동으로 만들어져요.${noNo ? ` 회차가 비어 있는 경기가 ${noNo}개 있어요. 경기관리 표의 "회차" 칸에 입력하면 표에 들어가요.` : ''}</p></div>`;
  return monthSel + `<div class="dgrid"><section>${S.admin ? form + designPanel('sched', ym, schedDesign()) : ''}</section><section><h2>포스터 미리보기</h2>
    <img class="poster schedimg" alt="${ym} 월별 일정표 미리보기" src="${img || ''}" width="1080" height="1515">
    <div class="row" style="margin-top:10px"><button class="btn primary" data-act="schedshare">공유하기</button><button class="btn" data-act="scheddl">이미지 저장</button></div></section></div>`;
}

/* ───────── record import (paste) ───────── */
const CMAP = { '흰': 'WHITE', '화': 'WHITE', '검': 'BLACK', '블': 'BLACK', '파': 'BLUE', '빨': 'RED', '레': 'RED', '노': 'YELLOW', '옐': 'YELLOW', '초': 'GREEN', '그': 'GREEN' };
function colorWord(w) { w = (w || '').trim(); const up = w.toUpperCase(); const p = PALETTE.find(x => up.startsWith(x.name)); if (p) return p.name; return CMAP[w[0]] || null }
function parseRecord(txt) {
  const sec = {}; let cur = null;
  for (const raw of txt.split(/\r?\n/)) { const l = raw.trim(); if (!l) continue; const m = l.match(/^\[(.+?)\]\s*(.*)$/);
    if (m) { cur = m[1].replace(/\s/g, ''); sec[cur] = sec[cur] || []; if (m[2]) sec[cur].push(m[2]); continue } if (cur) sec[cur].push(l) }
  const pick = (...keys) => { const k = Object.keys(sec).find(x => keys.some(y => x.includes(y))); return k ? sec[k] : [] };
  const names = lines => lines.join(' ').split(/[\s,]+/).map(x => x.trim()).filter(x => x && x !== '없음');
  const teams = []; for (const l of pick('팀')) { const m = l.match(/^(\S+)(?:\s+(\S+))?\s*[:：]\s*(.+)$/); if (!m) continue; const col = colorWord(m[2] || m[1]) || colorWord(m[1]); if (col) teams.push({ color: col, players: names([m[3]]) }) }
  const results = []; for (const l of pick('결과')) { const m = l.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\S+)$/); if (m) { const a = colorWord(m[1]), b = colorWord(m[4]); if (a && b) results.push({ home: a, hg: +m[2], ag: +m[3], away: b }) } }
  return { ops: names(pick('운영')), res: names(pick('예약')), t1: names(pick('1순위')), t2: names(pick('2순위')), t3: names(pick('3순위')), wait: names(pick('대기')), late: names(pick('마감', '취소')), teams, results };
}
function importTemplate() {
  return `[경기운영] 없음
[경기장 예약자] 김바우

[1순위]
손효석 이도형 김민혁 손준민 안준영 이호열
박종현 지유균

[2순위 참확정]
김민준 강인호 한준호 윤창민 이준현 양성필
이정욱 이태명 이건

[대기]
도현우 고광원 권순업 문태웅

[마감취소]
김동준

[팀] (맨 앞 이름이 주장)
파 BLUE: 김민혁 이도형 안준영 한준호 윤창민 이정욱
검 BLACK: 이준현 김바우 박종현 강인호 양성필 손효석
흰 WHITE: 이태명 김민준 지유균 손준민 이호열 이건

[경기결과]
흰 0 0 검
파 0 2 검
파 1 5 흰
파 2 1 검
흰 0 1 검
흰 4 1 파
흰 1 1 검
파 1 0 검
파 3 3 흰`;
}
async function importRecord(f) {
  const r = parseRecord(f.text); const sid = f.date;
  if (r.teams.length !== 3) { toast('[팀] 칸에 세 팀(색: 이름들)을 적어 주세요.'); return false }
  if (!r.results.length) { toast('[경기결과]를 찾지 못했어요.'); return false }
  const tcol = r.teams.map(t => t.color); const bad = r.results.find(x => !tcol.includes(x.home) || !tcol.includes(x.away)); if (bad) { toast(`결과의 색(${bad.home}/${bad.away})이 팀 색과 맞지 않아요.`); return false }
  if (S.sessions[sid] && !confirm(`${fmtDate(sid)} 경기 기록이 이미 있어요. 붙여넣은 내용으로 바꿀까요? (기존 대진과 골 기록은 지워져요)`)) return false;
  const id = async n => await ensurePlayer(n); const ids = async arr => { const o = []; for (const n of arr) { const x = await id(n); if (x && !o.includes(x)) o.push(x) } return o };
  const ops = await ids(r.ops), res = await ids(r.res), t1 = await ids(r.t1), t2 = await ids(r.t2), t3 = await ids(r.t3), wait = await ids(r.wait), late = await ids(r.late);
  const K = {}; const teams = {}; const captains = {};
  for (let i = 0; i < 3; i++) { const k = KEYS[i]; K[r.teams[i].color] = k; const ps = await ids(r.teams[i].players); teams[k] = { players: ps, colorName: r.teams[i].color }; captains[k] = ps[0] || null }
  const applicants = [...new Set([...res, ...ops, ...t1, ...t2, ...t3])]; const at0 = new Date(sid + 'T12:00').getTime();
  const tierOf = p => t1.includes(p) ? 1 : t3.includes(p) ? 3 : 2;
  const apps = applicants.filter(p => !res.includes(p) && !ops.includes(p)).concat(wait).map((p, i) => ({ k: 'imp' + i, pid: p, uid: 'import', at: at0 + i * 1000, tier: tierOf(p) }));
  const doc = { date: sid, time: f.time || DEFAULTS.time, venue: f.venue || DEFAULTS.venue, evpw: '', notice: DEFAULTS.notice || '', capacity: +f.capacity || DEFAULTS.capacity || 18,
    applyOpen: shiftDate(sid, DEFAULTS.openDays, DEFAULTS.openTime), applyClose: shiftDate(sid, DEFAULTS.closeDays, DEFAULTS.closeTime),
    stage: 'match', draftStatus: 'done', applicants, waitlist: wait, apps, p0: res, ops, late: Object.fromEntries(late.map(p => [p, at0])),
    captains, captainTokens: { A: null, B: null, C: null }, order: [...KEYS], picks: [], pending: null, teams, timing: DEF_TIMING, mom: {}, no: S.sessions[sid]?.no || 0, imported: true, createdAt: Date.now() };
  return await w(async () => {
    for (const [eid, e] of Object.entries(S.events)) if (e.session === sid) await S.store.del('events/' + eid);
    for (const m of sessMatches(sid)) await S.store.del(mp(m.id));
    await S.store.set(sp(sid), doc);
    let ev = 0;
    for (let i = 0; i < r.results.length; i++) { const x = r.results[i]; const n = i + 1; const mid = `${sid}_${n}`; const hk = K[x.home], ak = K[x.away];
      await S.store.set(mp(mid), { session: sid, n, round: Math.floor(i / 3) + 1, slot: i % 3 + 1, home: hk, away: ak, status: 'done', timer: { running: false, acc: 605, startedAt: 0 }, endedAt: at0 + n });
      for (const [tk, g] of [[hk, x.hg], [ak, x.ag]]) for (let j = 0; j < g; j++) { ev++; await S.store.set(`events/imp${sid.replace(/-/g, '')}e${String(ev).padStart(3, '0')}`, { session: sid, match: mid, team: tk, scorer: null, assist: null, og: false, sec: 60 * (j + 1), half: 'h1', at: at0 + ev }) } }
  }, `${fmtDate(sid)} 경기 기록을 넣었어요.`);
}
function importSheet() {
  const f = S.imp || (S.imp = { date: Object.keys(S.sessions).filter(id => id <= today() && !sessMatches(id).length).sort().pop() || today(), time: '21:00', venue: '용산 7구장', capacity: 18, text: importTemplate() });
  return `<h4>경기 기록 붙여넣기</h4><p>정리해 둔 지난 경기 기록을 붙여넣으면 경기 기록으로 저장돼요. [팀] 칸은 "색 이름: 선수들" 형식이고, 맨 앞 이름이 주장이에요. 경기결과는 "흰 0 0 검"처럼 한 줄에 한 경기예요. 득점자는 비워 두고, 나중에 경기진행 → 경기에서 채울 수 있어요.</p>
  <div class="panel"><div class="field grid2c"><label>날짜<input class="inp" type="date" value="${esc(f.date)}" data-in="impf" data-f="date"></label><label>시간<input class="inp" type="time" value="${esc(f.time)}" data-in="impf" data-f="time"></label></div>
  <div class="field grid2c"><label>장소<input class="inp" type="text" value="${esc(f.venue)}" list="venue-list" data-in="impf" data-f="venue"></label><label>정원<input class="inp" type="number" value="${f.capacity}" data-in="impf" data-f="capacity"></label></div>
  <div class="field"><label>기록<textarea class="inp" style="min-height:300px;font-size:14px" data-in="impf" data-f="text">${esc(f.text)}</textarea></label></div></div>
  <div class="row" style="margin-top:12px"><button class="btn primary" data-act="impgo">기록 저장</button></div>`;
}

/* ───────── simple login (name + 4-digit PIN) ───────── */
async function sha(txt) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('') }
const pinHash = (pid, pin) => sha(`${pid}:${pin}:wd-futsal-v1`);
function loadAuth() { try { const s = sessionStorage.getItem('wf:auth'); if (s) return JSON.parse(s) } catch { } return load('auth', null) }
function saveAuth(a, remember) { try { sessionStorage.removeItem('wf:auth') } catch { } save('auth', null); if (!a) return; if (remember) save('auth', a); else try { sessionStorage.setItem('wf:auth', JSON.stringify(a)) } catch { } }
function loginFields(prefix, name) {
  return `<div class="field"><label for="${prefix}-name">이름</label><input id="${prefix}-name" class="inp" type="text" maxlength="20" value="${esc(name || '')}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"><p class="lgerr" id="${prefix}-err" role="alert" hidden></p></div>
  <div class="field"><label for="${prefix}-pin">비밀번호 (숫자 4자리)</label><input id="${prefix}-pin" class="inp pin" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="••••"><span class="note" style="margin:0">처음이면 지금 입력한 번호가 내 비밀번호로 등록돼요.</span></div>
  <label class="ck autock"><input type="checkbox" id="${prefix}-auto" checked> 자동 로그인 (이 기기에서 다음에도 로그인 유지)</label>` }
async function loginFlow(name, pin, remember) {
  name = (name || '').replace(/\(\s*게\s*\)/g, '').trim().slice(0, 20); pin = (pin || '').trim();
  if (!name) { toast('이름을 입력해 주세요.'); return null } if (!/^\d{4}$/.test(pin)) { toast('비밀번호는 숫자 4자리로 입력해 주세요.'); return null }
  const pid = findPlayer(name);
  if (!pid) { const msg = '회원 목록에 포함되어 있지 않습니다. 다시 확인해보세요.'; toast(msg); document.querySelectorAll('.lgerr').forEach(e => { e.textContent = `"${name}" — ${msg}`; e.hidden = false }); return null }
  const h = await pinHash(pid, pin); let a = null; try { a = await S.store.get('auth/' + pid) } catch { }
  if (!a || !a.h) { if (!confirm(`${name} 님의 비밀번호를 ${pin.replace(/./g, '•')}(으)로 등록할까요? 다른 기기에서도 이 번호로 로그인해요.`)) return null;
    if (!(await w(() => S.store.set('auth/' + pid, { h, at: Date.now() })))) return null; toast('비밀번호를 등록했어요.') }
  else if (a.h !== h) { toast('비밀번호가 달라요. 잊었다면 운영진에게 초기화를 요청하세요.'); return null }
  S.auth = { pid, h }; saveAuth(S.auth, remember); S.me = name; save('me', name); return pid;
}
function loginScreen() {
  return `<div class="lgscreen"><div class="lgcard"><img src="${EMBLEM_SRC}" alt="" class="lgemb"><h1>${esc(CFG.club?.name || 'WEEKDAYS FUTSAL CLUB')}</h1><p class="lgsub">이름과 비밀번호 4자리로 로그인해요</p>
    <div class="panel">${loginFields('lg', S.me)}<div class="pad" style="padding-top:4px"><button class="btn primary block lgbtn cta" data-act="login">로그인</button></div></div>
    <p class="note">처음이면 지금 입력한 비밀번호로 바로 등록돼요. 비밀번호를 잊었다면 운영진에게 초기화를 요청하세요.</p>
    <button class="linkbtn" data-act="opmode">운영진이신가요? 운영모드로 들어가기 ›</button></div></div>`;
}
function logout() { const pt = load('pushToken', null); if (pt) { S.store?.del('pushTokens/' + pt).catch(() => { }); save('pushToken', null) } S.auth = null; /* 이 기기의 알림 연결만 끊어요(다른 기기 설정은 그대로) */ saveAuth(null); S.me = ''; save('me', ''); toast('로그아웃했어요.'); render() }
async function verifyAuth() { if (!S.auth) return; try { const a = await S.store.get('auth/' + S.auth.pid); if (!a || a.h !== S.auth.h || !S.players[S.auth.pid]) { S.auth = null; saveAuth(null); toast('다시 로그인해 주세요.'); render() } else { S.me = S.players[S.auth.pid].name; render() } } catch { } }
function myCar() { const pid = myPid(); return (pid && S.contacts?.[pid]?.car) || load('car', '') || '' }
async function adminPinOk(pin) { const h = S.meta?.admin?.h; if (h) return (await sha('wd-admin:' + pin)) === h; return pin === String(CFG.adminPin ?? '0000') }
function loginCard() {
  if (S.auth && S.players[S.auth.pid]) { const auto = !!load('auth', null);
    return `<div class="panel pad logged"><div class="lg-me"><span class="av on">${esc(pname(S.auth.pid).slice(-2))}</span><div><b>${esc(pname(S.auth.pid))}</b><small>${auto ? '자동 로그인 켜짐' : '이번 접속에만 로그인'}</small></div></div>
      <div class="row"><button class="btn" data-act="pinchange">비밀번호 변경</button><button class="btn" data-act="logout">로그아웃</button></div>
      <div class="field" style="margin:4px 0 0"><label for="me-car">🚗 내 차량번호 <small class="muted">주차 신청할 때 자동으로 채워져요</small></label><div style="display:flex;gap:8px"><input id="me-car" class="inp" type="text" maxlength="12" placeholder="예: 12가3456" value="${esc(myCar())}" autocomplete="off"><button class="btn" data-act="carsave">저장</button></div></div></div>` }
  return `<div class="panel">${loginFields('lg', S.me)}<div class="pad" style="padding-top:4px"><button class="btn primary block" data-act="login">로그인</button></div></div>`;
}

/* ───────── admin: 공지 (posters & texts) ───────── */
function pushGroups(s0) { if (!s0) return {}; const c = s0.stage === 'apply' ? classify(s0) : null;
  const all = c ? c.rows.map(r => r.pid) : [...(s0.applicants || []), ...(s0.waitlist || [])]; const sel = c ? c.sel.map(r => r.pid) : (s0.applicants || []);
  const duty = k => { const fix = s0.duty?.[k] || []; return fix.length ? fix : Object.entries(s0.dutyReq?.[k] || {}).filter(([, v]) => v).map(([p0]) => p0) };
  const uniq = a => [...new Set(a.filter(p0 => p0 && S.players[p0]))];
  return { apps: uniq(all), sel: uniq(sel), ball: uniq(duty('ball')), drink: uniq(duty('drink')), park: uniq(Object.keys(s0.park || {}).filter(p0 => s0.park[p0])) } }
const RULE_TARGETS = [['all', '전체 회원'], ['apps', '신청자 (대기 포함)'], ['unapplied', '아직 신청 안 한 회원'], ['sel', '참가자 (대기 제외)'], ['ball', '⚽ 공당'], ['drink', '🥤 물당'], ['park', '🚗 주차 신청자']];
const RULE_EVENTS = [['applyOpen', '신청 오픈'], ['applyClose', '신청 마감'], ['match', '경기 시작']];
const SYS_RULES = {
  sys_open: { sys: 'open', ptype: 'open', kind: 'event', event: 'applyOpen', offsetMin: 0, target: 'all', title: '📢 경기 신청이 열렸어요', body: '{날짜} {시간} · {구장}\n지금 앱에서 신청하세요! (선착순)' },
  sys_closing: { sys: 'closing', ptype: 'closing', kind: 'event', event: 'applyClose', offsetMin: -120, target: 'unapplied', title: '⏰ 신청 마감 2시간 전이에요', body: '{날짜} {시간} · {구장}\n아직 신청하지 않았어요.' },
  sys_day: { sys: 'day', ptype: 'day', kind: 'event', event: 'match', offsetMin: -540, target: 'sel', title: '⚽ 오늘 {시간} 경기가 있어요', body: '{구장}\n공당 {공당} · 물당 {물당}' },
  sys_promote: { sys: 'promote', ptype: 'promote', kind: 'trigger', trigger: 'promote', title: '🎉 선발됐어요!', body: '{날짜} 경기 대기에서 선발로 올라갔어요. 꼭 참석해 주세요!' },
  sys_captain: { sys: 'captain', ptype: 'captain', kind: 'trigger', trigger: 'captain', title: '👑 주장으로 지정됐어요', body: '{날짜} 경기 주장이에요. 앱에서 드래프트에 참여해 주세요.' },
  sys_team: { sys: 'team', ptype: 'team', kind: 'trigger', trigger: 'team', title: '📣 팀 발표! 내 팀은 {팀}', body: '{날짜} 경기 · 주장 {주장}\n팀원 {팀원}' } };
const TRIGGER_DESC = { promote: ['누군가 취소해서 대기에서 선발로 올라갔을 때', '올라간 회원 본인', '{날짜} {시간} {구장}'], captain: ['운영진이 주장으로 지정했을 때', '주장이 된 회원', '{날짜} {시간} {구장} {팀} {주장}'], team: ['드래프트가 끝났을 때', '각 팀원', '{날짜} {시간} {구장} {팀} {주장} {팀원}'] };
async function seedSysRules() { if (S.sysSeeding || !S.rules || !S.admin) return; const miss = Object.keys(SYS_RULES).filter(id => !S.rules[id]); if (!miss.length) return; S.sysSeeding = true;
  try { for (const id of miss) { const def = SYS_RULES[id]; const sentFor = {}; if (def.kind === 'event') Object.entries(S.sessions).forEach(([sid, x]) => { const n = x.notified || {}; if (n[def.sys]) sentFor[sid] = n[def.sys] });
      await S.store.set('pushRules/' + id, { ...def, on: true, sentFor, createdAt: 1 }) } } catch (e) { console.warn(e) } S.sysSeeding = false }
function ruleDesc(R) { if (R.kind === 'trigger') { const d = TRIGGER_DESC[R.trigger] || ['', '']; return `${d[0]} · ${d[1]}` } const tg = (RULE_TARGETS.find(x => x[0] === R.target) || [, '전체 회원'])[1];
  if (R.kind === 'date') return `${R.at ? R.at.replace('T', ' ') : '-'} 한 번 · ${tg}${R.sentAt ? ' · ✓ 보냄' : ''}`;
  const m = Math.abs(+R.offsetMin || 0), h = Math.floor(m / 60), mm = m % 60; const off = m ? `${h ? h + '시간' : ''}${mm ? ' ' + mm + '분' : ''} ${+R.offsetMin < 0 ? '전' : '후'}` : '그 시각';
  return `경기마다 · ${(RULE_EVENTS.find(x => x[0] === R.event) || [, '-'])[1]} ${off.trim()} · ${tg}` }
const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'], CHO_BASE = { 'ㄲ': 'ㄱ', 'ㄸ': 'ㄷ', 'ㅃ': 'ㅂ', 'ㅆ': 'ㅅ', 'ㅉ': 'ㅈ' };
const CHO_TABS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
function choOf(name) { const c = String(name || '').trim().charCodeAt(0); if (c >= 0xAC00 && c <= 0xD7A3) { const k = CHO[Math.floor((c - 0xAC00) / 588)]; return CHO_BASE[k] || k } return '기타' }
function pushComposer() { const ids = Object.keys(S.sessions).filter(id => !S.sessions[id].practice).sort().reverse().slice(0, 12); if (!S.pnSid || !S.sessions[S.pnSid]) S.pnSid = runSid() || ids[0] || null;
  const s0 = S.pnSid ? S.sessions[S.pnSid] : null; const G = pushGroups(s0); S.pnSel ??= [];
  const members = byName(Object.keys(S.players).filter(id => mstatus(S.players[id]) !== 'dormant'));
  const grp = [['all', '전체 회원', members.length], ['apps', '신청자 (대기 포함)', G.apps?.length || 0], ['sel', '참가자 (대기 제외)', G.sel?.length || 0], ['ball', '⚽ 공당', G.ball?.length || 0], ['drink', '🥤 물당', G.drink?.length || 0], ['park', '🚗 주차 신청자', G.park?.length || 0]];
  const sel = new Set(S.pnSel); const q = (S.pnQ || '').trim();
  const byCho = {}; members.forEach(id => { const k = choOf(pname(id)); (byCho[k] ??= []).push(id) }); const tabs = [...CHO_TABS, ...(byCho['기타'] ? ['기타'] : [])];
  if (!S.pnTab || (S.pnTab !== 'sel' && !byCho[S.pnTab])) S.pnTab = tabs.find(t => byCho[t]) || 'ㄱ';
  const shown = q ? members.filter(id => pname(id).includes(q)) : S.pnTab === 'sel' ? members.filter(id => sel.has(id)) : (byCho[S.pnTab] || []);
  const choTabs = `<div class="chotabs" role="tablist"><button role="tab" class="cho sel-tab" data-act="pntab" data-k="sel" aria-selected="${S.pnTab === 'sel' && !q}">선택됨<b>${sel.size}</b></button>${tabs.map(t => { const n = (byCho[t] || []).length, m = (byCho[t] || []).filter(id => sel.has(id)).length; return `<button role="tab" class="cho" data-act="pntab" data-k="${t}" aria-selected="${S.pnTab === t && !q}" ${n ? '' : 'disabled'}>${t}${m ? `<i>${m}</i>` : ''}</button>` }).join('')}</div>`;
  seedSysRules(); const order = Object.keys(SYS_RULES); const all = Object.entries(S.rules || {}); const delSys = all.filter(([id, R]) => R.sys && R.deleted);
  const rules = all.filter(([, R]) => !R.deleted).sort((x, y) => { const a = order.indexOf(x[0]), b = order.indexOf(y[0]); if (a >= 0 || b >= 0) return (a < 0 ? 99 : a) - (b < 0 ? 99 : b); return (y[1].createdAt || 0) - (x[1].createdAt || 0) });
  return `<div class="pnwrap"><div class="pncol">
    <section class="panel pad"><h3 class="pnh">① 발송 그룹</h3><label class="pf"><span>기준 경기</span><select class="inp" data-in="pnsid">${ids.map(id => `<option value="${id}" ${id === S.pnSid ? 'selected' : ''}>${fmtDate(id)} ${esc(S.sessions[id].time || '')} · ${esc(S.sessions[id].venue || '')}</option>`).join('')}</select></label>
      <div class="pngrp">${grp.map(([k, n, c]) => `<button class="pgbtn" data-act="pngrp" data-k="${k}" ${c ? '' : 'disabled'}><span>${n}</span><b>${c}</b></button>`).join('')}</div><p class="note" style="margin:6px 0 0">그룹을 누르면 아래 회원 목록에 그 사람들이 선택돼요.</p></section>
    <section class="panel pad"><div class="pnh2"><h3 class="pnh">② 회원 목록 <small>${sel.size}명 선택</small></h3><button class="linkbtn" data-act="pngrp" data-k="none">선택 해제</button></div>
      <input class="inp" type="search" placeholder="이름 검색 (전체에서 찾기)" value="${esc(S.pnQ || '')}" data-in="pnq" style="margin:8px 0">${choTabs}
      <div class="dpick pnchips">${shown.map(id => `<button class="chip ${sel.has(id) ? 'sel' : ''}" data-act="pntog" data-id="${id}">${sel.has(id) ? '✓ ' : ''}${esc(pname(id))}</button>`).join('') || `<span class="muted">${S.pnTab === 'sel' && !q ? '아직 선택한 회원이 없어요.' : '맞는 회원이 없어요.'}</span>`}</div>${!q && S.pnTab !== 'sel' && shown.length ? `<div class="chotools"><button class="linkbtn" data-act="pnchoall">${S.pnTab} 모두 선택</button><button class="linkbtn" data-act="pnchonone">${S.pnTab} 모두 해제</button></div>` : ''}</section></div>
  <div class="pncol pnright"><section class="panel pad pnmsg"><h3 class="pnh">③ 메시지</h3>
    <input id="pn-title" class="inp" maxlength="40" placeholder="제목 (예: 이번 주 구장 변경 안내)" value="${esc(S.pnTitle || '')}"><textarea id="pn-body" class="inp" rows="6" maxlength="200" placeholder="내용" style="margin-top:8px">${esc(S.pnBody || '')}</textarea>
    <div class="pnto">받는 사람 <b>${sel.size}명</b>${sel.size ? ` · ${[...sel].slice(0, 4).map(id => esc(pname(id))).join(', ')}${sel.size > 4 ? ` 외 ${sel.size - 4}명` : ''}` : ''}</div>
    <button class="btn primary block" data-act="pushsend" ${sel.size ? '' : 'disabled'}>${sel.size ? `${sel.size}명에게 지금 보내기` : '받는 사람을 골라 주세요'}</button></section>
  <section class="panel pad"><div class="pnh2"><h3 class="pnh">⏰ 자동 알림 <small>${rules.length}개</small></h3><button class="btn sm primary" data-act="rulenew">＋ 새 자동 알림</button></div>
    <p class="note" style="margin:4px 0 8px">정해 둔 때가 되면 서버가 자동으로 보내요(5분 단위). <b>기본</b> 표시는 앱에 처음부터 있던 알림이고, 내용·대상·시기를 고치거나 끌 수 있어요.</p>
    ${rules.length ? `<div class="rules">${rules.map(([id, R]) => `<div class="rule ${R.on === false ? 'off' : ''}"><div><b>${R.sys ? '<em class="sysb">기본</em>' : ''}${esc(R.title)}</b><small>${esc(ruleDesc(R))}</small></div><label class="sw"><input type="checkbox" data-in="ruleon" data-id="${id}" ${R.on === false ? '' : 'checked'}><i></i></label><button class="btn sm" data-act="ruleedit" data-id="${id}">수정</button><button class="btn sm danger" data-act="ruledel" data-id="${id}" aria-label="삭제">×</button></div>`).join('')}</div>` : '<p class="muted" style="margin:0">아직 자동 알림이 없어요.</p>'}${delSys.length ? `<button class="linkbtn" style="margin-top:8px" data-act="sysrestore">지운 기본 알림 ${delSys.length}개 되살리기</button>` : ''}</section></div></div>` }
function ruleSheet() { const R = S.ruleF || {}; const kind = R.kind || 'event';
  if (kind === 'trigger') { const d = TRIGGER_DESC[R.trigger] || ['', '', ''];
    return `<h4>기본 알림 수정</h4><p class="note" style="margin:0 0 10px"><b>보내는 때</b> ${d[0]}<br><b>받는 사람</b> ${d[1]}</p>
    <label class="pf"><span>제목</span><input class="inp" id="rf-title" maxlength="40" value="${esc(R.title || '')}"></label>
    <label class="pf"><span>내용</span><textarea class="inp" id="rf-body" rows="3" maxlength="200">${esc(R.body || '')}</textarea></label>
    <p class="note" style="margin:-2px 0 10px">쓸 수 있는 글자: <b>${d[2].split(' ').join('</b> <b>')}</b></p>
    <div class="row" style="margin-top:8px"><button class="btn" data-act="rulereset">처음 내용으로</button><button class="btn primary" data-act="rulesave">저장</button></div>` }
  return `<h4>${S.ruleId ? '자동 알림 수정' : '새 자동 알림'}</h4>
    <label class="pf"><span>제목</span><input class="inp" id="rf-title" maxlength="40" value="${esc(R.title || '')}" placeholder="예: {날짜} 경기 신청이 곧 마감돼요"></label>
    <label class="pf"><span>내용</span><textarea class="inp" id="rf-body" rows="3" maxlength="200" placeholder="예: {시간} {구장} · 아직 신청 안 했다면 서둘러 주세요">${esc(R.body || '')}</textarea></label>
    <p class="note" style="margin:-2px 0 10px">글 속에 <b>{날짜}</b> <b>{시간}</b> <b>{구장}</b> <b>{마감}</b> <b>{공당}</b> <b>{물당}</b>을 쓰면 그 경기 정보로 바뀌어요.</p>
    <label class="pf"><span>받는 대상</span><select class="inp" id="rf-target">${RULE_TARGETS.map(([k, n]) => `<option value="${k}" ${(R.target || 'all') === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <div class="pf"><span>보내는 때</span><div class="seg"><button role="tab" data-act="rulekind" data-k="event" aria-selected="${kind === 'event'}">경기마다 반복</button><button role="tab" data-act="rulekind" data-k="date" aria-selected="${kind === 'date'}">특정 날짜·시간</button></div></div>
    ${kind === 'date' ? `<label class="pf"><span>날짜·시간</span><input class="inp" type="datetime-local" id="rf-at" value="${esc(R.at || '')}"></label><p class="note" style="margin:0 0 8px">경기 관련 대상(신청자, 공당 등)은 가장 가까운 다음 경기 기준이에요.</p>`
      : `<div class="rf-ev"><select class="inp" id="rf-event">${RULE_EVENTS.map(([k, n]) => `<option value="${k}" ${(R.event || 'applyClose') === k ? 'selected' : ''}>${n}</option>`).join('')}</select><input class="inp" id="rf-h" type="number" min="0" max="168" step="1" value="${Math.floor(Math.abs(+R.offsetMin || 120) / 60)}"><span>시간</span><input class="inp" id="rf-m" type="number" min="0" max="59" step="5" value="${Math.abs(+R.offsetMin || 120) % 60}"><span>분</span><select class="inp" id="rf-dir"><option value="-1" ${(+R.offsetMin || -1) < 0 ? 'selected' : ''}>전</option><option value="1" ${(+R.offsetMin || -1) > 0 ? 'selected' : ''}>후</option></select></div><p class="note" style="margin:0 0 8px">예: "신청 마감 · 3시간 0분 · 전" → 매 경기 마감 3시간 전에 보내요.</p>`}
    <div class="row" style="margin-top:8px">${R.sys ? '<button class="btn" data-act="rulereset">처음 내용으로</button>' : ''}<button class="btn primary" data-act="rulesave">저장</button></div>` }
function readRuleForm() { const g = id => document.getElementById(id); const R = { ...(S.ruleF || {}) }; if (g('rf-title')) R.title = g('rf-title').value.trim(); if (g('rf-body')) R.body = g('rf-body').value.trim(); if (g('rf-target')) R.target = g('rf-target').value;
  if (g('rf-at')) R.at = g('rf-at').value; if (g('rf-event')) { R.event = g('rf-event').value; R.offsetMin = (+g('rf-dir').value) * ((+g('rf-h').value || 0) * 60 + (+g('rf-m').value || 0)) } return R }
function viewNoticeMenu() {
  const nt = S.noticeTab || 'team';
  let h = subnav([['team', '팀 공지'], ['month', '월간 일정표'], ['recruit', '신청 안내 글'], ['push', '알림 보내기']], nt, 'ntab');
  if (nt === 'push') return h + pushComposer();
  if (nt === 'month') return h + (Object.keys(S.sessions).length ? schedPanel() : `<div class="panel"><p class="empty">경기를 먼저 추가하세요.</p></div>`);
  if (nt === 'recruit') { const up = Object.keys(S.sessions).filter(id => id >= today()).sort(); if (!up.length) return h + `<div class="panel"><p class="empty">예정된 경기가 없어요.</p></div>`;
    if (!up.includes(S.nsid)) S.nsid = up.includes(S.sid) ? S.sid : up[0]; const s = S.sessions[S.nsid];
    return h + `<select class="inp" style="margin-top:12px;max-width:460px" data-in="nsid">${up.map(id => `<option value="${id}" ${id === S.nsid ? 'selected' : ''}>${fmtDate(id)} ${esc(S.sessions[id].time || '')} · ${esc(S.sessions[id].venue || '')}</option>`).join('')}</select><div class="panel pad" style="margin-top:10px;max-width:760px"><pre class="pre">${esc(recruitText(s))}</pre><button class="btn primary block" data-act="copyrecruit">신청 안내 글 복사</button></div>` }
  const done = Object.keys(S.sessions).filter(id => S.sessions[id].draftStatus === 'done').sort().reverse();
  if (!done.length) return h + `<div class="panel pad"><p class="empty" style="padding:10px 0">아직 팀 선정이 끝난 경기가 없어요. 경기 메뉴에서 드래프트를 마치면 여기서 팀 공지 이미지를 만들 수 있어요.</p></div>`;
  if (!done.includes(S.sid)) { const up = done.filter(id => id >= today()); S.sid = up.length ? up[up.length - 1] : done[0] }
  return h + `<select class="inp" style="margin-top:12px;max-width:460px" data-in="sidpick">${done.map(id => `<option value="${id}" ${id === S.sid ? 'selected' : ''}>${fmtDate(id)} ${esc(S.sessions[id].time || '')} · ${esc(S.sessions[id].venue || '')}</option>`).join('')}</select>` + vNotice(S.sessions[S.sid], true);
}
/* ───────── admin: 일정 (calendar + list) ───────── */
function viewPlan() {
  const mv = S.mview || 'cal';
  let h = subnav([['cal', '달력'], ['list', '목록']], mv, 'mview') + `<div class="subact"><button class="btn sm" data-act="fillnos">회차 자동 채우기</button><button class="btn primary sm" data-act="caladd">＋ 경기 추가</button></div>`;
  if (mv === 'list') return h + viewManageList();
  const all = Object.keys(S.sessions).sort(); const nx = nextSid();
  if (!S.planSel) S.planSel = (S.sid && S.sessions[S.sid]) ? S.sid : nx || all[all.length - 1] || today();
  const ym = S.planM || S.planSel.slice(0, 7); S.planM = ym; const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate(), pad = first.getDay(), t = today(); const rows = Math.ceil((pad + days) / 7);
  let cells = ''; for (let i = 0; i < pad; i++) cells += '<span class="scd blank"></span>';
  for (let d = 1; d <= days; d++) { const id = `${y}-${p2(m)}-${p2(d)}`; const s = S.sessions[id]; const wd = (pad + d - 1) % 7; const st = s ? sStatus(s) : null;
    cells += `<button class="scd${s ? ' has st-' + st.k : ''}${id === t ? ' today' : ''}${id === S.planSel ? ' sel' : ''}${id < t ? ' past' : ''}${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}" data-act="planday" data-id="${id}"><span class="dn">${d}</span>${s ? `<em class="ev"><b>${esc((s.time || '').slice(0, 5))}</b><small>${esc(s.venue || '')}</small></em>` : ''}</button>` }
  for (let i = pad + days; i < rows * 7; i++) cells += '<span class="scd blank"></span>';
  const cnt = all.filter(id => id.startsWith(ym)).length;
  const cal = `<div class="scal panel"><div class="cal-hd"><button data-act="planm" data-d="-1" aria-label="이전 달">‹</button><b>${y}년 ${m}월<small>${cnt ? ` · 경기 ${cnt}회` : ''}</small></b><button data-act="planm" data-d="1" aria-label="다음 달">›</button></div>
    <div class="scw">${'일월화수목금토'.split('').map((x, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${x}</span>`).join('')}</div>
    <div class="scgrid" style="grid-template-rows:repeat(${rows},minmax(0,1fr))">${cells}</div>
    <div class="cal-leg"><span><i class="lg-open"></i>신청 중</span><span><i class="lg-game"></i>경기</span><span><i class="lg-done"></i>종료</span><span class="leg-hint">빈 날짜를 누르면 경기를 추가할 수 있어요</span></div></div>`;
  return h + `<div class="schwrap planwrap">${cal}<div class="schdetail">${planSide(S.planSel)}</div></div>`;
}
function planSide(id) {
  const s = S.sessions[id];
  if (!s) return `<div class="panel sched pside"><div class="sched-hd"><div><b>${fmtDate(id)}</b><span>경기가 없는 날이에요</span></div></div><div class="pad0"><button class="btn primary block" data-act="caladdon" data-id="${id}">＋ 이 날 경기 추가</button></div></div>`;
  const st = sStatus(s); const movable = !sessMatches(id).length; const c = appCounts(s);
  const f = (lab, fld, type, extra = '') => `<label class="pf"><span>${lab}</span><input class="inp" type="${type}" value="${esc(s[fld] ?? '')}" data-in="cell" data-sid="${id}" data-f="${fld}" ${extra}></label>`;
  return `<div class="panel sched pside"><div class="sched-hd"><div><b>${fmtDate(id)}${s.no ? ` · ${s.no}회` : ''}</b><span><span class="st st-${st.k}">${st.label}</span> 신청 ${c.sel + c.wait}${s.capacity ? '/' + s.capacity : ''}명${c.wait ? `, 대기 ${c.wait}` : ''}</span></div><span class="dday sm">${dday(id)}</span></div>
    <button class="btn primary block" data-act="gorun" data-id="${id}">이 경기 진행 화면 열기 →</button>
    <div class="pgrid">${f('회차', 'no', 'number', 'min="1"')}${f('시간', 'time', 'time')}<label class="pf"><span>장소</span>${venuePicker((S.venueCustom ??= {})[id] ? (s.venue && !VENUES.includes(s.venue) ? s.venue : '__custom') : s.venue, `data-in="venuesel" data-sid="${id}"`, `data-in="cell" data-sid="${id}" data-f="venue"`)}</label>${f('정원', 'capacity', 'number', 'min="3"')}${f('신청 오픈', 'applyOpen', 'datetime-local')}${f('신청 마감', 'applyClose', 'datetime-local')}</div>
    <div class="plinks">
      <button class="plink" data-act="staffedit" data-id="${id}"><span>구장 예약자 · 운영자</span><b>${esc(idsToNames(s.p0) || '-')} · ${esc(idsToNames(s.ops) || '-')}</b></button>
      <button class="plink" data-act="dutyedit" data-id="${id}"><span>공당 · 물당</span><b>${(s.duty?.ball || []).length || (s.duty?.drink || []).length ? `${esc(idsToNames(s.duty?.ball) || '-')} · ${esc(idsToNames(s.duty?.drink) || '-')}` : dutyReqLabel(s) || (applyClosed(s) ? '지정하기' : '아직 신청 없음')}</b></button>
      <button class="plink" data-act="parkedit" data-id="${id}"><span>주차</span><b>신청 ${parkApps(s).length}명${(s.parkWin || []).length ? ' · 당첨 ' + esc(idsToNames(s.parkWin)) : ''}</b></button>
    </div>
    <div class="row" style="margin-top:auto">${movable ? `<button class="btn sm" data-act="calmove" data-id="${id}">날짜 옮기기</button>` : ''}<button class="btn sm danger" data-act="delrow" data-id="${id}">경기 삭제</button></div></div>`;
}

/* ───────── 경기모드 (match mode) ───────── */
/* 일정 경기는 [시작 1시간 전 ~ 끝 예정 시각 + 1시간] 사이에만 고를 수 있어요 (연습 경기·진행 중인 경기는 예외) */
function mmHasTeams(id) { const s = S.sessions[id]; return s && KEYS.every(k => teamPlayers(s, k).length) }
function mmWindow(s) { const st = new Date(`${s.date}T${s.time || '21:00'}`).getTime(); const T = timing(s); const n = sessMatches(s.date).length || 9; const dur = n * (T.h1 + T.gk + T.h2 + (T.rest || 180)) * 1000; return { open: st - 3600e3, start: st, close: st + dur + 3600e3 } }
function mmAvail(id) { const s = S.sessions[id]; if (!s) return 'none'; if (s.practice || sessMatches(id).some(m => m.status === 'live')) return 'ok'; const w0 = mmWindow(s), now = nowS(); return now < w0.open ? 'soon' : now > w0.close ? 'past' : 'ok' }
function mmSid() {
  const ids = Object.keys(S.sessions).filter(mmHasTeams).sort(); if (!ids.length) return null;
  const ok = ids.filter(id => mmAvail(id) === 'ok'); if (S.mmPick && ok.includes(S.mmPick)) return S.mmPick;
  return ok.find(id => !S.sessions[id].practice) || ok[0] || null;
}
function pairsOf(s) { return (s.mm?.pairs || []).map(p => Array.isArray(p) ? p : String(p).split('')) }
function mmReady(s) { return !!s.mm?.pairs && sessMatches(s.date).length === 9 }
const CTL_STALE = 60000;
function mmCtl(s) { const c = s?.mmCtl; const me = myUid(); if (!c || !c.uid) return { free: true }; return { mine: c.uid === me, stale: nowS() - (c.beat || 0) > CTL_STALE, name: c.name || '회원' } }
function mmIsCtl() { const s = S.sessions[S.mmSid]; return !!(s && mmCtl(s).mine) }
async function mmTake(sid, force) { const me = myUid(); let ok = false;
  await w(() => S.store.txn(sp(sid), d => { if (!d) return null; const c = d.mmCtl; if (c && c.uid && c.uid !== me && nowS() - (c.beat || 0) <= CTL_STALE && !force) return null; d.mmCtl = { uid: me, pid: myPid() || null, name: S.me || '회원', at: nowS(), beat: nowS() }; ok = true; return d }));
  if (ok) S.mmBeat = Date.now(); return ok }
async function mmRelease(sid) { const me = myUid(); await w(() => S.store.txn(sp(sid), d => { if (!d || d.mmCtl?.uid !== me) return null; d.mmCtl = null; return d }), '진행을 내려놓았어요. 다른 사람이 진행할 수 있어요.') }
function mmCtlBar(s) { const c = mmCtl(s);
  if (c.mine) return `<div class="mm-cbar me"><span><b>🎛 내가 경기를 진행 중</b><small>다른 회원은 보기만 할 수 있어요</small></span><button class="btn sm" data-act="mmrelease">진행 넘기기</button></div>`;
  if (c.free) return `<div class="mm-cbar free"><span><b>👀 보기 전용</b><small>아직 진행하는 사람이 없어요</small></span><button class="btn sm primary cta" data-act="mmtake">내가 진행하기</button></div>`;
  if (c.stale) return `<div class="mm-cbar warn"><span><b>⚠️ ${esc(c.name)} 님과 연결이 끊긴 것 같아요</b><small>1분 넘게 응답이 없어요</small></span><button class="btn sm primary cta" data-act="mmtake">진행 가져오기</button></div>`;
  return `<div class="mm-cbar view"><span><b>👀 ${esc(c.name)} 님이 진행 중</b><small>보기 전용 · 점수와 시간은 실시간으로 바뀌어요</small></span></div>` }
function viewMatchMode() {
  const sidX = mmSid(); if (S.mmManual === undefined) S.mmManual = !sidX && !!manLoad();
  const sw = `<div class="seg mmseg" role="tablist"><button role="tab" data-act="mmmode" data-v="0" aria-selected="${!S.mmManual}">📅 일정 경기</button><button role="tab" data-act="mmmode" data-v="1" aria-selected="${!!S.mmManual}">✏️ 직접 설정</button></div>`;
  if (S.mmManual) return `<div class="mm">${sw}${viewManual()}</div>`;
  return viewMatchModeSched(sw);
}
function viewMatchModeSched(sw) {
  const all = Object.keys(S.sessions).filter(mmHasTeams).sort(); const sid = mmSid();
  const optLabel = id => { const a = mmAvail(id); const x = S.sessions[id]; return `${fmtDate(id)} ${esc(x.time || '')}${x.practice ? ' · 연습' : ''}${a === 'soon' ? ' · 1시간 전부터' : a === 'past' ? ' · 종료' : ''}` };
  const picker = cur => all.length ? `<select class="inp mm-pick" data-in="mmpick" aria-label="경기 일정 선택">${cur ? '' : '<option value="" selected>경기 일정 선택</option>'}${all.slice().reverse().map(id => `<option value="${id}" ${id === cur ? 'selected' : ''} ${mmAvail(id) === 'ok' ? '' : 'disabled'}>${optLabel(id)}</option>`).join('')}</select>` : '';
  if (!sid) { const next = all.find(id => mmAvail(id) === 'soon'); const nw = next && mmWindow(S.sessions[next]);
    return `<div class="mm">${sw}${all.some(id => mmAvail(id) === 'ok') ? `<div class="mm-hd"><div><b>⚽ 경기모드</b><small>일정 경기</small></div>${picker(null)}</div>` : ''}<div class="mm-empty">⚽<b>${all.length ? '지금 고를 수 있는 경기가 없어요' : '일정 경기 없음'}</b><p>${next ? `다음 경기 <b>${fmtDate(next)} ${esc(S.sessions[next].time || '')}</b>는<br><b>${p2(new Date(nw.open).getHours())}:${p2(new Date(nw.open).getMinutes())}</b>부터(시작 1시간 전) 고를 수 있어요.` : all.length ? '지난 경기는 끝나고 1시간이 지나면 고를 수 없어요.' : '팀 구성이 끝난 경기가 아직 없어요.'}<br>바로 해야 하면 직접 설정으로 시작하세요.</p><button class="btn primary" style="margin-top:14px" data-act="mmmode" data-v="1">✏️ 직접 설정으로 시작</button></div></div>` }
  S.mmSid = sid; const s = S.sessions[sid]; const ids = all;
  const head = sw + `<div class="mm-hd"><div><b>⚽ 경기모드${s.practice ? ' <span class="prac">연습</span>' : ''}</b><small>${esc(s.venue || '')}</small></div>${picker(sid)}</div>`;
  const ctl = mmCtl(s).mine; const cb = mmCtlBar(s);
  if (!ctl && S.tab === 'mm' && mmCtl(s).free && !(S.mmTry ??= {})[sid]) { S.mmTry[sid] = 1; setTimeout(() => mmTake(sid), 50) }
  let stage = S.mmStage || (!mmReady(s) ? 'pair' : !s.mm?.timed ? 'time' : 'play'); if (!ctl && stage !== 'play') stage = mmReady(s) ? 'play' : 'wait';
  if (stage === 'wait') return `<div class="mm">${head}${cb}<div class="mm-card"><h3>대진 준비 중</h3><p class="mm-note">진행자가 대진과 경기 시간을 정하면 여기에 경기 화면이 나와요.</p></div></div>`;
  if (stage === 'pair') return `<div class="mm">${head}${cb}${mmPairView(s)}</div>`;
  if (stage === 'time') return `<div class="mm">${head}${cb}${mmTimeView(s)}</div>`;
  return `<div class="mm${ctl ? '' : ' ro'}">${head}${cb}${mmPlayView(s, ctl)}${S.fs ? fsSched(s, ctl) : ''}</div>`;
}
function teamBtn(s, k, act, sel, dis) { const t = team(s, k); return `<button class="mm-tb ${sel ? 'on' : ''}" style="--tc:${t.color};--ti:${inkOn(t.color)}" data-act="${act}" data-k="${k}" ${dis ? 'disabled' : ''}>${esc(t.name)}</button>` }
function mmPairView(s) {
  const pp = pairsOf(s); const d = S.mmDraft || (S.mmDraft = { p1: [...(pp[0] || [])], p2: [...(pp[1] || [])], swap: { ...(s.mm?.swap || {}) } });
  const p1 = d.p1, p2 = d.p2; const ok1 = p1.length === 2, ok2 = p2.length === 2 && (p2[0] + p2[1]) !== (p1[0] + p1[1]) && (p2[1] + p2[0]) !== (p1[0] + p1[1]);
  let p3 = null; if (ok1 && ok2) { const all = [[p1[0], p1[1]], [p2[0], p2[1]]]; const cnt = {}; all.flat().forEach(k => cnt[k] = (cnt[k] || 0) + 1); const lone = KEYS.filter(k => cnt[k] === 1); const miss = KEYS.find(k => !cnt[k]);
    p3 = miss ? null : lone.length === 2 ? [p2.find(k => lone.includes(k)), p1.find(k => lone.includes(k))] : null }
  const pairs = ok1 && ok2 && p3 ? [p1, p2, p3] : null;
  const pickRow = (lab, arr, which, other) => `<div class="mm-row"><span class="mm-lab">${lab}</span><div class="mm-tbs">${KEYS.map(k => teamBtn(s, k, 'mmpk', arr.includes(k), which === 2 && !ok1)).join('').replace(/data-act="mmpk"/g, `data-act="mmpk" data-w="${which}"`)}</div><small>${arr.length === 2 ? `${esc(team(s, arr[0]).name)} vs ${esc(team(s, arr[1]).name)}` : '두 팀을 고르세요'}</small></div>`;
  let h = `<div class="mm-card"><h3>① 대진 정하기</h3><p class="mm-note">1라운드 1경기와 2경기에 뛸 두 팀을 고르면 3경기와 2·3라운드는 자동으로 정해져요.</p>${pickRow('1경기', p1, 1)}${pickRow('2경기', p2, 2)}
    ${ok1 && p2.length === 2 && !ok2 ? '<p class="mm-warn">2경기는 1경기와 다른 조합이어야 해요.</p>' : ''}${ok1 && ok2 && !p3 ? '<p class="mm-warn">2경기에는 1경기 팀 중 한 팀과 남은 팀이 들어가야 해요.</p>' : ''}</div>`;
  if (pairs) { const games = []; for (let r = 0; r < 3; r++) for (let j = 0; j < 3; j++) { const n = r * 3 + j + 1; const [a, b] = d.swap[n] ? [pairs[j][1], pairs[j][0]] : pairs[j]; games.push({ n, r: r + 1, a, b }) }
    h += `<div class="mm-card"><h3>전체 대진 <small>⇄ 로 좌우 위치를 바꿀 수 있어요</small></h3><div class="mm-games">${games.map(g => { const A = team(s, g.a), B = team(s, g.b);
      return `<div class="mm-g"><em>${g.r}R · ${g.n}경기</em><span class="gt" style="--tc:${A.color};--ti:${inkOn(A.color)}">${esc(A.name)}</span><button class="mm-sw" data-act="mmsw" data-n="${g.n}" aria-label="${g.n}경기 좌우 바꾸기">⇄</button><span class="gt" style="--tc:${B.color};--ti:${inkOn(B.color)}">${esc(B.name)}</span></div>` }).join('')}</div>
      <button class="btn primary block mm-go cta" data-act="mmpairsave">대진 확정</button></div>`; S.mmPairs = pairs }
  return h;
}
function mmTimeView(s) {
  const T = timing(s); const f = S.mmT || (S.mmT = { h1: Math.round(T.h1 / 60 * 10) / 10, gk: T.gk, h2: Math.round(T.h2 / 60 * 10) / 10 });
  const st = (k, lab, unit, step) => `<div class="mm-st"><span>${lab}</span><div class="stp"><button data-act="mmtadj" data-k="${k}" data-d="-${step}" aria-label="${lab} 줄이기">−</button><b>${f[k]}<small>${unit}</small></b><button data-act="mmtadj" data-k="${k}" data-d="${step}" aria-label="${lab} 늘리기">+</button></div></div>`;
  return `<div class="mm-card"><h3>② 경기 시간 설정</h3><p class="mm-note">한 경기는 전반 → GK 교체 → 후반으로 진행돼요. 시작, 전반 종료, 후반 시작, 경기 종료 때 휘슬이 울려요.</p>
    ${st('h1', '전반', '분', 0.5)}${st('gk', 'GK 교체', '초', 1)}${st('h2', '후반', '분', 0.5)}
    <p class="mm-sum">한 경기 ${Math.floor((f.h1 * 60 + f.gk + f.h2 * 60) / 60)}분 ${Math.round((f.h1 * 60 + f.gk + f.h2 * 60) % 60)}초</p>
    <button class="btn primary block mm-go cta" data-act="mmtimesave">설정 완료</button><button class="btn block mm-back" data-act="mmstage" data-v="pair">← 이전 화면</button>${mmReady(s) ? '<button class="btn danger block mm-reset" data-act="mmreset">⟲ 경기 셋팅 초기화</button>' : ''}</div>`;
}
/* ── 경기모드 전체화면 점수판 (가로 화면 지원) ── */
/* 시계 글자 크기를 화면 남는 공간에 꽉 차게 자동 맞춤 (글꼴·화면 방향과 상관없이) */
function fsScale() { const el = document.querySelector('.mmfs'); if (!el) return; const W = innerWidth, H = innerHeight; const land = W >= H; const rw = land ? 844 : 390, rh = land ? 390 : 844; // 스마트폰 화면 기준 크기
  const k = Math.max(1, Math.min(W / rw, H / rh)); const vw = W / k, vh = H / k;
  Object.assign(el.style, { inset: 'auto', top: '0', left: '0', width: vw + 'px', height: vh + 'px', transform: k > 1 ? `scale(${k})` : '', transformOrigin: '0 0' }); el.style.setProperty('--fvw', vw / 100 + 'px'); el.style.setProperty('--fvh', vh / 100 + 'px') }
function fsFit() { fsScale(); const box = document.querySelector('.fs-cl'), el = box?.querySelector('.fs-clock'); if (!box || !el) return; const bw = box.clientWidth, bh = box.clientHeight; if (!bw || !bh) return;
  el.style.fontSize = '100px'; const w = el.scrollWidth || 1, h = el.offsetHeight || 1; const k = Math.min(bw * 0.97 / w, bh * 0.98 / h); el.style.fontSize = Math.max(40, Math.floor(100 * k)) + 'px' }
addEventListener('resize', () => requestAnimationFrame(fsFit)); addEventListener('orientationchange', () => setTimeout(fsFit, 250)); document.fonts?.ready?.then(() => fsFit());
async function fsEnter() { S.fs = true; render(); try { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' }) } catch { } try { await screen.orientation?.lock?.('landscape') } catch { } }
async function fsExit() { S.fs = false; try { screen.orientation?.unlock?.() } catch { } try { if (document.fullscreenElement) await document.exitFullscreen() } catch { } render() }
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && S.fs) { S.fs = false; try { screen.orientation?.unlock?.() } catch { } render() } });
function fsBoard({ H, A, hs, as, clockAttr, phaseAttr, time, label, phase, ctl, goals, goal, ungoal, ctlBtns, title }) {
  const side = (T, sc, k) => `<div class="fs-team fs-${k}" style="--tc:${T.color};--ti:${inkOn(T.color)}"><div class="fs-tx"><b class="fs-nm">${esc(T.name)}</b><em class="fs-sc">${sc}</em></div>${goals ? `<div class="fs-gb"><button class="fs-g" ${goal(k)}>+ 골</button><button class="fs-ug" ${ungoal(k)} ${sc ? '' : 'disabled'} aria-label="${esc(T.name)} 골 취소">−</button></div>` : ''}</div>`;
  return `<div class="mmfs" role="dialog" aria-label="전체화면 점수판"><div class="fs-top"><span>${title}</span><span class="fs-ph" ${phaseAttr}>${label}</span><button class="fs-flip ${S.fsFlip ? 'on' : ''}" data-act="fsflip" aria-pressed="${!!S.fsFlip}" title="이 기기 화면에서만 두 팀 자리를 바꿔요">⇄ ${S.fsFlip ? '좌우 바뀜' : '좌우 바꾸기'}</button><button class="fs-x" data-act="fsoff" aria-label="전체화면 닫기">✕</button></div>
    <div class="fs-main${S.fsFlip ? ' flip' : ''}"><div class="fs-cl"><div class="fs-clock mm-clock ${phase}" ${clockAttr}>${time}</div></div>${side(H, hs, 'h')}<div class="fs-mid">${ctl && ctlBtns ? `<div class="fs-ctl">${ctlBtns}</div>` : ''}</div>${side(A, as, 'a')}</div></div>` }
function fsSched(s, ctl) { const ms = sessMatches(s.date); const curM = ms.find(x => x.status === 'live') || ms.find(x => x.status === 'pending') || ms[ms.length - 1]; if (!curM) return ''; const m = (ctl && S.mmSel && ms.find(x => x.id === S.mmSel)) || curM;
  const H = team(s, m.home), A = team(s, m.away); const [hs, as] = score(m); const ci = clockInfo(m); const run = !!m.timer?.running; const key = k => k === 'h' ? m.home : m.away;
  const ctlBtns = m.status === 'pending' ? `<button class="fs-b go" data-act="mmstart" data-id="${m.id}">▶ 시작</button>` : m.status === 'live' ? `${run ? `<button class="fs-b" data-act="mmpause" data-id="${m.id}">일시정지</button>` : `<button class="fs-b go" data-act="mmresume" data-id="${m.id}">▶ 재개</button>`}<button class="fs-b" data-act="mmend" data-id="${m.id}">종료</button>` : '';
  return fsBoard({ H, A, hs, as, clockAttr: `data-bigclock="${m.id}"`, phaseAttr: `data-phase="${m.id}"`, time: ci.time, label: ci.label, phase: ci.phase, ctl, goals: ctl && (m.status === 'live' || (m.status === 'done' && S.mmSel === m.id)), goal: k => `data-act="mmgoal" data-id="${m.id}" data-k="${key(k)}"`, ungoal: k => `data-act="mmungoal" data-id="${m.id}" data-k="${key(k)}"`, ctlBtns, title: `${m.round}라운드 · ${m.n}경기 / 9` }) }
/* 경기모드: 게임별 양팀 선수 목록 → 이름을 눌러 득점(자책골 포함), 아래 득점자 버튼을 눌러 취소, 시작 전 팀(색) 바꾸기 */
function mmRoster(s, m, ctl, canGoal) { const evs = Object.entries(S.events).filter(([, e]) => e.match === m.id).sort((a, b) => (a[1].sec || 0) - (b[1].sec || 0) || (a[1].at || 0) - (b[1].at || 0));
  const og = (S.mmOg || {})[m.id]; const pend = m.status === 'pending';
  const side = (k, pos) => { const t = team(s, k); const other = k === m.home ? m.away : m.home; const ogMode = og === k; const ps = teamPlayers(s, k); const cap = captainOf(s, k);
    const goals = id => evs.filter(([, e]) => e.scorer === id && !e.og).length;
    const pick = ctl && pend ? `<div class="mr-pick" role="group" aria-label="${pos === 'h' ? '왼쪽' : '오른쪽'} 팀 색 고르기">${KEYS.map(x => { const T = team(s, x); return `<button class="mr-sw ${x === k ? 'on' : ''}" style="--tc:${T.color};--ti:${inkOn(T.color)}" data-act="mmteam" data-id="${m.id}" data-side="${pos}" data-k="${x}" aria-pressed="${x === k}" aria-label="${esc(T.name)}">${esc(T.name)}</button>` }).join('')}</div>` : '';
    return `<div class="mr-col ${ogMode ? 'og' : ''}" style="--tc:${t.color};--ti:${inkOn(t.color)}">${pick}<div class="mr-hd"><b>${esc(t.name)}</b><span>${ps.length}명</span></div>
      ${ogMode ? `<p class="mr-ogt">자책골을 넣은 선수를 누르세요 · ${esc(team(s, other).name)} 득점</p>` : ''}
      <div class="mr-ps">${ps.map(id => { const g = goals(id); return `<button class="mr-p" ${canGoal ? `data-act="mmpg" data-id="${m.id}" data-k="${k}" data-p="${id}"` : 'disabled'}>${id === cap ? '<i class="cb">C</i>' : ''}<span>${esc(pname(id))}</span>${g ? `<em class="mr-g">${'⚽'.repeat(Math.min(g, 3))}${g > 3 ? g : ''}</em>` : ''}</button>` }).join('')}</div>
      ${canGoal ? `<div class="mr-ft"><button class="mr-og ${ogMode ? 'on' : ''}" data-act="mmog" data-id="${m.id}" data-k="${k}">${ogMode ? '자책골 취소' : '자책골'}</button><button class="mr-ng" data-act="mmgoal" data-id="${m.id}" data-k="${k}">미지정 골</button></div>` : ''}</div>` };
  const chip = ([id, e]) => { const T = team(s, e.team); const who = e.scorer ? pname(e.scorer) : '선수 미지정'; const min = e.sec != null ? `${Math.floor(e.sec / 60) + 1}'` : '';
    return `<button class="mr-chip ${e.og ? 'og' : ''}" style="--tc:${T.color};--ti:${inkOn(T.color)}" ${ctl ? `data-act="mmdelg" data-e="${id}"` : 'disabled'} aria-label="${esc(who)} 골 ${ctl ? '취소' : ''}"><i></i>${min ? `<em>${min}</em>` : ''}<b>${esc(who)}</b>${e.og ? '<small>자책</small>' : ''}${e.assist ? `<small>도움 ${esc(pname(e.assist))}</small>` : ''}${ctl ? '<span class="x" aria-hidden="true">✕</span>' : ''}</button>` };
  const L = evs.filter(([, e]) => e.team === m.home), R = evs.filter(([, e]) => e.team === m.away);
  return `<div class="mm-roster">${side(m.home, 'h')}${side(m.away, 'a')}</div>
    <div class="mm-scorers"><div class="ms-hd"><b>득점 기록</b>${ctl && evs.length ? '<small>버튼을 누르면 그 골이 취소돼요</small>' : ''}</div>${evs.length ? `<div class="ms-cols"><div>${L.map(chip).join('') || '<span class="ms-none">-</span>'}</div><div>${R.map(chip).join('') || '<span class="ms-none">-</span>'}</div></div>` : '<p class="ms-empty">아직 골이 없어요</p>'}</div>` }
async function mmSetTeams(m, nh, na) { const s = S.sessions[m.session]; const ms = sessMatches(s.date); const key = (a, b) => [a, b].sort().join('');
  if (nh === na) return; const oldK = key(m.home, m.away), newK = key(nh, na); const same = (x) => x.home === m.home; // 원래 방향과 같은지
  const upd = {}; const rounds = m.round === 1 ? [1, 2, 3] : [m.round];
  for (const r of rounds) { const g = ms.find(x => x.round === r && x.slot === m.slot); if (!g || g.status !== 'pending') continue;
    if (r === m.round) upd[g.id] = { home: nh, away: na }; else if (key(g.home, g.away) === oldK) upd[g.id] = same(g) ? { home: nh, away: na } : { home: na, away: nh }; else continue;
    if (oldK !== newK) { const o = ms.find(x => x.round === r && x.id !== g.id && key(x.home, x.away) === newK); if (o && o.status === 'pending') upd[o.id] = { home: g.home, away: g.away } } }
  const ok = await w(async () => { for (const [id, v] of Object.entries(upd)) await S.store.update(mp(id), v);
    const r1 = ms.filter(x => x.round === 1).sort((a, b) => a.slot - b.slot).map(x => upd[x.id] || { home: x.home, away: x.away }); if (r1.length === 3) await S.store.update(sp(s.date), { 'mm.pairs': r1.map(p => p.home + p.away) }) });
  if (ok) toast(m.round === 1 ? '팀을 바꿨어요. 2·3라운드 같은 순서 경기도 함께 바뀌어요.' : '팀을 바꿨어요.') }
function mmPlayView(s, ctl) {
  const ms = sessMatches(s.date); const curM = ms.find(x => x.status === 'live') || ms.find(x => x.status === 'pending') || ms[ms.length - 1]; const m = (ctl && S.mmSel && ms.find(x => x.id === S.mmSel)) || curM; const editing = m.status === 'done' && m.id !== curM.id || (m.status === 'done' && S.mmSel === m.id);
  const H = team(s, m.home), A = team(s, m.away); const [hs, as] = score(m); const ci = clockInfo(m); const run = !!m.timer?.running; const T = timing(s);
  const allDone = ms.every(x => x.status === 'done');
  let h = `<div class="mm-play">${editing ? `<div class="mm-edit">✏️ <b>${m.n}경기(종료) 점수 수정 중</b><button class="btn sm" data-act="mmsel" data-id="">현재 경기로 ›</button></div>` : ''}<div class="mm-meta"><span>${m.round}라운드 · ${m.n}경기 <small>/ 9</small> <button class="fsbtn" data-act="fson">⛶ 크게 보기</button></span>${ctl ? `<button class="linkbtn" data-act="mmstage" data-v="time">⏱ 시간 ${T.h1 / 60}+${T.gk}″+${T.h2 / 60}</button>` : `<span class="muted">⏱ ${T.h1 / 60}+${T.gk}″+${T.h2 / 60}</span>`}</div>
    <div class="mm-board"><div class="mm-team" style="--tc:${H.color};--ti:${inkOn(H.color)}"><b>${esc(H.name)}</b><em>${hs}</em></div>
      <div class="mm-mid"><div class="mm-clock ${ci.phase}" data-bigclock="${m.id}">${ci.time}</div><div class="mm-ph" data-phase="${m.id}">${ci.label}</div>
        <div class="mm-bar">${[0, 1, 2].map(i => `<i class="${i === 1 ? 'gk' : ''}"><b data-seg="${m.id}:${i}"></b></i>`).join('')}</div>${ctl && m.status === 'pending' ? `<button class="mm-side" data-act="mmsidesw" data-id="${m.id}" aria-label="양 팀 좌우 위치 바꾸기">⇄ 진영 변경</button>` : ''}</div>
      <div class="mm-team" style="--tc:${A.color};--ti:${inkOn(A.color)}"><b>${esc(A.name)}</b><em>${as}</em></div></div>
    <div class="mm-ctl">${!ctl ? (allDone ? `<div class="mm-done">🎉 오늘 9경기가 모두 끝났어요!</div>` : '') : editing ? '' : m.status === 'pending' ? `<button class="btn primary mm-big cta" data-act="mmstart" data-id="${m.id}">▶ 경기 시작</button>`
      : m.status === 'live' ? `${run ? `<button class="btn mm-big" data-act="mmpause" data-id="${m.id}">⏸ 일시정지</button>` : `<button class="btn primary mm-big" data-act="mmresume" data-id="${m.id}">▶ 재개</button>`}<button class="btn ${ci.phase === 'full' ? 'primary' : ''} mm-big" data-act="mmend" data-id="${m.id}">경기 종료</button>`
      : allDone ? `<div class="mm-done">🎉 오늘 9경기가 모두 끝났어요!</div>` : ''}</div>
    ${mmRoster(s, m, ctl, ctl && (m.status === 'live' || editing))}
    <div class="mm-list">${ms.map(x => { const [a, b] = score(x); const X = team(s, x.home), Y = team(s, x.away); return `<button class="mm-li ${x.id === m.id ? 'cur' : ''} st-${x.status}" data-act="mmsel" data-id="${x.status === 'done' ? x.id : ''}" ${ctl && (x.status === 'done' || x.id === curM.id) ? '' : 'disabled'} aria-label="${x.n}경기${x.status === 'done' ? ' 점수 수정' : ''}"><em>${x.n}</em><i style="background:${X.color}"></i><span>${x.status === 'pending' ? 'vs' : a + ':' + b}</span><i style="background:${Y.color}"></i></button>` }).join('')}</div>
    ${ctl ? '<button class="btn danger block mm-reset" data-act="mmreset">⟲ 경기 셋팅 초기화</button>' : ''}
    <p class="mm-note">${ctl ? '끝난 경기는 아래 목록에서 눌러 점수를 고칠 수 있어요. ' : ''}경기모드 화면에 있는 동안은 화면이 꺼지지 않아요. ${ctl ? '다른 메뉴로 가도 시간과 휘슬은 계속 이어져요.' : '휘슬은 진행자 폰에서 울려요.'}</p></div>`;
  return h;
}
async function mmSavePairs() {
  const s = S.sessions[S.mmSid]; const pairs = S.mmPairs, sw = S.mmDraft?.swap || {}; if (!pairs) return;
  const ms = sessMatches(s.date); if (ms.some(m => m.status !== 'pending') && !confirm('이미 진행된 경기가 있어요. 진행 전인 경기의 대진만 바꿀까요?')) return;
  const ok = await w(async () => { for (let r = 0; r < 3; r++) for (let j = 0; j < 3; j++) { const n = r * 3 + j + 1; const id = `${s.date}_${n}`; const ex = S.matches[id]; if (ex && ex.status !== 'pending') continue;
      const [a, b] = sw[n] ? [pairs[j][1], pairs[j][0]] : pairs[j];
      const { id: _i, home: _h, away: _a, ...rest } = ex || {};
      await S.store.set(mp(id), { ...JSON.parse(JSON.stringify(rest)), session: s.date, n, round: r + 1, slot: j + 1, home: a, away: b, status: 'pending', timer: { running: false, acc: 0, startedAt: 0 }, endedAt: 0 }) }
    await S.store.update(sp(s.date), { mm: { pairs: pairs.map(p => p.join('')), swap: Object.fromEntries(Object.entries(sw).filter(([, v]) => v)), timed: !!s.mm?.timed }, stage: 'match' }) }, '대진을 정했어요.');
  if (ok) { S.mmStage = null; S.mmDraft = null; if (!s.mm?.timed) S.mmStage = 'time'; render() }
}
function beepAt(t, freq, dur) { const ctx = AC; const nodes = []; const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq; const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.9, t + .01); g.gain.setValueAtTime(.9, t + dur - .03); g.gain.linearRampToValueAtTime(0, t + dur); o.connect(g); g.connect(MASTER); o.start(t); o.stop(t + dur + .02); nodes.push(o); return nodes }
function mmCountdown(m) {
  if (S.cdBusy && Date.now() - S.cdBusy < 5000) return; S.cdBusy = Date.now(); setTimeout(() => { S.cdBusy = 0 }, 3700);
  keepAwake(true); const SW = startWhistleAt(3.05); const startAt = SW.at; let n = 3; const ov = document.createElement('div'); ov.className = 'mm-cd'; document.body.appendChild(ov);
  const step = () => { if (n > 0) { ov.innerHTML = `<b>${n}</b>`; try { navigator.vibrate?.(80) } catch { } n--; setTimeout(step, 1000) } else { ov.innerHTML = '<b class="go">START</b>'; setTimeout(() => ov.remove(), 600); S.startBlown[m.id] = Date.now(); if (!SW.ok) whistle([.9]); startClock(m, startAt) } };
  step();
}
/* native app (Capacitor) hooks: system alarms play the whistle even when the screen is off or the app sleeps */
const CAP = () => (window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins) || null;
async function nativeSetup() { const P = CAP(); if (!P?.LocalNotifications) return; try { await P.LocalNotifications.requestPermissions();
  await P.LocalNotifications.createChannel({ id: 'whistle', name: '경기 휘슬', description: '전반 종료, 후반 시작, 경기 종료 알림', importance: 5, sound: 'whistle.wav', vibration: true, visibility: 1 }) } catch (e) { console.warn(e) } }
async function nativeSchedule(m, T, run) {
  const P = CAP(); if (!P?.LocalNotifications) return false; const base = 5000 + (m.n || 0) * 10; const ids = [0, 1, 2, 3, 4].map(i => ({ id: base + i }));
  try { await P.LocalNotifications.cancel({ notifications: ids }) } catch { }
  if (!run || !S.whistle) return true; const e = elapsed(m); const a = T.h1, b = a + T.gk, c = b + T.h2; const now = Date.now(); const list = [];
  const add = (i, at, title, body) => { const dt = at - e; if (dt > .5) list.push({ id: base + i, title, body, channelId: 'whistle', sound: 'whistle.wav', schedule: { at: new Date(now + dt * 1000), allowWhileIdle: true } }) };
  add(0, a, `⚽ ${m.n}경기 전반 종료`, 'GK 교체 시간이에요'); add(1, b, `⚽ ${m.n}경기 후반 시작`, '후반전이 시작됐어요'); add(2, c, `⚽ ${m.n}경기 종료`, '경기가 끝났어요. 점수를 확인하세요');
  try { if (list.length) await P.LocalNotifications.schedule({ notifications: list }) } catch (err) { console.warn(err); return false }
  return true;
}
/* background-safe whistles: schedule on the audio clock so they still sound when the screen is off */
let KEEP = null;
function blowN(t, d) { const ctx = AC; const nodes = []; const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = 'square'; o2.type = 'sawtooth'; o1.frequency.value = 2900; o2.frequency.value = 2980;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 34; const fm = ctx.createGain(); fm.gain.value = 180; lfo.connect(fm); fm.connect(o1.frequency); fm.connect(o2.frequency);
  const amp = ctx.createGain(); amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(.95, t + .02); amp.gain.setValueAtTime(.95, t + d - .05); amp.gain.linearRampToValueAtTime(0, t + d);
  o1.connect(amp); o2.connect(amp); amp.connect(MASTER); [o1, o2, lfo].forEach(o => { o.start(t); o.stop(t + d + .05); nodes.push(o) }); return nodes }
/* 휘슬 예약: 오디오 시계(ctx.currentTime)와 경기 시계(elapsed)를 매 0.25초 비교해서 어긋나면(화면 꺼짐·오디오 일시정지·서버 시간 보정 등) 다시 맞춰 예약해요 */
const WH_DRIFT = 0.12;
function whPlan(T) { const a = T.h1, b = a + T.gk, c = b + T.h2; const L = [];
  for (const k of [3, 2, 1]) { const at = b - k; if (at >= a + .9) L.push({ k: 'bp' + k, at, beep: true }) }
  L.push({ k: 'gk', at: a, pat: [.3, .3] }, { k: 'h2', at: b, pat: [.9] }, { k: 'full', at: c, pat: [.3, .3, 1.3] }); return L }
/* 휘슬 엔진: 경기 시계(경과 초) → 오디오 시계로 바꿔 각 휘슬을 '항목별'로 예약해요.
   · 매 틱(0.25초)마다 계획을 다시 맞춰 보되, 이미 울리기 시작했거나 0.03초 안에 울릴 휘슬은 절대 끊거나 다시 울리지 않아요
   · 경기 중 시간을 바꾸거나(전반·GK·후반), 일시정지·재개·서버 시간 보정으로 시계가 움직이면 아직 안 울린 휘슬만 새 시각으로 옮겨요
   · 0.25초 안쪽으로 살짝 지나친 휘슬은 바로 울려 주고, 그보다 오래 지난 휘슬은 건너뛰어요
   · 스피커/블루투스 출력 지연(outputLatency)만큼 먼저 예약해서, 소리가 들리는 순간이 화면 시계와 맞아요 */
const WH = {}; let WH_LAT = 0;
function whLat(ctx) { const l = Math.max(0, Math.min(.5, Number(ctx?.outputLatency) || Number(ctx?.baseLatency) || 0)); if (Math.abs(l - WH_LAT) > .03) WH_LAT = l; return WH_LAT }
function whStopIt(it) { it.nodes.forEach(n => { try { n.stop() } catch { } }) }
function whPlay(ctx, x, t, nodes) { if (x.beep) { nodes.push(...beepAt(t, 1320, .18)); return t + .2 } for (const d of x.pat) { nodes.push(...blowN(t, d)); t += d + .14 } return t }
function whOff(key, all) { const st = WH[key]; if (!st) return; const now = AC ? AC.currentTime : 0; for (const [k, it] of Object.entries(st.items)) if (all || it.t0 > now + .03) { whStopIt(it); delete st.items[k] } st.on = false; st.anchor = null }
function whSync(key, ctx, e, plan, sig) { const st = WH[key] ??= { on: false, anchor: null, sig: '', items: {}, last: {} };
  if (!ctx || ctx.state !== 'running' || e == null) { if (st.on) whOff(key); return false }
  const now = ctx.currentTime; const want = now - e - whLat(ctx); // 경기 시계 0초가 들리는 오디오 시각
  for (const [k, it] of Object.entries(st.items)) if (it.end < now) { st.last[k] = it.t0; delete st.items[k] }
  if (!st.on || st.sig !== sig || st.anchor == null || Math.abs(want - st.anchor) >= WH_DRIFT) st.anchor = want; // 작은 흔들림은 무시, 실제로 어긋나면 새 기준
  st.on = true; st.sig = sig; const keep = new Set();
  for (const x of plan) { keep.add(x.k); const t0 = st.anchor + x.at; const it = st.items[x.k];
    if (it) { if (it.t0 <= now + .03 || Math.abs(it.t0 - t0) < WH_DRIFT) continue; whStopIt(it); delete st.items[x.k] }
    if (st.last[x.k] != null && Math.abs(st.last[x.k] - t0) < 2) continue; // 이미 울린 휘슬
    let t = t0; if (t < now + .03) { if (t < now - .25) continue; t = now + .03 }
    const nodes = []; const end = whPlay(ctx, x, t, nodes); st.items[x.k] = { t0: t, end, nodes } }
  for (const [k, it] of Object.entries(st.items)) if (!keep.has(k) && it.t0 > now + .03) { whStopIt(it); delete st.items[k] }
  return true }
function scheduleWhistles() {
  const sid = S.mmSid || S.sid; if (!sid || !S.sessions[sid]) return; let anyRun = false;
  const canBlow = mmIsCtl() || (S.admin && !!S.openMatch); const T = timing(S.sessions[sid]); const tsig = T.h1 + '/' + T.gk + '/' + T.h2;
  for (const m of sessMatches(sid)) { const run = canBlow && m.status === 'live' && m.timer?.running; if (run) anyRun = true;
    if (CAP()?.LocalNotifications) { const sig = run ? m.timer.startedAt + ':' + (m.timer.acc || 0) + ':' + (S.whistle ? 1 : 0) + ':' + (S.skew || 0) + ':' + tsig : ''; if ((S.schedSig[m.id] || '') !== sig) { S.schedSig[m.id] = sig; nativeSchedule(m, T, run) } continue }
    const ctx = run && S.whistle ? audio() : null; if (ctx && ctx.state !== 'running') { try { ctx.resume() } catch { } }
    S.schedSig[m.id] = whSync(m.id, ctx, run && S.whistle ? elapsed(m) : null, whPlan(T), tsig) ? tsig : '' }
  const ctx = AC; if (anyRun && ctx && !KEEP) { try { KEEP = ctx.createOscillator(); const g = ctx.createGain(); g.gain.value = .0008; KEEP.frequency.value = 40; KEEP.connect(g); g.connect(ctx.destination); KEEP.start() } catch { KEEP = null } }
  if (!anyRun && KEEP) { try { KEEP.stop() } catch { } KEEP = null }
}
/* 시작 휘슬: 지금부터 lead초 뒤에 들리도록 예약하고, 그 순간(서버 시계 기준 ms)을 경기 시계 0초로 돌려줘요 */
function startWhistleAt(lead) { const ctx = audio(); if (ctx && ctx.state === 'suspended') { try { ctx.resume() } catch { } } const L = ctx ? whLat(ctx) : 0;
  if (ctx && S.whistle) { const t0 = ctx.currentTime + lead; if (lead >= 3) { beepAt(t0 - 3, 1320, .18); beepAt(t0 - 2, 1320, .18); beepAt(t0 - 1, 1320, .18) } blowN(t0, .9) }
  return { at: nowS() + (lead + L) * 1000, local: Date.now() + (lead + L) * 1000, ok: !!(ctx && S.whistle) } }

/* ───────── 경기모드 · 직접 설정(매뉴얼) : 이 기기에만 저장 ───────── */
function manLoad() { if (S.man === undefined) S.man = load('man', null); return S.man }
function manSave() { save('man', S.man) }
function manPairs(n) { const T = ['A', 'B', 'C', 'D'].slice(0, n); if (n === 2) return [['A', 'B']]; if (n === 3) return [['A', 'B'], ['B', 'C'], ['C', 'A']]; return [['A', 'B'], ['C', 'D'], ['A', 'C'], ['B', 'D'], ['A', 'D'], ['B', 'C']] }
function manTeam(k) { return S.man.teams.find(t => t.k === k) }
function manElapsed(m) { const t = m.timer || {}; return ((t.acc || 0) + (t.running ? (Date.now() - t.startedAt) : 0)) / 1000 }
function manClock(m) { const T = S.man.timing, e = manElapsed(m), a = T.h1, b = a + T.gk, c = b + T.h2;
  if (m.status === 'done') return { time: fmt(Math.min(e, c)), label: '종료', phase: 'done' };
  if (m.status === 'pending') return { time: fmt(T.h1), label: '시작 전', phase: 'ready' };
  const ps = m.timer?.running ? '' : ' · 일시정지';
  if (e < a) return { time: fmt(a - e), label: '전반' + ps, phase: 'h1' };
  if (e < b) return { time: fmt(b - e), label: 'GK 교체' + ps, phase: 'gk' };
  if (e < c) return { time: fmt(c - e), label: '후반' + ps, phase: 'h2' };
  return { time: '+' + fmt(e - c), label: '경기 종료 시간', phase: 'over' } }
function manScore(m) { return [m.g?.[m.home] || 0, m.g?.[m.away] || 0] }
function manStandings() { const row = {}; S.man.teams.forEach(t => row[t.k] = { k: t.k, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
  S.man.matches.filter(m => m.status === 'done').forEach(m => { const [a, b] = manScore(m); const H = row[m.home], A = row[m.away]; H.p++; A.p++; H.gf += a; H.ga += b; A.gf += b; A.ga += a;
    if (a > b) { H.w++; A.l++; H.pts += 3 } else if (a < b) { A.w++; H.l++; A.pts += 3 } else { H.d++; A.d++; H.pts++; A.pts++ } });
  return Object.values(row).sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf) }
function manSchedule(m) { Object.keys(WH).filter(k => k.startsWith('man:')).forEach(k => { if (!m || k !== 'man:' + m.id) whOff(k) }); if (!m) return; manSync() }
function manSync() { if (!S.man) return; const m = S.man.matches?.find(x => x.status === 'live' && x.timer?.running); if (!m) { Object.keys(WH).filter(k => k.startsWith('man:')).forEach(k => WH[k].on && whOff(k)); return }
  const ctx = S.whistle ? (AC || null) : null; if (ctx && ctx.state !== 'running') { try { ctx.resume() } catch { } } const T = S.man.timing;
  whSync('man:' + m.id, ctx, S.whistle ? manElapsed(m) : null, whPlan(T), T.h1 + '/' + T.gk + '/' + T.h2) }
setInterval(manSync, 250); // 직접 설정 경기도 시간과 휘슬을 계속 맞춰요
setInterval(() => { if (S.tab !== 'mm' || !S.mmManual || !S.man) return; const m = S.man.matches.find(x => x.id === S.manCur); if (!m) return; const ci = manClock(m);
  document.querySelectorAll('[data-manclock]').forEach(el => { el.textContent = ci.time; el.className = (el.classList.contains('fs-clock') ? 'fs-clock ' : '') + 'mm-clock ' + ci.phase }); document.querySelectorAll('[data-manph]').forEach(lb => lb.textContent = ci.label) }, 250);
function viewManual() {
  const M = manLoad(); { const lm = M?.matches?.find(x => x.status === 'live' && x.timer?.running); if (lm && S.whistle) queueMicrotask(manSync) }
  if (!M) { const f = S.manF || (S.manF = { n: 3, cols: ['RED', 'BLUE', 'WHITE', 'BLACK'], games: 9, h1: 6, gk: 3, h2: 6 });
    const st = (k, lab, unit, step) => `<div class="mm-st"><span>${lab}</span><div class="stp"><button data-act="manadj" data-k="${k}" data-d="-${step}" aria-label="${lab} 줄이기">−</button><b>${f[k]}<small>${unit}</small></b><button data-act="manadj" data-k="${k}" data-d="${step}" aria-label="${lab} 늘리기">+</button></div></div>`;
    return `<div class="mm-card"><h3>✏️ 직접 설정</h3><p class="mm-note">일정에 없는 경기도 팀, 경기 수, 시간을 정해서 바로 진행하고 결과까지 정리해요. 이 기기에만 저장돼요.</p>
      <div class="mm-row"><span class="mm-lab">팀 수</span><div class="mm-tbs">${[2, 3, 4].map(n => `<button class="mm-tb ${f.n === n ? 'on' : ''}" style="--tc:#1E46C8;--ti:#fff" data-act="mann" data-n="${n}">${n}팀</button>`).join('')}</div></div>
      ${Array.from({ length: f.n }, (_, i) => `<div class="mm-row"><span class="mm-lab">${'ABCD'[i]}팀</span><select class="inp" data-in="mancol" data-i="${i}">${PALETTE.map(p => `<option value="${p.name}" ${f.cols[i] === p.name ? 'selected' : ''}>${p.name}</option>`).join('')}</select></div>`).join('')}
      ${st('games', '경기 수', '경기', 1)}${st('h1', '전반', '분', .5)}${st('gk', 'GK 교체', '초', 1)}${st('h2', '후반', '분', .5)}
      <button class="btn primary block mm-go cta" data-act="manstart">설정 완료</button></div>` }
  const ms = M.matches; const allDone = ms.every(m => m.status === 'done');
  if (allDone || S.manSummary) return manSummary();
  const curM = ms.find(m => m.status === 'live') || ms.find(m => m.status === 'pending'); const m = (S.manSel && ms.find(x => x.id === S.manSel)) || curM; S.manCur = m.id; const editing = m.status === 'done';
  const H = manTeam(m.home), A = manTeam(m.away); const [hs, as] = manScore(m); const ci = manClock(m); const run = !!m.timer?.running; const T = M.timing;
  const side = (t, k, sc) => `<div class="mm-team" style="--tc:${t.color};--ti:${inkOn(t.color)}"><b>${esc(t.name)}</b><em>${sc}</em>${m.status === 'live' || editing ? `<button class="mm-goal" data-act="mangoal" data-k="${k}" data-d="1">+ 골</button><button class="mm-ungoal" data-act="mangoal" data-k="${k}" data-d="-1" ${sc ? '' : 'disabled'}>− 골 취소</button>` : ''}</div>`;
  return `<div class="mm-play">${editing ? `<div class="mm-edit">✏️ <b>${m.n}경기(종료) 점수 수정 중</b><button class="btn sm" data-act="mansel" data-id="">현재 경기로 ›</button></div>` : ''}
    <div class="mm-meta"><span>${m.n}경기 <small>/ ${ms.length}</small> <button class="fsbtn" data-act="fson">⛶ 크게 보기</button></span><span class="muted">⏱ ${T.h1 / 60}+${T.gk}″+${T.h2 / 60}</span></div>
    <div class="mm-board">${side(H, m.home, hs)}<div class="mm-mid"><div class="mm-clock ${ci.phase}" data-manclock>${ci.time}</div><div class="mm-ph" data-manph>${ci.label}</div>${m.status === 'pending' ? `<button class="mm-side" data-act="manside">⇄ 진영 변경</button>` : ''}</div>${side(A, m.away, as)}</div>
    <div class="mm-ctl">${editing ? '' : m.status === 'pending' ? `<button class="btn primary mm-big cta" data-act="mango">▶ 경기 시작</button>` : `${run ? `<button class="btn mm-big" data-act="manpause">⏸ 일시정지</button>` : `<button class="btn primary mm-big" data-act="manresume">▶ 재개</button>`}<button class="btn mm-big" data-act="manend">경기 종료</button>`}</div>
    <div class="mm-list" style="grid-template-columns:repeat(${Math.min(ms.length, 9)},minmax(0,1fr))">${ms.map(x => { const [a, b] = manScore(x); return `<button class="mm-li ${x.id === m.id ? 'cur' : ''} st-${x.status}" data-act="mansel" data-id="${x.status === 'done' ? x.id : ''}" ${x.status === 'done' || x.id === curM.id ? '' : 'disabled'}><em>${x.n}</em><i style="background:${manTeam(x.home).color}"></i><span>${x.status === 'pending' ? 'vs' : a + ':' + b}</span><i style="background:${manTeam(x.away).color}"></i></button>` }).join('')}</div>
    <div class="row" style="margin-top:4px"><button class="btn sm" data-act="mansum">📋 지금까지 결과 보기</button><button class="btn sm danger" data-act="manreset">새로 설정</button></div></div>${S.fs ? fsBoard({ H, A, hs, as, clockAttr: 'data-manclock', phaseAttr: 'data-manph', time: ci.time, label: ci.label, phase: ci.phase, ctl: true, goals: m.status === 'live' || editing, goal: k => `data-act="mangoal" data-k="${k === 'h' ? m.home : m.away}" data-d="1"`, ungoal: k => `data-act="mangoal" data-k="${k === 'h' ? m.home : m.away}" data-d="-1"`,
      ctlBtns: m.status === 'pending' ? '<button class="fs-b go" data-act="mango">▶ 시작</button>' : editing ? '' : `${run ? '<button class="fs-b" data-act="manpause">일시정지</button>' : '<button class="fs-b go" data-act="manresume">▶ 재개</button>'}<button class="fs-b" data-act="manend">종료</button>`, title: `${m.n}경기 / ${ms.length}` }) : ''}`;
}
function manSummary() { const M = S.man; const rows = manStandings(); const done = M.matches.filter(m => m.status === 'done').length;
  return `<div class="mm-card"><h3>📋 경기 결과 <small>${done}/${M.matches.length}경기</small></h3>
    <div class="tblwrap"><table class="rdst"><thead><tr><th>순위</th><th class="l">팀</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>득</th><th>실</th><th>승점</th></tr></thead><tbody>${rows.map((r, i) => { const t = manTeam(r.k); return `<tr><td class="rank"><em class="rk rk${i + 1}">${i + 1}</em></td><td class="l"><span class="teamcell">${bib(t.color)}<b>${esc(t.name)}</b></span></td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}</td><td>${r.ga}</td><td class="pts">${r.pts}</td></tr>` }).join('')}</tbody></table></div>
    <div class="mm-sumlist">${M.matches.map(m => { const [a, b] = manScore(m); return `<div><em>${m.n}경기</em><span>${esc(manTeam(m.home).name)}</span><b>${m.status === 'done' ? a + ' : ' + b : '-'}</b><span>${esc(manTeam(m.away).name)}</span></div>` }).join('')}</div>
    <div class="row" style="margin-top:12px">${M.matches.some(m => m.status !== 'done') ? '<button class="btn" data-act="mansumclose">← 경기로 돌아가기</button>' : ''}<button class="btn primary" data-act="mancopy">결과 복사</button><button class="btn danger" data-act="manreset">새로 설정</button></div></div>` }
async function manAct(act, el) { const M = S.man; const id = el.dataset.id;
  const cur = () => M.matches.find(m => m.id === S.manCur);
  switch (act) {
    case 'mann': { const f = S.manF; f.n = +el.dataset.n; f.games = { 2: 4, 3: 9, 4: 6 }[f.n]; break }
    case 'manadj': { const f = S.manF; const k = el.dataset.k; const v = Math.round((+f[k] + +el.dataset.d) * 10) / 10; f[k] = k === 'games' ? Math.max(1, Math.min(30, v)) : k === 'gk' ? Math.max(0, Math.min(120, v)) : Math.max(.5, Math.min(30, v)); break }
    case 'manstart': { const f = S.manF; const cols = f.cols.slice(0, f.n); if (new Set(cols).size < cols.length) { toast('팀 색이 겹쳐요. 서로 다른 색을 골라 주세요.'); return }
      const teams = cols.map((c, i) => { const p = PALETTE.find(x => x.name === c); return { k: 'ABCD'[i], name: c, color: p.color } }); const pairs = manPairs(f.n);
      S.man = { teams, timing: { h1: Math.round(f.h1 * 60), gk: +f.gk, h2: Math.round(f.h2 * 60) }, matches: Array.from({ length: f.games }, (_, i) => ({ id: 'm' + (i + 1), n: i + 1, home: pairs[i % pairs.length][0], away: pairs[i % pairs.length][1], status: 'pending', timer: { running: false, acc: 0, startedAt: 0 }, g: {} })), createdAt: Date.now() }; S.manSel = null; S.manSummary = false; break }
    case 'mango': { const m = cur(); if (!m) return; if (S.cdBusy && Date.now() - S.cdBusy < 5000) return; S.cdBusy = Date.now(); setTimeout(() => { S.cdBusy = 0 }, 3700); keepAwake(true); const SW = startWhistleAt(3.05);
      const ov = document.createElement('div'); ov.className = 'mm-cd'; document.body.appendChild(ov); for (const n of [3, 2, 1]) { ov.innerHTML = `<b>${n}</b>`; try { navigator.vibrate?.(80) } catch { } await new Promise(r => setTimeout(r, 1000)) }
      ov.innerHTML = '<b class="go">START</b>'; setTimeout(() => ov.remove(), 600); m.status = 'live'; m.timer = { running: true, acc: 0, startedAt: SW.local }; manSave(); manSchedule(m); render(); return }
    case 'manpause': { const m = cur(); m.timer = { running: false, acc: manElapsed(m) * 1000, startedAt: 0 }; manSchedule(null); break }
    case 'manresume': { const m = cur(); m.timer = { running: true, acc: m.timer.acc || 0, startedAt: Date.now() }; manSave(); manSchedule(m); break }
    case 'manend': { const m = cur(); const T = M.timing; if (manElapsed(m) < T.h1 + T.gk + T.h2 && !confirm('아직 시간이 남았어요. 경기를 종료할까요?')) return; m.timer = { running: false, acc: manElapsed(m) * 1000, startedAt: 0 }; m.status = 'done'; manSchedule(null); toast(`${m.n}경기를 종료했어요.`); break }
    case 'mangoal': { const m = (S.manSel && M.matches.find(x => x.id === S.manSel)) || cur(); const k = el.dataset.k; m.g = m.g || {}; m.g[k] = Math.max(0, (m.g[k] || 0) + (+el.dataset.d)); try { navigator.vibrate?.(50) } catch { } break }
    case 'manside': { const m = cur(); [m.home, m.away] = [m.away, m.home]; break }
    case 'mansel': S.manSel = id || null; break;
    case 'mansum': S.manSummary = true; break;
    case 'mansumclose': S.manSummary = false; break;
    case 'mancopy': { const rows = manStandings(); const txt = [`[${CFG.club?.short || 'WF'}] 경기 결과 ${fmtDate(today())}`, ...rows.map((r, i) => `${i + 1}위 ${manTeam(r.k).name} ${r.pts}점 (${r.w}승 ${r.d}무 ${r.l}패, 득실 ${r.gf - r.ga >= 0 ? '+' : ''}${r.gf - r.ga})`), '', ...M.matches.filter(m => m.status === 'done').map(m => { const [a, b] = manScore(m); return `${m.n}경기 ${manTeam(m.home).name} ${a} : ${b} ${manTeam(m.away).name}` })].join('\n');
      try { await navigator.clipboard.writeText(txt); toast('결과를 복사했어요. 카톡에 붙여넣으세요.') } catch { prompt('아래 내용을 복사하세요', txt) } return }
    case 'manreset': if (!confirm('지금 경기 기록을 지우고 새로 설정할까요?')) return; manSchedule(null); S.man = null; S.manSummary = false; S.manSel = null; break;
  }
  manSave(); render();
}

/* ───────── members (admin) ───────── */
/* ───────── 같은 이름 회원 합치기 (기록 데이터까지 한 사람으로) ───────── */
function dupGroups() { const g = {}; for (const [id, p] of Object.entries(S.players)) { const k = normName(p.name); if (k) (g[k] ??= []).push(id) } return Object.values(g).filter(a => a.length > 1) }
function refCount(id) { let n = 0; for (const s of Object.values(S.sessions)) { if (JSON.stringify(s).includes('"' + id + '"')) n++ } for (const e of Object.values(S.events)) if (e.scorer === id || e.assist === id) n++; return n }
function pickCanon(ids) { const rank = id => [S.authMap?.[id] ? 1 : 0, S.contacts?.[id]?.phone ? 1 : 0, refCount(id), -(S.players[id]?.createdAt || 9e15)]; return [...ids].sort((a, b) => { const A = rank(a), B = rank(b); for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return B[i] - A[i]; return 0 })[0] }
function remapSession(s, map) { const R = id => map[id] || id; const arr = a => Array.isArray(a) ? [...new Set(a.map(R))] : a; const keys = o => { if (!o || typeof o !== 'object') return o; const r = {}; for (const [k, v] of Object.entries(o)) { const nk = R(k); if (!(nk in r) || (v && (!r[nk] || (typeof v === 'number' && v < r[nk])))) r[nk] = v } return r };
  const out = {}; const put = (f, v) => { if (JSON.stringify(v) !== JSON.stringify(s[f])) out[f] = v };
  for (const f of ['applicants', 'waitlist', 'p0', 'ops', 'viewers', 'parkWin']) if (s[f]) put(f, arr(s[f]));
  if (s.captains) put('captains', Object.fromEntries(Object.entries(s.captains).map(([k, v]) => [k, v ? R(v) : v])));
  if (s.mom) put('mom', Object.fromEntries(Object.entries(s.mom).map(([k, v]) => [k, v ? R(v) : v])));
  if (s.teams) put('teams', Object.fromEntries(Object.entries(s.teams).map(([k, t]) => [k, { ...t, players: arr(t?.players || []) }])));
  if (Array.isArray(s.picks)) put('picks', s.picks.map(x => ({ ...x, p: R(x.p) })));
  if (s.pending?.p) put('pending', { ...s.pending, p: R(s.pending.p) });
  if (Array.isArray(s.apps)) { const seen = new Set(); put('apps', s.apps.filter(a => a).map(a => a.pid ? { ...a, pid: R(a.pid) } : a).sort((a, b) => (a.at || 0) - (b.at || 0)).filter(a => { if (!a.pid) return true; if (seen.has(a.pid)) return false; seen.add(a.pid); return true })) }
  for (const f of ['park', 'late', 'cancels']) if (s[f]) put(f, keys(s[f]));
  if (s.duty) put('duty', Object.fromEntries(Object.entries(s.duty).map(([k, v]) => [k, arr(v || [])])));
  if (s.dutyReq) put('dutyReq', Object.fromEntries(Object.entries(s.dutyReq).map(([k, v]) => [k, keys(v)])));
  if (s.mmCtl?.pid && map[s.mmCtl.pid]) put('mmCtl', { ...s.mmCtl, pid: R(s.mmCtl.pid) });
  return out }
async function mergeDups() { const groups = dupGroups(); if (!groups.length) { toast('같은 이름의 회원이 없어요.'); return }
  const plan = groups.map(ids => { const c = pickCanon(ids); return { canon: c, dups: ids.filter(x => x !== c) } }); const map = {}; plan.forEach(g => g.dups.forEach(d => map[d] = g.canon));
  if (!confirm(`같은 이름 회원 ${plan.length}명을 한 사람으로 합칠까요?\n${plan.map(g => `· ${S.players[g.canon].name} (${g.dups.length + 1}개 → 1개)`).join('\n')}\n\n신청·팀·경기 기록·골/도움·연락처가 모두 합쳐지고, 되돌릴 수 없어요.`)) return;
  S.merging = true; toast('합치는 중이에요… 잠시만 기다려 주세요.');
  const ok = await w(async () => {
    for (const [sid, ss] of Object.entries(S.sessions)) { const up = remapSession(ss, map); if (Object.keys(up).length) await S.store.update(sp(sid), up);
      const q = S.q?.[sid]; if (q) for (const [qid, d] of Object.entries(q)) { const np = d.pid && map[d.pid]; if (!np) continue; if (q[np] || Object.values(q).some(x => x.pid === np)) { await S.store.del(sp(sid) + '/q/' + qid) } else if (qid === d.pid) { await S.store.set(sp(sid) + '/q/' + np, { ...d, pid: np }); await S.store.del(sp(sid) + '/q/' + qid) } else await S.store.update(sp(sid) + '/q/' + qid, { pid: np }) } }
    for (const d of Object.keys(map)) { const evs = new Map(); Object.entries(S.events).forEach(([id, e]) => { if (e.scorer === d || e.assist === d) evs.set(id, e) });
      for (const f of ['scorer', 'assist']) { try { (await S.store.query('events', [[f, '==', d]])).forEach(e => evs.set(e.id, e)) } catch { } }
      for (const [id, e] of evs) { const up = {}; if (e.scorer === d) up.scorer = map[d]; if (e.assist === d) up.assist = map[d]; if (Object.keys(up).length) await S.store.update('events/' + id, up) }
      const c = map[d]; const P = S.players[c] || {}, D = S.players[d] || {}; const order = ['staff', 'special', 'active', 'guest', 'dormant']; const st = [mstatus(P), mstatus(D)].sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
      await S.store.update('players/' + c, { status: st, staff: st === 'staff', guest: st === 'guest', createdAt: Math.min(P.createdAt || 9e15, D.createdAt || 9e15) });
      const cc = S.contacts?.[c] || {}, dc = S.contacts?.[d]; if (dc) { const m = { ...dc, ...Object.fromEntries(Object.entries(cc).filter(([, v]) => v)) }; await S.store.set('contacts/' + c, m); await S.store.del('contacts/' + d) }
      for (const col of ['auth', 'notifPrefs']) { try { const dv = await S.store.get(col + '/' + d); if (dv) { const cv = await S.store.get(col + '/' + c); if (!cv) await S.store.set(col + '/' + c, dv); await S.store.del(col + '/' + d) } } catch { } }
      try { for (const t of await S.store.query('pushTokens', [['pid', '==', d]])) await S.store.update('pushTokens/' + t.id, { pid: c }) } catch { }
      await S.store.del('players/' + d) } });
  S.merging = false; if (ok) toast(`${plan.length}명의 중복 회원을 합쳤어요.`); render() }
const MSTAT = { staff: '운영진', special: '특별회원', active: '정회원', dormant: '장불회원', guest: '게스트' }; // 운영진·특별회원은 운영모드에 들어갈 수 있어요. (신청 0순위는 경기별 구장 예약자·경기 운영자만)
function mstatus(p) { const st = p?.status || (p?.guest ? 'guest' : 'active'); return st === 'active' && p?.staff ? 'staff' : st }
function stopAdminWatch() { for (const k of ['unsubAuth', 'unsubContacts', 'unRules']) { try { S[k]?.() } catch { } S[k] = null } }
function watchContacts() { if (!S.admin || S.unsubContacts || !S.store) return; S.unsubAuth = S.store.watchCol('auth', docs => { const o = {}; docs.forEach(d => o[d.id] = true); S.authMap = o; render() }); S.unsubContacts = S.store.watchCol('contacts', docs => { const o = {}; docs.forEach(d => { const { id, ...r } = d; o[id] = r }); S.contacts = o; render() }) }
function memberRows() {
  const st = {}; for (const r of playerStats()) st[r.id] = r;
  const last = {}; for (const [sid, s] of Object.entries(S.sessions)) { if (!sessMatches(sid).some(m => m.status === 'done')) continue; for (const k of KEYS) for (const id of teamPlayers(s, k)) if (!last[id] || last[id] < sid) last[id] = sid }
  const AT = {}; attRows('all').rows.forEach(r => AT[r.id] = r);
  return Object.entries(S.players).map(([id, p]) => ({ att: AT[id]?.n || 0, attr: Math.round((AT[id]?.rate || 0) * 100), attLast: AT[id]?.last || '', id, name: p.name, status: mstatus(p), phone: S.contacts?.[id]?.phone || '', memo: S.contacts?.[id]?.memo || '', days: st[id]?.days || 0, g: st[id]?.g || 0, a: st[id]?.a || 0, last: last[id] || '', created: p.createdAt || 0 }));
}
const MCOLS = [
  ['name', '이름', r => r.name, 't'], ['status', '회원 유형', r => MSTAT[r.status] || r.status, 't'],
  ['login', '로그인', r => S.authMap?.[r.id] ? '등록됨' : '미등록', 't'], ['birth', '생년월일', r => S.contacts?.[r.id]?.birth || '', 't'], ['phone', '연락처', r => r.phone || '', 't'],
  ['memo', '메모', r => r.memo || '', 't'], ['days', '참가', r => r.days || 0, 'n'], ['last', '최근 참가', r => r.last || '', 't'], ['att', '출석', r => r.att || 0, 'n'], ['attr', '출석률', r => r.attr || 0, 'n'], ['attLast', '최근 출석', r => r.attLast || '', 't']];
const mcol = k => MCOLS.find(c => c[0] === k);
function mApplyCols(rows) { const F = S.colF || {}; for (const [k, vals] of Object.entries(F)) { if (!vals) continue; const c = mcol(k); const set = new Set(vals); rows = rows.filter(r => set.has(String(c[2](r)))) }
  const so = S.colSort || { k: 'name', d: 1 }; const c = mcol(so.k) || MCOLS[0]; const g = c[2];
  return rows.sort((a, b) => { const x = g(a), y = g(b); if (c[3] === 'n') return (x - y) * so.d; if (x === '' && y !== '') return 1; if (y === '' && x !== '') return -1; return String(x).localeCompare(String(y), 'ko', { numeric: true }) * so.d }) }
function mTh(k, cls) { const c = mcol(k); const so = S.colSort || { k: 'name', d: 1 }; const on = !!S.colF?.[k]; const sorted = so.k === k;
  return `<th class="${cls || ''}"><button class="thf ${on ? 'on' : ''} ${sorted ? 'sorted' : ''}" data-act="colf" data-k="${k}" aria-label="${c[1]} 정렬·필터">${c[1]}<i>${sorted ? (so.d > 0 ? '▲' : '▼') : ''}${on ? '●' : '▾'}</i></button></th>` }
function colFilterSheet(k) { const c = mcol(k); const all = memberRows(); const cnt = {}; all.forEach(r => { const v = String(c[2](r)); cnt[v] = (cnt[v] || 0) + 1 });
  let vals = Object.keys(cnt).sort((a, b) => c[3] === 'n' ? b - a : (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ko', { numeric: true })));
  const tmp = S.colTmp; const q = (S.colQ || '').trim(); const shown = q ? vals.filter(v => v.includes(q)) : vals;
  return `<h4>${c[1]}</h4><div class="cf-sort"><button class="btn sm" data-act="colsort" data-k="${k}" data-d="1">${c[3] === 'n' ? '작은 수부터 ▲' : '오름차순 ▲ (ㄱ→ㅎ)'}</button><button class="btn sm" data-act="colsort" data-k="${k}" data-d="-1">${c[3] === 'n' ? '큰 수부터 ▼' : '내림차순 ▼ (ㅎ→ㄱ)'}</button></div>
    <input class="inp" type="search" placeholder="값 검색" value="${esc(S.colQ || '')}" data-in="colq" style="margin:10px 0 6px">
    <div class="cf-all"><button class="linkbtn" data-act="colall">모두 선택</button><button class="linkbtn" data-act="colnone">모두 해제</button><span class="muted">${tmp.length}/${vals.length}개 선택</span></div>
    <div class="cf-list">${shown.map(v => `<label class="cf-item"><input type="checkbox" data-in="colfv" value="${esc(v)}" ${tmp.includes(v) ? 'checked' : ''}><span>${v === '' ? '<i class="muted">(비어 있음)</i>' : esc(v)}</span><small>${cnt[v]}</small></label>`).join('') || '<p class="muted">맞는 값이 없어요.</p>'}</div>
    <div class="row" style="margin-top:12px"><button class="btn" data-act="colclear" data-k="${k}">필터 해제</button><button class="btn primary" data-act="colapply" data-k="${k}" ${tmp.length ? '' : 'disabled'}>적용</button></div>` }
function viewMembers() { const tg = subnav([['list', '회원 관리'], ['att', '출석 관리']], S.memv === 'att' ? 'att' : 'list', 'memv'); if (S.memv === 'att') return tg + viewAttendance(); return tg + viewMembers0() }
function viewMembers0() {
  const q = (S.mq || '').trim(); const f = S.mstat || 'all';
  const allRows = memberRows(); let rows = allRows; const cnt = k => allRows.filter(r => r.status === k).length;
  if (f !== 'all') rows = rows.filter(r => r.status === f);
  if (q) rows = rows.filter(r => r.name.includes(q) || r.phone.replace(/-/g, '').includes(q.replace(/-/g, '')) || r.memo.includes(q));
  rows = mApplyCols(rows); const fk = Object.keys(S.colF || {}).filter(k => S.colF[k]);
  let h = `<div class="mg-top subact"><h2 style="margin:0">회원 ${Object.keys(S.players).length}명</h2><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="mbulk">명단 붙여넣기</button><button class="btn sm" data-act="mcsv">CSV 저장</button><button class="btn primary sm" data-act="madd">＋ 회원 추가</button></div></div>
  <div class="mtools"><input class="inp" type="search" id="mq" placeholder="이름, 연락처, 메모 검색" value="${esc(q)}" data-in="mq">
  <div class="seg">${[['all', `전체 ${Object.keys(S.players).length}`], ...Object.entries(MSTAT).map(([k, n]) => [k, `${n} ${cnt(k)}`])].map(([k, n]) => `<button role="tab" data-act="mstat" data-k="${k}" aria-selected="${f === k}">${n}</button>`).join('')}</div>
</div>${fk.length || S.colSort ? `<div class="cf-bar">${fk.map(k => `<button class="chip sel" data-act="colclear" data-k="${k}">${mcol(k)[1]}: ${S.colF[k].length > 2 ? S.colF[k].slice(0, 2).map(v => esc(v || '(빈칸)')).join(', ') + ` 외 ${S.colF[k].length - 2}` : S.colF[k].map(v => esc(v || '(빈칸)')).join(', ')} ✕</button>`).join('')}${S.colSort ? `<span class="chip">정렬: ${mcol(S.colSort.k)[1]} ${S.colSort.d > 0 ? '▲' : '▼'}</span>` : ''}<button class="linkbtn" data-act="colreset">모두 초기화</button><span class="muted">${rows.length}명 표시</span></div>` : ''}`;
  { const dg = dupGroups(); if (dg.length) h += `<div class="panel pad dupbar"><div><b>⚠️ 같은 이름 회원 ${dg.length}명</b><p class="note" style="margin:4px 0 0">${dg.map(ids => esc(S.players[ids[0]].name) + ` ×${ids.length}`).join(', ')} · 한 사람으로 합치면 신청·팀·경기 기록·골/도움·연락처가 모두 합쳐져요.</p></div><button class="btn primary" data-act="mergedups" ${S.merging ? 'disabled' : ''}>${S.merging ? '합치는 중…' : '한 사람으로 합치기'}</button></div>` }
  const nsel = Object.values(S.msel || {}).filter(Boolean).length;
  if (nsel) h += `<div class="bulkbar"><b>${nsel}명 선택</b><button class="btn sm" data-act="mselclear">선택 해제</button><button class="btn sm danger" data-act="mbulkdel">선택 삭제</button></div>`;
  if (!rows.length) return h + `<div class="panel"><p class="empty">${q || fk.length ? '조건에 맞는 회원이 없어요.' : '회원이 없어요. 회원 추가나 명단 붙여넣기로 등록하세요.'}</p></div>`;
  h += `<div class="panel sheetwrap"><table class="grid"><thead><tr><th class="ck"><input type="checkbox" class="staffck" data-in="mselall" aria-label="모두 선택" ${rows.length && rows.every(r => S.msel?.[r.id]) ? 'checked' : ''}></th>${mTh('name', 'stick')}${mTh('status')}${mTh('login')}${mTh('birth')}${mTh('phone')}${mTh('memo')}${mTh('att')}${mTh('attr')}${mTh('attLast')}<th>관리</th></tr></thead><tbody>
  ${rows.map(r => `<tr class="${S.msel?.[r.id] ? 'msel' : ''}"><td class="ck"><input type="checkbox" class="staffck" data-in="msel" data-id="${r.id}" ${S.msel?.[r.id] ? 'checked' : ''} aria-label="${esc(r.name)} 선택"></td><td class="stick"><input class="cell w-name" type="text" value="${esc(r.name)}" data-in="mcell" data-id="${r.id}" data-f="name"></td>
    <td><select class="cell w-st st-${r.status}" data-in="mcell" data-id="${r.id}" data-f="status">${Object.entries(MSTAT).map(([k, n]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
    <td>${S.authMap?.[r.id] ? `<span class="muted" style="font-size:12px">등록됨</span> <button class="btn sm" data-act="pinreset" data-id="${r.id}">초기화</button>` : '<span class="muted" style="font-size:12px">미등록</span>'}</td>
    <td><input class="cell w-num" type="text" inputmode="numeric" maxlength="8" value="${esc(S.contacts?.[r.id]?.birth || '')}" placeholder="-" data-in="mcell" data-id="${r.id}" data-f="birth" style="width:84px"></td>
    <td><div class="telcell"><input class="cell w-tel" type="tel" value="${esc(r.phone)}" placeholder="010-0000-0000" data-in="mcell" data-id="${r.id}" data-f="phone">${r.phone ? `<a class="tel" href="tel:${esc(r.phone.replace(/[^0-9+]/g, ''))}" aria-label="${esc(r.name)}에게 전화">📞</a>` : ''}</div></td>
    <td><input class="cell w-memo" type="text" value="${esc(r.memo)}" placeholder="메모" data-in="mcell" data-id="${r.id}" data-f="memo"></td>
    <td class="num"><button class="attcell" data-act="attp" data-id="${r.id}"><b>${r.att}</b>회</button></td><td class="num"><div class="att-rate sm"><div class="att-bar"><i style="width:${r.attr}%"></i></div><span>${r.attr}%</span></div></td><td class="num">${r.attLast ? r.attLast.slice(5).replace('-', '.') : '-'}</td>
    <td class="acts"><button class="btn sm danger" data-act="mdel" data-id="${r.id}">삭제</button></td></tr>`).join('')}</tbody></table></div>
  <p class="note">칸을 눌러 바로 고치면 저장돼요. 회원 유형: 운영진(운영모드) · 특별회원(운영모드) · 정회원 · 장불회원(쉬는 회원, 신청·명단에서 빠져요) · 게스트. 장불회원으로 바꿔도 지난 기록은 그대로 남아요. 연락처와 메모는 운영모드에서만 보여요.</p>`;
  return h;
}
function parseMemberLines(txt) {
  const out = []; for (const line of txt.split(/\r?\n/)) { const l = line.trim(); if (!l) continue; const ph = (l.match(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/) || [])[0] || '';
    const guest = /\(\s*게\s*\)/.test(l); const name = l.replace(ph, '').replace(/\(\s*게\s*\)/g, '').replace(/^\s*\d+[.)]\s*/, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/)[0] || '';
    const rest = l.replace(ph, ''); const mm = rest.match(/^\s*(?:\d+[.)]\s*)?([\p{L}]+?)\s*(\d{2}(?:\d{2}){0,2})?\s*(?:\(\s*게\s*\))?\s*$/u); const birth = mm && mm[2] ? mm[2] : '';
    const nm = mm ? mm[1] : name;
    if (nm) out.push({ name: nm.slice(0, 20), phone: ph.replace(/[\s.]/g, '-').replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3'), guest, birth }) }
  return out;
}
async function saveMember(m) {
  let id = findPlayer(m.name);
  if (!id) id = await S.store.add('players', { name: m.name, guest: !!m.guest, status: m.guest ? 'guest' : 'active', createdAt: Date.now() });
  if (m.phone || m.memo || m.birth) await S.store.set('contacts/' + id, { ...(S.contacts?.[id] || {}), ...(m.phone ? { phone: m.phone } : {}), ...(m.memo ? { memo: m.memo } : {}), ...(m.birth ? { birth: m.birth } : {}) });
  return id;
}
async function exportMembersCSV() {
  const rows = memberRows().sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '\ufeff' + [['이름', '회원 유형', '연락처', '메모', '출석', '출석률(%)', '최근 출석', '골', '도움'], ...rows.map(r => [r.name, MSTAT[r.status], r.phone, r.memo, r.att, r.attr, r.attLast, r.g, r.a])].map(r => r.map(q).join(',')).join('\n');
  const name = `WD_FUTSAL_회원명단_${today().replace(/-/g, '')}.csv`; const blob = new Blob([csv], { type: 'text/csv' });
  if (S.store?.dl) { try { await S.store.dl.save({ filename: name, data: blob }); toast('회원 명단을 저장했어요.') } catch (e) { if (e?.code !== 'declined') toast('이 화면에서는 저장할 수 없어요.') } return }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000); toast('회원 명단을 저장했어요.');
}

async function sendChat() { if (!S.admin && !myTeam(cur()) && quietView()) return;
  const inp = document.getElementById('chatin'); if (!inp || S.sending) return; const text = inp.value.trim(); if (!text) return;
  const mk = myTeam(cur()); let name = mk ? pname(cur().captains[mk]) : S.admin ? (S.me || '운영진') : S.me;
  if (!name) { const n = prompt('채팅에 표시할 이름을 입력하세요'); if (!n || !n.trim()) return; S.me = n.trim().slice(0, 12); save('me', S.me); name = S.me }
  S.sending = true; inp.value = ''; let sent = false;
  try { sent = await w(() => S.store.add(sp(S.sid) + '/chat', { name, uid: myUid(), team: mk || null, admin: !mk && S.admin, text: text.slice(0, 300), at: Date.now() })) } finally { S.sending = false; if (!sent) { const i2 = document.getElementById('chatin'); if (i2 && !i2.value) i2.value = text } }
  document.getElementById('chatin')?.focus();
}
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'ap-pin') { e.preventDefault(); document.querySelector('[data-act=adminpinok]')?.click(); return } if (e.key === 'Enter' && e.target.dataset?.act === 'gohome') { e.target.click(); return } if (e.key === 'Enter' && (e.target.id === 'lg-pin' || e.target.id === 'lg-name')) { e.preventDefault(); document.querySelector('[data-act=login]')?.click(); return } if (e.target.id !== 'chatin' || e.key !== 'Enter' || e.shiftKey) return; e.preventDefault();
  if (e.isComposing) { S.sendAfterCompose = true; return } sendChat() }, true);
document.addEventListener('scroll', e => { const t = e.target; if (t && t.classList && t.classList.contains('msgs') && !S.autoScrolling) S.chatUp = t.scrollHeight - t.scrollTop - t.clientHeight > 40 }, true);
document.addEventListener('input', e => { if (e.target.dataset?.in === 'pnq') { S.pnQ = e.target.value; const tmp = document.createElement('div'); tmp.innerHTML = pushComposer(); for (const sel of ['.pnchips', '.chotabs', '.chotools']) { const nl = tmp.querySelector(sel), ol = document.querySelector(sel); if (nl && ol) ol.replaceWith(nl); else if (ol && !nl) ol.remove(); else if (nl && !ol) document.querySelector('.pnchips')?.after(nl) } return }
  if (e.target.dataset?.in === 'colq' && S.sheet?.type === 'colf') { S.colQ = e.target.value; const tmp = document.createElement('div'); tmp.innerHTML = colFilterSheet(S.sheet.k); const nl = tmp.querySelector('.cf-list'), ol = document.querySelector('.cf-list'); if (nl && ol) ol.replaceWith(nl); return }
  if (/-name$/.test(e.target.id || '')) document.querySelectorAll('.lgerr').forEach(x => x.hidden = true); if (e.target.classList?.contains('pin')) { const v = e.target.value.replace(/\D/g, ''); if (v !== e.target.value) e.target.value = v } }, true);
document.addEventListener('compositionstart', e => { if (e.target.id === 'chatin') S.composing = true });
document.addEventListener('compositionend', e => { if (e.target.id !== 'chatin') return; S.composing = false;
  if (S.sendAfterCompose) { S.sendAfterCompose = false; setTimeout(sendChat, 0) } else if (S.pending) setTimeout(() => { if (!S.composing) render() }, 0) });
/* ───────── ticking ───────── */
function tick() {
  const cache = {}; const ci = id => cache[id] || (cache[id] = S.matches[id] ? clockInfo(M(id)) : null);
  document.querySelectorAll('[data-clock],[data-bigclock]').forEach(el => { const id = el.dataset.clock || el.dataset.bigclock; const c = ci(id); if (!c) return; if (el.textContent !== c.time) el.textContent = c.time; if (el.dataset.bigclock) { el.classList.toggle('over', !!c.over); el.classList.toggle('gk', c.phase === 'gk' || c.phase === 'rest') } });
  document.querySelectorAll('[data-phase]').forEach(el => { const c = ci(el.dataset.phase); if (c && el.textContent !== c.label) el.textContent = c.label });
  document.querySelectorAll('[data-seg]').forEach(el => { const [id, i] = el.dataset.seg.split(':'); const c = ci(id); if (!c) return; const r = [[0, c.a], [c.a, c.b], [c.b, c.c]][+i]; el.style.width = Math.max(0, Math.min(1, (Math.min(c.e, c.c) - r[0]) / (r[1] - r[0] || 1))) * 100 + '%' });
  const eb = document.querySelector('[data-act="end"]'); if (eb && S.openMatch) { const c = ci(S.openMatch); if (c) eb.classList.toggle('primary', c.phase === 'full') }
  if (Date.now() - (S.wpAt || 0) >= 240) { S.wpAt = Date.now(); watchPhases() }
}
setInterval(tick, 100); // 화면 시계는 0.1초마다, 휘슬 점검은 0.25초마다

/* ───────── events ───────── */
let saveT = {};
document.addEventListener('focusout', () => setTimeout(() => { if (S.pending && !isTyping()) render() }, 0));
document.addEventListener('input', e => { const el = e.target; const k = el.dataset.in; if (!k) return;
  if (k === 'calf' && S.cal) { S.cal.f[el.dataset.f] = el.value; if (el.dataset.f === 'no') S.cal.f.noAuto = false; return }
  if (k === 'calfvenue' && S.cal) { if (el.value === '__custom') { S.cal.f.venueCustom = true; S.cal.f.venue = ''; render(); setTimeout(() => document.getElementById('calf-venue')?.focus(), 50) } else { S.cal.f.venueCustom = false; S.cal.f.venue = el.value } return }
  if (k === 'impf' && S.imp) { S.imp[el.dataset.f] = el.value; return }
  if (k === 'schedf' && S.admin) { const f = el.dataset.f; S.meta = S.meta || {}; S.meta.sched = { ...schedCfg(), [f]: el.value }; clearTimeout(S.schedT); S.schedT = setTimeout(async () => { await w(() => S.store.set('meta/sched', S.meta.sched)); S.schedImg = {}; const ym0 = S.schedYm || defaultMonth(); clearThumbs('sched', ym0); document.querySelectorAll('.pth[data-k="sched"] img').forEach(x => x.remove()); refreshSchedule(); fillThumbs('sched', ym0) }, 700); return }
  if (k === 'mq') { S.mq = el.value; clearTimeout(S.mqT); S.mqT = setTimeout(() => { const pos = el.selectionStart; S.pending = false; const a = document.activeElement; a && a.blur(); render(); const n = document.getElementById('mq'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos) } catch { } } }, 250); return }
  if (k === 'sfield' && S.admin) { const f = el.dataset.f; clearTimeout(saveT[f]); saveT[f] = setTimeout(async () => { await w(() => S.store.update(sp(S.sid), { [f]: el.value })); if (f === 'evpw' || f === 'notice') { clearThumbs('team', S.sid); document.querySelectorAll('.pth[data-k="team"] img').forEach(x => x.remove()); refreshPoster(); fillThumbs('team', S.sid) } }, 600) } });
document.addEventListener('change', e => { const el = e.target;
  if (el.id === 'att-file' && el.files?.[0]) { const f = el.files[0]; f.arrayBuffer().then(readXlsx).then(sh => { S.attImp = { fname: f.name, res: attFromSheets(sh) }; render() }).catch(err => toast('엑셀을 읽지 못했어요: ' + (err.message || err))); return }
  if (el.dataset?.in === 'pairsel') { const m = M(el.dataset.id); if (!m) return; const D = (S.pairDraft ??= {}); const cur0 = D[m.id] || [m.home, m.away]; const nx = [...cur0]; const i = el.dataset.side === 'h' ? 0 : 1; nx[i] = el.value; if (nx[0] === nx[1]) nx[1 - i] = cur0[i]; D[m.id] = nx; render(); return }
  if (el.dataset.in === 'schedym') { S.schedYm = el.value; render(); return }
  if (el.dataset.in === 'nsid') { S.nsid = el.value; render(); return }
  if (el.dataset.in === 'colfv') { const v = el.value; S.colTmp = el.checked ? [...new Set([...S.colTmp, v])] : S.colTmp.filter(x => x !== v); const ap = document.querySelector('[data-act=colapply]'); if (ap) ap.disabled = !S.colTmp.length; const sp_ = document.querySelector('.cf-all .muted'); if (sp_) sp_.textContent = sp_.textContent.replace(/^\d+/, S.colTmp.length); return }
  if (el.dataset.in === 'bootbg') { const files = [...(el.files || [])]; if (!files.length) return; const used = new Set(bootBgs().map(x => x.id)); const free = [0, 1, 2, 3, 4].map(i => 'bootbg_' + i).filter(k => !used.has(k)); if (used.has('bootbg')) free.pop();
    if (!free.length) { toast('배경은 5장까지예요. 하나를 지우고 올려 주세요.'); el.value = ''; return } const pick = files.slice(0, free.length); if (files.length > pick.length) toast(`빈 자리가 ${free.length}칸이라 ${pick.length}장만 올려요.`); else toast('사진을 줄이는 중이에요…');
    (async () => { let ok = 0; for (let i = 0; i < pick.length; i++) { try { const f = pick[i];
        const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f) });
        const im = await new Promise((res, rej) => { const g = new Image(); g.onload = () => res(g); g.onerror = rej; g.src = url });
        const { cv } = composeBootBg(im);
        let q = .72, out = cv.toDataURL('image/jpeg', q); while (out.length > 320000 && q > .3) { q -= .08; out = cv.toDataURL('image/jpeg', q) }
        if (await w(() => S.store.set('meta/' + free[i], { img: out, at: Date.now() }))) ok++ } catch (e) { console.error(e) } }
      toast(ok ? `배경 사진 ${ok}장을 저장했어요.` : '사진을 불러오지 못했어요. 다른 사진으로 해 주세요.') })(); el.value = ''; return }
  if (el.dataset.in === 'kkimg') { const files = [...(el.files || [])]; el.value = ''; if (!files.length) return;
    S.ocrBusy = true; S.ocrMsg = '글자 인식 준비 중…'; render();
    (async () => { try { const L = await ocrKakao(files, (i, p) => { const t = `${files.length}장 중 ${i + 1}장째 읽는 중… ${Math.round((p || 0) * 100)}%`; S.ocrMsg = t; const b0 = document.querySelector('.ocrbox b'); if (b0) b0.textContent = t });
        S.ocrBusy = false; if (!L.length) { toast('이미지에서 이름을 찾지 못했어요. 참여자 목록이 잘 보이게 캡처해 주세요.'); render(); return } S.kk = L; S.kkFromImg = true; render() }
      catch (e) { console.error(e); S.ocrBusy = false; toast('글자를 읽지 못했어요. 인터넷 연결을 확인하거나, "글자로 붙여넣기"를 써 주세요.'); render() } })(); return }
  if (el.dataset.in === 'npref') { const pid = myPid(); if (!pid) return; S.np = { ...(S.np || { on: true }), [el.dataset.k]: el.checked }; S.store.set('notifPrefs/' + pid, { ...S.np, at: Date.now() }).catch(e => toast(errMsg(e))); return }
  if (el.dataset.in === 'ruleon') { if (!S.admin) return; S.store.update('pushRules/' + el.dataset.id, { on: el.checked }).catch(e => toast(errMsg(e))); return }
  if (el.dataset.in === 'pnsid') { S.pnSid = el.value; S.pnTitle = document.getElementById('pn-title')?.value || ''; S.pnBody = document.getElementById('pn-body')?.value || ''; render(); return }
  if (el.dataset.in === 'kkpick') { if (S.kk) S.kk[+el.dataset.i].use = el.value; return }
  if (el.dataset.in === 'mancol') { S.manF.cols[+el.dataset.i] = el.value; return }
  if (el.dataset.in === 'mmpick') { S.mmPick = el.value; S.mmStage = null; S.mmDraft = null; render(); return }
  if (el.dataset.in === 'venuesel') { const sid = el.dataset.sid; if (el.value === '__custom') { (S.venueCustom ??= {})[sid] = true; render(); setTimeout(() => document.querySelector(`[data-in=cell][data-sid="${sid}"][data-f=venue]`)?.focus(), 50) } else if (el.value) { (S.venueCustom ??= {})[sid] = false; S.store.update(sp(sid), { venue: el.value }).catch(e => toast(errMsg(e))) } return }
  if (el.dataset.in === 'ctxpick') { S.sid = el.value; S.planSel = el.value; S.planM = el.value.slice(0, 7); S.nsid = el.value; S.step = null; S.sel = null; S.openMatch = null; render(); return }
  if (el.dataset.in === 'latetoggle' && S.admin) { el.checked = false; cancelApp(S.sid, el.dataset.id, null, true); return }
  if (el.dataset.in === 'lateuntoggle' && S.admin) { if (!confirm(`${pname(el.dataset.id)} 님의 마감 후 취소 표시를 지울까요? (다음 경기 3순위가 해제돼요. 참가 명단에는 다시 들어가지 않아요)`)) { el.checked = true; return } w(() => S.store.update(sp(S.sid), { [`late.${el.dataset.id}`]: null }), '해제했어요.'); return }
  if (el.dataset.in === 'msel') { (S.msel ??= {})[el.dataset.id] = el.checked; render(); return }
  if (el.dataset.in === 'mselall') { S.msel = {}; if (el.checked) document.querySelectorAll('[data-in=msel]').forEach(x => S.msel[x.dataset.id] = true); render(); return }
  if (el.dataset.in === 'mcell' && S.admin) { const id = el.dataset.id, f = el.dataset.f, v = el.value.trim();
    if (f === 'name') { if (!v) { render(); return } if (v !== S.players[id]?.name) { if (findPlayer(v)) { toast('같은 이름의 회원이 이미 있어요.'); render(); return } w(() => S.store.update('players/' + id, { name: v.slice(0, 20) }), '저장했어요.') } return }
    if (f === 'status') { w(() => S.store.update('players/' + id, { status: v, guest: v === 'guest', staff: v === 'staff' }), `${S.players[id]?.name || ''} 님을 ${MSTAT[v] || v}(으)로 바꿨어요.`); return }
    const c = S.contacts?.[id] || {}; if ((c[f] || '') !== v) w(() => S.store.set('contacts/' + id, { ...c, [f]: v }), '저장했어요.'); return }
  if (el.dataset.in === 'cell' && S.admin) { const f = el.dataset.f, sid = el.dataset.sid; const v = f === 'capacity' || f === 'no' ? (+el.value || 0) : el.value; if (S.sessions[sid]?.[f] !== v) w(() => S.store.update(sp(sid), { [f]: v }), '저장했어요.'); return } if (el.dataset.in === 'sidpick') { S.sid = el.value; S.openMatch = null; render(); return } if (el.dataset.in === 'sfield' && el.type === 'time' && S.admin) w(() => S.store.update(sp(S.sid), { time: el.value })) });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'addone') { e.preventDefault(); document.querySelector('[data-act="addone"]').click() } if (e.key === 'Escape') { if (S.sheet) { S.sheet = null; render() } else if (S.openMatch) { S.openMatch = null; render() } } });
document.addEventListener('submit', async e => { e.preventDefault(); const f = e.target;
  if (f.dataset.form === 'chat') await sendChat(); });

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.classList.contains('scrim') && e.target.closest('[data-stop]')) return;
  if (el.disabled) return; const act = el.dataset.act, id = el.dataset.id; const s = cur(); const m = S.openMatch ? M(S.openMatch) : null;
  if (act && act.startsWith('man')) { await manAct(act, el); return }
  if (act && act.startsWith('mm') && !['mmtoggle', 'mmtake', 'mmrelease', 'mmmode'].includes(act) && S.tab === 'mm' && !mmIsCtl()) { toast('보기 전용이에요. 진행자만 조작할 수 있어요.'); return }
  switch (act) {
    case 'tab': if (S.fs) fsExit(); S.tab = el.dataset.v; if (S.admin && S.tab === 'run') { const r = runSid(); if (r) { S.sid = r; S.step = null; watchChat() } } S.openMatch = null; S.sheet = null; S.sel = null; S.sub = null; S.detail = null; render(); window.scrollTo(0, 0); break;
    case 'home': S.sid = null; S.step = null; watchChat(); render(); break;
    case 'gostage': if (!needAdmin() && el.dataset.v !== 'trade') break; if (el.dataset.v === 'captain' && !(await freezeApps(s))) break; await setStage(el.dataset.v); break;
    case 'addone': { const inp = document.getElementById('addone'); const v = inp.value.trim(); if (!v) break; inp.value = ''; inp.blur(); document.activeElement?.blur?.(); await addApplicants(v.split(/[,，\n]+/).map(x => x.trim()).filter(Boolean)); break }
    case 'capslot': S.sheet = { type: 'capslot', k: el.dataset.k }; render(); break;
    case 'pickcap': { const k = S.sheet.k; S.sheet = null; render(); await w(() => S.store.update(sp(S.sid), { [`captains.${k}`]: id || null, [`captainTokens.${k}`]: id ? rand() : null })); break }
    case 'pick': { const s0 = cur(); if (s0?.pending?.p === id) { await w(() => S.store.update(sp(S.sid), { pending: null })); break } await setPending(id); break }
    case 'unpick': { const s0 = cur(); const k = myTeam(s0); const sid0 = S.sid;
      if (s0.pending?.p === id && (S.admin || s0.pending.t === k)) { await w(() => S.store.update(sp(sid0), { pending: null }), '선택을 취소했어요.'); break }
      const last = (s0.picks || []).slice(-1)[0];
      if (!last || last.p !== id) { toast('이미 다음 순번이 진행돼서 취소할 수 없어요. 운영진에게 요청해 주세요.'); break }
      if (!S.admin) { toast('확정된 지명 되돌리기는 운영진만 할 수 있어요.'); break }
      if (!confirm(`${pname(id)} 지명을 되돌릴까요? ${team(s0, last.t).name} 차례로 돌아가요.`)) break; await undoPick(); break }
    case 'undo': S.sheet = null; if (!needAdmin()) break; if (confirm('마지막 지명을 되돌릴까요?')) await undoPick(); else render(); break;
    case 'noop': break;
    case 'fson': await fsEnter(); break;
    case 'fsoff': await fsExit(); break;
    case 'fsflip': S.fsFlip = !S.fsFlip; save('fsflip', S.fsFlip); render(); break;
    case 'pushon': await pushEnable(); break;
    case 'inbox': S.sheet = { type: 'inbox' }; render(); markInboxRead(); break;
    case 'ibdel': { const pid = myPid(); if (!pid) break; S.inbox = (S.inbox || []).filter(x => x.id !== id); render(); try { await S.store.del(`inbox/${pid}/items/${id}`) } catch (e) { toast(errMsg(e)) } break }
    case 'ibclear': { const pid = myPid(); if (!pid || !confirm('받은 알림을 모두 지울까요?')) break; const ids = (S.inbox || []).map(x => x.id); S.inbox = []; render(); for (const x of ids) { try { await S.store.del(`inbox/${pid}/items/${x}`) } catch { } } toast('모두 지웠어요.'); break }
    case 'rulenew': if (!needAdmin()) break; S.ruleId = null; S.ruleF = { kind: 'event', event: 'applyClose', offsetMin: -180, target: 'unapplied', title: '⏰ {날짜} 경기 신청 마감 3시간 전', body: '{시간} {구장} · 아직 신청하지 않았어요.' }; S.sheet = { type: 'rule' }; render(); break;
    case 'ruleedit': if (!needAdmin()) break; S.ruleId = id; S.ruleF = { ...(S.rules?.[id] || {}) }; S.sheet = { type: 'rule' }; render(); break;
    case 'rulekind': S.ruleF = { ...readRuleForm(), kind: el.dataset.k }; render(); break;
    case 'rulesave': { if (!needAdmin()) break; const R = readRuleForm(); if (!R.title) { toast('제목을 입력해 주세요.'); break }
      if (R.kind === 'trigger') { if (await w(() => S.store.update('pushRules/' + S.ruleId, { title: R.title, body: R.body || '', updatedAt: Date.now() }), '기본 알림을 고쳤어요.')) { S.sheet = null; S.ruleF = null; S.ruleId = null; render() } break } if (R.kind === 'date' && !R.at) { toast('보낼 날짜·시간을 골라 주세요.'); break }
      const doc = { title: R.title, body: R.body || '', target: R.target || 'all', kind: R.kind || 'event', on: R.on !== false, ...(R.kind === 'date' ? { at: R.at, event: null, offsetMin: null } : { event: R.event, offsetMin: R.offsetMin, at: null }), updatedAt: Date.now() };
      const ok = S.ruleId ? await w(() => S.store.update('pushRules/' + S.ruleId, R.kind === 'date' && R.at !== S.rules?.[S.ruleId]?.at ? { ...doc, sentAt: null } : doc), '자동 알림을 고쳤어요.') : await w(() => S.store.add('pushRules', { ...doc, createdAt: Date.now() }), '자동 알림을 만들었어요.');
      if (ok) { S.sheet = null; S.ruleF = null; S.ruleId = null; render() } break }
    case 'ruledel': { if (!needAdmin()) break; const R0 = S.rules?.[id]; if (!confirm(R0?.sys ? '이 기본 알림을 지울까요? (나중에 되살릴 수 있어요)' : '이 자동 알림을 지울까요?')) break; await w(() => R0?.sys ? S.store.update('pushRules/' + id, { deleted: true, on: false }) : S.store.del('pushRules/' + id), '지웠어요.'); break }
    case 'sysrestore': if (!needAdmin()) break; for (const [rid, R0] of Object.entries(S.rules || {})) if (R0.sys && R0.deleted) await w(() => S.store.update('pushRules/' + rid, { deleted: false, on: true })); toast('기본 알림을 되살렸어요.'); break;
    case 'rulereset': { const def = SYS_RULES[S.ruleId]; if (!def) break; S.ruleF = { ...S.ruleF, title: def.title, body: def.body, ...(def.kind === 'event' ? { event: def.event, offsetMin: def.offsetMin, target: def.target } : {}) }; render(); break }
    case 'pushoff': await pushDisable(); break;
    case 'pngrp': { if (!needAdmin()) break; const k = el.dataset.k; S.pnTitle = document.getElementById('pn-title')?.value || S.pnTitle; S.pnBody = document.getElementById('pn-body')?.value || S.pnBody;
      if (k === 'none') S.pnSel = []; else if (k === 'all') S.pnSel = Object.keys(S.players).filter(id => mstatus(S.players[id]) !== 'dormant'); else S.pnSel = [...(pushGroups(S.sessions[S.pnSid])[k] || [])]; render(); break }
    case 'pntab': S.pnTitle = document.getElementById('pn-title')?.value || S.pnTitle; S.pnBody = document.getElementById('pn-body')?.value || S.pnBody; S.pnTab = el.dataset.k; S.pnQ = ''; render(); break;
    case 'pnchoall': case 'pnchonone': { S.pnTitle = document.getElementById('pn-title')?.value || S.pnTitle; S.pnBody = document.getElementById('pn-body')?.value || S.pnBody; const ids = Object.keys(S.players).filter(x => mstatus(S.players[x]) !== 'dormant' && choOf(pname(x)) === S.pnTab); const set = new Set(S.pnSel || []); ids.forEach(x => act === 'pnchoall' ? set.add(x) : set.delete(x)); S.pnSel = [...set]; render(); break }
    case 'pntog': { S.pnTitle = document.getElementById('pn-title')?.value || S.pnTitle; S.pnBody = document.getElementById('pn-body')?.value || S.pnBody; const set = new Set(S.pnSel || []); set.has(id) ? set.delete(id) : set.add(id); S.pnSel = [...set]; render(); break }
    case 'pushsend': { if (!needAdmin()) break; const t = document.getElementById('pn-title')?.value.trim(), b0 = document.getElementById('pn-body')?.value.trim(); const pids = [...new Set(S.pnSel || [])];
      if (!pids.length) { toast('받는 사람을 골라 주세요.'); break } if (!t || !b0) { toast('제목과 내용을 입력해 주세요.'); break } if (!confirm(`${pids.length}명에게 알림을 보낼까요?`)) break;
      await queuePush({ type: 'notice', title: t, body: b0, target: 'pids', pids, sid: S.pnSid || null }); S.pnTitle = ''; S.pnBody = ''; S.pnSel = []; document.activeElement?.blur?.(); toast(`${pids.length}명에게 알림을 보냈어요. 잠시 뒤 도착해요.`); render(); break }
    case 'stalefix': { if (!needAdmin()) break; const ps = staleExtraPids(cur()); if (!ps.length) break; if (!confirm(`${ps.map(pname).join(', ')} 님의 주차·공당·물당 신청과 지정을 지울까요?`)) break; for (const p0 of ps) await clearExtras(S.sid, p0); toast('정리했어요.'); render(); break }
    case 'kakaopaste': if (!needAdmin()) break; S.kk = null; S.kkFromImg = false; S.ocrBusy = false; S.sheet = { type: 'kakao' }; render(); break;
    case 'kakaoparse': { const t = document.getElementById('kk-text')?.value || ''; const L = parseKakao(t); if (!L.length) { toast('이름을 찾지 못했어요. 다시 붙여넣어 주세요.'); break } S.kk = L; S.kkFromImg = false; document.activeElement?.blur?.(); render(); break }
    case 'kakaoback': S.kk = null; S.kkFromImg = false; render(); break;
    case 'kakaorev': if (S.kk) { S.kk.reverse(); render() } break;
    case 'kakaoapply': { if (!needAdmin() || !S.kk) break; if (await applyKakao(S.sid, S.kk)) { S.sheet = null; S.kk = null; render() } break }
    case 'orderreset': if (!needAdmin() || !confirm('직접 바꾼 순서를 지우고, 실제로 신청이 들어온 순서(서버 도착 시각)로 되돌릴까요?')) break; await w(() => S.store.update(sp(S.sid), { appOrder: null }), '실제 신청 순서로 되돌렸어요.'); break;
    case 'appmove': { if (!needAdmin()) break; const rows = dispRows(S.sessions[S.sid]); const i = rows.findIndex(r => r.k === el.dataset.k); await moveApp(S.sid, el.dataset.k, i + (+el.dataset.d)); break }
    case 'appmoveto': { if (!needAdmin()) break; const rows = dispRows(S.sessions[S.sid]); const n = rows.length; const v = prompt(`표에서 몇 번째 자리로 옮길까요? (1 ~ ${n}, 자동 신청 줄은 빼고 셉니다)`); const t = parseInt(v, 10); if (!t) break; await moveApp(S.sid, el.dataset.k, t - 1); break }
    case 'betatoggle': { if (!needAdmin()) break; const on = betaOn(); if (on && !confirm('정식 서비스를 오픈할까요?\n신청 순번 변경 기능이 잠기고, 순번은 서버 도착 시각으로만 정해져요.')) break; if (!on && !confirm('다시 베타테스트 모드로 바꿀까요? 신청 순번을 바꿀 수 있게 돼요.')) break;
      await w(() => S.store.set('meta/flags', { ...(S.meta?.flags || {}), beta: !on, at: Date.now() }), on ? '정식 서비스로 전환했어요. 순번 변경이 잠겼어요.' : '베타테스트 모드로 바꿨어요.'); break }
    case 'bootbgdel': if (!needAdmin() || !confirm('이 배경 사진을 지울까요?')) break; await w(() => S.store.set('meta/' + el.dataset.k, { img: '', at: Date.now() }), '배경 사진을 지웠어요.'); break;
    case 'colf': { const k = el.dataset.k; const c = mcol(k); const all = [...new Set(memberRows().map(r => String(c[2](r))))]; S.colTmp = S.colF?.[k] ? [...S.colF[k]] : all; S.colQ = ''; S.sheet = { type: 'colf', k }; render(); break }
    case 'colsort': S.colSort = { k: el.dataset.k, d: +el.dataset.d }; S.sheet = null; render(); break;
    case 'colall': { const c = mcol(S.sheet.k); const all = [...new Set(memberRows().map(r => String(c[2](r))))]; const q = (S.colQ || '').trim(); S.colTmp = q ? [...new Set([...S.colTmp, ...all.filter(v => v.includes(q))])] : all; render(); break }
    case 'colnone': { const q = (S.colQ || '').trim(); S.colTmp = q ? S.colTmp.filter(v => !v.includes(q)) : []; render(); break }
    case 'colapply': { const k = el.dataset.k; const c = mcol(k); const all = new Set(memberRows().map(r => String(c[2](r)))); S.colF = { ...(S.colF || {}) }; S.colF[k] = S.colTmp.length >= all.size ? null : [...S.colTmp]; S.sheet = null; render(); break }
    case 'colclear': { S.colF = { ...(S.colF || {}) }; S.colF[el.dataset.k] = null; if (S.sheet?.type === 'colf') S.sheet = null; render(); break }
    case 'colreset': S.colF = {}; S.colSort = null; render(); break;
    case 'changelog': S.sheet = { type: 'changelog' }; render(); break;
    case 'adminpinchange': { if (!needAdmin()) break; const cur = document.getElementById('apc-cur')?.value || '', n1 = document.getElementById('apc-new')?.value || '', n2 = document.getElementById('apc-new2')?.value || '';
      if (!(await adminPinOk(cur))) { toast('현재 운영모드 비밀번호가 달라요.'); break } if (!/^\d{4,8}$/.test(n1)) { toast('새 비밀번호는 숫자 4~8자리로 정해 주세요.'); break } if (n1 !== n2) { toast('새 비밀번호 두 번이 서로 달라요.'); break }
      const nh = await sha('wd-admin:' + n1); if (await w(() => S.store.set('meta/admin', { h: nh, at: Date.now() }), '운영모드 비밀번호를 바꿨어요. 다른 운영진에게도 알려 주세요.')) ['apc-cur', 'apc-new', 'apc-new2'].forEach(i => { const x = document.getElementById(i); if (x) x.value = '' }); break }
    case 'viewertog': { if (!needAdmin()) break; const s0 = cur(); const on = (s0.viewers || []).includes(id); await w(() => S.store.patch(sp(S.sid), on ? { remove: { viewers: [id] } } : { union: { viewers: [id] } })); break }
    case 'clrsim': if (!needAdmin()) break; await clearPractice(el.dataset.k); break;
    case 'mmmode': S.mmManual = el.dataset.v === '1'; render(); break;
    case 'carsave': { const v = (document.getElementById('me-car')?.value || '').replace(/\s+/g, '').slice(0, 12); save('car', v); const pid = myPid(); if (pid) { try { await S.store.set('contacts/' + pid, { ...(S.contacts?.[pid] || {}), car: v }) } catch { } } toast(v ? '차량번호를 저장했어요.' : '차량번호를 지웠어요.'); break }
    case 'appreload': toast('최신 버전을 불러오는 중이에요…'); setTimeout(() => location.reload(), 300); break;
    case 'dutyreq': { const me = myPid(); if (!me) { toast('로그인 후 신청할 수 있어요.'); break } const ss = S.sessions[id]; const k = el.dataset.k; const on = !!ss?.dutyReq?.[k]?.[me];
      await w(() => S.store.update(sp(id), { [`dutyReq.${k}.${me}`]: on ? null : Date.now() }), on ? `${k === 'ball' ? '공당' : '물당'} 신청을 취소했어요.` : `${k === 'ball' ? '공당' : '물당'}을 신청했어요. 운영진이 확정해요.`); break }
    case 'dutyfill': { if (!needAdmin()) break; const ss = S.sessions[id]; const k = el.dataset.kind; const ps = participants(ss); const vol = ps.filter(p => ss.dutyReq?.[k]?.[p]);
      await w(() => S.store.update(sp(id), { [`duty.${k}`]: vol }), '신청자로 지정했어요.'); break }
    case 'mmtake': { const s = S.sessions[S.mmSid]; const c = mmCtl(s); if (!c.free && !c.stale && !c.mine) break; if (!c.free && !confirm(`${c.name} 님 대신 경기 진행을 맡을까요?`)) break; if (await mmTake(S.mmSid, !c.free)) toast('이제 내가 경기를 진행해요.'); else toast('다른 사람이 먼저 진행을 맡았어요.'); break }
    case 'mmrelease': { const s = S.sessions[S.mmSid]; if (s && liveAny() && !confirm('경기가 진행 중이에요. 진행을 넘기면 휘슬은 새 진행자 폰에서 울려요. 넘길까요?')) break; await mmRelease(S.mmSid); if (S.mmTry) S.mmTry[S.mmSid] = 1; break }
    case 'mksim': if (!needAdmin()) break; await makeSim(el.dataset.k); break;
    case 'mkpractice': if (!needAdmin()) break; await makePractice(); break;
    case 'clrpractice': if (!needAdmin()) break; await clearPractice(); break;
    case 'mmtoggle': audio(); S.tab = S.tab === 'mm' ? 'mhome' : 'mm'; keepAwake(S.tab === 'mm'); S.sub = null; render(); window.scrollTo(0, 0); break;
    case 'mmpk': { const d = S.mmDraft; const key = el.dataset.w === '1' ? 'p1' : 'p2'; const arr = d[key]; const k = el.dataset.k; if (arr.includes(k)) d[key] = arr.filter(x => x !== k); else if (arr.length < 2) arr.push(k); else d[key] = [arr[1], k]; if (key === 'p1') d.p2 = []; render(); break }
    case 'mmsw': { const n = +el.dataset.n; const d = S.mmDraft; d.swap[n] = !d.swap[n]; render(); break }
    case 'mmpairsave': await mmSavePairs(); break;
    case 'mmstage': S.mmStage = el.dataset.v; if (el.dataset.v === 'pair') S.mmDraft = null; if (el.dataset.v === 'time') S.mmT = null; render(); break;
    case 'mmtadj': { const f = S.mmT; const k = el.dataset.k; const v = Math.round(((+f[k]) + (+el.dataset.d)) * 10) / 10; f[k] = Math.max(k === 'gk' ? 0 : 0.5, Math.min(k === 'gk' ? 120 : 30, v)); render(); break }
    case 'mmtimesave': { const f = S.mmT; const s = S.sessions[S.mmSid]; if (await w(() => S.store.update(sp(s.date), { timing: { ...timing(s), h1: Math.round(f.h1 * 60), gk: +f.gk, h2: Math.round(f.h2 * 60) }, 'mm.timed': true }), '경기 시간을 저장했어요.')) { S.mmStage = null; S.mmT = null; render() } break }
    case 'mmstart': { const m = M(id); if (!m) break; if (sessMatches(m.session).some(x => x.status === 'live' && x.id !== id)) { toast('진행 중인 다른 경기를 먼저 끝내 주세요.'); break } mmCountdown(m); break }
    case 'mmpause': { const m = M(id); await w(() => S.store.update(mp(id), { timer: { running: false, acc: elapsed(m), startedAt: 0 } })); break }
    case 'mmresume': { const m = M(id); audio(); await w(() => S.store.update(mp(id), { timer: { running: true, acc: m.timer?.acc || 0, startedAt: nowS() } })); break }
    case 'mmend': { const m = M(id); if (clockInfo(m).phase !== 'full' && !confirm('아직 시간이 남았어요. 경기를 종료할까요?')) break; const e = elapsed(m); await w(() => S.store.update(mp(id), { status: 'done', timer: { running: false, acc: e, startedAt: 0 }, endedAt: nowS() }), `${m.n}경기를 종료했어요.`); break }
    case 'mmpg': { const m = M(id); if (!m) break; const k = el.dataset.k, p = el.dataset.p; const og = (S.mmOg || {})[m.id] === k; if (og) { (S.mmOg ??= {})[m.id] = null; await addGoal(m, k === m.home ? m.away : m.home, p, null, true) } else await addGoal(m, k, p, null, false); try { navigator.vibrate?.(60) } catch { } render(); break }
    case 'mmog': { const k = el.dataset.k; S.mmOg ??= {}; S.mmOg[id] = S.mmOg[id] === k ? null : k; render(); break }
    case 'mmdelg': { const eid = el.dataset.e; const e = S.events[eid]; if (!e) break; if (!confirm(`${e.scorer ? pname(e.scorer) : '선수 미지정'}${e.og ? '(자책)' : ''} 골을 취소할까요?`)) break; await w(() => S.store.del('events/' + eid), '골을 취소했어요.'); break }
    case 'mmteam': { const m = M(id); if (!m || m.status !== 'pending') break; const k = el.dataset.k; const pos = el.dataset.side; let nh = m.home, na = m.away;
      if (pos === 'h') { if (k === m.home) break; if (k === m.away) { nh = m.away; na = m.home } else nh = k } else { if (k === m.away) break; if (k === m.home) { nh = m.away; na = m.home } else na = k }
      await mmSetTeams(m, nh, na); break }
    case 'mmreset': { const s = S.sessions[S.mmSid]; if (!s || !mmCtl(s).mine) break; const ms = sessMatches(s.date); const ids = new Set(ms.map(x => x.id)); const evs = Object.keys(S.events).filter(k => ids.has(S.events[k].match)); const played = ms.filter(x => x.status !== 'pending').length;
      if (!confirm(`경기 셋팅을 처음으로 되돌릴까요?\n대진과 경기 시간 설정이 지워지고 처음부터 다시 정해요.${played || evs.length ? `\n\n⚠️ 진행한 경기 ${played}개와 기록된 골 ${evs.length}개도 모두 지워져요.` : ''}`)) break;
      if ((played || evs.length) && !confirm('정말 지울까요? 지운 기록은 되돌릴 수 없어요.')) break;
      const ok = await w(async () => { for (const k of evs) await S.store.del('events/' + k); for (const x of ms) await S.store.del(mp(x.id)); await S.store.update(sp(s.date), { mm: null }) }, '경기 셋팅을 초기화했어요. 대진부터 다시 정해 주세요.');
      if (ok) { S.mmStage = null; S.mmDraft = null; S.mmPairs = null; S.mmT = null; S.mmSel = null; S.mmOg = {}; render(); window.scrollTo(0, 0) } break }
    case 'mmsidesw': { const m = M(id); if (!m || m.status !== 'pending') break; await w(() => S.store.update(mp(id), { home: m.away, away: m.home }), '진영을 바꿨어요.'); break }
    case 'mmsel': S.mmSel = id || null; render(); break;
    case 'mmungoal': { const s = S.sessions[S.mmSid]; const m = (el.dataset.id && M(el.dataset.id)) || sessMatches(s.date).find(x => x.status === 'live'); if (!m) break; const k = el.dataset.k; const evs = Object.entries(S.events).filter(([, e]) => e.match === m.id && e.team === k).sort((a, b) => b[1].at - a[1].at); if (!evs.length) break;
      if (!confirm(`${team(s, k).name}의 마지막 골을 취소할까요?`)) break; await w(() => S.store.del('events/' + evs[0][0]), '골을 취소했어요.'); break }
    case 'mmgoal': { const s = S.sessions[S.mmSid]; const m = (el.dataset.id && M(el.dataset.id)) || sessMatches(s.date).find(x => x.status === 'live'); if (!m) break; await addGoal(m, el.dataset.k, null, null, false); try { navigator.vibrate?.(60) } catch { } break }
    case 'mselclear': S.msel = {}; render(); break;
    case 'mbulkdel': { if (!needAdmin()) break; const ids = Object.keys(S.msel || {}).filter(k => S.msel[k]); if (!ids.length) break;
      if (!confirm(`선택한 ${ids.length}명을 회원 명단에서 삭제할까요?\n${ids.slice(0, 8).map(pname).join(', ')}${ids.length > 8 ? ' …' : ''}\n지난 경기 기록의 이름은 "?"로 보일 수 있어요. 되돌릴 수 없어요.`)) break;
      if (await w(async () => { for (const id of ids) { await S.store.del('players/' + id); try { await S.store.del('contacts/' + id) } catch { } try { await S.store.del('auth/' + id) } catch { } } }, `${ids.length}명을 삭제했어요.`)) { S.msel = {}; render() } break }
    case 'ctxgo': if (!id) break; S.sid = id; S.planSel = id; S.planM = id.slice(0, 7); S.step = null; S.sel = null; S.openMatch = null; render(); break;
    case 'flowgo': S.tab = 'run'; S.step = el.dataset.v; S.sel = null; render(); window.scrollTo(0, 0); break;
    case 'goposter': S.sid = id; S.tab = 'notice'; S.noticeTab = 'team'; render(); window.scrollTo(0, 0); break;
    case 'gocap': S.sheet = null; S.sid = id; S.tab = 'draft'; render(); window.scrollTo(0, 0); break;
    case 'mview': S.mview = el.dataset.k; render(); break;
    case 'planday': S.planSel = id; if (S.sessions[id]) S.sid = id; render(); break;
    case 'planm': { const [yy, mm] = S.planM.split('-').map(Number); const d = new Date(yy, mm - 1 + (+el.dataset.d), 1); S.planM = `${d.getFullYear()}-${p2(d.getMonth() + 1)}`; S.schedYm = S.planM; render(); break }
    case 'caladdon': { if (!needAdmin()) break; const d = new Date(id + 'T00:00'); S.cal = { mode: 'add', y: d.getFullYear(), m: d.getMonth(), sel: [id], f: { time: DEFAULTS.time, venue: DEFAULTS.venue, capacity: DEFAULTS.capacity || 18, openD: DEFAULTS.openDays, openT: DEFAULTS.openTime, closeD: DEFAULTS.closeDays, closeT: DEFAULTS.closeTime, no: nextNoFor(id) } }; S.sheet = { type: 'cal' }; render(); break }
    case 'fillnos': if (!needAdmin()) break; await fillNos(); break;
    case 'login': { S.tab = S.tab && !ADMIN_TABS.includes(S.tab) ? S.tab : 'mhome'; const pid = await loginFlow(document.getElementById('lg-name')?.value, document.getElementById('lg-pin')?.value, document.getElementById('lg-auto')?.checked); if (pid) { document.activeElement?.blur(); toast(`${pname(pid)} 님, 반가워요!`); render(); window.scrollTo(0, 0) } break }
    case 'logout': if (confirm('로그아웃할까요?')) logout(); break;
    case 'pinchange': { const pid = myPid(); if (!pid) break; const p1 = prompt('새 비밀번호 (숫자 4자리)'); if (p1 === null) break; if (!/^\d{4}$/.test(p1)) { toast('숫자 4자리로 입력해 주세요.'); break } const p2x = prompt('새 비밀번호를 한 번 더 입력하세요'); if (p2x !== p1) { toast('두 번 입력한 번호가 달라요.'); break }
      const h = await pinHash(pid, p1); if (await w(() => S.store.set('auth/' + pid, { h, at: Date.now() }), '비밀번호를 바꿨어요.')) { S.auth = { pid, h }; saveAuth(S.auth, !!load('auth', null)); render() } break }
    case 'pinreset': { if (!needAdmin() || !confirm(`${pname(id)} 님의 비밀번호를 초기화할까요? 다음 로그인 때 새 번호를 등록하게 돼요.`)) break; await w(() => S.store.del('auth/' + id), '비밀번호를 초기화했어요.'); break }
    case 'schday': S.schSel = id; render(); break;
    case 'schm': { const [yy, mm] = (S.schM || S.schSel.slice(0, 7)).split('-').map(Number); const d = new Date(yy, mm - 1 + (+el.dataset.d), 1); S.schM = `${d.getFullYear()}-${p2(d.getMonth() + 1)}`; render(); break }
    case 'rdgo': if (!id) break; goResult(id); break;
    case 'gohome': S.tab = S.admin ? 'manage' : 'mhome'; S.sub = null; S.detail = null; S.openMatch = null; S.sheet = null; S.step = null; render(); window.scrollTo(0, 0); break;
    case 'ntab': S.noticeTab = el.dataset.k; render(); window.scrollTo(0, 0); break;
    case 'parkadd': { if (!needAdmin()) break; const sid = id; const nm = document.getElementById('pk-nm').value.trim(), car = document.getElementById('pk-cr').value.replace(/\s+/g, ''); if (!nm || !car) { toast('이름과 차량번호를 입력하세요.'); break }
      const pid = await ensurePlayer(nm); if (!pid) break; if (parkBanned(S.sessions[sid], pid) && !confirm(`${nm} 님은 지난 경기 주차 당첨자예요. 그래도 추가할까요?`)) break;
      await w(() => S.store.update(sp(sid), { [`park.${pid}`]: { car: car.slice(0, 12), at: Date.now(), manual: true } }), '주차 신청을 추가했어요.'); break }
    case 'parkdel': { if (!needAdmin()) break; const sid = S.sheet?.sid; if (!confirm(`${pname(id)} 님의 주차 신청을 지울까요?`)) break; const ss = S.sessions[sid]; await w(() => S.store.update(sp(sid), { [`park.${id}`]: null, parkWin: (ss.parkWin || []).filter(x => x !== id) })); break }
    case 'parkwin': { if (!needAdmin()) break; const sid = S.sheet?.sid; const ss = S.sessions[sid]; const wn = new Set(ss.parkWin || []); wn.has(id) ? wn.delete(id) : wn.add(id); await w(() => S.store.update(sp(sid), { parkWin: [...wn], parkDrawAt: ss.parkDrawAt || Date.now() })); break }
    case 'impopen': if (!needAdmin()) break; S.sheet = { type: 'import' }; render(); break;
    case 'impgo': { if (!needAdmin()) break; el.disabled = true; const ok = await importRecord(S.imp); el.disabled = false; if (ok) { S.sheet = null; S.imp = null; render() } break }
    case 'latecancel': if (!needAdmin()) break; await cancelApp(S.sid, id, null, true); break;
    case 'schedshare': case 'scheddl': { const ym = S.schedYm || defaultMonth(); const c = await drawSched(ym); const b = await new Promise(r => c.toBlob(r, 'image/png')); await shareBlob(b, `WF_일정_${ym.slice(0, 4)}년${+ym.slice(5)}월.png`, act === 'scheddl'); break }
    case 'dutyedit': if (!needAdmin()) break; S.sheet = { type: 'duty', sid: id }; render(); break;
    case 'dutytog': { if (!needAdmin()) break; const sid = el.dataset.sid || S.sheet?.sid; const ss = S.sessions[sid]; const kind = el.dataset.kind; const cur1 = new Set(ss.duty?.[kind] || []); cur1.has(id) ? cur1.delete(id) : cur1.add(id); await w(() => S.store.update(sp(sid), { [`duty.${kind}`]: [...cur1] })); break }
    case 'parkedit': if (!needAdmin()) break; S.sheet = { type: 'park', sid: id }; render(); break;
    case 'parkdraw': if (!needAdmin()) break; await drawParking(id); break;
    case 'parkapply': S.sheet = { type: 'parkapply', sid: id }; render(); break;
    case 'parksave': { const sid = S.sheet.sid; const me = myPid(); if (!me) { toast('먼저 이름을 입력해 주세요.'); break } if (await saveParking(sid, me, document.getElementById('pk-car2').value)) { S.sheet = null; render() } break }
    case 'parkcancel': { const me = myPid(); if (!me || !confirm('주차 신청을 취소할까요?')) break; await w(() => S.store.update(sp(id), { [`park.${me}`]: null }), '주차 신청을 취소했어요.'); break }
    case 'staffedit': if (!needAdmin()) break; S.sheet = { type: 'staffedit', sid: id }; render(); break;
    case 'staffsave': { const sid = S.sheet.sid; const res = await namesToIds(document.getElementById('se-res').value), ops = await namesToIds(document.getElementById('se-ops').value);
      if (await w(() => S.store.update(sp(sid), { p0: res, ops }), '저장했어요.')) { S.sheet = null; render() } break }
    case 'appname': { const ss = S.sessions[id]; const a = ss && myApp(ss); if (a) { S.sheet = { type: 'appname', sid: id, key: a.k }; render() } break }
    case 'appnamego': { const sh = S.sheet; let v = myPid() ? pname(myPid()) : (document.getElementById('an-name')?.value || ''); if (!v.trim()) { toast('이름을 입력해 주세요.'); break }
      if (!myPid()) { const pid0 = await loginFlow(v, document.getElementById('an-pin')?.value, document.getElementById('an-auto')?.checked); if (!pid0) break; v = pname(pid0) } const pkOn = document.getElementById('pk-on')?.checked, pkCar = document.getElementById('pk-car')?.value; if (pkOn && !(pkCar || '').trim()) { toast('주차 신청을 하려면 차량번호를 입력해 주세요.'); break }
      if (await setAppName(sh.sid, sh.key, v)) { if (pkOn) { const pid = findPlayer(v.replace(/\(\s*게\s*\)/g, '').trim()); if (pid) await saveParking(sh.sid, pid, pkCar) } S.sheet = null; render() } break }
    case 'appnameadmin': { if (!needAdmin()) break; const v = prompt('이 신청자의 이름을 입력하세요'); if (v && v.trim()) await setAppName(S.sid, id, v); break }
    case 'apprm': { if (!needAdmin()) break; await cancelApp(S.sid, el.dataset.pid || null, id, true, true); break }
    case 'tierset': { if (!needAdmin()) break; S.sheet = { type: 'tier', sid: S.sid, k: el.dataset.k }; render(); break }
    case 'tierpick': { if (!needAdmin()) break; const sh = S.sheet; if (!sh || sh.type !== 'tier') break; const v = el.dataset.v; const ss = S.sessions[sh.sid]; if (!ss || ss.stage !== 'apply') { toast('신청 단계에서만 순위를 바꿀 수 있어요.'); break }
      const r = classify(ss).rows.find(x => x.k === sh.k); const nm = r?.pid ? pname(r.pid) : '이 신청자'; const val = v === 'auto' ? null : +v;
      if (await w(() => S.store.update(sp(sh.sid), { [`tierOv.${sh.k}`]: val }))) { S.sheet = null; toast(val == null ? `${nm} 님 순위를 자동 계산으로 되돌렸어요.` : `${nm} 님을 ${TIER[val]}로 바꿨어요.`); render() } break }
    case 'p0toggle': { if (!needAdmin()) break; const p0 = new Set(s.p0 || []); p0.has(id) ? p0.delete(id) : p0.add(id); await w(() => S.store.update(sp(S.sid), { p0: [...p0] })); break }
    case 'colorpick': { const k = el.dataset.k; if (!(S.admin || myTeam(s) === k)) break; S.sheet = { type: 'colorpick', k }; render(); break }
    case 'colorset': { const k = S.sheet?.k, c = el.dataset.c; if (!k || !(S.admin || myTeam(s) === k)) break; const old = team(s, k).name; S.sheet = null; render();
      const ok = await w(() => S.store.txn(sp(S.sid), d => { if (!d) return null; if (KEYS.some(o => o !== k && d.teams?.[o]?.colorName === c)) return null; d.teams[k] = { ...(d.teams[k] || {}), colorName: c }; return d }));
      if (!ok) { toast('다른 팀이 쓰는 색이에요.'); break } if (old !== c) { sysChat(`${old} 팀이 ${c}(으)로 색을 바꿨어요.`); delete S.poster[S.sid] } break }
    case 'recolor': { const k = el.dataset.k; if (!(S.admin || myTeam(s) === k)) break; const old = team(s, k).name;
      const ok = await w(() => S.store.txn(sp(S.sid), d => { if (!d || d.ladder || d.cardgame || d.draftStatus !== 'ready') return null; d.teams[k] = { ...(d.teams[k] || {}), colorName: null }; return d }));
      if (!ok) { toast('순번 정하기가 시작돼서 색을 바꿀 수 없어요.'); break } sysChat(`${pname(s.captains?.[k])} 주장이 ${old} 색을 내려놓았어요. 다시 골라 주세요.`); break }
    case 'cardstart': if (!needAdmin()) break; await startCards(); break;
    case 'drawcard': await drawCard(+el.dataset.i); break;
    case 'reorder': S.sheet = null; if (!needAdmin() || !confirm('순번을 다시 정할까요?')) break; await resetOrder(); break;
    case 'coloropen': if (!needAdmin()) break; if (joinedCount(s) < 3 && !confirm('아직 모든 주장이 입장하지 않았어요. 그래도 색 선택을 시작할까요?')) break;
      if (await w(() => S.store.update(sp(S.sid), { 'room.colorOpen': true }))) sysChat('색 선택을 시작합니다. 주장님들 팀 색을 골라 주세요!'); break;
    case 'roommenu': S.sheet = { type: 'roommenu' }; render(); break;
    case 'stageback': if (!needAdmin()) break; await stageBack(el.dataset.v); break;
    case 'caladd2': S.sheet = { type: 'calpick', id }; render(); break;
    case 'calics': S.sheet = null; render(); await calDownload(id); break;
    case 'calgoo': S.sheet = null; render(); window.open(calGoogle(id), '_blank', 'noopener'); break;
    case 'rejguest': { const L = S.rejNames || []; S.rejNames = null; if (L.length) await addApplicants(L.map(n => n + '(게)')); else render(); break }
    case 'rejclose': S.rejNames = null; render(); break;
    case 'pdesign': { if (!needAdmin()) break; const kind = el.dataset.k, d = candList(kind)[+el.dataset.i]; if (!d) break; document.querySelectorAll(`.pth[data-k="${kind}"]`).forEach(b => b.classList.toggle('on', b === el)); toast('시안을 적용하는 중이에요…'); await applyDesign(kind, { ...d }); toast(`${dName(kind, d)} 시안으로 바꿨어요.`); render(); break }
    case 'pnew': { const kind = el.dataset.k; S.cand ??= {}; (S.candNew ??= {})[kind] = 1; const cd = kind === 'team' ? teamDesign(cur()) : schedDesign(); S.cand[kind] = [{ ...cd }, ...newDesigns(kind, 5)]; render(); break }
    case 'preset': { const kind = el.dataset.k; S.cand[kind] = DESIGN_PRESETS[kind].map(x => ({ ...x })); S.candNew[kind] = 0; render(); break }
    case 'pfont': { if (!needAdmin()) break; const kind = el.dataset.k || 'team', v = el.dataset.v; if (!POSTER_FONTS.some(x => x[0] === v)) break; document.querySelectorAll(`.pfo[data-k="${kind}"]`).forEach(b => b.classList.toggle('on', b.dataset.v === v)); toast('글꼴을 불러오는 중이에요…');
      const base = kind === 'team' ? teamDesign(cur()) : schedDesign(); const d = { ...base, font: v }; S.cand[kind] = candList(kind).map(x => ({ ...x, font: v })); await applyDesign(kind, d); toast(`${POSTER_FONTS.find(x => x[0] === v)[1]} 글꼴로 바꿨어요.`); render(); break }
    case 'apord': S.apord = el.dataset.v === 'time' ? 'time' : 'rank'; render(); break;
    case 'resv': S.resv = el.dataset.k; render(); break;
    case 'memv': S.memv = el.dataset.k; render(); window.scrollTo(0, 0); break;
    case 'attper': S.attPer = el.dataset.k; S.attOpen = null; render(); break;
    case 'attopen': S.attOpen = S.attOpen === id ? null : id; render(); break;
    case 'dutyn': { if (!needAdmin()) break; const ss = S.sessions[id]; const k = el.dataset.kind; const f = k === 'drink' ? 'drinkN' : 'ballN'; const v = Math.min(Math.max(1, participants(ss).length), Math.max(1, dutyN(ss, k) + (+el.dataset.d))); await w(() => S.store.update(sp(id), { [f]: v })); break }
    case 'dutydraw': { if (!needAdmin()) break; const k = el.dataset.kind; const sid0 = id; dutySpin(sid0, k, pick => w(() => S.store.update(sp(sid0), { [`duty.${k}`]: pick }), `${k === 'drink' ? '물당' : '공당'}: ${pick.map(pname).join(', ')}`)); break }
    case 'dutyboth': { if (!needAdmin()) break; const sid0 = id; dutySpin(sid0, 'ball', async b => { await w(() => S.store.update(sp(sid0), { 'duty.ball': b })); const ss = S.sessions[sid0]; ss.duty = { ...(ss.duty || {}), ball: b };
      dutySpin(sid0, 'drink', dk => w(() => S.store.update(sp(sid0), { 'duty.drink': dk }), `공당: ${b.map(pname).join(', ')} · 물당: ${dk.map(pname).join(', ')}`)) }); break }
    case 'presopen': S.presOpen = !S.presOpen; drawPres(); break;
    case 'attp': S.sheet = { type: 'attp', id }; render(); break;
    case 'attimp': if (!needAdmin()) break; S.attImp = {}; S.sheet = { type: 'attimp' }; render(); break;
    case 'attparse': { const text = document.getElementById('att-txt')?.value || '', total = document.getElementById('att-tot')?.value || ''; S.attImp = { text, total, res: attParse(text, total) }; render(); break }
    case 'attsave': { if (!needAdmin()) break; const r = S.attImp?.res; if (!r) break; const up = attUp(); const nx = { dates: { ...(up.dates || {}) }, base: { ...(up.base || {}) }, baseTotal: +up.baseTotal || 0, at: Date.now() };
      nx.named = { ...(up.named || {}) }; if (r.kind === 'summary') { nx.base = r.base; nx.baseTotal = r.baseTotal } else { const ds = new Set([...Object.keys(r.dates), ...Object.keys(r.named || {})]); ds.forEach(d => { nx.dates[d] = r.dates[d] || []; if ((r.named || {})[d]?.length) nx.named[d] = r.named[d]; else delete nx.named[d] }) }
      const ok = await w(() => S.store.set('meta/att', nx), '출석 기록을 저장했어요.'); if (ok) { S.meta = S.meta || {}; S.meta.att = nx; S.attImp = {}; S.sheet = null; render() } break }
    case 'attclear': { if (!needAdmin()) break; if (!confirm('올린 출석 기록을 모두 지울까요? 앱에서 진행한 경기 기록은 그대로 남아요.')) break; const ok = await w(() => S.store.set('meta/att', { dates: {}, named: {}, base: {}, baseTotal: 0, at: Date.now() }), '올린 기록을 지웠어요.'); if (ok) { S.meta.att = { dates: {}, named: {}, base: {}, baseTotal: 0 }; render() } break }
    case 'sheetping': try { const d = await sheetGet({ action: 'ping' }); S.sheetPing = true; S.sheetName = d?.name || ''; if (d?.url && !sheetCfg().view && S.admin) { await S.store.set('meta/sheet', { ...sheetCfg(), view: d.url, at: Date.now() }).catch(() => { }) } } catch { S.sheetPing = false } render(); break;
    case 'sheeturl': { if (!needAdmin()) break; const f = el.dataset.f; const cur = f === 'exec' ? sheetUrl() : sheetView();
      const v = prompt(f === 'exec' ? '기록 시트 웹 앱 주소 (Apps Script 배포 → 웹 앱 URL, …/exec 로 끝나요)\n비우면 기본 주소로 돌아가요.' : '기록 시트 원본 주소 (구글 시트를 열었을 때 주소창의 주소)\n비우면 링크가 사라져요.', cur); if (v == null) break; const t = v.trim();
      if (t && f === 'exec' && !/^https:\/\/script\.google\.com\/.+\/exec(\?.*)?$/.test(t)) { toast('웹 앱 주소는 https://script.google.com/…/exec 형식이어야 해요.'); break }
      if (t && f === 'view' && !/^https:\/\/docs\.google\.com\/spreadsheets\//.test(t)) { toast('구글 시트 주소(https://docs.google.com/spreadsheets/…)를 넣어 주세요.'); break }
      const nx = { ...sheetCfg(), [f]: t, at: Date.now() }; if (await w(() => S.store.set('meta/sheet', nx), t ? '시트 주소를 바꿨어요. 모든 운영진 기기에 적용돼요.' : '기본값으로 돌렸어요.')) { S.meta = S.meta || {}; S.meta.sheet = nx; S.sheetPing = null; S.sheetRecP = null; save('sheetRec', null); if (f === 'exec') save('sheetHash', {}); render() } break }
    case 'sheetkey': { if (!needAdmin()) break; const v = prompt('기록 시트의 연동 키를 입력하세요 (시트 메뉴 WD 기록 → 연동 키 보기)', sheetKey()); if (v == null) break; save('sheetKey', v.trim()); save('sheetHash', {}); toast(v.trim() ? '연동 키를 저장했어요.' : '연동 키를 지웠어요.'); render(); sheetAutoSync(); break }
    case 'sheetsum': try { await sheetPost({ action: 'rebuildSummary' }); toast('시트의 선수기록을 다시 계산했어요.') } catch (e) { toast('실패: ' + e.message) } break;
    case 'sheetmigrate': { if (!needAdmin()) break; if (!confirm('지금까지의 경기 기록과 출석부를 기록 시트로 옮길까요?\n이미 있는 날짜는 새 내용으로 바뀌어요.')) break;
      try { const t = today(); const ids = Object.keys(S.sessions).filter(id => id <= t && (S.sessions[id].stage === 'match' || S.sessions[id].draftStatus === 'done' || S.sessions[id].imported)).sort(); let n = 0;
        for (const sid of ids) { S.sheetMig = `경기 기록 옮기는 중… ${++n}/${ids.length} (${fmtDate(sid)})`; render(); await sheetSyncDate(sid) }
        const up = attUp(); const rows = []; const seen = new Set(ids);
        const addRows = (d, list, toName) => { if (seen.has(d)) return; (list || []).forEach(x => rows.push({ date: d, name: toName(x), pid: S.players[x] ? x : (attFind(toName(x)) || ''), type: '참석', source: 'import' })) };
        Object.entries(up.named || {}).forEach(([d, ns]) => addRows(d, ns, x => x)); Object.entries(up.dates || {}).forEach(([d, ps]) => addRows(d, ps, x => pname(x) || x));
        const uniq = {}; rows.forEach(r => uniq[r.date + '|' + r.name] = r); const all = Object.values(uniq);
        S.sheetMig = `지난 출석부 ${all.length}건 옮기는 중…`; render(); for (let i = 0; i < all.length; i += 400) await sheetPost({ action: 'importAttendance', rows: all.slice(i, i + 400), replace: i === 0 ? true : false });
        await sheetPost({ action: 'saveMembers', members: Object.entries(S.players).map(([pid, p]) => ({ pid, name: p.name, status: MSTAT[mstatus(p)] || '' })) });
        await sheetPost({ action: 'rebuildSummary' }); S.sheetMig = `✅ 옮기기 완료 · 경기 ${ids.length}회 · 지난 출석 ${all.length}건 · 회원 ${Object.keys(S.players).length}명`; loadSheetRec(true) } catch (e) { S.sheetMig = '⚠️ 옮기다가 멈췄어요: ' + e.message } render(); break }
    case 'rosters': S.sheet = { type: 'rosters', sid: id || S.sid }; render(); break;
    case 'finishdraft': await finishDraft(); break;
    case 'redodraft': if (!needAdmin()) break; await redoDraft(); break;
    case 'mergedups': if (!needAdmin()) break; await mergeDups(); break;
    case 'aview': S.aview = el.dataset.v === 'time' ? 'time' : 'rank'; render(); break;
    case 'pairedit': { if (!needAdmin()) break; S.pairDraft = {}; S.sheet = { type: 'pairs' }; render(); break }
    case 'pairswap': { const m = M(id); if (!m) break; const D = (S.pairDraft ??= {}); const [hh, aa] = D[id] || [m.home, m.away]; D[id] = [aa, hh]; render(); break }
    case 'pairsave': { if (!needAdmin()) break; await pairSave(); break }
    case 'ordedit': { if (!needAdmin()) break; const s0 = cur(); S.ordDraft = [...(s0.order || KEYS)]; S.sheet = { type: 'order' }; render(); break }
    case 'ordmv': { const i = +el.dataset.i, j = i + +el.dataset.d; const o = S.ordDraft; if (!o || j < 0 || j >= o.length) break; [o[i], o[j]] = [o[j], o[i]]; render(); break }
    case 'ordsave': { if (!needAdmin()) break; const s0 = cur(); const o = S.ordDraft; if (!o || o.length !== 3 || new Set(o).size !== 3) break;
      if (JSON.stringify(o) === JSON.stringify(s0.order || KEYS)) { S.sheet = null; S.ordDraft = null; render(); break }
      const ok = await w(() => S.store.txn(sp(S.sid), d => { if (!d || d.draftStatus !== 'live' || (d.picks || []).length || d.pending) return null; d.order = [...o]; return d }));
      if (ok) { S.sheet = null; S.ordDraft = null; sysChat(`운영진이 순번을 바꿨어요: ${o.map((t, n) => `${n + 1}번 ${team(s0, t).name}(${pname(s0.captains?.[t])})`).join(', ')}. 1순위부터 팀원을 골라요!`); toast('순번을 바꿨어요.'); render() } else toast('이미 지명이 시작돼서 바꿀 수 없어요.'); break }
    case 'chatlog': (S.chatSeen ??= {})[S.sid] = S.chat.length; S.sheet = { type: 'chatlog' }; render(); setTimeout(() => { const m = document.querySelector('.logsheet .msgs'); if (m) m.scrollTop = m.scrollHeight }, 0); break;
    case 'adminteam': S.adminTeam = el.dataset.k; render(); break;
    case 'openroom': if (!needAdmin()) break; if (!(await freezeApps(s))) break; await openRoom(); break;
    case 'joinroom': await joinRoom(el.dataset.k); break;
    case 'leaveroom': if (confirm('드래프트 채팅방에서 나갈까요?')) await leaveRoom(); break;
    case 'ladder': if (!needAdmin()) break; await runLadder(); break;
    case 'nextturn': { const s0 = cur(); const k = pickTeamAt(s0, (s0.picks || []).length); if (!(S.admin || (myTeam(s0) === k && s0.room?.[k]?.in))) { toast('내 차례에만 선택 완료를 누를 수 있어요.'); break } await nextTurn(); break }
    case 'resetroom': S.sheet = null; if (!needAdmin() || !confirm('드래프트를 처음(주장 입장)부터 다시 할까요? 지명 내역이 모두 지워져요.')) break; await openRoom(); break;
    case 'closenow': if (!needAdmin() || !confirm('지금 바로 신청을 마감할까요?')) break; await w(() => S.store.update(sp(S.sid), { applyClose: nowLocal() }), '신청을 마감했어요.'); break;
    case 'apply': await doApply(id, false); break;
    case 'applycancel': await doApply(id, true); break;
    case 'addsample': if (!needAdmin()) break; await addSampleManual(); break;
    case 'clearsample': if (!needAdmin()) break; await clearSample(); break;
    case 'mstat': S.mstat = el.dataset.k; render(); break;
    case 'madd': S.sheet = { type: 'madd' }; render(); break;
    case 'mbulk': S.sheet = { type: 'mbulk' }; render(); break;
    case 'mcsv': await exportMembersCSV(); break;
    case 'mdel': { const p = S.players[id]; if (!p || !confirm(`${p.name} 회원을 삭제할까요? 지난 경기 기록에는 "(삭제됨)"으로 남아요. 활동을 멈춘 회원은 삭제 대신 장불회원으로 바꾸는 걸 추천해요.`)) break;
      await w(async () => { await S.store.del('players/' + id); await S.store.del('contacts/' + id); try { await S.store.del('auth/' + id) } catch { } }, '삭제했어요.'); break }
    case 'maddgo': { const n = document.getElementById('ma-name').value.trim(); if (!n) { toast('이름을 입력하세요.'); break } if (findPlayer(n)) { toast('같은 이름의 회원이 이미 있어요.'); break }
      const ph = document.getElementById('ma-phone').value.trim(), memo = document.getElementById('ma-memo').value.trim(), st = document.getElementById('ma-st').value;
      if (await w(async () => { const nid = await S.store.add('players', { name: n.slice(0, 20), guest: st === 'guest', staff: st === 'staff', status: st, createdAt: Date.now() }); if (ph || memo) await S.store.set('contacts/' + nid, { phone: ph, memo }) }, `${n} 회원을 추가했어요.`)) { S.sheet = null; render() } break }
    case 'mbulkgo': { const list = parseMemberLines(document.getElementById('mb-txt').value); if (!list.length) { toast('이름을 찾지 못했어요.'); break } let n = 0;
      if (await w(async () => { for (const m of list) { await saveMember(m); n++ } })) { S.sheet = null; toast(`${n}명을 등록했어요.`); render() } break }
    case 'mfilter': S.mfilter = el.dataset.k; render(); break;
    case 'gorun': S.sid = id; S.tab = 'run'; S.step = el.dataset.step || null; S.sel = null; render(); window.scrollTo(0, 0); break;
    case 'gonotice': S.sid = id; S.tab = 'notice'; if (S.sessions[id]?.draftStatus === 'done') S.noticeTab = 'team'; else { S.noticeTab = 'month'; S.schedYm = id.slice(0, 7) } render(); window.scrollTo(0, 0); break;
    case 'delrow': S.sid = id; await deleteSessionBy(id); break;
    case 'caladd': { const d = new Date(); S.cal = { mode: 'add', y: d.getFullYear(), m: d.getMonth(), sel: [], f: { time: DEFAULTS.time, venue: DEFAULTS.venue, capacity: DEFAULTS.capacity || 18, openD: DEFAULTS.openDays, openT: DEFAULTS.openTime, closeD: DEFAULTS.closeDays, closeT: DEFAULTS.closeTime } }; S.sheet = { type: 'cal' }; render(); break }
    case 'calmove': { const [y, m] = id.split('-'); S.cal = { mode: 'move', from: id, y: +y, m: +m - 1, sel: [] }; S.sheet = { type: 'cal' }; render(); break }
    case 'calnav': { const c = S.cal; c.m += +el.dataset.d; if (c.m < 0) { c.m = 11; c.y-- } if (c.m > 11) { c.m = 0; c.y++ } render(); break }
    case 'calday': { const c = S.cal; if (c.mode === 'move') c.sel = [id]; else c.sel = c.sel.includes(id) ? c.sel.filter(x => x !== id) : [...c.sel, id]; if (c.mode !== 'move' && c.f && c.f.noAuto !== false) { const f0 = c.sel.slice().sort()[0]; c.f.no = f0 ? nextNoFor(f0) : '' } render(); break }
    case 'caladdgo': await addSessions(); break;
    case 'calmovego': await moveSession(); break;
    case 'copyrecruit': { const t = recruitText(S.tab === 'notice' && S.noticeTab === 'recruit' && S.sessions[S.nsid] ? S.sessions[S.nsid] : s); try { await navigator.clipboard.writeText(t); toast('모집 공지를 복사했어요.') } catch { prompt('아래 내용을 복사하세요', t.replace(/\n/g, ' / ')) } break }
    case 'pickcolor': { const c = el.dataset.c; const k = S.admin ? (S.adminTeam || el.dataset.k) : myTeam(s); if (!k) { toast(S.admin ? '먼저 어느 팀의 색인지 고르세요.' : '주장만 고를 수 있어요.'); break }
      if (!S.admin && s.room?.open && !s.room?.[k]?.in) { toast('먼저 입장해 주세요.'); break }
      if (!S.admin && s.room?.open && !s.room?.colorOpen && s.draftStatus === 'ready') { toast('운영진이 색 선택을 시작하면 고를 수 있어요.'); break }
      let all = false;
      const ok = await w(() => S.store.txn(sp(S.sid), d => { if (!d) return null; if (KEYS.some(o => o !== k && d.teams?.[o]?.colorName === c)) return null; d.teams = d.teams || {}; d.teams[k] = { ...(d.teams[k] || {}), colorName: c }; all = KEYS.every(o => d.teams?.[o]?.colorName); return d }));
      if (!ok) { toast('다른 팀이 먼저 고른 색이에요.'); break } S.adminTeam = null; sysChat(`${k}팀(${pname(s.captains?.[k])} 주장)은 이제 ${c}!`); if (all && s.room?.open && !s.ladder) sysChat('팀 색이 모두 정해졌어요. 사다리로 순번을 정해요!'); break }
    case 'sub': S.sub = el.dataset.v || null; S.detail = el.dataset.v === '' && S.tab === 'results' ? null : S.detail; render(); window.scrollTo(0, 0); break;
    case 'applist': if (el.dataset.id && S.sessions[el.dataset.id]) S.sid = el.dataset.id; S.tab = 'mhome'; S.sub = 'applist'; render(); window.scrollTo(0, 0); break;
    case 'result': S.tab = 'results'; S.detail = id; S.sub = null; render(); window.scrollTo(0, 0); break;
    case 'rank': S.rankKey = el.dataset.k; render(); break;
    case 'selswap': if (!needAdmin()) break; if (!S.sel) { S.sel = id; render(); break } if (S.sel === id) { S.sel = null; render(); break }
      { const a = S.sel; S.sel = null; if (KEYS.find(k => teamPlayers(s, k).includes(a)) === KEYS.find(k => teamPlayers(s, k).includes(id))) { S.sel = id; render(); break }
        if (confirm(`${pname(a)} ↔ ${pname(id)} 맞바꿀까요?`)) await swapPlayers(a, id); else render() } break;
    case 'share': sharePoster(false); break;
    case 'download': sharePoster(true); break;
    case 'copytext': try { await navigator.clipboard.writeText(noticeText(s)); toast('공지 텍스트를 복사했어요.') } catch { prompt('아래 내용을 복사하세요', noticeText(s)) } break;
    case 'mkmatches': if (!needAdmin()) break; await createMatches(); break;
    case 'open': S.openMatch = id; S.sheet = null; render(); document.querySelector('.overlay')?.scrollTo(0, 0); break;
    case 'close': S.openMatch = null; keepAwake(false); render(); break;
    case 'start': { const SW = startWhistleAt(.06); S.startBlown[m.id] = Date.now(); if (!SW.ok) whistle([.9]); await startClock(m, SW.at); break }
    case 'pause': await pauseClock(m); break;
    case 'reset': await resetClock(m); break;
    case 'end': if (confirm('경기를 종료하고 순위에 반영할까요?')) await endMatch(M(m.id)); break;
    case 'reopen': await w(() => S.store.update(mp(m.id), { status: 'live' })); break;
    case 'goal': await addGoal(m, el.dataset.team, null, null, false); try { navigator.vibrate?.(60) } catch { } break;
    case 'pickscorer': { const sh = S.sheet; if (id) { sh.scorer = id; sh.step = 'assist'; render(); break } S.sheet = null; render(); await addGoal(M(sh.match), sh.team, null, null, false); break }
    case 'pickog': { const sh = S.sheet; S.sheet = null; render(); await addGoal(M(sh.match), sh.team, null, null, true); break }
    case 'pickassist': { const sh = S.sheet; S.sheet = null; render(); await addGoal(M(sh.match), sh.team, sh.scorer, id || null, false); break }
    case 'delev': if (confirm('이 골 기록을 지울까요?')) await w(() => S.store.del('events/' + id)); break;
    case 'tstep': { const k = el.dataset.key, d = +el.dataset.d; const T = { ...timing(s) }; if (k === 'gk') T.gk = Math.min(30, Math.max(0, T.gk + d)); else T[k] = Math.min(45 * 60, Math.max(k === 'rest' ? 0 : 60, T[k] + d * 60)); await w(() => S.store.update(sp(S.sid), { timing: T })); break }
    case 'delmatches': { if (!needAdmin()) break; const ms = sessMatches(S.sid); if (!ms.length) break;
      const evs = Object.entries(S.events).filter(([, e]) => e.session === S.sid); const played = ms.filter(m => m.status !== 'pending').length;
      if (!confirm(`${fmtDate(S.sid)} 경기 대진 ${ms.length}경기를 삭제할까요?${evs.length || played ? `\n진행된 경기 ${played}개와 골 기록 ${evs.length}건도 함께 지워져요.` : ''}\n신청자와 팀 구성은 그대로 남아요.`)) break;
      if (played && prompt('기록이 있는 경기가 있어요. 정말 지우려면 "삭제"라고 입력하세요.') !== '삭제') { toast('삭제를 취소했어요.'); break }
      const ok = await w(async () => { for (const [eid] of evs) await S.store.del('events/' + eid); for (const m of ms) await S.store.del(mp(m.id)); await S.store.update(sp(S.sid), { stage: 'notice' }) }, '경기 대진을 삭제했어요.');
      if (ok) { S.openMatch = null; S.tab = 'run'; S.step = 'notice'; render(); window.scrollTo(0, 0) } break }
    case 'opmode': if (!S.admin && !canOp()) { toast('운영모드는 운영진·특별회원만 쓸 수 있어요.'); break } if (S.admin) { if (!confirm('운영모드를 끌까요?')) break; S.adminOn = false; stopAdminWatch(); save('admin', false); S.tab = 'mhome'; S.sid = null; S.step = null; S.openMatch = null; render(); window.scrollTo(0, 0); break }
      if (isMaster()) { S.sheet = null; S.adminOn = true; save('admin', true); S.tab = 'manage'; S.sid = null; S.step = null; S.openMatch = null; toast('운영모드로 전환했어요.'); render(); window.scrollTo(0, 0); break }
      { S.sheet = { type: 'adminpin' }; render(); setTimeout(() => document.getElementById('ap-pin')?.focus(), 60) } break;
    case 'adminpinok': { const pin = (document.getElementById('ap-pin')?.value || '').trim(); if (!(await adminPinOk(pin))) { toast('비밀번호가 달라요.'); const x = document.getElementById('ap-pin'); if (x) { x.value = ''; x.focus() } break }
        document.activeElement?.blur(); S.sheet = null; S.adminOn = true; save('admin', true); S.tab = 'manage'; S.sid = null; S.step = null; S.openMatch = null; toast('운영모드로 전환했어요.'); render(); window.scrollTo(0, 0) } break;
    case 'whistle': { S.whistle = !S.whistle; save('whistle', S.whistle); if (S.whistle) { audio(); whistle([.35]) } const lm = manLoad()?.matches?.find(x => x.status === 'live'); if (lm) manSchedule(lm); render(); break }
    case 'closesheet': document.activeElement?.blur?.(); S.sheet = null; render(); break;
  }
});

/* ───────── boot ───────── */
function watchChat() {
  if (S.chatSid === S.sid) return; S.unsubChat && S.unsubChat(); S.chat = []; S.chatSid = S.sid;
  if (!S.sid || !S.store) return; S.unsubChat = S.store.watchCol(sp(S.sid) + '/chat', docs => { S.chat = docs; render() }, { order: 'at', limit: 150 });
}
const ADMIN_TABS = ['manage', 'run', 'notice', 'members', 'settings'], MEMBER_TABS = ['draft', 'mhome', 'sched', 'results', 'mm', 'settings'];
function saveNav() { if (S.ready < 3) return; const n = { tab: S.tab, sid: S.sid, step: S.step, sub: S.sub, detail: S.detail, admin: S.admin };
  const k = JSON.stringify(n); if (k === S.lastNav) return; S.lastNav = k; try { sessionStorage.setItem('wf:nav', k) } catch { } save('nav', { ...n, at: Date.now() }) }
function restoreNav() {
  if (window.WF_FRESH) { if (S.adminOn) { S.adminOn = false; save('admin', false) } S.tab = 'mhome'; S.sub = null; S.detail = null; S.step = null; S.sid = null; return } // 앱을 새로 열면 항상 홈에서 시작
  let n = null; try { n = JSON.parse(sessionStorage.getItem('wf:nav') || 'null') } catch { } if (!n) { const l = load('nav', null); if (l && Date.now() - (l.at || 0) < 6 * 3600e3) n = l }
  if (!n || !!n.admin !== !!S.admin) return;
  if (!(S.admin ? ADMIN_TABS : MEMBER_TABS).includes(n.tab)) return;
  S.tab = n.tab; S.sid = n.sid || null; S.step = n.step || null; S.sub = n.sub || null; S.detail = n.detail || null;
}
function resumeCaptain() {
  if (S.admin) return; for (const [sid, l] of Object.entries(S.capLinks || {})) { const s = S.sessions[sid]; if (!s || s.draftStatus === 'done' && s.stage !== 'trade') continue;
    if (s.captainTokens?.[l.k] === l.t && (s.room?.open || s.draftStatus === 'live' || s.draftStatus === 'done') && sid >= today()) { if (S.tab !== 'settings') { S.sid = sid; S.tab = 'draft' } return } }
}
/* 모바일 키보드: 화면은 그대로 두고 입력창만 키보드 위로 */
(() => { const vv = window.visualViewport; if (!vv) return; const fix = () => { const kb = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)); document.documentElement.style.setProperty('--kb', kb + 'px'); document.body.classList.toggle('kb-on', kb > 80) };
  vv.addEventListener('resize', fix); vv.addEventListener('scroll', fix);
  document.addEventListener('focusin', e => { if (e.target?.id === 'chatin') setTimeout(() => { if (document.body.classList.contains('dm-on')) window.scrollTo(0, 0); fix() }, 60) });
  document.addEventListener('focusout', e => { if (e.target?.id === 'chatin') setTimeout(fix, 120) }) })();
let lastDesk = null; window.addEventListener('resize', () => { placeBall(); const d = isDesk(); if (d !== lastDesk) { lastDesk = d; render() } else if (document.querySelector('.dmroot')) { fitPool(); placeBubbles(); placeBall(); const ab = document.querySelector('.appbar'); if (ab) document.documentElement.style.setProperty('--abh', ab.offsetHeight + 'px') } });
document.addEventListener('gesturestart', e => e.preventDefault()); document.addEventListener('dblclick', e => { if (!isDesk()) e.preventDefault() }, { passive: false });
function goResult(id, dir) { const ids = pastSids(); const o = ids.indexOf(S.detail), n = ids.indexOf(id); S.rdAnim = dir || (n < o ? 'fromR' : 'fromL'); S.detail = id; render(); window.scrollTo(0, 0); setTimeout(() => { S.rdAnim = '' }, 350) }
/* pull-to-refresh (home-screen apps have no browser refresh) */
let ptr = null; const PTR_GO = 72;
function ptrEl() { let e = document.getElementById('ptr'); if (!e) { e = document.createElement('div'); e.id = 'ptr'; e.innerHTML = '<i>↓</i><span>당겨서 새로고침</span>'; document.body.appendChild(e) } return e }
function scrolledParent(t) { for (let el = t; el && el !== document.body; el = el.parentElement) { if (el.scrollTop > 0 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) return true } return false }
document.addEventListener('touchstart', e => { ptr = null; if (e.touches.length !== 1 || S.sheet || S.fs || window.scrollY > 0) return; if (S.tab === 'mm' && ((S.mmSid && sessMatches(S.mmSid).some(m => m.status === 'live')) || manLoad()?.matches?.some(m => m.status === 'live'))) return; const t = e.target; if (t.closest('.scrim,input,textarea,select,.mm-cd') || scrolledParent(t)) return;
  ptr = { y: e.touches[0].clientY, x: e.touches[0].clientX, d: 0 } }, { passive: true });
document.addEventListener('touchmove', e => { if (!ptr) return; const dy = e.touches[0].clientY - ptr.y, dx = e.touches[0].clientX - ptr.x;
  if (ptr.d === 0 && (Math.abs(dx) > Math.abs(dy) || dy < 0)) { ptr = null; return } if (window.scrollY > 0) { ptr = null; return }
  ptr.d = Math.max(0, dy); const el = ptrEl(); const pull = Math.min(110, ptr.d * .55); el.style.transform = `translate(-50%, ${pull}px)`; el.style.opacity = Math.min(1, ptr.d / 40);
  el.classList.toggle('ready', ptr.d * .55 >= PTR_GO); el.querySelector('span').textContent = ptr.d * .55 >= PTR_GO ? '놓으면 새로고침' : '당겨서 새로고침' }, { passive: true });
document.addEventListener('touchend', () => { if (!ptr) return; const go = ptr.d * .55 >= PTR_GO; ptr = null; const el = document.getElementById('ptr'); if (!el) return;
  if (go) { el.classList.add('loading'); el.querySelector('span').textContent = '새로고침 중…'; el.style.transform = 'translate(-50%, 70px)'; setTimeout(() => location.reload(), 250) }
  else { el.style.transform = 'translate(-50%, 0)'; el.style.opacity = 0; el.classList.remove('ready') } }, { passive: true });
let swX = null, swY = null, swT = 0, swMode = null;
const NOSWIPE = '.sheetwrap,.tblwrap,.pool,.namegrid,.mm-list,.cd-log,.msgs,.scrim,input,textarea,select,.cswatch,.ocards,.board-table,.aflow,.planwrap .scgrid';
document.addEventListener('touchstart', e => { swX = null; if (e.touches.length !== 1) return; const t = e.target;
  if (t.closest('.rdswipe')) swMode = 'result'; else if (!S.sheet && S.tab !== 'mm' && !t.closest(NOSWIPE) && !t.closest('.tabs')) swMode = 'tab'; else return;
  swX = e.touches[0].clientX; swY = e.touches[0].clientY; swT = Date.now() }, { passive: true });
document.addEventListener('touchend', e => { if (swX == null) return; const dx = e.changedTouches[0].clientX - swX, dy = e.changedTouches[0].clientY - swY, dt = Date.now() - swT; swX = null;
  if (swMode === 'result') { if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return; const ids = pastSids(); const i = ids.indexOf(S.detail);
    if (dx < 0 && ids[i - 1]) goResult(ids[i - 1], 'fromR'); else if (dx > 0 && ids[i + 1]) goResult(ids[i + 1], 'fromL'); else if (dt < 700 && Math.abs(dx) >= 70) swipeTab(dx < 0 ? 1 : -1); return }
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8 || dt > 700) return; swipeTab(dx < 0 ? 1 : -1) }, { passive: true });
function swipeTab(dir) {
  if (isDesk() || (!S.admin && !S.auth)) return; const order = [...document.querySelectorAll('.tabs [data-act=tab]')].map(b => b.dataset.v); if (order.length < 2) return;
  const i = order.indexOf(S.tab); const j = i < 0 ? 0 : i + dir; if (j < 0 || j >= order.length) return;
  S.tab = order[j]; S.sub = null; S.detail = S.tab === 'results' ? S.detail : null; S.step = S.admin && S.tab === 'run' ? S.step : S.step; S.swAnim = dir > 0 ? 'fromR' : 'fromL'; render(); window.scrollTo(0, 0);
  setTimeout(() => { S.swAnim = '' }, 350);
}
(async function boot() {
  setTimeout(nativeSetup, 1500);
  S.auth = loadAuth();
  restoreNav();
  const q = new URLSearchParams(location.search);
  if (q.get('d') && q.get('c') && q.get('t')) { S.capLinks[q.get('d')] = { k: q.get('c'), t: q.get('t') }; save('caplinks', S.capLinks); S.sid = q.get('d'); S.tab = 'draft'; S.adminOn = S.adminOn && false; S.pendingLink = q.get('d'); history.replaceState(null, '', location.pathname) }
  render();
  let why = '';
  try { S.store = (window.claude && await artifactStore()) || (CFG.firebase?.apiKey ? await firebaseStore(CFG.firebase) : null); if (!S.store) why = 'config.js에 Firebase 설정값(apiKey 등)이 비어 있어요.' }
  catch (e) { console.error(e); const c = e?.code || '';
    why = c === 'auth/operation-not-allowed' || c === 'auth/admin-restricted-operation' ? 'Firebase Authentication에서 익명 로그인이 꺼져 있어요.'
      : c === 'auth/invalid-api-key' || c === 'auth/api-key-not-valid.-please-pass-a-valid-api-key.' ? 'config.js의 apiKey 값이 올바르지 않아요.'
      : c === 'auth/unauthorized-domain' ? `Firebase 승인된 도메인에 ${location.hostname}을 추가해 주세요.`
      : `오류 코드: ${c || e?.message || '알 수 없음'}` }
  if (!S.store) { hideBoot(); S.err = '데이터 서버에 연결하지 못했어요. ' + why; S.ready = 3; render(); return }
  const onErr = e => { const c = e?.code || ''; hideBoot(); S.err = '데이터를 불러오지 못했어요. ' + (c === 'permission-denied' ? 'Firestore 규칙이 게시되지 않았거나 익명 로그인이 꺼져 있어요.' : c === 'not-found' || /does not exist/i.test(e?.message || '') ? 'Firestore Database가 아직 만들어지지 않았어요.' : `오류 코드: ${c || e?.message || '알 수 없음'}`); S.ready = 3; render() };
  let posterT; const sub = (p, key) => { let first = true; S.store.watchCol(p, docs => { const o = {}; docs.forEach(d => { const { id, ...rest } = d; o[id] = rest }); S[key] = o; if (first) { first = false; S.ready++; if (S.ready === 3) { setTimeout(maybeSeed, 300); verifyAuth(); syncClock(); setInterval(syncClock, 5 * 60 * 1000) } }
    if (key === 'sessions' && !S.resumed) { S.resumed = true; if (!S.pendingLink) { if (S.sid && !S.sessions[S.sid]) S.sid = null; if (S.tab !== 'draft' || !myTeam(S.sessions[S.sid])) resumeCaptain() } }
    if (key === 'sessions' && S.pendingLink) { const sid = S.pendingLink; S.pendingLink = null; S.sid = S.sessions[sid] ? sid : null; if (!S.sessions[sid] || !myTeam(S.sessions[sid])) { toast('만료되었거나 잘못된 주장 링크예요. 운영진에게 새 링크를 받아 주세요.'); S.tab = 'mhome' } else toast(`${team(S.sessions[sid], myTeam(S.sessions[sid])).name} 주장으로 드래프트에 참여해요.`) }
    if (key === 'sessions' && S.tab === 'notice' && S.admin) S.schedImg = {};
    if (key === 'sessions' && S.sid && (S.tab === 'notice' || S.sub === 'poster')) { clearTimeout(posterT); posterT = setTimeout(refreshPoster, 300) }
    renderSoon() }, null, onErr) };
  sub('players', 'players'); sub('sessions', 'sessions'); const CUT = (() => { const d = new Date(); d.setDate(d.getDate() - 90); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` })(); S.cut = CUT;
  { let first = true; S.store.watchCol('matches', docs => { const o = { ...(S.oldMatches || {}) }; docs.forEach(d => { const { id, ...rest } = d; o[id] = rest }); S.matches = o; if (first) { first = false; S.ready++; if (S.ready === 3) { setTimeout(maybeSeed, 300); verifyAuth(); syncClock(); setInterval(syncClock, 5 * 60 * 1000) } } renderSoon() }, { where: [['session', '>=', CUT]] }, onErr) }
  S.store.watchCol('meta', docs => { const o = {}; docs.forEach(d => { const { id, ...r } = d; o[id] = r }); S.meta = o; try { const L = Object.keys(o).filter(k => /^bootbg(_\d+)?$/.test(k)).sort().map(k => o[k]?.img).filter(Boolean).slice(0, 5); const js = JSON.stringify(L); if (L.length) { if (localStorage.getItem('wf:bootbgs') !== js) localStorage.setItem('wf:bootbgs', js) } else localStorage.removeItem('wf:bootbgs'); localStorage.removeItem('wf:bootbg') } catch { } if (S.tab === 'notice' && S.admin) { S.schedImg = {}; refreshSchedule() } }, null, () => { });
  S.store.watchCol('events', docs => { const o = { ...(S.oldEvents || {}) }; docs.forEach(d => { const { id, ...rest } = d; o[id] = rest }); S.events = o; renderSoon() }, { where: [['session', '>=', S.cut]] }, onErr);
  if (!IS_ARTIFACT && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => { });
})();
