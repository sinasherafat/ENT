import { openDatabase, bootstrapAdmin, hashPassword, pruneSessions } from './database.js';

const DEFAULT_SETTINGS = {
  id: 1,
  clinician_name: 'Dr. Mahjube Entezar-e-Ghaem',
  professional_title: 'Oral & Maxillofacial Radiologist',
  center_descriptor: 'Oral & Maxillofacial Radiology Center',
  address: 'No. 23, Alley 26, Shahid Ghandi Blvd., Safaeiyeh, Yazd, Iran',
  telephone: '+98 35 3834 6654',
  email: '',
  registration_number: '',
  website: 'www.drentezareghaem.ir',
  footer_text: 'Confidential clinical report',
  logo_path: null,
  logo_mime: null,
  updated_at: new Date().toISOString(),
};

function initialState() {
  return {
    version: 1,
    nextUserId: 1,
    users: [],
    sessions: [],
    reports: [],
    images: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

class SqliteStore {
  constructor(filePath) {
    this.db = openDatabase(filePath);
  }

  async initialize(username, password) {
    bootstrapAdmin(this.db, username, password);
    pruneSessions(this.db);
  }

  async countUsers() { return this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count; }
  async getSession(tokenHash, now) {
    return this.db.prepare(`SELECT users.id, users.username, sessions.expires_at
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(tokenHash, now) || null;
  }
  async createUser(username, passwordHash, passwordSalt, createdAt) {
    const result = this.db.prepare('INSERT INTO users (username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?)')
      .run(username, passwordHash, passwordSalt, createdAt);
    return { id: Number(result.lastInsertRowid), username };
  }
  async findUser(username) { return this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) || null; }
  async createSession(session) {
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(session.token_hash, session.user_id, session.expires_at, session.created_at);
  }
  async deleteSession(hash) { this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash); }
  async getSettings() { return this.db.prepare('SELECT * FROM clinic_settings WHERE id = 1').get(); }
  async updateSettings(settings) {
    this.db.prepare(`UPDATE clinic_settings SET clinician_name = ?, professional_title = ?, center_descriptor = ?,
      address = ?, telephone = ?, email = ?, registration_number = ?, website = ?, footer_text = ?, logo_path = ?, logo_mime = ?, updated_at = ? WHERE id = 1`)
      .run(settings.clinician_name, settings.professional_title, settings.center_descriptor, settings.address,
        settings.telephone, settings.email, settings.registration_number, settings.website, settings.footer_text,
        settings.logo_path, settings.logo_mime, settings.updated_at);
    return this.getSettings();
  }
  async listReports(ownerId, query = '') {
    const q = query.toLowerCase();
    return this.db.prepare('SELECT * FROM reports WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100').all(ownerId)
      .filter((row) => !q || row.patient_name.toLowerCase().includes(q) || row.patient_id.toLowerCase().includes(q));
  }
  async createReport(row) {
    this.db.prepare(`INSERT INTO reports (id, owner_id, status, patient_name, patient_id, examination_date,
      modalities_json, state_json, created_at, updated_at, finalized_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.id, row.owner_id, row.status, row.patient_name, row.patient_id, row.examination_date,
        row.modalities_json, row.state_json, row.created_at, row.updated_at, row.finalized_at);
    return row;
  }
  async getReport(id, ownerId) { return this.db.prepare('SELECT * FROM reports WHERE id = ? AND owner_id = ?').get(id, ownerId) || null; }
  async replaceReport(row) {
    this.db.prepare(`UPDATE reports SET status = ?, patient_name = ?, patient_id = ?, examination_date = ?,
      modalities_json = ?, state_json = ?, updated_at = ?, finalized_at = ? WHERE id = ? AND owner_id = ?`)
      .run(row.status, row.patient_name, row.patient_id, row.examination_date, row.modalities_json,
        row.state_json, row.updated_at, row.finalized_at, row.id, row.owner_id);
    return this.getReport(row.id, row.owner_id);
  }
  async listImages(reportId) { return this.db.prepare('SELECT * FROM images WHERE report_id = ? ORDER BY modality, created_at').all(reportId); }
  async addImage(image) {
    this.db.prepare(`INSERT INTO images (id, report_id, modality, original_name, stored_name, mime_type, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(image.id, image.report_id, image.modality, image.original_name,
      image.stored_name, image.mime_type, image.size_bytes, image.created_at);
    return image;
  }
  async getOwnedImage(id, ownerId) {
    return this.db.prepare(`SELECT images.* FROM images JOIN reports ON reports.id = images.report_id
      WHERE images.id = ? AND reports.owner_id = ?`).get(id, ownerId) || null;
  }
  async deleteImage(id) { this.db.prepare('DELETE FROM images WHERE id = ?').run(id); }
}

class BlobStore {
  constructor() {
    this.pathname = 'clinic-data/application-state.json';
    this.blob = null;
  }

  async sdk() {
    if (!this.blob) this.blob = await import('@vercel/blob');
    return this.blob;
  }

  async read() {
    const { get } = await this.sdk();
    const result = await get(this.pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return { state: initialState(), etag: null };
    const text = await new Response(result.stream).text();
    return { state: { ...initialState(), ...JSON.parse(text) }, etag: result.blob.etag };
  }

  async mutate(mutator) {
    const { put } = await this.sdk();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { state, etag } = await this.read();
      const result = await mutator(state);
      try {
        await put(this.pathname, JSON.stringify(state), {
          access: 'private',
          contentType: 'application/json',
          allowOverwrite: Boolean(etag),
          ...(etag ? { ifMatch: etag } : {}),
        });
        return result;
      } catch (error) {
        if (!/Precondition|already exists|412|conflict/i.test(`${error?.name || ''} ${error?.message || ''}`) || attempt === 5) throw error;
      }
    }
    throw new Error('Persistent state could not be updated.');
  }

  async initialize(username, password) {
    await this.mutate((state) => {
      state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
      state.sessions = (state.sessions || []).filter((session) => session.expires_at > new Date().toISOString());
      if (!state.users.length && username && password?.length >= 12) {
        const { salt, hash } = hashPassword(password);
        state.users.push({ id: state.nextUserId++, username: username.trim(), password_hash: hash, password_salt: salt, created_at: new Date().toISOString() });
      }
    });
  }
  async countUsers() { return (await this.read()).state.users.length; }
  async getSession(hash, now) {
    const state = (await this.read()).state;
    const session = state.sessions.find((item) => item.token_hash === hash && item.expires_at > now);
    if (!session) return null;
    const user = state.users.find((item) => item.id === session.user_id);
    return user ? { id: user.id, username: user.username, expires_at: session.expires_at } : null;
  }
  async createUser(username, passwordHash, passwordSalt, createdAt) {
    return this.mutate((state) => {
      if (state.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) throw new Error('Username already exists.');
      const user = { id: state.nextUserId++, username, password_hash: passwordHash, password_salt: passwordSalt, created_at: createdAt };
      state.users.push(user);
      return { id: user.id, username: user.username };
    });
  }
  async findUser(username) { return (await this.read()).state.users.find((user) => user.username.toLowerCase() === username.toLowerCase()) || null; }
  async createSession(session) { return this.mutate((state) => { state.sessions = state.sessions.filter((item) => item.token_hash !== session.token_hash); state.sessions.push(session); }); }
  async deleteSession(hash) { return this.mutate((state) => { state.sessions = state.sessions.filter((item) => item.token_hash !== hash); }); }
  async getSettings() { return { ...DEFAULT_SETTINGS, ...(await this.read()).state.settings }; }
  async updateSettings(settings) { return this.mutate((state) => { state.settings = { ...settings }; return state.settings; }); }
  async listReports(ownerId, query = '') {
    const q = query.toLowerCase();
    return (await this.read()).state.reports.filter((row) => row.owner_id === ownerId && (!q || row.patient_name.toLowerCase().includes(q) || row.patient_id.toLowerCase().includes(q)))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 100);
  }
  async createReport(row) { return this.mutate((state) => { state.reports.push(row); return row; }); }
  async getReport(id, ownerId) { return (await this.read()).state.reports.find((row) => row.id === id && row.owner_id === ownerId) || null; }
  async replaceReport(row) { return this.mutate((state) => { const index = state.reports.findIndex((item) => item.id === row.id && item.owner_id === row.owner_id); if (index < 0) return null; state.reports[index] = row; return row; }); }
  async listImages(reportId) { return (await this.read()).state.images.filter((image) => image.report_id === reportId).sort((a, b) => a.created_at.localeCompare(b.created_at)); }
  async addImage(image) { return this.mutate((state) => { state.images.push(image); return image; }); }
  async getOwnedImage(id, ownerId) {
    const state = (await this.read()).state;
    const image = state.images.find((item) => item.id === id);
    return image && state.reports.some((report) => report.id === image.report_id && report.owner_id === ownerId) ? image : null;
  }
  async deleteImage(id) { return this.mutate((state) => { state.images = state.images.filter((item) => item.id !== id); }); }
}

export function createStore(filePath) {
  return process.env.VERCEL ? new BlobStore() : new SqliteStore(filePath);
}
