// Camada better-sqlite3 — equivalente ao DatabaseManager original,
// reduzido ao CRUD usado pelos canais db:* do preload.

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class DatabaseManager {
  constructor(userDataDir) {
    this.dbPath = path.join(userDataDir, 'openperssua.db');
    this.db = null;
  }

  initialize() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  }

  close() { this.db?.close(); }

  createSession({ subject, model } = {}) {
    const id = crypto.randomUUID();
    this.db.prepare(
      'INSERT INTO sessions (id, started_at, subject, model) VALUES (?, ?, ?, ?)'
    ).run(id, Date.now(), subject || null, model || null);
    return { id };
  }

  endSession(id) {
    this.db.prepare("UPDATE sessions SET ended_at = ?, status = 'ended' WHERE id = ?")
      .run(Date.now(), id);
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
    return this.db.prepare(
      'SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset);
  }

  getMessages(sessionId) {
    return this.db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at').all(sessionId);
  }

  getTranscriptions(sessionId) {
    return this.db.prepare('SELECT * FROM transcriptions WHERE session_id = ? ORDER BY ts').all(sessionId);
  }
}

module.exports = { DatabaseManager };
