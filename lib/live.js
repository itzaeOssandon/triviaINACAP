import { createHash, randomBytes, randomInt } from 'node:crypto';
import { createGame, LEVELS, QUESTION_SECONDS, pointsFor } from '../src/quiz.js';
import { GameError } from './duel.js';

export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export const playerId = token => tokenHash(token).slice(0, 24);
export const newLiveToken = () => randomBytes(24).toString('hex');
export const newPin = () => String(randomInt(100000, 1000000));
export const livePath = code => `live/${code}/room.json`;
export const playersPrefix = code => `live/${code}/players/`;
export const answersPrefix = (code, index) => `live/${code}/answers/${index}/`;
export const answerPath = (code, index, id) => `${answersPrefix(code,index)}${id}.json`;
export const safeName = name => String(name || '').normalize('NFC').trim().slice(0, 20);
export function registrationPath(code, token, name) {
  return `${playersPrefix(code)}${playerId(token)}.${Buffer.from(safeName(name)).toString('base64url')}.json`;
}
export function parseRegistrations(blobs) {
  const unique = new Map();
  for (const b of blobs) {
    const filename = b.pathname.split('/').pop();
    const match = /^([a-f0-9]{24})\.([A-Za-z0-9_-]+)\.json$/.exec(filename);
    if (!match) continue;
    const p = { id: match[1], name: Buffer.from(match[2], 'base64url').toString('utf8'), joinedAt: new Date(b.uploadedAt).getTime(), path: b.pathname };
    const prev = unique.get(p.id);
    if (!prev || p.joinedAt < prev.joinedAt || p.joinedAt === prev.joinedAt && p.path < prev.path) unique.set(p.id,p);
  }
  return [...unique.values()].sort((a,b)=>a.joinedAt-b.joinedAt || a.id.localeCompare(b.id));
}
export function createLiveRoom(bank, level, token, code, now = Date.now()) {
  if (!LEVELS.some(l=>l.id===level)) throw new GameError('Elige un nivel válido.');
  return { version:2, code, level, hostHash:tokenHash(token), status:'lobby', phase:'waiting', revision:0,
    expiresAt:now+2*60*60*1000, index:0, opensAt:null, deadline:null,
    questions:createGame(bank,level), roster:[], scores:{}, results:{}, distribution:[] };
}
export function actorFor(room, roster, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) throw new GameError('La sesión no es válida. Vuelve a entrar.',401);
  if (room.hostHash === tokenHash(token)) return { role:'host', id:null };
  const id=playerId(token);
  if (!roster.some(p=>p.id===id)) throw new GameError('No perteneces a esta sala.',403);
  return { role:'player', id };
}
export function beginLiveRound(room, now) {
  room.phase='question';room.opensAt=now+4000;room.deadline=room.opensAt+QUESTION_SECONDS*1000;
  room.results={};room.distribution=[];
}
export function rankPlayers(room) {
  return room.roster.map(p=>({id:p.id,name:p.name,joinedAt:p.joinedAt,...room.scores[p.id]}))
    .sort((a,b)=>b.score-a.score || b.correct-a.correct || a.responseMs-b.responseMs || a.joinedAt-b.joinedAt || a.id.localeCompare(b.id))
    .map((p,i)=>({id:p.id,name:p.name,score:p.score,correct:p.correct,position:i+1}));
}
export function revealLiveRound(room, answers) {
  if (room.status!=='playing' || room.phase!=='question') return;
  const q=room.questions[room.index];room.results={};room.distribution=q.options.map(()=>0);
  for (const p of room.roster) {
    const a=answers[p.id];
    const valid=a && Number.isInteger(a.selected) && a.selected>=0 && a.selected<q.options.length && a.receivedAt>=room.opensAt && a.receivedAt<room.deadline;
    const selected=valid?a.selected:null;
    const correct=selected===q.answer;
    const responseMs=valid?a.receivedAt-room.opensAt:QUESTION_SECONDS*1000;
    const points=pointsFor(correct,(QUESTION_SECONDS*1000-responseMs)/1000);
    const score=room.scores[p.id];score.score+=points;score.correct+=correct?1:0;score.responseMs+=responseMs;
    room.results[p.id]={selected,correct,points};
    if (valid)room.distribution[selected]++;
  }
  room.phase='feedback';
}
export function applyHostAction(room, action, input, roster, now) {
  if (action==='start') {
    if(room.status!=='lobby')return;
    if(!roster.length)throw new GameError('Espera a que entre al menos un participante.');
    room.roster=roster;room.scores=Object.fromEntries(roster.map(p=>[p.id,{score:0,correct:0,responseMs:0}]));
    room.status='playing';beginLiveRound(room,now);return;
  }
  if(action==='next') {
    if(room.status!=='playing' || input.index!==room.index)return;
    if(room.phase!=='feedback')throw new GameError('Primero cierra las respuestas de esta pregunta.',409);
    if(room.index===4){room.status='finished';return;}
    room.index++;beginLiveRound(room,now);return;
  }
  if(action==='leave' || action==='cancel') {if(room.status==='lobby')room.roster=roster;if(room.status!=='finished')room.status='cancelled';return;}
}
export function liveView(room, actor, roster, answeredIds = [], ownAnswer = null, now = Date.now()) {
  const revealed=room.phase==='feedback' || room.status==='finished';
  const players=(room.status==='lobby'?roster:room.roster).map(p=>({id:p.id,name:p.name}));
  const view={ code:room.code,level:room.level,role:actor.role,playerId:actor.id,status:room.status,phase:room.phase,
    index:room.index,revision:room.revision,serverNow:now,opensAt:room.opensAt,deadline:room.deadline,
    players,playerCount:players.length,answerCount:revealed?room.distribution.reduce((a,b)=>a+b,0):answeredIds.length,ownAnswer:null };
  if(actor.role==='player') {
    if(revealed)view.ownAnswer=room.results[actor.id]??null;
    else if(ownAnswer)view.ownAnswer={selected:ownAnswer.selected};
    view.ownScore=room.scores[actor.id]?.score??0;
  }
  if(room.status==='playing' || room.status==='finished') {
    const q=room.questions[room.index];
    view.question={question:q.question,category:q.category,options:q.options.map(o=>o.text)};
    if(revealed)Object.assign(view.question,{answer:q.answer,explanation:q.explanation});
  }
  if(revealed){view.ranking=rankPlayers(room);view.distribution=room.distribution;}
  return view;
}
