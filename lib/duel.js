import { randomBytes, createHash } from 'node:crypto';
import { createGame, QUESTION_SECONDS, pointsFor, LEVELS } from '../src/quiz.js';

export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const hash = token => createHash('sha256').update(token).digest('hex');
export const roomPath = code => `rooms/${code}.json`;
export const newToken = () => randomBytes(24).toString('hex');
export const newCode = () => randomBytes(5).toString('hex').toUpperCase();
const nameFor = (name, fallback) => String(name || fallback).trim().slice(0, 20) || fallback;
export function createRoom(bank, level, name, token, code, now = Date.now()) {
  if (!LEVELS.some(l => l.id === level)) throw new GameError('Elige un nivel válido.');
  return { code, level, status: 'lobby', phase: 'waiting', revision: 0,
    expiresAt: now + 60 * 60 * 1000, index: 0, opensAt: null, deadline: null,
    questions: createGame(bank, level), players: [{ name: nameFor(name, 'Jugador 1'), tokenHash: hash(token), score: 0, correct: 0 }],
    rounds: [], ready: [] };
}
export function playerIndex(room, token) {
  if (typeof token !== 'string' || token.length !== 48) throw new GameError('Vuelve a entrar a la sala desde este teléfono.', 401);
  const i = room.players.findIndex(p => p.tokenHash === hash(token));
  if (i < 0) throw new GameError('No perteneces a esta sala.', 403);
  return i;
}
function beginRound(room, now) {
  room.phase = 'question'; room.opensAt = now + 3000;
  room.deadline = room.opensAt + QUESTION_SECONDS * 1000;
  room.rounds[room.index] = [null, null]; room.ready = [];
}
function finishRound(room) {
  room.phase = 'feedback';
  if (room.index === 4) room.status = 'finished';
}
function recordAnswer(room, player, selected, now) {
  const q = room.questions[room.index];
  const correct = selected !== null && selected === q.answer;
  const points = pointsFor(correct, (room.deadline - now) / 1000);
  room.rounds[room.index][player] = { selected, correct, points };
  room.players[player].score += points;
  if (correct) room.players[player].correct++;
}
export function settleTimeout(room, now) {
  if (room.status !== 'playing' || room.phase !== 'question' || now < room.deadline) return false;
  for (let i = 0; i < 2; i++) if (!room.rounds[room.index][i]) recordAnswer(room, i, null, room.deadline);
  finishRound(room); return true;
}
export function applyAction(room, action, input, token, now = Date.now()) {
  if (room.expiresAt <= now) throw new GameError('La sala expiró. Crea una nueva.', 410);
  if (action === 'join') {
    const existing = room.players.findIndex(p => p.tokenHash === hash(token));
    if (existing >= 0) return existing;
    if (room.status !== 'lobby' || room.players.length === 2) throw new GameError('La sala ya está completa o la partida comenzó.', 409);
    room.players.push({ name: nameFor(input.name, 'Jugador 2'), tokenHash: hash(token), score: 0, correct: 0 });
    return 1;
  }
  const player = playerIndex(room, token);
  settleTimeout(room, now);
  if (action === 'state') return player;
  if (action === 'leave') { if (room.status !== 'finished') room.status = 'cancelled'; return player; }
  if (action === 'start') {
    if (player !== 0) throw new GameError('El creador de la sala inicia la partida.', 403);
    if (room.status !== 'lobby') return player;
    if (room.players.length !== 2) throw new GameError('Espera al segundo jugador.');
    room.status = 'playing'; beginRound(room, now); return player;
  }
  if (action === 'answer') {
    if (room.status === 'finished') return player;
    if (room.status !== 'playing') throw new GameError('Esta partida no está activa.', 409);
    if (input.index !== room.index) throw new GameError('La pregunta cambió. Espera la actualización.', 409);
    if (room.phase !== 'question' || room.rounds[room.index][player]) return player;
    if (now < room.opensAt) throw new GameError('La pregunta comienza en unos segundos.');
    if (!Number.isInteger(input.selected) || input.selected < 0 || input.selected >= room.questions[room.index].options.length) throw new GameError('Elige una alternativa válida.');
    recordAnswer(room, player, input.selected, now);
    if (room.rounds[room.index].every(Boolean)) finishRound(room);
    return player;
  }
  if (action === 'next') {
    if (room.status !== 'playing' || room.phase !== 'feedback' || input.index !== room.index) return player;
    if (!room.ready.includes(player)) room.ready.push(player);
    if (room.ready.length === 2) { room.index++; beginRound(room, now); }
    return player;
  }
  throw new GameError('Acción no válida.');
}
export function roomView(room, player, now = Date.now()) {
  const q = room.questions[room.index];
  const revealed = room.phase === 'feedback' || room.status === 'finished';
  const answers = room.rounds[room.index] || [null, null];
  const winner = room.status !== 'finished' ? null : room.players[0].score === room.players[1].score ? 'tie' : room.players[0].score > room.players[1].score ? 0 : 1;
  const view = { code: room.code, level: room.level, status: room.status, phase: room.phase,
    revision: room.revision, player, index: room.index, opensAt: room.opensAt, deadline: room.deadline, serverNow: now,
    ready: room.ready, expiresAt: room.expiresAt, winner,
    players: room.players.map((p, i) => ({ name: p.name, score: revealed ? p.score : p.score - (answers[i]?.points || 0), correct: revealed ? p.correct : p.correct - (answers[i]?.correct ? 1 : 0), answered: Boolean(answers[i]) })),
    ownAnswer: answers[player] ? { selected: answers[player].selected, ...(revealed ? answers[player] : {}) } : null };
  if (room.status === 'playing' || room.status === 'finished') {
    view.question = { question: q.question, category: q.category, options: q.options.map(o => o.text) };
    if (revealed) Object.assign(view.question, { answer: q.answer, explanation: q.explanation });
  }
  if (room.status === 'finished') view.recap = room.questions.map((item, i) => ({ question: item.question, category: item.category, answer: item.options[item.answer].text, explanation: item.explanation, own: room.rounds[i][player] }));
  return view;
}
