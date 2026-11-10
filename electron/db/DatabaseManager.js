// Camada better-sqlite3 — equivalente ao DatabaseManager original,
// reduzido ao CRUD usado pelos canais db:* do preload.

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Só tipos conhecidos entram no banco
function cleanKind(kind) {
  return kind === 'interview' ? 'interview' : null;
}

class DatabaseManager {
  constructor(userDataDir) {
    // Instalações da época do nome OpenPerssua mantêm o arquivo antigo
    const legacy = path.join(userDataDir, 'openperssua.db');
    const current = path.join(userDataDir, 'teka.db');
    this.dbPath = fs.existsSync(legacy) && !fs.existsSync(current) ? legacy : current;
    this.db = null;
  }

  initialize() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    // Sem isso o SQLite ignora o ON DELETE CASCADE do schema: excluir uma
    // sessão deixaria mensagens e transcrições órfãs no banco.
    this.db.pragma('foreign_keys = ON');
    this.db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    this.migrate();
    this.closeStaleSessions();
  }

  // Colunas que vieram depois do schema original. O CREATE TABLE IF NOT
  // EXISTS não mexe em tabela que já existe, então elas entram aqui.
  migrate() {
    const cols = this.db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
    // kind: 'interview' para entrevista (muda o resumo); null para o resto
    if (!cols.includes('kind')) this.db.exec('ALTER TABLE sessions ADD COLUMN kind TEXT');
  }

  // Sessões que ficaram 'active' porque o app fechou (ou travou) no meio da
  // escuta: marca como encerradas na última atividade registrada, para o
  // histórico não mostrar uma duração que cresce para sempre.
  closeStaleSessions() {
    this.db.prepare(`
      UPDATE sessions
      SET status = 'ended',
          ended_at = COALESCE(
            (SELECT MAX(ts) FROM transcriptions t WHERE t.session_id = sessions.id),
            started_at
          )
      WHERE status = 'active'
    `).run();
  }

  close() { this.db?.close(); }

  createSession({ subject, model, kind } = {}) {
    const id = crypto.randomUUID();
    this.db.prepare(
      'INSERT INTO sessions (id, started_at, subject, model, kind) VALUES (?, ?, ?, ?, ?)'
    ).run(id, Date.now(), subject || null, model || null, cleanKind(kind));
    return { id };
  }

  setKind(id, kind) {
    this.db.prepare('UPDATE sessions SET kind = ? WHERE id = ?').run(cleanKind(kind), id);
    return { ok: true };
  }

  endSession(id) {
    this.db.prepare("UPDATE sessions SET ended_at = ?, status = 'ended' WHERE id = ?")
      .run(Date.now(), id);
  }

  // Retomar: a sessão volta a 'active' e as falas novas entram nela mesma.
  // ended_at fica nulo até a próxima parada.
  resumeSession(id) {
    const info = this.db.prepare("UPDATE sessions SET ended_at = NULL, status = 'active' WHERE id = ?").run(id);
    return { ok: info.changes === 1 };
  }

  updateSubject(id, subject) {
    // Título vazio volta ao padrão da lista (null), em vez de gravar ''
    const clean = typeof subject === 'string' ? subject.trim().slice(0, 120) : '';
    this.db.prepare('UPDATE sessions SET subject = ? WHERE id = ?').run(clean || null, id);
    return { ok: true };
  }

  deleteSession(id) {
    // Mensagens e transcrições saem junto pelo ON DELETE CASCADE
    const info = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return { ok: info.changes === 1 };
  }

  clearAll() {
    // Transação: ou apaga tudo, ou nada (evita banco pela metade se falhar)
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages').run();
      this.db.prepare('DELETE FROM transcriptions').run();
      this.db.prepare('DELETE FROM sessions').run();
    })();
    return { ok: true };
  }

  getStats() {
    const row = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM sessions) AS sessions,
        (SELECT COUNT(*) FROM transcriptions) AS transcriptions,
        (SELECT COUNT(*) FROM messages) AS messages,
        (SELECT COALESCE(SUM(ended_at - started_at), 0) FROM sessions WHERE ended_at IS NOT NULL) AS totalMs
    `).get();
    return row;
  }

  addMessage({ sessionId, role, content }) {
    this.db.prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, role, content, Date.now());
  }

  addTranscription({ sessionId, source, text }) {
    this.db.prepare('INSERT INTO transcriptions (session_id, source, text, ts) VALUES (?, ?, ?, ?)')
      .run(sessionId, source, text, Date.now());
  }

  getSessionsPage({ offset = 0, limit = 20 } = {}) {
    // Contagens por sessão vêm junto: a lista do histórico mostra quantas
    // falas e respostas cada uma tem sem precisar abrir sessão por sessão.
    return this.db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM transcriptions t WHERE t.session_id = s.id) AS transcription_count,
        (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
      FROM sessions s
      ORDER BY s.started_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  getMessages(sessionId) {
    return this.db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at').all(sessionId);
  }

  getTranscriptions(sessionId) {
    return this.db.prepare('SELECT * FROM transcriptions WHERE session_id = ? ORDER BY ts').all(sessionId);
  }
}

module.exports = { DatabaseManager };
