import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlobPreconditionFailedError } from '@vercel/blob';
import { makeHandler } from '../api/duel.js';

// Contract test for concurrent serverless requests against an ETag-based store.
// Production always uses Vercel Blob; only this test supplies the storage double.
function storage() {
  const files = new Map(); let version = 0;
  return { files,
    async get(path) { const f=files.get(path); if(!f)return null; return {stream:new Blob([f.text]).stream(),blob:{etag:f.etag}}; },
    async put(path,text,opts) {
      const old=files.get(path);
      if(opts.ifMatch && old?.etag!==opts.ifMatch)throw new BlobPreconditionFailedError();
      if(old&&!opts.allowOverwrite)throw new Error('Path exists');
      files.set(path,{text,etag:String(++version)});
    },
    async del(path) {files.delete(path);}
  };
}
function call(handler,body,method='POST',query={}) {
  return new Promise((resolve,reject)=> {
    const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(data){resolve({code:this.code,body:data,headers:this.headers});}};
    handler({method,headers:{},body,query},res).catch(reject);
  });
}
test('API persists simultaneous answers without lost updates and cannot accept a third player',async()=>{
  const db=storage(), handler=makeHandler(db);
  let res=await call(handler,{action:'create',level:'facil',name:'Ana'});
  assert.equal(res.code,201); const first=res.body, credentials={code:first.code,token:first.token};
  res=await call(handler,{action:'join',code:first.code,name:'Luis'});assert.equal(res.code,200);const second=res.body;
  assert.equal((await call(handler,{action:'join',code:first.code,name:'Extra'})).code,409);
  assert.equal((await call(handler,{action:'state',code:first.code,token:'f'.repeat(48)})).code,403);
  await call(handler,{...credentials,action:'start'});
  const stored=db.files.get(`rooms/${first.code}.json`); const room=JSON.parse(stored.text);
  room.opensAt=Date.now()-500;room.deadline=Date.now()+19500;
  db.files.set(`rooms/${first.code}.json`,{...stored,text:JSON.stringify(room)});
  const answer=room.questions[0].answer;
  const replies=await Promise.all([
    call(handler,{...credentials,action:'answer',index:0,selected:answer}),
    call(handler,{code:first.code,token:second.token,action:'answer',index:0,selected:answer})
  ]);
  assert.ok(replies.every(r=>r.code===200));
  res=await call(handler,{...credentials,action:'state'});
  assert.equal(res.body.phase,'feedback');assert.ok(res.body.players.every(p=>p.score>0));
  assert.ok(res.body.players.every(p=>p.correct===1));
  const score=res.body.players[0].score;
  await call(handler,{...credentials,action:'answer',index:0,selected:answer});
  res=await call(handler,{...credentials,action:'state'});assert.equal(res.body.players[0].score,score);
  assert.equal(res.headers['Cache-Control'],'private, no-store');
});
test('API handles invalid codes, missing rooms, wrong methods and expired sessions',async()=>{
  const db=storage(), handler=makeHandler(db);
  assert.equal((await call(handler,{},'GET')).code,405);
  assert.equal((await call(handler,{action:'state',code:'x'})).code,400);
  assert.equal((await call(handler,{action:'join',code:'A'.repeat(10)})).code,404);
  const first=(await call(handler,{action:'create',level:'medio'})).body;
  const path=`rooms/${first.code}.json`, stored=db.files.get(path), r=JSON.parse(stored.text);r.expiresAt=0;
  db.files.set(path,{...stored,text:JSON.stringify(r)});
  assert.equal((await call(handler,{action:'state',code:first.code,token:first.token})).code,410);
  assert.equal(db.files.has(path),false);
});

test('deployment health check reads the configured private store without exposing data',async()=>{
  const handler=makeHandler(storage());
  const response=await call(handler,{},'GET',{health:'1'});
  assert.equal(response.code,200);assert.deepEqual(response.body,{duel:'ready'});
});
