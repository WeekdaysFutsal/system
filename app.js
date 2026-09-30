/* WF 풋살 앱 — 신청 · 주장 · 드래프트 · 교환 · 공지 이미지 · 경기 기록 */
const CFG = window.WF_CONFIG || {};
const KEYS = ['A', 'B', 'C'];
const PAIRS = [['A', 'B'], ['B', 'C'], ['C', 'A']];
const STAGES = [['apply', '신청'], ['captain', '주장'], ['draft', '드래프트'], ['trade', '교환'], ['notice', '공지'], ['match', '경기']];
const DEF_TIMING = { h1: 300, gk: 5, h2: 300, rest: 180, ...(CFG.timing || {}) };
const TEAMDEF = CFG.teams || { A: { name: 'BLUE', color: '#1E46C8' }, B: { name: 'BLACK', color: '#16181C' }, C: { name: 'WHITE', color: '#F2F3F5' } };
const DEFAULTS = { time: '21:00', venue: '용산 7구장', notice: '', ...(CFG.defaults || {}) };

/* ───────── storage backends ───────── */
function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)) }
function setDotted(obj, path, val) { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach(k => { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k] }); o[ks[ks.length - 1]] = val }

function localStore() {
  const KEY = 'wf-demo-db'; const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } };
  let data = read(); const subs = new Set();
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('wf-demo') : null;
  const colDocs = (p, opt) => { let out = []; for (const k in data) { const i = k.lastIndexOf('/'); if (k.slice(0, i) === p) out.push({ id: k.slice(i + 1), ...clone(data[k]) }) }
    if (opt?.order) { out.sort((a, b) => (a[opt.order] || 0) - (b[opt.order] || 0)); if (opt.limit) out = out.slice(-opt.limit) } return out };
  const emit = () => subs.forEach(s => queueMicrotask(() => s.cb(colDocs(s.path, s.opt))));
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(data)) } catch { } bc && bc.postMessage(1); emit() };
  if (bc) bc.onmessage = () => { data = read(); emit() };
  return {
    kind: 'demo',
    watchCol(p, cb, opt) { const s = { path: p, cb, opt }; subs.add(s); queueMicrotask(() => cb(colDocs(p, opt))); return () => subs.delete(s) },
    async set(p, d) { data[p] = clone(d); persist() },
    async update(p, patch) { if (!data[p]) throw new Error('not-found'); for (const [k, v] of Object.entries(patch)) setDotted(data[p], k, clone(v)); persist() },
    async add(p, d) { const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7); data[p + '/' + id] = clone(d); persist(); return id },
    async del(p) { delete data[p]; persist() },
    async txn(p, fn) { const nd = fn(data[p] ? clone(data[p]) : null); if (nd == null) throw new Error('aborted'); data[p] = nd; persist() }
  };
}

async function firebaseStore(cfg) {
  const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const [{ initializeApp }, F, A] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-firestore.js'), import(base + 'firebase-auth.js')]);
  const app = initializeApp(cfg);
  await A.signInAnonymously(A.getAuth(app));
  const db = F.getFirestore(app);
  const ref = p => F.doc(db, p);
  return {
    kind: 'live',
    watchCol(p, cb, opt, onErr) {
      let q = F.collection(db, p);
      if (opt?.order) q = F.query(q, F.orderBy(opt.order, 'desc'), F.limit(opt.limit || 100));
      return F.onSnapshot(q, s => { let docs = s.docs.map(d => ({ id: d.id, ...d.data() })); if (opt?.order) docs.reverse(); cb(docs) }, e => { console.error(e); onErr && onErr(e) });
    },
    set: (p, d) => F.setDoc(ref(p), d),
    update: (p, d) => F.updateDoc(ref(p), d),
    add: async (p, d) => (await F.addDoc(F.collection(db, p), d)).id,
    del: p => F.deleteDoc(ref(p)),
    txn: (p, fn) => F.runTransaction(db, async t => { const r = ref(p); const s = await t.get(r); const nd = fn(s.exists() ? s.data() : null); if (nd == null) throw new Error('aborted'); t.set(r, nd) })
  };
}

/* ───────── state ───────── */
function load(k, d) { try { const v = localStorage.getItem('wf:' + k); return v === null ? d : JSON.parse(v) } catch { return d } }
function save(k, v) { try { localStorage.setItem('wf:' + k, JSON.stringify(v)) } catch { } }
const S = {
  get admin() { return this.adminOn },
  store: null, ready: 0, err: '',
  players: {}, sessions: {}, matches: {}, events: {}, chat: [], chatSid: null, unsubChat: null,
  tab: load('admin', false) ? 'home' : 'notice', sid: null, step: null, openMatch: null, sheet: null, sel: null, statsSort: 'pts',
  adminOn: load('admin', false), me: load('me', ''), capLinks: load('caplinks', {}), linkErr: '', whistle: load('whistle', true),
  prev: {}, pending: false, poster: {}, pasteApply: ''
};

/* ───────── helpers ───────── */
const p2 = n => String(n).padStart(2, '0');
function today() { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
function inkOn(hex) { const h = (hex || '#888888').replace('#', ''); const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16); return (0.299 * r + 0.587 * g + 0.114 * b) > 165 ? '#131C2B' : '#FFFFFF' }
const DOW = '일월화수목금토';
function dow(id) { const [y, m, d] = id.split('-'); return DOW[new Date(+y, +m - 1, +d).getDay()] }
function fmtDate(id) { const [, m, d] = id.split('-'); return `${+m}월 ${+d}일 (${dow(id)})` }
function fmt(s) { s = Math.max(0, s); return p2(Math.floor(s / 60)) + ':' + p2(Math.floor(s % 60)) }
function pname(id) { if (!id) return '미지정'; const p = S.players[id]; if (!p) return '(삭제됨)'; return p.name + (p.guest ? '(게)' : '') }
function team(s, k) { return { ...TEAMDEF[k], ...(s?.teams?.[k] || {}) } }
function bib(c) { return `<span class="bib" style="background:${c}"></span>` }
function tag(t) { return `<span class="teamtag" style="background:${t.color};color:${inkOn(t.color)}">${esc(t.name)}</span>` }
function timing(s) { return { ...DEF_TIMING, ...(s?.timing || {}) } }
function cur() { return S.sid ? S.sessions[S.sid] : null }
function stageIdx(st) { return STAGES.findIndex(x => x[0] === st) }
let toastT; function toast(t) { document.querySelectorAll('.toast').forEach(x => x.remove()); const d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = t; document.body.appendChild(d); clearTimeout(toastT); toastT = setTimeout(() => d.remove(), 2600) }
function needAdmin() { if (!S.admin) { toast('운영진만 할 수 있어요.'); return false } return true }
function rand() { return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8) }
function myTeam(s) { const l = S.capLinks[S.sid]; if (!s || !l) return null; return s.captainTokens?.[l.k] && s.captainTokens[l.k] === l.t ? l.k : null }
function capLink(sid, k, t) { return `${location.origin}${location.pathname}?d=${sid}&c=${k}&t=${t}` }
function canMom(s, k) { return S.admin || myTeam(s) === k }
function defaultSid() { const ids = Object.keys(S.sessions).sort(); const t = today(); return ids.find(id => id >= t) || ids[ids.length - 1] || null }
async function w(fn, ok) { try { await fn(); if (ok) toast(ok); return true } catch (e) { console.error(e); if (String(e?.message).includes('aborted')) return false; toast('저장하지 못했어요. 연결을 확인하고 다시 시도하세요.'); return false } }
const sp = sid => 'sessions/' + sid;

/* ───────── draft logic ───────── */
function captainsOf(s) { return KEYS.map(k => s?.captains?.[k]).filter(Boolean) }
function pickTeamAt(s, i) { const o = s.order || KEYS; const r = Math.floor(i / 3), pos = i % 3; return r % 2 === 0 ? o[pos] : o[2 - pos] }
function picked(s) { return (s.picks || []).map(x => x.p) }
function pool(s) { const caps = captainsOf(s), pk = picked(s); return (s.applicants || []).filter(id => !caps.includes(id) && !pk.includes(id)) }
function draftTotal(s) { return (s.applicants || []).filter(id => !captainsOf(s).includes(id)).length }
function teamPlayers(s, k) {
  if (!s) return [];
  if (s.teams?.[k]?.players?.length && s.draftStatus === 'done') return s.teams[k].players;
  const cap = s.captains?.[k]; return [cap, ...(s.picks || []).filter(x => x.t === k).map(x => x.p)].filter(Boolean);
}
function captainOf(s, k) { return s?.captains?.[k] || null }

/* ───────── match logic ───────── */
function orderIdx(m) { return (m.round - 1) * 3 + m.slot }
function sessMatches(sid) { return Object.entries(S.matches).filter(([, m]) => m.session === sid).map(([id, m]) => { const t = PAIRS[m.slot - 1]; return { id, ...m, home: t[0], away: t[1] } }).sort((a, b) => a.n - b.n) }
function M(id) { const m = S.matches[id]; if (!m) return null; const t = PAIRS[m.slot - 1]; return { id, ...m, home: t[0], away: t[1] } }
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
function audio() { if (AC) return AC; try { const C = window.AudioContext || window.webkitAudioContext; AC = new C(); const comp = AC.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 4; MASTER = AC.createGain(); MASTER.gain.value = 1.4; MASTER.connect(comp); comp.connect(AC.destination) } catch { AC = null } return AC }
function blow(t, d) { const ctx = AC; const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = 'sine'; o2.type = 'triangle'; o1.frequency.value = 3050; o2.frequency.value = 3120;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 34; const fm = ctx.createGain(); fm.gain.value = 180; lfo.connect(fm); fm.connect(o1.frequency); fm.connect(o2.frequency);
  const am = ctx.createGain(); am.gain.value = .25; lfo.connect(am);
  const amp = ctx.createGain(); amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(.55, t + .03); amp.gain.setValueAtTime(.55, t + d - .06); amp.gain.linearRampToValueAtTime(0, t + d);
  am.connect(amp.gain); o1.connect(amp); o2.connect(amp); amp.connect(MASTER); [o1, o2, lfo].forEach(o => { o.start(t); o.stop(t + d + .05) }) }
function whistle(pattern) { if (!S.whistle) return; const ctx = audio(); if (!ctx) return; if (ctx.state === 'suspended') ctx.resume(); let t = ctx.currentTime + .03; for (const d of pattern) { blow(t, d); t += d + .14 }
  try { navigator.vibrate && navigator.vibrate(pattern.flatMap((d, i) => i ? [140, Math.round(d * 1000)] : [Math.round(d * 1000)])) } catch { } }
document.addEventListener('pointerdown', () => { const c = audio(); if (c && c.state === 'suspended') c.resume() }, { capture: true });
let wake = null; async function keepAwake(on) { try { if (on && !wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => wake = null) } else if (!on && wake) { await wake.release(); wake = null } } catch { } }
function watchPhases() {
  const sid = S.sid; if (!sid || !S.sessions[sid]) return; let run = false;
  for (const m of sessMatches(sid)) { const ci = clockInfo(m); const prev = S.prev[m.id]; S.prev[m.id] = ci.phase; if (m.timer?.running) run = true;
    if (prev === undefined || prev === ci.phase) continue; const e = ci.e;
    if ((prev === 'ready' || prev === 'rest') && ci.phase === 'h1' && e < 3) whistle([.9]);
    else if (prev === 'h1' && ci.phase === 'gk' && e - ci.a < 3) whistle([.3, .3]);
    else if (prev === 'gk' && ci.phase === 'h2' && e - ci.b < 3) whistle([.9]);
    else if (prev === 'h2' && ci.phase === 'full' && e - ci.c < 3) whistle([.3, .3, 1.3]);
    else if (prev === 'rest' && ci.phase === 'ready' && ci.restEnd && Date.now() - ci.restEnd < 3000) whistle([.6, .6]) }
  keepAwake(run && !!S.openMatch);
}

/* ───────── actions ───────── */
function findPlayer(name) { const n = name.trim(); return Object.entries(S.players).find(([, p]) => p.name === n)?.[0] || null }
async function ensurePlayer(raw) {
  const guest = /\(\s*게\s*\)/.test(raw); const name = raw.replace(/\(\s*게\s*\)/g, '').trim().slice(0, 20); if (!name) return null;
  const ex = findPlayer(name); if (ex) return ex;
  const id = await S.store.add('players', { name, guest, createdAt: Date.now() }); S.players[id] = { name, guest }; return id;
}
function parseNames(txt) {
  const bad = /^(투표|참여|참석|불참|미정|명|총|인원|결과|항목|선택|님|외)$/;
  const out = []; for (const line of txt.split(/\r?\n/)) {
    const clean = line.replace(/^\s*[\d]+[.)]\s*/, '').replace(/[•·\-–—▪︎◦*#]/g, ' ');
    for (let tk of clean.split(/[\s,，、/]+/)) { tk = tk.trim(); if (!tk) continue; const guest = /\(\s*게\s*\)/.test(tk);
      tk = tk.replace(/\(.*?\)/g, '').replace(/[^\p{L}\p{N}]/gu, '').replace(/님$/, ''); if (!tk || /^\d+$/.test(tk) || bad.test(tk) || !/[가-힣A-Za-z]/.test(tk) || tk.length > 12) continue;
      out.push(tk + (guest ? '(게)' : '')) } }
  return [...new Set(out)];
}
async function createSession(f) {
  const sid = f.date; if (S.sessions[sid]) { toast('그 날짜의 경기일이 이미 있어요.'); S.sid = sid; S.step = null; S.tab = 'home'; render(); return }
  const doc = { date: sid, time: f.time || DEFAULTS.time, venue: f.venue || DEFAULTS.venue, evpw: f.evpw || '', notice: f.notice ?? DEFAULTS.notice,
    stage: 'apply', applicants: [], captains: { A: null, B: null, C: null }, order: [...KEYS], picks: [], draftStatus: 'ready',
    teams: { A: { players: [] }, B: { players: [] }, C: { players: [] } }, timing: DEF_TIMING, mom: {}, createdAt: Date.now() };
  if (await w(() => S.store.set(sp(sid), doc), '경기일을 만들었어요.')) { S.sid = sid; S.step = 'apply'; S.sheet = null; render() }
}
async function setStage(st) { const s = cur(); if (stageIdx(st) > stageIdx(s.stage)) await w(() => S.store.update(sp(S.sid), { stage: st })); S.step = st; render(); window.scrollTo(0, 0) }
async function addApplicants(names) {
  const s = cur(); const ids = [...(s.applicants || [])]; let n = 0;
  for (const nm of names) { const id = await ensurePlayer(nm); if (id && !ids.includes(id)) { ids.push(id); n++ } }
  await w(() => S.store.update(sp(S.sid), { applicants: ids }), `${n}명을 추가했어요.`);
}
async function sysChat(text) { if (!S.sid) return; try { await S.store.add(sp(S.sid) + '/chat', { name: '', uid: 'sys', text, at: Date.now() }) } catch { } }
async function startDraft() {
  const s = cur(); if (KEYS.some(k => !s.captains?.[k])) { toast('주장 3명을 먼저 정하세요.'); return }
  if (!pool({ ...s, picks: [] }).length) { toast('지명할 신청자가 없어요.'); return }
  if (await w(() => S.store.update(sp(S.sid), { draftStatus: 'live', picks: [], stage: 'draft' }))) {
    const o = s.order || KEYS; sysChat(`드래프트 시작! 순서: ${o.map(k => `${team(s, k).name}(${pname(s.captains[k])})`).join(' → ')}, 이후 역순`) }
}
async function doPick(pid) {
  const s = cur(); const k = pickTeamAt(s, (s.picks || []).length);
  if (!(S.admin || myTeam(s) === k)) { toast(`${team(s, k).name} 주장 또는 운영진만 지명할 수 있어요.`); return }
  let done = false;
  const ok = await w(() => S.store.txn(sp(S.sid), d => {
    if (!d || d.draftStatus !== 'live') return null; const i = (d.picks || []).length; if (pickTeamAt(d, i) !== k) return null;
    if (!pool(d).includes(pid)) return null; d.picks = [...(d.picks || []), { t: k, p: pid, at: Date.now() }];
    if (!pool(d).length) { d.draftStatus = 'done'; d.stage = 'trade'; KEYS.forEach(t => { d.teams = d.teams || {}; d.teams[t] = { ...(d.teams[t] || {}), players: [d.captains[t], ...d.picks.filter(x => x.t === t).map(x => x.p)] } }); done = true }
    return d }));
  if (!ok) { toast('이미 지명됐거나 차례가 바뀌었어요.'); return }
  sysChat(`${(s.picks || []).length + 1}순위 ${team(s, k).name}: ${pname(pid)}`);
  if (done) { sysChat('드래프트 완료! 교환 단계로 넘어가요.'); toast('드래프트가 끝났어요.') }
}
async function undoPick() {
  if (!needAdmin()) return; const s = cur(); if (!(s.picks || []).length) return;
  const last = s.picks[s.picks.length - 1];
  if (await w(() => S.store.txn(sp(S.sid), d => { d.picks = (d.picks || []).slice(0, -1); d.draftStatus = 'live'; if (d.stage === 'trade') d.stage = 'draft'; KEYS.forEach(t => { if (d.teams?.[t]) d.teams[t].players = [] }); return d })))
    sysChat(`운영진이 ${pname(last.p)} 지명을 되돌렸어요.`);
}
async function swapPlayers(a, b) {
  const s = cur(); const ta = KEYS.find(k => teamPlayers(s, k).includes(a)), tb = KEYS.find(k => teamPlayers(s, k).includes(b));
  if (!ta || !tb || ta === tb) return;
  const pa = teamPlayers(s, ta).map(x => x === a ? b : x), pb = teamPlayers(s, tb).map(x => x === b ? a : x);
  if (await w(() => S.store.update(sp(S.sid), { [`teams.${ta}.players`]: pa, [`teams.${tb}.players`]: pb }), '선수를 맞바꿨어요.'))
    sysChat(`교환: ${pname(a)}(${team(s, ta).name}) ↔ ${pname(b)}(${team(s, tb).name})`);
}
async function createMatches() {
  const s = cur(); if (sessMatches(S.sid).length) { await setStage('match'); return }
  const ok = await w(async () => { const jobs = []; let n = 0;
    for (let r = 1; r <= 3; r++) for (let sl = 1; sl <= 3; sl++) { n++; jobs.push(S.store.set('matches/' + S.sid + '_' + n, { session: S.sid, n, round: r, slot: sl, status: 'pending', timer: { running: false, acc: 0, startedAt: 0 }, endedAt: 0 })) }
    await Promise.all(jobs); await S.store.update(sp(S.sid), { stage: 'match' }) }, '9경기 일정을 만들었어요.');
  if (ok) { S.step = 'match'; render() }
}
const mp = id => 'matches/' + id;
async function startClock(m) { audio(); await w(() => S.store.update(mp(m.id), { status: 'live', timer: { running: true, startedAt: Date.now(), acc: m.timer?.acc || 0 } })) }
async function pauseClock(m) { await w(() => S.store.update(mp(m.id), { timer: { running: false, startedAt: 0, acc: Math.floor(elapsed(m)) } })) }
async function resetClock(m) { if (!confirm('타이머를 처음으로 되돌릴까요?')) return; await w(() => S.store.update(mp(m.id), { timer: { running: false, startedAt: 0, acc: 0 } })) }
async function endMatch(m) { await w(() => S.store.update(mp(m.id), { status: 'done', endedAt: Date.now(), timer: { running: false, startedAt: 0, acc: Math.floor(elapsed(m)) } }), '경기를 종료했어요.') }
async function addGoal(m, t, scorer, assist, og) { await w(() => S.store.add('events', { session: m.session, match: m.id, team: t, scorer: scorer || null, assist: assist || null, og: !!og, sec: Math.floor(elapsed(m)), half: clockInfo(m).phase, at: Date.now() }), '골을 기록했어요.') }

/* ───────── poster (canvas) ───────── */
let EMBLEM = null; function emblem() { if (EMBLEM) return Promise.resolve(EMBLEM); return new Promise(r => { const i = new Image(); i.onload = () => { EMBLEM = i; r(i) }; i.onerror = () => r(null); i.src = 'assets/emblem.png' }) }
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath() }
function fitFont(g, text, font, size, maxW) { let s = size; g.font = font.replace('{s}', s); while (g.measureText(text).width > maxW && s > 10) { s -= 2; g.font = font.replace('{s}', s) } return s }
function crown(g, x, y, s) { g.save(); g.fillStyle = '#FFC61A'; g.strokeStyle = '#8A5A00'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y + s * .78); g.lineTo(x, y + s * .22); g.lineTo(x + s * .27, y + s * .5); g.lineTo(x + s * .5, y); g.lineTo(x + s * .73, y + s * .5); g.lineTo(x + s, y + s * .22); g.lineTo(x + s, y + s * .78); g.closePath(); g.fill(); g.stroke(); g.fillRect(x, y + s * .84, s, s * .16); g.strokeRect(x, y + s * .84, s, s * .16); g.restore() }
function badge(g, img, cx, cy, r) { g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = Math.max(2, r * .08); g.strokeStyle = '#000'; g.stroke(); if (img) { g.clip(); g.drawImage(img, cx - r * .92, cy - r * .92, r * 1.84, r * 1.84) } g.restore() }
async function drawPoster(s) {
  const W = 1086, H = 1448; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  try { await Promise.all([document.fonts.load('80px "Anton"'), document.fonts.load('60px "Black Han Sans"')]) } catch { }
  const img = await emblem(); const LAT = '"Anton","Black Han Sans",Impact,sans-serif', KR = '"Black Han Sans","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
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
async function refreshPoster() { const s = cur(); if (!s) return; const c = await drawPoster(s); S.poster[S.sid] = c.toDataURL('image/png'); const el = document.querySelector('img.poster'); if (el) el.src = S.poster[S.sid]; else render() }
async function sharePoster(download) {
  const b = await posterBlob(); const name = `WF_MATCHDAY_${S.sid.replace(/-/g, '')}.png`; const file = new File([b], name, { type: 'image/png' });
  if (!download && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'WF MATCH DAY' }); return } catch (e) { if (e.name === 'AbortError') return } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000); toast('이미지를 저장했어요.');
}
function noticeText(s) {
  const lines = [`[${CFG.club?.short || 'WF'}] ${fmtDate(s.date)} ${s.time || ''} ${s.venue || ''}`.trim(), ''];
  for (const k of KEYS) { const t = team(s, k); lines.push(`■ ${t.name}`); lines.push(teamPlayers(s, k).map((id, i) => i === 0 && captainOf(s, k) === id ? pname(id) + '(C)' : pname(id)).join(' ')); lines.push('') }
  if (s.evpw) lines.push(`E/V 비밀번호: ${s.evpw}`); if (s.notice) lines.push(`공지: ${s.notice.replace(/[{}]/g, '')}`); return lines.join('\n');
}

/* ───────── rendering ───────── */
function isTyping() { const a = document.activeElement; return a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /text|search|tel|password/.test(a.type))) && document.getElementById('app').contains(a) }
function render() {
  if (isTyping()) { S.pending = true; return } S.pending = false;
  if (!S.admin && S.ready >= 3 && (!S.sid || !S.sessions[S.sid])) S.sid = defaultSid();
  if (S.store && S.chatSid !== S.sid) watchChat();
  const chatBox = document.querySelector('.msgs'); const atBottom = !chatBox || chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < 40;
  const ov = document.querySelector('.overlay')?.scrollTop;
  let h = appbar() + '<div class="wrap">';
  if (S.store?.kind === 'demo') h += `<div class="notice warn">체험 모드예요. 이 기기에만 저장되고 다른 폰과 공유되지 않아요. config.js에 Firebase 설정을 넣으면 함께 쓸 수 있어요.</div>`;
  if (S.err) h += `<div class="notice warn">${esc(S.err)}</div>`;
  if (S.ready < 3) h += '<p class="empty">불러오는 중…</p>';
  else if (S.tab === 'home') h += S.sid && S.sessions[S.sid] ? viewSession() : viewHome();
  else if (S.tab === 'draft') h += withSession(s => myTeam(s) ? (s.draftStatus === 'done' ? vTrade(s) : vDraft(s)) : vMemberNotice(s));
  else if (S.tab === 'match') h += withSession(s => vMatchDay(s));
  else if (S.tab === 'notice') h += withSession(vMemberNotice);
  else if (S.tab === 'stats') h += viewStats(); else h += viewSettings();
  h += '</div>' + tabs();
  if (S.openMatch && S.matches[S.openMatch]) h += viewMatch();
  if (S.sheet) h += viewSheet();
  document.getElementById('app').innerHTML = h;
  const nb = document.querySelector('.msgs'); if (nb && atBottom) nb.scrollTop = nb.scrollHeight;
  if (ov) document.querySelector('.overlay')?.scrollTo(0, ov);
  tick();
}
function appbar() {
  const s = S.sid ? S.sessions[S.sid] : null; const back = S.admin && S.tab === 'home' && s;
  return `<header class="appbar"><div class="in">${back ? '<button class="back" data-act="home" aria-label="경기일 목록">‹</button>' : `<img src="assets/emblem.png" alt="">`}
  <div class="ttl"><b>${esc(CFG.club?.name || 'WEEKDAYS FUTSAL CLUB')}</b><span>${s && S.tab !== 'settings' && S.tab !== 'stats' ? `${fmtDate(s.date)} ${esc(s.time || '')} ${esc(s.venue || '')}` : '팀 선정부터 경기 기록까지'}</span></div>
  ${S.store?.kind === 'demo' ? '<span class="pill">체험</span>' : ''}<button class="opbtn ${S.admin ? 'on' : ''}" data-act="opmode">${S.admin ? '운영 중' : '운영모드'}</button></div></header>`;
}
function tabs() {
  const t = S.admin ? [['home', '경기일'], ['stats', '선수 기록'], ['settings', '설정']] : [...(myTeam(cur()) ? [['draft', '드래프트']] : []), ['notice', '공지'], ['match', '경기'], ['stats', '기록'], ['settings', '설정']];
  return `<div class="tabs"><nav style="grid-template-columns:repeat(${t.length},1fr)">${t.map(([k, n]) => `<button data-act="tab" data-v="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${n}</button>`).join('')}</nav></div>` }
function sessionPicker() { const ids = Object.keys(S.sessions).sort().reverse(); if (ids.length < 2) return '';
  return `<label class="sr" for="sidpick">경기일 선택</label><select id="sidpick" class="inp" style="margin-top:12px" data-in="sidpick">${ids.map(id => `<option value="${id}" ${id === S.sid ? 'selected' : ''}>${fmtDate(id)} ${esc(S.sessions[id].time || '')}</option>`).join('')}</select>` }
function withSession(fn) { const s = cur(); if (!s) return `<p class="empty">아직 경기일이 없어요. 운영진이 만들면 여기에 보여요.</p>`; return sessionPicker() + fn(s) }
function vMemberNotice(s) {
  if (stageIdx(s.stage) >= stageIdx('notice')) return vNotice(s);
  if (s.draftStatus === 'live') return `<div class="notice"><span class="dot"></span> 지금 드래프트가 진행 중이에요. 실시간으로 볼 수 있어요.</div>` + vDraft(s);
  if (s.draftStatus === 'done') return `<div class="notice">드래프트가 끝나고 팀 밸런스를 맞추는 중이에요. 곧 공지가 올라와요.</div>` + vTrade(s);
  const ids = s.applicants || []; const caps = KEYS.filter(k => s.captains?.[k]);
  return `<h2>${fmtDate(s.date)} 경기</h2><div class="panel list2"><div><span>시간</span><b>${esc(s.time || '-')}</b></div><div><span>장소</span><b>${esc(s.venue || '-')}</b></div><div><span>진행 단계</span><b>${STAGES[stageIdx(s.stage)][1]}</b></div></div>
  ${caps.length ? `<h2>주장</h2><div class="panel list2">${caps.map(k => `<div><span>${tag(team(s, k))}</span><b>👑 ${esc(pname(s.captains[k]))}</b></div>`).join('')}</div>` : ''}
  <h2>신청자<small>${ids.length}명</small></h2><div class="panel"><div class="chips">${ids.map(id => `<span class="chip ${S.players[id]?.name === S.me ? 'sel' : ''}">${esc(pname(id))}</span>`).join('') || '<span class="muted">아직 신청자가 없어요.</span>'}</div></div>
  <p class="note">드래프트가 시작되면 이 화면에서 실시간으로 볼 수 있어요.</p>` + chatPanel();
}

function viewHome() {
  const ids = Object.keys(S.sessions).sort().reverse();
  let h = `<h2>경기일</h2>`;
  if (S.admin) h += `<button class="btn primary block" data-act="newsession">＋ 새 경기일 만들기</button><div style="height:12px"></div>`;
  h += `<div class="panel">${ids.length ? ids.map(id => { const s = S.sessions[id]; const st = STAGES[stageIdx(s.stage)]?.[1] || '';
    let r = `<span class="stagebadge">${st} 단계</span>`;
    if (isComplete(id)) { const top = standings(id).filter(x => x.rank === 1); r = top.map(x => `${bib(team(s, x.k).color)} ${esc(team(s, x.k).name)}`).join(' ') + (top.length > 1 ? ' 공동 1위' : ' 1위') }
    return `<button class="card" data-act="opensession" data-id="${id}"><span><span class="d">${fmtDate(id)} ${esc(s.time || '')}</span><br><span class="s">${esc(s.venue || '')}${s.applicants?.length ? `, 신청 ${s.applicants.length}명` : ''}</span></span><span class="r">${r}</span></button>` }).join('')
    : `<p class="empty">${S.admin ? '위 버튼으로 첫 경기일을 만들어 보세요.' : '아직 경기일이 없어요. 운영진이 만들면 여기에 보여요.'}</p>`}</div>`;
  return h;
}

function viewSession() {
  const s = cur(); const step = S.step || s.stage; const si = stageIdx(s.stage);
  let h = `<nav class="steps" aria-label="진행 단계">${STAGES.map(([k, n], i) => `<button data-act="step" data-v="${k}" class="${i < si ? 'done' : ''}" ${k === step ? 'aria-current="step"' : ''}><i>${i + 1}</i>${n}</button>`).join('')}</nav>`;
  h += ({ apply: vApply, captain: vCaptain, draft: vDraft, trade: vTrade, notice: vNotice, match: vMatchDay })[step](s);
  return h;
}
function vApply(s) {
  const ad = S.admin; const ids = s.applicants || [];
  let h = `<h2>경기 정보</h2><div class="panel">
    <div class="field"><label>시간</label><input class="inp" type="time" value="${esc(s.time)}" data-in="sfield" data-f="time" ${ad ? '' : 'disabled'}></div>
    <div class="field"><label for="f-venue">장소</label><input id="f-venue" class="inp" type="text" value="${esc(s.venue)}" data-in="sfield" data-f="venue" ${ad ? '' : 'disabled'}></div></div>`;
  h += `<h2>신청자<small>${ids.length}명</small></h2>`;
  if (ad) h += `<div class="panel"><div class="field"><label for="f-paste">카톡 투표 참여자 명단 붙여넣기</label><textarea id="f-paste" class="inp" data-in="pasteApply" placeholder="투표 참여자 이름을 복사해서 붙여넣으세요.&#10;줄바꿈, 쉼표, 띄어쓰기 모두 괜찮아요.">${esc(S.pasteApply)}</textarea></div>
    <div class="pad" style="padding-top:0"><button class="btn primary block" data-act="addapply">명단 추가</button></div></div><div style="height:10px"></div>`;
  h += `<div class="panel"><div class="chips">${ids.length ? ids.map(id => `<button class="chip ${ad ? 'x' : ''}" data-act="rmapply" data-id="${id}" ${ad ? '' : 'disabled'} aria-label="${esc(pname(id))}${ad ? ' 삭제' : ''}">${esc(pname(id))}</button>`).join('') : '<span class="muted">아직 신청자가 없어요.</span>'}</div>
    ${ad ? `<div class="pad" style="padding-top:0;display:flex;gap:8px"><input class="inp" type="text" placeholder="한 명씩 추가 (게스트는 이름(게))" data-in="addone" id="addone"><button class="btn" data-act="addone">추가</button></div>` : ''}</div>`;
  if (ids.length % 3 && ids.length) h += `<p class="note">${ids.length}명은 3팀으로 딱 나눠지지 않아요. 한 팀이 ${Math.ceil(ids.length / 3)}명이 돼요.</p>`;
  if (ad) h += `<div style="height:14px"></div><button class="btn primary block" data-act="gostage" data-v="captain" ${ids.length < 3 ? 'disabled' : ''}>다음: 주장 정하기</button>`;
  return h;
}
function vCaptain(s) {
  const ad = S.admin && s.draftStatus !== 'live' && s.draftStatus !== 'done';
  let h = `<h2>주장 3명</h2><div class="panel">${KEYS.map(k => { const t = team(s, k); const c = s.captains?.[k];
    return `<button class="slot" data-act="capslot" data-k="${k}" ${ad ? '' : 'disabled'}>${tag(t)}<span class="who ${c ? '' : 'empty'}">${c ? '👑 ' + esc(pname(c)) : '눌러서 주장 선택'}</span>${ad ? '<span class="muted">변경</span>' : ''}</button>` }).join('')}</div>`;
  const o = s.order || KEYS;
  h += `<h2>드래프트 순번<small>1-2-3-3-2-1 순서로 지명</small></h2><div class="panel">${o.map((k, i) => { const t = team(s, k);
    return `<div class="ordr"><span class="n">${i + 1}</span>${tag(t)}<span class="who">${esc(pname(s.captains?.[k]) === '미지정' ? '' : pname(s.captains?.[k]))}</span>
      ${ad ? `<button data-act="ord" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="위로">↑</button><button data-act="ord" data-i="${i}" data-d="1" ${i === 2 ? 'disabled' : ''} aria-label="아래로">↓</button>` : ''}</div>` }).join('')}</div>`;
  if (S.admin) h += capLinksPanel(s);
  if (ad) h += `<div class="row" style="margin-top:10px"><button class="btn" data-act="lottery">🎲 순번 추첨</button></div>
    <div style="height:12px"></div><button class="btn primary block" data-act="startdraft" ${KEYS.some(k => !s.captains?.[k]) ? 'disabled' : ''}>드래프트 시작</button>`;
  else if (s.draftStatus !== 'ready') h += `<p class="note">드래프트가 시작돼서 주장과 순번은 바꿀 수 없어요.</p>`;
  return h;
}
function capLinksPanel(s) {
  if (s.draftStatus === 'done') return '';
  return `<h2>주장 링크<small>주장에게 보내면 그 이름으로 드래프트에 참여해요</small></h2><div class="panel">${KEYS.map(k => { const c = s.captains?.[k];
    return `<div class="slot">${tag(team(s, k))}<span class="who ${c ? '' : 'empty'}">${c ? esc(pname(c)) : '주장 미지정'}</span>${c ? `<button class="btn sm" data-act="caplink" data-k="${k}" data-how="share">보내기</button><button class="btn sm" data-act="caplink" data-k="${k}" data-how="copy">복사</button>` : ''}</div>` }).join('')}</div>
  <p class="note">주장을 바꾸면 이전 링크는 더 이상 쓸 수 없어요.</p>`;
}
function snakePreview(s, from, n) { const out = []; const tot = draftTotal(s); for (let i = from; i < Math.min(tot, from + n); i++) out.push(pickTeamAt(s, i)); return out }
function vDraft(s) {
  const picks = s.picks || []; const tot = draftTotal(s); const i = picks.length; const my = myTeam(s);
  let h = my ? `<div class="capbanner" style="border-color:${team(s, my).color}">${tag(team(s, my))}<span><b>👑 ${esc(pname(s.captains?.[my]))}</b> 주장으로 참여 중</span></div>` : '';
  if (S.admin) h += capLinksPanel(s);
  if (s.draftStatus === 'ready') h += `<div class="notice">아직 드래프트 전이에요. ${S.admin ? '주장 단계에서 드래프트를 시작하세요.' : '운영진이 시작하면 여기서 실시간으로 지명할 수 있어요. 그동안 채팅으로 이야기 나눠요.'}</div>`;
  else if (s.draftStatus === 'live') { const k = pickTeamAt(s, i); const t = team(s, k); const mine = my === k || S.admin;
    h += `<div class="turn ${my === k ? 'mine' : ''}" style="border-left:8px solid ${t.color}"><div class="k">${i + 1}순위 / 전체 ${tot}명</div><div class="t">${esc(t.name)} ${esc(pname(s.captains[k]))} 주장 차례${my === k ? ', 내 차례!' : ''}</div>${my && my !== k ? (() => { let n = 0; for (let j = i; j < tot; j++) { if (pickTeamAt(s, j) === my) return `<div class="k" style="margin-top:4px">내 팀(${esc(team(s, my).name)}) 차례까지 ${n}번 남았어요</div>`; n++ } return '' })() : ''}
      <div class="nx">다음 ${snakePreview(s, i + 1, 7).map(x => `<span style="background:${team(s, x).color};color:${inkOn(team(s, x).color)}">${esc(team(s, x).name[0])}</span>`).join('') || '없음'}</div></div>`;
    const pl = pool(s);
    h += `<h2>남은 선수<small>${pl.length}명${mine ? ', 눌러서 지명' : ''}</small></h2><div class="panel"><div class="chips">${pl.map(id => `<button class="chip" data-act="pick" data-id="${id}" ${mine ? '' : 'disabled'}>${esc(pname(id))}</button>`).join('')}</div></div>`;
  } else h += `<div class="notice">드래프트가 끝났어요. <button class="btn sm primary" data-act="gostage" data-v="trade">교환 단계로</button></div>`;
  h += `<h2>팀 현황</h2><div class="cols">${KEYS.map(k => { const t = team(s, k); const ps = teamPlayers(s, k);
    return `<div class="col"><div class="hd" style="background:${t.color};color:${inkOn(t.color)}">${esc(t.name)}<small>${ps.length}명</small></div><ol>${ps.map((id, j) => { const pk = picks.findIndex(x => x.p === id);
      return `<li><em>${j === 0 ? '👑' : pk + 1}</em><span>${esc(pname(id))}</span></li>` }).join('')}</ol></div>` }).join('')}</div>`;
  if (S.admin && (s.draftStatus === 'live' || s.draftStatus === 'done') && picks.length) h += `<div class="row" style="margin-top:10px"><button class="btn sm" data-act="undo">↶ 마지막 지명 되돌리기</button></div>`;
  h += chatPanel();
  return h;
}
function chatPanel() {
  const me = S.me; const uid = load('uid', null) || (() => { const u = Math.random().toString(36).slice(2, 10); save('uid', u); return u })();
  return `<h2>팀 선정 채팅</h2><div class="panel chat"><div class="msgs" aria-live="polite">${S.chat.length ? S.chat.map(m => m.uid === 'sys' ? `<div class="msg sys"><div class="b">${esc(m.text)}</div></div>` :
    `<div class="msg ${m.uid === uid ? 'me' : ''}"><div class="n">${m.team ? '👑 ' : ''}${esc(m.name)}${m.team ? ` (${esc(team(cur(), m.team).name)} 주장)` : ''}</div><div class="b">${esc(m.text)}</div></div>`).join('') : '<p class="empty">첫 메시지를 남겨 보세요.</p>'}</div>
    <form data-form="chat"><label class="sr" for="chatin">메시지</label><input id="chatin" class="inp" type="text" placeholder="${myTeam(cur()) ? esc(pname(cur().captains[myTeam(cur())])) + ' 주장으로 보내기' : me ? esc(me) + '(으)로 보내기' : '메시지 (처음엔 이름을 물어봐요)'}" maxlength="300" autocomplete="off"><button class="btn primary" type="submit">보내기</button></form></div>`;
}
function vTrade(s) {
  const ad = S.admin && s.draftStatus === 'done';
  let h = s.draftStatus !== 'done' ? `<div class="notice">드래프트가 끝나면 선수를 맞바꿀 수 있어요.</div>` : `<p class="note" style="margin-top:14px">${ad ? '바꿀 선수 한 명을 누르고, 다른 팀 선수를 누르면 맞바꿔요. 주장은 바꿀 수 없어요.' : '운영진이 팀 밸런스를 맞추는 중이에요.'}</p>`;
  h += `<h2>팀 구성</h2><div class="cols">${KEYS.map(k => { const t = team(s, k); const ps = teamPlayers(s, k);
    return `<div class="col"><div class="hd" style="background:${t.color};color:${inkOn(t.color)}">${esc(t.name)}<small>${ps.length}명</small></div><ol>${ps.map((id, j) =>
      `<li class="${S.sel === id ? 'swap' : ''}">${j === 0 ? `<em>👑</em><span>${esc(pname(id))}</span>` : `<button data-act="selswap" data-id="${id}" ${ad ? '' : 'disabled'}><em>·</em><span>${esc(pname(id))}</span></button>`}</li>`).join('')}</ol></div>` }).join('')}</div>`;
  if (ad) h += `<div style="height:14px"></div><button class="btn primary block" data-act="gostage" data-v="notice">팀 확정, 공지 이미지 만들기</button>`;
  h += chatPanel();
  return h;
}
function vNotice(s) {
  const ad = S.admin; const img = S.poster[S.sid];
  if (!img) queueMicrotask(refreshPoster);
  let h = `<h2>공지 이미지</h2><img class="poster" alt="매치데이 공지 이미지 미리보기" src="${img || ''}" width="1086" height="1448">
  <div class="row" style="margin-top:10px"><button class="btn primary" data-act="share">카톡 등으로 공유</button><button class="btn" data-act="download">이미지 저장</button></div>
  <button class="btn block" style="margin-top:8px" data-act="copytext">공지 텍스트 복사</button>`;
  if (ad) h += `<h2>공지 내용</h2><div class="panel">
    <div class="field"><label for="f-ev">E/V 비밀번호</label><input id="f-ev" class="inp" type="text" value="${esc(s.evpw || '')}" data-in="sfield" data-f="evpw" ${ad ? '' : 'disabled'}></div>
    <div class="field"><label for="f-nt">NOTICE 문구</label><input id="f-nt" class="inp" type="text" value="${esc(s.notice || '')}" data-in="sfield" data-f="notice" ${ad ? '' : 'disabled'}><span class="note" style="margin:0">{ } 로 감싼 글자는 노란색으로 강조돼요.</span></div></div>`;
  if (ad) h += `<div style="height:14px"></div><button class="btn primary block" data-act="mkmatches">경기 일정 만들기 (9경기)</button>`;
  return h;
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
  h += `<h2>경기 일정</h2>`;
  for (let r = 1; r <= 3; r++) h += `<div class="round"><h3>${r}라운드</h3><div class="panel">${ms.filter(m => m.round === r).map(m => { const H = team(s, m.home), A = team(s, m.away); const [a, b] = score(m); const win = m.status === 'done' ? (a > b ? 'win-h' : a < b ? 'win-a' : '') : '';
    return `<button class="mrow ${m.status === 'live' ? 'is-live' : ''} ${win}" data-act="open" data-id="${m.id}"><span class="side">${bib(H.color)}<span>${esc(H.name)}</span></span><span class="mid"><span class="sc">${m.status === 'pending' ? 'vs' : a + ' : ' + b}</span><span class="st">${m.status === 'done' ? '종료' : `<span data-phase="${m.id}"></span>${m.status === 'live' ? ` <span data-clock="${m.id}"></span>` : ''}`}</span></span><span class="side r"><span>${esc(A.name)}</span>${bib(A.color)}</span></button>` }).join('')}</div></div>`;
  const tally = {}; for (const e of Object.values(S.events)) { if (e.session !== S.sid || e.og) continue; if (e.scorer) (tally[e.scorer] ??= { g: 0, a: 0 }).g++; if (e.assist) (tally[e.assist] ??= { g: 0, a: 0 }).a++ }
  const top = Object.entries(tally).sort((x, y) => (y[1].g + y[1].a) - (x[1].g + x[1].a) || y[1].g - x[1].g).slice(0, 10);
  h += `<h2>오늘의 공격포인트</h2><div class="panel list2">${top.length ? top.map(([id, t]) => `<div><span>${esc(pname(id))}</span><span class="muted">${t.g}골 ${t.a}도움</span></div>`).join('') : '<p class="empty">아직 골이 없어요.</p>'}</div>`;
  h += `<h2>MOM<small>팀별 한 명, ${S.admin ? '운영진' : '각 팀 주장'}이 선택</small></h2><div class="panel">${KEYS.map(k => { const t = team(s, k); const pid = s.mom?.[k];
    return `<button class="momrow" data-act="mom" data-k="${k}" ${canMom(s, k) ? '' : 'disabled'}>${bib(t.color)}<span class="t">${esc(t.name)}${myTeam(s) === k ? ' (내 팀)' : ''}</span><span class="v ${pid ? 'set' : ''}">${pid ? '🏅 ' + esc(pname(pid)) : canMom(s, k) ? '선택하기' : '미정'}</span></button>` }).join('')}</div>`;
  if (S.admin) { const st = (key, lab, val, unit) => `<div class="stepper"><button data-act="tstep" data-key="${key}" data-d="-1" aria-label="${lab} 줄이기">−</button><span><small>${lab}</small>${val}${unit}</span><button data-act="tstep" data-key="${key}" data-d="1" aria-label="${lab} 늘리기">+</button></div>`;
    h += `<h2>경기 시간 설정</h2><div class="grid2">${st('h1', '전반', T.h1 / 60, '분')}${st('gk', 'GK 교체', T.gk, '초')}${st('h2', '후반', T.h2 / 60, '분')}${st('rest', '쉬는 시간', T.rest / 60, '분')}</div>
    <h2>관리</h2><button class="btn danger block" data-act="delsession">이 경기일 전체 삭제</button>` }
  return h;
}
function viewMatch() {
  const m = M(S.openMatch); const s = S.sessions[m.session]; if (!s) return ''; const H = team(s, m.home), A = team(s, m.away); const [a, b] = score(m); const run = !!m.timer?.running; const T = timing(s);
  const next = sessMatches(m.session).find(x => x.n > m.n && x.status !== 'done'); const can = S.admin;
  let h = `<div class="overlay" role="dialog" aria-label="${m.round}라운드 ${m.slot}경기"><div class="wrap"><div class="obar"><button class="btn sm" data-act="close">← 목록</button><span class="muted">${m.round}라운드 ${m.slot}경기</span></div>
  <div class="board"><div class="teams"><div class="t"><div class="bar" style="background:${H.color}"></div><div class="num">${a}</div><div class="nm">${esc(H.name)}</div></div><div class="colon">:</div><div class="t"><div class="bar" style="background:${A.color}"></div><div class="num">${b}</div><div class="nm">${esc(A.name)}</div></div></div>
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
  h += `<h2>골 기록</h2><div class="panel">${evs.length ? evs.map(e => { const t = team(s, e.team); const second = e.half === 'h2' || e.half === 'full' || e.sec >= T.h1 + T.gk; const mn = second ? Math.floor((e.sec - T.h1 - T.gk) / 60) + 1 : Math.floor(e.sec / 60) + 1;
    return `<div class="ev"><span class="min">${second ? '후' : '전'} ${Math.max(1, mn)}'</span>${bib(t.color)}<span class="who">${e.og ? '상대 자책골' : esc(pname(e.scorer))}${e.assist ? `<small>도움 ${esc(pname(e.assist))}</small>` : ''}</span>${can ? `<button class="x" data-act="delev" data-id="${e.id}" aria-label="골 기록 삭제">×</button>` : ''}</div>` }).join('') : '<p class="empty">골이 나면 위의 팀 버튼을 누르세요.</p>'}</div></div></div>`;
  return h;
}
function viewSheet() {
  const sh = S.sheet; let h = `<div class="scrim" data-act="closesheet"><div class="sheet" role="dialog" aria-modal="true" data-stop><div class="grab"></div>`;
  if (sh.type === 'newsession') h += `<h4>새 경기일</h4><p>날짜와 기본 정보를 정하세요. 나중에 바꿀 수 있어요.</p><form data-form="newsession"><div class="panel">
    <div class="field"><label for="n-date">날짜</label><input id="n-date" class="inp" type="date" name="date" value="${today()}" required></div>
    <div class="field"><label for="n-time">시간</label><input id="n-time" class="inp" type="time" name="time" value="${esc(DEFAULTS.time)}"></div>
    <div class="field"><label for="n-venue">장소</label><input id="n-venue" class="inp" type="text" name="venue" value="${esc(DEFAULTS.venue)}"></div>
    <div class="field"><label for="n-ev">E/V 비밀번호</label><input id="n-ev" class="inp" type="text" name="evpw" value=""></div></div>
    <div class="row" style="margin-top:12px"><button type="button" class="btn" data-act="closesheet">취소</button><button class="btn primary" type="submit">만들기</button></div></form>`;
  else if (sh.type === 'capslot') { const s = cur(); const taken = KEYS.filter(k => k !== sh.k).map(k => s.captains?.[k]);
    h += `<h4>${esc(team(s, sh.k).name)} 주장</h4><p>신청자 중에서 고르세요.</p><div class="pick">${(s.applicants || []).map(id => `<button class="${s.captains?.[sh.k] === id ? 'cur' : ''}" data-act="pickcap" data-id="${id}" ${taken.includes(id) ? 'disabled' : ''}>${esc(pname(id))}</button>`).join('')}${s.captains?.[sh.k] ? '<button class="alt" data-act="pickcap" data-id="">선택 취소</button>' : ''}</div>` }
  else if (sh.type === 'goal') { const m = M(sh.match); const s = S.sessions[m.session]; const t = team(s, sh.team); const ps = teamPlayers(s, sh.team); const ci = clockInfo(m);
    if (sh.step === 'scorer') h += `<h4>${esc(t.name)} 골! 누가 넣었나요?</h4><p>${esc(ci.label)} ${esc(ci.time)} 시점으로 기록돼요.</p><div class="pick">${ps.map(id => `<button data-act="pickscorer" data-id="${id}">${captainOf(s, sh.team) === id ? '👑 ' : ''}${esc(pname(id))}</button>`).join('')}<button class="alt" data-act="pickscorer" data-id="">선수 미지정</button><button class="alt" data-act="pickog">상대 자책골</button></div>`;
    else h += `<h4>도움은 누가 했나요?</h4><p>득점 ${esc(pname(sh.scorer))}</p><div class="pick">${ps.filter(id => id !== sh.scorer).map(id => `<button data-act="pickassist" data-id="${id}">${esc(pname(id))}</button>`).join('')}<button class="alt" data-act="pickassist" data-id="">도움 없음</button></div>` }
  else if (sh.type === 'mom') { const s = cur(); const t = team(s, sh.k); const c = s.mom?.[sh.k];
    h += `<h4>${esc(t.name)} MOM</h4><p>주장이 고른 선수를 눌러 주세요.</p><div class="pick">${teamPlayers(s, sh.k).map(id => `<button class="${c === id ? 'cur' : ''}" data-act="pickmom" data-id="${id}">${esc(pname(id))}</button>`).join('')}${c ? '<button class="alt" data-act="pickmom" data-id="">선택 취소</button>' : ''}</div>` }
  h += `<div class="row" style="margin-top:14px"><button class="btn" data-act="closesheet">닫기</button></div></div></div>`; return h;
}
function viewStats() {
  const sorts = [['pts', '공격포인트'], ['g', '골'], ['a', '도움'], ['mom', 'MOM'], ['wr', '승률'], ['wins', '1위'], ['cap', '주장'], ['days', '출전']];
  const rows = playerStats(); const key = S.statsSort; const val = (r, k) => k === 'pts' ? r.g + r.a : k === 'wr' ? (r.gp ? r.w / r.gp : -1) : r[k];
  rows.sort((x, y) => val(y, key) - val(x, key) || (y.g + y.a) - (x.g + x.a) || S.players[x.id].name.localeCompare(S.players[y.id].name, 'ko')); const c = k => key === k ? 'hl' : '';
  const mine = rows.find(r => S.players[r.id]?.name === S.me);
  let h = mine ? `<h2>내 기록<small>${esc(pname(mine.id))}</small></h2><div class="mystats">${[['골', mine.g], ['도움', mine.a], ['MOM', mine.mom], ['승률', mine.gp ? Math.round(mine.w / mine.gp * 100) + '%' : '-'], ['경기', mine.gp], ['출전', mine.days + '일']].map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>` : '';
  h += `<h2>누적 개인 기록<small>경기 일정이 만들어진 날만 집계</small></h2><div class="sorts">${sorts.map(([k, n]) => `<button data-act="sort" data-k="${k}" aria-pressed="${key === k}">${n}</button>`).join('')}</div>
  <div class="panel tblwrap">${rows.length ? `<table class="stats"><thead><tr><th>선수</th><th>골</th><th>도움</th><th>공P</th><th>MOM</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>승률</th><th>1위</th><th>주장</th><th>출전</th></tr></thead><tbody>
  ${rows.map(r => `<tr ${r === mine ? 'class="me"' : ''}><td>${esc(pname(r.id))}</td><td class="${c('g')}">${r.g}</td><td class="${c('a')}">${r.a}</td><td class="${c('pts')}">${r.g + r.a}</td><td class="${c('mom')}">${r.mom}</td><td>${r.gp}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td class="${c('wr')}">${r.gp ? Math.round(r.w / r.gp * 100) + '%' : '-'}</td><td class="${c('wins')}">${r.wins}</td><td class="${c('cap')}">${r.cap}</td><td class="${c('days')}">${r.days}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">경기를 치르면 기록이 쌓여요.</p>'}</div>
  <p class="note">표는 옆으로 밀어서 볼 수 있어요. 1위는 9경기를 모두 마친 날 팀 1위 횟수, 출전은 참가한 날 수예요.</p>`;
  if (S.admin) { const roster = Object.entries(S.players).sort((a, b) => a[1].name.localeCompare(b[1].name, 'ko'));
    h += `<h2>선수 명단<small>${roster.length}명, 눌러서 이름 수정</small></h2><div class="panel"><div class="chips">${roster.map(([id]) => `<button class="chip" data-act="editp" data-id="${id}">${esc(pname(id))}</button>`).join('') || '<span class="muted">없음</span>'}</div></div>` }
  return h;
}
function viewSettings() {
  return `<h2>내 정보</h2><div class="panel"><div class="field"><label for="me">이름 (채팅 표시, 내 기록 찾기에 쓰여요)</label><input id="me" class="inp" type="text" value="${esc(S.me)}" data-in="me" maxlength="12"></div>
  </div>
  <h2>휘슬</h2><div class="panel pad"><button class="btn block" data-act="whistle">${S.whistle ? '🔊 이 폰에서 휘슬 켜짐' : '🔇 이 폰에서 휘슬 꺼짐'}</button><p class="note">웹에서는 휘슬이 울리려면 경기 화면을 켜 두어야 해요.</p></div>
  <h2>연결</h2><div class="panel pad"><p style="margin:0">${S.store?.kind === 'live' ? 'Firebase에 연결됨. 모든 기기가 같은 데이터를 봐요.' : '체험 모드 (이 기기에만 저장)'}</p></div>`;
}
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
  if (k === 'pasteApply') S.pasteApply = el.value;
  if (k === 'me') { S.me = el.value.trim(); save('me', S.me) }
  if (k === 'sfield' && S.admin) { const f = el.dataset.f; clearTimeout(saveT[f]); saveT[f] = setTimeout(async () => { await w(() => S.store.update(sp(S.sid), { [f]: el.value })); if (f === 'evpw' || f === 'notice') refreshPoster() }, 600) } });
document.addEventListener('change', e => { const el = e.target; if (el.dataset.in === 'sidpick') { S.sid = el.value; S.openMatch = null; render(); return } if (el.dataset.in === 'sfield' && el.type === 'time' && S.admin) w(() => S.store.update(sp(S.sid), { time: el.value })) });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'addone') { e.preventDefault(); document.querySelector('[data-act="addone"]').click() } if (e.key === 'Escape') { if (S.sheet) { S.sheet = null; render() } else if (S.openMatch) { S.openMatch = null; render() } } });
document.addEventListener('submit', async e => { e.preventDefault(); const f = e.target;
  if (f.dataset.form === 'newsession') { const d = Object.fromEntries(new FormData(f)); await createSession(d) }
  if (f.dataset.form === 'chat') { const inp = f.querySelector('input'); const text = inp.value.trim(); if (!text) return;
    const mk = myTeam(cur()); let name = mk ? pname(cur().captains[mk]) : S.me;
    if (!name) { const n = prompt('채팅에 표시할 이름을 입력하세요'); if (!n || !n.trim()) return; S.me = n.trim().slice(0, 12); save('me', S.me); name = S.me }
    inp.value = ''; await w(() => S.store.add(sp(S.sid) + '/chat', { name, uid: load('uid', ''), team: mk || null, text: text.slice(0, 300), at: Date.now() })); inp.focus() } });

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.classList.contains('scrim') && e.target.closest('[data-stop]')) return;
  if (el.disabled) return; const act = el.dataset.act, id = el.dataset.id; const s = cur(); const m = S.openMatch ? M(S.openMatch) : null;
  switch (act) {
    case 'tab': S.tab = el.dataset.v; S.openMatch = null; S.sheet = null; S.sel = null; render(); window.scrollTo(0, 0); break;
    case 'home': S.sid = null; S.step = null; watchChat(); render(); break;
    case 'opensession': S.sid = id; S.step = null; S.sel = null; watchChat(); render(); window.scrollTo(0, 0); break;
    case 'newsession': if (!needAdmin()) break; S.sheet = { type: 'newsession' }; render(); break;
    case 'step': S.step = el.dataset.v; S.sel = null; render(); window.scrollTo(0, 0); break;
    case 'gostage': if (!needAdmin() && el.dataset.v !== 'trade') break; await setStage(el.dataset.v); break;
    case 'addapply': { const names = parseNames(S.pasteApply); if (!names.length) { toast('이름을 찾지 못했어요.'); break } S.pasteApply = ''; await addApplicants(names); break }
    case 'addone': { const inp = document.getElementById('addone'); const v = inp.value.trim(); if (!v) break; inp.value = ''; await addApplicants([v]); break }
    case 'rmapply': if (!needAdmin()) break; if (s.draftStatus !== 'ready') { toast('드래프트가 시작된 뒤에는 신청자를 뺄 수 없어요.'); break }
      await w(() => S.store.update(sp(S.sid), { applicants: (s.applicants || []).filter(x => x !== id), captains: Object.fromEntries(KEYS.map(k => [k, s.captains?.[k] === id ? null : (s.captains?.[k] || null)])) })); break;
    case 'capslot': S.sheet = { type: 'capslot', k: el.dataset.k }; render(); break;
    case 'pickcap': { const k = S.sheet.k; S.sheet = null; render(); await w(() => S.store.update(sp(S.sid), { [`captains.${k}`]: id || null, [`captainTokens.${k}`]: id ? rand() : null })); break }
    case 'ord': { const o = [...(s.order || KEYS)]; const i = +el.dataset.i, j = i + (+el.dataset.d); [o[i], o[j]] = [o[j], o[i]]; await w(() => S.store.update(sp(S.sid), { order: o })); break }
    case 'lottery': { const o = [...KEYS]; for (let i = 2; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]] }
      if (await w(() => S.store.update(sp(S.sid), { order: o }), '순번을 추첨했어요.')) sysChat(`순번 추첨 결과: ${o.map((k, i) => `${i + 1}번 ${team(s, k).name}`).join(', ')}`); break }
    case 'startdraft': if (!needAdmin()) break; if (!confirm('드래프트를 시작할까요? 시작하면 주장과 순번은 바꿀 수 없어요.')) break; await startDraft(); S.step = 'draft'; render(); break;
    case 'pick': { const nm = pname(id); if (!confirm(`${nm} 선수를 지명할까요?`)) break; await doPick(id); break }
    case 'undo': if (confirm('마지막 지명을 되돌릴까요?')) await undoPick(); break;
    case 'noop': break;
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
    case 'goal': S.sheet = { type: 'goal', match: m.id, team: el.dataset.team, step: 'scorer' }; render(); break;
    case 'pickscorer': { const sh = S.sheet; if (id) { sh.scorer = id; sh.step = 'assist'; render(); break } S.sheet = null; render(); await addGoal(M(sh.match), sh.team, null, null, false); break }
    case 'pickog': { const sh = S.sheet; S.sheet = null; render(); await addGoal(M(sh.match), sh.team, null, null, true); break }
    case 'pickassist': { const sh = S.sheet; S.sheet = null; render(); await addGoal(M(sh.match), sh.team, sh.scorer, id || null, false); break }
    case 'delev': if (confirm('이 골 기록을 지울까요?')) await w(() => S.store.del('events/' + id)); break;
    case 'mom': if (!canMom(s, el.dataset.k)) break; S.sheet = { type: 'mom', k: el.dataset.k }; render(); break;
    case 'pickmom': { const k = S.sheet.k; S.sheet = null; render(); await w(() => S.store.update(sp(S.sid), { [`mom.${k}`]: id || null })); break }
    case 'tstep': { const k = el.dataset.key, d = +el.dataset.d; const T = { ...timing(s) }; if (k === 'gk') T.gk = Math.min(30, Math.max(0, T.gk + d)); else T[k] = Math.min(45 * 60, Math.max(k === 'rest' ? 0 : 60, T[k] + d * 60)); await w(() => S.store.update(sp(S.sid), { timing: T })); break }
    case 'delsession': if (!confirm(fmtDate(S.sid) + ' 경기일을 통째로 지울까요? 되돌릴 수 없어요.')) break;
      await w(async () => { for (const [eid, ev] of Object.entries(S.events)) if (ev.session === S.sid) await S.store.del('events/' + eid); for (const mm of sessMatches(S.sid)) await S.store.del(mp(mm.id)); await S.store.del(sp(S.sid)) }, '삭제했어요.'); S.sid = null; render(); break;
    case 'sort': S.statsSort = el.dataset.k; render(); break;
    case 'editp': { const p = S.players[id]; const nv = prompt('선수 이름 (게스트는 뒤에 (게))', pname(id)); if (nv === null || !nv.trim()) break; const guest = /\(\s*게\s*\)/.test(nv); const name = nv.replace(/\(\s*게\s*\)/g, '').trim().slice(0, 20); if (name !== p.name || guest !== !!p.guest) await w(() => S.store.update('players/' + id, { name, guest }), '수정했어요.'); break }
    case 'opmode': if (S.admin) { if (!confirm('운영모드를 끌까요?')) break; S.adminOn = false; save('admin', false); S.tab = 'notice'; S.sid = null; S.step = null; S.openMatch = null; render(); window.scrollTo(0, 0); break }
      { const pin = prompt('운영진 비밀번호'); if (pin === null) break; if (pin !== String(CFG.adminPin ?? '0000')) { toast('비밀번호가 달라요.'); break }
        S.adminOn = true; save('admin', true); S.tab = 'home'; S.sid = null; S.step = null; S.openMatch = null; toast('운영모드로 전환했어요.'); render(); window.scrollTo(0, 0) } break;
    case 'caplink': { const k = el.dataset.k; let t = s.captainTokens?.[k]; if (!t) { t = rand(); if (!await w(() => S.store.update(sp(S.sid), { [`captainTokens.${k}`]: t }))) break }
      const url = capLink(S.sid, k, t); const msg = `[${CFG.club?.short || 'WF'}] ${fmtDate(S.sid)} 드래프트 ${team(s, k).name} 주장 ${pname(s.captains[k])}님 전용 링크예요.\n${url}`;
      if (el.dataset.how === 'share' && navigator.share) { try { await navigator.share({ text: msg }); break } catch (e) { if (e.name === 'AbortError') break } }
      try { await navigator.clipboard.writeText(msg); toast(`${team(s, k).name} 주장 링크를 복사했어요.`) } catch { prompt('아래 링크를 복사해서 보내세요', url) } break }
    case 'whistle': S.whistle = !S.whistle; save('whistle', S.whistle); if (S.whistle) { audio(); whistle([.35]) } render(); break;
    case 'closesheet': S.sheet = null; render(); break;
  }
});

/* ───────── boot ───────── */
function watchChat() {
  if (S.chatSid === S.sid) return; S.unsubChat && S.unsubChat(); S.chat = []; S.chatSid = S.sid;
  if (!S.sid || !S.store) return; S.unsubChat = S.store.watchCol(sp(S.sid) + '/chat', docs => { S.chat = docs; render() }, { order: 'at', limit: 150 });
}
(async function boot() {
  const q = new URLSearchParams(location.search);
  if (q.get('d') && q.get('c') && q.get('t')) { S.capLinks[q.get('d')] = { k: q.get('c'), t: q.get('t') }; save('caplinks', S.capLinks); S.sid = q.get('d'); S.tab = 'draft'; S.adminOn = S.adminOn && false; S.pendingLink = q.get('d'); history.replaceState(null, '', location.pathname) }
  render();
  try { S.store = CFG.firebase?.apiKey ? await firebaseStore(CFG.firebase) : localStore() }
  catch (e) { console.error(e); S.err = 'Firebase에 연결하지 못해 체험 모드로 열었어요. config.js 설정과 인터넷 연결을 확인하세요.'; S.store = localStore() }
  const onErr = () => { S.err = '데이터를 불러오지 못했어요. Firebase 규칙과 익명 로그인 설정을 확인하세요.'; render() };
  let posterT; const sub = (p, key) => { let first = true; S.store.watchCol(p, docs => { const o = {}; docs.forEach(d => { const { id, ...rest } = d; o[id] = rest }); S[key] = o; if (first) { first = false; S.ready++ }
    if (key === 'sessions' && S.pendingLink) { const sid = S.pendingLink; S.pendingLink = null; S.sid = S.sessions[sid] ? sid : null; if (!S.sessions[sid] || !myTeam(S.sessions[sid])) { toast('만료되었거나 잘못된 주장 링크예요. 운영진에게 새 링크를 받아 주세요.'); S.tab = 'notice' } else toast(`${team(S.sessions[sid], myTeam(S.sessions[sid])).name} 주장으로 드래프트에 참여해요.`) }
    if (key === 'sessions' && S.sid && S.tab === 'home' && (S.step || S.sessions[S.sid]?.stage) === 'notice') { clearTimeout(posterT); posterT = setTimeout(refreshPoster, 300) }
    render() }, null, onErr) };
  sub('players', 'players'); sub('sessions', 'sessions'); sub('matches', 'matches');
  S.store.watchCol('events', docs => { const o = {}; docs.forEach(d => { const { id, ...rest } = d; o[id] = rest }); S.events = o; render() }, null, onErr);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
})();
