import { get, put, del, BlobPreconditionFailedError } from '@vercel/blob';
import bank from '../src/questions.json' with { type: 'json' };
import { GameError, createRoom, applyAction, roomView, roomPath, newToken, newCode } from '../lib/duel.js';

export const config = { maxDuration: 30 };
export function makeHandler(storage = { get, put, del }) {
async function readRoom(code) {
  const result = await storage.get(roomPath(code), { access: 'private', useCache: false });
  if (!result) throw new GameError('No encontramos esa sala. Revisa el código.', 404);
  return { room: await new Response(result.stream).json(), etag: result.blob.etag };
}
return async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'GET' && req.query?.health === '1') {
    try { await storage.get('health/connectivity.json', { access: 'private', useCache: false }); return res.status(200).json({ duel: 'ready' }); }
    catch { return res.status(503).json({ duel: 'unavailable' }); }
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Usa POST.' }); }
  if (Number(req.headers['content-length'] || 0) > 2048) return res.status(413).json({ error: 'Solicitud demasiado grande.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object') throw new GameError('Faltan los datos de la sala.');
    const { action } = body;
    if (action === 'create') {
      const token = newToken();
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = newCode(); const room = createRoom(bank, body.level, body.name, token, code);
        try {
          await storage.put(roomPath(code), JSON.stringify(room), { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
          return res.status(201).json({ ...roomView(room, 0), token });
        } catch (error) { if (error.name === 'BlobPathnameConflictError') continue; throw error; }
      }
      throw new GameError('No pudimos crear la sala. Inténtalo otra vez.', 503);
    }
    const code = String(body.code || '').trim().toUpperCase();
    if (!/^[A-F0-9]{10}$/.test(code)) throw new GameError('El código tiene 10 letras o números.');
    const token = action === 'join' ? body.token || newToken() : body.token;
    if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) throw new GameError('La sesión no es válida. Vuelve a entrar a la sala.', 401);
    const receivedAt = Date.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const { room, etag } = await readRoom(code);
      if (room.expiresAt <= receivedAt) {
        await storage.del(roomPath(code)); throw new GameError('La sala expiró. Crea una nueva.', 410);
      }
      const before = JSON.stringify(room);
      const player = applyAction(room, action, body, token, receivedAt);
      if (JSON.stringify(room) !== before) {
        room.revision++;
        try {
          await storage.put(roomPath(code), JSON.stringify(room), { access: 'private', addRandomSuffix: false, allowOverwrite: true, ifMatch: etag, contentType: 'application/json' });
        } catch (error) { if (error instanceof BlobPreconditionFailedError) continue; throw error; }
      }
      return res.status(200).json({ ...roomView(room, player), ...(action === 'join' ? { token } : {}) });
    }
    throw new GameError('La sala está actualizándose. Inténtalo nuevamente.', 409);
  } catch (error) {
    if (!(error instanceof GameError)) console.error('duel-api', error.name, error.message);
    return res.status(error instanceof GameError ? error.status : 503).json({ error: error instanceof GameError ? error.message : 'No pudimos conectar con la sala. Inténtalo de nuevo en unos segundos.' });
  }
}

}
export default makeHandler();
