(function(){
const DB={};const L=[];const now=Date.now();const p2=n=>String(n).padStart(2,'0');
const ds=d=>`${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
const names=['김민준','이서준','박도윤','최예준','정시우','강하준','조주원','윤지호','장지후','임준서','한건우','오현우','서우진','신선우','권연우','황유준','안정우','송승우','류지환','홍민재','문태윤','배성민','남기현','구도현','백승훈','엄재원'];
const players={};names.forEach((n,i)=>players['p'+i]={name:n,status:i<3?'staff':i<5?'special':i>17?'guest':'active',createdAt:now-1e9+i});
const put=(c,id,d)=>{(DB[c]??={})[id]=d};
Object.entries(players).forEach(([k,v])=>put('players',k,v));
put('auth','p1',{h:'mockh'});
const t=new Date();const nx=new Date(t);nx.setDate(t.getDate()+((4-t.getDay()+7)%7||7));const TODAY=/today/.test(location.search);if(TODAY)nx.setTime(t.getTime());const KO=new Date(Date.now()+40*60e3);const sid=ds(nx);
const ap=Object.keys(players).filter(k=>k!=='p1').slice(0,13);const apps=ap.map((p,i)=>({k:'k'+i,pid:p,uid:'u'+i,at:now-86400e3+i*60e3}));
const op=new Date(t);op.setDate(t.getDate()-2);const cl=new Date(nx);cl.setDate(nx.getDate()-1);
put('sessions',sid,{date:sid,time:TODAY?p2(KO.getHours())+':'+p2(KO.getMinutes()):'21:00',end:'23:00',venue:'용산 아이파크몰 The Base 7구장',no:42,capacity:18,stage:'apply',applyOpen:ds(op)+'T12:00',applyClose:ds(cl)+'T20:00',apps,p0:['p0'],ops:[],park:{p2:{car:'12가3456',at:now}},dutyReq:{ball:{p3:now}},duty:{ball:[],drink:[]}});
for(let w=1;w<=6;w++){const d=new Date(nx);d.setDate(nx.getDate()-7*w-7);const id=ds(d);const pl=Object.keys(players).filter((_,j)=>(j+w)%4!==0).slice(0,15);
 const tm={A:{players:pl.filter((_,j)=>j%3==0),colorName:'BLUE'},B:{players:pl.filter((_,j)=>j%3==1),colorName:'RED'},C:{players:pl.filter((_,j)=>j%3==2),colorName:'YELLOW'}};
 put('sessions',id,{date:id,time:'21:00',venue:'용산 아이파크몰 The Base 7구장',no:42-w,stage:'match',draftStatus:'done',applicants:pl,captains:{A:tm.A.players[0],B:tm.B.players[0],C:tm.C.players[0]},teams:tm,mom:{A:tm.A.players[1]}});
 [['A','B'],['B','C'],['C','A'],['A','B'],['B','C'],['C','A'],['A','B'],['B','C'],['C','A']].forEach((pr,n)=>{put('matches',id+'_'+(n+1),{round:Math.floor(n/3)+1,slot:n%3+1,timer:{running:false,acc:744,startedAt:0},endedAt:1,session:id,n:n+1,home:pr[0],away:pr[1],status:'done'});
  for(let g=0;g<((n*7+w)%4);g++){const tk=g%2?pr[1]:pr[0];const ps=tm[tk].players;put('events',id+'_'+n+'_'+g,{session:id,match:id+'_'+(n+1),team:tk,scorer:ps[(g+n)%ps.length],assist:g%2?null:ps[(g+n+1)%ps.length],sec:60+g*150+n*7,at:now})}})}

// ── 2팀 시뮬레이션용 경기: 오늘, 40분 뒤 시작 · 신청 10명 · 도우미 지정 단계 · 경기 운영자 = 나(이서준)
{const k=new Date(Date.now()+40*60e3);const sd=ds(new Date());const ap2=['p0','p2','p3','p4','p5','p6','p7','p8','p9','p10'];
 const op2=new Date();op2.setDate(op2.getDate()-3);const cl2=new Date(Date.now()-3600e3);
 put('sessions',sd,{date:sd,time:p2(k.getHours())+':'+p2(k.getMinutes()),end:'23:00',venue:'용산 아이파크몰 The Base 7구장',no:43,capacity:18,stage:'captain',draftStatus:'ready',applyOpen:ds(op2)+'T12:00',applyClose:ds(cl2)+'T'+p2(cl2.getHours())+':00',
  applicants:ap2,waitlist:[],apps:ap2.map((p,i)=>({k:'s'+i,pid:p,uid:'su'+i,at:now-86400e3+i*60e3})),p0:['p0'],ops:['p1'],captains:{A:null,B:null,C:null},captainTokens:{A:null,B:null,C:null},order:['A','B','C'],picks:[],teams:{A:{players:[]},B:{players:[]},C:{players:[]}},duty:{ball:[],drink:[]},nTeams:2,timing:{h1:300,gk:60,h2:300,rest:120}})}

// ── 4팀 시뮬레이션용 경기: 다음 경기 이틀 뒤 · 신청 23명 · 도우미 지정 단계
{const d4=new Date(nx);d4.setDate(nx.getDate()+2);const s4=ds(d4);const ap4=Object.keys(players).filter(k=>k!=='p1').slice(0,23);const o4=new Date();o4.setDate(o4.getDate()-2);const c4=new Date(Date.now()-3600e3);
 put('sessions',s4,{date:s4,time:'19:00',end:'22:00',venue:'용산 아이파크몰 The Base 7구장',no:44,capacity:24,stage:'captain',draftStatus:'ready',applyOpen:ds(o4)+'T12:00',applyClose:ds(c4)+'T'+p2(c4.getHours())+':00',
  applicants:ap4,waitlist:[],apps:ap4.map((p,i)=>({k:'f'+i,pid:p,uid:'fu'+i,at:now-86400e3+i*60e3})),p0:['p0'],ops:['p1'],captains:{},captainTokens:{},order:['A','B','C','D'],picks:[],teams:{A:{players:[]},B:{players:[]},C:{players:[]},D:{players:[]}},duty:{ball:[],drink:[]},nTeams:4,timing:{h1:300,gk:60,h2:300,rest:120}})}
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
try{if(!/noauth/.test(location.search))localStorage.setItem('wfsim:auth',JSON.stringify({pid:'p1',h:'mockh'}));sessionStorage.setItem('wfsim:booted','1')}catch(e){}
})();
