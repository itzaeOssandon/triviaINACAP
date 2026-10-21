import { test } from 'node:test';
import assert from 'node:assert/strict';
import bank from '../src/questions.json' with { type: 'json' };
import { createRoom, applyAction, roomView } from '../lib/duel.js';
const now = 1_800_000_000_000, host = 'a'.repeat(48), guest = 'b'.repeat(48), stranger = 'c'.repeat(48);
function room() { return createRoom(bank, 'medio', 'Ana', host, 'ABCDEF1234', now); }
function started() { const r=room(); applyAction(r,'join',{name:'Luis'},guest,now); applyAction(r,'start',{},host,now); return r; }

test('two players join one room; a third player and unauthorized starts are rejected', () => {
  const r=room(); assert.throws(()=>applyAction(r,'start',{},host,now), /Espera/);
  applyAction(r,'join',{name:'Luis'},guest,now);
  applyAction(r,'join',{name:'Luis'},guest,now); assert.equal(r.players.length,2);
  assert.throws(()=>applyAction(r,'join',{},stranger,now), /completa/);
  assert.throws(()=>applyAction(r,'start',{},guest,now), /creador/);
  assert.throws(()=>applyAction(r,'state',{},stranger,now), /perteneces/);
  applyAction(r,'start',{},host,now);
  assert.equal(new Set(r.questions.map(q=>q.category)).size,5);
  assert.deepEqual(roomView(r,0,now).question,roomView(r,1,now).question);
});

test('answers and scores remain hidden until both players answer; duplicate answers cannot change scores', () => {
  const r=started(), q=r.questions[0];
  applyAction(r,'answer',{index:0,selected:q.answer},host,r.opensAt+500);
  let view=roomView(r,0,r.opensAt+500);
  assert.equal(view.question.answer,undefined); assert.equal(view.question.explanation,undefined);
  assert.equal(view.ownAnswer.correct,undefined); assert.equal(view.players[0].score,0);
  assert.equal(JSON.stringify(view).includes('tokenHash'),false);
  const score=r.players[0].score;
  applyAction(r,'answer',{index:0,selected:(q.answer+1)%q.options.length},host,r.opensAt+1000);
  assert.equal(r.players[0].score,score);
  applyAction(r,'answer',{index:0,selected:(q.answer+1)%q.options.length},guest,r.opensAt+1500);
  view=roomView(r,0,r.opensAt+1500);
  assert.equal(view.phase,'feedback'); assert.equal(view.question.answer,q.answer);
  assert.equal(view.players[0].score,score);
});

test('server timing rejects early answers and counts late answers as zero', () => {
  const r=started();
  assert.throws(()=>applyAction(r,'answer',{index:0,selected:0},host,r.opensAt-1), /segundos/);
  applyAction(r,'answer',{index:0,selected:r.questions[0].answer},host,r.deadline);
  assert.equal(r.phase,'feedback'); assert.equal(r.players[0].score,0);
  assert.equal(r.rounds[0][0].selected,null); assert.equal(r.rounds[0][1].selected,null);
});

test('both players must confirm the next round; stale requests never skip a question', () => {
  const r=started(); applyAction(r,'state',{},host,r.deadline+1);
  applyAction(r,'next',{index:0},host,r.deadline+100);
  applyAction(r,'next',{index:0},host,r.deadline+100);
  assert.equal(r.index,0);
  applyAction(r,'next',{index:0},guest,r.deadline+100);
  assert.equal(r.index,1);
  applyAction(r,'next',{index:0},guest,r.opensAt);
  assert.equal(r.index,1);
  assert.throws(()=>applyAction(r,'answer',{index:0,selected:0},host,r.opensAt), /cambió/);
});

for (const tied of [false,true]) test(`complete five rounds with ${tied ? 'a tie' : 'a winner and loser'}`, () => {
  const r=started();
  for(let i=0;i<5;i++) {
    const q=r.questions[i], at=r.opensAt+1000;
    applyAction(r,'answer',{index:i,selected:q.answer},host,at);
    applyAction(r,'answer',{index:i,selected:tied?q.answer:(q.answer+1)%q.options.length},guest,at);
    if(i<4) { applyAction(r,'next',{index:i},host,at+100); applyAction(r,'next',{index:i},guest,at+100); }
  }
  assert.equal(r.status,'finished');
  const v=roomView(r,1,r.deadline);
  assert.equal(v.winner,tied?'tie':0); assert.equal(v.recap.length,5);
  assert.equal(r.players[0].correct,5); assert.equal(r.players[1].correct,tied?5:0);
});

test('leaving cancels the match without inventing a winner; rooms expire after one hour', () => {
  const r=started(); applyAction(r,'leave',{},guest,now+500);
  assert.equal(roomView(r,0,now+500).winner,null); assert.equal(r.status,'cancelled');
  assert.throws(()=>applyAction(r,'state',{},host,r.expiresAt), {status:410});
});
