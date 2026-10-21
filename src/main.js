import { createLiveUI } from "./live-client.js";
import bank from "./questions.json";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/outfit";
import {
  CATEGORIES,
  LEVELS,
  QUESTION_SECONDS,
  createGame,
  pointsFor,
  validateBank,
  soloWon,
} from "./quiz.js";

const app = document.querySelector("#app");
const icons = {
  arrow:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  expand:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m13 6-6 6 6 6m-6-6h13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let level = "facil";
let screen = "home";
let game = [];
let index = 0;
let results = [];
let answered = false;
let deadline = 0;
let interval;
let remaining = QUESTION_SECONDS;
const live = createLiveUI({ shell, escape, focusHeading, getLevel: () => level, onEnter: () => { clearInterval(interval); screen = "live"; }, onHome: () => renderHome(true) });

function readBest() {
  try {
    return JSON.parse(localStorage.getItem("inacap-best-v2") || "{}") || {};
  } catch {
    return {};
  }
}

function bestForLevel() {
  const value = readBest()[level];
  return Number.isFinite(value) && value >= 0 && value <= 5000 ? value : 0;
}

function saveBest(score) {
  const previous = bestForLevel();
  try {
    localStorage.setItem(
      "inacap-best-v2",
      JSON.stringify({ ...readBest(), [level]: Math.max(score, previous) }),
    );
  } catch {
    /* The quiz also works when storage is unavailable. */
  }
  return score > previous;
}

function shell(content) {
  app.innerHTML = `
    <header class="site-header">
      <a class="brand" href="/" aria-label="INACAP, volver al inicio"><img class="historic-logo" src="/logo-inacap-historico.jpg" width="147" height="207" alt="Logo histórico de INACAP, filial CORFO"></a>
      <span class="header-edition">EL PASADO TIENE MUCHO QUE CONTAR.</span>
      <button class="fullscreen-button" type="button">${icons.expand}<span>Pantalla completa</span></button>
    </header>
    ${content}
    <footer class="site-footer"><span>Una trivia para conectar generaciones.</span><span>HECHO PARA CURIOSOS <span class="footer-flower" aria-hidden="true">✳︎</span> STAND INACAP</span></footer>
    <dialog id="exit-dialog" aria-labelledby="exit-title">
      <form method="dialog"><span class="eyebrow">PAUSA EN EL VIAJE</span><h2 id="exit-title">¿Volvemos al presente?</h2><p>Se perderá el progreso de esta partida.</p><div class="dialog-actions"><button class="secondary-button" value="continue" autofocus>Seguir jugando</button><button class="primary-button" value="exit">Salir de la partida ${icons.arrow}</button></div></form>
    </dialog>`;
  const fullscreenButton = app.querySelector(".fullscreen-button");
  if (document.fullscreenElement)
    fullscreenButton.querySelector("span").textContent =
      "Salir de pantalla completa";
  if (!document.fullscreenEnabled) fullscreenButton.hidden = true;
  fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      fullscreenButton.querySelector("span").textContent = "No disponible";
    }
  });
  app.querySelector(".brand").addEventListener("click", (event) => {
    event.preventDefault();
    if (screen === "quiz" || screen === "live") confirmExit();
    else renderHome();
  });
  app.querySelector("#exit-dialog").addEventListener("close", (event) => {
    if (event.target.returnValue === "exit") renderHome();
  });
  window.scrollTo(0, 0);
}

function focusHeading() {
  document.querySelector("h1")?.focus({ preventScroll: true });
}

function renderHome(focus = false) {
  live.close();
  clearInterval(interval);
  screen = "home";
  shell(`<main id="main" class="home">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <div class="eyebrow hero-eyebrow"><span class="tiny-star" aria-hidden="true">✳︎</span> BIENVENIDOS A LOS AÑOS 60 & 70</div>
        <h1 id="hero-title" tabindex="-1">La máquina<br>del <span class="title-time">tiempo<svg viewBox="0 0 430 22" preserveAspectRatio="none" aria-hidden="true"><path d="M5 16C110 0 310 0 422 10M14 21C149 7 300 8 409 17" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg></span><span class="title-dot">.</span></h1>
        <p class="hero-description">Dos décadas que lo cambiaron todo.<br>¿Cuánto sabes de ellas? Es hora de descubrirlo.</p>
        <div class="hero-facts"><span>5 preguntas</span><span>5 categorías</span><span>Un viaje al pasado</span></div>
      </div>
      <div class="retro-art" aria-hidden="true">
        <span class="orbit-label">REBOBINA. RECUERDA. JUEGA.</span>
        <span class="art-spark spark-one">✦</span><span class="art-spark spark-two">✦</span>
        <div class="retro-disc"><div class="disc-ring"></div><div class="disc-type"><span>60<span class="decade-s">s</span></span><span class="disc-amp">&</span><span>70<span class="decade-s">s</span></span></div><span class="disc-bottom">BUENAS ÉPOCAS. GRANDES HISTORIAS.</span></div>
        <div class="flower-sticker">✿</div><span class="art-caption">EL CONOCIMIENTO NUNCA PASA DE MODA ↗</span>
      </div>
    </section>
    <section class="play-section" aria-labelledby="level-title">
      <div class="section-intro"><div><span class="eyebrow step-label">01 / ELIGE TU RITMO</span><h2 id="level-title">¿Qué tan retro eres?</h2></div><p>Tú eliges el nivel. El tiempo pone el desafío.</p></div>
      <div class="play-controls"><fieldset class="level-options"><legend class="sr-only">Elige la dificultad</legend>${LEVELS.map(
        (l) => `
        <label class="level-card ${l.id === level ? "selected" : ""}" data-level="${l.id}"><input type="radio" name="level" value="${l.id}" ${l.id === level ? "checked" : ""}><span class="level-stars" aria-hidden="true">${"✦".repeat(l.stars)}<span class="muted-star">${"✦".repeat(3 - l.stars)}</span></span><span class="level-name">${l.label}</span><span class="level-description">${l.subtitle}</span><span class="radio-indicator" aria-hidden="true"></span></label>`,
      ).join("")}</fieldset>
        <div class="start-block"><button class="primary-button start-button" id="start">¡A jugar! ${icons.arrow}</button><span class="start-note">${icons.clock} 20 segundos por pregunta</span></div>
      </div>
      <div class="group-mode"><div><span class="eyebrow">EL PÚBLICO TAMBIÉN JUEGA</span><h3>Una pantalla. Toda una generación.</h3><p>Presenta en la televisión y deja que el público se una desde el teléfono, con código o QR.</p></div><div class="group-mode-actions"><button id="host-mode" class="primary-button">Crear sala · Presentador</button><button id="join-mode" class="secondary-button">Ingresar con código</button></div></div><p class="solo-target-note">En modo individual, gana con al menos 3 respuestas correctas de 5.</p>
      <div class="best-line" id="best-line">Récord ${LEVELS.find((l) => l.id === level).label.toLowerCase()} en este dispositivo: <strong>${bestForLevel().toLocaleString("es-CL")} pts</strong></div>
    </section>
    <section class="category-section" aria-labelledby="categories-title"><div class="category-heading"><span class="eyebrow" id="categories-title">CINCO PARADAS EN EL TIEMPO</span><span>Una pregunta al azar de cada categoría.</span></div><div class="category-list">${CATEGORIES.map((c) => `<div class="category-item"><span class="category-symbol ${c.color}" aria-hidden="true">${c.symbol}</span><span>${c.label}</span></div>`).join("")}</div></section>
    <p class="demo-note"><span aria-hidden="true">✳︎</span> 75 preguntas · Cinco categorías · Tres niveles para viajar al pasado.</p>
  </main>`);
  document.querySelectorAll('input[name="level"]').forEach((input) =>
    input.addEventListener("change", () => {
      level = input.value;
      document
        .querySelectorAll(".level-card")
        .forEach((card) =>
          card.classList.toggle("selected", card.dataset.level === level),
        );
      document.querySelector("#best-line").innerHTML =
        `Récord ${LEVELS.find((l) => l.id === level).label.toLowerCase()} en este dispositivo: <strong>${bestForLevel().toLocaleString("es-CL")} pts</strong>`;
    }),
  );
  document.querySelector("#start").addEventListener("click", startGame);
  document.querySelector("#host-mode").addEventListener("click", () => live.setup("host"));
  document.querySelector("#join-mode").addEventListener("click", () => live.setup("player"));
  if (focus) focusHeading();
}

function startGame() {
  try {
    game = createGame(bank, level);
  } catch (error) {
    showError(error);
    return;
  }
  results = [];
  index = 0;
  screen = "quiz";
  renderQuestion();
}

function totalScore() {
  return results.reduce((total, r) => total + r.points, 0);
}

function confirmExit() {
  const dialog = document.querySelector("#exit-dialog");
  if (!dialog.open) dialog.showModal();
}

function renderQuestion() {
  clearInterval(interval);
  answered = false;
  remaining = QUESTION_SECONDS;
  const q = game[index];
  const category = CATEGORIES.find((c) => c.id === q.category);
  shell(`<main id="main" class="game-page">
    <div class="game-toolbar"><button class="text-button" id="exit">${icons.back} Salir de la partida</button><span class="level-pill">${"✦".repeat(LEVELS.find((l) => l.id === level).stars)} ${LEVELS.find((l) => l.id === level).label}</span><span class="score">${totalScore().toLocaleString("es-CL")} <small>PTS</small></span></div>
    <div class="game-progress" aria-label="Pregunta ${index + 1} de 5">${game.map((item, i) => `<span class="progress-segment ${i < index ? "done" : ""} ${i === index ? "current" : ""}"></span>`).join("")}</div>
    <div class="question-meta"><span class="category-badge ${category.color}"><span aria-hidden="true">${category.symbol}</span> ${category.label}</span><span class="eyebrow">PREGUNTA ${String(index + 1).padStart(2, "0")} / 05</span><span class="timer" role="timer" aria-label="Tiempo restante" aria-live="off">${icons.clock}<span id="seconds">20</span><small>s</small></span></div>
    <h1 class="question-title" tabindex="-1">${escape(q.question)}</h1>
    <p class="question-hint">Elige una respuesta. ¡Cada segundo cuenta!</p>
    <div class="answer-grid">${q.options.map((o, i) => `<button class="answer-button answer-${i}" data-answer="${i}"><span class="answer-letter" aria-hidden="true">${["▲", "◆", "●", "■"][i]}</span><span>${escape(o.text)}</span><span class="answer-key" aria-hidden="true">${i + 1}</span></button>`).join("")}</div>
    <div id="feedback" class="feedback-slot" aria-live="polite" aria-atomic="true"><p class="keyboard-hint">También puedes responder con las teclas ${q.options.map((_, i) => `<kbd>${i + 1}</kbd>`).join(" ")}</p></div>
    <p class="game-demo">Trivia INACAP · Años 60 & 70</p>
  </main>`);
  document.querySelector("#exit").addEventListener("click", confirmExit);
  document
    .querySelectorAll("[data-answer]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        answerQuestion(Number(button.dataset.answer)),
      ),
    );
  focusHeading();
  deadline = Date.now() + QUESTION_SECONDS * 1000;
  interval = setInterval(updateTime, 100);
}

function updateTime() {
  if (answered) return;
  remaining = Math.max(0, (deadline - Date.now()) / 1000);
  const seconds = document.querySelector("#seconds");
  if (seconds) seconds.textContent = String(Math.ceil(remaining));
  document.querySelector(".timer")?.classList.toggle("urgent", remaining <= 5);
  if (remaining <= 0) answerQuestion(null);
}

function answerQuestion(selected) {
  if (answered || screen !== "quiz") return;
  remaining = Math.max(0, (deadline - Date.now()) / 1000);
  if (remaining === 0) selected = null;
  answered = true;
  clearInterval(interval);
  const q = game[index];
  const correct = selected === q.answer;
  const points = pointsFor(correct, remaining);
  results.push({ question: q, selected, correct, points });
  document.querySelector(".score").innerHTML =
    `${totalScore().toLocaleString("es-CL")} <small>PTS</small>`;
  document.querySelector("#seconds").textContent = String(Math.ceil(remaining));
  document.querySelector(".question-hint").textContent =
    "La respuesta correcta aparece marcada abajo.";
  document.querySelectorAll("[data-answer]").forEach((button) => {
    const i = Number(button.dataset.answer);
    button.disabled = true;
    if (i === q.answer) {
      button.classList.add("is-correct");
      button.insertAdjacentHTML(
        "beforeend",
        `<span class="answer-result">${icons.check}<span class="sr-only">Respuesta correcta</span></span>`,
      );
    } else if (i === selected) {
      button.classList.add("is-wrong");
      button.insertAdjacentHTML(
        "beforeend",
        '<span class="answer-result" aria-label="Respuesta incorrecta">×</span>',
      );
    } else button.classList.add("is-muted");
  });
  const feedback = document.querySelector("#feedback");
  feedback.innerHTML = `<div class="feedback ${correct ? "feedback-correct" : "feedback-incorrect"}"><div><strong>${correct ? "¡Estás en la onda!" : selected === null ? "¡Se acabó el tiempo!" : "¡Un dato más para el viaje!"} <span>${correct ? `+${points} pts` : "0 pts"}</span></strong><p>${escape(q.explanation)}</p></div><button id="next" class="primary-button">${index === 4 ? "Ver resultados" : "Siguiente pregunta"} ${icons.arrow}</button></div>`;
  document.querySelector("#next").addEventListener("click", () => {
    if (index === 4) renderResults();
    else {
      index++;
      renderQuestion();
    }
  });
  document.querySelector("#next").focus({ preventScroll: true });
}

function renderResults() {
  clearInterval(interval);
  screen = "results";
  const correctCount = results.filter((r) => r.correct).length;
  const score = totalScore();
  const newBest = saveBest(score);
  const message = soloWon(correctCount) ? "¡Ganaste el desafío!" : "Perdiste este desafío.";
  shell(`<main id="main" class="results-page"><div class="results-top"><span class="eyebrow">VIAJE COMPLETADO / ${LEVELS.find((l) => l.id === level).label.toUpperCase()}</span><span class="result-flower" aria-hidden="true">✳︎</span><h1 tabindex="-1">${message}</h1><p>${soloWon(correctCount) ? "¡Meta cumplida!" : "¡Puedes volver a intentarlo!"} Para ganar necesitas al menos 3 respuestas correctas de 5.</p><div class="result-score">${score.toLocaleString("es-CL")}<span> PUNTOS</span></div><div class="result-stats"><span><strong>${correctCount} de 5</strong> respuestas correctas</span><span><strong>${newBest ? "¡Nuevo récord!" : bestForLevel().toLocaleString("es-CL") + " pts"}</strong> ${newBest ? "en este dispositivo" : "récord de este nivel"}</span></div></div>
    <div class="results-actions"><button id="replay" class="primary-button">Volver a viajar ${icons.arrow}</button><button id="home" class="secondary-button">Cambiar dificultad</button></div>
    <section class="recap" aria-labelledby="recap-title"><div class="recap-heading"><h2 id="recap-title">Tu viaje, parada a parada.</h2><span>Siempre hay algo nuevo que aprender.</span></div>${results
      .map((r) => {
        const category = CATEGORIES.find((c) => c.id === r.question.category);
        return `<details class="recap-item"><summary><span class="category-symbol ${category.color}" aria-hidden="true">${category.symbol}</span><span class="recap-category">${category.label}<small>${r.correct ? "Respuesta correcta" : r.selected === null ? "Sin responder" : "Respuesta incorrecta"}</small></span><span class="recap-points ${r.correct ? "positive" : ""}">${r.correct ? "+" + r.points : "0"} pts</span><span class="recap-expand" aria-hidden="true">+</span></summary><div class="recap-detail"><h3>${escape(r.question.question)}</h3><p>Tu respuesta: <strong>${r.selected === null ? "Se acabó el tiempo" : escape(r.question.options[r.selected].text)}</strong></p>${!r.correct ? `<p>Respuesta correcta: <strong>${escape(r.question.options[r.question.answer].text)}</strong></p>` : ""}<p>${escape(r.question.explanation)}</p></div></details>`;
      })
      .join(
        "",
      )}</section><p class="demo-note">Banco del stand · 75 preguntas.</p></main>`);
  document.querySelector("#replay").addEventListener("click", startGame);
  document
    .querySelector("#home")
    .addEventListener("click", () => renderHome(true));
  focusHeading();
}

function showError(error) {
  clearInterval(interval);
  screen = "error";
  shell(
    `<main id="main" class="error-page"><span class="eyebrow">REVISEMOS LA MÁQUINA</span><h1 tabindex="-1">Falta una pieza del viaje.</h1><p>El banco de preguntas necesita una revisión antes de jugar.</p><p>${escape(error.message)}</p></main>`,
  );
  focusHeading();
}

document.addEventListener("keydown", (event) => {
  if (
    screen !== "quiz" ||
    answered ||
    event.repeat ||
    document.querySelector("dialog[open]") ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return;
  if (/^[1-4]$/.test(event.key) && Number(event.key) <= game[index].options.length) {
    event.preventDefault();
    answerQuestion(Number(event.key) - 1);
  }
});

document.addEventListener("fullscreenchange", () => {
  const label = document.querySelector(".fullscreen-button span");
  if (label)
    label.textContent = document.fullscreenElement
      ? "Salir de pantalla completa"
      : "Pantalla completa";
});

try {
  validateBank(bank);
  const invitation = new URLSearchParams(location.search).get("sala");
  if (invitation) live.setup("player", invitation);
  else live.restore().then(restored => { if (!restored) renderHome(); });
} catch (error) {
  showError(error);
}
