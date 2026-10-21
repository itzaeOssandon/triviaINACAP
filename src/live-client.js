import QRCode from 'qrcode';
import { CATEGORIES, LEVELS } from './quiz.js';
const marks=['▲','◆','●','■'];
const savedKey='inacap-live-v2';

export function createLiveUI({shell,escape:esc,focusHeading,getLevel,onEnter,onHome}) {
  let session=null,state=null,active=false,generation=0,pollTimer,clockTimer,chain=Promise.resolve(),pending=false,offset=0,failures=0,renderKey='',actionError='';
  const qrCache=new Map();
  const save=value=>{try{value?sessionStorage.setItem(savedKey,JSON.stringify(value)):sessionStorage.removeItem(savedKey);}catch{}};
  const message=text=>{const n=document.querySelector('#live-notice');if(n)n.textContent=text;};
  const setRole=role=>{document.body.classList.toggle('live-presenter',role==='host');onEnter();};
  function stop(){active=false;clearTimeout(pollTimer);clearInterval(clockTimer);}
  function close(){
    generation++;stop();actionError='';const old=session;session=null;state=null;renderKey='';pending=false;save(null);document.body.classList.remove('live-presenter');
    if(old)fetch('/api/live',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:old.code,token:old.token,action:'leave'}),keepalive:true}).catch(()=>{});
  }
  async function request(action,extra={}) {
    const sent=Date.now();
    const response=await fetch('/api/live',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',signal:AbortSignal.timeout(20000),body:JSON.stringify({code:session?.code,token:session?.token,action,...extra})});
    let data;try{data=await response.json();}catch{throw new Error('No pudimos conectar con la sala. Inténtalo de nuevo.');}
    if(!response.ok){const error=new Error(data.error||'No pudimos actualizar la sala.');error.status=response.status;throw error;}
    offset=data.serverNow-(sent+Date.now())/2;return data;
  }
  function setup(role='host',code='') {
    const page=++generation;stop();session=null;state=null;pending=false;renderKey='';actionError='';chain=Promise.resolve();setRole(role);
    const host=role==='host';
    const joinToken=host?undefined:Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
    shell(`<main id="main" class="live-setup ${host?'host-setup':''}"><span class="eyebrow">${host?'LA PANTALLA GRANDE ES TU ESCENARIO':'TU TELÉFONO, TU PULSADOR'}</span><h1 tabindex="-1">${host?'Que empiece el show.':'Entra en la onda.'}</h1><p>${host?'Conecta el computador a la televisión, crea una sala y deja que el público se una con el código o el QR. Tú decides cuándo comenzar.':'Escanea el QR de la pantalla o introduce el código. Elige tu apodo y prepárate para viajar a los 60 y 70.'}</p>
      <form id="live-form">${host?`<label class="field-label" for="live-level">Dificultad de la partida</label><select id="live-level">${LEVELS.map(l=>`<option value="${l.id}" ${getLevel()===l.id?'selected':''}>${l.label}</option>`).join('')}</select><p class="live-rules">5 preguntas · Una por categoría · 20 segundos por pregunta. El presentador controla el avance y los participantes responden desde sus teléfonos.</p>`:`<label class="field-label" for="live-code">Código de la sala</label><input id="live-code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" value="${esc(code)}" placeholder="123456" autocomplete="off" required><label class="field-label" for="live-name">Tu nombre o apodo</label><input id="live-name" maxlength="20" placeholder="Ej.: Viajero retro" autocomplete="nickname" required>`}
      <button id="live-submit" class="primary-button" type="submit">${host?'Crear sala y mostrar QR':'¡Entrar a la sala!'}</button></form><p id="live-notice" role="status"></p><button id="live-back" class="text-button">Volver al inicio</button></main>`);
    document.querySelector('#live-back').addEventListener('click',onHome);
    document.querySelector('#live-form').addEventListener('submit',async e=>{
      e.preventDefault();if(pending)return;pending=true;const button=document.querySelector('#live-submit');button.disabled=true;message('Conectando con la sala…');
      try{
        const data=await request(host?'create':'join',host?{level:document.querySelector('#live-level').value}:{code:document.querySelector('#live-code').value.trim(),name:document.querySelector('#live-name').value,token:joinToken});
        if(page!==generation)return;
        session={code:data.code,token:data.token,role:data.role};save(session);active=true;pending=false;applyState(data);schedule();history.replaceState(null,'',location.pathname);
      }catch(error){if(page===generation){message(error.message);button.disabled=false;}}
      finally{if(page===generation)pending=false;}
    });focusHeading();
    if(!host&&/^\d{6}$/.test(code))document.querySelector('#live-name').focus();
  }
  function enqueue(task){const current=generation;chain=chain.catch(()=>{}).then(()=>current===generation?task(current):undefined);return chain;}
  function schedule(){clearTimeout(pollTimer);if(active)pollTimer=setTimeout(poll,Math.min(1800*2**failures,9000));}
  async function poll(){
    if(!active)return;if(pending){schedule();return;}
    await enqueue(async page=>{
      try{const data=await request('state');if(page!==generation||!active)return;failures=0;applyState(data);message(actionError);}
      catch(error){if(page!==generation||!active)return;failures++;message([401,403,404,410].includes(error.status)?error.message:'Conexión interrumpida. Reintentando… Mantén esta pestaña abierta para recuperar tu sesión.');if([401,403,404,410].includes(error.status)){stop();save(null);}}
    });schedule();
  }
  function act(action,extra={}) {
    if(pending||!active)return;actionError='';message(action==='start'?'Iniciando el show…':'Actualizando la sala…');pending=true;tick();document.querySelectorAll('[data-host-action]').forEach(b=>b.disabled=true);
    void enqueue(async page=>{
      try{const data=await request(action,extra);if(page===generation&&active){pending=false;renderKey='';applyState(data);message('');}}
      catch(error){if(page===generation&&active){pending=false;actionError=error.message;renderKey='';render();message(actionError);}}
      finally{if(page===generation){pending=false;tick();}}
    });
  }
  function applyState(data){
    const previous=state;if(previous&&(previous.status!==data.status||previous.phase!==data.phase||previous.index!==data.index))actionError='';state=data;setRole(data.role);
    const key=JSON.stringify([data.role,data.status,data.phase,data.index,data.revision,data.players,data.ownAnswer]);
    if(key!==renderKey&&!document.querySelector('dialog[open]')){
      if(previous?.status==='lobby'&&data.status==='lobby'&&document.querySelector('.live-lobby')){
        document.querySelector('#audience-title').innerHTML=`<strong>${data.playerCount}</strong> participantes en la onda`;
        document.querySelector('.audience-names').innerHTML=data.players.length?data.players.map(p=>`<span>${esc(p.name)}</span>`).join(''):'<p>Esperando a los primeros viajeros…</p>';
        document.querySelector('[data-host-action="start"]').disabled=pending||data.playerCount<1;
      }else if(previous?.status==='lobby'&&data.status==='lobby'&&document.querySelector('.player-ticket')){
        document.querySelector('.player-ticket span').textContent=`${data.playerCount} participantes · Nivel ${levelName()}`;
      }else render();
      renderKey=key;
    }
    const count=document.querySelector('#live-answer-count');if(count)count.textContent=String(data.answerCount);
    tick();if(['finished','cancelled'].includes(data.status))stop();
  }
  const levelName=()=>LEVELS.find(l=>l.id===state.level)?.label||'';
  function frame(content){
    const host=state.role==='host';
    shell(`<main id="main" class="live-page ${host?'presenter-page':'player-page'}"><div class="live-topline"><span class="eyebrow">${host?'MODO PRESENTADOR':'EN LA ONDA · '+esc(state.players.find(p=>p.id===state.playerId)?.name||'PARTICIPANTE')}</span><span class="live-pin-mini">PIN <strong>${state.code}</strong></span></div>${content}<p id="live-notice" role="status"></p><button id="live-exit" class="text-button">${state.status==='finished'||state.status==='cancelled'?'Volver al inicio':host?'Cerrar sala':'Salir de la sala'}</button></main>`);
    const p=document.querySelector('#exit-dialog p');if(p)p.textContent=host?'La sala se cerrará para todos los participantes.':'Saldrás de la partida. El puntaje que hayas obtenido se conservará en el ranking.';
    document.querySelector('#live-exit').addEventListener('click',()=>{if(['finished','cancelled'].includes(state.status))onHome();else document.querySelector('#exit-dialog').showModal();});
    document.querySelectorAll('[data-host-action]').forEach(b=>b.addEventListener('click',()=>act(b.dataset.hostAction,{index:state.index})));
  }
  async function mountQr(code){
    const url=new URL(location.origin);url.searchParams.set('sala',code);const link=url.href;
    if(!qrCache.has(link))qrCache.set(link,QRCode.toDataURL(link,{width:600,margin:4,errorCorrectionLevel:'M',color:{dark:'#222b24',light:'#ffffff'}}));
    try{const data=await qrCache.get(link);const img=document.querySelector('#live-qr');if(img&&state?.code===code){img.src=data;img.hidden=false;document.querySelector('#qr-loading')?.remove();}}
    catch{message('Usa el código de la sala para ingresar. No pudimos preparar el QR.');}
    document.querySelector('#live-copy')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(link);message('Enlace de invitación copiado.');}catch{message(`Enlace: ${link}`);}});
  }
  function render(){
    clearInterval(clockTimer);const host=state.role==='host';
    if(state.status==='lobby'){
      if(host){
        frame(`<section class="live-lobby"><div class="lobby-invite"><span class="live-sticker">✳ TODOS A BORDO</span><h1 tabindex="-1">Escanea.<br>Conéctate. <em>Juega.</em></h1><p>Apunta tu cámara al QR y escribe tu apodo.<br>También puedes entrar en <strong>${esc(location.host)}</strong> e ingresar este código:</p><div class="live-pin" aria-label="Código de la sala">${state.code}</div><div class="lobby-start"><button class="primary-button" data-host-action="start" ${state.playerCount<1?'disabled':''}>¡Comenzar el show! →</button><span>${levelName()} · 5 preguntas</span></div></div><div class="qr-panel"><span class="qr-kicker">TU ENTRADA AL PASADO</span><img id="live-qr" hidden width="600" height="600" alt="Escanea este código QR para unirte a la sala ${state.code}"><p id="qr-loading">Preparando el QR…</p><button id="live-copy" class="text-button">Copiar enlace de invitación</button></div></section><section class="live-audience" aria-labelledby="audience-title"><div class="audience-heading"><h2 id="audience-title"><strong>${state.playerCount}</strong> participantes en la onda</h2><span>El ingreso está abierto hasta comenzar.</span></div><div class="audience-names">${state.players.length?state.players.map(p=>`<span>${esc(p.name)}</span>`).join(''):'<p>Esperando a los primeros viajeros…</p>'}</div></section>`);
        void mountQr(state.code);
      }else frame(`<div class="player-wait"><span class="retro-flower" aria-hidden="true">✿</span><h1 tabindex="-1">¡Estás dentro!</h1><p>Ya estás en la sala. Mira la pantalla de la televisión: el presentador comenzará pronto.</p><div class="player-ticket">${esc(state.players.find(p=>p.id===state.playerId)?.name||'Participante')}<span>${state.playerCount} participantes · Nivel ${levelName()}</span></div><p>Gana quien sume más puntos. Los aciertos y la rapidez marcan la diferencia.</p></div>`);
    }else if(state.status==='cancelled')frame('<div class="player-wait"><h1 tabindex="-1">El show terminó antes de tiempo.</h1><p>El presentador cerró esta sala. Puedes volver al inicio para unirte a una nueva partida.</p></div>');
    else if(state.status==='finished')frame(results());
    else frame(question());
    document.querySelectorAll('[data-live-answer]').forEach(b=>b.addEventListener('click',()=>act('answer',{index:state.index,selected:Number(b.dataset.liveAnswer)})));
    clockTimer=setInterval(tick,100);focusHeading();tick();
  }
  function question(){
    const host=state.role==='host',q=state.question,c=CATEGORIES.find(c=>c.id===q.category),feedback=state.phase==='feedback',own=state.ownAnswer;
    const answers=q.options.map((text,i)=>{
      const content=`<span class="live-answer-shape" aria-hidden="true">${marks[i]}</span><span>${esc(text)}</span>${feedback&&i===q.answer?'<span class="live-answer-correct">✓<span class="sr-only">Respuesta correcta</span></span>':''}`;
      const className=`live-answer answer-${i} ${feedback&&i===q.answer?'live-correct':''} ${feedback&&own?.selected===i&&i!==q.answer?'live-wrong':''} ${!feedback&&own?.selected===i?'live-selected':''}`;
      return host?`<div class="${className}">${content}${feedback?`<span class="live-votes">${state.distribution[i]} ${state.distribution[i]===1?'respuesta':'respuestas'}</span>`:''}</div>`:`<button class="${className}" data-live-answer="${i}" ${feedback||own?'disabled':''}>${content}<span class="answer-key" aria-hidden="true">${i+1}</span></button>`;
    }).join('');
    return `<div class="live-round-meta"><span class="category-badge ${c.color}">${c.symbol} ${c.label}</span><span>PREGUNTA ${state.index+1} / 5 · ${levelName()}</span><span class="live-clock" role="timer" aria-live="off"><strong id="live-seconds">20</strong><small>s</small></span></div><h1 class="live-question" tabindex="-1">${esc(q.question)}</h1><p id="live-round-hint" class="live-round-hint">${feedback?'La respuesta correcta está marcada.':'¡Cada segundo cuenta!'}</p><div class="live-answer-grid">${answers}</div>${host?`<div class="host-controls"><div class="live-response-count"><strong id="live-answer-count">${state.answerCount}</strong> / ${state.playerCount} respuestas</div>${feedback?`<button class="primary-button" data-host-action="next">${state.index===4?'Ver podio y ranking':'Siguiente pregunta'} →</button>`:'<button class="secondary-button" data-host-action="reveal">Cerrar respuestas</button>'}</div>`:''}${feedback?`<div class="live-explanation">${!host?`<strong>${own?.correct?'¡Respuesta correcta!':own?.selected===null?'No alcanzaste a responder.':'Esta vez no acertaste.'} +${own?.points||0} pts</strong>`:''}<p>${esc(q.explanation)}</p>${!host?`<p class="player-round-score">Acumulado: <strong>${state.ownScore.toLocaleString('es-CL')} pts</strong> · Espera a que el presentador continúe.</p>`:''}</div>`:''}`;
  }
  function results(){
    const top=state.ranking.slice(0,3),rest=state.ranking.slice(3),me=state.ranking.find(p=>p.id===state.playerId);
    const podium=[1,0,2].map(index=>{const p=top[index];return `<div class="podium-place podium-place-${index+1}"><div class="podium-record" aria-hidden="true"><span>${p?esc(p.name.slice(0,1).toUpperCase()):'✦'}</span></div><div class="podium-player"><strong>${p?esc(p.name):'—'}</strong><span>${p?p.score.toLocaleString('es-CL')+' pts':'Sin participante'}</span></div><div class="podium-step"><span>${index+1}</span><small>${['LA LEYENDA','PURO RITMO','BUENA ONDA'][index]}</small></div></div>`;}).join('');
    return `<header class="ranking-header"><span class="live-sticker">✿ EL CONOCIMIENTO NUNCA PASA DE MODA ✿</span><h1 tabindex="-1">El podio de las <em>leyendas.</em></h1><p>${me?`Terminaste en el puesto ${me.position} de ${state.playerCount}, con ${me.score.toLocaleString('es-CL')} puntos. ¡Gracias por jugar!`:'Cinco paradas en el tiempo. Un público que hizo historia.'}</p></header><div class="results-show"><section class="podium-stage" aria-label="Podio de los tres primeros lugares"><span class="podium-star star-left" aria-hidden="true">✦</span><span class="podium-star star-right" aria-hidden="true">✿</span><div class="podium">${podium}</div><p class="podium-caption">60s & 70s · GRANDES ÉPOCAS, GRANDES MENTES</p></section><section class="remaining-ranking" aria-labelledby="remaining-title"><h2 id="remaining-title">El resto de la banda <span>${rest.length}</span></h2>${rest.length?`<ol start="4">${rest.map(p=>`<li class="${p.id===state.playerId?'ranking-you':''}"><span class="rank-position">${p.position}</span><span class="rank-name">${esc(p.name)}${p.id===state.playerId?' (tú)':''}</span><strong>${p.score.toLocaleString('es-CL')} <small>pts</small></strong></li>`).join('')}</ol>`:'<p>Todos los participantes de esta sala están en el podio.</p>'}</section></div><p class="ranking-rule">Ranking por puntaje. En empate: más aciertos, menor tiempo total de respuesta y orden de ingreso.</p>`;
  }
  function tick(){
    if(!state||state.status!=='playing'||state.phase!=='question')return;
    const now=Date.now()+offset,countdown=now<state.opensAt,remaining=Math.max(0,Math.ceil((state.deadline-now)/1000));
    const t=document.querySelector('#live-seconds');if(t)t.textContent=String(countdown?Math.ceil((state.opensAt-now)/1000):remaining);
    document.querySelector('.live-clock')?.classList.toggle('urgent',!countdown&&remaining<=5);
    const hint=document.querySelector('#live-round-hint');if(hint)hint.textContent=countdown?'Prepárense… ¡Comenzamos en unos segundos!':remaining===0?'Tiempo terminado. El presentador mostrará la respuesta.':state.role==='host'?'Responde desde tu teléfono. ¡Cada segundo cuenta!':state.ownAnswer?'¡Respuesta enviada! Mira la pantalla y espera el resultado.':pending?'Enviando tu respuesta…':'Elige una alternativa. ¡Cada segundo cuenta!';
    document.querySelectorAll('[data-live-answer]').forEach(b=>b.disabled=pending||countdown||remaining===0||Boolean(state.ownAnswer));
  }
  async function restore(){
    try{session=JSON.parse(sessionStorage.getItem(savedKey)||'null');}catch{return false;}
    if(!session?.code||!session?.token){session=null;return false;}
    setRole(session.role);active=true;
    shell('<main id="main" class="live-setup"><h1 tabindex="-1">Volviendo al show…</h1><p id="live-notice" role="status">Recuperando tu sesión.</p><button id="restore-home" class="secondary-button">Volver al inicio</button></main>');
    document.querySelector('#restore-home').addEventListener('click',onHome);await poll();return true;
  }
  document.addEventListener('keydown',e=>{if(!active||pending||state?.role!=='player'||state?.phase!=='question'||e.repeat||e.ctrlKey||e.metaKey||e.altKey||document.querySelector('dialog[open]'))return;if(/^[1-4]$/.test(e.key)){const b=document.querySelector(`[data-live-answer="${Number(e.key)-1}"]:not(:disabled)`);if(b){e.preventDefault();b.click();}}});
  return {setup,close,restore};
}
