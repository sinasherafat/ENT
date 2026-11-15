import express from 'express';
import multer from 'multer';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, tokenHash, verifyPassword } from './database.js';
import { createStore } from './store.js';
import { createAssetStore } from './asset-store.js';
import { MANUAL_MODALITIES, cleanText, safeJson, sanitizeFilename, validateManualReport, validateReportState } from './report-utils.js';
import { streamReportPdf } from './pdf.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const bundledLogoPath = join(rootDir, 'public', 'assets', 'clinic-logo.png');

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...parts] = trimmed.split('=');
    if (!(key in process.env)) process.env[key] = parts.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
}

loadEnvFile(join(rootDir, '.env'));
const hosted = Boolean(process.env.VERCEL);
const dataDir = resolve(process.env.DATA_DIR || join(rootDir, 'data'));
const uploadsDir = resolve(process.env.UPLOADS_DIR || join(rootDir, 'uploads', 'radiographs'));
const brandingDir = resolve(process.env.BRANDING_DIR || join(rootDir, 'uploads', 'branding'));
if (!hosted) {
  mkdirSync(uploadsDir, { recursive: true });
  mkdirSync(brandingDir, { recursive: true });
}

const store = createStore(join(dataDir, 'clinic.sqlite'));
const assets = createAssetStore({ uploadsDir, brandingDir });
const ready = store.initialize(process.env.INITIAL_ADMIN_USERNAME, process.env.INITIAL_ADMIN_PASSWORD);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(async (req, res, next) => {
  try { await ready; next(); } catch (error) { next(error); }
});
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; frame-src 'self' blob:; object-src 'self' blob:; base-uri 'self'; form-action 'self'");
  next();
});
app.use(express.json({ limit: '4mb' }));
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-site request rejected.' });
  } catch {
    return res.status(403).json({ error: 'Invalid request origin.' });
  }
  next();
});

function parseCookies(req) {
  const result = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

async function userFromRequest(req) {
  const token = parseCookies(req).clinic_session;
  if (!token) return null;
  return store.getSession(tokenHash(token), new Date().toISOString());
}

async function requireAuth(req, res, next) {
  try {
    const user = await userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Authentication required.' });
    req.user = user;
    next();
  } catch (error) { next(error); }
}

function reportRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    patientName: row.patient_name,
    patientId: row.patient_id,
    examinationDate: row.examination_date,
    modalities: safeJson(row.modalities_json, []),
    state: safeJson(row.state_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finalizedAt: row.finalized_at,
  };
}

function imageRow(image) {
  return {
    id: image.id, modality: image.modality, originalName: image.original_name, mimeType: image.mime_type,
    sizeBytes: image.size_bytes, createdAt: image.created_at, url: `/api/images/${image.id}`,
  };
}

const loginAttempts = new Map();
function loginAllowed(ip) {
  const now = Date.now();
  const attempts = (loginAttempts.get(ip) || []).filter((time) => now - time < 10 * 60 * 1000);
  loginAttempts.set(ip, attempts);
  return attempts.length < 10;
}

async function issueSession(user, res) {
  const token = randomBytes(32).toString('base64url');
  const hours = Math.max(1, Math.min(72, Number(process.env.SESSION_HOURS) || 12));
  const expires = new Date(Date.now() + hours * 3600_000);
  await store.createSession({ token_hash: tokenHash(token), user_id: user.id, expires_at: expires.toISOString(), created_at: new Date().toISOString() });
  res.cookie('clinic_session', token, { httpOnly: true, sameSite: 'strict', secure: hosted || process.env.NODE_ENV === 'production', maxAge: hours * 3600_000, path: '/' });
}

function isLoopbackRequest(req) {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function hasValidImageSignature(file) {
  const bytes = file?.buffer?.subarray(0, 12) || Buffer.alloc(0);
  const png = bytes.length >= 8 && bytes.toString('hex', 0, 8) === '89504e470d0a1a0a';
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return (file?.mimetype === 'image/png' && png) || (file?.mimetype === 'image/jpeg' && jpeg);
}

app.get('/health', (req, res) => res.json({ ok: true, persistence: hosted ? 'vercel-blob-private' : 'sqlite-local' }));

app.get('/api/branding', async (req, res) => {
  const settings = await store.getSettings();
  res.json({
    clinicianName: settings.clinician_name, professionalTitle: settings.professional_title,
    centerDescriptor: settings.center_descriptor, address: settings.address, telephone: settings.telephone,
    email: settings.email, registrationNumber: settings.registration_number, website: settings.website,
    footerText: settings.footer_text, hasLogo: Boolean(settings.logo_path || existsSync(bundledLogoPath)),
  });
});

app.get('/api/branding/logo', async (req, res) => {
  const settings = await store.getSettings();
  const custom = settings.logo_path ? await assets.read(settings.logo_path, brandingDir) : null;
  const data = custom || (existsSync(bundledLogoPath) ? readFileSync(bundledLogoPath) : null);
  if (!data) return res.status(404).end();
  res.type(custom ? (settings.logo_mime || 'image/png') : 'image/png').send(data);
});

app.get('/api/session', async (req, res) => {
  const user = await userFromRequest(req);
  const userCount = await store.countUsers();
  res.json({ authenticated: Boolean(user), user: user ? { id: user.id, username: user.username } : null, setupRequired: userCount === 0 });
});

app.post('/api/setup', async (req, res) => {
  if (!isLoopbackRequest(req)) return res.status(403).json({ error: 'Initial setup is available only on this computer.' });
  if (await store.countUsers() > 0) return res.status(409).json({ error: 'Initial setup has already been completed.' });
  const username = cleanText(req.body?.username);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const confirmation = typeof req.body?.confirmation === 'string' ? req.body.confirmation : '';
  if (username.length < 3 || username.length > 64) return res.status(400).json({ error: 'Administrator username must be between 3 and 64 characters.' });
  if (password.length < 12) return res.status(400).json({ error: 'Administrator password must contain at least 12 characters.' });
  if (password !== confirmation) return res.status(400).json({ error: 'Password confirmation does not match.' });
  const { salt, hash } = hashPassword(password);
  const user = await store.createUser(username, hash, salt, new Date().toISOString());
  await issueSession(user, res);
  res.status(201).json({ user });
});

app.post('/api/login', async (req, res) => {
  if (!loginAllowed(req.ip)) return res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
  const username = cleanText(req.body?.username);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const user = await store.findUser(username);
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    loginAttempts.get(req.ip).push(Date.now());
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  loginAttempts.delete(req.ip);
  await issueSession(user, res);
  res.json({ user: { id: user.id, username: user.username } });
});

app.post('/api/logout', requireAuth, async (req, res) => {
  const token = parseCookies(req).clinic_session;
  if (token) await store.deleteSession(tokenHash(token));
  res.clearCookie('clinic_session', { path: '/' });
  res.status(204).end();
});

app.get('/api/settings', requireAuth, async (req, res) => {
  const row = await store.getSettings();
  res.json({
    clinicianName: row.clinician_name, professionalTitle: row.professional_title,
    centerDescriptor: row.center_descriptor, address: row.address, telephone: row.telephone,
    email: row.email, registrationNumber: row.registration_number, website: row.website,
    footerText: row.footer_text, hasLogo: Boolean(row.logo_path || existsSync(bundledLogoPath)), updatedAt: row.updated_at,
  });
});

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: hosted ? 4 * 1024 * 1024 : 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, ['image/png', 'image/jpeg'].includes(file.mimetype)),
});

app.put('/api/settings', requireAuth, logoUpload.single('logo'), async (req, res) => {
  if (req.file && !hasValidImageSignature(req.file)) return res.status(400).json({ error: 'The clinic logo must be a valid PNG or JPEG image.' });
  const current = await store.getSettings();
  const values = {
    clinicianName: cleanText(req.body.clinicianName) || current.clinician_name,
    professionalTitle: cleanText(req.body.professionalTitle) || current.professional_title,
    centerDescriptor: cleanText(req.body.centerDescriptor) || current.center_descriptor,
    address: cleanText(req.body.address) || current.address,
    telephone: cleanText(req.body.telephone) || current.telephone,
    email: cleanText(req.body.email), registrationNumber: cleanText(req.body.registrationNumber),
    website: cleanText(req.body.website), footerText: cleanText(req.body.footerText) || current.footer_text,
  };
  const uploadedLogo = req.file ? await assets.saveLogo(req.file) : null;
  const now = new Date().toISOString();
  const updated = await store.updateSettings({
    ...current, clinician_name: values.clinicianName, professional_title: values.professionalTitle,
    center_descriptor: values.centerDescriptor, address: values.address, telephone: values.telephone,
    email: values.email, registration_number: values.registrationNumber, website: values.website,
    footer_text: values.footerText, logo_path: uploadedLogo || current.logo_path,
    logo_mime: req.file?.mimetype || current.logo_mime, updated_at: now,
  });
  if (uploadedLogo && current.logo_path && current.logo_path !== uploadedLogo) await assets.remove(current.logo_path, brandingDir);
  res.json({ ...values, hasLogo: Boolean(updated.logo_path || existsSync(bundledLogoPath)), updatedAt: now });
});

app.get('/api/reports', requireAuth, async (req, res) => {
  const rows = await store.listReports(req.user.id, cleanText(req.query.q));
  res.json(rows.map((row) => ({
    id: row.id, status: row.status, patientName: row.patient_name, patientId: row.patient_id,
    examinationDate: row.examination_date, modalities: safeJson(row.modalities_json, []), updatedAt: row.updated_at,
  })));
});

app.post('/api/reports', requireAuth, async (req, res) => {
  const state = req.body?.state || {};
  const errors = validateReportState(state);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(), owner_id: req.user.id, status: 'draft', patient_name: cleanText(state.patient.name),
    patient_id: cleanText(state.patient.id), examination_date: cleanText(state.patient.date),
    modalities_json: JSON.stringify(state.modalities), state_json: JSON.stringify(state), created_at: now, updated_at: now, finalized_at: null,
  };
  await store.createReport(row);
  res.status(201).json(reportRow(row));
});

app.get('/api/reports/:id', requireAuth, async (req, res) => {
  const row = await store.getReport(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Report not found.' });
  const report = reportRow(row);
  report.images = (await store.listImages(row.id)).map(imageRow);
  res.json(report);
});

app.put('/api/reports/:id', requireAuth, async (req, res) => {
  const row = await store.getReport(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Report not found.' });
  const state = req.body?.state || {};
  const errors = validateReportState(state);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  const updated = {
    ...row, status: 'draft', patient_name: cleanText(state.patient.name), patient_id: cleanText(state.patient.id),
    examination_date: cleanText(state.patient.date), modalities_json: JSON.stringify(state.modalities),
    state_json: JSON.stringify(state), updated_at: new Date().toISOString(), finalized_at: null,
  };
  await store.replaceReport(updated);
  res.json(reportRow(updated));
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: hosted ? 4 * 1024 * 1024 : 25 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png'].includes(file.mimetype)),
});

app.post('/api/reports/:id/images', requireAuth, imageUpload.array('images', 12), async (req, res) => {
  const row = await store.getReport(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Report not found.' });
  const modality = cleanText(req.body.modality);
  if ((req.files || []).some((file) => !hasValidImageSignature(file))) return res.status(400).json({ error: 'One or more files are not valid PNG or JPEG images.' });
  if (!safeJson(row.modalities_json, []).includes(modality)) return res.status(400).json({ error: 'Upload images only for a selected modality.' });
  const now = new Date().toISOString();
  const created = [];
  for (const file of req.files || []) {
    const id = randomUUID();
    const storedName = await assets.saveRadiograph(row.id, id, file);
    const image = { id, report_id: row.id, modality, original_name: file.originalname, stored_name: storedName, mime_type: file.mimetype, size_bytes: file.size, created_at: now };
    try { await store.addImage(image); } catch (error) { await assets.remove(storedName); throw error; }
    created.push(imageRow(image));
  }
  await store.replaceReport({ ...row, updated_at: now });
  res.status(201).json(created);
});

app.get('/api/images/:id', requireAuth, async (req, res) => {
  const image = await store.getOwnedImage(req.params.id, req.user.id);
  if (!image) return res.status(404).end();
  const data = await assets.read(image.stored_name);
  if (!data) return res.status(404).end();
  res.type(image.mime_type).send(data);
});

app.delete('/api/images/:id', requireAuth, async (req, res) => {
  const image = await store.getOwnedImage(req.params.id, req.user.id);
  if (!image) return res.status(404).json({ error: 'Image not found.' });
  await store.deleteImage(image.id);
  await assets.remove(image.stored_name);
  res.status(204).end();
});

app.post('/api/reports/:id/finalize', requireAuth, async (req, res) => {
  const row = await store.getReport(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Report not found.' });
  const errors = validateReportState(safeJson(row.state_json, {}), { final: true });
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  const now = new Date().toISOString();
  const updated = { ...row, status: 'final', finalized_at: now, updated_at: now };
  await store.replaceReport(updated);
  res.json(reportRow(updated));
});

app.get('/api/reports/:id/pdf', requireAuth, async (req, res) => {
  const row = await store.getReport(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Report not found.' });
  const state = safeJson(row.state_json, {});
  const preview = req.query.preview === '1';
  const manualModality = cleanText(req.query.modality);
  if (manualModality && (!MANUAL_MODALITIES.includes(manualModality) || !state.modalities?.includes(manualModality))) {
    return res.status(400).json({ error: 'Select a valid manual-report modality for this examination.' });
  }
  const errors = manualModality
    ? [...validateReportState(state), ...(!preview ? validateManualReport(state, manualModality) : [])]
    : validateReportState(state, { final: !preview });
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  if (!preview && !manualModality) {
    const now = new Date().toISOString();
    await store.replaceReport({ ...row, status: 'final', finalized_at: row.finalized_at || now, updated_at: now });
  }
  const settings = await store.getSettings();
  const logoData = settings.logo_path ? await assets.read(settings.logo_path, brandingDir) : readFileSync(bundledLogoPath);
  const images = await store.listImages(row.id);
  const includeImages = req.query.includeImages === '1' || state.includeRadiographsInPdf === true;
  if (includeImages) for (const image of images) image.data = await assets.read(image.stored_name);
  const reportLabel = manualModality ? `${sanitizeFilename(manualModality)}-report` : 'diagnostic-imaging-report';
  const filename = `${sanitizeFilename(state.patient?.name)}-${sanitizeFilename(state.patient?.date)}-${reportLabel}.pdf`;
  res.type('application/pdf');
  res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="${filename}"`);
  streamReportPdf({ response: res, state, settings, images, logoData, draft: preview, includeImages, manualModality });
});

app.use(express.static(join(rootDir, 'public'), { extensions: ['html'] }));
app.use((req, res) => res.sendFile(join(rootDir, 'public', 'index.html')));
app.use((error, req, res, next) => {
  console.error(error);
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.message });
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'The server could not complete this request.' });
});

const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || '127.0.0.1';
if (!hosted && process.env.NODE_ENV !== 'test') {
  app.listen(port, host, async () => {
    console.log(`Dental radiology clinic app running at http://${host}:${port}`);
    if (await store.countUsers() === 0) console.log('No administrator account exists. Open the local URL to complete secure first-time setup.');
  });
}

export default app;
export { app, store, rootDir };
