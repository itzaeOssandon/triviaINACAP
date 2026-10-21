import { get, put, del, list, head, BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';
import bank from '../src/questions.json' with { type:'json' };
import { GameError } from '../lib/duel.js';
import { tokenHash,playerId,newLiveToken,newPin,livePath,playersPrefix,answersPrefix,answerPath,safeName,registrationPath,parseRegistrations,createLiveRoom,actorFor,revealLiveRound,applyHostAction,liveView } from '../lib/live.js';

export const config={maxDuration:60};
export function makeLiveHandler(storage={get,put,del,list,head}, clock=Date.now) {
  const read=async (path,versioned=false)=>{
    // Read the storage version before its content. HTTP download ETags can differ
    // from the canonical version accepted by conditional uploads.
    let etag;
    if(versioned){
      try{etag=(await storage.head(path)).etag;}catch(error){if(error instanceof BlobNotFoundError)return null;throw error;}
      if(!etag)throw new GameError('No pudimos verificar la versión de la sala. Inténtalo nuevamente.',503);
    }
    const r=await storage.get(path,{access:'private',useCache:false});
    return r?{data:await new Response(r.stream).json(),etag:versioned?etag:r.blob.etag}:null;
  };
  async function all(prefix) {const blobs=[];let cursor;do{const page=await storage.list({prefix,limit:1000,...(cursor?{cursor}:{})});blobs.push(...page.blobs);cursor=page.hasMore?page.cursor:undefined;}while(cursor);return blobs;}
  const rosterFor=async room=>room.status==='lobby'?parseRegistrations(await all(playersPrefix(room.code))):room.roster;
  const immutable=async(path,data)=>{try{await storage.put(path,JSON.stringify(data),{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json'});}catch(error){const existing=await read(path);if(!existing)throw error;return existing.data;}return data;};
  async function roundEntries(room) {
    const ids=new Set(room.roster.map(p=>p.id));
    return (await all(answersPrefix(room.code,room.index))).filter(b=>ids.has(b.pathname.split('/').pop().replace('.json','')));
  }
  async function collect(entries) {
    const answers={};
    for(let i=0;i<entries.length;i+=25)await Promise.all(entries.slice(i,i+25).map(async b=>{const a=await read(b.pathname);if(a)answers[b.pathname.split('/').pop().replace('.json','')]=a.data;}));
    return answers;
  }
  async function buildView(room,actor,roster,knownEntries) {
    const entries=actor.role==='host'&&room.status==='playing'&&room.phase==='question'?(knownEntries??await roundEntries(room)):[];
    const own=actor.role==='player'&&room.phase==='question'?(await read(answerPath(room.code,room.index,actor.id)))?.data:null;
    return liveView(room,actor,roster,entries.map(b=>b.pathname.split('/').pop().replace('.json','')),own,clock());
  }
  return async function handler(req,res) {
    res.setHeader('Cache-Control','private, no-store');
    if(req.method==='GET'&&req.query?.health==='1'){
      try{await storage.get('health/connectivity.json',{access:'private',useCache:false});await storage.list({prefix:'health/',limit:1});return res.status(200).json({live:'ready'});}catch{return res.status(503).json({live:'unavailable'});}
    }
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Usa POST.'});}
    let actionForLog, codeForLog;
    try {
      if(Number(req.headers['content-length']||0)>2048)throw new GameError('Solicitud demasiado grande.',413);
      let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{throw new GameError('Los datos no son válidos.');}
      if(!body||typeof body!=='object')throw new GameError('Faltan los datos de la sala.');
      const {action}=body;actionForLog=action;
      if(!['create','join','state','start','answer','reveal','next','leave','cancel'].includes(action))throw new GameError('Acción no válida.');
      if(action==='create') {
        const token=newLiveToken();
        for(let i=0;i<5;i++) {
          const code=newPin();if(await read(livePath(code)))continue;
          const room=createLiveRoom(bank,body.level,token,code,clock());
          try{await storage.put(livePath(code),JSON.stringify(room),{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json'});}
          catch(error){if(await read(livePath(code)))continue;throw error;}
          return res.status(201).json({...liveView(room,{role:'host',id:null},[],[],null,clock()),token});
        }
        throw new GameError('No pudimos generar el código. Inténtalo de nuevo.',503);
      }
      const code=String(body.code||'').trim();if(!/^\d{6}$/.test(code))throw new GameError('Introduce el código de 6 dígitos.');codeForLog=code;
      const token=body.token;if(typeof token!=='string'||!/^[a-f0-9]{48}$/.test(token))throw new GameError('La sesión no es válida. Vuelve a entrar.',401);
      const receivedAt=clock();
      for(let attempt=0;attempt<5;attempt++) {
        const saved=await read(livePath(code),true);if(!saved)throw new GameError('No encontramos esa sala. Revisa el código.',404);
        const room=saved.data;if(room.expiresAt<=receivedAt)throw new GameError('La sala expiró. Crea una nueva.',410);
        let roster=await rosterFor(room);
        if(action==='join') {
          if(room.hostHash===tokenHash(token))throw new GameError('El presentador no ocupa un lugar de jugador.');
          const existing=roster.find(p=>p.id===playerId(token));
          if(existing)return res.status(200).json({...await buildView(room,{role:'player',id:existing.id},roster),token});
          if(room.status!=='lobby')throw new GameError('La partida ya comenzó o la sala está cerrada.',409);
          const name=safeName(body.name);if(!name)throw new GameError('Escribe tu nombre o apodo.');
          const path=registrationPath(code,token,name);await immutable(path,{joinedAt:receivedAt});
          const latest=(await read(livePath(code)))?.data;
          if(!latest)throw new GameError('La sala ya no está disponible.',404);
          if(latest.status!=='lobby'&&!latest.roster.some(p=>p.id===playerId(token))){await storage.del(path);throw new GameError('La partida comenzó antes de completar tu ingreso.',409);}
          roster=await rosterFor(latest);
          return res.status(200).json({...await buildView(latest,{role:'player',id:playerId(token)},roster),token});
        }
        const actor=actorFor(room,roster,token);
        if(actor.role==='player') {
          if(!['state','answer','leave'].includes(action))throw new GameError('Solo el presentador controla la partida.',403);
          if(action==='leave'&&room.status==='lobby') {await storage.del(roster.find(p=>p.id===actor.id).path);return res.status(200).json({left:true});}
          if(action==='answer') {
            if(room.status!=='playing'||room.phase!=='question'||body.index!==room.index)throw new GameError('La pregunta ya está cerrada. Espera la actualización.',409);
            if(receivedAt<room.opensAt)throw new GameError('Espera a que comience la pregunta.');
            const q=room.questions[room.index];
            if(!Number.isInteger(body.selected)||body.selected<0||body.selected>=q.options.length)throw new GameError('Elige una alternativa válida.');
            if(receivedAt<room.deadline)await immutable(answerPath(code,room.index,actor.id),{selected:body.selected,receivedAt});
          }
          return res.status(200).json(await buildView(room,actor,roster));
        }
        if(action==='answer')throw new GameError('El presentador muestra las preguntas y no participa en el ranking.',403);
        const before=JSON.stringify(room), originalIndex=room.index;let entries;
        if(room.status==='playing'&&room.phase==='question') {
          entries=await roundEntries(room);
          if(action==='reveal'&&body.index===room.index||receivedAt>=room.deadline||entries.length===room.roster.length)revealLiveRound(room,await collect(entries));
        }
        if(['start','next','leave','cancel'].includes(action))applyHostAction(room,action,body,roster,receivedAt);
        if(JSON.stringify(room)!==before) {
          room.revision++;
          try{await storage.put(livePath(code),JSON.stringify(room),{access:'private',addRandomSuffix:false,allowOverwrite:true,ifMatch:saved.etag,contentType:'application/json'});}
          catch(error){if(error instanceof BlobPreconditionFailedError){if(attempt===4)console.warn('live-write-conflict',JSON.stringify({action,code,revision:room.revision,hasEtag:Boolean(saved.etag)}));continue;}throw error;}
        }
        if(['start','next','reveal','cancel'].includes(action))console.info('live-host-action',JSON.stringify({action,code,status:room.status,phase:room.phase,index:room.index,revision:room.revision}));
        return res.status(200).json(await buildView(room,actor,roster,entries&&room.index===originalIndex?entries:undefined));
      }
      throw new GameError('La sala se está actualizando. Inténtalo de nuevo.',409);
    }catch(error){if(error instanceof GameError&&['start','next','reveal'].includes(actionForLog))console.warn('live-host-action-failed',JSON.stringify({action:actionForLog,code:codeForLog,status:error.status,reason:error.message}));if(!(error instanceof GameError))console.error('live-api',error.name,error.message);return res.status(error instanceof GameError?error.status:503).json({error:error instanceof GameError?error.message:'No pudimos conectar con la sala. Inténtalo de nuevo.'});}
  };
}
export default makeLiveHandler();
