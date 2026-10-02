/* WD_FUTSAL — 신청 · 주장 · 드래프트 · 교환 · 공지 이미지 · 경기 기록 */
const CFG = window.WF_CONFIG || {};
const KEYS = ['A', 'B', 'C'];
const PAIRS = [['A', 'B'], ['B', 'C'], ['C', 'A']];
const STAGES = [['apply', '신청'], ['captain', '주장'], ['draft', '드래프트'], ['trade', '밸런스 조정'], ['notice', '공지'], ['match', '경기']];
const APP_VERSION = '0.21.6';
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
  const app = initializeApp(cfg);
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
  adminOn: load('admin', false), me: load('me', ''), auth: null, schedSig: {}, startBlown: {}, capLinks: load('caplinks', {}), linkErr: '', whistle: load('whistle', true),
  prev: {}, pending: false, poster: {}, pasteApply: ''
};

/* ───────── helpers ───────── */
const p2 = n => String(n).padStart(2, '0');
function nowLocal() { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}` }
function today() { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
function inkOn(hex) { const h = (hex || '#888888').replace('#', ''); const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16); return (0.299 * r + 0.587 * g + 0.114 * b) > 165 ? '#131C2B' : '#FFFFFF' }
const DOW = '일월화수목금토';
function dow(id) { const [y, m, d] = id.split('-'); return DOW[new Date(+y, +m - 1, +d).getDay()] }
function fmtDate(id) { const [, m, d] = id.split('-'); return `${+m}월 ${+d}일 (${dow(id)})` }
function fmt(s) { s = Math.max(0, s); return p2(Math.floor(s / 60)) + ':' + p2(Math.floor(s % 60)) }
function pname(id) { if (!id) return '미지정'; const p = S.players[id]; if (!p) return '(삭제됨)'; return p.name + (p.guest ? '(게)' : '') }
function team(s, k) { const t = s?.teams?.[k] || {}; const p = PALETTE.find(x => x.name === t.colorName); if (p) return { name: p.name, color: p.color, picked: true };
  return { name: k + '팀', color: NEUTRAL[k], picked: false } }
function allPicked(s) { return KEYS.every(k => team(s, k).picked) }
function bib(c) { return `<span class="bib" style="background:${c}"></span>` }
function tag(t) { return `<span class="teamtag" style="background:${t.color};color:${inkOn(t.color)}">${esc(t.name)}</span>` }
function timing(s) { return { ...DEF_TIMING, ...(s?.timing || {}) } }
function cur() { return S.sid ? S.sessions[S.sid] : null }
function stageIdx(st) { return STAGES.findIndex(x => x[0] === st) }
let toastT; function toast(t) { document.querySelectorAll('.toast').forEach(x => x.remove()); const d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = t; document.body.appendChild(d); clearTimeout(toastT); toastT = setTimeout(() => d.remove(), 2600) }
function needAdmin() { if (!S.admin) { toast('운영진만 할 수 있어요.'); return false } return true }
function rand() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let o = ''; for (let i = 0; i < 6; i++) o += A[Math.floor(Math.random() * A.length)]; return o }
const EMBLEM_SRC = window.WF_EMBLEM || 'assets/emblem.png';
const IS_ARTIFACT = !!window.WF_ARTIFACT;
function findCode(code) { code = (code || '').trim().toUpperCase(); for (const [sid, s] of Object.entries(S.sessions)) for (const k of KEYS) if (s.captainTokens?.[k] && s.captainTokens[k] === code) return { sid, k }; return null }
function myTeam(s) { if (!s) return null; const me = myPid(); if (me) { const k = KEYS.find(k => s.captains?.[k] === me); if (k) return k } const l = S.capLinks[s.date || S.sid]; if (!l) return null; return s.captainTokens?.[l.k] && s.captainTokens[l.k] === l.t ? l.k : null }
function byName(ids) { return [...ids].sort((a, b) => pname(a).localeCompare(pname(b), 'ko')) }
function viewSid() { const me = myPid(); if (!me) return null; const t = today(); return Object.keys(S.sessions).sort().find(id => { const s = S.sessions[id]; return id >= t && (s.viewers || []).includes(me) && (s.draftStatus !== 'done' || s.stage === 'trade') }) || null }
function capSid() { const me = myPid(); if (!me) return null; const t = today(); return Object.keys(S.sessions).sort().find(id => { const s = S.sessions[id]; return id >= t && KEYS.some(k => s.captains?.[k] === me) && (s.draftStatus !== 'done' || s.stage === 'trade') }) || null }
function capLink(sid, k, t) { return `${location.origin}${location.pathname}?d=${sid}&c=${k}&t=${t}` }
function canMom(s, k) { return S.admin || myTeam(s) === k }
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
async function ocrWorker(onProg) { if (OCR_W) return OCR_W; await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
  OCR_W = await window.Tesseract.createWorker('kor', 1, { logger: m => { if (m.status === 'recognizing text') onProg?.(m.progress) } }); return OCR_W }
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
  const ok = await w(() => S.store.txn(sp(sid), d => { if (!d || d.stage !== 'apply') return null; const merged = appsOf({ ...d, date: sid }); const base = Array.isArray(d.apps) ? [...d.apps] : appsOf0(d);
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
function score(m) { let h = 0, a = 0; for (const e of Object.values(S.events)) { if (e.match !== m.id) continue; if (e.team === m.home) h++; else if (e.team === m.away) a++ } return [h, a] }
function elapsed(m) { const t = m.timer || {}; return (t.acc || 0) + (t.running && t.startedAt ? Math.max(0, (Date.now() - t.startedAt) / 1000) : 0) }
function prevMatch(m) { return sessMatches(m.session).filter(x => x.n < m.n).pop() || null }
function clockInfo(m) {
  const T = timing(S.sessions[m.session]); const run = !!m.timer?.running; const e = elapsed(m);
  const a = T.h1, b = a + T.gk, c = b + T.h2; const ps = !run && m.status === 'live' ? ' 일시정지' : '';
  if (m.status === 'done') return { label: '종료', time: fmt(Math.min(e, c)), phase: 'done', e, a, b, c };
  if (m.status === 'pending' && !run && e < .5) {
    const pr = prevMatch(m);
    if (pr && pr.status === 'done' && pr.endedAt) { const restEnd = pr.endedAt + T.rest * 1000; const r = (restEnd - Date.now()) / 1000;
      if (r > 0) return { label: '휴식', time: fmt(Math.ceil(r)), phase: 'rest', e, a, b, c, restEnd };
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
function playerStats() {
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
function mmHeartbeat() { const s = S.sessions[S.mmSid]; if (!s || document.hidden || !mmCtl(s).mine) return; if (Date.now() - (S.mmBeat || 0) < 20000) return; S.mmBeat = Date.now(); S.store.update(sp(S.mmSid), { 'mmCtl.beat': Date.now() }).catch(() => { }) }
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
    const sch = !!S.schedSig[m.id]; if ((prev === 'ready' || prev === 'rest') && ci.phase === 'h1' && e < 3) { if (!(S.startBlown[m.id] && Date.now() - S.startBlown[m.id] < 5000)) whistle([.9]) }
    else if (sch && ['gk', 'h2', 'full'].includes(ci.phase)) { }
    else if (prev === 'h1' && ci.phase === 'gk' && e - ci.a < 3) whistle([.3, .3]);
    else if (prev === 'gk' && ci.phase === 'h2' && e - ci.b < 3) whistle([.9]);
    else if (prev === 'h2' && ci.phase === 'full' && e - ci.c < 3) whistle([.3, .3, 1.3]);
    else if (prev === 'rest' && ci.phase === 'ready' && ci.restEnd && Date.now() - ci.restEnd < 3000) whistle([.6, .6]) }
}

/* ───────── actions ───────── */
function findPlayer(name) { const n = name.trim(); return Object.entries(S.players).find(([, p]) => p.name === n)?.[0] || null }
async function ensurePlayer(raw) {
  const guest = /\(\s*게\s*\)/.test(raw); const name = raw.replace(/\(\s*게\s*\)/g, '').trim().slice(0, 20); if (!name) return null;
  const ex = findPlayer(name); if (ex) return ex;
  const id = await S.store.add('players', { name, guest, createdAt: Date.now() }); S.players[id] = { name, guest }; return id;
}
async function createSession(f) {
  const sid = f.date; if (S.sessions[sid]) { toast('그 날짜의 경기일이 이미 있어요.'); S.sid = sid; S.step = null; S.tab = 'home'; render(); return }
  const defOpen = shiftDate(sid, DEFAULTS.openDays, DEFAULTS.openTime), defClose = shiftDate(sid, DEFAULTS.closeDays, DEFAULTS.closeTime);
  const doc = { date: sid, time: f.time || DEFAULTS.time, venue: f.venue || DEFAULTS.venue, evpw: f.evpw || '', notice: f.notice ?? DEFAULTS.notice,
    capacity: +f.capacity || DEFAULTS.capacity || 18, applyOpen: f.applyOpen || defOpen, applyClose: f.applyClose || defClose,
    stage: 'apply', applicants: [], captains: { A: null, B: null, C: null }, order: [...KEYS], picks: [], draftStatus: 'ready',
    teams: { A: { players: [] }, B: { players: [] }, C: { players: [] } }, timing: DEF_TIMING, mom: {}, createdAt: Date.now() };
  if (await w(() => S.store.set(sp(sid), doc), '경기일을 만들었어요.')) { S.sid = sid; S.step = 'apply'; S.sheet = null; render() }
}
async function setStage(st) { const s = cur(); if (stageIdx(st) > stageIdx(s.stage)) await w(() => S.store.update(sp(S.sid), { stage: st })); if (st === 'notice') { S.tab = 'run'; S.step = 'trade'; render(); window.scrollTo(0, 0); return } S.step = st; render(); window.scrollTo(0, 0) }
async function addApplicants(names) {
  const s = cur(); const ids = [], rejected = [];
  for (const nm of names) { const guest = /\(\s*게(스트)?\s*\)/.test(nm); const name = nm.replace(/\(\s*게(스트)?\s*\)/g, '').trim(); if (!name) continue;
    const ex = findPlayer(name); if (ex) { ids.push(ex); continue }
    if (!guest) { rejected.push(name); continue } const id = await ensurePlayer(nm); if (id) ids.push(id) }
  if (rejected.length) toast(`회원 명단에 없는 이름이에요: ${rejected.join(', ')}. 이름을 확인하거나, 게스트면 이름 뒤에 (게)를 붙여 주세요.`);
  if (!ids.length) { render(); return }
  if (s.stage === 'apply') { let n = 0; await w(() => S.store.txn(sp(S.sid), d => { const apps = appsOf(d); n = 0; for (const id of ids) if (!apps.some(a => a.pid === id)) { apps.push({ k: rand() + rand(), pid: id, uid: 'admin', at: nowS() }); n++ } d.apps = apps; return d }), rejected.length ? null : `${ids.length}명을 반영했어요.`); render(); return }
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
async function startClock(m) { audio(); await w(() => S.store.update(mp(m.id), { status: 'live', timer: { running: true, startedAt: Date.now(), acc: m.timer?.acc || 0 } })) }
async function pauseClock(m) { await w(() => S.store.update(mp(m.id), { timer: { running: false, startedAt: 0, acc: Math.floor(elapsed(m)) } })) }
async function resetClock(m) { if (!confirm('타이머를 처음으로 되돌릴까요?')) return; await w(() => S.store.update(mp(m.id), { timer: { running: false, startedAt: 0, acc: 0 } })) }
async function endMatch(m) { await w(() => S.store.update(mp(m.id), { status: 'done', endedAt: Date.now(), timer: { running: false, startedAt: 0, acc: Math.floor(elapsed(m)) } }), '경기를 종료했어요.') }
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
  ['PretendardH', '100 900', 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/woff2/Pretendard-ExtraBold.woff2']];
function loadWebFonts() {
  if (S.wfonts) return S.wfonts;
  S.wfonts = (async () => { const ok = {};
    await Promise.all(FONT_FILES.map(async ([fam, wt, url]) => { try { const f = new FontFace(fam, `url(${url}) format('woff2')`, { weight: wt, display: 'block' }); await Promise.race([f.load(), new Promise((_, rej) => setTimeout(() => rej('timeout'), 6000))]); document.fonts.add(f); ok[fam] = true } catch { } }));
    return ok })();
  return S.wfonts;
}
async function posterFonts(texts) {
  const ok = await loadWebFonts(); const fb = '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';
  const H = ok.PaperlogyH ? '"PaperlogyH"' : ok.PretendardH ? '"PretendardH"' : '"Black Han Sans"', B = ok.Pretendard ? '"Pretendard"' : '"IBM Plex Sans KR"';
  const all = [...new Set((texts || []).join(' ') + ' 0123456789월화수목금토일요일회차일시장소신청예약자구장비밀번호공지')].join('');
  try { await Promise.all([`900 80px ${H}`, `800 60px ${H}`, `400 40px ${B}`, `700 40px ${B}`, `80px "Anton"`].map(f => document.fonts.load(f, all))) } catch { }
  return { LAT: `"Anton",${H},Impact,sans-serif`, KR: `${H},${fb}`, BD: `${B},${fb}`, H, B };
}
async function drawPoster(s) {
  const W = 1086, H = 1448; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const PF = await posterFonts([s.venue || '', s.notice || '', s.evpw || '', ...KEYS.flatMap(k => teamPlayers(s, k).map(pname)), ...KEYS.map(k => team(s, k).name)]);
  const img = await emblem(); const LAT = PF.LAT, KR = PF.KR;
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
  // headline
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#fff';
  g.font = `44px ${LAT}`; const club = (CFG.club?.name || 'WEEKDAYS FUTSAL CLUB').toUpperCase(); const cw = g.measureText(club).width; g.fillText(club, W / 2, 72);
  g.fillRect(175, 50, W / 2 - cw / 2 - 195, 4); g.fillRect(W / 2 + cw / 2 + 20, 50, W / 2 - cw / 2 - 195, 4);
  g.font = `172px ${LAT}`; const tW = g.measureText('MATCH DAY').width; g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowOffsetY = 6; g.shadowBlur = 14; g.lineWidth = 10; g.strokeStyle = '#0A0F1E'; g.lineJoin = 'round'; g.strokeText('MATCH DAY', W / 2, 212); g.fillStyle = '#FFFFFF'; g.fillText('MATCH DAY', W / 2, 212); g.restore();
  g.fillStyle = '#fff'; const sideL = W / 2 - tW / 2 - 20; if (sideL > 60) { g.fillRect(24, 136, sideL - 24, 4); g.fillRect(W - sideL, 136, sideL - 24, 4) }
  g.fillRect(24, 236, W / 2 - 84, 4); g.fillRect(W / 2 + 60, 236, W / 2 - 84, 4);
  badge(g, img, W / 2, 238, 48);
  // date line
  const [, mm, dd] = s.date.split('-'); const parts = [[`${mm}.${dd}. `, '#fff'], [dow(s.date) + '요일', '#FFD600'], [`  ${s.time || ''}`, '#fff']];
  g.font = `96px ${KR}`; const tw = parts.reduce((a, [t]) => a + g.measureText(t).width, 0); let x = W / 2 - tw / 2; g.textAlign = 'left';
  for (const [t, col] of parts) { g.save(); g.lineWidth = 12; g.strokeStyle = '#0A0F1E'; g.lineJoin = 'round'; g.strokeText(t, x, 362); g.fillStyle = col; g.fillText(t, x, 362); g.restore(); x += g.measureText(t).width }
  g.textAlign = 'center'; fitFont(g, s.venue || '', `{s}px ${KR}`, 72, W - 120); g.save(); g.lineWidth = 11; g.strokeStyle = '#0A0F1E'; g.lineJoin = 'round'; g.strokeText(s.venue || '', W / 2, 448); g.fillStyle = '#fff'; g.fillText(s.venue || '', W / 2, 448); g.restore();
  // team cards
  const top = 472, bot = 1186, gap = 14, cwid = (W - 48 - gap * 2) / 3; const lists = KEYS.map(k => teamPlayers(s, k)); const rows = Math.max(6, ...lists.map(l => l.length));
  KEYS.forEach((k, i) => { const t = team(s, k); const x0 = 24 + i * (cwid + gap); const ink = inkOn(t.color);
    g.save(); rr(g, x0, top, cwid, bot - top, 16); g.fillStyle = t.color; g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 16; g.fill(); g.restore();
    g.save(); rr(g, x0, top, cwid, bot - top, 16); g.lineWidth = 4; g.strokeStyle = ink === '#FFFFFF' ? (i === 0 ? '#4FB2FF' : 'rgba(255,255,255,.85)') : 'rgba(0,0,0,.55)'; g.stroke(); g.restore();
    badge(g, img, x0 + 68, top + 76, 50);
    g.fillStyle = ink; g.textAlign = 'left'; fitFont(g, t.name, `{s}px ${LAT}`, 66, cwid - 138); g.fillText(t.name, x0 + 128, top + 100);
    g.fillRect(x0 + 24, top + 144, cwid - 48, 4);
    const avail = bot - top - 190, step = Math.min(84, avail / rows), fs = Math.min(50, step * .66); g.textAlign = 'center';
    lists[i].forEach((pid, j) => { const nm = pname(pid); const y = top + 190 + step * j + step * .62; const f = fitFont(g, nm, `{s}px ${KR}`, fs, cwid - 70); g.fillText(nm, x0 + cwid / 2 - (j === 0 ? 18 : 0), y);
      if (j === 0 && captainOf(s, k) === pid) { const nw = g.measureText(nm).width; crown(g, x0 + cwid / 2 - 18 + nw / 2 + 10, y - f * .78, f * .8) } });
  });
  // info bar
  const by = 1212, bh = 176; g.save(); rr(g, 24, by, W - 48, bh, 16); g.fillStyle = 'rgba(8,10,16,.93)'; g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke(); g.restore();
  g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(24, by + bh / 2 - 1.5, W - 48, 3);
  const r1 = by + bh / 4, r2 = by + bh * 3 / 4; g.textBaseline = 'middle';
  // lock icon
  g.fillStyle = '#fff'; rr(g, 70, r1 - 12, 44, 36, 6); g.fill(); g.lineWidth = 7; g.strokeStyle = '#fff'; g.beginPath(); g.arc(92, r1 - 14, 14, Math.PI, 0); g.stroke(); g.fillStyle = '#111'; g.fillRect(89, r1 - 2, 6, 14);
  g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `40px ${LAT}`; g.fillText('E/V Password', 144, r1 + 2); const d1 = 144 + g.measureText('E/V Password').width + 26; g.fillRect(d1, r1 - 26, 3, 52);
  g.fillStyle = '#FFD600'; fitFont(g, s.evpw || '-', `{s}px ${LAT}`, 72, W - 48 - d1 - 40); g.fillText(s.evpw || '-', d1 + 34, r1 + 4);
  // megaphone
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(70, r2 - 10); g.lineTo(88, r2 - 10); g.lineTo(114, r2 - 26); g.lineTo(114, r2 + 24); g.lineTo(88, r2 + 8); g.lineTo(70, r2 + 8); g.closePath(); g.fill(); g.fillRect(78, r2 + 8, 8, 16);
  g.font = `38px ${LAT}`; g.fillText('NOTICE', 144, r2 + 2); const d2 = 144 + g.measureText('NOTICE').width + 26; g.fillRect(d2, r2 - 26, 3, 52);
  const segs = []; (s.notice || '').split(/(\{[^}]*\})/).forEach(p => { if (!p) return; if (p[0] === '{') segs.push([p.slice(1, -1), '#FFD600']); else segs.push([p, '#fff']) });
  const full = segs.map(x => x[0]).join(''); const nf = fitFont(g, full, `{s}px ${KR}`, 36, W - 48 - d2 - 44); let nx = d2 + 24; g.font = `${nf}px ${KR}`;
  for (const [t, col] of segs) { g.fillStyle = col; g.fillText(t, nx, r2 + 2); nx += g.measureText(t).width }
  g.textBaseline = 'alphabetic';
  return c;
}
async function posterBlob() { const s = cur(); const c = await drawPoster(s); return new Promise(r => c.toBlob(b => r(b), 'image/png')) }
async function refreshPoster() { const s = cur(); if (!s) return; const c = await drawPoster(s); S.poster[S.sid] = c.toDataURL('image/png'); const el = document.querySelector('img.poster:not(.schedimg)'); if (el) el.src = S.poster[S.sid]; else if (!document.querySelector('img.schedimg')) render() }
async function sharePoster(download) {
  const b = await posterBlob(); const name = `WF_MATCHDAY_${S.sid.replace(/-/g, '')}.png`; const file = new File([b], name, { type: 'image/png' });
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
const QZ_NAMES = ['박종현', '지유균'];
function qzTarget() { const me = myPid(); return !!(me && !S.admin && QZ_NAMES.includes(String(S.players[me]?.name || '').replace(/\(게\)/g, '').trim())) }
function qzDone() { const me = myPid(); return !!(S.meta?.qz?.[me] || load('qz:' + me, null)) }
function viewQuiz() { if (S.qzStep === 'blocked') return `<div class="qz"><div class="qz-card"><div class="qz-ico">⛔</div><p class="qz-q">당신은 거짓 정보를 입력했습니다.<br>앞으로 앱 사용이 차단됩니다.</p><button class="qz-ok" data-act="qzok">확인</button></div></div>`;
  return `<div class="qz"><div class="qz-card"><div class="qz-ico">🔒</div><p class="qz-q">너무 많은 트래픽이 발생하여, 본인임을 확인합니다.<br><b>당신의 성별은 무엇입니까?</b></p><div class="qz-btns"><button data-act="qzans" data-v="m">남</button><button data-act="qzans" data-v="f">녀</button></div></div></div>` }
async function qzSave(v) { const me = myPid(); save('qz:' + me, v); try { await S.store.update('meta/qz', { [me]: v + ':' + Date.now() }) } catch { try { await S.store.set('meta/qz', { ...(S.meta?.qz || {}), [me]: v + ':' + Date.now() }) } catch { } } }
(() => { try { if (new URLSearchParams(location.search).get('qz') === 'reset') { Object.keys(localStorage).filter(k => k.startsWith('wf:qz:')).forEach(k => localStorage.removeItem(k)); window.WF_QZ_RESET = 1 } } catch { } })();
const BOOT_T0 = performance.now();
function hideBoot() { const b = document.getElementById('boot'); if (!b || b.dataset.out) return; b.dataset.out = '1'; const wait = Math.max(0, 1100 - (performance.now() - BOOT_T0)); setTimeout(() => { b.classList.add('out'); setTimeout(() => b.remove(), 500) }, wait) }
(() => { const im = document.querySelector('#boot img'); if (im) im.src = EMBLEM_SRC })();
let RENDER_Q = 0; function renderSoon() { if (RENDER_Q) return; RENDER_Q = requestAnimationFrame(() => { RENDER_Q = 0; render() }) }
function render() {
  if (isTyping()) { S.pending = true; return } S.pending = false;
  S.dm = !isDesk();
  if (S.ready >= 3 || S.err) hideBoot();
  if (S.ready >= 3) ensureQueues();
  if (!S.admin && S.auth && S.ready >= 3) { const cs = capSid(); if (cs && S.tab !== 'draft' && !(S.capPop ??= {})[cs] && !S.sheet) { S.capPop[cs] = 1; S.sheet = { type: 'cappop', sid: cs } } }
  if (!S.admin && !S.auth && S.ready >= 3) { document.body.classList.remove('dm-on'); document.getElementById('app').innerHTML = loginScreen() + (S.sheet ? viewSheet() : ''); return }
  if (S.ready >= 3 && qzTarget() && window.WF_QZ_RESET && !S.qzResetDone) { S.qzResetDone = true; const me = myPid(); S.store.update('meta/qz', { [me]: null }).catch(() => { }); if (S.meta?.qz) S.meta.qz[me] = null }
  if (S.ready >= 3 && qzTarget() && (!qzDone() || S.qzStep === 'blocked')) { document.body.classList.remove('dm-on'); document.getElementById('app').innerHTML = viewQuiz(); return }
  if (S.ready >= 3 && (!S.sid || !S.sessions[S.sid])) S.sid = defaultSid();
  if (S.store && S.chatSid !== S.sid) watchChat();
  if (S.admin) watchContacts();
  const atB = [...document.querySelectorAll('.msgs')].map(b => b.scrollHeight - b.scrollTop - b.clientHeight < 40); const atBottom = atB.length ? atB[0] : true;
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
  else if (S.tab === 'draft') h += withSession(s => myTeam(s) ? (s.draftStatus === 'done' ? vTrade(s) : vDraft(s)) : vMemberNotice(s));
  else if (S.tab === 'mhome') h += S.sub === 'applist' && cur() ? viewApplicants() : viewMHome();
  else if (S.tab === 'sched') h += viewSchedule();
  else if (S.tab === 'results') h += viewResults();
  else if (S.tab === 'mm') h += viewMatchMode();
  else h += viewSettings();
  h += '</div>' + tabs();
  if (S.openMatch && S.matches[S.openMatch]) h += viewMatch();
  if (S.sheet) h += viewSheet();
  document.getElementById('app').innerHTML = h + (S.admin ? venueList() : '');
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
    <label class="actx-t"><b>${fmtDate(sid)} ${esc(s.time || '')}${s.no ? ` · ${s.no}회` : ''}</b><small>📍 ${esc(s.venue || '-')} · <span class="st st-${st.k}">${st.label}</span> 선발 ${c.sel}${s.capacity ? '/' + s.capacity : ''}${c.wait ? ` · 대기 ${c.wait}` : ''}</small>
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
  ${!S.dm && !S.admin && S.auth ? `<button class="mmtop ${S.tab === 'mm' ? 'on' : ''}" data-act="mmtoggle" aria-label="${S.tab === 'mm' ? '일반모드로 돌아가기' : '경기모드 열기'}"><span class="mmball">⚽</span><b>${S.tab === 'mm' ? '일반모드' : '경기모드'}</b>${liveAny() ? '<i class="mmlive"></i>' : ''}</button>` : ''}<button class="opbtn ${S.admin ? 'on' : ''}" data-act="opmode">운영모드</button></div>${capStrip()}</header>`;
}
function tabs() {
  const t = S.admin ? [['manage', '일정'], ['run', '경기'], ['notice', '공지'], ['members', '회원'], ['settings', '설정']] : [['mhome', '홈'], ['sched', '일정'], ...(isDesk() ? [] : [['mm', '경기모드']]), ['results', '경기결과'], capSid() ? ['draft', '팀 선정'] : viewSid() ? ['draft', '드래프트 참관'] : ['settings', '내 정보']];
  return `<div class="tabs"><nav style="grid-template-columns:repeat(${t.length},1fr)">${t.map(([k, n]) => k === 'mm' ? `<button class="mmtab ${S.tab === 'mm' ? 'on' : ''}" data-act="mmtoggle" ${S.tab === 'mm' ? 'aria-current="page"' : ''}><span class="mmball">⚽</span><span>${S.tab === 'mm' ? '일반모드' : n}</span>${liveAny() ? '<i class="mmlive"></i>' : ''}</button>` : `<button data-act="tab" data-v="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${n}</button>`).join('')}</nav></div>` }
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
  <h2>신청자<small>${ids.length}명</small></h2><div class="panel"><div class="chips">${byName(ids).map(id => `<span class="chip ${S.players[id]?.name === S.me ? 'sel' : ''}">${esc(pname(id))}</span>`).join('') || '<span class="muted">아직 신청자가 없어요.</span>'}</div></div>
  <p class="note">드래프트가 시작되면 이 화면에서 실시간으로 볼 수 있어요.</p>` + chatPanel();
}

function vApply(s) {
  const ad = S.admin; const ids = s.applicants || [];
  let h = `<h2>신청 조건<small>수정은 일정 메뉴에서</small></h2><div class="panel apinfo ro">${[['정원', s.capacity ? s.capacity + '명' : '-'], ['신청 오픈', s.applyOpen ? fmtDT(s.applyOpen) : '-'], ['신청 마감', s.applyClose ? fmtDT(s.applyClose) : '-'], ['순위 규칙', isBase(s) ? 'The Base 0~3순위' : '선착순'], ['구장 예약자', idsToNames(s.p0) || '-'], ['경기 운영자', idsToNames(s.ops) || '-']].map(([k, v]) => `<div class="field"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
  const ast = sStatus(s); const cc = appCounts(s);
  h += `<h2>신청자<small>선발 ${cc.sel}${s.capacity ? ' / ' + s.capacity : ''}명${cc.wait ? `, 대기 ${cc.wait}명` : ''}</small><span class="st st-${ast.k}">${ast.label}</span></h2>
  <p class="note" style="margin:-4px 2px 10px">${ast.k === 'open' ? `회원들이 앱에서 직접 신청하는 중이에요. ${s.applyClose ? fmtDT(s.applyClose) + '에 자동 마감돼요.' : ''}` : ast.k === 'soon' ? `${fmtDT(s.applyOpen)}에 앱 신청이 열려요.` : '앱 신청이 마감됐어요.'}</p>`;
  h += vApplyTable(s);
  if (false && (s.waitlist || []).length) h += `<h2>대기<small>${s.waitlist.length}명, 신청자가 취소하면 자동으로 올라가요</small></h2><div class="panel"><div class="chips">${s.waitlist.map(id => `<button class="chip ${ad ? 'x' : ''}" data-act="rmwait" data-id="${id}" ${ad ? '' : 'disabled'}>${esc(pname(id))}</button>`).join('')}</div>${ad ? `<div class="pad" style="padding-top:0"><button class="btn sm" data-act="promote">대기 1번을 신청자로 올리기</button></div>` : ''}</div>`;
  if (ad && s.stage === 'apply') h += `<div class="panel pad" style="display:flex;gap:8px;margin-top:10px"><input class="inp" type="text" placeholder="한 명씩 추가 (게스트는 이름(게))" data-in="addone" id="addone"><button class="btn" data-act="addone">추가</button></div>`;
  if (ad && ast.k === 'open') h += `<div class="row" style="margin-top:10px"><button class="btn" data-act="closenow">지금 신청 마감하기</button></div>`;
  if (s.stage !== 'apply' && ids.length % 3 && ids.length) h += `<p class="note">${ids.length}명은 3팀으로 딱 나눠지지 않아요. 한 팀이 ${Math.ceil(ids.length / 3)}명이 돼요.</p>`;
  if (ad) h += `<div style="height:14px"></div><button class="btn primary block" data-act="gostage" data-v="captain" ${(s.stage === 'apply' ? cc.sel : ids.length) < 3 ? 'disabled' : ''}>${s.stage === 'apply' ? '신청 확정하고 주장 정하기' : '다음: 주장 정하기'}</button>`;
  return h;
}
function vCaptain(s) {
  const ad = S.admin && s.draftStatus === 'ready' && !s.ladder;
  let h = `<h2>주장 3명<small>신청자 중에서 골라요</small></h2><div class="panel">${KEYS.map((k, i) => { const c = s.captains?.[k];
    return `<button class="slot" data-act="capslot" data-k="${k}" ${ad ? '' : 'disabled'}><span class="teamtag" style="background:${NEUTRAL[k]};color:#fff">${k}팀</span><span class="who ${c ? '' : 'empty'}">${c ? '👑 ' + esc(pname(c)) : '눌러서 주장 선택'}</span>${ad ? '<span class="muted">변경</span>' : ''}</button>` }).join('')}</div>`;
  h += `<p class="note">주장으로 지정된 회원은 앱에 로그인하면 팝업과 화면 위 안내 띠로 팀 선정 화면에 바로 들어올 수 있어요. 따로 링크를 보낼 필요가 없어요.</p>`;
  h += `<p class="note">드래프트 방에서 주장들이 입장하면 ① 팀 색 선택 → ② 사다리 타기로 순번 선정 → ③ 팀원 선택 순서로 진행해요. 색이 정해지기 전까지 팀 이름은 A팀, B팀, C팀이에요.</p>`;
  if (S.admin && s.draftStatus === 'ready') h += `<div style="height:12px"></div><button class="btn primary block cta" data-act="openroom" ${KEYS.some(k => !s.captains?.[k]) ? 'disabled' : ''}>드래프트 방 열기</button>`;
  if (S.admin) { const vs = s.viewers || []; const pool = byName(Object.keys(S.players).filter(id => mstatus(S.players[id]) !== 'dormant' && !captainsOf(s).includes(id)));
    h += `<h2>드래프트 참관자<small>지정한 회원만 드래프트를 볼 수 있어요 (${vs.length}명)</small></h2><div class="panel pad"><div class="dpick">${pool.map(id => `<button class="chip ${vs.includes(id) ? 'sel' : ''}" data-act="viewertog" data-id="${id}">${vs.includes(id) ? '👀 ' : ''}${esc(pname(id))}</button>`).join('')}</div></div>` }
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
  if (s.cardgame?.doneAt && Date.now() < s.cardgame.doneAt + CARD_REVEAL_MS) return 'cardsrev';
  if (!orderDecided(s)) return 'order';
  if (s.ladder && Date.now() < s.ladder.at + LADDER_MS) return 'ladder';
  return s.draftStatus === 'live' ? 'draft' : 'order';
}
function joinedCount(s) { return KEYS.filter(k => s.room?.[k]?.in).length }
function makeLadder() {
  const rows = 9; const rungs = [];
  for (let r = 0; r < rows; r++) { const x = Math.random(); if (x < .4) rungs.push({ r, c: 0 }); else if (x < .8) rungs.push({ r, c: 1 }) }
  if (rungs.length < 4) return makeLadder();
  return { rows, rungs, at: Date.now() };
}
function rungList(L) { return (L.rungs || []).map(g => Array.isArray(g) ? { r: g[0], c: g[1] } : g) }
function ladderPaths(L) {
  const X = [60, 170, 280], top = 34, bot = 206; const ry = r => top + (bot - top) * (r + 1) / (L.rows + 1);
  const res = []; for (let c0 = 0; c0 < 3; c0++) { let c = c0; const pts = [[X[c], top]];
    for (let r = 0; r < L.rows; r++) { const y = ry(r); const g0 = rungList(L).find(x => x.r === r && (x.c === c || x.c === c - 1)); const g = g0 && [g0.r, g0.c];
      if (g) { pts.push([X[c], y]); c = g[1] === c ? c + 1 : c - 1; pts.push([X[c], y]) } }
    pts.push([X[c], bot]); res.push({ from: c0, to: c, pts }) }
  return { X, top, bot, ry, res };
}
function ladderOrder(L) { const { res } = ladderPaths(L); const o = []; res.forEach(p => o[p.to] = KEYS[p.from]); return o }
function ladderSVG(s) {
  const L = s.ladder; const P = ladderPaths(L); const el = Date.now() - L.at; const done = el >= LADDER_MS;
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
  const turn = ph === 'draft' && pickTeamAt(s, (s.picks || []).length) === k; const cturn = ph === 'color' && !t.picked && inRoom; const me = myTeam(s) === k;
  const ps = byName(teamPlayers(s, k).slice(1));
  return `<div class="seat ${t.picked ? 'picked' : ''} ${turn || cturn ? 'onturn' : ''} ${me ? 'me' : ''}" style="--tc:${t.color};--ti:${inkOn(t.color)}">
    ${bubbleFor(m => m.team === k)}${turn ? '<span class="turnb">차례</span>' : ''}
    <div class="sv2"><div class="snm">${orderDecided(s) && o >= 0 && ph !== 'ladder' && ph !== 'cards' ? `<em class="ord2">${o + 1}</em>` : ''}<b>${esc(pname(cap) || '미정')}</b><i class="dot ${inRoom ? 'on' : ''}" title="${inRoom ? '입장' : '대기'}"></i>${me ? '<span class="meb">나</span>' : ''}</div>
      <div class="sinfo"><span class="tok">${esc(t.name)}</span><b class="cnt2">${cap ? ps.length + 1 : 0}<small>명</small></b></div></div>
    ${(() => { const mine = me || S.admin; const pend = s.pending && s.pending.t === k ? s.pending.p : null; const last = (s.picks || []).slice(-1)[0]; const seen = (S.seenStk ??= new Set());
      const items = ps.map(id => { const key = s.date + ':' + id; const nw = !seen.has(key); seen.add(key); const can = mine && last && last.p === id && last.t === k;
        return mine ? `<button class="stkb ${nw ? 'new' : ''} ${can ? 'undo' : ''}" data-act="unpick" data-id="${id}" title="${can ? '눌러서 선택 취소' : ''}">${esc(pname(id))}${can ? ' ✕' : ''}</button>` : `<span class="${nw ? 'new' : ''}">${esc(pname(id))}</span>` });
      if (pend) items.push(mine ? `<button class="stkb pendstk" data-act="unpick" data-id="${pend}">${esc(pname(pend))} ✕</button>` : `<span class="pendstk">${esc(pname(pend))}</span>`);
      return items.length ? `<div class="stk">${items.join('')}</div>` : '' })()}
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
  if (ph === 'draft') { const i = (s.picks || []).length, tot = draftTotal(s); const k = pickTeamAt(s, i); const t = team(s, k); const pd = s.pending && s.pending.t === k ? s.pending.p : null;
    const from = Math.max(0, i - 3), to = Math.min(tot, from + 12); const ord = s.order || KEYS;
    const flow = `<div class="flow" aria-label="지명 순서">${Array.from({ length: to - from }, (_, x) => { const j = from + x; const kk = pickTeamAt(s, j); const tt = team(s, kk);
      return `<span class="${j < i ? 'past' : j === i ? 'cur' : ''}" style="--tc:${tt.color};--ti:${inkOn(tt.color)}" title="${j + 1}순위 ${esc(tt.name)}">${ord.indexOf(kk) + 1}</span>` }).join('')}${to < tot ? '<em>…</em>' : ''}</div>`;
    return `<div class="fx"><div class="rnd">STEP 3 · 팀원 선택 ${i + 1} / ${tot}</div>${flow}<b><span class="tok" style="background:${t.color};color:${inkOn(t.color)}">${esc(t.name)}</span> ${esc(pname(s.captains[k]))} 주장 차례${my === k ? ', 내 차례!' : ''}</b>
      ${i ? (() => { const lp = s.picks[i - 1]; const lt = team(s, lp.t); return `<div class="lastpick">직전 지명 <span class="tok" style="background:${lt.color};color:${inkOn(lt.color)}">${esc(lt.name)}</span> <b>${esc(pname(lp.p))}</b></div>` })() : ''}
      ${S.poolHTML || ''}<p>${pd ? `<b>${esc(pname(pd))}</b> 선택 · ${my === k || S.admin ? '선택 완료를 누르면 다음 주장에게 넘어가요.' : '주장이 선택 완료를 누르면 확정돼요.'}` : my === k ? '명단에서 선수를 눌러 고른 뒤 선택 완료를 누르세요.' : '선수를 고르는 중…'}</p>
      ${my === k || S.admin ? `<div class="row" style="justify-content:center"><button class="btn primary cta done-btn" data-act="nextturn" ${pd ? '' : 'disabled'}>선택 완료 ▶</button>${S.admin && i ? '<button class="btn sm" data-act="undo">↶ 되돌리기</button>' : ''}</div>` : ''}</div>` }
  return `<div class="fx"><b>드래프트 완료! 🎉</b><p>팀원조정 단계에서 밸런스를 맞춰요.</p></div>`;
}
function vDraft(s) {
  const ph = roomPhase(s); const my = myTeam(s); const turnK = ph === 'draft' ? pickTeamAt(s, (s.picks || []).length) : null;
  const canPick = ph === 'draft' && (S.admin || (my && my === turnK && s.room?.[my]?.in));
  if (S.admin && s.room?.open && !s.room?.admin?.in && !S.adminJoin?.[S.sid]) { (S.adminJoin ??= {})[S.sid] = 1; w(() => S.store.update(sp(S.sid), { 'room.admin': { in: true, name: S.me || '운영진', at: Date.now() } })) }
  let h = '';
  if (my) { const si = { closed: 0, lobby: 0, color: 0, order: 1, ladder: 1, cards: 1, cardsrev: 1, draft: 2, done: 3 }[ph]; const tm = team(s, my);
    h += `<div class="capbar"><ol class="dstg">${['팀색 선택', '순번 정하기', '팀원 선택'].map((n, i) => `<li class="${i < si ? 'done' : i === si ? 'now' : ''}"><i>${i < si ? '✓' : i + 1}</i><span>${n}</span></li>`).join('')}</ol>
      <div class="capinfo" style="--tc:${tm.color};--ti:${inkOn(tm.color)}"><span class="tok2">${esc(tm.name)}</span><span class="cn"><b>${esc(pname(s.captains?.[my]))}</b> 주장<small>참여 중</small></span></div></div>` }
  // top: applicant buttons
  const pk = {}; (s.picks || []).forEach((x, i) => pk[x.p] = { t: x.t, n: i + 1 }); const caps = captainsOf(s);
  const inTeam = new Set(KEYS.flatMap(k => teamPlayers(s, k))); const list = byName((s.applicants || []).filter(id => !caps.includes(id) && !pk[id] && !inTeam.has(id)));
  const hint = ph === 'draft' ? `남은 ${list.length}명 · ${canPick ? '눌러서 선택' : '내 차례에만 선택할 수 있어요'}` : ph === 'done' ? '모두 선택됐어요' : `${list.length}명`;
  S.poolHTML = ph === 'draft' ? `<div class="pool"><div class="pool-hd">남은 선수 ${list.length}명 · ${canPick ? '눌러서 선택' : '내 차례에만 선택할 수 있어요'}</div><div class="namegrid">${list.map(id => { const pend = s.pending?.p === id; const pt = pend ? team(s, s.pending.t) : null;
    return `<button class="nb ${pend ? 'pend' : ''}" ${pt ? `style="--tc:${pt.color};--ti:${inkOn(pt.color)}"` : ''} data-act="pick" data-id="${id}" ${canPick ? '' : 'disabled'}>${esc(pname(id))}</button>` }).join('')}</div></div>` : '';
  // middle: board
  const o = s.order && orderDecided(s) && ph !== 'ladder' && ph !== 'cards' ? s.order : KEYS; const [L, B, R] = o;
  const hostH = `<div class="seat host ${s.room?.admin?.in ? '' : 'off'}">${bubbleFor(m => m.admin)}<div class="sv"><span class="av on hostav">운영</span></div><div class="sn">운영진${s.room?.admin?.name && s.room.admin.name !== '운영진' ? ' ' + esc(s.room.admin.name) : ''}</div><div class="st2"><small>${s.room?.admin?.in ? '진행 중' : '대기 중'}</small></div>${S.admin && S.dm && ph !== 'closed' ? '<button class="btn sm hostmenu" data-act="roommenu" aria-label="진행 메뉴">⋯</button>' : ''}</div>`;
  h += S.dm ? `<div class="board-table dmbt">${hostH}<div class="felt">${feltHTML(s, ph)}</div><div class="seatrow"><div class="pos-l">${seatHTML(s, L, ph)}</div><div class="pos-b">${seatHTML(s, B, ph)}</div><div class="pos-r">${seatHTML(s, R, ph)}</div></div></div>`
    : `<h2>드래프트 테이블</h2><div class="board-table">${hostH}
    <div class="pos-l">${seatHTML(s, L, ph)}</div><div class="felt">${feltHTML(s, ph)}</div><div class="pos-r">${seatHTML(s, R, ph)}</div><div class="pos-b">${seatHTML(s, B, ph)}</div></div>`;
  if (S.admin && ph !== 'closed' && !S.dm) h += `<div class="row" style="margin-top:10px">${(ph === 'draft' || ph === 'cards') && !(s.picks || []).length ? '<button class="btn sm" data-act="reorder">순번 다시 정하기</button>' : ''}<button class="btn sm danger" data-act="resetroom">드래프트 처음부터</button></div>`;
  if ((S.chatSeen ??= {})[S.sid] === undefined && S.chatSid === S.sid && S.chat.length) S.chatSeen[S.sid] = S.chat.length;
  // bottom: chat
  h += chatPanel(true);
  return h;
}
async function openRoom() {
  const s = cur(); if (KEYS.some(k => !s.captains?.[k])) { toast('주장 3명을 먼저 정하세요.'); return }
  const tokens = { ...(s.captainTokens || {}) }; KEYS.forEach(k => { if (!tokens[k]) tokens[k] = rand() });
  const ok = await w(() => S.store.update(sp(S.sid), { stage: 'draft', draftStatus: 'ready', picks: [], pending: null, ladder: null, order: [...KEYS], captainTokens: tokens,
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
    if (KEYS.every(t => g.picks[t] != null)) { order = [...KEYS].sort((a, b) => g.deck[g.picks[a]] - g.deck[g.picks[b]]); d.order = order; g.doneAt = Date.now(); d.draftStatus = 'live'; d.picks = []; d.pending = null }
    d.cardgame = g; return d }));
  if (!ok) { toast('이미 뽑힌 카드예요. 다른 카드를 골라 주세요.'); return }
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
    if (!pool(d).length) { d.draftStatus = 'done'; d.stage = 'trade'; KEYS.forEach(t => { d.teams[t] = { ...(d.teams[t] || {}), players: [d.captains[t], ...d.picks.filter(x => x.t === t).map(x => x.p)] } }); done = true }
    return d }));
  if (ok && info) { sysChat(`${info.n}순위 ${team(s, info.t).name}: ${pname(info.p)}`); if (done) sysChat('드래프트 완료! 🎉') }
}

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
function chatPanel(room) {
  const me = S.me; const mk = myTeam(cur());
  const ph = mk ? esc(pname(cur().captains[mk])) + ' 주장으로 보내기' : S.admin ? '운영진으로 보내기' : me ? esc(me) + '(으)로 보내기' : '메시지 (처음엔 이름을 물어봐요)';
  return `<div class="chatdock"><div class="cd-log msgs" aria-live="polite" aria-label="최근 채팅">${chatLines()}</div>
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
  h += chatPanel(!!(my || S.admin));
  return h;
}
function vNotice(s, inMenu) {
  const ad = S.admin && !inMenu; const img = S.poster[S.sid];
  if (!allPicked(s)) return `<div class="notice warn">아직 팀 색을 고르지 않은 팀이 있어요. 밸런스 조정 화면에서 팀 색을 먼저 정해 주세요.</div>`;
  if (!img) queueMicrotask(refreshPoster);
  let h = `<div class="dgrid"><section><h2>팀 선정 결과 공지 이미지</h2><img class="poster" alt="매치데이 공지 이미지 미리보기" src="${img || ''}" width="1086" height="1448">
  <div class="row" style="margin-top:10px"><button class="btn primary" data-act="share">공유하기</button><button class="btn" data-act="download">이미지 저장</button></div>
  <button class="btn block" style="margin-top:8px" data-act="copytext">공지 텍스트 복사</button>`;
  h += '</section><section>';
  if (ad) h += `<h2>공지 내용</h2><div class="panel">
    <div class="field"><label for="f-ev">E/V 비밀번호</label><input id="f-ev" class="inp" type="text" value="${esc(s.evpw || '')}" data-in="sfield" data-f="evpw" ${ad ? '' : 'disabled'}></div>
    <div class="field"><label for="f-nt">NOTICE 문구</label><input id="f-nt" class="inp" type="text" value="${esc(s.notice || '')}" data-in="sfield" data-f="notice" ${ad ? '' : 'disabled'}><span class="note" style="margin:0">{ } 로 감싼 글자는 노란색으로 강조돼요.</span></div></div>`;
  if (ad) h += sessMatches(s.date).length ? `<div style="height:14px"></div><button class="btn block" data-act="gorun" data-id="${s.date}" data-step="match">경기 진행 화면으로</button>` : `<div style="height:14px"></div><button class="btn primary block" data-act="mkmatches">경기 일정 만들기 (9경기)</button>`;
  return h + '</section></div>';
}
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
  const tally = {}; for (const e of Object.values(S.events)) { if (e.session !== S.sid || e.og) continue; if (e.scorer) (tally[e.scorer] ??= { g: 0, a: 0 }).g++; if (e.assist) (tally[e.assist] ??= { g: 0, a: 0 }).a++ }
  const top = Object.entries(tally).sort((x, y) => (y[1].g + y[1].a) - (x[1].g + x[1].a) || y[1].g - x[1].g).slice(0, 10);
  if (S.admin) { const st = (key, lab, val, unit) => `<div class="stepper"><button data-act="tstep" data-key="${key}" data-d="-1" aria-label="${lab} 줄이기">−</button><span><small>${lab}</small>${val}${unit}</span><button data-act="tstep" data-key="${key}" data-d="1" aria-label="${lab} 늘리기">+</button></div>`;
    sch += `<h2>경기 시간 설정</h2><div class="grid2">${st('h1', '전반', T.h1 / 60, '분')}${st('gk', 'GK 교체', T.gk, '초')}${st('h2', '후반', T.h2 / 60, '분')}${st('rest', '쉬는 시간', T.rest / 60, '분')}</div>
    <h2>관리</h2><button class="btn danger block" data-act="delmatches">경기 대진(1~9경기) 삭제</button><p class="note">경기 일정(대진표)과 경기 기록만 지워요. 신청자, 팀 구성, 공지는 그대로 남고, 다시 "경기 일정 만들기"로 새 대진을 만들 수 있어요. 경기일 자체 삭제는 경기관리 메뉴에서 해요.</p>` }
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
    return `<div class="ev"><span class="min">${second ? '후' : '전'} ${Math.max(1, mn)}'</span>${bib(t.color)}<span class="who">${esc(t.name)} 골</span>${can ? `<button class="x" data-act="delev" data-id="${e.id}" aria-label="골 기록 삭제">×</button>` : ''}</div>` }).join('') : '<p class="empty">골이 나면 위의 팀 버튼을 누르세요.</p>'}</div></section></div></div></div>`;
  return h;
}
function viewSheet() {
  const sh = S.sheet; let h = `<div class="scrim" data-act="closesheet"><div class="sheet" role="dialog" aria-modal="true" data-stop><div class="grab"></div>`;
  if (sh.type === 'adminpin') h += `<h4>운영모드</h4><p>운영진 비밀번호를 입력하세요.</p><div class="panel"><div class="field"><label for="ap-pin">비밀번호</label><input id="ap-pin" class="inp pin" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="••••"></div></div><div class="row" style="margin-top:12px"><button class="btn primary cta" data-act="adminpinok">운영모드 들어가기</button></div>`;
  else if (sh.type === 'cappop') { const s = S.sessions[sh.sid]; const k = myTeam(s);
    h += `<div class="cappop"><div class="cp-crown">👑</div><h4>${esc(pname(myPid()))} 님, 주장으로 지정됐어요!</h4><p>${fmtDate(sh.sid)} ${esc(s.time || '')} 경기의 <b>${esc(team(s, k).name)}</b> 주장이에요.<br>${s.room?.open ? '드래프트 방이 열렸어요. 지금 입장해 주세요.' : '운영진이 드래프트 방을 열면 팀원을 선정해요.'}</p><button class="btn primary block cta" data-act="gocap" data-id="${sh.sid}">팀 선정 화면으로 가기</button></div>` }
  else if (sh.type === 'import') h += importSheet();
  else if (sh.type === 'duty') h += dutySheet(sh.sid);
  else if (sh.type === 'park') h += parkSheet(sh.sid);
  else if (sh.type === 'parkapply') { const ss = S.sessions[sh.sid]; h += `<h4>🚗 주차 신청</h4><p>${fmtDate(sh.sid)} 경기 주차를 신청해요. 신청자 중 ${PARK_SLOTS}명을 추첨해요.</p><div class="panel"><div class="field"><label for="pk-car2">차량번호</label><input id="pk-car2" class="inp" type="text" maxlength="12" placeholder="예: 12가3456" value="${esc(myCar())}"></div><p class="note" style="margin:6px 0 0">내 정보에 차량번호를 저장해 두면 자동으로 채워져요.</p></div><div class="row" style="margin-top:12px"><button class="btn primary" data-act="parksave">신청</button></div>` }
  else if (sh.type === 'kakao') { const L = S.kk || null;
    h += `<h4>📋 카톡 투표 명단 반영</h4>${S.ocrBusy ? `<div class="ocrbox"><div class="ocrspin"></div><b>${S.ocrMsg || '글자 읽는 중…'}</b><small>처음 한 번은 한글 인식 데이터를 받느라 조금 걸려요.</small></div>` : !L ? `<p>카톡 투표 <b>참여자 목록 화면</b>을 캡처해서 올려 주세요. 스크롤해서 여러 장이면 <b>위에서부터 순서대로</b> 모두 골라 주세요. 겹치는 이름은 한 번만 읽어요.</p>
      <label class="btn primary block" style="cursor:pointer">📷 캡처 이미지 올리기 (여러 장 가능)<input type="file" accept="image/*" multiple data-in="kkimg" hidden></label>
      <details class="kk-alt"><summary>글자로 붙여넣기</summary><textarea id="kk-text" class="inp" rows="6" placeholder="예)\n김민혁\n이도형\n안준영"></textarea><button class="btn block" style="margin-top:8px" data-act="kakaoparse">이름 확인하기</button></details>`
      : `<p>${L.filter(x => x.use).length}명을 이 순서대로 맨 앞에 놓아요. 이름이 맞는지 확인하고 반영을 눌러 주세요.${S.kkFromImg ? ' 카톡 화면에 보이는 순서(위→아래)대로 읽었어요. 투표 순서가 반대라면 <b>순서 뒤집기</b>를 눌러 주세요.' : ''}</p>${S.kkFromImg ? '<button class="btn sm" data-act="kakaorev" style="margin-bottom:8px">⇅ 순서 뒤집기</button>' : ''}<div class="kk-list">${L.map((x, i) => `<div class="kk-row ${x.pid ? '' : x.guess ? 'warn' : 'bad'}"><em>${i + 1}</em><span>${esc(x.raw)}</span><select class="inp" data-in="kkpick" data-i="${i}"><option value="">${x.pid || x.guess ? '건너뛰기' : '명단에 없음 · 건너뛰기'}</option>${byName(Object.keys(S.players)).map(id => `<option value="${id}" ${x.use === id ? 'selected' : ''}>${esc(pname(id))}${x.guess === id && !x.pid ? ' (혹시?)' : ''}</option>`).join('')}</select></div>`).join('')}</div>
      <div class="row" style="margin-top:10px"><button class="btn" data-act="kakaoback">← 다시 하기</button><button class="btn primary" data-act="kakaoapply">반영하기</button></div>` }` }
  else if (sh.type === 'colf') h += colFilterSheet(sh.k);
  else if (sh.type === 'changelog') h += `<h4>업데이트 내용</h4>${sh.fresh ? `<p class="cl-new">🎉 ${APP_VERSION} 버전으로 업데이트됐어요</p>` : ''}<div class="cl">${CHANGELOG.map(([v, d, items], i) => `<section class="${i === 0 ? 'cur' : ''}"><div class="cl-hd"><b>${v}</b><small>${d}</small>${v === APP_VERSION ? '<em>현재</em>' : ''}</div><ul>${items.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>`).join('')}</div>`;
  else if (sh.type === 'staffedit') { const ss = S.sessions[sh.sid];
    h += `<h4>${fmtDate(sh.sid)} 예약자 · 운영자</h4><p>여기 적힌 사람은 따로 신청하지 않아도 0순위로 자동 신청돼요. 여러 명은 쉼표로 구분해요.</p><div class="panel">
      <div class="field"><label>구장 예약자<input id="se-res" class="inp" type="text" list="mem-list2" value="${esc(idsToNames(ss.p0))}"></label></div>
      <div class="field"><label>경기 운영자<input id="se-ops" class="inp" type="text" list="mem-list2" value="${esc(idsToNames(ss.ops))}"></label></div>
      <datalist id="mem-list2">${Object.values(S.players).map(p => p.name).sort((a, b) => a.localeCompare(b, 'ko')).map(n => `<option value="${esc(n)}">`).join('')}</datalist></div><div class="row" style="margin-top:12px"><button class="btn primary" data-act="staffsave">저장</button></div>` }
  else if (sh.type === 'appname') { const names = Object.values(S.players).map(p => p.name).sort((a, b) => a.localeCompare(b, 'ko'));
    h += `<h4>신청 순번 확보 완료! 🎉</h4><p>이름과 비밀번호 4자리로 로그인하면 신청이 확정돼요. 팀 명단에 쓰이는 이름 그대로 적어 주세요.</p><div class="panel">${myPid() ? `<div class="field"><span>이름</span><b>${esc(pname(myPid()))}</b></div>` : loginFields('an', S.me)}${parkFields(S.sessions[sh.sid], myPid())}</div><div class="row" style="margin-top:12px"><button class="btn primary" data-act="appnamego">${myPid() ? '신청 확정' : '로그인하고 신청 확정'}</button></div><p class="note">지금 닫아도 순번은 유지돼요. 나중에 홈의 "이름 입력하기"로 입력할 수 있어요.</p>` }
  else if (sh.type === 'colorpick') { const s = cur(); const cur0 = s.teams?.[sh.k]?.colorName;
    h += `<h4>${esc(team(s, sh.k).name)} 팀 색 바꾸기</h4><p>다른 팀이 쓰는 색은 고를 수 없어요.</p><div class="pick cpick">${PALETTE.map(p => { const by = KEYS.find(o => o !== sh.k && s.teams?.[o]?.colorName === p.name);
      return `<button class="${cur0 === p.name ? 'cur' : ''}" style="background:${p.color};color:${inkOn(p.color)}" data-act="colorset" data-c="${p.name}" ${by ? 'disabled' : ''}>${p.name}${by ? '<small>사용 중</small>' : cur0 === p.name ? '<small>지금 색</small>' : ''}</button>` }).join('')}</div>` }
  else if (sh.type === 'roommenu') { const s = cur(); const ph = roomPhase(s);
    h += `<h4>진행 메뉴</h4><p>드래프트 진행을 조정해요.</p><div class="pick" style="grid-template-columns:1fr">${ph === 'draft' && (s.picks || []).length ? '<button data-act="undo">↶ 마지막 지명 되돌리기</button>' : ''}${(ph === 'draft' || ph === 'cards') && !(s.picks || []).length ? '<button data-act="reorder">순번 다시 정하기</button>' : ''}<button class="alt" data-act="resetroom">드래프트 처음부터 다시</button></div>` }
  else if (sh.type === 'chatlog') { (S.chatSeen ??= {})[S.sid] = S.chat.length; h += `<h4>메시지 내역</h4><p>드래프트 방에서 주고받은 메시지예요.</p><div class="panel chat logsheet">${chatMsgs()}</div>` }
  else if (sh.type === 'cal') h += calSheet();
  else if (sh.type === 'madd') h += `<h4>회원 추가</h4><div class="panel"><div class="field"><label>이름<input id="ma-name" class="inp" type="text" maxlength="20"></label></div>
    <div class="field"><label>연락처<input id="ma-phone" class="inp" type="tel" placeholder="010-0000-0000"></label></div>
    <div class="field"><label>구분<select id="ma-st" class="inp">${Object.entries(MSTAT).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label></div>
    <div class="field"><label>메모<input id="ma-memo" class="inp" type="text"></label></div></div><div class="row" style="margin-top:12px"><button class="btn primary" data-act="maddgo">추가</button></div>`;
  else if (sh.type === 'mbulk') h += `<h4>명단 붙여넣기</h4><p>한 줄에 한 명씩 "이름 생년월일" 또는 "이름 연락처" 형식으로 붙여넣으세요(예: 김환석 890331, 나강일 90). 생년월일·연락처는 없어도 되고, 게스트는 이름 뒤에 (게)를 붙여요. 이미 있는 이름은 정보만 보태요. 회원 명단에 있는 사람만 앱에 로그인할 수 있어요.</p>
    <textarea id="mb-txt" class="inp" style="min-height:180px" placeholder="김민혁 010-1234-5678&#10;이도형 01023456789&#10;배기문(게)"></textarea><div class="row" style="margin-top:12px"><button class="btn primary" data-act="mbulkgo">등록</button></div>`;
  else if (sh.type === 'newsession') h += `<h4>새 경기일</h4><p>날짜와 기본 정보를 정하세요. 나중에 바꿀 수 있어요.</p><form data-form="newsession"><div class="panel">
    <div class="field"><label for="n-date">날짜</label><input id="n-date" class="inp" type="date" name="date" value="${today()}" required></div>
    <div class="field"><label for="n-time">시간</label><input id="n-time" class="inp" type="time" name="time" value="${esc(DEFAULTS.time)}"></div>
    <div class="field"><label for="n-venue">장소</label><input id="n-venue" class="inp" type="text" name="venue" value="${esc(DEFAULTS.venue)}"></div>
    <div class="field"><label for="n-cap">신청 인원 (정원)</label><input id="n-cap" class="inp" type="number" name="capacity" min="3" max="60" value="${DEFAULTS.capacity || 18}"></div>
    <div class="field"><label for="n-open">신청 오픈</label><input id="n-open" class="inp" type="datetime-local" name="applyOpen" value=""><span class="note" style="margin:0">비워 두면 경기 ${DEFAULTS.openDays}일 전 ${DEFAULTS.openTime}</span></div>
    <div class="field"><label for="n-close">신청 마감</label><input id="n-close" class="inp" type="datetime-local" name="applyClose" value=""><span class="note" style="margin:0">비워 두면 경기 ${DEFAULTS.closeDays}일 전 ${DEFAULTS.closeTime}로 정해져요.</span></div>
    <div class="field"><label for="n-ev">E/V 비밀번호</label><input id="n-ev" class="inp" type="text" name="evpw" value=""></div></div>
    <div class="row" style="margin-top:12px"><button type="button" class="btn" data-act="closesheet">취소</button><button class="btn primary" type="submit">만들기</button></div></form>`;
  else if (sh.type === 'capslot') { const s = cur(); const taken = KEYS.filter(k => k !== sh.k).map(k => s.captains?.[k]);
    h += `<h4>${esc(team(s, sh.k).name)} 주장</h4><p>신청자 중에서 고르세요.</p><div class="pick">${byName(s.applicants || []).map(id => `<button class="${s.captains?.[sh.k] === id ? 'cur' : ''}" data-act="pickcap" data-id="${id}" ${taken.includes(id) ? 'disabled' : ''}>${esc(pname(id))}</button>`).join('')}${s.captains?.[sh.k] ? '<button class="alt" data-act="pickcap" data-id="">선택 취소</button>' : ''}</div>` }
  else if (sh.type === 'goal') { const m = M(sh.match); const s = S.sessions[m.session]; const t = team(s, sh.team); const ps = teamPlayers(s, sh.team); const ci = clockInfo(m);
    if (sh.step === 'scorer') h += `<h4>${esc(t.name)} 골! 누가 넣었나요?</h4><p>${esc(ci.label)} ${esc(ci.time)} 시점으로 기록돼요.</p><div class="pick">${ps.map(id => `<button data-act="pickscorer" data-id="${id}">${captainOf(s, sh.team) === id ? '👑 ' : ''}${esc(pname(id))}</button>`).join('')}<button class="alt" data-act="pickscorer" data-id="">선수 미지정</button><button class="alt" data-act="pickog">상대 자책골</button></div>`;
    else h += `<h4>도움은 누가 했나요?</h4><p>득점 ${esc(pname(sh.scorer))}</p><div class="pick">${ps.filter(id => id !== sh.scorer).map(id => `<button data-act="pickassist" data-id="${id}">${esc(pname(id))}</button>`).join('')}<button class="alt" data-act="pickassist" data-id="">도움 없음</button></div>` }
  else if (sh.type === 'mom') { const s = cur(); const t = team(s, sh.k); const c = s.mom?.[sh.k];
    h += `<h4>${esc(t.name)} MOM</h4><p>주장이 고른 선수를 눌러 주세요.</p><div class="pick">${teamPlayers(s, sh.k).map(id => `<button class="${c === id ? 'cur' : ''}" data-act="pickmom" data-id="${id}">${esc(pname(id))}</button>`).join('')}${c ? '<button class="alt" data-act="pickmom" data-id="">선택 취소</button>' : ''}</div>` }
  h += `<div class="row" style="margin-top:14px"><button class="btn" data-act="closesheet">닫기</button></div></div></div>`; return h;
}
const CHANGELOG = [
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
function viewSettings() {
  return `<h2>내 정보<small>이름 + 비밀번호 4자리로 로그인해요</small></h2>${loginCard()}
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
  <p class="note" style="text-align:center;margin:8px 0 0">새 기능이 안 보이면 "최신 버전 확인"을 눌러 주세요.</p>`;
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

function viewMHome() {
  if (S.sub) { const s = cur(); if (!s) { S.sub = null } else {
    const body = S.sub === 'draft' ? (s.draftStatus === 'done' ? vTrade(s) : vDraft(s)) : S.sub === 'poster' ? vNotice(s) : vMatchDay(s);
    if (S.sub === 'draft' && S.dm && s.draftStatus !== 'done') return `<div class="dmroot">${backbar('홈으로')}${vDraft(s)}</div>`;
    return backbar('홈으로') + body } }
  const sid = nextSid(); let h = ''; const fit = S.dm; let dock = '';
  h += `${fit ? '<div class="homefit">' : ''}<div class="dgrid homegrid"><section>`;
  // ── MATCH REVIEW ──
  const last = pastSids().find(id => id !== sid);
  h += `<div class="sec-lab"><span>MATCH REVIEW</span>${last ? `<small>${fmtDate(last)}</small>` : ''}</div>`;
  if (!last) h += `<div class="review empty-r">아직 지난 경기가 없어요.</div>`;
  else { const s = S.sessions[last]; const rows = standings(last); const mt = myTeamIn(s); const top = rows[0]; const tt = team(s, top.k); const done = sessMatches(last).filter(m => m.status === 'done').length;
    const tally = {}; for (const e of Object.values(S.events)) if (e.session === last && !e.og && e.scorer) tally[e.scorer] = (tally[e.scorer] || 0) + 1;
    const best = Math.max(0, ...Object.values(tally)); const scorers = Object.keys(tally).filter(k => tally[k] === best && best > 0);
    const moms = KEYS.map(k => s.mom?.[k]).filter(Boolean);
    h += `<button class="review" data-act="result" data-id="${last}">${done < 9 ? `<div class="rv-note">${done}/9경기 기준</div>` : ''}
      <div class="rv-rows">${rows.map(r => { const t = team(s, r.k); return `<div class="rc-row ${mt === r.k ? 'mine' : ''} ${r.rank === 1 ? 'first' : ''}"><em class="rk rk${r.rank}">${r.rank === 1 ? '🏆' : r.rank}</em>${bib(t.color)}<span class="rcn"><b>${esc(t.name)}</b>${mt === r.k ? '<i class="mytag" title="내 팀">MY</i>' : ''}</span><span class="wdl"><i class="w">${r.w}승</i><i class="d">${r.d}무</i><i class="l">${r.l}패</i></span><span class="pt">${r.pts}점</span></div>` }).join('')}</div>
      <span class="more">경기 결과 자세히 보기 ›</span></button>` }
  h += '</section><section>';
  // ── NEXT MATCH ──
  h += `<div class="sec-lab"><span>NEXT MATCH</span></div>`;
  h += '<div class="nextwrap">';
  if (!sid) h += `<div class="hero"><div class="hero-empty">예정된 경기가 없어요</div><p>새 경기일이 열리면 여기에 보여요.</p></div>`;
  else { S.sid = sid; const s = S.sessions[sid]; const st = sStatus(s); const n = appCounts(s).sel; const cap = s.capacity || 0; const [, m, d] = sid.split('-');
    h += `<div class="hero"><div class="hero-top"><span class="st st-${st.k}">${st.label}</span><span class="dday">${dday(sid)}</span></div>
      <div class="hero-date">${m}.${d}<small>${dow(sid)}요일</small></div><div class="hero-time">${esc(s.time || '')}</div>
      <div class="hero-venue">📍 ${esc(s.venue || '장소 미정')}</div>
      ${st.k === 'open' && s.applyClose ? `<div class="hero-status"><span>${fmtDT(s.applyClose)} 신청 마감</span></div>` : st.k === 'soon' && s.applyOpen ? `<div class="hero-status"><span>${fmtDT(s.applyOpen)} 신청 오픈</span></div>` : ''}
      <div class="cap"><div class="cap-row"><span>신청 인원${fit && (st.k === 'open' || st.k === 'closed') ? ` <button class="linkbtn caplink" data-act="applist">신청자 보기 ›</button>` : ''}${fit && st.k === 'open' && appCounts(s).wait ? ` · 대기 ${appCounts(s).wait}` : ''}</span><b>${n}<small> / ${cap || '-'}명</small></b></div>${cap ? `<div class="bar"><i style="width:${Math.min(100, n / cap * 100)}%"></i></div>` : ''}</div></div>`;
    h += homeAction(s, st, fit);
    if (fit) { const a = applyState(s); if (st.k === 'open' || st.k === 'soon' || (st.k === 'closed' && a.k !== 'none' && s.stage !== 'match')) { const ab = applyBox(s, true); if (ab) h += `<div class="inline-apply">${ab}</div>` } }
  }
  return h + `</div></section></div>${fit ? '</div>' : ''}${dock}`;
}
function homeAction(s, st, fit) {
  const mt = myTeamIn(s); const AB = fit ? () => '' : applyBox;
  if (fit && (st.k === 'open' || st.k === 'soon')) return '';
  if (st.k === 'soon') return `<div class="act"><b>신청 오픈 전이에요</b><p>${fmtDT(s.applyOpen)}부터 앱에서 신청할 수 있어요.</p>${AB(s)}</div>`;
  if (st.k === 'open') { const ac = appCounts(s); const left = (s.capacity || 0) - ac.sel; return `<div class="act"><b>지금 신청 받는 중이에요</b><p>${[s.capacity ? (left > 0 ? `남은 자리 ${left}명` : `정원이 찼어요, 대기 ${ac.wait}명`) : '', s.applyClose ? `${fmtDT(s.applyClose)} 마감` : ''].filter(Boolean).join(', ')}</p>${AB(s)}${(s.applicants || []).length ? `<button class="btn sm" data-act="applist">신청자 보기</button>` : ''}</div>` }
  const capHint = KEYS.some(k => s.captains?.[k]) && !myTeam(s) ? `<button class="linkbtn" data-act="tab" data-v="settings">주장이신가요? 주장 코드 입력 ›</button>` : '';
  const dl = dutyLine(s);
  if (st.k === 'closed') return `<div class="act"><b>신청이 마감됐어요</b>${dl}<p>선발 ${appCounts(s).sel}명으로 드래프트를 준비해요.</p>${AB(s)}${fit ? '' : capsLine(s)}${capHint}<button class="btn sm" data-act="applist">신청자 보기</button></div>`;
  if (st.k === 'draft') { const live = s.draftStatus !== 'done'; return `<div class="act live">${dl}<b>${live ? `<span class="dot"></span> ${s.draftStatus === 'live' ? '지금 드래프트 중이에요' : '드래프트 방이 열렸어요'}` : '팀 밸런스를 맞추는 중이에요'}</b>${fit ? '' : capsLine(s)}<button class="btn primary block" data-act="sub" data-v="draft">${live ? '드래프트 테이블 구경하기' : '팀 구성 보기'}</button>${live ? capHint : ''}</div>` }
  if (st.k === 'teams') return `<div class="act">${dl}<b>팀이 발표됐어요${mt ? `, 나는 ${esc(team(s, mt).name)}` : ''}</b>${fit ? '' : rostersMini(s)}<button class="btn primary block" data-act="sub" data-v="poster">공지 이미지 보기</button></div>`;
  const live = sessMatches(s.date).filter(m => m.status === 'live');
  return `<div class="act live"><b><span class="dot"></span> 경기 진행 중</b>${live.map(m => { const [a, b] = score(m); return `<div class="lv">${bib(team(s, m.home).color)}${esc(team(s, m.home).name)} <b>${a} : ${b}</b> ${esc(team(s, m.away).name)}${bib(team(s, m.away).color)} <span data-clock="${m.id}"></span></div>` }).join('')}<button class="btn primary block" data-act="sub" data-v="match">경기 현황과 순위 보기</button></div>`;
}
function capsLine(s) { const ks = KEYS.filter(k => s.captains?.[k]); return ks.length ? `<div class="caps">${ks.map(k => `${tag(team(s, k))}<span>👑 ${esc(pname(s.captains[k]))}</span>`).join('')}</div>` : '' }
function rostersMini(s) { const me = myPid(); return `<div class="rosters">${KEYS.map(k => { const t = team(s, k); return `<div><div class="rh" style="background:${t.color};color:${inkOn(t.color)}">${esc(t.name)}</div><ul>${teamPlayers(s, k).map((id, i) => `<li class="${id === me ? 'me' : ''}">${i === 0 && captainOf(s, k) === id ? '👑' : ''}${esc(pname(id))}</li>`).join('')}</ul></div>` }).join('')}</div>` }

function schedCard(id, noApply) { let h = '';
  const ids = [id];
  for (const id of ids) { const s = S.sessions[id]; const st = sStatus(s); const now = Date.now();
    const steps = [['신청 오픈', s.applyOpen, s.applyOpen && dt(s.applyOpen) <= now], ['신청 마감', s.applyClose, s.applyClose && dt(s.applyClose) <= now], ['팀 발표', null, stageIdx(s.stage) >= stageIdx('notice')], ['경기', `${id}T${s.time || '00:00'}`, st.k === 'live' || st.k === 'done']];
    const curI = steps.findIndex(x => !x[2]);
    h += `<div class="panel sched"><div class="sched-hd"><div><b>${fmtDate(id)} ${esc(s.time || '')}</b><span>📍 ${esc(s.venue || '')}</span></div><span class="dday sm">${dday(id)}</span></div>
      <ol class="tl">${steps.map(([l, v, done], i) => `<li class="${done ? 'done' : i === curI ? 'now' : ''}"><i></i><span>${l}</span><em>${v ? fmtDT(v) : done ? '완료' : i === 2 ? '신청 마감 후' : '-'}</em></li>`).join('')}</ol>
      <div class="sched-ft"><span class="st st-${st.k}">${st.label}</span><span>신청 ${appCounts(s).sel}${s.capacity ? ' / ' + s.capacity : ''}명${appCounts(s).wait ? `, 대기 ${appCounts(s).wait}` : ''}</span></div>${noApply ? '' : (st.k === 'open' || applyState(s)?.k === 'in' ? `<div style="margin-top:10px">${applyBox(s, true)}</div>` : '')}</div>` }
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

function vResultDetail(s) {
  const sid = s.date; const ms = sessMatches(sid); const done = ms.filter(m => m.status === 'done').length; const rows = standings(sid); const me = myPid();
  const st = `<div class="panel tblwrap"><table class="rdst"><thead><tr><th>순위</th><th class="l">팀</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>득</th><th>실</th><th>득실</th><th>승점</th></tr></thead><tbody>
    ${rows.map(r => { const t = team(s, r.k); return `<tr class="${r.rank === 1 && done === ms.length && ms.length ? 'champ' : ''}"><td class="rank"><em class="rk rk${r.p ? r.rank : 0}">${r.p ? r.rank : '-'}</em></td><td class="l"><span class="teamcell">${bib(t.color)}<b>${esc(t.name)}</b></span></td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}</td><td>${r.ga}</td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td><td class="pts">${r.pts}</td></tr>` }).join('')}</tbody></table></div>
    <p class="note">승 3점, 무 1점. 승점이 같으면 골득실, 다득점, 승자승 순.</p>`;
  const tm = `<div class="rdteams">${KEYS.map(k => { const t = team(s, k); const ps = teamPlayers(s, k); const rk = rows.find(r => r.k === k);
    return `<div class="rdt" style="--tc:${t.color};--ti:${inkOn(t.color)}"><div class="rdt-hd"><b>${esc(t.name)}</b><small>${rk && rk.p ? rk.rank + '위' : ''}</small></div><ul>${ps.map((id, i) => `<li class="${id === me ? 'me' : ''}">${i === 0 && captainOf(s, k) === id ? '<em>C</em>' : ''}${esc(pname(id))}</li>`).join('')}</ul></div>` }).join('')}</div>`;
  const mrowR = m => { const H = team(s, m.home), A = team(s, m.away); const [a, b] = score(m); const win = m.status === 'done' ? (a > b ? 'win-h' : a < b ? 'win-a' : '') : '';
    return `<button class="mrow ${win}" data-act="open" data-id="${m.id}"><span class="side">${bib(H.color)}<span>${esc(H.name)}</span></span><span class="mid"><span class="sc">${m.status === 'pending' ? 'vs' : a + ' : ' + b}</span><span class="st">${m.n}경기${m.status === 'done' ? '' : m.status === 'live' ? ' · 진행 중' : ' · 예정'}</span></span><span class="side r"><span>${esc(A.name)}</span>${bib(A.color)}</span></button>` };
  const rounds = [1, 2, 3].map(r => { const list = ms.filter(m => m.round === r); return list.length ? `<div class="rdround"><h3>${r}라운드</h3><div class="panel">${list.map(mrowR).join('')}</div></div>` : '' }).join('');
  return `<div class="rdgrid"><section class="rd-st"><h2>팀 순위${done === ms.length && ms.length ? '<span class="final">최종</span>' : ''}</h2>${st}</section>
  <section class="rd-tm"><h2>팀 구성</h2>${tm}</section>
  <section class="rd-ms"><h2>경기별 결과</h2>${ms.length ? `<div class="rounds3">${rounds}</div>` : '<div class="panel"><p class="empty">경기 기록이 없어요.</p></div>'}</section></div>`;
}
function viewResults() {
  const ids = pastSids(); if (!ids.length) return `<h2>경기결과</h2><div class="panel"><p class="empty">아직 끝난 경기가 없어요.</p></div>`;
  if (!S.detail || !ids.includes(S.detail)) S.detail = ids[0];
  const i = ids.indexOf(S.detail); const s = S.sessions[S.detail]; S.sid = S.detail; loadOld(S.detail); const older = ids[i + 1], newer = ids[i - 1];
  return `<div class="rdswipe ${S.rdAnim || ''}"><div class="rdnav"><button class="navb" data-act="rdgo" data-id="${older || ''}" ${older ? '' : 'disabled'} aria-label="이전 경기">‹<small>이전</small></button>
    <div class="rdt2"><b>${fmtDate(S.detail)}</b><small>${esc(s.time || '')} · ${esc(s.venue || '')}${s.no ? ` · ${s.no}회` : ''}</small></div>
    <button class="navb" data-act="rdgo" data-id="${newer || ''}" ${newer ? '' : 'disabled'} aria-label="이후 경기"><small>이후</small>›</button></div>
    <div class="rddots">${ids.slice().reverse().map(id => `<i class="${id === S.detail ? 'on' : ''}"></i>`).join('')}</div>${vResultDetail(s)}</div>`;
}

function viewApplicants() { const s = cur(); const me = myPid(); const base = isBase(s);
  if (s.stage === 'apply') { const c = classify(s); const mine = myApp(s);
    // 신청 순서(자동 신청은 맨 앞) — 이름순이 아님
    const ord = arr => [...arr].sort((a, b) => (a.auto === b.auto ? 0 : a.auto ? -1 : 1) || ((typeof a.n === 'number' ? a.n : 1e9) - (typeof b.n === 'number' ? b.n : 1e9)));
    const chip = r => `<span class="chip ${(mine && mine.k === r.k) ? 'sel' : ''}"><small class="muted">${r.auto ? '자동' : r.n}</small> ${r.pid ? esc(pname(r.pid)) : '이름 입력 대기'}${base && r.sel ? `<b class="tb t${r.tier}">${TIER[r.tier]}</b>` : ''}</span>`;
    return backbar('홈으로') + `<h2>선발<small>${c.sel.length}${s.capacity ? ' / ' + s.capacity : ''}명</small></h2><div class="panel"><div class="chips">${ord(c.sel).map(chip).join('') || '<span class="muted">아직 신청자가 없어요.</span>'}</div></div>
    ${c.wait.length ? `<h2>대기<small>${c.wait.length}명</small></h2><div class="panel"><div class="chips">${c.wait.map(chip).join('')}</div></div>` : ''}<p class="note">${base ? '0순위: 구장예약자·경기운영자, 1순위: 직전 경기 미참여자, 2순위: 그 외 선착순, 3순위: 직전 경기 마감 후 취소자. ' : '이 구장은 순위 없이 신청한 순서대로 선발해요. '}숫자는 신청 순서예요.</p>` }
  const chip = (id, i) => `<span class="chip ${id === me ? 'sel' : ''}"><small class="muted">${i + 1}</small> ${esc(pname(id))}</span>`;
  return backbar('홈으로') + `<h2>신청자<small>${(s.applicants || []).length}${s.capacity ? ' / ' + s.capacity : ''}명</small></h2><div class="panel"><div class="chips">${(s.applicants || []).map(chip).join('') || '<span class="muted">아직 신청자가 없어요.</span>'}</div></div>
  ${(s.waitlist || []).length ? `<h2>대기<small>${s.waitlist.length}명</small></h2><div class="panel"><div class="chips">${s.waitlist.map((id, i) => chip(id, i)).join('')}</div></div>` : ''}` }
/* ───────── admin views ───────── */
async function deleteSessionBy(sid) { if (!confirm(fmtDate(sid) + ' 경기를 통째로 지울까요? 신청자, 경기 기록도 함께 지워지고 되돌릴 수 없어요.')) return;
  const ok = await w(async () => { for (const [eid, ev] of Object.entries(S.events)) if (ev.session === sid) await S.store.del('events/' + eid); for (const mm of sessMatches(sid)) await S.store.del(mp(mm.id)); await S.store.del(sp(sid)) }, '삭제했어요.');
  if (ok && S.sid === sid) S.sid = null; render() }
const RUN_STEPS = [['apply', '신청접수'], ['captain', '주장지정'], ['draft', '드래프트'], ['trade', '팀원조정'], ['match', '경기진행'], ['result', '경기결과']];
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
      <td><input class="cell w-num" type="number" min="1" value="${s.no || ''}" placeholder="${nextNoFor(id) || '-'}" title="비어 있으면 이전 회차 다음 번호(${nextNoFor(id) || '없음'})를 추천해요" data-in="cell" data-sid="${id}" data-f="no"></td>
      <td><input class="cell" type="time" value="${esc(s.time || '')}" data-in="cell" data-sid="${id}" data-f="time"></td>
      <td><input class="cell w-venue" type="text" value="${esc(s.venue || '')}" list="venue-list" data-in="cell" data-sid="${id}" data-f="venue"></td>
      <td><input class="cell w-num" type="number" min="3" max="60" value="${s.capacity || ''}" data-in="cell" data-sid="${id}" data-f="capacity"></td>
      <td><button class="cellbtn staffcell" data-act="staffedit" data-id="${id}">${(s.p0 || []).length || (s.ops || []).length ? `<span>예약 ${esc(idsToNames(s.p0) || '-')}</span><span>운영 ${esc(idsToNames(s.ops) || '-')}</span>` : '<span class="muted">+ 지정</span>'}</button></td>
      <td class="num"><b>${appCounts(s).sel}</b>${appCounts(s).wait ? `<small class="muted"> +${appCounts(s).wait}</small>` : ''}</td>
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
  <div class="field"><label>구장 예약자 (0순위, 자동 신청)<input class="inp" type="text" list="mem-list" placeholder="이름 (여러 명은 쉼표로)" value="${esc(f.res || '')}" data-in="calf" data-f="res"></label></div>
  <div class="field"><label>경기 운영자 (0순위, 자동 신청)<input class="inp" type="text" list="mem-list" placeholder="이름 (여러 명은 쉼표로)" value="${esc(f.ops || '')}" data-in="calf" data-f="ops"></label></div>
  <datalist id="mem-list">${Object.values(S.players).map(p => p.name).sort((a, b) => a.localeCompare(b, 'ko')).map(n => `<option value="${esc(n)}">`).join('')}</datalist>
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
  if (step === 'result') h += ms.length ? vResultDetail(s) + `<p class="note">골과 도움은 "경기" 단계에서 각 경기를 눌러 고쳐요.</p>` : `<div class="panel pad" style="margin-top:14px"><p class="empty" style="padding:8px 0">아직 경기 기록이 없어요. 팀 확정 단계에서 경기 일정을 만들거나, 아래 "기록 붙여넣기"로 지난 기록을 넣을 수 있어요.</p></div>`;
  else h += ({ apply: vApply, captain: vCaptain, draft: vDraft, trade: vTrade, match: vMatchDay })[step](s);
  h += `<div class="runtools"><span>경기 도구</span><button class="btn sm" data-act="dutyedit" data-id="${sid}">⚽🥤 당번 지정</button><button class="btn sm" data-act="parkedit" data-id="${sid}">🚗 주차 관리</button><button class="btn sm" data-act="impopen">📋 기록 붙여넣기</button></div>`;
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
const SIM = { apply: ['신청접수', 'apply'], captain: ['주장지정', 'captain'], draft: ['드래프트', 'draft'], trade: ['팀원조정', 'trade'] };
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
const tsMs = v => v == null ? null : typeof v === 'number' ? v : v.toMillis ? v.toMillis() : v.seconds ? v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6) : +v;
function queueApps(s) { const q = S.q?.[s?.date]; if (!q) return []; const open = s.applyOpen ? new Date(s.applyOpen).getTime() : null, close = s.applyClose ? new Date(s.applyClose).getTime() : null;
  return Object.entries(q).map(([id, d]) => ({ k: 'q' + id, q: id, pid: d.pid || null, uid: d.uid, at: tsMs(d.at) ?? d.tap ?? 0, srv: true })).filter(a => (!open || a.at >= open - 1500) && (!close || a.at <= close)) }
function ensureQueues() { if (!S.store) return; S.qUn ??= {}; S.q ??= {}; const want = new Set(Object.keys(S.sessions).filter(id => ['apply', 'captain'].includes(S.sessions[id].stage) && id >= today()));
  for (const id of Object.keys(S.qUn)) if (!want.has(id)) { try { S.qUn[id]() } catch { } delete S.qUn[id]; delete S.q[id] }
  for (const id of want) if (!S.qUn[id]) S.qUn[id] = S.store.watchCol(sp(id) + '/q', docs => { const o = {}; docs.forEach(d => { const { id: di, ...r } = d; o[di] = r }); S.q[id] = o; renderSoon() }, { est: true }, () => { }) }
function appsOf(s) { const qa = queueApps(s); if (qa.length) { const base = Array.isArray(s.apps) ? s.apps : appsOf0(s); return appsOf0({ ...s, apps: [...base, ...qa] }) } return appsOf0(s) }
function appsOf0(s) { if (Array.isArray(s.apps)) { const seen = new Set(); return s.apps.filter(a => a && typeof a === 'object').map((a, i) => ({ a, i })).sort((x, y) => ((x.a.at || 0) - (y.a.at || 0)) || (x.i - y.i)).map(x => x.a).filter(a => { if (!a.pid) return true; if (seen.has(a.pid)) return false; seen.add(a.pid); return true }).map((a, i) => ({ a, i })).sort((x, y) => { const O = s.appOrder; if (!Array.isArray(O) || !O.length) return x.i - y.i; const rx = O.indexOf(x.a.k), ry = O.indexOf(y.a.k); return (rx < 0 ? O.length + x.i : rx) - (ry < 0 ? O.length + y.i : ry) }).map(x => x.a) } return [...(s.applicants || []), ...(s.waitlist || [])].map((pid, i) => ({ k: 'L' + i, pid, at: 0 })) }
function prevSessionId(s) { const ids = Object.keys(S.sessions).filter(id => id < s.date).sort().reverse(); return ids.find(id => KEYS.some(k => teamPlayers(S.sessions[id], k).length)) || null }
function staffSet(s) { return new Set([...(s.p0 || []), ...(s.ops || []), ...Object.entries(S.players).filter(([, p]) => p.staff).map(([id]) => id)]) }
function autoIds(s) { return [...new Set([...(s.p0 || []), ...(s.ops || [])])].filter(id => S.players[id]) }
function roleOf(s, id) { return (s.p0 || []).includes(id) ? '구장 예약자' : (s.ops || []).includes(id) ? '경기 운영자' : S.players[id]?.staff ? '운영진' : '' }
async function namesToIds(txt) { const out = []; for (const nm of (txt || '').split(/[,，、\n]+/).map(x => x.trim()).filter(Boolean)) { const id = await ensurePlayer(nm); if (id && !out.includes(id)) out.push(id) } return out }
function idsToNames(ids) { return (ids || []).map(id => S.players[id]?.name).filter(Boolean).join(', ') }
const CL_CACHE = new WeakMap();
function classify(s) { const key = S.q?.[s?.date]; const c = s && CL_CACHE.get(s); if (c && c.q === key && c.p === S.players && c.ss === S.sessions && c.m === S.matches) return c.r; const r = classify0(s); if (s) CL_CACHE.set(s, { q: key, p: S.players, ss: S.sessions, m: S.matches, r }); return r }
function classify0(s) {
  const apps = appsOf(s); const prev = prevSessionId(s); const played = prev ? new Set(KEYS.flatMap(k => teamPlayers(S.sessions[prev], k))) : null; const staff = staffSet(s); const late = lateSet(s);
  const base = isBase(s); const applied = new Set(apps.map(a => a.pid).filter(Boolean));
  const autos = (base ? autoIds(s) : []).filter(id => !applied.has(id)).map(id => ({ k: 'auto-' + id, pid: id, auto: true, n: 0, tier: 0 }));
  const rows = [...autos, ...apps.map((a, i) => ({ ...a, n: i + 1, tier: !base ? 2 : a.tier != null ? a.tier : !a.pid ? 2 : staff.has(a.pid) ? 0 : late.has(a.pid) ? 3 : (played && !played.has(a.pid)) ? 1 : 2 }))];
  const cap = s.capacity || Infinity; const sel = new Set();
  for (const t of [0, 1, 2, 3]) for (const r of rows) if (r.tier === t && ((t === 0 && base) || sel.size < cap)) sel.add(r.k);
  rows.forEach(r => r.sel = sel.has(r.k)); const wait = rows.filter(r => !r.sel); wait.forEach((r, i) => r.wn = i + 1);
  return { rows, sel: rows.filter(r => r.sel).sort((a, b) => a.tier - b.tier || a.n - b.n), wait, prev, base };
}
function appCounts(s) { if ((!Array.isArray(s.apps) && !autoIds(s).length) || s.stage !== 'apply') return { sel: (s.applicants || []).length, wait: (s.waitlist || []).length }; const c = classify(s); return { sel: c.sel.length, wait: c.wait.length } }
function myApp(s) { const uid = myUid(), me = myPid(); return appsOf(s).find(a => me ? a.pid === me : (!a.pid && a.uid && a.uid === uid)) || (me && autoIds(s).includes(me) ? { k: 'auto-' + me, pid: me, auto: true } : null) }
function applyState(s) { const me0 = myPid(); if (me0 && s.stage === 'apply' && isBase(s) && autoIds(s).includes(me0)) return { k: 'in', auto: true, tier: 0, role: roleOf(s, me0) }; const a = myApp(s); if (!a) return { k: 'none' }; if (s.stage !== 'apply') { if ((s.applicants || []).includes(a.pid)) return { k: 'in', tier: null }; return { k: 'wait', n: (s.waitlist || []).indexOf(a.pid) + 1 } }
  const r = classify(s).rows.find(x => x.k === a.k); if (!r) return { k: 'none' }; return r.sel ? { k: 'in', tier: r.tier, n: r.n, noname: !a.pid, key: a.k, auto: !!r.auto, role: roleOf(s, a.pid) } : { k: 'wait', n: r.wn, order: r.n, noname: !a.pid, key: a.k } }
function applyBox(s, compact) {
  const st = sStatus(s); const a = applyState(s); const c = appCounts(s);
  const nameBtn = a.noname ? `<button class="btn sm primary" data-act="appname" data-id="${s.date}">이름 입력하기</button>` : '';
  if (st.k === 'soon') return `<button class="btn block" disabled>${fmtDT(s.applyOpen)}에 신청이 열려요</button>`;
  if (a.k === 'in' && a.auto) return `<div class="applied"><span>✓ 자동 신청 · 0순위<small>${a.role}(으)로 자동 참가 신청돼 있어요. 빠지려면 운영진에게 ${a.role} 해제를 요청해 주세요.</small></span></div>${(() => { const x = parkBox(s) + dutyBox(s); return x ? `<div class="extras">${x}</div>` : '' })()}`;
  const canLate = !a.auto && st.k !== 'open' && s.draftStatus === 'ready' && ['apply', 'captain'].includes(s.stage);
  if (a.k === 'in') return `<div class="applied"><span>✓ 신청 완료${a.tier != null && isBase(s) ? ` · ${TIER[a.tier]}` : ''}<small>${a.noname ? `${a.n}번째 신청 순번을 확보했어요. 이름을 입력해 주세요!` : a.n ? `${a.n}번째로 신청했어요` : '이번 경기 참가자예요'}</small></span>${nameBtn}${st.k === 'open' ? `<button class="btn sm" data-act="applycancel" data-id="${s.date}">취소</button>` : canLate ? `<button class="btn sm" data-act="applycancel" data-id="${s.date}">참가 취소</button>` : ''}</div>${a.noname ? '' : (() => { const x = parkBox(s) + dutyBox(s); return x ? `<div class="extras">${x}</div>` : '' })()}`;
  if (a.k === 'wait') return `<div class="applied wait"><span>대기 ${a.n}번<small>${a.noname ? '이름을 입력해 주세요!' : st.k === 'open' ? '자리가 나면 자동으로 선발돼요' : '신청이 마감됐어요'}</small></span>${nameBtn}${st.k === 'open' ? `<button class="btn sm" data-act="applycancel" data-id="${s.date}">취소</button>` : ''}</div>`;
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
    toast(pos > 0 ? `${pos}번째 신청 순번을 확보했어요!` : '신청했어요!'); if (!pid) { S.sheet = { type: 'appname', sid, key: entry.k }; render() } return }
  if (slow) { toast('연결이 느려서 저장을 기다리고 있어요. 앱을 닫지 말고 잠시만 기다려 주세요.'); return }
  console.error(err); toast(errMsg(err).replace(/\.$/, '') + '. 신청이 저장되지 않았어요. 다시 눌러 주세요.');
}
async function setAppName(sid, key, name) {
  name = name.replace(/\(\s*게\s*\)/g, '').trim().slice(0, 20); if (!name) return false; const guest = false;
  let pid = findPlayer(name); if (!pid && !S.admin) { toast('회원 명단에 없는 이름이에요.'); return false } if (!pid) { if (!confirm(`"${name}" 이름이 회원 명단에 없어요. 새 회원으로 등록할까요?`)) return false; pid = await S.store.add('players', { name, guest, status: 'active', createdAt: Date.now() }); S.players[pid] = { name } }
  let merged = false;
  const ok = await w(() => S.store.txn(sp(sid), d => { if (!d) return null; const apps = appsOf(d); const i = apps.findIndex(a => a.k === key); if (i < 0) return null;
    const j = apps.findIndex(a => a.pid === pid && a.k !== key);
    if (j >= 0) { if (j < i) { apps.splice(i, 1) } else { apps[i] = { ...apps[i], pid }; apps.splice(j, 1) } merged = true } else apps[i] = { ...apps[i], pid };
    d.apps = apps; return d }));
  if (ok) { if (!S.admin) { S.me = name; save('me', name) } toast(merged ? '이미 신청된 이름이라 앞선 순번 하나로 합쳤어요.' : `${name} 이름으로 신청됐어요.`) }
  return ok;
}
async function freezeApps(s) {
  if ((!Array.isArray(s.apps) && !autoIds(s).length) || s.stage !== 'apply') return true; const c = classify(s); const nn = c.rows.filter(r => !r.pid).length;
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
function dutyReqLabel(s) { const b = dutyReqs(s, 'ball').length, d = dutyReqs(s, 'drink').length; return b || d ? `신청 공 ${b} · 물 ${d}` : '' }
function dutyBox(s) {
  const me = myPid(); if (!me || s.stage === 'match') return ''; const d = s.duty || {}; const rq = s.dutyReq || {};
  const one = (k, ico, nm) => { const set = d[k] || []; if (set.length) return set.includes(me) ? `<span class="xpill fixed"><b>${ico} ${nm}</b><small>지정됐어요</small></span>` : '';
    const on = !!rq[k]?.[me]; return `<button class="xpill ${on ? 'on' : ''}" data-act="dutyreq" data-k="${k}" data-id="${s.date}" aria-pressed="${on}"><b>${ico} ${nm}</b><small>${on ? '신청함 ✓' : '신청하기'}</small></button>` };
  return one('ball', '⚽', '공당') + one('drink', '🥤', '물당');
}
function parkBox(s) {
  const me = myPid(); if (!me) return ''; const mine = s.park?.[me]; const won = (s.parkWin || []).includes(me); const drawn = !!s.parkDrawAt; const open = sStatus(s).k === 'open';
  const pill = (cls, sub, attrs) => `<${attrs ? 'button' : 'span'} class="xpill ${cls}" ${attrs || ''}><b>🚗 주차</b><small>${sub}</small></${attrs ? 'button' : 'span'}>`;
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
async function cancelApp(sid, pid, key, byAdmin) {
  const s = S.sessions[sid]; if (!s) return; const closed = applyClosed(s);
  if (s.draftStatus !== 'ready' || !['apply', 'captain'].includes(s.stage)) { toast(byAdmin ? '드래프트가 시작된 뒤에는 여기서 취소할 수 없어요.' : '드래프트가 시작돼서 앱에서 취소할 수 없어요. 운영진에게 알려 주세요.'); return }
  const wasSel = s.stage === 'apply' ? classify(s).sel.some(r => (key && r.k === key) || (pid && r.pid === pid)) : (s.applicants || []).includes(pid);
  const penal = closed && wasSel && pid;
  if (!confirm(penal ? `${byAdmin ? pname(pid) + ' 님의 ' : ''}신청 마감 후 취소예요. 취소하면 다음 경기 신청 때 3순위가 돼요. 그래도 취소할까요?` : '신청을 취소할까요?')) return;
  const qdel = Object.entries(S.q?.[sid] || {}).filter(([qi, d]) => (pid && d.pid === pid) || (key && 'q' + qi === key)).map(([qi]) => qi);
  if (qdel.length && !Array.isArray(s.apps)) { if (!(await w(() => Promise.all(qdel.map(qi => withTimeout(S.store.del(sp(sid) + '/q/' + qi), 10000)))))) return; if (!(s.applicants || []).includes(pid) && !appsOf0(s).some(a => a.pid === pid)) { await clearExtras(sid, pid); toast('취소했어요.'); render(); return } }
  if (s.stage === 'apply' && Array.isArray(s.apps)) {
    const vals = s.apps.filter(a => a && ((key && a.k === key) || (pid && a.pid === pid))); const set = {};
    if (pid && s.park?.[pid]) set[`park.${pid}`] = null; if (penal) set[`late.${pid}`] = Date.now();
    const remove = { apps: vals }; if (pid && (s.duty?.ball || []).includes(pid)) remove['duty.ball'] = [pid]; if (pid && (s.duty?.drink || []).includes(pid)) remove['duty.drink'] = [pid];
    if (pid && s.dutyReq?.ball?.[pid]) set[`dutyReq.ball.${pid}`] = null; if (pid && s.dutyReq?.drink?.[pid]) set[`dutyReq.drink.${pid}`] = null;
    const qids = Object.entries(S.q?.[sid] || {}).filter(([qi, d]) => (pid && d.pid === pid) || (key && 'q' + qi === key)).map(([qi]) => qi);
    const ok2 = await w(async () => { await Promise.all(qids.map(qi => withTimeout(S.store.del(sp(sid) + '/q/' + qi), 10000))); if (vals.length || Object.keys(set).length || remove['duty.ball'] || remove['duty.drink']) await withTimeout(S.store.patch(sp(sid), { set, remove }), 10000) });
    if (ok2) toast(penal ? '취소했어요. 마감 후 취소로 기록됐어요.' : '취소했어요.'); render(); return }
  const ok = await w(() => S.store.txn(sp(sid), d => { if (!d || d.draftStatus !== 'ready' || !['apply', 'captain'].includes(d.stage)) return null;
    d.apps = appsOf(d).filter(a => !((key && a.k === key) || (pid && a.pid === pid)));
    if (d.stage !== 'apply') { const was = (d.applicants || []).includes(pid); d.applicants = (d.applicants || []).filter(x => x !== pid); d.waitlist = (d.waitlist || []).filter(x => x !== pid); if (was && d.waitlist.length) d.applicants.push(d.waitlist.shift()); KEYS.forEach(k => { if (d.captains?.[k] === pid) d.captains[k] = null }) }
    if (pid && d.park?.[pid]) d.park[pid] = null;
    if (pid && d.duty) ['ball', 'drink'].forEach(k => { if (d.duty[k]) d.duty[k] = d.duty[k].filter(x => x !== pid) });
    if (pid && d.dutyReq) ['ball', 'drink'].forEach(k => { if (d.dutyReq[k]?.[pid]) d.dutyReq[k][pid] = null });
    if (penal) d.late = { ...(d.late || {}), [pid]: Date.now() };
    return d }));
  if (ok) { const s2 = S.sessions[sid]; if (!byAdmin && pid && isBase(s) && autoIds(s2 || s).includes(pid)) toast(`신청은 취소했지만 ${roleOf(s2 || s, pid)}(이)라 자동 참가로 남아 있어요. 운영진에게 해제를 요청해 주세요.`); else toast(penal ? '취소했어요. 마감 후 취소로 기록됐어요.' : '취소했어요.') }
}
function vApplyTable(s) {
  const ad = S.admin; const c = classify(s); const frozen = s.stage !== 'apply'; const closed = applyClosed(s); const late = lateSet(s); const prevAny = prevAnyId(s);
  let rows = [...c.sel, ...c.wait];
  if (frozen) { const A = s.applicants || [], W = s.waitlist || []; rows = [...A.map(pid => ({ ...(c.rows.find(r => r.pid === pid) || { k: 'f' + pid, pid, tier: 2, n: '-' }), sel: true })), ...W.map((pid, i) => ({ ...(c.rows.find(r => r.pid === pid) || { k: 'w' + pid, pid, tier: 2, n: '-' }), sel: false, wn: i + 1 }))] }
  const tb = t => c.base ? `<b class="t${t}">${TIER[t]}</b>` : '<b class="t2">선착순</b>';
  const dline = (k, ico, nm) => { const req = Object.entries(s.dutyReq?.[k] || {}).filter(([, v]) => v).sort((a, b) => a[1] - b[1]).map(([p]) => p); const fix = s.duty?.[k] || [];
    return `<div class="dsum-row"><b>${ico} ${nm}</b><span>${fix.length ? `<em class="ok">지정</em> ${fix.map(p => esc(pname(p))).join(', ')}` : '<em class="muted">미지정</em>'}</span><span>${req.length ? `🙋 신청 ${req.length}명 · ${req.map(p => esc(pname(p))).join(', ')}` : '<span class="muted">신청 없음</span>'}</span>${ad ? `<button class="btn sm" data-act="dutyedit" data-id="${s.date}">${applyClosed(s) ? '지정하기' : '신청 현황'}</button>` : ''}</div>` };
  const stale = ad ? staleExtraPids(s) : [];
  const dsum = `<div class="panel dsum">${dline('ball', '⚽', '공당')}${dline('drink', '🥤', '물당')}${stale.length ? `<div class="dsum-row stale"><b>⚠️ 정리</b><span>신청자가 아닌 ${stale.map(p => esc(pname(p))).join(', ')} 님의 주차·공당·물당 기록이 남아 있어요.</span><span></span><button class="btn sm danger" data-act="stalefix">정리하기</button></div>` : ''}</div>`;
  const betaNote = ad && !frozen && betaOn() ? `<div class="betatools"><button class="btn sm primary" data-act="kakaopaste">📷 카톡 투표 명단 반영</button>${Array.isArray(s.appOrder) && s.appOrder.length ? '<button class="btn sm" data-act="orderreset">↺ 실제 신청 순서로 되돌리기</button>' : ''}</div><p class="note betanote">🧪 베타테스트 기간이라 신청 순번을 바꿀 수 있어요. ▲▼로 한 칸씩, #으로 원하는 자리로 옮겨요. 0~3순위 규칙은 그대로라 같은 순위 안에서만 옮겨져요. (설정에서 정식 오픈하면 잠겨요)</p>` : '';
  const h = dsum + betaNote + `<div class="panel sheetwrap"><table class="grid atbl"><thead><tr><th>신청순</th><th class="stick">이름</th><th>순위</th><th>구분</th><th>신청 시각</th>${ad && !frozen && betaOn() ? '<th>순번 변경</th>' : ''}<th>주차</th><th>공당</th><th>물당</th><th>상태</th><th>마감 후 취소</th>${ad ? '<th>관리</th>' : ''}</tr></thead><tbody>
  ${rows.length ? rows.map(r => { const pk = r.pid && s.park?.[r.pid]?.car;
    return `<tr class="${r.sel ? '' : 'wrow'}"><td class="num">${r.auto ? '자동' : r.n}</td><td class="stick"><b>${r.pid ? esc(pname(r.pid)) : '<i class="nn">이름 입력 대기</i>'}</b>${(() => { const [k, t] = appSrc(s, r); return k === 'auto' ? '' : `<span class="src src-${k}">${t}</span>` })()}</td><td>${tb(r.tier)}</td>
      <td class="muted">${r.auto ? roleOf(s, r.pid) + ' (자동)' : r.pid ? (roleOf(s, r.pid) || (late.has(r.pid) ? '지난 경기 마감 후 취소' : '')) : ''}</td>
      <td class="num muted">${r.at ? fmtTS(r.at) : '-'}</td>
      ${ad && !frozen && betaOn() ? `<td class="mv">${r.auto ? '' : `<button class="btn sm" data-act="appmove" data-k="${r.k}" data-d="-1" aria-label="위로">▲</button><button class="btn sm" data-act="appmove" data-k="${r.k}" data-d="1" aria-label="아래로">▼</button><button class="btn sm" data-act="appmoveto" data-k="${r.k}" aria-label="순번 입력">#</button>`}</td>` : ''}
      <td class="muted">${pk ? `🚗 ${esc(pk)}` : ''}</td>${['ball', 'drink'].map(k => { const fixed = r.pid && (s.duty?.[k] || []).includes(r.pid), req = r.pid && s.dutyReq?.[k]?.[r.pid]; return `<td class="num">${fixed ? '<b class="ok">✓ 지정</b>' : req ? '<span class="dreq">🙋 신청</span>' : ''}</td>` }).join('')}<td>${r.sel ? '<b class="ok">선발</b>' : `<b class="tw">대기 ${r.wn}</b>`}</td>
      <td class="num"><input type="checkbox" class="staffck" ${ad && closed && r.pid && !r.auto ? `data-in="latetoggle" data-id="${r.pid}"` : 'disabled'} aria-label="마감 후 취소"></td>
      ${ad ? `<td class="acts">${r.pid && !r.auto ? `<button class="btn sm" data-act="p0toggle" data-id="${r.pid}">${(s.p0 || []).includes(r.pid) ? '예약자 해제' : '예약자'}</button>` : ''}${r.auto ? `<button class="btn sm" data-act="staffedit" data-id="${s.date}">변경</button>` : ''}${!r.pid ? `<button class="btn sm" data-act="appnameadmin" data-id="${r.k}">이름</button>` : ''}${closed && r.pid && !r.auto ? `<button class="btn sm danger" data-act="latecancel" data-id="${r.pid}">${r.sel ? '마감 후 취소' : '대기 취소'}</button>` : ''}${!closed && !frozen && !r.auto ? `<button class="btn sm danger" data-act="apprm" data-id="${r.k}" aria-label="삭제">×</button>` : ''}</td>` : ''}</tr>` }).join('') : `<tr><td colspan="11" class="empty">아직 신청자가 없어요.</td></tr>`}${Object.entries(s.late || {}).filter(([, v]) => v).map(([pid, t]) => `<tr class="lrow"><td class="num">-</td><td class="stick"><b>${esc(pname(pid))}</b></td><td></td><td class="muted">신청 마감 후 취소</td><td class="num muted">${fmtTS(t)}</td><td></td><td><b class="t3">취소</b></td><td class="num"><input type="checkbox" class="staffck" checked ${ad ? `data-in="lateuntoggle" data-id="${pid}"` : 'disabled'} aria-label="마감 후 취소 해제"></td>${ad ? '<td></td>' : ''}</tr>`).join('')}</tbody></table></div>`;
  const lc = Object.entries(s.late || {}).filter(([, v]) => v);
  return h
    + `<p class="note">선발 ${c.sel.length}${s.capacity ? ' / ' + s.capacity : ''}명, 대기 ${c.wait.length}명. ${c.base ? '' : '<b>The Base 구장이 아니라서 순위 없이 신청 순서대로(선착순) 선발해요.</b> '}The Base 구장 순위: 0순위 구장 예약자·경기 운영자(정원 무관) → 1순위 직전 경기 미참여 → 2순위 선착순 → 3순위 직전 경기(${prevAny ? fmtDate(prevAny) : '없음'}) 신청 마감 후 취소자. 같은 순위 안에서는 신청 순서대로예요.</p>`;
}

/* ───────── monthly schedule poster ───────── */
function monthsWithSessions() { return [...new Set(Object.keys(S.sessions).map(id => id.slice(0, 7)))].sort() }
function defaultMonth() { const ms = monthsWithSessions(); const t = today().slice(0, 7); const d = new Date(); const nx = `${d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear()}-${p2(d.getMonth() === 11 ? 1 : d.getMonth() + 2)}`; return ms.includes(nx) ? nx : ms.includes(t) ? t : ms[ms.length - 1] || t }
function schedCfg() { return { tag: 'WEEKDAYS FUTSAL CLUB', footer: '', ...(S.meta?.sched || {}) } }
function md(id) { const [, m, d] = id.split('-'); return `${+m}/${+d}(${dow(id)})` }
async function drawSchedule(ym) {
  const ss0 = Object.keys(S.sessions).filter(id => id.startsWith(ym)); const fl = schedCfg().footer.split('\n').filter((l, i, a) => i < 8).length;
  const W = 1080, H = Math.max(1515, 895 + 124 + 66 * Math.max(6, ss0.length) + 80 + fl * 50 + 50); const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const ssT = Object.keys(S.sessions).filter(id => id.startsWith(ym)).map(id => S.sessions[id]);
  const PF = await posterFonts([schedCfg().footer, schedCfg().tag, ...ssT.map(x => (x.venue || '') + idsToNames(x.p0))]);
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
async function refreshSchedule() { const ym = S.schedYm || defaultMonth(); const c = await drawSchedule(ym); (S.schedImg ??= {})[ym] = c.toDataURL('image/png'); const el = document.querySelector('img.schedimg'); if (el) el.src = S.schedImg[ym]; else render() }
async function shareBlob(b, name, download) {
  const file = new File([b], name, { type: 'image/png' });
  if (!download && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return } catch (e) { if (e.name === 'AbortError') return } }
  if (S.store?.dl) { try { await S.store.dl.save({ filename: name, data: b }); toast('이미지를 저장했어요.') } catch (e) { if (e?.code !== 'declined') toast('이 화면에서는 저장할 수 없어요.') } return }
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000); toast('이미지를 저장했어요.');
}
function schedPanel() {
  const ms = monthsWithSessions(); const ym = S.schedYm || defaultMonth(); const img = S.schedImg?.[ym]; if (!img) queueMicrotask(refreshSchedule); const cf = schedCfg();
  const ss = Object.keys(S.sessions).filter(id => id.startsWith(ym)); const noNo = ss.filter(id => !S.sessions[id].no).length;
  return `<h2>월별 일정표<small>한 달 일정을 한 장으로</small></h2><div class="dgrid"><section>
    <img class="poster schedimg" alt="${ym} 월별 일정표 미리보기" src="${img || ''}" width="1080" height="1515">
    <div class="row" style="margin-top:10px"><button class="btn primary" data-act="schedshare">공유하기</button><button class="btn" data-act="scheddl">이미지 저장</button></div></section>
    <section><div class="panel"><div class="field"><label for="sch-ym">월 선택</label><select id="sch-ym" class="inp" data-in="schedym">${ms.map(x => `<option value="${x}" ${x === ym ? 'selected' : ''}>${x.replace('-', '년 ')}월 (${Object.keys(S.sessions).filter(id => id.startsWith(x)).length}경기)</option>`).join('')}</select></div>
    <div class="field"><label for="sch-tag">왼쪽 위 문구</label><input id="sch-tag" class="inp" type="text" value="${esc(cf.tag)}" data-in="schedf" data-f="tag"></div>
    <div class="field"><label for="sch-ft">아래 안내 문구 (줄바꿈으로 여러 줄)</label><textarea id="sch-ft" class="inp" data-in="schedf" data-f="footer" placeholder="회장 홍길동 : 010-0000-0000&#10;※매달 변경 가능성 있음">${esc(cf.footer)}</textarea></div></div>
    <p class="note">경기관리에 입력한 일정(회차, 날짜·시간, 장소, 신청 오픈, 구장 예약자)으로 자동으로 만들어져요.${noNo ? ` 회차가 비어 있는 경기가 ${noNo}개 있어요. 경기관리 표의 "회차" 칸에 입력하면 표에 들어가요.` : ''}</p></section></div>`;
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
  const f = S.imp || (S.imp = { date: '2026-09-29', time: '21:00', venue: '용산 7구장', capacity: 18, text: importTemplate() });
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
function logout() { S.auth = null; saveAuth(null); S.me = ''; save('me', ''); toast('로그아웃했어요.'); render() }
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
function viewNoticeMenu() {
  const nt = S.noticeTab || 'team';
  let h = `<div class="mg-top"><div class="seg pseg" role="tablist">${[['team', '👥 팀 공지'], ['month', '📅 월간 일정표'], ['recruit', '📝 신청 안내 글']].map(([k, n]) => `<button role="tab" data-act="ntab" data-k="${k}" aria-selected="${nt === k}">${n}</button>`).join('')}</div></div>`;
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
  let h = `<div class="mg-top"><div class="seg pseg" role="tablist">${[['cal', '📅 달력'], ['list', '📋 목록']].map(([k, n]) => `<button role="tab" data-act="mview" data-k="${k}" aria-selected="${mv === k}">${n}</button>`).join('')}</div>
    <div class="row" style="gap:6px"><button class="btn sm" data-act="fillnos">회차 자동 채우기</button><button class="btn primary sm" data-act="caladd">＋ 경기 추가</button></div></div>`;
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
    <div class="cal-leg"><span><i class="lg-open"></i>신청 중</span><span><i class="lg-game"></i>경기</span><span><i class="lg-done"></i>종료</span><span>빈 날짜를 누르면 경기를 추가할 수 있어요</span></div></div>`;
  return h + `<div class="schwrap planwrap">${cal}<div class="schdetail">${planSide(S.planSel)}</div></div>`;
}
function planSide(id) {
  const s = S.sessions[id];
  if (!s) return `<div class="panel sched pside"><div class="sched-hd"><div><b>${fmtDate(id)}</b><span>경기가 없는 날이에요</span></div></div><div class="pad0"><button class="btn primary block" data-act="caladdon" data-id="${id}">＋ 이 날 경기 추가</button></div></div>`;
  const st = sStatus(s); const movable = !sessMatches(id).length; const c = appCounts(s);
  const f = (lab, fld, type, extra = '') => `<label class="pf"><span>${lab}</span><input class="inp" type="${type}" value="${esc(s[fld] ?? '')}" data-in="cell" data-sid="${id}" data-f="${fld}" ${extra}></label>`;
  return `<div class="panel sched pside"><div class="sched-hd"><div><b>${fmtDate(id)}${s.no ? ` · ${s.no}회` : ''}</b><span><span class="st st-${st.k}">${st.label}</span> 선발 ${c.sel}${s.capacity ? '/' + s.capacity : ''}명${c.wait ? `, 대기 ${c.wait}` : ''}</span></div><span class="dday sm">${dday(id)}</span></div>
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
function mmCtl(s) { const c = s?.mmCtl; const me = myUid(); if (!c || !c.uid) return { free: true }; return { mine: c.uid === me, stale: Date.now() - (c.beat || 0) > CTL_STALE, name: c.name || '회원' } }
function mmIsCtl() { const s = S.sessions[S.mmSid]; return !!(s && mmCtl(s).mine) }
async function mmTake(sid, force) { const me = myUid(); let ok = false;
  await w(() => S.store.txn(sp(sid), d => { if (!d) return null; const c = d.mmCtl; if (c && c.uid && c.uid !== me && Date.now() - (c.beat || 0) <= CTL_STALE && !force) return null; d.mmCtl = { uid: me, pid: myPid() || null, name: S.me || '회원', at: Date.now(), beat: Date.now() }; ok = true; return d }));
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
    return `<div class="mm">${sw}<div class="mm-hd"><div><b>⚽ 경기모드</b><small>일정 경기</small></div>${picker(null)}</div><div class="mm-empty">⚽<b>${all.length ? '지금 고를 수 있는 경기가 없어요' : '일정 경기 없음'}</b><p>${next ? `다음 경기 <b>${fmtDate(next)} ${esc(S.sessions[next].time || '')}</b>는<br><b>${p2(new Date(nw.open).getHours())}:${p2(new Date(nw.open).getMinutes())}</b>부터(시작 1시간 전) 고를 수 있어요.` : all.length ? '지난 경기는 끝나고 1시간이 지나면 고를 수 없어요.' : '팀 구성이 끝난 경기가 아직 없어요.'}<br>바로 해야 하면 위의 <b>✏️ 직접 설정</b>을 써 주세요.</p></div></div>` }
  S.mmSid = sid; const s = S.sessions[sid]; const ids = all;
  const head = sw + `<div class="mm-hd"><div><b>⚽ 경기모드${s.practice ? ' <span class="prac">연습</span>' : ''}</b><small>${esc(s.venue || '')}</small></div>${picker(sid)}</div>`;
  const ctl = mmCtl(s).mine; const cb = mmCtlBar(s);
  if (!ctl && S.tab === 'mm' && mmCtl(s).free && !(S.mmTry ??= {})[sid]) { S.mmTry[sid] = 1; setTimeout(() => mmTake(sid), 50) }
  let stage = S.mmStage || (!mmReady(s) ? 'pair' : !s.mm?.timed ? 'time' : 'play'); if (!ctl && stage !== 'play') stage = mmReady(s) ? 'play' : 'wait';
  if (stage === 'wait') return `<div class="mm">${head}${cb}<div class="mm-card"><h3>대진 준비 중</h3><p class="mm-note">진행자가 대진과 경기 시간을 정하면 여기에 경기 화면이 나와요.</p></div></div>`;
  if (stage === 'pair') return `<div class="mm">${head}${cb}${mmPairView(s)}</div>`;
  if (stage === 'time') return `<div class="mm">${head}${cb}${mmTimeView(s)}</div>`;
  return `<div class="mm${ctl ? '' : ' ro'}">${head}${cb}${mmPlayView(s, ctl)}</div>`;
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
    <button class="btn primary block mm-go cta" data-act="mmtimesave">설정 완료</button><button class="btn block mm-back" data-act="mmstage" data-v="pair">← 이전 화면</button></div>`;
}
function mmPlayView(s, ctl) {
  const ms = sessMatches(s.date); const curM = ms.find(x => x.status === 'live') || ms.find(x => x.status === 'pending') || ms[ms.length - 1]; const m = (ctl && S.mmSel && ms.find(x => x.id === S.mmSel)) || curM; const editing = m.status === 'done' && m.id !== curM.id || (m.status === 'done' && S.mmSel === m.id);
  const H = team(s, m.home), A = team(s, m.away); const [hs, as] = score(m); const ci = clockInfo(m); const run = !!m.timer?.running; const T = timing(s);
  const evs = Object.entries(S.events).filter(([, e]) => e.match === m.id).sort((a, b) => a[1].at - b[1].at);
  const allDone = ms.every(x => x.status === 'done');
  let h = `<div class="mm-play">${editing ? `<div class="mm-edit">✏️ <b>${m.n}경기(종료) 점수 수정 중</b><button class="btn sm" data-act="mmsel" data-id="">현재 경기로 ›</button></div>` : ''}<div class="mm-meta"><span>${m.round}라운드 · ${m.n}경기 <small>/ 9</small></span>${ctl ? `<button class="linkbtn" data-act="mmstage" data-v="time">⏱ 시간 ${T.h1 / 60}+${T.gk}″+${T.h2 / 60}</button>` : `<span class="muted">⏱ ${T.h1 / 60}+${T.gk}″+${T.h2 / 60}</span>`}</div>
    <div class="mm-board"><div class="mm-team" style="--tc:${H.color};--ti:${inkOn(H.color)}"><b>${esc(H.name)}</b><em>${hs}</em>${ctl && (m.status === 'live' || editing) ? `<button class="mm-goal" data-act="mmgoal" data-id="${m.id}" data-k="${m.home}">+ 골</button><button class="mm-ungoal" data-act="mmungoal" data-id="${m.id}" data-k="${m.home}" ${hs ? '' : 'disabled'}>− 골 취소</button>` : ''}</div>
      <div class="mm-mid"><div class="mm-clock ${ci.phase}" data-bigclock="${m.id}">${ci.time}</div><div class="mm-ph" data-phase="${m.id}">${ci.label}</div>
        <div class="mm-bar">${[0, 1, 2].map(i => `<i class="${i === 1 ? 'gk' : ''}"><b data-seg="${m.id}:${i}"></b></i>`).join('')}</div>${ctl && m.status === 'pending' ? `<button class="mm-side" data-act="mmsidesw" data-id="${m.id}" aria-label="양 팀 좌우 위치 바꾸기">⇄ 진영 변경</button>` : ''}</div>
      <div class="mm-team" style="--tc:${A.color};--ti:${inkOn(A.color)}"><b>${esc(A.name)}</b><em>${as}</em>${ctl && (m.status === 'live' || editing) ? `<button class="mm-goal" data-act="mmgoal" data-id="${m.id}" data-k="${m.away}">+ 골</button><button class="mm-ungoal" data-act="mmungoal" data-id="${m.id}" data-k="${m.away}" ${as ? '' : 'disabled'}>− 골 취소</button>` : ''}</div></div>
    <div class="mm-ctl">${!ctl ? (allDone ? `<div class="mm-done">🎉 오늘 9경기가 모두 끝났어요!</div>` : '') : editing ? '' : m.status === 'pending' ? `<button class="btn primary mm-big cta" data-act="mmstart" data-id="${m.id}">▶ 경기 시작</button>`
      : m.status === 'live' ? `${run ? `<button class="btn mm-big" data-act="mmpause" data-id="${m.id}">⏸ 일시정지</button>` : `<button class="btn primary mm-big" data-act="mmresume" data-id="${m.id}">▶ 재개</button>`}<button class="btn ${ci.phase === 'full' ? 'primary' : ''} mm-big" data-act="mmend" data-id="${m.id}">경기 종료</button>`
      : allDone ? `<div class="mm-done">🎉 오늘 9경기가 모두 끝났어요!</div>` : ''}</div>
    <div class="mm-list">${ms.map(x => { const [a, b] = score(x); const X = team(s, x.home), Y = team(s, x.away); return `<button class="mm-li ${x.id === m.id ? 'cur' : ''} st-${x.status}" data-act="mmsel" data-id="${x.status === 'done' ? x.id : ''}" ${ctl && (x.status === 'done' || x.id === curM.id) ? '' : 'disabled'} aria-label="${x.n}경기${x.status === 'done' ? ' 점수 수정' : ''}"><em>${x.n}</em><i style="background:${X.color}"></i><span>${x.status === 'pending' ? 'vs' : a + ':' + b}</span><i style="background:${Y.color}"></i></button>` }).join('')}</div>
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
  const ctx = audio(); keepAwake(true); if (ctx && ctx.state === 'suspended') ctx.resume();
  if (ctx && S.whistle) { const t0 = ctx.currentTime + .05; beepAt(t0, 1320, .18); beepAt(t0 + 1, 1320, .18); beepAt(t0 + 2, 1320, .18); let t = t0 + 3; blowN(t, .9) } let n = 3; const ov = document.createElement('div'); ov.className = 'mm-cd'; document.body.appendChild(ov);
  const step = () => { if (n > 0) { ov.innerHTML = `<b>${n}</b>`; try { navigator.vibrate?.(80) } catch { } n--; setTimeout(step, 1000) } else { ov.innerHTML = '<b class="go">START</b>'; setTimeout(() => ov.remove(), 600); S.startBlown[m.id] = Date.now(); if (!ctx || !S.whistle) whistle([.9]); startClock(m) } };
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
const SCHED = {}; let KEEP = null;
function blowN(t, d) { const ctx = AC; const nodes = []; const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = 'square'; o2.type = 'sawtooth'; o1.frequency.value = 2900; o2.frequency.value = 2980;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 34; const fm = ctx.createGain(); fm.gain.value = 180; lfo.connect(fm); fm.connect(o1.frequency); fm.connect(o2.frequency);
  const amp = ctx.createGain(); amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(.95, t + .02); amp.gain.setValueAtTime(.95, t + d - .05); amp.gain.linearRampToValueAtTime(0, t + d);
  o1.connect(amp); o2.connect(amp); amp.connect(MASTER); [o1, o2, lfo].forEach(o => { o.start(t); o.stop(t + d + .05); nodes.push(o) }); return nodes }
function scheduleWhistles() {
  const sid = S.mmSid || S.sid; if (!sid || !S.sessions[sid]) return; let anyRun = false;
  const canBlow = mmIsCtl() || (S.admin && !!S.openMatch);
  for (const m of sessMatches(sid)) { const run = canBlow && m.status === 'live' && m.timer?.running; const sig = run ? m.timer.startedAt + ':' + (m.timer.acc || 0) : '';
    if (run) anyRun = true; if ((S.schedSig[m.id] || '') === sig) continue;
    (SCHED[m.id] || []).forEach(n => { try { n.stop() } catch { } }); SCHED[m.id] = []; S.schedSig[m.id] = sig;
    if (CAP()?.LocalNotifications) { nativeSchedule(m, timing(S.sessions[sid]), run); continue }
    if (!run || !S.whistle) continue; const ctx = audio(); if (!ctx) continue; if (ctx.state === 'suspended') ctx.resume();
    const T = timing(S.sessions[sid]); const e = elapsed(m); const a = T.h1, b = a + T.gk, c = b + T.h2;
    for (const k of [3, 2, 1]) { const at = b - k; const dt = at - e; if (at >= a + .9 && dt > .25) SCHED[m.id].push(...beepAt(ctx.currentTime + dt, 1320, .18)) }
    for (const [at, pat] of [[a, [.3, .3]], [b, [.9]], [c, [.3, .3, 1.3]]]) { const dt = at - e; if (dt > .25) { let t = ctx.currentTime + dt; for (const d of pat) { SCHED[m.id].push(...blowN(t, d)); t += d + .14 } } } }
  const ctx = AC; if (anyRun && ctx && !KEEP) { try { KEEP = ctx.createOscillator(); const g = ctx.createGain(); g.gain.value = .0008; KEEP.frequency.value = 40; KEEP.connect(g); g.connect(ctx.destination); KEEP.start() } catch { KEEP = null } }
  if (!anyRun && KEEP) { try { KEEP.stop() } catch { } KEEP = null }
}

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
let MANSCHED = [];
function manSchedule(m) { MANSCHED.forEach(n => { try { n.stop() } catch { } }); MANSCHED = []; if (!m || !m.timer?.running || !S.whistle) return; const ctx = audio(); if (!ctx) return; if (ctx.state === 'suspended') ctx.resume();
  const T = S.man.timing, e = manElapsed(m), a = T.h1, b = a + T.gk, c = b + T.h2;
  for (const k of [3, 2, 1]) { const at = b - k; if (at >= a + .9 && at - e > .25) MANSCHED.push(...beepAt(ctx.currentTime + at - e, 1320, .18)) }
  for (const [at, pat] of [[a, [.3, .3]], [b, [.9]], [c, [.3, .3, 1.3]]]) { const dt = at - e; if (dt > .25) { let t = ctx.currentTime + dt; for (const d of pat) { MANSCHED.push(...blowN(t, d)); t += d + .14 } } } }
setInterval(() => { if (S.tab !== 'mm' || !S.mmManual || !S.man) return; const m = S.man.matches.find(x => x.id === S.manCur); if (!m) return; const ci = manClock(m);
  const el = document.querySelector('[data-manclock]'); if (el) { el.textContent = ci.time; el.className = 'mm-clock ' + ci.phase } const lb = document.querySelector('[data-manph]'); if (lb) lb.textContent = ci.label }, 250);
function viewManual() {
  const M = manLoad();
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
    <div class="mm-meta"><span>${m.n}경기 <small>/ ${ms.length}</small></span><span class="muted">⏱ ${T.h1 / 60}+${T.gk}″+${T.h2 / 60}</span></div>
    <div class="mm-board">${side(H, m.home, hs)}<div class="mm-mid"><div class="mm-clock ${ci.phase}" data-manclock>${ci.time}</div><div class="mm-ph" data-manph>${ci.label}</div>${m.status === 'pending' ? `<button class="mm-side" data-act="manside">⇄ 진영 변경</button>` : ''}</div>${side(A, m.away, as)}</div>
    <div class="mm-ctl">${editing ? '' : m.status === 'pending' ? `<button class="btn primary mm-big cta" data-act="mango">▶ 경기 시작</button>` : `${run ? `<button class="btn mm-big" data-act="manpause">⏸ 일시정지</button>` : `<button class="btn primary mm-big" data-act="manresume">▶ 재개</button>`}<button class="btn mm-big" data-act="manend">경기 종료</button>`}</div>
    <div class="mm-list" style="grid-template-columns:repeat(${Math.min(ms.length, 9)},minmax(0,1fr))">${ms.map(x => { const [a, b] = manScore(x); return `<button class="mm-li ${x.id === m.id ? 'cur' : ''} st-${x.status}" data-act="mansel" data-id="${x.status === 'done' ? x.id : ''}" ${x.status === 'done' || x.id === curM.id ? '' : 'disabled'}><em>${x.n}</em><i style="background:${manTeam(x.home).color}"></i><span>${x.status === 'pending' ? 'vs' : a + ':' + b}</span><i style="background:${manTeam(x.away).color}"></i></button>` }).join('')}</div>
    <div class="row" style="margin-top:4px"><button class="btn sm" data-act="mansum">📋 지금까지 결과 보기</button><button class="btn sm danger" data-act="manreset">새로 설정</button></div></div>`;
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
    case 'mango': { const m = cur(); if (!m) return; audio(); keepAwake(true); const ctx = audio(); if (ctx && S.whistle) { const t0 = ctx.currentTime + .05; beepAt(t0, 1320, .18); beepAt(t0 + 1, 1320, .18); beepAt(t0 + 2, 1320, .18); blowN(t0 + 3, .9) }
      const ov = document.createElement('div'); ov.className = 'mm-cd'; document.body.appendChild(ov); for (const n of [3, 2, 1]) { ov.innerHTML = `<b>${n}</b>`; try { navigator.vibrate?.(80) } catch { } await new Promise(r => setTimeout(r, 1000)) }
      ov.innerHTML = '<b class="go">START</b>'; setTimeout(() => ov.remove(), 600); m.status = 'live'; m.timer = { running: true, acc: 0, startedAt: Date.now() }; manSave(); manSchedule(m); render(); return }
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
const MSTAT = { active: '정회원', guest: '게스트', dormant: '휴면' };
function mstatus(p) { return p.status || (p.guest ? 'guest' : 'active') }
function watchContacts() { if (!S.admin || S.unsubContacts || !S.store) return; S.store.watchCol('auth', docs => { const o = {}; docs.forEach(d => o[d.id] = true); S.authMap = o; render() }); S.unsubContacts = S.store.watchCol('contacts', docs => { const o = {}; docs.forEach(d => { const { id, ...r } = d; o[id] = r }); S.contacts = o; render() }) }
function memberRows() {
  const st = {}; for (const r of playerStats()) st[r.id] = r;
  const last = {}; for (const [sid, s] of Object.entries(S.sessions)) { if (!sessMatches(sid).some(m => m.status === 'done')) continue; for (const k of KEYS) for (const id of teamPlayers(s, k)) if (!last[id] || last[id] < sid) last[id] = sid }
  return Object.entries(S.players).map(([id, p]) => ({ id, name: p.name, status: mstatus(p), phone: S.contacts?.[id]?.phone || '', memo: S.contacts?.[id]?.memo || '', days: st[id]?.days || 0, g: st[id]?.g || 0, a: st[id]?.a || 0, last: last[id] || '', created: p.createdAt || 0 }));
}
const MCOLS = [
  ['name', '이름', r => r.name, 't'], ['status', '구분', r => MSTAT[r.status] || r.status, 't'], ['staff', '운영진', r => S.players[r.id]?.staff ? '운영진' : '-', 't'],
  ['login', '로그인', r => S.authMap?.[r.id] ? '등록됨' : '미등록', 't'], ['birth', '생년월일', r => S.contacts?.[r.id]?.birth || '', 't'], ['phone', '연락처', r => r.phone || '', 't'],
  ['memo', '메모', r => r.memo || '', 't'], ['days', '참가', r => r.days || 0, 'n'], ['last', '최근 참가', r => r.last || '', 't']];
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
function viewMembers() {
  const q = (S.mq || '').trim(); const f = S.mstat || 'all';
  const allRows = memberRows(); let rows = allRows; const cnt = k => allRows.filter(r => r.status === k).length;
  if (f !== 'all') rows = rows.filter(r => r.status === f);
  if (q) rows = rows.filter(r => r.name.includes(q) || r.phone.replace(/-/g, '').includes(q.replace(/-/g, '')) || r.memo.includes(q));
  rows = mApplyCols(rows); const fk = Object.keys(S.colF || {}).filter(k => S.colF[k]);
  let h = `<div class="mg-top"><h2 style="margin:0">회원 관리<small>${Object.keys(S.players).length}명</small></h2><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="mbulk">명단 붙여넣기</button><button class="btn sm" data-act="mcsv">CSV 저장</button><button class="btn primary sm" data-act="madd">＋ 회원 추가</button></div></div>
  <div class="mtools"><input class="inp" type="search" id="mq" placeholder="이름, 연락처, 메모 검색" value="${esc(q)}" data-in="mq">
  <div class="seg">${[['all', `전체 ${Object.keys(S.players).length}`], ['active', `정회원 ${cnt('active')}`], ['guest', `게스트 ${cnt('guest')}`], ['dormant', `휴면 ${cnt('dormant')}`]].map(([k, n]) => `<button role="tab" data-act="mstat" data-k="${k}" aria-selected="${f === k}">${n}</button>`).join('')}</div>
</div>${fk.length || S.colSort ? `<div class="cf-bar">${fk.map(k => `<button class="chip sel" data-act="colclear" data-k="${k}">${mcol(k)[1]}: ${S.colF[k].length > 2 ? S.colF[k].slice(0, 2).map(v => esc(v || '(빈칸)')).join(', ') + ` 외 ${S.colF[k].length - 2}` : S.colF[k].map(v => esc(v || '(빈칸)')).join(', ')} ✕</button>`).join('')}${S.colSort ? `<span class="chip">정렬: ${mcol(S.colSort.k)[1]} ${S.colSort.d > 0 ? '▲' : '▼'}</span>` : ''}<button class="linkbtn" data-act="colreset">모두 초기화</button><span class="muted">${rows.length}명 표시</span></div>` : ''}`;
  const nsel = Object.values(S.msel || {}).filter(Boolean).length;
  if (nsel) h += `<div class="bulkbar"><b>${nsel}명 선택</b><button class="btn sm" data-act="mselclear">선택 해제</button><button class="btn sm danger" data-act="mbulkdel">선택 삭제</button></div>`;
  if (!rows.length) return h + `<div class="panel"><p class="empty">${q || fk.length ? '조건에 맞는 회원이 없어요.' : '회원이 없어요. 회원 추가나 명단 붙여넣기로 등록하세요.'}</p></div>`;
  h += `<div class="panel sheetwrap"><table class="grid"><thead><tr><th class="ck"><input type="checkbox" class="staffck" data-in="mselall" aria-label="모두 선택" ${rows.length && rows.every(r => S.msel?.[r.id]) ? 'checked' : ''}></th>${mTh('name', 'stick')}${mTh('status')}${mTh('staff')}${mTh('login')}${mTh('birth')}${mTh('phone')}${mTh('memo')}${mTh('days')}${mTh('last')}<th>관리</th></tr></thead><tbody>
  ${rows.map(r => `<tr class="${S.msel?.[r.id] ? 'msel' : ''}"><td class="ck"><input type="checkbox" class="staffck" data-in="msel" data-id="${r.id}" ${S.msel?.[r.id] ? 'checked' : ''} aria-label="${esc(r.name)} 선택"></td><td class="stick"><input class="cell w-name" type="text" value="${esc(r.name)}" data-in="mcell" data-id="${r.id}" data-f="name"></td>
    <td><select class="cell w-st st-${r.status}" data-in="mcell" data-id="${r.id}" data-f="status">${Object.entries(MSTAT).map(([k, n]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
    <td class="num"><input type="checkbox" class="staffck" data-in="staff" data-id="${r.id}" ${S.players[r.id]?.staff ? 'checked' : ''} aria-label="${esc(r.name)} 운영진(0순위)"></td>
    <td>${S.authMap?.[r.id] ? `<span class="muted" style="font-size:12px">등록됨</span> <button class="btn sm" data-act="pinreset" data-id="${r.id}">초기화</button>` : '<span class="muted" style="font-size:12px">미등록</span>'}</td>
    <td><input class="cell w-num" type="text" inputmode="numeric" maxlength="8" value="${esc(S.contacts?.[r.id]?.birth || '')}" placeholder="-" data-in="mcell" data-id="${r.id}" data-f="birth" style="width:84px"></td>
    <td><div class="telcell"><input class="cell w-tel" type="tel" value="${esc(r.phone)}" placeholder="010-0000-0000" data-in="mcell" data-id="${r.id}" data-f="phone">${r.phone ? `<a class="tel" href="tel:${esc(r.phone.replace(/[^0-9+]/g, ''))}" aria-label="${esc(r.name)}에게 전화">📞</a>` : ''}</div></td>
    <td><input class="cell w-memo" type="text" value="${esc(r.memo)}" placeholder="메모" data-in="mcell" data-id="${r.id}" data-f="memo"></td>
    <td class="num">${r.days}</td><td class="num">${r.last ? r.last.slice(5).replace('-', '.') : '-'}</td>
    <td class="acts"><button class="btn sm danger" data-act="mdel" data-id="${r.id}">삭제</button></td></tr>`).join('')}</tbody></table></div>
  <p class="note">칸을 눌러 바로 고치면 저장돼요. 휴면으로 바꿔도 지난 기록은 그대로 남아요. 연락처와 메모는 운영모드에서만 보여요.</p>`;
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
  const csv = '\ufeff' + [['이름', '구분', '연락처', '메모', '참가', '최근 참가', '골', '도움'], ...rows.map(r => [r.name, MSTAT[r.status], r.phone, r.memo, r.days, r.last, r.g, r.a])].map(r => r.map(q).join(',')).join('\n');
  const name = `WD_FUTSAL_회원명단_${today().replace(/-/g, '')}.csv`; const blob = new Blob([csv], { type: 'text/csv' });
  if (S.store?.dl) { try { await S.store.dl.save({ filename: name, data: blob }); toast('회원 명단을 저장했어요.') } catch (e) { if (e?.code !== 'declined') toast('이 화면에서는 저장할 수 없어요.') } return }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000); toast('회원 명단을 저장했어요.');
}

async function sendChat() {
  const inp = document.getElementById('chatin'); if (!inp || S.sending) return; const text = inp.value.trim(); if (!text) return;
  const mk = myTeam(cur()); let name = mk ? pname(cur().captains[mk]) : S.admin ? (S.me || '운영진') : S.me;
  if (!name) { const n = prompt('채팅에 표시할 이름을 입력하세요'); if (!n || !n.trim()) return; S.me = n.trim().slice(0, 12); save('me', S.me); name = S.me }
  S.sending = true; inp.value = '';
  try { await w(() => S.store.add(sp(S.sid) + '/chat', { name, uid: myUid(), team: mk || null, admin: !mk && S.admin, text: text.slice(0, 300), at: Date.now() })) } finally { S.sending = false }
  document.getElementById('chatin')?.focus();
}
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'ap-pin') { e.preventDefault(); document.querySelector('[data-act=adminpinok]')?.click(); return } if (e.key === 'Enter' && e.target.dataset?.act === 'gohome') { e.target.click(); return } if (e.key === 'Enter' && (e.target.id === 'lg-pin' || e.target.id === 'lg-name')) { e.preventDefault(); document.querySelector('[data-act=login]')?.click(); return } if (e.target.id !== 'chatin' || e.key !== 'Enter' || e.shiftKey) return; e.preventDefault();
  if (e.isComposing) { S.sendAfterCompose = true; return } sendChat() }, true);
document.addEventListener('scroll', e => { const t = e.target; if (t && t.classList && t.classList.contains('msgs') && !S.autoScrolling) S.chatUp = t.scrollHeight - t.scrollTop - t.clientHeight > 40 }, true);
document.addEventListener('input', e => { if (e.target.dataset?.in === 'colq' && S.sheet?.type === 'colf') { S.colQ = e.target.value; const tmp = document.createElement('div'); tmp.innerHTML = colFilterSheet(S.sheet.k); const nl = tmp.querySelector('.cf-list'), ol = document.querySelector('.cf-list'); if (nl && ol) ol.replaceWith(nl); return }
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
  watchPhases();
}
setInterval(tick, 250);

/* ───────── events ───────── */
let saveT = {};
document.addEventListener('focusout', () => setTimeout(() => { if (S.pending && !isTyping()) render() }, 0));
document.addEventListener('input', e => { const el = e.target; const k = el.dataset.in; if (!k) return;
  if (k === 'calf' && S.cal) { S.cal.f[el.dataset.f] = el.value; if (el.dataset.f === 'no') S.cal.f.noAuto = false; return }
  if (k === 'calfvenue' && S.cal) { if (el.value === '__custom') { S.cal.f.venueCustom = true; S.cal.f.venue = ''; render(); setTimeout(() => document.getElementById('calf-venue')?.focus(), 50) } else { S.cal.f.venueCustom = false; S.cal.f.venue = el.value } return }
  if (k === 'impf' && S.imp) { S.imp[el.dataset.f] = el.value; return }
  if (k === 'schedf' && S.admin) { const f = el.dataset.f; S.meta = S.meta || {}; S.meta.sched = { ...schedCfg(), [f]: el.value }; clearTimeout(S.schedT); S.schedT = setTimeout(async () => { await w(() => S.store.set('meta/sched', S.meta.sched)); S.schedImg = {}; refreshSchedule() }, 700); return }
  if (k === 'mq') { S.mq = el.value; clearTimeout(S.mqT); S.mqT = setTimeout(() => { const pos = el.selectionStart; S.pending = false; const a = document.activeElement; a && a.blur(); render(); const n = document.getElementById('mq'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos) } catch { } } }, 250); return }
  if (k === 'pasteApply') S.pasteApply = el.value;
  if (k === 'me') { S.me = el.value.trim(); save('me', S.me) }
  if (k === 'sfield' && S.admin) { const f = el.dataset.f; clearTimeout(saveT[f]); saveT[f] = setTimeout(async () => { await w(() => S.store.update(sp(S.sid), { [f]: el.value })); if (f === 'evpw' || f === 'notice') refreshPoster() }, 600) } });
document.addEventListener('change', e => { const el = e.target;
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
  if (el.dataset.in === 'kkpick') { if (S.kk) S.kk[+el.dataset.i].use = el.value; return }
  if (el.dataset.in === 'mancol') { S.manF.cols[+el.dataset.i] = el.value; return }
  if (el.dataset.in === 'mmpick') { S.mmPick = el.value; S.mmStage = null; S.mmDraft = null; render(); return }
  if (el.dataset.in === 'venuesel') { const sid = el.dataset.sid; if (el.value === '__custom') { (S.venueCustom ??= {})[sid] = true; render(); setTimeout(() => document.querySelector(`[data-in=cell][data-sid="${sid}"][data-f=venue]`)?.focus(), 50) } else if (el.value) { (S.venueCustom ??= {})[sid] = false; S.store.update(sp(sid), { venue: el.value }).catch(e => toast(errMsg(e))) } return }
  if (el.dataset.in === 'ctxpick') { S.sid = el.value; S.planSel = el.value; S.planM = el.value.slice(0, 7); S.nsid = el.value; S.step = null; S.sel = null; S.openMatch = null; render(); return }
  if (el.dataset.in === 'latetoggle' && S.admin) { el.checked = false; cancelApp(S.sid, el.dataset.id, null, true); return }
  if (el.dataset.in === 'lateuntoggle' && S.admin) { if (!confirm(`${pname(el.dataset.id)} 님의 마감 후 취소 표시를 지울까요? (다음 경기 3순위가 해제돼요. 참가 명단에는 다시 들어가지 않아요)`)) { el.checked = true; return } w(() => S.store.update(sp(S.sid), { [`late.${el.dataset.id}`]: null }), '해제했어요.'); return }
  if (el.dataset.in === 'msel') { (S.msel ??= {})[el.dataset.id] = el.checked; render(); return }
  if (el.dataset.in === 'mselall') { S.msel = {}; if (el.checked) document.querySelectorAll('[data-in=msel]').forEach(x => S.msel[x.dataset.id] = true); render(); return }
  if (el.dataset.in === 'staff' && S.admin) { w(() => S.store.update('players/' + el.dataset.id, { staff: el.checked }), el.checked ? '운영진(0순위)으로 표시했어요.' : '운영진 표시를 해제했어요.'); return }
  if (el.dataset.in === 'msort') { S.msort = el.value; render(); return }
  if (el.dataset.in === 'mcell' && S.admin) { const id = el.dataset.id, f = el.dataset.f, v = el.value.trim();
    if (f === 'name') { if (!v) { render(); return } if (v !== S.players[id]?.name) { if (findPlayer(v)) { toast('같은 이름의 회원이 이미 있어요.'); render(); return } w(() => S.store.update('players/' + id, { name: v.slice(0, 20) }), '저장했어요.') } return }
    if (f === 'status') { w(() => S.store.update('players/' + id, { status: v, guest: v === 'guest' }), '저장했어요.'); return }
    const c = S.contacts?.[id] || {}; if ((c[f] || '') !== v) w(() => S.store.set('contacts/' + id, { ...c, [f]: v }), '저장했어요.'); return }
  if (el.dataset.in === 'cell' && S.admin) { const f = el.dataset.f, sid = el.dataset.sid; const v = f === 'capacity' || f === 'no' ? (+el.value || 0) : el.value; if (S.sessions[sid]?.[f] !== v) w(() => S.store.update(sp(sid), { [f]: v }), '저장했어요.'); return } if (el.dataset.in === 'sfield2' && S.admin) { const f = el.dataset.f; w(() => S.store.update(sp(S.sid), { [f]: f === 'capacity' ? (+el.value || 0) : el.value })); return } if (el.dataset.in === 'sidpick') { S.sid = el.value; S.openMatch = null; render(); return } if (el.dataset.in === 'sfield' && el.type === 'time' && S.admin) w(() => S.store.update(sp(S.sid), { time: el.value })) });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'addone') { e.preventDefault(); document.querySelector('[data-act="addone"]').click() } if (e.key === 'Escape') { if (S.sheet) { S.sheet = null; render() } else if (S.openMatch) { S.openMatch = null; render() } } });
document.addEventListener('submit', async e => { e.preventDefault(); const f = e.target;
  if (f.dataset.form === 'newsession') { const d = Object.fromEntries(new FormData(f)); await createSession(d) }
  if (f.dataset.form === 'chat') await sendChat(); });

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.classList.contains('scrim') && e.target.closest('[data-stop]')) return;
  if (el.disabled) return; const act = el.dataset.act, id = el.dataset.id; const s = cur(); const m = S.openMatch ? M(S.openMatch) : null;
  if (act && act.startsWith('man')) { await manAct(act, el); return }
  if (act && act.startsWith('mm') && !['mmtoggle', 'mmtake', 'mmrelease', 'mmmode'].includes(act) && S.tab === 'mm' && !mmIsCtl()) { toast('보기 전용이에요. 진행자만 조작할 수 있어요.'); return }
  switch (act) {
    case 'tab': S.tab = el.dataset.v; if (S.admin && S.tab === 'run') { const r = runSid(); if (r) { S.sid = r; S.step = null; watchChat() } } S.openMatch = null; S.sheet = null; S.sel = null; S.sub = null; S.detail = null; render(); window.scrollTo(0, 0); break;
    case 'home': S.sid = null; S.step = null; watchChat(); render(); break;
    case 'opensession': S.sid = id; S.step = null; S.sel = null; watchChat(); render(); window.scrollTo(0, 0); break;
    case 'newsession': if (!needAdmin()) break; S.sheet = { type: 'newsession' }; render(); break;
    case 'step': S.step = el.dataset.v; S.sel = null; render(); window.scrollTo(0, 0); break;
    case 'gostage': if (!needAdmin() && el.dataset.v !== 'trade') break; if (el.dataset.v === 'captain' && !(await freezeApps(s))) break; await setStage(el.dataset.v); break;
    case 'addone': { const inp = document.getElementById('addone'); const v = inp.value.trim(); if (!v) break; inp.value = ''; inp.blur(); document.activeElement?.blur?.(); await addApplicants(v.split(/[,，\n]+/).map(x => x.trim()).filter(Boolean)); break }
    case 'rmapply': if (!needAdmin()) break; if (s.draftStatus !== 'ready') { toast('드래프트가 시작된 뒤에는 신청자를 뺄 수 없어요.'); break }
      await clearExtras(S.sid, id); await w(() => S.store.update(sp(S.sid), { applicants: (s.applicants || []).filter(x => x !== id), captains: Object.fromEntries(KEYS.map(k => [k, s.captains?.[k] === id ? null : (s.captains?.[k] || null)])) })); break;
    case 'capslot': S.sheet = { type: 'capslot', k: el.dataset.k }; render(); break;
    case 'pickcap': { const k = S.sheet.k; S.sheet = null; render(); await w(() => S.store.update(sp(S.sid), { [`captains.${k}`]: id || null, [`captainTokens.${k}`]: id ? rand() : null })); break }
    case 'ord': { const o = [...(s.order || KEYS)]; const i = +el.dataset.i, j = i + (+el.dataset.d); [o[i], o[j]] = [o[j], o[i]]; await w(() => S.store.update(sp(S.sid), { order: o })); break }
    case 'lottery': { const o = [...KEYS]; for (let i = 2; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]] }
      if (await w(() => S.store.update(sp(S.sid), { order: o }), '순번을 추첨했어요.')) sysChat(`순번 추첨 결과: ${o.map((k, i) => `${i + 1}번 ${team(s, k).name}`).join(', ')}`); break }
    case 'pick': { const s0 = cur(); if (s0?.pending?.p === id) { await w(() => S.store.update(sp(S.sid), { pending: null })); break } await setPending(id); break }
    case 'unpick': { const s0 = cur(); const k = myTeam(s0); const sid0 = S.sid;
      if (s0.pending?.p === id && (S.admin || s0.pending.t === k)) { await w(() => S.store.update(sp(sid0), { pending: null }), '선택을 취소했어요.'); break }
      const last = (s0.picks || []).slice(-1)[0];
      if (!last || last.p !== id) { toast('이미 다음 순번이 진행돼서 취소할 수 없어요. 운영진에게 요청해 주세요.'); break }
      if (!(S.admin || last.t === k)) break;
      if (!confirm(`${pname(id)} 선택을 취소할까요? 다시 내 차례가 돼요.`)) break; await undoPick(!S.admin); sysChat(`${team(s0, last.t).name} 주장이 ${pname(id)} 선택을 취소했어요`); break }
    case 'undo': S.sheet = null; if (confirm('마지막 지명을 되돌릴까요?')) await undoPick(); else render(); break;
    case 'noop': break;
    case 'qzans': if (el.dataset.v === 'm') { S.qzStep = 'blocked'; await qzSave('m'); render() } else { S.qzStep = null; await qzSave('f'); render() } break;
    case 'qzok': S.qzStep = null; render(); break;
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
    case 'mmresume': { const m = M(id); audio(); await w(() => S.store.update(mp(id), { timer: { running: true, acc: m.timer?.acc || 0, startedAt: Date.now() } })); break }
    case 'mmend': { const m = M(id); if (clockInfo(m).phase !== 'full' && !confirm('아직 시간이 남았어요. 경기를 종료할까요?')) break; const e = elapsed(m); await w(() => S.store.update(mp(id), { status: 'done', timer: { running: false, acc: e, startedAt: 0 }, endedAt: Date.now() }), `${m.n}경기를 종료했어요.`); break }
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
    case 'runpick': if (!id) break; S.sid = id; S.step = null; S.sel = null; render(); window.scrollTo(0, 0); break;
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
    case 'schedshare': case 'scheddl': { const ym = S.schedYm || defaultMonth(); const c = await drawSchedule(ym); const b = await new Promise(r => c.toBlob(r, 'image/png')); await shareBlob(b, `WF_SCHEDULE_${ym.replace('-', '')}.png`, act === 'scheddl'); break }
    case 'dutyedit': if (!needAdmin()) break; S.sheet = { type: 'duty', sid: id }; render(); break;
    case 'dutytog': { const sid = S.sheet?.sid; const ss = S.sessions[sid]; const kind = el.dataset.kind; const cur1 = new Set(ss.duty?.[kind] || []); cur1.has(id) ? cur1.delete(id) : cur1.add(id); await w(() => S.store.update(sp(sid), { [`duty.${kind}`]: [...cur1] })); break }
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
    case 'apprm': { if (!needAdmin() || !confirm('이 신청을 삭제할까요? 주차·공당·물당 신청도 함께 취소돼요.')) break; const a0 = appsOf(s).find(a => a.k === id); if (a0?.pid) await clearExtras(S.sid, a0.pid); if (a0?.q) { await w(() => S.store.del(sp(S.sid) + '/q/' + a0.q)) } await w(() => S.store.txn(sp(S.sid), d => { d.apps = appsOf0(d).filter(a => a.k !== id && !(a0?.pid && a.pid === a0.pid && a0.q)); return d })); break }
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
    case 'chatlog': (S.chatSeen ??= {})[S.sid] = S.chat.length; S.sheet = { type: 'chatlog' }; render(); setTimeout(() => { const m = document.querySelector('.logsheet .msgs'); if (m) m.scrollTop = m.scrollHeight }, 0); break;
    case 'adminteam': S.adminTeam = el.dataset.k; render(); break;
    case 'openroom': if (!needAdmin()) break; if (!(await freezeApps(s))) break; await openRoom(); break;
    case 'joinroom': await joinRoom(el.dataset.k); break;
    case 'leaveroom': if (confirm('드래프트 채팅방에서 나갈까요?')) await leaveRoom(); break;
    case 'ladder': if (!needAdmin()) break; await runLadder(); break;
    case 'relader': S.sheet = null; if (!needAdmin() || !confirm('사다리를 다시 탈까요?')) break; await runLadder(); break;
    case 'nextturn': { const s0 = cur(); const k = pickTeamAt(s0, (s0.picks || []).length); if (!(S.admin || (myTeam(s0) === k && s0.room?.[k]?.in))) { toast('내 차례에만 선택 완료를 누를 수 있어요.'); break } await nextTurn(); break }
    case 'resetroom': S.sheet = null; if (!needAdmin() || !confirm('드래프트를 처음(주장 입장)부터 다시 할까요? 지명 내역이 모두 지워져요.')) break; await openRoom(); break;
    case 'rmwait': if (!needAdmin()) break; await w(() => S.store.update(sp(S.sid), { waitlist: (s.waitlist || []).filter(x => x !== id) })); break;
    case 'promote': if (!needAdmin() || !(s.waitlist || []).length) break; await w(() => S.store.update(sp(S.sid), { applicants: [...(s.applicants || []), s.waitlist[0]], waitlist: s.waitlist.slice(1) }), '신청자로 올렸어요.'); break;
    case 'closenow': if (!needAdmin() || !confirm('지금 바로 신청을 마감할까요?')) break; await w(() => S.store.update(sp(S.sid), { applyClose: nowLocal() }), '신청을 마감했어요.'); break;
    case 'apply': await doApply(id, false); break;
    case 'applycancel': await doApply(id, true); break;
    case 'addsample': if (!needAdmin()) break; await addSampleManual(); break;
    case 'clearsample': if (!needAdmin()) break; await clearSample(); break;
    case 'mstat': S.mstat = el.dataset.k; render(); break;
    case 'madd': S.sheet = { type: 'madd' }; render(); break;
    case 'mbulk': S.sheet = { type: 'mbulk' }; render(); break;
    case 'mcsv': await exportMembersCSV(); break;
    case 'mdel': { const p = S.players[id]; if (!p || !confirm(`${p.name} 회원을 삭제할까요? 지난 경기 기록에는 "(삭제됨)"으로 남아요. 활동을 멈춘 회원은 삭제 대신 휴면으로 바꾸는 걸 추천해요.`)) break;
      await w(async () => { await S.store.del('players/' + id); await S.store.del('contacts/' + id) }, '삭제했어요.'); break }
    case 'maddgo': { const n = document.getElementById('ma-name').value.trim(); if (!n) { toast('이름을 입력하세요.'); break } if (findPlayer(n)) { toast('같은 이름의 회원이 이미 있어요.'); break }
      const ph = document.getElementById('ma-phone').value.trim(), memo = document.getElementById('ma-memo').value.trim(), st = document.getElementById('ma-st').value;
      if (await w(async () => { const nid = await S.store.add('players', { name: n.slice(0, 20), guest: st === 'guest', status: st, createdAt: Date.now() }); if (ph || memo) await S.store.set('contacts/' + nid, { phone: ph, memo }) }, `${n} 회원을 추가했어요.`)) { S.sheet = null; render() } break }
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
    case 'capcode': { const f = findCode(document.getElementById('capcode')?.value); if (!f) { toast('맞는 주장 코드가 없어요. 운영진에게 다시 확인해 주세요.'); break }
      S.capLinks[f.sid] = { k: f.k, t: S.sessions[f.sid].captainTokens[f.k] }; save('caplinks', S.capLinks); S.sid = f.sid; S.tab = 'draft'; document.activeElement?.blur();
      toast(`${team(S.sessions[f.sid], f.k).name} 주장 ${pname(S.sessions[f.sid].captains[f.k])}(으)로 참여해요.`); render(); window.scrollTo(0, 0); break }
    case 'sub': S.sub = el.dataset.v || null; S.detail = el.dataset.v === '' && S.tab === 'results' ? null : S.detail; render(); window.scrollTo(0, 0); break;
    case 'applist': S.sub = 'applist'; render(); window.scrollTo(0, 0); break;
    case 'result': S.tab = 'results'; S.detail = id; S.sub = null; render(); window.scrollTo(0, 0); break;
    case 'rank': S.rankKey = el.dataset.k; render(); break;
    case 'setname': { const v = document.getElementById('nm')?.value.trim(); if (!v) break; S.me = v.slice(0, 12); save('me', S.me); document.activeElement?.blur(); render(); break }
    case 'selswap': if (!needAdmin()) break; if (!S.sel) { S.sel = id; render(); break } if (S.sel === id) { S.sel = null; render(); break }
      { const a = S.sel; S.sel = null; if (KEYS.find(k => teamPlayers(s, k).includes(a)) === KEYS.find(k => teamPlayers(s, k).includes(id))) { S.sel = id; render(); break }
        if (confirm(`${pname(a)} ↔ ${pname(id)} 맞바꿀까요?`)) await swapPlayers(a, id); else render() } break;
    case 'share': sharePoster(false); break;
    case 'download': sharePoster(true); break;
    case 'copytext': try { await navigator.clipboard.writeText(noticeText(s)); toast('공지 텍스트를 복사했어요.') } catch { prompt('아래 내용을 복사하세요', noticeText(s)) } break;
    case 'mkmatches': if (!needAdmin()) break; await createMatches(); break;
    case 'open': S.openMatch = id; S.sheet = null; render(); document.querySelector('.overlay')?.scrollTo(0, 0); break;
    case 'close': S.openMatch = null; keepAwake(false); render(); break;
    case 'start': await startClock(m); break;
    case 'pause': await pauseClock(m); break;
    case 'reset': await resetClock(m); break;
    case 'end': if (confirm('경기를 종료하고 순위에 반영할까요?')) await endMatch(M(m.id)); break;
    case 'reopen': await w(() => S.store.update(mp(m.id), { status: 'live' })); break;
    case 'goal': await addGoal(m, el.dataset.team, null, null, false); try { navigator.vibrate?.(60) } catch { } break;
    case 'pickscorer': { const sh = S.sheet; if (id) { sh.scorer = id; sh.step = 'assist'; render(); break } S.sheet = null; render(); await addGoal(M(sh.match), sh.team, null, null, false); break }
    case 'pickog': { const sh = S.sheet; S.sheet = null; render(); await addGoal(M(sh.match), sh.team, null, null, true); break }
    case 'pickassist': { const sh = S.sheet; S.sheet = null; render(); await addGoal(M(sh.match), sh.team, sh.scorer, id || null, false); break }
    case 'delev': if (confirm('이 골 기록을 지울까요?')) await w(() => S.store.del('events/' + id)); break;
    case 'mom': if (!canMom(s, el.dataset.k)) break; S.sheet = { type: 'mom', k: el.dataset.k }; render(); break;
    case 'pickmom': { const k = S.sheet.k; S.sheet = null; render(); await w(() => S.store.update(sp(S.sid), { [`mom.${k}`]: id || null })); break }
    case 'tstep': { const k = el.dataset.key, d = +el.dataset.d; const T = { ...timing(s) }; if (k === 'gk') T.gk = Math.min(30, Math.max(0, T.gk + d)); else T[k] = Math.min(45 * 60, Math.max(k === 'rest' ? 0 : 60, T[k] + d * 60)); await w(() => S.store.update(sp(S.sid), { timing: T })); break }
    case 'delsession': await deleteSessionBy(S.sid); break;
    case 'delmatches': { if (!needAdmin()) break; const ms = sessMatches(S.sid); if (!ms.length) break;
      const evs = Object.entries(S.events).filter(([, e]) => e.session === S.sid); const played = ms.filter(m => m.status !== 'pending').length;
      if (!confirm(`${fmtDate(S.sid)} 경기 대진 ${ms.length}경기를 삭제할까요?${evs.length || played ? `\n진행된 경기 ${played}개와 골 기록 ${evs.length}건도 함께 지워져요.` : ''}\n신청자와 팀 구성은 그대로 남아요.`)) break;
      if (played && prompt('기록이 있는 경기가 있어요. 정말 지우려면 "삭제"라고 입력하세요.') !== '삭제') { toast('삭제를 취소했어요.'); break }
      const ok = await w(async () => { for (const [eid] of evs) await S.store.del('events/' + eid); for (const m of ms) await S.store.del(mp(m.id)); await S.store.update(sp(S.sid), { stage: 'notice' }) }, '경기 대진을 삭제했어요.');
      if (ok) { S.openMatch = null; S.tab = 'run'; S.step = 'notice'; render(); window.scrollTo(0, 0) } break }
    case 'delsession_old': if (!confirm(fmtDate(S.sid) + ' 경기일을 통째로 지울까요? 되돌릴 수 없어요.')) break;
      await w(async () => { for (const [eid, ev] of Object.entries(S.events)) if (ev.session === S.sid) await S.store.del('events/' + eid); for (const mm of sessMatches(S.sid)) await S.store.del(mp(mm.id)); await S.store.del(sp(S.sid)) }, '삭제했어요.'); S.sid = null; render(); break;
    case 'sort': S.statsSort = el.dataset.k; render(); break;
    case 'editp': { const p = S.players[id]; const nv = prompt('선수 이름 (게스트는 뒤에 (게))', pname(id)); if (nv === null || !nv.trim()) break; const guest = /\(\s*게\s*\)/.test(nv); const name = nv.replace(/\(\s*게\s*\)/g, '').trim().slice(0, 20); if (name !== p.name || guest !== !!p.guest) await w(() => S.store.update('players/' + id, { name, guest }), '수정했어요.'); break }
    case 'opmode': if (S.admin) { if (!confirm('운영모드를 끌까요?')) break; S.adminOn = false; save('admin', false); S.tab = 'mhome'; S.sid = null; S.step = null; S.openMatch = null; render(); window.scrollTo(0, 0); break }
      { S.sheet = { type: 'adminpin' }; render(); setTimeout(() => document.getElementById('ap-pin')?.focus(), 60) } break;
    case 'adminpinok': { const pin = (document.getElementById('ap-pin')?.value || '').trim(); if (!(await adminPinOk(pin))) { toast('비밀번호가 달라요.'); const x = document.getElementById('ap-pin'); if (x) { x.value = ''; x.focus() } break }
        document.activeElement?.blur(); S.sheet = null; S.adminOn = true; save('admin', true); S.tab = 'manage'; S.sid = null; S.step = null; S.openMatch = null; toast('운영모드로 전환했어요.'); render(); window.scrollTo(0, 0) } break;
    case 'caplink': { const k = el.dataset.k; let t = s.captainTokens?.[k]; if (!t) { t = rand(); if (!await w(() => S.store.update(sp(S.sid), { [`captainTokens.${k}`]: t }))) break }
      const url = IS_ARTIFACT ? (window.WF_APP_URL || '') : capLink(S.sid, k, t); const msg = `[${CFG.club?.short || 'WF'}] ${fmtDate(S.sid)} 드래프트 ${team(s, k).name} 주장 ${pname(s.captains[k])}님\n앱 링크: ${url}\n주장 코드: ${t}\n${IS_ARTIFACT ? '앱을 열고 오른쪽 위 ⚙ 설정에서 \'주장 코드 입력\'을 눌러 주세요.' : '링크를 누르면 바로 드래프트에 참여해요.'}`;
      if (el.dataset.how === 'share' && navigator.share) { try { await navigator.share({ text: msg }); break } catch (e) { if (e.name === 'AbortError') break } }
      try { await navigator.clipboard.writeText(msg); toast(`${team(s, k).name} 주장 안내를 복사했어요.`) } catch { prompt('아래 내용을 복사해서 보내세요', msg.replace(/\n/g, ' / ')) } break }
    case 'whistle': S.whistle = !S.whistle; save('whistle', S.whistle); if (S.whistle) { audio(); whistle([.35]) } render(); break;
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
  if (window.WF_FRESH) { S.tab = S.admin ? 'manage' : 'mhome'; S.sub = null; S.detail = null; S.step = null; S.sid = null; return } // 앱을 새로 열면 항상 홈에서 시작
  let n = null; try { n = JSON.parse(sessionStorage.getItem('wf:nav') || 'null') } catch { } if (!n) { const l = load('nav', null); if (l && Date.now() - (l.at || 0) < 6 * 3600e3) n = l }
  if (!n || !!n.admin !== !!S.admin) return;
  if (!(S.admin ? ADMIN_TABS : MEMBER_TABS).includes(n.tab)) return;
  S.tab = n.tab; S.sid = n.sid || null; S.step = n.step || null; S.sub = n.sub || null; S.detail = n.detail || null;
}
function resumeCaptain() {
  if (S.admin) return; for (const [sid, l] of Object.entries(S.capLinks || {})) { const s = S.sessions[sid]; if (!s || s.draftStatus === 'done' && s.stage !== 'trade') continue;
    if (s.captainTokens?.[l.k] === l.t && (s.room?.open || s.draftStatus === 'live' || s.draftStatus === 'done') && sid >= today()) { if (S.tab !== 'settings') { S.sid = sid; S.tab = 'draft' } return } }
}
let lastDesk = null; window.addEventListener('resize', () => { const d = isDesk(); if (d !== lastDesk) { lastDesk = d; render() } else if (document.querySelector('.dmroot')) { const ab = document.querySelector('.appbar'); if (ab) document.documentElement.style.setProperty('--abh', ab.offsetHeight + 'px') } });
document.addEventListener('gesturestart', e => e.preventDefault()); document.addEventListener('dblclick', e => { if (!isDesk()) e.preventDefault() }, { passive: false });
function goResult(id, dir) { const ids = pastSids(); const o = ids.indexOf(S.detail), n = ids.indexOf(id); S.rdAnim = dir || (n < o ? 'fromR' : 'fromL'); S.detail = id; render(); window.scrollTo(0, 0); setTimeout(() => { S.rdAnim = '' }, 350) }
/* pull-to-refresh (home-screen apps have no browser refresh) */
let ptr = null; const PTR_GO = 72;
function ptrEl() { let e = document.getElementById('ptr'); if (!e) { e = document.createElement('div'); e.id = 'ptr'; e.innerHTML = '<i>↓</i><span>당겨서 새로고침</span>'; document.body.appendChild(e) } return e }
function scrolledParent(t) { for (let el = t; el && el !== document.body; el = el.parentElement) { if (el.scrollTop > 0 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) return true } return false }
document.addEventListener('touchstart', e => { ptr = null; if (e.touches.length !== 1 || S.sheet || window.scrollY > 0) return; const t = e.target; if (t.closest('.scrim,input,textarea,select,.mm-cd') || scrolledParent(t)) return;
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
