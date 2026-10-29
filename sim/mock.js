(function(){
// 시뮬레이션 시간 이동: window.__simOff(ms)만큼 앱의 현재 시각을 옮겨요
{const _D=Date;window.__simOff=0;class SD extends _D{constructor(...a){if(a.length)super(...a);else super(_D.now()+window.__simOff)}static now(){return _D.now()+window.__simOff}};window.Date=SD}
const OPEN=/open/.test(location.search+location.pathname);if(OPEN){const r=new Date();const o=new Date(r);o.setHours(13,0,0,0);window.__simOff=o.getTime()-10000-r.getTime();window.__openAt=o.getTime()}
const DB={};const L=[];const now=Date.now();const p2=n=>String(n).padStart(2,'0');
const ds=d=>`${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
const names=['김민준','이서준','박도윤','최예준','정시우','강하준','조주원','윤지호','장지후','임준서','한건우','오현우','서우진','신선우','권연우','황유준','안정우','송승우','류지환','홍민재','문태윤','배성민','남기현','구도현','백승훈','엄재원'];
const players={};names.forEach((n,i)=>players['p'+i]={name:n,status:i<3?'staff':i<5?'special':i>17?'guest':'active',createdAt:now-1e9+i});
const put=(c,id,d)=>{(DB[c]??={})[id]=d};
Object.entries(players).forEach(([k,v])=>put('players',k,v));
put('auth','p1',{h:'mockh'});
const t=new Date();const nx=new Date(t);nx.setDate(t.getDate()+((4-t.getDay()+7)%7||7));const TODAY=/today/.test(location.search);if(TODAY)nx.setTime(t.getTime());const KO=new Date(Date.now()+40*60e3);const nxA=new Date(nx);nxA.setDate(nx.getDate()+7);const sid=ds(nxA);
const ap=Object.keys(players).filter(k=>k!=='p1').slice(0,13);const apps=ap.map((p,i)=>({k:'k'+i,pid:p,uid:'u'+i,at:now-86400e3+i*60e3}));
const op=new Date(t);op.setDate(t.getDate()-2);const cl=new Date(nxA);cl.setDate(nxA.getDate()-1);
put('sessions',sid,{date:sid,time:TODAY?p2(KO.getHours())+':'+p2(KO.getMinutes()):'21:00',end:'23:00',venue:'용산 아이파크몰 The Base 7구장',no:42,capacity:18,stage:'apply',applyOpen:ds(op)+'T12:00',applyClose:ds(cl)+'T20:00',apps,p0:['p0'],ops:[],park:{p2:{car:'12가3456',at:now}},dutyReq:{ball:{p3:now}},duty:{ball:[],drink:[]}});
for(let w=1;w<=6;w++){const d=new Date(nx);d.setDate(nx.getDate()-7*w-7);const id=ds(d);const pl=Object.keys(players).filter((_,j)=>(j+w)%4!==0).slice(0,15);
 const tm={A:{players:pl.filter((_,j)=>j%3==0),colorName:'BLUE'},B:{players:pl.filter((_,j)=>j%3==1),colorName:'RED'},C:{players:pl.filter((_,j)=>j%3==2),colorName:'YELLOW'}};
 put('sessions',id,{date:id,time:'21:00',venue:'용산 아이파크몰 The Base 7구장',no:42-w,stage:'match',draftStatus:'done',applicants:pl,captains:{A:tm.A.players[0],B:tm.B.players[0],C:tm.C.players[0]},teams:tm,mom:{A:tm.A.players[1]}});
 [['A','B'],['B','C'],['C','A'],['A','B'],['B','C'],['C','A'],['A','B'],['B','C'],['C','A']].forEach((pr,n)=>{put('matches',id+'_'+(n+1),{round:Math.floor(n/3)+1,slot:n%3+1,timer:{running:false,acc:744,startedAt:0},endedAt:1,session:id,n:n+1,home:pr[0],away:pr[1],status:'done'});
  for(let g=0;g<((n*7+w)%4);g++){const tk=g%2?pr[1]:pr[0];const ps=tm[tk].players;put('events',id+'_'+n+'_'+g,{session:id,match:id+'_'+(n+1),team:tk,scorer:ps[(g+n)%ps.length],assist:g%2?null:ps[(g+n+1)%ps.length],sec:60+g*150+n*7,at:now})}})}

// ── 2팀 시뮬레이션: 10/29(목) 21:00 140회 실제 신청 데이터 (확정 18명 · 구장 예약자 김동준) — 차량번호는 넣지 않았어요
{const RN=["윤창민", "강휘민", "한준호", "김민준", "이정욱", "조덕기", "강래형", "장태현", "이전배", "권순업", "백종성", "김환석", "이도형", "이영수", "김바우", "손효석", "김희태", "김동환"];const RI=RN.map((_,i)=>'r'+i);RN.forEach((n,i)=>put('players','r'+i,{name:n,status:'active',createdAt:now-9e8+i}));put('players','r18',{name:'김동준',status:'active',createdAt:now-9e8+18});
 const sd='2026-10-29';
 put('sessions',sd,{date:sd,time:'21:00',end:'23:00',venue:'용산 아이파크몰 The Base 3구장',no:140,capacity:18,stage:'captain',draftStatus:'ready',applyOpen:'2026-10-23T13:00',applyClose:'2026-10-27T20:00',
  applicants:RI,waitlist:[],apps:RI.map((p,i)=>({k:'r'+i,pid:p,uid:'ru'+i,at:now-4e8+i*60e3})),p0:['r18'],ops:['p1'],captains:{},captainTokens:{},order:['A','B'],picks:[],teams:{A:{players:[]},B:{players:[]}},duty:{ball:[],drink:[]},park:{r2:{car:'(차량 등록)',at:now},r10:{car:'(차량 등록)',at:now},r1:{car:'(차량 등록)',at:now},r3:{car:'(차량 등록)',at:now},r16:{car:'(차량 등록)',at:now}},nTeams:2,timing:{h1:300,gk:5,h2:300,rest:180}})}

// ── 4팀 · 구장 2면 시뮬레이션: 10/31(토) 19:00 · 신청 23명 · 구장마다 경기 운영자·예약자 1명
{const s4='2026-10-31';const ap4=['p1','p6',...Object.keys(players).filter(k=>k!=='p1'&&k!=='p6').slice(0,22)];const c4=new Date(Date.now()-3600e3);
 put('sessions',s4,{date:s4,time:'19:00',end:'22:00',venue:'용산 아이파크몰 The Base 7구장',venue2:'용산 아이파크몰 The Base 8구장',no:141,capacity:24,stage:'captain',draftStatus:'ready',applyOpen:'2026-10-26T12:00',applyClose:ds(c4)+'T'+p2(c4.getHours())+':00',
  applicants:ap4,waitlist:[],apps:ap4.map((p,i)=>({k:'f'+i,pid:p,uid:'fu'+i,at:now-86400e3+i*60e3})),p0:['p0','p7'],ops:['p1','p6'],captains:{},captainTokens:{},order:['A','B','C','D'],picks:[],teams:{A:{players:[]},B:{players:[]},C:{players:[]},D:{players:[]}},duty:{ball:[],drink:[]},nTeams:4,timing:{h1:300,gk:60,h2:300,rest:120}})}
if(OPEN){const ns=ds(nx);const cl2=new Date(nx);cl2.setDate(nx.getDate()-2);
 delete DB.sessions[sid];Object.keys(DB.sessions).filter(id=>id>ds(t)&&id!==ns).forEach(id=>delete DB.sessions[id]);
 const td=ds(t);const S0=DB.sessions[td];if(S0){const A=(S0.applicants||[]).slice();const h=Math.ceil(A.length/2);S0.stage='notice';S0.draftStatus='done';S0.room={open:true};S0.captains={A:A[0],B:A[h]};S0.order=['A','B'];S0.teams={A:{players:A.slice(0,h),colorName:'BLUE'},B:{players:A.slice(h),colorName:'BLACK'}};S0.duty={ball:[A[2]],drink:[A[3],A[h+2]]};S0.parkWin=[A[4],A[h+3]]}
 put('sessions',ns,{date:ns,time:'21:00',end:'23:00',venue:'용산 아이파크몰 The Base 3구장',no:141,capacity:18,stage:'apply',applyOpen:td+'T13:00',applyClose:ds(cl2)+'T20:00',apps:[],applicants:[],p0:[],ops:[],duty:{ball:[],drink:[]},dutyReq:{},park:{}});
 put('auth','p9',{h:'mockh'});
 // 13:00 이후 다른 회원들이 차례로 신청하는 장면
 const crowd=Object.keys(players).filter(k=>k!=='p9');for(let i=crowd.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[crowd[i],crowd[j]]=[crowd[j],crowd[i]]}
 const at=crowd.slice(0,22).map((pid,i)=>({pid,ms:i<8?120+i*90+Math.random()*120:i<16?1200+(i-8)*500+Math.random()*400:6000+(i-16)*2500+Math.random()*1500}));
 const tick=()=>{const nowT=Date.now()-window.__openAt;const s=DB.sessions[ns];let ch=false;for(const a of at){if(!a.done&&nowT>=a.ms){a.done=true;s.apps=[...(s.apps||[]),{k:'c'+a.pid,pid:a.pid,uid:'cu'+a.pid,at:window.__openAt+Math.round(a.ms)}];ch=true}}if(ch)notify('sessions');if(at.some(a=>!a.done))setTimeout(tick,60)};
 setTimeout(tick,200);

}
put('meta','config',{});
window.__docs=DB;window.__sid=sid;
const notify=c=>L.filter(l=>l.c===c).forEach(l=>l.fire());
const col=(c)=>{let ord=null,lim=0;const q={orderBy(f){ord=f;return q},limit(n){lim=n;return q},
 onSnapshot(cb){const l={c,fire:()=>{let docs=Object.entries(DB[c]||{}).map(([id,d])=>({id,data:()=>JSON.parse(JSON.stringify(d))}));cb({docs})}};L.push(l);setTimeout(l.fire,5);return()=>{L.splice(L.indexOf(l),1)}},
 async add(d){const id='x'+Math.random().toString(36).slice(2,9);put(c,id,d);setTimeout(()=>notify(c),1);return{id}}};return q};
const doc=p=>{const i=p.lastIndexOf('/');const c=p.slice(0,i),id=p.slice(i+1);return{
 async get(){const d=(DB[c]||{})[id];return{exists:!!d,data:()=>JSON.parse(JSON.stringify(d))}},
 async set(d){put(c,id,JSON.parse(JSON.stringify(d)));setTimeout(()=>notify(c),1)},
 async update(d){d=Object.fromEntries(Object.entries(d));for(const k of Object.keys(d)){if(k.includes('.')){const ks=k.split('.');let o=d;const v=d[k];delete d[k];for(let i=0;i<ks.length-1;i++){o=o[ks[i]]??={}}o[ks[ks.length-1]]=v}}const m=(DB[c]??={})[id]??={};const mg=(a,b)=>{for(const[k,v]of Object.entries(b)){if(v&&typeof v==='object'&&!Array.isArray(v)){a[k]=a[k]&&typeof a[k]==='object'?a[k]:{};mg(a[k],v)}else a[k]=v}};mg(m,JSON.parse(JSON.stringify(d)));setTimeout(()=>notify(c),1)},
 async delete(){delete (DB[c]||{})[id];setTimeout(()=>notify(c),1)},async acquire(){return{acquired:true}}}};
window.claude={use:async k=>k==='db'?{collection:col,doc}:null};
try{if(!/noauth/.test(location.search))localStorage.setItem('wfsim:auth',JSON.stringify({pid:OPEN?'p9':'p1',h:'mockh'}));sessionStorage.setItem('wfsim:booted','1')}catch(e){}
})();
