import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlobPreconditionFailedError } from '@vercel/blob';
import { makeLiveHandler } from '../api/live.js';
import { livePath,answerPath,playerId,rankPlayers } from '../lib/live.js';

function fixture() {
  let now=1_800_000_000_000,seq=0;const files=new Map();
  const storage={
    async get(path){const b=files.get(path);return b?{stream:new Blob([b.text]).stream(),blob:{etag:b.etag}}:null;},
    async put(path,text,opts){const old=files.get(path);if(opts.ifMatch&&old?.etag!==opts.ifMatch)throw new BlobPreconditionFailedError();if(old&&!opts.allowOverwrite)throw new Error('Already exists');files.set(path,{text,etag:String(++seq),uploadedAt:new Date(now+seq)});},
    async del(path){files.delete(path);},
    async list({prefix,cursor,limit=1000}){const matches=[...files].filter(([path])=>path.startsWith(prefix));const start=Number(cursor||0),page=matches.slice(start,start+limit);return {blobs:page.map(([pathname,b])=>({pathname,uploadedAt:b.uploadedAt})),hasMore:start+limit<matches.length,cursor:String(start+limit)};}
  };
  const handler=makeLiveHandler(storage,()=>now);
  const call=(body,method='POST',query={})=>new Promise((resolve,reject)=>{const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){resolve({code:this.code,body});}};handler({method,headers:{},query,body},res).catch(reject);});
  const room=code=>JSON.parse(files.get(livePath(code)).text);
  return {files,call,room,setTime:t=>now=t,now:()=>now};
}
const token=i=>i.toString(16).padStart(48,'0');
async function open(f,count=5){const created=await f.call({action:'create',level:'medio'});assert.equal(created.code,201);const host={code:created.body.code,token:created.body.token};const players=Array.from({length:count},(_,i)=>({code:host.code,token:token(i+1),name:`Viajero ${i+1}`}));const joined=await Promise.all(players.map(p=>f.call({...p,action:'join'})));assert.ok(joined.every(r=>r.code===200));return {host,players};}

test('host creates a room without a quantity and 40 participants can join concurrently',async()=>{
  const f=fixture(),{host,players}=await open(f,40);
  const state=(await f.call({...host,action:'state'})).body;
  assert.equal(state.role,'host');assert.match(state.code,/^\d{6}$/);assert.equal(state.playerCount,40);
  assert.equal(state.players.length,40);assert.equal(state.playerId,null);
  assert.equal(new Set(state.players.map(p=>p.id)).size,40);
  assert.equal(JSON.stringify(state).includes('hostHash'),false);
  await f.call({...players[0],action:'join'});assert.equal((await f.call({...host,action:'state'})).body.playerCount,40);
  assert.equal((await f.call({...players[0],action:'start'})).code,403);
  assert.equal((await f.call({...host,action:'start'})).body.phase,'question');
  assert.equal((await f.call({code:host.code,token:token(99),name:'Tarde',action:'join'})).code,409);
});

test('concurrent answers are independent, immutable, server-scored and hidden until reveal',async()=>{
  const f=fixture(),{host,players}=await open(f,40);await f.call({...host,action:'start'});
  const r=f.room(host.code),q=r.questions[0];f.setTime(r.opensAt+1000);
  await Promise.all(players.slice(0,39).map(p=>f.call({...p,action:'answer',index:0,selected:q.answer,score:999999})));
  let view=(await f.call({...players[0],action:'state'})).body;
  assert.equal(view.question.answer,undefined);assert.equal(view.ranking,undefined);assert.equal(view.ownAnswer.correct,undefined);assert.equal(view.ownScore,0);
  const original=f.files.get(answerPath(host.code,0,playerId(players[0].token))).text;
  await f.call({...players[0],action:'answer',index:0,selected:(q.answer+1)%q.options.length});
  assert.equal(f.files.get(answerPath(host.code,0,playerId(players[0].token))).text,original);
  view=(await f.call({...host,action:'state'})).body;assert.equal(view.answerCount,39);assert.equal(view.phase,'question');
  await f.call({...players[39],action:'answer',index:0,selected:q.answer});
  const simultaneousHostPolls=await Promise.all(Array.from({length:8},()=>f.call({...host,action:'state'})));
  assert.ok(simultaneousHostPolls.every(r=>r.code===200));
  view=simultaneousHostPolls[0].body;
  assert.equal(view.phase,'feedback');assert.equal(view.ranking.length,40);assert.ok(view.ranking.every(p=>p.score===975&&p.correct===1));
  assert.equal(view.distribution[q.answer],40);assert.equal(view.answerCount,40);
  assert.equal((await f.call({...players[0],action:'next',index:0})).code,403);
  assert.equal((await f.call({...host,action:'answer',index:0,selected:q.answer})).code,403);
});

test('five questions advance only under host control and end in a complete ordered ranking',async()=>{
  const f=fixture(),{host,players}=await open(f,7);await f.call({...host,action:'start'});
  for(let index=0;index<5;index++){
    const r=f.room(host.code),q=r.questions[index];f.setTime(r.opensAt+1000);
    assert.equal((await f.call({...host,action:'next',index})).code,409);
    await Promise.all(players.map((p,i)=>f.call({...p,action:'answer',index,selected:i<3?q.answer:(q.answer+1)%q.options.length})));
    const feedback=(await f.call({...host,action:'state'})).body;
    assert.equal(feedback.status,'playing');assert.equal(feedback.phase,'feedback');
    assert.equal(feedback.question.answer,q.answer);
    const next=(await f.call({...host,action:'next',index})).body;
    assert.equal(next.status,index===4?'finished':'playing');
    if(index<4){assert.equal(next.index,index+1);assert.equal(next.answerCount,0);await f.call({...host,action:'next',index});assert.equal(f.room(host.code).index,index+1);}
  }
  const result=(await f.call({...host,action:'state'})).body;
  assert.equal(result.status,'finished');assert.equal(result.ranking.length,7);
  assert.deepEqual(result.ranking.map(p=>p.position),[1,2,3,4,5,6,7]);
  assert.ok(result.ranking.slice(0,3).every(p=>p.score===4875));
  assert.ok(result.ranking.slice(3).every(p=>p.score===0));
  assert.equal(result.ranking[0].id,playerId(players[0].token));
  assert.equal((await f.call({...players[6],action:'state'})).body.ranking[6].position,7);
  assert.equal(new Set(f.room(host.code).questions.map(q=>q.category)).size,5);
});

test('the host can close a round; timeouts and disconnected participants do not block the room',async()=>{
  const f=fixture(),{host,players}=await open(f,4);await f.call({...host,action:'start'});
  let r=f.room(host.code);f.setTime(r.opensAt-1);
  assert.equal((await f.call({...players[0],action:'answer',index:0,selected:0})).code,400);
  f.setTime(r.opensAt+1000);await f.call({...players[0],action:'answer',index:0,selected:r.questions[0].answer});
  await f.call({...players[1],action:'leave'});assert.equal(f.room(host.code).status,'playing');
  const closed=(await f.call({...host,action:'reveal',index:0})).body;
  assert.equal(closed.phase,'feedback');assert.equal(closed.answerCount,1);assert.equal(closed.ranking.filter(p=>p.score>0).length,1);
  await f.call({...host,action:'next',index:0});r=f.room(host.code);f.setTime(r.deadline+1);
  await f.call({...players[0],action:'answer',index:1,selected:r.questions[1].answer});
  const timeout=(await f.call({...host,action:'state'})).body;assert.equal(timeout.phase,'feedback');
  assert.equal(timeout.answerCount,0);assert.ok(timeout.distribution.every(n=>n===0));
  assert.equal(f.room(host.code).results[playerId(players[0].token)].points,0);
});

test('lobby departures, host cancellation, invalid requests and expired rooms are handled',async()=>{
  const f=fixture();const first=await f.call({action:'create',level:'facil'}),h={code:first.body.code,token:first.body.token};
  assert.equal((await f.call({...h,action:'start'})).code,400);
  const p={code:h.code,token:token(1),name:'Ana'};await f.call({...p,action:'join'});await f.call({...p,action:'leave'});
  assert.equal((await f.call({...h,action:'state'})).body.playerCount,0);
  await f.call({...p,action:'join'});await f.call({...h,action:'start'});
  assert.equal((await f.call({...p,action:'state',token:token(99)})).code,403);
  assert.equal((await f.call({...h,action:'cancel'})).body.status,'cancelled');
  assert.equal((await f.call({...p,action:'state'})).body.status,'cancelled');
  assert.equal((await f.call({action:'join',code:'abc',token:token(1)})).code,400);
  assert.equal((await f.call({...h,action:'unknown'})).code,400);
  assert.equal((await f.call({},'GET')).code,405);
  assert.deepEqual((await f.call({},'GET',{health:'1'})).body,{live:'ready'});
  f.setTime(f.room(h.code).expiresAt);assert.equal((await f.call({...h,action:'state'})).code,410);
});

test('ties use correct answers, response time and registration order consistently',()=>{
  const roster=[{id:'a',name:'A',joinedAt:1},{id:'b',name:'B',joinedAt:2},{id:'c',name:'C',joinedAt:3},{id:'d',name:'D',joinedAt:4}];
  const scores={a:{score:1000,correct:1,responseMs:2000},b:{score:1000,correct:2,responseMs:4000},c:{score:1000,correct:1,responseMs:1000},d:{score:1000,correct:1,responseMs:1000}};
  assert.deepEqual(rankPlayers({roster,scores}).map(p=>p.id),['b','c','d','a']);
});

test('a registered participant reconnects with the same session after the game starts',async()=>{
  const f=fixture(),{host,players}=await open(f,1);await f.call({...host,action:'start'});
  const resumed=await f.call({...players[0],action:'join'});assert.equal(resumed.code,200);assert.equal(resumed.body.role,'player');
  assert.equal(resumed.body.playerCount,1);assert.equal(resumed.body.playerId,playerId(players[0].token));
});

test('players see a closed lobby when the host cancels before starting',async()=>{
  const f=fixture(),{host,players}=await open(f,3);
  assert.equal((await f.call({...host,action:'cancel'})).body.status,'cancelled');
  const states=await Promise.all(players.map(p=>f.call({...p,action:'state'})));
  assert.ok(states.every(r=>r.code===200&&r.body.status==='cancelled'));
});
