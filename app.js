/* WD_FUTSAL — 신청 · 주장 · 드래프트 · 교환 · 공지 이미지 · 경기 기록 */
const CFG = window.WF_CONFIG || {};
const KEYS = ['A', 'B', 'C'];
const PAIRS = [['A', 'B'], ['B', 'C'], ['C', 'A']];
const STAGES = [['apply', '신청'], ['captain', '주장'], ['draft', '드래프트'], ['trade', '밸런스 조정'], ['notice', '공지'], ['match', '경기']];
const DEF_TIMING = { h1: 300, gk: 5, h2: 300, rest: 180, ...(CFG.timing || {}) };
const PALETTE = CFG.colors || [{ name: 'BLUE', color: '#1E46C8' }, { name: 'BLACK', color: '#16181C' }, { name: 'RED', color: '#D7263D' }, { name: 'WHITE', color: '#F2F3F5' }, { name: 'YELLOW', color: '#F5C518' }, { name: 'GREEN', color: '#1E9E57' }];
const NEUTRAL = { A: '#5B6573', B: '#8A939E', C: '#B3BAC4' };
const DEFAULTS = { time: '21:00', venue: '용산 7구장', notice: '', ...(CFG.defaults || {}) };

/* ───────── storage backends ───────── */
function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)) }
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
    set: (p, d) => db.doc(p).set(d),
    update: (p, d) => db.doc(p).update(nest(d)),
    add: async (p, d) => (await db.collection(p).add(d)).id,
    del: p => db.doc(p).delete(),
    async txn(p, fn) { const ref = db.doc(p);
      for (let i = 0; i < 8; i++) { const r = await ref.acquire({ holder, ttlMs: 4000 });
        if (r.acquired) { const sn = await ref.get(); const nd = fn(sn.exists ? sn.data() : null); if (nd == null) throw new Error('aborted'); await ref.set(nd); return }
        await new Promise(res => setTimeout(res, 350)) }
      throw new Error('busy') }
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
    get: async p => { const sn = await F.getDoc(ref(p)); return sn.exists() ? sn.data() : null },
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
  tab: load('admin', false) ? 'manage' : 'mhome', mfilter: 'up', cal: null, sub: null, detail: null, rankKey: 'g', sid: null, step: null, openMatch: null, sheet: null, sel: null, statsSort: 'pts',
  adminOn: load('admin', false), me: load('me', ''), capLinks: load('caplinks', {}), linkErr: '', whistle: load('whistle', true),
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
function colorPanel(s) {
  if (s.draftStatus !== 'done') return ''; const my = myTeam(s); const can = k => S.admin || my === k;
  return `<h2>팀 색 선택<small>${allPicked(s) ? '모든 팀이 골랐어요' : '각 팀 주장이 조끼 색을 골라요'}</small></h2><div class="panel">${KEYS.map(k => { const t = team(s, k); const cur = s.teams?.[k]?.colorName;
    return `<div class="colrow"><div class="colhd">${tag(t)}<span>👑 ${esc(pname(s.captains?.[k]))}</span>${t.picked ? '' : '<em>선택 전</em>'}${my === k ? '<b class="metag">내 팀</b>' : ''}</div>
    ${can(k) ? `<div class="cswatch">${PALETTE.map(p => { const by = KEYS.find(o => o !== k && s.teams?.[o]?.colorName === p.name);
      return `<button class="csw ${cur === p.name ? 'on' : ''}" style="background:${p.color};color:${inkOn(p.color)}" data-act="pickcolor" data-k="${k}" data-c="${p.name}" ${by ? 'disabled' : ''} aria-pressed="${cur === p.name}">${p.name}${by ? '<small>선택됨</small>' : ''}</button>` }).join('')}</div>` : ''}</div>` }).join('')}</div>`;
}
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
  const prev = new Date(sid + 'T00:00'); prev.setDate(prev.getDate() - 1); const defClose = `${prev.getFullYear()}-${p2(prev.getMonth() + 1)}-${p2(prev.getDate())}T22:00`;
  const doc = { date: sid, time: f.time || DEFAULTS.time, venue: f.venue || DEFAULTS.venue, evpw: f.evpw || '', notice: f.notice ?? DEFAULTS.notice,
    capacity: +f.capacity || DEFAULTS.capacity || 18, applyOpen: f.applyOpen || nowLocal(), applyClose: f.applyClose || defClose,
    stage: 'apply', applicants: [], captains: { A: null, B: null, C: null }, order: [...KEYS], picks: [], draftStatus: 'ready',
    teams: { A: { players: [] }, B: { players: [] }, C: { players: [] } }, timing: DEF_TIMING, mom: {}, createdAt: Date.now() };
  if (await w(() => S.store.set(sp(sid), doc), '경기일을 만들었어요.')) { S.sid = sid; S.step = 'apply'; S.sheet = null; render() }
}
async function setStage(st) { const s = cur(); if (stageIdx(st) > stageIdx(s.stage)) await w(() => S.store.update(sp(S.sid), { stage: st })); if (st === 'notice') { S.tab = 'notice'; S.step = null; render(); window.scrollTo(0, 0); return } S.step = st; render(); window.scrollTo(0, 0) }
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
  if (done) { sysChat('드래프트 완료! 밸런스 조정 단계로 넘어가요.'); toast('드래프트가 끝났어요.') }
}
async function undoPick() {
  if (!needAdmin()) return; const s = cur(); if (!(s.picks || []).length) return;
  const last = s.picks[s.picks.length - 1];
  if (await w(() => S.store.txn(sp(S.sid), d => { d.picks = (d.picks || []).slice(0, -1); d.draftStatus = 'live'; d.pending = null; if (d.stage === 'trade') d.stage = 'draft'; KEYS.forEach(t => { if (d.teams?.[t]) d.teams[t].players = [] }); return d })))
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
function render() {
  if (isTyping()) { S.pending = true; return } S.pending = false;
  S.dm = !isDesk();
  if (S.ready >= 3 && (!S.sid || !S.sessions[S.sid])) S.sid = defaultSid();
  if (S.store && S.chatSid !== S.sid) watchChat();
  if (S.admin) watchContacts();
  const chatBox = document.querySelector('.msgs'); const atBottom = !chatBox || chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < 40;
  const ov = document.querySelector('.overlay')?.scrollTop;
  const ci = document.getElementById('chatin'); const ciState = ci ? { v: ci.value, f: document.activeElement === ci, a: ci.selectionStart, b: ci.selectionEnd } : null;
  let h = appbar() + '<div class="wrap">';
  if (S.err) h += `<div class="notice warn">${esc(S.err)}</div>`;
  if (S.ready < 3) h += '<p class="empty">불러오는 중…</p>';
  else if (S.tab === 'manage') h += viewManage();
  else if (S.tab === 'run') h += viewRun();
  else if (S.tab === 'recs') h += viewRecs();
  else if (S.tab === 'notice') h += viewNoticeAdmin();
  else if (S.tab === 'members') h += viewMembers();
  else if (S.tab === 'home') h += viewManage();
  else if (S.tab === 'draft' && S.dm && cur() && myTeam(cur()) && cur().draftStatus !== 'done') h += `<div class="dmroot">${vDraft(cur())}</div>`;
  else if (S.tab === 'draft') h += withSession(s => myTeam(s) ? (s.draftStatus === 'done' ? vTrade(s) : vDraft(s)) : vMemberNotice(s));
  else if (S.tab === 'mhome') h += S.sub === 'applist' && cur() ? viewApplicants() : viewMHome();
  else if (S.tab === 'sched') h += viewSchedule();
  else if (S.tab === 'results') h += viewResults();
  else if (S.tab === 'mstats') h += viewMStats();
  else if (S.tab === 'stats') h += viewStats(); else h += viewSettings();
  h += '</div>' + tabs();
  if (S.openMatch && S.matches[S.openMatch]) h += viewMatch();
  if (S.sheet) h += viewSheet();
  document.getElementById('app').innerHTML = h;
  const nb = document.querySelector('.msgs'); if (nb && atBottom) nb.scrollTop = nb.scrollHeight;
  if (ov) document.querySelector('.overlay')?.scrollTo(0, ov);
  if (ciState) { const n = document.getElementById('chatin'); if (n) { n.value = ciState.v; if (ciState.f) { n.focus({ preventScroll: true }); try { n.setSelectionRange(ciState.a, ciState.b) } catch { } } } }
  scheduleBubbles();
  saveNav();
  const dmOn = !!document.querySelector('.dmroot'); document.body.classList.toggle('dm-on', dmOn);
  if (dmOn) { const ab = document.querySelector('.appbar'); if (ab) document.documentElement.style.setProperty('--abh', ab.offsetHeight + 'px') }
  tick();
}
function appbar() {
  const s = S.sid ? S.sessions[S.sid] : null; const back = false;
  return `<header class="appbar"><div class="in">${back ? '<button class="back" data-act="home" aria-label="경기일 목록">‹</button>' : `<img src="${EMBLEM_SRC}" alt="">`}
  <div class="ttl"><b>${esc(CFG.club?.name || 'WEEKDAYS FUTSAL CLUB')}</b><span>${s && S.admin && (S.tab === 'run' || S.tab === 'notice') ? `${fmtDate(s.date)} ${esc(s.time || '')} ${esc(s.venue || '')}` : ''}</span></div>
  <button class="gear" data-act="tab" data-v="settings" aria-label="설정">⚙</button><button class="opbtn ${S.admin ? 'on' : ''}" data-act="opmode">${S.admin ? '운영 중' : '운영모드'}</button></div></header>`;
}
function tabs() {
  const t = S.admin ? [['manage', '경기관리'], ['run', '경기진행'], ['recs', '기록관리'], ['notice', '공지관리'], ['members', '회원관리']] : [...(myTeam(cur()) ? [['draft', '드래프트']] : []), ['mhome', '홈'], ['sched', '일정'], ['results', '결과'], ['mstats', '기록']];
  return `<div class="tabs"><nav style="grid-template-columns:repeat(${t.length},1fr)">${t.map(([k, n]) => `<button data-act="tab" data-v="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${n}</button>`).join('')}</nav></div>` }
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
    <div class="field"><label for="f-venue">장소</label><input id="f-venue" class="inp" type="text" value="${esc(s.venue)}" data-in="sfield" data-f="venue" ${ad ? '' : 'disabled'}></div>
    <div class="field"><label for="f-cap">신청 인원 (정원)</label><input id="f-cap" class="inp" type="number" min="3" max="60" value="${s.capacity || ''}" data-in="sfield2" data-f="capacity" ${ad ? '' : 'disabled'}></div>
    <div class="field"><label for="f-open">신청 오픈</label><input id="f-open" class="inp" type="datetime-local" value="${esc(s.applyOpen || '')}" data-in="sfield2" data-f="applyOpen" ${ad ? '' : 'disabled'}></div>
    <div class="field"><label for="f-close">신청 마감</label><input id="f-close" class="inp" type="datetime-local" value="${esc(s.applyClose || '')}" data-in="sfield2" data-f="applyClose" ${ad ? '' : 'disabled'}></div></div>`;
  const ast = sStatus(s); h += `<h2>신청자<small>${ids.length}${s.capacity ? ' / ' + s.capacity : ''}명</small><span class="st st-${ast.k}">${ast.label}</span></h2>
  <p class="note" style="margin:-4px 2px 10px">${ast.k === 'open' ? `회원들이 앱에서 직접 신청하는 중이에요. ${s.applyClose ? fmtDT(s.applyClose) + '에 자동 마감돼요.' : ''}` : ast.k === 'soon' ? `${fmtDT(s.applyOpen)}에 앱 신청이 열려요.` : '앱 신청이 마감됐어요. 이 명단이 드래프트 선수 목록이 돼요.'} 카톡으로 받은 신청은 아래에서 직접 추가해도 돼요.</p>`;
  if (ad) h += `<div class="panel"><div class="field"><label for="f-paste">카톡 투표 참여자 명단 붙여넣기</label><textarea id="f-paste" class="inp" data-in="pasteApply" placeholder="투표 참여자 이름을 복사해서 붙여넣으세요.&#10;줄바꿈, 쉼표, 띄어쓰기 모두 괜찮아요.">${esc(S.pasteApply)}</textarea></div>
    <div class="pad" style="padding-top:0"><button class="btn primary block" data-act="addapply">명단 추가</button></div></div><div style="height:10px"></div>`;
  h += `<div class="panel"><div class="chips">${ids.length ? ids.map(id => `<button class="chip ${ad ? 'x' : ''}" data-act="rmapply" data-id="${id}" ${ad ? '' : 'disabled'} aria-label="${esc(pname(id))}${ad ? ' 삭제' : ''}">${esc(pname(id))}</button>`).join('') : '<span class="muted">아직 신청자가 없어요.</span>'}</div>
    ${ad ? `<div class="pad" style="padding-top:0;display:flex;gap:8px"><input class="inp" type="text" placeholder="한 명씩 추가 (게스트는 이름(게))" data-in="addone" id="addone"><button class="btn" data-act="addone">추가</button></div>` : ''}</div>`;
  if ((s.waitlist || []).length) h += `<h2>대기<small>${s.waitlist.length}명, 신청자가 취소하면 자동으로 올라가요</small></h2><div class="panel"><div class="chips">${s.waitlist.map(id => `<button class="chip ${ad ? 'x' : ''}" data-act="rmwait" data-id="${id}" ${ad ? '' : 'disabled'}>${esc(pname(id))}</button>`).join('')}</div>${ad ? `<div class="pad" style="padding-top:0"><button class="btn sm" data-act="promote">대기 1번을 신청자로 올리기</button></div>` : ''}</div>`;
  if (ad && ast.k === 'open') h += `<div class="row" style="margin-top:10px"><button class="btn" data-act="closenow">지금 신청 마감하기</button></div>`;
  if (ids.length % 3 && ids.length) h += `<p class="note">${ids.length}명은 3팀으로 딱 나눠지지 않아요. 한 팀이 ${Math.ceil(ids.length / 3)}명이 돼요.</p>`;
  if (ad) h += `<div style="height:14px"></div><button class="btn primary block" data-act="gostage" data-v="captain" ${ids.length < 3 ? 'disabled' : ''}>다음: 주장 정하기</button>`;
  return h;
}
function vCaptain(s) {
  const ad = S.admin && s.draftStatus === 'ready' && !s.ladder;
  let h = `<h2>주장 3명<small>신청자 중에서 골라요</small></h2><div class="panel">${KEYS.map((k, i) => { const c = s.captains?.[k];
    return `<button class="slot" data-act="capslot" data-k="${k}" ${ad ? '' : 'disabled'}><span class="teamtag" style="background:${NEUTRAL[k]};color:#fff">${k}팀</span><span class="who ${c ? '' : 'empty'}">${c ? '👑 ' + esc(pname(c)) : '눌러서 주장 선택'}</span>${ad ? '<span class="muted">변경</span>' : ''}</button>` }).join('')}</div>`;
  if (S.admin) h += capLinksPanel(s);
  h += `<p class="note">드래프트 방에서 주장들이 입장하면 ① 팀 색 선택 → ② 사다리 타기로 순번 선정 → ③ 팀원 선택 순서로 진행해요. 색이 정해지기 전까지 팀 이름은 A팀, B팀, C팀이에요.</p>`;
  if (S.admin && s.draftStatus === 'ready') h += `<div style="height:12px"></div><button class="btn primary block" data-act="openroom" ${KEYS.some(k => !s.captains?.[k]) ? 'disabled' : ''}>드래프트 방 열기</button>`;
  return h;
}
function capLinksPanel(s) {
  if (s.draftStatus === 'done') return '';
  return `<h2>주장 링크<small>주장에게 보내면 그 이름으로 드래프트에 참여해요</small></h2><div class="panel">${KEYS.map(k => { const c = s.captains?.[k];
    return `<div class="slot">${tag(team(s, k))}<span class="who ${c ? '' : 'empty'}">${c ? esc(pname(c)) : '주장 미지정'}</span>${c ? `<button class="btn sm" data-act="caplink" data-k="${k}" data-how="share">보내기</button><button class="btn sm" data-act="caplink" data-k="${k}" data-how="copy">복사</button>` : ''}</div>` }).join('')}</div>
  <p class="note">주장을 바꾸면 이전 링크는 더 이상 쓸 수 없어요.</p>`;
}
function snakePreview(s, from, n) { const out = []; const tot = draftTotal(s); for (let i = from; i < Math.min(tot, from + n); i++) out.push(pickTeamAt(s, i)); return out }
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
  const ps = teamPlayers(s, k).slice(1);
  return `<div class="seat ${t.picked ? 'picked' : ''} ${turn || cturn ? 'onturn' : ''} ${me ? 'me' : ''}" style="--tc:${t.color};--ti:${inkOn(t.color)}">
    ${bubbleFor(m => m.team === k)}${turn ? '<span class="turnb">차례</span>' : ''}<div class="sv"><span class="av ${inRoom ? 'on' : ''} ${(pname(cap) || '').length > 3 ? 'long' : ''}">${esc(pname(cap) || '?')}</span>${orderDecided(s) && o >= 0 && ph !== 'ladder' && ph !== 'cards' ? `<em class="ord">${o + 1}</em>` : ''}</div>
    <div class="st2">${me ? '<span class="meb">나</span>' : ''}<span class="tok">${esc(t.name)}</span>${ps.length ? `<small class="cnt">+${ps.length}</small>` : `<small>${inRoom ? '입장' : '대기'}</small>`}</div>
    ${ps.length ? `<ol class="hand">${ps.map(id => `<li>${esc(pname(id))}</li>`).join('')}</ol>` : ''}
    ${me && !inRoom && ph !== 'done' ? `<button class="btn sm primary" data-act="joinroom" data-k="${k}">입장하기</button>` : ''}</div>`;
}
const BUBBLE_MS = 9000;
function bubbleFor(pred) { const now = Date.now(); for (let i = S.chat.length - 1; i >= 0; i--) { const m = S.chat[i]; if (now - (m.at || 0) > BUBBLE_MS) break; if (m.uid !== 'sys' && pred(m)) return `<div class="bubble" role="status">${esc(m.text)}</div>` } return '' }
function scheduleBubbles() { if (S.bubT) return; const now = Date.now(); const live = S.chat.filter(m => m.uid !== 'sys' && (m.team || m.admin) && now - (m.at || 0) < BUBBLE_MS); if (!live.length) return;
  const next = Math.min(...live.map(m => m.at + BUBBLE_MS - now)) + 50; S.bubT = setTimeout(() => { S.bubT = null; render() }, Math.max(100, next)) }
function recolorBtns(s, my) {
  if (orderDecided(s) || s.cardgame) return '';
  if (S.admin) { const ks = KEYS.filter(k => team(s, k).picked); return ks.length ? `<div class="admsel"><small>색 다시 고르기</small>${ks.map(k => `<button class="btn sm" data-act="recolor" data-k="${k}">${esc(team(s, k).name)} 해제</button>`).join('')}</div>` : '' }
  return my && team(s, my).picked ? `<button class="btn sm" data-act="recolor" data-k="${my}">↺ 우리 팀 색 다시 고르기</button>` : '';
}
function colorChooser(s) { const o = s.order || []; return o.find(k => !team(s, k).picked) || null }
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
        if (by) { const t = team(s, by); return `<div class="ocard up" style="--tc:${t.color};--ti:${inkOn(t.color)}"><em>${g.deck[i]}</em><small>${esc(t.name)}</small></div>` }
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
      <div class="card3 ${pd ? 'up' : ''}" style="--tc:${t.color};--ti:${inkOn(t.color)}"><i>${esc(t.name)}</i><span>${pd ? esc(pname(pd)) : '?'}</span></div>
      <p>${pd ? (S.admin ? '확인되면 다음 턴으로 넘겨 주세요.' : '운영진이 다음 턴으로 넘기면 확정돼요.') : my === k ? '위 명단에서 선수를 눌러 고르세요.' : '선수를 고르는 중…'}</p>
      ${S.admin ? `<div class="row" style="justify-content:center"><button class="btn primary" data-act="nextturn" ${pd ? '' : 'disabled'}>다음 턴 ▶</button>${i ? '<button class="btn sm" data-act="undo">↶ 되돌리기</button>' : ''}</div>` : ''}</div>` }
  return `<div class="fx"><b>드래프트 완료! 🎉</b><p>이제 팀 밸런스를 조정하는 단계예요.</p>${S.admin ? '<button class="btn primary" data-act="gostage" data-v="trade">밸런스 조정으로</button>' : ''}</div>`;
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
  const list = (s.applicants || []).filter(id => !caps.includes(id));
  const hint = ph === 'draft' ? (canPick ? '눌러서 선택' : '내 차례에만 선택할 수 있어요') : `${list.length}명`;
  h += (S.dm ? `<div class="dm-hd"><b>신청자 명단</b><small>${hint}</small><button class="btn sm" data-act="leaveroom">나가기</button></div>` : `<h2>신청자 명단<small>${hint}</small></h2>`) + `<div class="namegrid">${list.map(id => { const p = pk[id]; const pend = s.pending?.p === id;
    if (p) { const t = team(s, p.t); return `<button class="nb taken" style="background:${t.color};color:${inkOn(t.color)}" disabled><small>${p.n}</small>${esc(pname(id))}</button>` }
    const pt = pend ? team(s, s.pending.t) : null;
    return `<button class="nb ${pend ? 'pend' : ''}" ${pt ? `style="--tc:${pt.color};--ti:${inkOn(pt.color)}"` : ''} data-act="pick" data-id="${id}" ${canPick ? '' : 'disabled'}>${esc(pname(id))}</button>` }).join('')}</div>`;
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
function chatPanel(room) {
  const me = S.me; const mk = myTeam(cur());
  const ph = mk ? esc(pname(cur().captains[mk])) + ' 주장으로 보내기' : S.admin ? '운영진으로 보내기' : me ? esc(me) + '(으)로 보내기' : '메시지 (처음엔 이름을 물어봐요)';
  const form = cls => `<form data-form="chat" class="${cls}"><label class="sr" for="chatin">메시지</label><input id="chatin" class="inp" type="text" placeholder="${ph}" maxlength="300" autocomplete="off" enterkeyhint="send"><button class="btn primary" type="submit">보내기</button></form>`;
  if (room && S.dm) { const unread = Math.max(0, S.chat.length - (S.chatSeen?.[S.sid] ?? S.chat.length));
    return `<form data-form="chat" class="chatbar"><button type="button" class="btn logbtn" data-act="chatlog" aria-label="메시지 내역 보기">💬${unread ? `<em class="unread">${unread}</em>` : ''}</button><label class="sr" for="chatin">메시지</label><input id="chatin" class="inp" type="text" placeholder="${ph}" maxlength="300" autocomplete="off" enterkeyhint="send"><button class="btn primary" type="submit">보내기</button></form>` }
  const n = S.chat.filter(m => m.uid !== 'sys').length; const unread = Math.max(0, S.chat.length - (S.chatSeen?.[S.sid] ?? S.chat.length));
  return `<div class="row chatrow"><button class="btn" data-act="chatlog">💬 메시지 내역 보기 <span class="muted">(${n})</span>${unread ? `<em class="unread">${unread}</em>` : ''}</button>${room ? '<button class="btn" data-act="leaveroom">채팅 나가기</button>' : ''}</div>${form('chatbar')}<div class="chatbar-space"></div>`;
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
  if (ad) h += `<div style="height:14px"></div><button class="btn primary block" data-act="gostage" data-v="notice" ${allPicked(s) ? '' : 'disabled'}>팀 확정, 공지 이미지 만들기</button>`;
  h += chatPanel(!!(my || S.admin));
  return h;
}
function vNotice(s) {
  const ad = S.admin; const img = S.poster[S.sid];
  if (!allPicked(s)) return `<div class="notice warn">아직 팀 색을 고르지 않은 팀이 있어요. 밸런스 조정 화면에서 팀 색을 먼저 정해 주세요.</div>`;
  if (!img) queueMicrotask(refreshPoster);
  let h = `<div class="dgrid"><section><h2>공지 이미지</h2><img class="poster" alt="매치데이 공지 이미지 미리보기" src="${img || ''}" width="1086" height="1448">
  <div class="row" style="margin-top:10px"><button class="btn primary" data-act="share">카톡 등으로 공유</button><button class="btn" data-act="download">이미지 저장</button></div>
  <button class="btn block" style="margin-top:8px" data-act="copytext">공지 텍스트 복사</button>`;
  h += '</section><section>';
  if (ad) h += `<h2>공지 내용</h2><div class="panel">
    <div class="field"><label for="f-ev">E/V 비밀번호</label><input id="f-ev" class="inp" type="text" value="${esc(s.evpw || '')}" data-in="sfield" data-f="evpw" ${ad ? '' : 'disabled'}></div>
    <div class="field"><label for="f-nt">NOTICE 문구</label><input id="f-nt" class="inp" type="text" value="${esc(s.notice || '')}" data-in="sfield" data-f="notice" ${ad ? '' : 'disabled'}><span class="note" style="margin:0">{ } 로 감싼 글자는 노란색으로 강조돼요.</span></div></div>`;
  if (ad) h += `<div style="height:14px"></div><button class="btn primary block" data-act="mkmatches">경기 일정 만들기 (9경기)</button>`;
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
  h += `<h2>오늘의 공격포인트</h2><div class="panel list2">${top.length ? top.map(([id, t]) => `<div><span>${esc(pname(id))}</span><span class="muted">${t.g}골 ${t.a}도움</span></div>`).join('') : '<p class="empty">아직 골이 없어요.</p>'}</div>`;
  h += `<h2>MOM<small>팀별 한 명, ${S.admin ? '운영진' : '각 팀 주장'}이 선택</small></h2><div class="panel">${KEYS.map(k => { const t = team(s, k); const pid = s.mom?.[k];
    return `<button class="momrow" data-act="mom" data-k="${k}" ${canMom(s, k) ? '' : 'disabled'}>${bib(t.color)}<span class="t">${esc(t.name)}${myTeam(s) === k ? ' (내 팀)' : ''}</span><span class="v ${pid ? 'set' : ''}">${pid ? '🏅 ' + esc(pname(pid)) : canMom(s, k) ? '선택하기' : '미정'}</span></button>` }).join('')}</div>`;
  if (S.admin) { const st = (key, lab, val, unit) => `<div class="stepper"><button data-act="tstep" data-key="${key}" data-d="-1" aria-label="${lab} 줄이기">−</button><span><small>${lab}</small>${val}${unit}</span><button data-act="tstep" data-key="${key}" data-d="1" aria-label="${lab} 늘리기">+</button></div>`;
    sch += `<h2>경기 시간 설정</h2><div class="grid2">${st('h1', '전반', T.h1 / 60, '분')}${st('gk', 'GK 교체', T.gk, '초')}${st('h2', '후반', T.h2 / 60, '분')}${st('rest', '쉬는 시간', T.rest / 60, '분')}</div>
    <h2>관리</h2><button class="btn danger block" data-act="delsession">이 경기일 전체 삭제</button>` }
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
    return `<div class="ev"><span class="min">${second ? '후' : '전'} ${Math.max(1, mn)}'</span>${bib(t.color)}<span class="who">${e.og ? '상대 자책골' : esc(pname(e.scorer))}${e.assist ? `<small>도움 ${esc(pname(e.assist))}</small>` : ''}</span>${can ? `<button class="x" data-act="delev" data-id="${e.id}" aria-label="골 기록 삭제">×</button>` : ''}</div>` }).join('') : '<p class="empty">골이 나면 위의 팀 버튼을 누르세요.</p>'}</div></section></div></div></div>`;
  return h;
}
function viewSheet() {
  const sh = S.sheet; let h = `<div class="scrim" data-act="closesheet"><div class="sheet" role="dialog" aria-modal="true" data-stop><div class="grab"></div>`;
  if (sh.type === 'colorpick') { const s = cur(); const cur0 = s.teams?.[sh.k]?.colorName;
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
  else if (sh.type === 'mbulk') h += `<h4>명단 붙여넣기</h4><p>한 줄에 한 명씩 "이름 연락처" 형식으로 붙여넣으세요. 연락처는 없어도 되고, 게스트는 이름 뒤에 (게)를 붙이면 돼요. 이미 있는 이름은 연락처만 채워져요.</p>
    <textarea id="mb-txt" class="inp" style="min-height:180px" placeholder="김민혁 010-1234-5678&#10;이도형 01023456789&#10;배기문(게)"></textarea><div class="row" style="margin-top:12px"><button class="btn primary" data-act="mbulkgo">등록</button></div>`;
  else if (sh.type === 'newsession') h += `<h4>새 경기일</h4><p>날짜와 기본 정보를 정하세요. 나중에 바꿀 수 있어요.</p><form data-form="newsession"><div class="panel">
    <div class="field"><label for="n-date">날짜</label><input id="n-date" class="inp" type="date" name="date" value="${today()}" required></div>
    <div class="field"><label for="n-time">시간</label><input id="n-time" class="inp" type="time" name="time" value="${esc(DEFAULTS.time)}"></div>
    <div class="field"><label for="n-venue">장소</label><input id="n-venue" class="inp" type="text" name="venue" value="${esc(DEFAULTS.venue)}"></div>
    <div class="field"><label for="n-cap">신청 인원 (정원)</label><input id="n-cap" class="inp" type="number" name="capacity" min="3" max="60" value="${DEFAULTS.capacity || 18}"></div>
    <div class="field"><label for="n-open">신청 오픈</label><input id="n-open" class="inp" type="datetime-local" name="applyOpen" value="${nowLocal()}"></div>
    <div class="field"><label for="n-close">신청 마감</label><input id="n-close" class="inp" type="datetime-local" name="applyClose" value=""><span class="note" style="margin:0">비워 두면 경기 전날 22:00로 정해져요.</span></div>
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

  return h;
}
function viewSettings() {
  return `<h2>내 정보</h2><div class="panel"><div class="field"><label for="me">이름 (채팅 표시, 내 기록 찾기에 쓰여요)</label><input id="me" class="inp" type="text" value="${esc(S.me)}" data-in="me" maxlength="12"></div>
  </div>
  <h2>휘슬</h2><div class="panel pad"><button class="btn block" data-act="whistle">${S.whistle ? '🔊 이 폰에서 휘슬 켜짐' : '🔇 이 폰에서 휘슬 꺼짐'}</button><p class="note">웹에서는 휘슬이 울리려면 경기 화면을 켜 두어야 해요.</p></div>
  ${S.admin ? `<h2>샘플 데이터</h2><div class="panel pad"><p class="muted" style="margin:0 0 10px">화면 확인용 가상 회원, 지난 경기 2개, 다음 경기 1개를 넣거나 지워요. 직접 입력한 데이터는 건드리지 않아요.</p><div class="row"><button class="btn" data-act="addsample">샘플 데이터 넣기</button><button class="btn danger" data-act="clearsample">샘플 데이터 모두 지우기</button></div></div>` : ''}
  <h2>주장 코드</h2><div class="panel pad"><p class="muted" style="margin:0 0 10px">운영진에게 받은 주장 코드를 넣으면 그 주장 이름으로 드래프트에 참여해요.</p><div style="display:flex;gap:8px"><input class="inp" type="text" id="capcode" maxlength="8" placeholder="예: K7Q2MX" autocapitalize="characters" style="text-transform:uppercase"><button class="btn primary" data-act="capcode">입력</button></div></div>`;
}
/* ───────── member views ───────── */
function dt(str) { return str ? new Date(str) : null }
function fmtDT(str) { const d = dt(str); if (!d || isNaN(d)) return '-'; return `${d.getMonth() + 1}.${d.getDate()} (${DOW[d.getDay()]}) ${p2(d.getHours())}:${p2(d.getMinutes())}` }
function dday(id) { const [y, m, d] = id.split('-'); const t = new Date(); const a = new Date(+y, +m - 1, +d), b = new Date(t.getFullYear(), t.getMonth(), t.getDate()); const n = Math.round((a - b) / 864e5); return n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : `D+${-n}` }
function sStatus(s) {
  const ms = sessMatches(s.date); const now = Date.now();
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
function pastSids() { return Object.keys(S.sessions).filter(id => sessMatches(id).some(m => m.status === 'done')).sort().reverse() }
function myPid() { return S.me ? findPlayer(S.me) : null }
function myTeamIn(s) { const me = myPid(); return me ? KEYS.find(k => teamPlayers(s, k).includes(me)) || null : null }
function rankOf(rows, key, id) { const v = r => key === 'pts' ? r.g + r.a : r[key]; const mine = rows.find(r => r.id === id); if (!mine) return null; return 1 + rows.filter(r => v(r) > v(mine)).length }
function backbar(label) { return `<button class="backlink" data-act="sub" data-v="">‹ ${label}</button>` }

function viewMHome() {
  if (S.sub) { const s = cur(); if (!s) { S.sub = null } else {
    const body = S.sub === 'draft' ? (s.draftStatus === 'done' ? vTrade(s) : vDraft(s)) : S.sub === 'poster' ? vNotice(s) : vMatchDay(s);
    if (S.sub === 'draft' && S.dm && s.draftStatus !== 'done') return `<div class="dmroot">${backbar('홈으로')}${vDraft(s)}</div>`;
    return backbar('홈으로') + body } }
  const sid = nextSid(); let h = '';
  h += '<div class="dgrid"><section>';
  // ── MATCH REVIEW ──
  const last = pastSids().find(id => id !== sid);
  h += `<div class="sec-lab"><span>MATCH REVIEW</span>${last ? `<small>${fmtDate(last)}</small>` : ''}</div>`;
  if (!last) h += `<div class="review empty-r">아직 지난 경기가 없어요.</div>`;
  else { const s = S.sessions[last]; const rows = standings(last); const mt = myTeamIn(s); const top = rows[0]; const tt = team(s, top.k); const done = sessMatches(last).filter(m => m.status === 'done').length;
    const tally = {}; for (const e of Object.values(S.events)) if (e.session === last && !e.og && e.scorer) tally[e.scorer] = (tally[e.scorer] || 0) + 1;
    const best = Math.max(0, ...Object.values(tally)); const scorers = Object.keys(tally).filter(k => tally[k] === best && best > 0);
    const moms = KEYS.map(k => s.mom?.[k]).filter(Boolean);
    h += `<button class="review" data-act="result" data-id="${last}">
      <div class="rv-top" style="--tc:${tt.color};--ti:${inkOn(tt.color)}"><span class="rv-trophy">🏆</span><span><small>${done < 9 ? `${done}/9경기 기준 1위` : '우승'}</small><b>${esc(tt.name)}</b></span><span class="rv-pts">${top.pts}<small>점</small></span></div>
      <div class="rv-rows">${rows.map(r => { const t = team(s, r.k); return `<div class="rc-row ${mt === r.k ? 'mine' : ''}"><em class="rk rk${r.rank}">${r.rank}</em>${bib(t.color)}<b>${esc(t.name)}</b>${mt === r.k ? '<small class="metag">내 팀</small>' : ''}<span class="wdl"><i class="w">${r.w}승</i><i class="d">${r.d}무</i><i class="l">${r.l}패</i></span><span class="pt">${r.pts}점</span></div>` }).join('')}</div>
      ${scorers.length || moms.length ? `<div class="rv-meta">${scorers.length ? `<span><em>득점왕</em>${scorers.map(x => esc(pname(x))).join(', ')} ${best}골</span>` : ''}${moms.length ? `<span><em>MOM</em>${moms.map(x => esc(pname(x))).join(', ')}</span>` : ''}</div>` : ''}
      <span class="more">경기 결과 자세히 보기 ›</span></button>` }
  h += '</section><section>';
  // ── NEXT MATCH ──
  h += `<div class="sec-lab"><span>NEXT MATCH</span>${sid ? `<small>${fmtDate(sid)}</small>` : ''}</div>`;
  if (!sid) h += `<div class="hero"><div class="hero-empty">예정된 경기가 없어요</div><p>새 경기일이 열리면 여기에 보여요.</p></div>`;
  else { S.sid = sid; const s = S.sessions[sid]; const st = sStatus(s); const n = (s.applicants || []).length; const cap = s.capacity || 0; const [, m, d] = sid.split('-');
    h += `<div class="hero"><div class="hero-top"><span class="st st-${st.k}">${st.label}</span><span class="dday">${dday(sid)}</span></div>
      <div class="hero-date">${m}.${d}<small>${dow(sid)}요일</small></div><div class="hero-time">${esc(s.time || '')}</div>
      <div class="hero-venue">📍 ${esc(s.venue || '장소 미정')}</div>
      ${st.k === 'open' && s.applyClose ? `<div class="hero-status"><span>${fmtDT(s.applyClose)} 신청 마감</span></div>` : st.k === 'soon' && s.applyOpen ? `<div class="hero-status"><span>${fmtDT(s.applyOpen)} 신청 오픈</span></div>` : ''}
      <div class="cap"><div class="cap-row"><span>신청 인원</span><b>${n}<small> / ${cap || '-'}명</small></b></div>${cap ? `<div class="bar"><i style="width:${Math.min(100, n / cap * 100)}%"></i></div>` : ''}</div></div>`;
    h += homeAction(s, st);
  }
  return h + '</section></div>';
}
function homeAction(s, st) {
  const mt = myTeamIn(s);
  if (st.k === 'soon') return `<div class="act"><b>신청 오픈 전이에요</b><p>${fmtDT(s.applyOpen)}부터 앱에서 신청할 수 있어요.</p>${applyBox(s)}</div>`;
  if (st.k === 'open') { const left = (s.capacity || 0) - (s.applicants || []).length; return `<div class="act"><b>지금 신청 받는 중이에요</b><p>${[s.capacity ? (left > 0 ? `남은 자리 ${left}명` : `정원이 찼어요, 대기 ${(s.waitlist || []).length}명`) : '', s.applyClose ? `${fmtDT(s.applyClose)} 마감` : ''].filter(Boolean).join(', ')}</p>${applyBox(s)}${(s.applicants || []).length ? `<button class="btn sm" data-act="applist">신청자 보기</button>` : ''}</div>` }
  const capHint = KEYS.some(k => s.captains?.[k]) && !myTeam(s) ? `<button class="linkbtn" data-act="tab" data-v="settings">주장이신가요? 주장 코드 입력 ›</button>` : '';
  if (st.k === 'closed') return `<div class="act"><b>신청이 마감됐어요</b><p>신청자 ${(s.applicants || []).length}명으로 드래프트를 준비해요.</p>${applyBox(s)}${capsLine(s)}${capHint}<button class="btn sm" data-act="applist">신청자 보기</button></div>`;
  if (st.k === 'draft') { const live = s.draftStatus !== 'done'; return `<div class="act live"><b>${live ? `<span class="dot"></span> ${s.draftStatus === 'live' ? '지금 드래프트 중이에요' : '드래프트 방이 열렸어요'}` : '팀 밸런스를 맞추는 중이에요'}</b>${capsLine(s)}<button class="btn primary block" data-act="sub" data-v="draft">${live ? '드래프트 테이블 구경하기' : '팀 구성 보기'}</button>${live ? capHint : ''}</div>` }
  if (st.k === 'teams') return `<div class="act"><b>팀이 발표됐어요${mt ? `, 나는 ${esc(team(s, mt).name)}` : ''}</b>${rostersMini(s)}<button class="btn primary block" data-act="sub" data-v="poster">공지 이미지 보기</button></div>`;
  const live = sessMatches(s.date).filter(m => m.status === 'live');
  return `<div class="act live"><b><span class="dot"></span> 경기 진행 중</b>${live.map(m => { const [a, b] = score(m); return `<div class="lv">${bib(team(s, m.home).color)}${esc(team(s, m.home).name)} <b>${a} : ${b}</b> ${esc(team(s, m.away).name)}${bib(team(s, m.away).color)} <span data-clock="${m.id}"></span></div>` }).join('')}<button class="btn primary block" data-act="sub" data-v="match">경기 현황과 순위 보기</button></div>`;
}
function capsLine(s) { const ks = KEYS.filter(k => s.captains?.[k]); return ks.length ? `<div class="caps">${ks.map(k => `${tag(team(s, k))}<span>👑 ${esc(pname(s.captains[k]))}</span>`).join('')}</div>` : '' }
function rostersMini(s) { const me = myPid(); return `<div class="rosters">${KEYS.map(k => { const t = team(s, k); return `<div><div class="rh" style="background:${t.color};color:${inkOn(t.color)}">${esc(t.name)}</div><ul>${teamPlayers(s, k).map((id, i) => `<li class="${id === me ? 'me' : ''}">${i === 0 && captainOf(s, k) === id ? '👑' : ''}${esc(pname(id))}</li>`).join('')}</ul></div>` }).join('')}</div>` }

function viewSchedule() {
  const t = today(); const ids = Object.keys(S.sessions).filter(id => id >= t).sort();
  let h = `<h2>일정</h2>`;
  if (!ids.length) return h + `<div class="panel"><p class="empty">예정된 경기가 없어요.</p></div>`;
  h += '<div class="cards">';
  for (const id of ids) { const s = S.sessions[id]; const st = sStatus(s); const now = Date.now();
    const steps = [['신청 오픈', s.applyOpen, s.applyOpen && dt(s.applyOpen) <= now], ['신청 마감', s.applyClose, s.applyClose && dt(s.applyClose) <= now], ['팀 발표', null, stageIdx(s.stage) >= stageIdx('notice')], ['경기', `${id}T${s.time || '00:00'}`, st.k === 'live' || st.k === 'done']];
    const curI = steps.findIndex(x => !x[2]);
    h += `<div class="panel sched"><div class="sched-hd"><div><b>${fmtDate(id)} ${esc(s.time || '')}</b><span>📍 ${esc(s.venue || '')}</span></div><span class="dday sm">${dday(id)}</span></div>
      <ol class="tl">${steps.map(([l, v, done], i) => `<li class="${done ? 'done' : i === curI ? 'now' : ''}"><i></i><span>${l}</span><em>${v ? fmtDT(v) : done ? '완료' : i === 2 ? '신청 마감 후' : '-'}</em></li>`).join('')}</ol>
      <div class="sched-ft"><span class="st st-${st.k}">${st.label}</span><span>신청 ${(s.applicants || []).length}${s.capacity ? ' / ' + s.capacity : ''}명${(s.waitlist || []).length ? `, 대기 ${s.waitlist.length}` : ''}</span></div>${st.k === 'open' || applyState(s)?.k === 'in' ? `<div style="margin-top:10px">${applyBox(s, true)}</div>` : ''}</div>` }
  return h + '</div>';
}
function viewResults() {
  if (S.detail && S.sessions[S.detail]) { S.sid = S.detail; const s = S.sessions[S.detail];
    return backbar('결과 목록') + `<h2>${fmtDate(S.detail)}<small>${esc(s.venue || '')}</small></h2>` + vMatchDay(s) + `<h2>팀 명단</h2>` + rostersMini(s) }
  const ids = pastSids(); let h = `<h2>이전 경기 결과</h2>`;
  if (!ids.length) return h + `<div class="panel"><p class="empty">아직 끝난 경기가 없어요.</p></div>`;
  h += '<div class="cards">';
  for (const id of ids) { const s = S.sessions[id]; const rows = standings(id); const mt = myTeamIn(s); const done = sessMatches(id).filter(m => m.status === 'done').length;
    h += `<button class="panel rescard" data-act="result" data-id="${id}"><div class="rc-hd"><b>${fmtDate(id)}</b><span>${done < 9 ? `${done}/9경기` : '최종'}</span></div>
      ${rows.map(r => { const t = team(s, r.k); return `<div class="rc-row ${mt === r.k ? 'mine' : ''}"><em class="rk rk${r.rank}">${r.rank}</em>${bib(t.color)}<b>${esc(t.name)}</b>${mt === r.k ? '<small class="metag">내 팀</small>' : ''}<span class="wdl"><i class="w">${r.w}승</i><i class="d">${r.d}무</i><i class="l">${r.l}패</i></span><span class="pt">${r.pts}점</span></div>` }).join('')}</button>` }
  return h + '</div>';
}
const RANKS = [['g', '득점'], ['a', '도움'], ['pts', '공격포인트'], ['days', '참가'], ['mom', 'MOM'], ['wr', '승률']];
function viewMStats() {
  const rows = playerStats(); const me = myPid(); const r = rows.find(x => x.id === me); const key = S.rankKey || 'g';
  let h = '';
  if (!S.me) h += `<div class="panel pad namebox"><b>내 기록을 보려면 이름을 알려 주세요</b><p class="muted">팀 명단에 적히는 이름 그대로 적어 주세요.</p><div style="display:flex;gap:8px"><input class="inp" type="text" id="nm" maxlength="12" placeholder="이름"><button class="btn primary" data-act="setname">확인</button></div></div>`;
  else if (!r) h += `<div class="notice">${esc(S.me)} 님의 경기 기록이 아직 없어요. 이름이 팀 명단과 다르면 설정에서 바꿔 주세요.</div>`;
  else { const wr = r.gp ? Math.round(r.w / r.gp * 100) : null;
    h += `<div class="me-hero"><div class="me-name">${esc(pname(me))}</div><div class="me-grid">
      ${[['참가', r.days, '회', rankOf(rows, 'days', me)], ['경기', r.gp, '경기', null], ['득점', r.g, '골', rankOf(rows, 'g', me)], ['도움', r.a, '개', rankOf(rows, 'a', me)], ['MOM', r.mom, '회', r.mom ? rankOf(rows, 'mom', me) : null], ['승률', wr ?? '-', wr === null ? '' : '%', null]].map(([l, v, u, rk]) => `<div><span>${l}</span><b>${v}<small>${u}</small></b>${rk ? `<em>${rk}위</em>` : ''}</div>`).join('')}</div>
      <div class="me-wdl">${r.w}승 ${r.d}무 ${r.l}패${r.wins ? `, 우승 ${r.wins}회` : ''}</div></div>` }
  h = '<div class="dgrid"><section>' + h + '</section><section>';
  h += `<h2>순위</h2><div class="seg" role="tablist">${RANKS.map(([k, n]) => `<button role="tab" data-act="rank" data-k="${k}" aria-selected="${key === k}">${n}</button>`).join('')}</div>`;
  const val = x => key === 'pts' ? x.g + x.a : key === 'wr' ? (x.gp >= 5 ? x.w / x.gp : -1) : x[key];
  const list = rows.filter(x => val(x) > 0).sort((a, b) => val(b) - val(a) || a.days - b.days);
  if (!list.length) return h + `<div class="panel"><p class="empty">아직 기록이 없어요.</p></div></section></div>`;
  let rank = 0; const shown = list.slice(0, 30);
  h += `<div class="panel lb">${shown.map((x, i) => { if (i === 0 || val(shown[i - 1]) !== val(x)) rank = i + 1; const v = key === 'wr' ? Math.round(val(x) * 100) + '%' : val(x) + (key === 'days' ? '회' : key === 'g' ? '골' : '');
    return `<div class="lb-row ${x.id === me ? 'me' : ''}"><em class="rk rk${rank}">${rank}</em><b>${esc(pname(x.id))}</b><small>${key === 'g' ? `${x.days}회 참가` : key === 'days' ? `${x.gp}경기` : key === 'wr' ? `${x.w}승 ${x.d}무 ${x.l}패` : `${x.g}골 ${x.a}도움`}</small><span>${v}</span></div>` }).join('')}</div>`;
  if (key === 'wr') h += `<p class="note">승률은 5경기 이상 뛴 선수만 표시해요.</p>`;
  if (me && r && !shown.find(x => x.id === me) && val(r) > 0) h += `<p class="note">내 순위: ${rankOf(list, key === 'wr' ? 'g' : key, me)}위</p>`;
  return h + '</section></div>';
}
function viewApplicants() { const s = cur(); const me = myPid(); const chip = (id, i) => `<span class="chip ${id === me ? 'sel' : ''}"><small class="muted">${i + 1}</small> ${esc(pname(id))}</span>`;
  return backbar('홈으로') + `<h2>신청자<small>${(s.applicants || []).length}${s.capacity ? ' / ' + s.capacity : ''}명</small></h2><div class="panel"><div class="chips">${(s.applicants || []).map(chip).join('') || '<span class="muted">아직 신청자가 없어요.</span>'}</div></div>
  ${(s.waitlist || []).length ? `<h2>대기<small>${s.waitlist.length}명</small></h2><div class="panel"><div class="chips">${s.waitlist.map(chip).join('')}</div></div>` : ''}` }

/* ───────── admin views ───────── */
async function deleteSessionBy(sid) { if (!confirm(fmtDate(sid) + ' 경기를 통째로 지울까요? 신청자, 경기 기록도 함께 지워지고 되돌릴 수 없어요.')) return;
  const ok = await w(async () => { for (const [eid, ev] of Object.entries(S.events)) if (ev.session === sid) await S.store.del('events/' + eid); for (const mm of sessMatches(sid)) await S.store.del(mp(mm.id)); await S.store.del(sp(sid)) }, '삭제했어요.');
  if (ok && S.sid === sid) S.sid = null; render() }
const RUN_STEPS = STAGES.filter(([k]) => k !== 'notice');
function shiftDate(sid, days, time) { const d = new Date(sid + 'T00:00'); d.setDate(d.getDate() - days); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${time || '12:00'}` }
function adminSid() { if (S.sid && S.sessions[S.sid]) return S.sid; return defaultSid() }
function viewManage() {
  const t = today(); const f = S.mfilter || 'up';
  let ids = Object.keys(S.sessions).sort(); if (f === 'up') ids = ids.filter(id => id >= t); else if (f === 'past') ids = ids.filter(id => id < t).reverse();
  const all = Object.keys(S.sessions); const up = all.filter(id => id >= t).length;
  let h = `<div class="mg-top"><h2 style="margin:0">경기 목록</h2><button class="btn primary sm" data-act="caladd">＋ 달력에서 경기 추가</button></div>
  <div class="seg" role="tablist" style="margin-top:12px">${[['up', `예정 ${up}`], ['past', `지난 ${all.length - up}`], ['all', `전체 ${all.length}`]].map(([k, n]) => `<button role="tab" data-act="mfilter" data-k="${k}" aria-selected="${f === k}">${n}</button>`).join('')}</div>`;
  if (!ids.length) return h + `<div class="panel"><p class="empty">${f === 'up' ? '예정된 경기가 없어요. 달력에서 경기를 추가해 보세요.' : '경기가 없어요.'}</p></div>`;
  h += `<div class="panel sheetwrap"><table class="grid"><thead><tr><th class="stick">날짜</th><th>시간</th><th>장소</th><th>정원</th><th>신청</th><th>신청 오픈</th><th>신청 마감</th><th>상태</th><th>관리</th></tr></thead><tbody>
  ${ids.map(id => { const s = S.sessions[id]; const st = sStatus(s); const movable = !sessMatches(id).length;
    return `<tr><td class="stick"><button class="cellbtn" data-act="calmove" data-id="${id}" ${movable ? '' : 'disabled'} title="${movable ? '눌러서 날짜 변경' : '경기 기록이 있어 날짜를 바꿀 수 없어요'}"><b>${id.slice(5).replace('-', '.')}</b> <span class="dw${dow(id) === '일' ? ' sun' : dow(id) === '토' ? ' sat' : ''}">${dow(id)}</span></button></td>
      <td><input class="cell" type="time" value="${esc(s.time || '')}" data-in="cell" data-sid="${id}" data-f="time"></td>
      <td><input class="cell w-venue" type="text" value="${esc(s.venue || '')}" data-in="cell" data-sid="${id}" data-f="venue"></td>
      <td><input class="cell w-num" type="number" min="3" max="60" value="${s.capacity || ''}" data-in="cell" data-sid="${id}" data-f="capacity"></td>
      <td class="num"><b>${(s.applicants || []).length}</b></td>
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
  <div class="field"><label>장소<input class="inp" type="text" value="${esc(f.venue)}" data-in="calf" data-f="venue"></label></div>
  <div class="field"><span>신청 오픈</span><div class="offs">경기 <input class="inp w-num" type="number" min="0" max="30" value="${f.openD}" data-in="calf" data-f="openD">일 전 <input class="inp" type="time" value="${esc(f.openT)}" data-in="calf" data-f="openT"></div></div>
  <div class="field"><span>신청 마감</span><div class="offs">경기 <input class="inp w-num" type="number" min="0" max="30" value="${f.closeD}" data-in="calf" data-f="closeD">일 전 <input class="inp" type="time" value="${esc(f.closeT)}" data-in="calf" data-f="closeT"></div></div></div>
  ${c.sel.length ? `<p class="note">${c.sel.slice().sort().map(id => fmtDate(id)).join(', ')}</p>` : ''}
  <div class="row" style="margin-top:12px"><button class="btn primary" data-act="caladdgo" ${c.sel.length ? '' : 'disabled'}>${c.sel.length ? `${c.sel.length}개 경기 추가` : '날짜를 고르세요'}</button></div>`;
}
async function addSessions() {
  const c = S.cal; const f = c.f; let n = 0;
  const ok = await w(async () => { for (const sid of c.sel.slice().sort()) { if (S.sessions[sid]) continue;
    await S.store.set(sp(sid), { date: sid, time: f.time || DEFAULTS.time, venue: f.venue || DEFAULTS.venue, evpw: '', notice: DEFAULTS.notice || '', capacity: +f.capacity || 18,
      applyOpen: shiftDate(sid, +f.openD || 0, f.openT), applyClose: shiftDate(sid, +f.closeD || 0, f.closeT),
      stage: 'apply', applicants: [], captains: { A: null, B: null, C: null }, captainTokens: { A: null, B: null, C: null }, order: [...KEYS], picks: [], draftStatus: 'ready',
      teams: { A: { players: [] }, B: { players: [] }, C: { players: [] } }, timing: DEF_TIMING, mom: {}, createdAt: Date.now() }); n++ } });
  if (ok) { S.sheet = null; S.cal = null; toast(`${n}개 경기를 추가했어요.`); render() }
}
async function moveSession() {
  const c = S.cal; const from = c.from, to = c.sel[0]; if (!to || S.sessions[to]) return; const s = S.sessions[from];
  const ok = await w(async () => { const d = JSON.parse(JSON.stringify(s)); d.date = to;
    if (s.applyOpen) { const diff = (new Date(to) - new Date(from)) / 864e5; const mv = x => { const t = new Date(x); t.setDate(t.getDate() + diff); return `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}T${p2(t.getHours())}:${p2(t.getMinutes())}` }; d.applyOpen = mv(s.applyOpen); if (s.applyClose) d.applyClose = mv(s.applyClose) }
    await S.store.set(sp(to), d); await S.store.del(sp(from)) });
  if (ok) { if (S.sid === from) S.sid = to; S.sheet = null; S.cal = null; toast(`${fmtDate(to)}로 옮겼어요.`); render() }
}
function viewRun() {
  const sid = adminSid(); if (!sid) return `<div class="panel" style="margin-top:14px"><p class="empty">경기가 없어요. 경기관리에서 먼저 추가하세요.</p></div>`;
  S.sid = sid; const s = S.sessions[sid]; let step = S.step || s.stage; if (step === 'notice') step = 'trade'; const si = stageIdx(s.stage);
  if (step === 'draft' && S.dm) return `<div class="dmroot"><nav class="steps dmsteps" aria-label="진행 단계">${RUN_STEPS.map(([k, n], i) => `<button data-act="step" data-v="${k}" class="${stageIdx(k) < si ? 'done' : ''}" ${k === step ? 'aria-current="step"' : ''}>${i + 1} ${n}</button>`).join('')}</nav>${vDraft(s)}</div>`;
  let h = sessionPicker() + `<nav class="steps" aria-label="진행 단계">${RUN_STEPS.map(([k, n], i) => `<button data-act="step" data-v="${k}" class="${stageIdx(k) < si ? 'done' : ''}" ${k === step ? 'aria-current="step"' : ''}><i>${i + 1}</i>${n}</button>`).join('')}</nav>`;
  h += ({ apply: vApply, captain: vCaptain, draft: vDraft, trade: vTrade, match: vMatchDay })[step](s);
  return h;
}
function recruitText(s) { return [`[${CFG.club?.short || 'WF'}] ${fmtDate(s.date)} ${s.time || ''} 경기 신청 받아요`, `장소: ${s.venue || '-'}`, `정원: ${s.capacity || '-'}명`, s.applyClose ? `마감: ${fmtDT(s.applyClose)}` : '', '카톡 투표로 참여해 주세요!'].filter(Boolean).join('\n') }
function viewNoticeAdmin() {
  const sid = adminSid(); if (!sid) return `<div class="panel" style="margin-top:14px"><p class="empty">경기가 없어요.</p></div>`; S.sid = sid; const s = S.sessions[sid];
  let h = sessionPicker() + `<h2>모집 공지<small>카톡 투표와 함께 올릴 글</small></h2><div class="panel pad"><pre class="pre">${esc(recruitText(s))}</pre><button class="btn block" data-act="copyrecruit">모집 공지 복사</button></div>`;
  h += s.draftStatus === 'done' ? vNotice(s) : `<h2>팀 공지</h2><div class="notice">드래프트가 끝나고 팀 색이 정해지면 매치데이 공지 이미지를 만들 수 있어요.</div>`;
  return h;
}
function viewRecs() {
  const ids = pastSids();
  let h = `<h2>경기 결과 수정<small>눌러서 골과 도움을 고칠 수 있어요</small></h2><div class="panel">${ids.length ? ids.map(id => { const s = S.sessions[id]; const top = standings(id)[0];
    return `<button class="card" data-act="gorun" data-id="${id}" data-step="match"><span><span class="d">${fmtDate(id)}</span><br><span class="s">${sessMatches(id).filter(m => m.status === 'done').length}/9경기, ${Object.values(S.events).filter(e => e.session === id).length}골</span></span><span class="r">${bib(team(s, top.k).color)} ${esc(team(s, top.k).name)} 1위</span></button>` }).join('') : '<p class="empty">아직 끝난 경기가 없어요.</p>'}</div>`;
  return h + viewStats();
}

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
    captainTokens: { A: null, B: null, C: null }, applyOpen: shiftDate(sid, 7, '12:00'), applyClose: shiftDate(sid, 1, '22:00'), createdAt: Date.now(), sample: true, ...extra });
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
function applyState(s) { const me = myPid(); if (!me) return null; if ((s.applicants || []).includes(me)) return { k: 'in', n: s.applicants.indexOf(me) + 1 }; if ((s.waitlist || []).includes(me)) return { k: 'wait', n: s.waitlist.indexOf(me) + 1 }; return { k: 'none' } }
function applyBox(s, compact) {
  const st = sStatus(s); const a = applyState(s); const n = (s.applicants || []).length, cap = s.capacity || 0, wl = (s.waitlist || []).length;
  if (st.k === 'soon') return `<button class="btn block" disabled>${fmtDT(s.applyOpen)}에 신청이 열려요</button>`;
  if (st.k === 'open') {
    if (a?.k === 'in') return `<div class="applied"><span>✓ 신청 완료<small>${a.n}번째로 신청했어요</small></span><button class="btn sm" data-act="applycancel" data-id="${s.date}">신청 취소</button></div>`;
    if (a?.k === 'wait') return `<div class="applied wait"><span>대기 ${a.n}번<small>자리가 나면 자동으로 신청돼요</small></span><button class="btn sm" data-act="applycancel" data-id="${s.date}">대기 취소</button></div>`;
    const full = cap && n >= cap; return `<button class="btn primary block applybtn" data-act="apply" data-id="${s.date}">${full ? `대기 신청하기 (대기 ${wl}명)` : '신청하기'}</button>${S.me && !compact ? `<p class="note" style="margin:0">${esc(S.me)} 이름으로 신청돼요. <button class="linkbtn" data-act="tab" data-v="settings">이름 바꾸기</button></p>` : ''}`;
  }
  if (a?.k === 'in') return `<div class="applied"><span>✓ 신청 완료<small>${st.k === 'closed' ? '드래프트로 팀이 정해지면 알려 드려요' : '이번 경기 참가자예요'}</small></span></div>`;
  if (a?.k === 'wait') return `<div class="applied wait"><span>대기 ${a.n}번<small>신청이 마감됐어요</small></span></div>`;
  return '';
}
async function doApply(sid, cancel) {
  let pid = myPid();
  if (!pid) { const nm = (S.me || prompt('신청할 이름을 적어 주세요 (팀 명단에 쓰이는 이름)') || '').trim(); if (!nm) return; S.me = nm.slice(0, 12); save('me', S.me); pid = myPid();
    if (!pid) { if (!confirm(`처음 신청하시네요. "${S.me}" 이름으로 회원 등록 후 신청할까요?`)) return; pid = await S.store.add('players', { name: S.me, guest: false, status: 'active', createdAt: Date.now() }); S.players[pid] = { name: S.me } } }
  if (cancel && !confirm('신청을 취소할까요?')) return;
  let res = null;
  await w(() => S.store.txn(sp(sid), d => {
    if (!d) return null; const now = Date.now();
    if (d.draftStatus !== 'ready' || (d.applyClose && now >= new Date(d.applyClose).getTime())) { res = 'closed'; return null }
    if (!cancel && d.applyOpen && now < new Date(d.applyOpen).getTime()) { res = 'soon'; return null }
    const ap = d.applicants || [], wl = d.waitlist || [];
    if (cancel) { const was = ap.includes(pid); d.applicants = ap.filter(x => x !== pid); d.waitlist = wl.filter(x => x !== pid);
      if (was && d.waitlist.length && (!d.capacity || d.applicants.length < d.capacity)) d.applicants.push(d.waitlist.shift());
      KEYS.forEach(k => { if (d.captains?.[k] === pid) d.captains[k] = null }); res = 'cancel'; return d }
    if (ap.includes(pid) || wl.includes(pid)) { res = 'dup'; return null }
    if (d.capacity && ap.length >= d.capacity) { d.waitlist = [...wl, pid]; res = 'wait' } else { d.applicants = [...ap, pid]; res = 'ok' }
    return d }));
  toast({ ok: '신청했어요!', wait: '정원이 차서 대기로 신청했어요.', cancel: '취소했어요.', dup: '이미 신청했어요.', closed: '신청이 마감됐어요.', soon: '아직 신청 기간이 아니에요.' }[res] || '다시 시도해 주세요.');
}

/* ───────── members (admin) ───────── */
const MSTAT = { active: '정회원', guest: '게스트', dormant: '휴면' };
function mstatus(p) { return p.status || (p.guest ? 'guest' : 'active') }
function watchContacts() { if (!S.admin || S.unsubContacts || !S.store) return; S.unsubContacts = S.store.watchCol('contacts', docs => { const o = {}; docs.forEach(d => { const { id, ...r } = d; o[id] = r }); S.contacts = o; render() }) }
function memberRows() {
  const st = {}; for (const r of playerStats()) st[r.id] = r;
  const last = {}; for (const [sid, s] of Object.entries(S.sessions)) { if (!sessMatches(sid).some(m => m.status === 'done')) continue; for (const k of KEYS) for (const id of teamPlayers(s, k)) if (!last[id] || last[id] < sid) last[id] = sid }
  return Object.entries(S.players).map(([id, p]) => ({ id, name: p.name, status: mstatus(p), phone: S.contacts?.[id]?.phone || '', memo: S.contacts?.[id]?.memo || '', days: st[id]?.days || 0, g: st[id]?.g || 0, a: st[id]?.a || 0, last: last[id] || '', created: p.createdAt || 0 }));
}
function viewMembers() {
  const q = (S.mq || '').trim(); const f = S.mstat || 'all';
  const allRows = memberRows(); let rows = allRows; const cnt = k => allRows.filter(r => r.status === k).length;
  if (f !== 'all') rows = rows.filter(r => r.status === f);
  if (q) rows = rows.filter(r => r.name.includes(q) || r.phone.replace(/-/g, '').includes(q.replace(/-/g, '')) || r.memo.includes(q));
  const key = S.msort || 'name'; rows.sort((a, b) => key === 'name' ? a.name.localeCompare(b.name, 'ko') : key === 'days' ? b.days - a.days : key === 'last' ? (b.last || '').localeCompare(a.last || '') : b.created - a.created);
  let h = `<div class="mg-top"><h2 style="margin:0">회원 관리<small>${Object.keys(S.players).length}명</small></h2><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="mbulk">명단 붙여넣기</button><button class="btn sm" data-act="mcsv">CSV 저장</button><button class="btn primary sm" data-act="madd">＋ 회원 추가</button></div></div>
  <div class="mtools"><input class="inp" type="search" id="mq" placeholder="이름, 연락처, 메모 검색" value="${esc(q)}" data-in="mq">
  <div class="seg">${[['all', `전체 ${Object.keys(S.players).length}`], ['active', `정회원 ${cnt('active')}`], ['guest', `게스트 ${cnt('guest')}`], ['dormant', `휴면 ${cnt('dormant')}`]].map(([k, n]) => `<button role="tab" data-act="mstat" data-k="${k}" aria-selected="${f === k}">${n}</button>`).join('')}</div>
  <label class="msort">정렬 <select class="inp" data-in="msort">${[['name', '이름순'], ['days', '참가 많은 순'], ['last', '최근 참가순'], ['created', '최근 등록순']].map(([k, n]) => `<option value="${k}" ${key === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>`;
  if (!rows.length) return h + `<div class="panel"><p class="empty">${q ? '검색 결과가 없어요.' : '회원이 없어요. 회원 추가나 명단 붙여넣기로 등록하세요.'}</p></div>`;
  h += `<div class="panel sheetwrap"><table class="grid"><thead><tr><th class="stick">이름</th><th>구분</th><th>연락처</th><th>메모</th><th>참가</th><th>최근 참가</th><th>골</th><th>도움</th><th>관리</th></tr></thead><tbody>
  ${rows.map(r => `<tr><td class="stick"><input class="cell w-name" type="text" value="${esc(r.name)}" data-in="mcell" data-id="${r.id}" data-f="name"></td>
    <td><select class="cell w-st st-${r.status}" data-in="mcell" data-id="${r.id}" data-f="status">${Object.entries(MSTAT).map(([k, n]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
    <td><div class="telcell"><input class="cell w-tel" type="tel" value="${esc(r.phone)}" placeholder="010-0000-0000" data-in="mcell" data-id="${r.id}" data-f="phone">${r.phone ? `<a class="tel" href="tel:${esc(r.phone.replace(/[^0-9+]/g, ''))}" aria-label="${esc(r.name)}에게 전화">📞</a>` : ''}</div></td>
    <td><input class="cell w-memo" type="text" value="${esc(r.memo)}" placeholder="메모" data-in="mcell" data-id="${r.id}" data-f="memo"></td>
    <td class="num">${r.days}</td><td class="num">${r.last ? r.last.slice(5).replace('-', '.') : '-'}</td><td class="num">${r.g}</td><td class="num">${r.a}</td>
    <td class="acts"><button class="btn sm danger" data-act="mdel" data-id="${r.id}">삭제</button></td></tr>`).join('')}</tbody></table></div>
  <p class="note">칸을 눌러 바로 고치면 저장돼요. 휴면으로 바꿔도 지난 기록은 그대로 남아요. 연락처와 메모는 운영모드에서만 보여요.</p>`;
  return h;
}
function parseMemberLines(txt) {
  const out = []; for (const line of txt.split(/\r?\n/)) { const l = line.trim(); if (!l) continue; const ph = (l.match(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/) || [])[0] || '';
    const guest = /\(\s*게\s*\)/.test(l); const name = l.replace(ph, '').replace(/\(\s*게\s*\)/g, '').replace(/^\s*\d+[.)]\s*/, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/)[0] || '';
    if (name) out.push({ name: name.slice(0, 20), phone: ph.replace(/[\s.]/g, '-').replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3'), guest }) }
  return out;
}
async function saveMember(m) {
  let id = findPlayer(m.name);
  if (!id) id = await S.store.add('players', { name: m.name, guest: !!m.guest, status: m.guest ? 'guest' : 'active', createdAt: Date.now() });
  if (m.phone || m.memo) await S.store.set('contacts/' + id, { ...(S.contacts?.[id] || {}), ...(m.phone ? { phone: m.phone } : {}), ...(m.memo ? { memo: m.memo } : {}) });
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
document.addEventListener('keydown', e => { if (e.target.id !== 'chatin' || e.key !== 'Enter' || e.shiftKey) return; e.preventDefault();
  if (e.isComposing) { S.sendAfterCompose = true; return } sendChat() }, true);
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
  if (k === 'calf' && S.cal) { S.cal.f[el.dataset.f] = el.value; return }
  if (k === 'mq') { S.mq = el.value; clearTimeout(S.mqT); S.mqT = setTimeout(() => { const pos = el.selectionStart; S.pending = false; const a = document.activeElement; a && a.blur(); render(); const n = document.getElementById('mq'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos) } catch { } } }, 250); return }
  if (k === 'pasteApply') S.pasteApply = el.value;
  if (k === 'me') { S.me = el.value.trim(); save('me', S.me) }
  if (k === 'sfield' && S.admin) { const f = el.dataset.f; clearTimeout(saveT[f]); saveT[f] = setTimeout(async () => { await w(() => S.store.update(sp(S.sid), { [f]: el.value })); if (f === 'evpw' || f === 'notice') refreshPoster() }, 600) } });
document.addEventListener('change', e => { const el = e.target;
  if (el.dataset.in === 'msort') { S.msort = el.value; render(); return }
  if (el.dataset.in === 'mcell' && S.admin) { const id = el.dataset.id, f = el.dataset.f, v = el.value.trim();
    if (f === 'name') { if (!v) { render(); return } if (v !== S.players[id]?.name) { if (findPlayer(v)) { toast('같은 이름의 회원이 이미 있어요.'); render(); return } w(() => S.store.update('players/' + id, { name: v.slice(0, 20) }), '저장했어요.') } return }
    if (f === 'status') { w(() => S.store.update('players/' + id, { status: v, guest: v === 'guest' }), '저장했어요.'); return }
    const c = S.contacts?.[id] || {}; if ((c[f] || '') !== v) w(() => S.store.set('contacts/' + id, { ...c, [f]: v }), '저장했어요.'); return }
  if (el.dataset.in === 'cell' && S.admin) { const f = el.dataset.f, sid = el.dataset.sid; const v = f === 'capacity' ? (+el.value || 0) : el.value; if (S.sessions[sid]?.[f] !== v) w(() => S.store.update(sp(sid), { [f]: v }), '저장했어요.'); return } if (el.dataset.in === 'sfield2' && S.admin) { const f = el.dataset.f; w(() => S.store.update(sp(S.sid), { [f]: f === 'capacity' ? (+el.value || 0) : el.value })); return } if (el.dataset.in === 'sidpick') { S.sid = el.value; S.openMatch = null; render(); return } if (el.dataset.in === 'sfield' && el.type === 'time' && S.admin) w(() => S.store.update(sp(S.sid), { time: el.value })) });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'addone') { e.preventDefault(); document.querySelector('[data-act="addone"]').click() } if (e.key === 'Escape') { if (S.sheet) { S.sheet = null; render() } else if (S.openMatch) { S.openMatch = null; render() } } });
document.addEventListener('submit', async e => { e.preventDefault(); const f = e.target;
  if (f.dataset.form === 'newsession') { const d = Object.fromEntries(new FormData(f)); await createSession(d) }
  if (f.dataset.form === 'chat') await sendChat(); });

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.classList.contains('scrim') && e.target.closest('[data-stop]')) return;
  if (el.disabled) return; const act = el.dataset.act, id = el.dataset.id; const s = cur(); const m = S.openMatch ? M(S.openMatch) : null;
  switch (act) {
    case 'tab': S.tab = el.dataset.v; S.openMatch = null; S.sheet = null; S.sel = null; S.sub = null; S.detail = null; render(); window.scrollTo(0, 0); break;
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
    case 'pick': await setPending(id); break;
    case 'undo': S.sheet = null; if (confirm('마지막 지명을 되돌릴까요?')) await undoPick(); else render(); break;
    case 'noop': break;
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
    case 'openroom': if (!needAdmin()) break; await openRoom(); break;
    case 'joinroom': await joinRoom(el.dataset.k); break;
    case 'leaveroom': if (confirm('드래프트 채팅방에서 나갈까요?')) await leaveRoom(); break;
    case 'ladder': if (!needAdmin()) break; await runLadder(); break;
    case 'relader': S.sheet = null; if (!needAdmin() || !confirm('사다리를 다시 탈까요?')) break; await runLadder(); break;
    case 'nextturn': if (!needAdmin()) break; await nextTurn(); break;
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
    case 'gonotice': S.sid = id; S.tab = 'notice'; render(); window.scrollTo(0, 0); break;
    case 'delrow': S.sid = id; await deleteSessionBy(id); break;
    case 'caladd': { const d = new Date(); S.cal = { mode: 'add', y: d.getFullYear(), m: d.getMonth(), sel: [], f: { time: DEFAULTS.time, venue: DEFAULTS.venue, capacity: DEFAULTS.capacity || 18, openD: 7, openT: '12:00', closeD: 1, closeT: '22:00' } }; S.sheet = { type: 'cal' }; render(); break }
    case 'calmove': { const [y, m] = id.split('-'); S.cal = { mode: 'move', from: id, y: +y, m: +m - 1, sel: [] }; S.sheet = { type: 'cal' }; render(); break }
    case 'calnav': { const c = S.cal; c.m += +el.dataset.d; if (c.m < 0) { c.m = 11; c.y-- } if (c.m > 11) { c.m = 0; c.y++ } render(); break }
    case 'calday': { const c = S.cal; if (c.mode === 'move') c.sel = [id]; else c.sel = c.sel.includes(id) ? c.sel.filter(x => x !== id) : [...c.sel, id]; render(); break }
    case 'caladdgo': await addSessions(); break;
    case 'calmovego': await moveSession(); break;
    case 'copyrecruit': { const t = recruitText(s); try { await navigator.clipboard.writeText(t); toast('모집 공지를 복사했어요.') } catch { prompt('아래 내용을 복사하세요', t.replace(/\n/g, ' / ')) } break }
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
    case 'goal': S.sheet = { type: 'goal', match: m.id, team: el.dataset.team, step: 'scorer' }; render(); break;
    case 'pickscorer': { const sh = S.sheet; if (id) { sh.scorer = id; sh.step = 'assist'; render(); break } S.sheet = null; render(); await addGoal(M(sh.match), sh.team, null, null, false); break }
    case 'pickog': { const sh = S.sheet; S.sheet = null; render(); await addGoal(M(sh.match), sh.team, null, null, true); break }
    case 'pickassist': { const sh = S.sheet; S.sheet = null; render(); await addGoal(M(sh.match), sh.team, sh.scorer, id || null, false); break }
    case 'delev': if (confirm('이 골 기록을 지울까요?')) await w(() => S.store.del('events/' + id)); break;
    case 'mom': if (!canMom(s, el.dataset.k)) break; S.sheet = { type: 'mom', k: el.dataset.k }; render(); break;
    case 'pickmom': { const k = S.sheet.k; S.sheet = null; render(); await w(() => S.store.update(sp(S.sid), { [`mom.${k}`]: id || null })); break }
    case 'tstep': { const k = el.dataset.key, d = +el.dataset.d; const T = { ...timing(s) }; if (k === 'gk') T.gk = Math.min(30, Math.max(0, T.gk + d)); else T[k] = Math.min(45 * 60, Math.max(k === 'rest' ? 0 : 60, T[k] + d * 60)); await w(() => S.store.update(sp(S.sid), { timing: T })); break }
    case 'delsession': await deleteSessionBy(S.sid); break;
    case 'delsession_old': if (!confirm(fmtDate(S.sid) + ' 경기일을 통째로 지울까요? 되돌릴 수 없어요.')) break;
      await w(async () => { for (const [eid, ev] of Object.entries(S.events)) if (ev.session === S.sid) await S.store.del('events/' + eid); for (const mm of sessMatches(S.sid)) await S.store.del(mp(mm.id)); await S.store.del(sp(S.sid)) }, '삭제했어요.'); S.sid = null; render(); break;
    case 'sort': S.statsSort = el.dataset.k; render(); break;
    case 'editp': { const p = S.players[id]; const nv = prompt('선수 이름 (게스트는 뒤에 (게))', pname(id)); if (nv === null || !nv.trim()) break; const guest = /\(\s*게\s*\)/.test(nv); const name = nv.replace(/\(\s*게\s*\)/g, '').trim().slice(0, 20); if (name !== p.name || guest !== !!p.guest) await w(() => S.store.update('players/' + id, { name, guest }), '수정했어요.'); break }
    case 'opmode': if (S.admin) { if (!confirm('운영모드를 끌까요?')) break; S.adminOn = false; save('admin', false); S.tab = 'mhome'; S.sid = null; S.step = null; S.openMatch = null; render(); window.scrollTo(0, 0); break }
      { const pin = prompt('운영진 비밀번호'); if (pin === null) break; if (pin !== String(CFG.adminPin ?? '0000')) { toast('비밀번호가 달라요.'); break }
        S.adminOn = true; save('admin', true); S.tab = 'manage'; S.sid = null; S.step = null; S.openMatch = null; toast('운영모드로 전환했어요.'); render(); window.scrollTo(0, 0) } break;
    case 'caplink': { const k = el.dataset.k; let t = s.captainTokens?.[k]; if (!t) { t = rand(); if (!await w(() => S.store.update(sp(S.sid), { [`captainTokens.${k}`]: t }))) break }
      const url = IS_ARTIFACT ? (window.WF_APP_URL || '') : capLink(S.sid, k, t); const msg = `[${CFG.club?.short || 'WF'}] ${fmtDate(S.sid)} 드래프트 ${team(s, k).name} 주장 ${pname(s.captains[k])}님\n앱 링크: ${url}\n주장 코드: ${t}\n${IS_ARTIFACT ? '앱을 열고 오른쪽 위 ⚙ 설정에서 \'주장 코드 입력\'을 눌러 주세요.' : '링크를 누르면 바로 드래프트에 참여해요.'}`;
      if (el.dataset.how === 'share' && navigator.share) { try { await navigator.share({ text: msg }); break } catch (e) { if (e.name === 'AbortError') break } }
      try { await navigator.clipboard.writeText(msg); toast(`${team(s, k).name} 주장 안내를 복사했어요.`) } catch { prompt('아래 내용을 복사해서 보내세요', msg.replace(/\n/g, ' / ')) } break }
    case 'whistle': S.whistle = !S.whistle; save('whistle', S.whistle); if (S.whistle) { audio(); whistle([.35]) } render(); break;
    case 'closesheet': S.sheet = null; render(); break;
  }
});

/* ───────── boot ───────── */
function watchChat() {
  if (S.chatSid === S.sid) return; S.unsubChat && S.unsubChat(); S.chat = []; S.chatSid = S.sid;
  if (!S.sid || !S.store) return; S.unsubChat = S.store.watchCol(sp(S.sid) + '/chat', docs => { S.chat = docs; render() }, { order: 'at', limit: 150 });
}
const ADMIN_TABS = ['manage', 'run', 'recs', 'notice', 'members', 'settings'], MEMBER_TABS = ['draft', 'mhome', 'sched', 'results', 'mstats', 'settings'];
function saveNav() { if (S.ready < 3) return; const n = { tab: S.tab, sid: S.sid, step: S.step, sub: S.sub, detail: S.detail, admin: S.admin };
  const k = JSON.stringify(n); if (k === S.lastNav) return; S.lastNav = k; try { sessionStorage.setItem('wf:nav', k) } catch { } save('nav', { ...n, at: Date.now() }) }
function restoreNav() {
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
(async function boot() {
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
  if (!S.store) { S.err = '데이터 서버에 연결하지 못했어요. ' + why; S.ready = 3; render(); return }
  const onErr = e => { const c = e?.code || ''; S.err = '데이터를 불러오지 못했어요. ' + (c === 'permission-denied' ? 'Firestore 규칙이 게시되지 않았거나 익명 로그인이 꺼져 있어요.' : c === 'not-found' || /does not exist/i.test(e?.message || '') ? 'Firestore Database가 아직 만들어지지 않았어요.' : `오류 코드: ${c || e?.message || '알 수 없음'}`); S.ready = 3; render() };
  let posterT; const sub = (p, key) => { let first = true; S.store.watchCol(p, docs => { const o = {}; docs.forEach(d => { const { id, ...rest } = d; o[id] = rest }); S[key] = o; if (first) { first = false; S.ready++; if (S.ready === 3) setTimeout(maybeSeed, 300) }
    if (key === 'sessions' && !S.resumed) { S.resumed = true; if (!S.pendingLink) { if (S.sid && !S.sessions[S.sid]) S.sid = null; if (S.tab !== 'draft' || !myTeam(S.sessions[S.sid])) resumeCaptain() } }
    if (key === 'sessions' && S.pendingLink) { const sid = S.pendingLink; S.pendingLink = null; S.sid = S.sessions[sid] ? sid : null; if (!S.sessions[sid] || !myTeam(S.sessions[sid])) { toast('만료되었거나 잘못된 주장 링크예요. 운영진에게 새 링크를 받아 주세요.'); S.tab = 'mhome' } else toast(`${team(S.sessions[sid], myTeam(S.sessions[sid])).name} 주장으로 드래프트에 참여해요.`) }
    if (key === 'sessions' && S.sid && (S.tab === 'notice' || S.sub === 'poster')) { clearTimeout(posterT); posterT = setTimeout(refreshPoster, 300) }
    render() }, null, onErr) };
  sub('players', 'players'); sub('sessions', 'sessions'); sub('matches', 'matches');
  S.store.watchCol('events', docs => { const o = {}; docs.forEach(d => { const { id, ...rest } = d; o[id] = rest }); S.events = o; render() }, null, onErr);
  if (!IS_ARTIFACT && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
})();
