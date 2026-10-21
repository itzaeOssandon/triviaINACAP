import { CATEGORIES, LEVELS } from './quiz.js';

export function createDuelUI({ shell, escape: esc, focusHeading, getLevel, onEnter, onHome }) {
  let session = null, state = null, pollTimer, clockTimer, active = false, busy = false, offset = 0, failures = 0, generation = 0, queued = null;
  const savedKey = 'inacap-duel-v1';
  function storeSession(value) { try { value ? sessionStorage.setItem(savedKey, JSON.stringify(value)) : sessionStorage.removeItem(savedKey); } catch {} }
  function message(text) { const node = document.querySelector('#duel-notice'); if (node) node.textContent = text; }
  async function request(action, extra = {}) {
    const began = Date.now();
    const response = await fetch('/api/duel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(12000), body: JSON.stringify({ ...session, action, ...extra }) });
    let data;
    try { data = await response.json(); } catch { throw new Error('No pudimos conectar con la sala. Vuelve a intentarlo.'); }
    if (!response.ok) { const error = new Error(data.error || 'No pudimos actualizar la sala.'); error.status = response.status; throw error; }
    offset = data.serverNow - (began + Date.now()) / 2;
    return data;
  }
  function stop() { active = false; clearTimeout(pollTimer); clearInterval(clockTimer); }
  function close() {
    generation++; queued = null; stop(); const previous = session; session = null; state = null; storeSession(null);
    if (previous) fetch('/api/duel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...previous, action: 'leave' }), keepalive: true }).catch(() => {});
  }
  function setup(code = '') {
    const setupGeneration = ++generation;
    stop(); onEnter();
    shell(`<main id="main" class="duel-page"><span class="eyebrow">DOS TELÉFONOS · UN MISMO VIAJE</span><h1 tabindex="-1">Duelo de generaciones.</h1><p>Crea una sala y comparte su código. Cada jugador responde desde su teléfono. Gana quien sume más puntos; si igualan, hay empate.</p>
      <form id="duel-form"><label class="field-label" for="player-name">Tu nombre o apodo</label><input id="player-name" name="name" maxlength="20" autocomplete="nickname" placeholder="Ej.: Viajero retro">
      <div class="duel-choices"><section class="duel-card"><h2>Crea una sala</h2><p>Nivel ${LEVELS.find(l => l.id === getLevel()).label}. Cinco preguntas iguales para ambos, con 20 segundos para responder cada una.</p><button class="primary-button" id="create-room" type="button">Crear sala</button></section>
      <section class="duel-card"><h2>Únete a una sala</h2><label class="field-label" for="room-code">Código de 10 caracteres</label><input id="room-code" name="code" minlength="10" maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(code)}" placeholder="A1B2C3D4E5"><button class="secondary-button" id="join-room" type="submit">Entrar a la sala</button></section></div></form><p id="duel-notice" role="status"></p><button class="text-button" id="duel-back">Volver al inicio</button></main>`);
    const create = document.querySelector('#create-room'), join = document.querySelector('#join-room');
    async function enter(action) {
      if (busy) return; busy = true; create.disabled = join.disabled = true; message('Conectando con la sala…');
      try {
        const data = await request(action, { name: document.querySelector('#player-name').value, code: document.querySelector('#room-code').value.trim().toUpperCase(), level: getLevel() });
        if (setupGeneration !== generation) return;
        session = { code: data.code, token: data.token }; storeSession(session); active = true; state = null; applyState(data); schedule();
        history.replaceState(null, '', location.pathname);
      } catch (error) { message(error.message); create.disabled = join.disabled = false; }
      finally { busy = false; }
    }
    create.addEventListener('click', () => enter('create'));
    document.querySelector('#duel-form').addEventListener('submit', e => { e.preventDefault(); enter('join'); });
    document.querySelector('#duel-back').addEventListener('click', onHome); focusHeading();
  }
  function schedule() { clearTimeout(pollTimer); if (active) pollTimer = setTimeout(poll, Math.min(1500 * 2 ** failures, 8000)); }
  function drainQueue() {
    if (queued && active) { const command = queued; queued = null; void action(command.type, command.extra); }
  }
  async function poll() {
    if (!active) return;
    if (busy) { schedule(); return; }
    busy = true;
    try { const data = await request('state'); if (!active) return; failures = 0; applyState(data); message(''); }
    catch (error) {
      if (!active) return; failures++;
      message(error.status === 404 || error.status === 410 ? error.message : 'Conexión interrumpida. Estamos intentando reconectar. Puedes volver a entrar desde este teléfono.');
      if ([401, 403, 404, 410].includes(error.status)) { stop(); storeSession(null); }
    } finally { busy = false; drainQueue(); schedule(); }
  }
  async function action(type, extra = {}) {
    if (busy) {
      queued ||= { type, extra };
      document.querySelectorAll('[data-duel-answer], #duel-start, #duel-next').forEach(b => b.disabled = true);
      return;
    }
    busy = true;
    document.querySelectorAll('[data-duel-answer], #duel-start, #duel-next').forEach(b => b.disabled = true);
    try { const data = await request(type, extra); if (active) { state = null; applyState(data); failures = 0; } }
    catch (error) { if (active) { renderState(); message(error.message); } }
    finally { busy = false; drainQueue(); }
  }
  function applyState(data) {
    const changed = !state || state.revision !== data.revision || state.status !== data.status;
    state = data;
    if (changed) renderState();
    tick();
    if (['finished', 'cancelled'].includes(state.status)) stop();
  }
  const levelLabel = () => LEVELS.find(l => l.id === state.level).label;
  function scoreboard() {
    return `<div class="duel-scoreboard">${state.players.map((p, i) => `<div class="duel-player ${i === state.player ? 'is-you' : ''}"><span>${esc(p.name)} <small>${i === state.player ? '(tú)' : '(rival)'}</small></span><strong>${p.score.toLocaleString('es-CL')} pts</strong></div>`).join('')}</div>`;
  }
  function renderState() {
    clearInterval(clockTimer);
    let content = '';
    if (state.status === 'lobby') {
      const url = new URL(location.origin); url.searchParams.set('sala', state.code);
      content = `<span class="eyebrow">SALA DE DOS JUGADORES · ${levelLabel()}</span><h1 tabindex="-1">${state.players.length === 2 ? '¡Ya están los dos!' : 'Invita a tu rival.'}</h1><p>El segundo jugador abre esta web en su teléfono, elige «2 jugadores» e introduce el código.</p><div class="room-code" aria-label="Código de sala">${state.code}</div><div class="share-actions"><button id="duel-copy" class="secondary-button">Copiar enlace de invitación</button></div>${scoreboard()}<p>${state.players.length === 2 ? 'Ambos recibirán las mismas cinco preguntas. Cada respuesta correcta suma entre 500 y 1000 puntos según la rapidez.' : 'Esperando al segundo jugador… Mantén esta pantalla abierta.'}</p>${state.player === 0 ? `<button id="duel-start" class="primary-button" ${state.players.length < 2 ? 'disabled' : ''}>Comenzar duelo</button>` : '<p>El creador de la sala iniciará el duelo.</p>'}`;
      shellPage(content);
      document.querySelector('#duel-copy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(url.href); message('Enlace copiado. Compártelo con el segundo jugador.'); }
        catch { message(`Comparte este enlace: ${url.href}`); }
      });
      document.querySelector('#duel-start')?.addEventListener('click', () => action('start'));
    } else if (state.status === 'cancelled') {
      shellPage('<span class="eyebrow">DUELO INTERRUMPIDO</span><h1 tabindex="-1">La partida terminó antes de tiempo.</h1><p>Uno de los jugadores salió de la sala. No se asignó un ganador. Pueden crear un nuevo duelo desde el inicio.</p>');
    } else if (state.status === 'finished') {
      const outcome = state.winner === 'tie' ? '¡Empate!' : state.winner === state.player ? '¡Ganaste el duelo!' : 'Perdiste este duelo.';
      shellPage(`<span class="eyebrow">DUELO COMPLETADO · ${levelLabel()}</span><h1 tabindex="-1">${outcome}</h1><p>${state.winner === 'tie' ? 'Ambos sumaron el mismo puntaje. ¡Es hora de la revancha!' : `Ganador: ${esc(state.players[state.winner].name)}. El resultado se decide por el puntaje total.`}</p>${scoreboard()}<p>Acertaste ${state.players[state.player].correct} de 5 preguntas.</p><section class="recap"><h2>Tu viaje, pregunta a pregunta</h2>${state.recap.map(q => `<details class="recap-item"><summary>${esc(q.question)} <strong>${q.own.correct ? 'Correcta' : 'Incorrecta'} · ${q.own.points} pts</strong></summary><div class="recap-detail"><p>Respuesta correcta: <strong>${esc(q.answer)}</strong></p><p>${esc(q.explanation)}</p></div></details>`).join('')}</section>`);
    } else {
      const q = state.question, category = CATEGORIES.find(c => c.id === q.category), reveal = state.phase === 'feedback';
      const own = state.ownAnswer;
      shellPage(`<span class="eyebrow">DUELO · ${levelLabel()} · PREGUNTA ${state.index + 1} DE 5</span>${scoreboard()}<div class="duel-question-meta"><span class="category-badge ${category.color}">${category.symbol} ${category.label}</span><span class="timer" role="timer" aria-live="off"><span id="duel-seconds">20</span><small>s</small></span></div><h1 class="question-title" tabindex="-1">${esc(q.question)}</h1><p id="duel-question-hint">${reveal ? 'La respuesta correcta aparece marcada abajo.' : own ? 'Respuesta enviada. Esperando a tu rival…' : 'Elige una respuesta. ¡Cada segundo cuenta!'}</p><div class="answer-grid">${q.options.map((text, i) => `<button class="answer-button answer-${i} ${reveal && i === q.answer ? 'is-correct' : reveal && own?.selected === i ? 'is-wrong' : own?.selected === i ? 'is-selected' : ''}" data-duel-answer="${i}" ${own || reveal ? 'disabled' : ''}><span class="answer-letter" aria-hidden="true">${['▲', '◆', '●', '■'][i]}</span><span>${esc(text)}</span><span class="answer-key">${i + 1}</span>${reveal && i === q.answer ? '<span class="answer-result">✓<span class="sr-only">Respuesta correcta</span></span>' : ''}</button>`).join('')}</div>${reveal ? `<div class="feedback"><div><strong>${own?.correct ? '¡Respuesta correcta!' : own?.selected === null ? '¡Se acabó el tiempo!' : 'Esta vez no acertaste.'} ${own?.points || 0} pts</strong><p>${esc(q.explanation)}</p></div><button id="duel-next" class="primary-button" ${state.ready.includes(state.player) ? 'disabled' : ''}>${state.ready.includes(state.player) ? 'Esperando a tu rival…' : 'Siguiente pregunta'}</button></div>` : ''}`);
      document.querySelectorAll('[data-duel-answer]').forEach(b => b.addEventListener('click', () => action('answer', { index: state.index, selected: Number(b.dataset.duelAnswer) })));
      document.querySelector('#duel-next')?.addEventListener('click', () => action('next', { index: state.index }));
      clockTimer = setInterval(tick, 100);
    }
    focusHeading(); tick();
  }
  function shellPage(content) {
    shell(`<main id="main" class="duel-page">${content}<p id="duel-notice" role="status"></p><button id="duel-home" class="text-button">${state.status === 'finished' || state.status === 'cancelled' ? 'Volver al inicio' : 'Salir del duelo'}</button></main>`);
    document.querySelector('#duel-home').addEventListener('click', () => {
      if (state.status === 'playing' || state.status === 'lobby') document.querySelector('#exit-dialog').showModal();
      else onHome();
    });
  }
  function tick() {
    if (!state || state.status !== 'playing' || state.phase !== 'question') return;
    const now = Date.now() + offset, counting = now < state.opensAt;
    const seconds = Math.max(0, Math.ceil((state.deadline - now) / 1000));
    const timer = document.querySelector('#duel-seconds'); if (timer) timer.textContent = counting ? String(Math.ceil((state.opensAt - now) / 1000)) : String(seconds);
    const hint = document.querySelector('#duel-question-hint');
    if (hint) hint.textContent = counting ? 'Prepárate… La pregunta comienza en unos segundos.' : seconds === 0 ? 'Tiempo terminado. Actualizando las respuestas…' : state.ownAnswer ? 'Respuesta enviada. Esperando a tu rival…' : 'Elige una respuesta. ¡Cada segundo cuenta!';
    document.querySelectorAll('[data-duel-answer]').forEach(b => b.disabled = busy || Boolean(queued) || counting || seconds === 0 || Boolean(state.ownAnswer));
  }
  async function restore() {
    try { session = JSON.parse(sessionStorage.getItem(savedKey) || 'null'); } catch { return false; }
    if (!session?.code || !session?.token) { session = null; return false; }
    onEnter(); shell('<main id="main" class="duel-page"><h1 tabindex="-1">Volviendo a tu sala…</h1><p id="duel-notice" role="status">Conectando…</p><button id="duel-restore-back" class="secondary-button">Volver al inicio</button></main>');
    document.querySelector('#duel-restore-back').addEventListener('click', onHome);
    active = true; await poll(); return true;
  }
  document.addEventListener('keydown', e => {
    if (!active || busy || e.repeat || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]') || !state?.question || state.phase !== 'question' || state.ownAnswer) return;
    if (/^[1-4]$/.test(e.key)) document.querySelector(`[data-duel-answer="${Number(e.key) - 1}"]:not(:disabled)`)?.click();
  });
  return { setup, close, restore };
}
