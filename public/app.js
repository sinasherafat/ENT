import {
  DENTAL_MODALITIES,
  MANUAL_MODALITIES,
  MODALITIES,
  MODALITY_SIDES,
  SURFACE_FINDINGS,
  TOOTH_SURFACES,
  TOOTH_FINDINGS,
  SIDE_GROUPS,
  createEmptyState,
  normalizeState,
  recordedCount,
  toothLabel,
} from './report.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const SVG_NS = 'http://www.w3.org/2000/svg';

let branding = null;
let currentUser = null;
let currentReportId = null;
let reportState = createEmptyState();
let images = [];
let activeFinding = 'enamelCaries';
let activeReportMode = 'dental';
let activeImageModality = 'Panoramic';
let activeImageId = null;
let dirty = false;
let editingPatient = false;
let previewObjectUrl = null;
let searchTimer = null;
let entryStep = 1;
let workspaceStep = 4;
let reportListCache = [];
const viewer = { scale: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0, originX: 0, originY: 0 };

async function api(url, options = {}) {
  const settings = { ...options, headers: { ...(options.headers || {}) } };
  if (options.body && !(options.body instanceof FormData) && typeof options.body !== 'string') {
    settings.body = JSON.stringify(options.body);
    settings.headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, settings);
  if (response.status === 401 && !url.endsWith('/login')) {
    showLogin();
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status}).`);
  return payload;
}

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast${type ? ` toast--${type}` : ''}`;
  node.textContent = message;
  $('#toastRegion').append(node);
  setTimeout(() => node.remove(), 4200);
}

function setDirty(value = true) {
  dirty = value;
  const indicator = $('#saveIndicator');
  indicator.className = 'save-indicator';
  indicator.textContent = value ? 'Unsaved changes' : 'Saved';
  if (!value) indicator.classList.add('is-saved');
}

function showSaving() {
  const indicator = $('#saveIndicator');
  indicator.className = 'save-indicator is-saving';
  indicator.textContent = 'Saving…';
}

function showView(id) {
  ['entryView', 'reportsView', 'settingsView', 'workspaceView'].forEach((viewId) => {
    $(`#${viewId}`).hidden = viewId !== id;
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showLogin() {
  currentUser = null;
  $('#appView').hidden = true;
  $('#loginView').hidden = false;
}

function configureAuthScreen(setupRequired) {
  $('#setupForm').hidden = !setupRequired;
  $('#loginForm').hidden = setupRequired;
  $('#signInHeading').textContent = setupRequired ? 'Set up this clinic app' : 'Sign in';
  $('#authIntro').textContent = setupRequired
    ? 'Create the first administrator account to protect patient records and continue.'
    : 'Access patient examinations and saved reports.';
}

function showApp() {
  $('#loginView').hidden = true;
  $('#appView').hidden = false;
}

async function loadBranding() {
  branding = await api('/api/branding');
  $('#clinicName').textContent = branding.clinicianName;
  $('#appClinicName').textContent = branding.clinicianName;
  $('#loginTitle').textContent = branding.professionalTitle;
  $('#loginCenter').textContent = branding.centerDescriptor;
  for (const prefix of ['login', 'app', 'settings']) {
    const img = $(`#${prefix}LogoImage`);
    const fallback = $(`#${prefix}LogoFallback`);
    if (!img || !fallback) continue;
    if (branding.hasLogo) {
      img.src = `/api/branding/logo?v=${Date.now()}`;
      img.hidden = false;
      fallback.hidden = true;
    } else {
      img.hidden = true;
      fallback.hidden = false;
    }
  }
}

function modalityChoice(name, checked = false) {
  const label = document.createElement('label');
  label.className = 'choice-card';
  label.dataset.modality = name;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.value = name;
  input.checked = checked;
  const text = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = name;
  const small = document.createElement('small');
  const descriptions = {
    Panoramic: 'Full-arch overview', Periapical: 'Focused tooth and periapical review', Bitewing: 'Interproximal and crestal review',
    CBCT: 'Three-dimensional examination', 'Hand/Wrist': 'Skeletal and bone-age assessment', Occlusal: 'Occlusal projection', TMJ: 'Temporomandibular joint examination',
    Cephalometric: 'Orthodontic cephalometric examination', Other: 'Another documented modality',
  };
  small.textContent = descriptions[name];
  text.append(strong, small);
  const details = document.createElement('span');
  details.className = 'choice-card__details';
  details.hidden = !checked;
  const side = document.createElement('select');
  side.className = 'modality-side';
  side.setAttribute('aria-label', `${name} side`);
  const current = reportState.modalityDetails?.[name] || {};
  for (const value of MODALITY_SIDES) {
    const option = document.createElement('option'); option.value = value; option.textContent = value;
    option.selected = (current.side || 'Not applicable') === value; side.append(option);
  }
  details.append(side);
  if (name === 'Other') {
    const other = document.createElement('input'); other.className = 'modality-other'; other.placeholder = 'Specify modality'; other.value = current.label || '';
    details.append(other);
  }
  input.addEventListener('change', () => { details.hidden = !input.checked; });
  label.append(input, text, details);
  return label;
}

function updateProgress(root, step) {
  $$('[data-progress-step]', root).forEach((item) => {
    const value = Number(item.dataset.progressStep);
    item.classList.toggle('is-current', value === step);
    item.classList.toggle('is-complete', value < step);
    const badge = $('span', item);
    badge.textContent = value < step ? '✓' : String(value);
  });
}

function renderEntryStep(step = entryStep) {
  entryStep = Math.max(1, Math.min(3, step));
  $$('[data-entry-step]').forEach((section) => { section.hidden = Number(section.dataset.entryStep) !== entryStep; });
  const headings = ['Patient information', 'Medical and dental history', 'Examination modalities'];
  const descriptions = [
    'Create a complete patient record before continuing to clinical history.',
    'Record only information supplied by the patient or referring clinician.',
    'Select every imaging modality and document its side before opening the reporting workspace.',
  ];
  $('#entryStepLabel').textContent = `Step ${entryStep} of 7 · ${editingPatient ? 'Edit examination' : 'New examination'}`;
  $('#entryStepHeading').textContent = headings[entryStep - 1];
  $('#entryStepDescription').textContent = descriptions[entryStep - 1];
  $('#entryPreviousButton').hidden = entryStep === 1;
  $('#entryNextButton').hidden = entryStep === 3;
  $('#entrySubmitButton').hidden = entryStep !== 3;
  updateProgress($('#entryView'), entryStep);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function populatePatientForm() {
  const form = $('#patientForm');
  for (const [key, value] of Object.entries(reportState.patient)) {
    if (form.elements[key]) form.elements[key].value = value || '';
  }
  if (!reportState.patient.firstName && reportState.patient.name) {
    const parts = reportState.patient.name.trim().split(/\s+/);
    form.elements.firstName.value = parts.shift() || '';
    form.elements.lastName.value = parts.join(' ');
  }
  for (const [key, value] of Object.entries(reportState.history || {})) {
    if (form.elements[key]) form.elements[key].value = value || '';
  }
  for (const [key, value] of Object.entries(reportState.history.conditions || {})) {
    if (form.elements[key]) form.elements[key].checked = Boolean(value);
  }
  const choices = $('#entryModalities');
  choices.replaceChildren(...MODALITIES.map((name) => modalityChoice(name, reportState.modalities.includes(name))));
  $('#patientFormError').hidden = true;
  renderEntryStep(entryStep);
}

function newExamination() {
  if (dirty && !window.confirm('Start a new examination and discard unsaved changes?')) return;
  currentReportId = null;
  reportState = createEmptyState();
  images = [];
  activeFinding = 'enamelCaries';
  activeReportMode = 'dental';
  activeImageId = null;
  dirty = false;
  editingPatient = false;
  entryStep = 1;
  workspaceStep = 4;
  populatePatientForm();
  showView('entryView');
}

function usedRemovedModalities(nextModalities) {
  const removed = reportState.modalities.filter((name) => !nextModalities.includes(name));
  return removed.filter((name) => {
    const imageUse = images.some((image) => image.modality === name);
    const toothUse = Object.values(reportState.findings).some((item) => item.modalities?.includes(name));
    const sideUse = Object.values(reportState.sideFindings).some((item) => item.modalities?.includes(name));
    const fractureUse = reportState.osseousFracture.modalities?.includes(name);
    const manualUse = Object.values(reportState.manualReports?.[name] || {}).some((value) => typeof value === 'string' && value.trim() && value !== 'Not applicable');
    return imageUse || toothUse || sideUse || fractureUse || manualUse;
  });
}

async function handlePatientSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $('#patientFormError');
  error.hidden = true;
  const modalities = $$('input[type="checkbox"]:checked', $('#entryModalities')).map((input) => input.value);
  if (!form.reportValidity()) return;
  if (!modalities.length) {
    error.textContent = 'Select at least one examination modality.';
    error.hidden = false;
    return;
  }
  const blocked = usedRemovedModalities(modalities);
  if (editingPatient && blocked.length) {
    error.textContent = `Cannot remove ${blocked.join(', ')} while it has uploaded images or linked findings. Remove or reassign those items first.`;
    error.hidden = false;
    return;
  }
  const firstName = form.elements.firstName.value.trim();
  const lastName = form.elements.lastName.value.trim();
  reportState.patient = {
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    id: form.elements.id.value.trim(),
    birthDate: form.elements.birthDate.value,
    age: form.elements.age.value.trim(),
    sex: form.elements.sex.value,
    phone: form.elements.phone.value.trim(),
    date: form.elements.date.value,
    referringClinician: form.elements.referringClinician.value.trim(),
    additionalNotes: form.elements.additionalNotes.value.trim(),
  };
  reportState.history = {
    chiefComplaint: form.elements.chiefComplaint.value.trim(),
    clinicalIndication: form.elements.clinicalIndication.value.trim(),
    dentalHistory: form.elements.dentalHistory.value.trim(),
    medicalHistory: form.elements.medicalHistory.value.trim(),
    surgicalHistory: form.elements.surgicalHistory.value.trim(),
    medications: form.elements.medications.value.trim(),
    allergies: form.elements.allergies.value.trim(),
    symptoms: form.elements.symptoms.value.trim(),
    previousImaging: form.elements.previousImaging.value.trim(),
    notes: form.elements.historyNotes.value.trim(),
    conditions: Object.fromEntries(['pregnancy', 'diabetes', 'hypertension', 'cardiacDisease', 'bleedingDisorder', 'malignancy', 'radiotherapy']
      .map((key) => [key, form.elements[key].checked])),
  };
  reportState.modalities = modalities;
  reportState.modalityDetails = Object.fromEntries(modalities.map((name) => {
    const card = $(`[data-modality="${name}"]`, $('#entryModalities'));
    return [name, { side: $('.modality-side', card).value, label: $('.modality-other', card)?.value.trim() || '' }];
  }));
  for (const name of modalities.filter((modality) => MANUAL_MODALITIES.includes(modality))) {
    const selectedSide = reportState.modalityDetails[name]?.side || 'Not applicable';
    if (!reportState.manualReports[name].side || reportState.manualReports[name].side === 'Not applicable') {
      reportState.manualReports[name].side = selectedSide;
    }
  }
  activeReportMode = modalities.some((name) => DENTAL_MODALITIES.includes(name))
    ? 'dental'
    : (modalities.find((name) => MANUAL_MODALITIES.includes(name)) || 'dental');
  activeImageModality = modalities.includes(activeImageModality) ? activeImageModality : modalities[0];
  try {
    showSaving();
    const report = currentReportId
      ? await api(`/api/reports/${currentReportId}`, { method: 'PUT', body: { state: reportState } })
      : await api('/api/reports', { method: 'POST', body: { state: reportState } });
    currentReportId = report.id;
    reportState = normalizeState(report.state);
    editingPatient = false;
    setDirty(false);
    renderWorkspace();
    workspaceStep = 4;
    renderWorkspaceStep(4);
    showView('workspaceView');
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
}

function syncWorkspaceFields() {
  reportState.osseousFracture.selected = $('#osseousToggle').checked;
  reportState.osseousFracture.description = $('#osseousDescription').value;
  reportState.textSections.incidentalFindings = $('#incidentalFindings').value;
  reportState.textSections.otherAbnormalFindings = $('#otherAbnormalFindings').value;
  reportState.textSections.recommendations = $('#recommendations').value;
  reportState.additionalImaging.selected = $('#additionalImagingToggle').checked;
  reportState.additionalImaging.text = $('#additionalImagingText').value;
  reportState.includeRadiographsInPdf = $('#includeRadiographs').checked;
}

async function saveCurrentReport({ quiet = false } = {}) {
  syncWorkspaceFields();
  showSaving();
  try {
    const report = currentReportId
      ? await api(`/api/reports/${currentReportId}`, { method: 'PUT', body: { state: reportState } })
      : await api('/api/reports', { method: 'POST', body: { state: reportState } });
    currentReportId = report.id;
    reportState = normalizeState(report.state);
    setDirty(false);
    if (!quiet) toast('Draft saved securely.', 'success');
    return true;
  } catch (err) {
    setDirty(true);
    toast(err.message, 'error');
    return false;
  }
}

function renderWorkspaceHeader() {
  const patient = reportState.patient;
  $('#workspacePatientName').textContent = patient.name;
  $('#workspacePatientMeta').textContent = [patient.id && `File ${patient.id}`, patient.age && `Age ${patient.age}`, patient.date, patient.referringClinician && `Referred by ${patient.referringClinician}`].filter(Boolean).join('  ·  ');
  $('#workspaceModalities').replaceChildren(...reportState.modalities.map((name) => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    const detail = reportState.modalityDetails?.[name];
    tag.textContent = `${detail?.label || name}${detail?.side && detail.side !== 'Not applicable' ? ` · ${detail.side}` : ''}`;
    return tag;
  }));
}

function renderImageTabs() {
  const tabs = $('#imageModalityTabs');
  tabs.replaceChildren(...reportState.modalities.map((name) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${name} (${images.filter((item) => item.modality === name).length})`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(name === activeImageModality));
    button.addEventListener('click', () => {
      activeImageModality = name;
      const first = images.find((item) => item.modality === name);
      activeImageId = first?.id || null;
      renderImages();
    });
    return button;
  }));
}

function renderImages() {
  renderImageTabs();
  const list = images.filter((image) => image.modality === activeImageModality);
  if (!list.some((image) => image.id === activeImageId)) activeImageId = list[0]?.id || null;
  const selected = list.find((image) => image.id === activeImageId);
  const img = $('#viewerImage');
  const empty = $('#viewerEmpty');
  if (selected) {
    img.src = selected.url;
    img.alt = `${selected.modality} radiograph: ${selected.originalName}`;
    img.hidden = false;
    empty.hidden = true;
  } else {
    img.hidden = true;
    img.removeAttribute('src');
    empty.hidden = false;
  }
  const strip = $('#imageThumbnails');
  strip.replaceChildren(...list.map((image) => {
    const thumb = document.createElement('div');
    thumb.className = `thumbnail${image.id === activeImageId ? ' is-active' : ''}`;
    thumb.title = image.originalName;
    const thumbImage = document.createElement('img');
    thumbImage.src = image.url;
    thumbImage.alt = image.originalName;
    thumbImage.addEventListener('click', () => { activeImageId = image.id; renderImages(); });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${image.originalName}`);
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!window.confirm(`Remove ${image.originalName}?`)) return;
      try {
        await api(`/api/images/${image.id}`, { method: 'DELETE' });
        images = images.filter((item) => item.id !== image.id);
        if (activeImageId === image.id) activeImageId = null;
        renderImages();
        toast('Image removed.', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });
    thumb.append(thumbImage, remove);
    return thumb;
  }));
}

async function uploadImages(files) {
  if (!files.length) return;
  if (!currentReportId && !(await saveCurrentReport({ quiet: true }))) return;
  const formData = new FormData();
  formData.append('modality', activeImageModality);
  [...files].forEach((file) => formData.append('images', file));
  try {
    const created = await api(`/api/reports/${currentReportId}/images`, { method: 'POST', body: formData });
    images.push(...created);
    activeImageId = created[0]?.id || activeImageId;
    renderImages();
    toast(`${created.length} image${created.length === 1 ? '' : 's'} added to ${activeImageModality}.`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

function applyViewerTransform() {
  $('#viewerImage').style.transform = `translate(${viewer.x}px, ${viewer.y}px) scale(${viewer.scale})`;
}

function fitViewerImage() {
  const img = $('#viewerImage');
  if (img.hidden || !img.naturalWidth) return;
  const rect = $('#imageViewer').getBoundingClientRect();
  viewer.scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight) * .96;
  viewer.x = 0;
  viewer.y = 0;
  img.style.width = `${img.naturalWidth}px`;
  img.style.height = `${img.naturalHeight}px`;
  applyViewerTransform();
}

function zoomViewer(factor) {
  viewer.scale = Math.min(8, Math.max(.05, viewer.scale * factor));
  applyViewerTransform();
}

function toothType(number, primary = false) {
  if (primary) {
    if (number === 'A' || number === 'B') return 'incisor';
    if (number === 'C') return 'canine';
    return 'molar';
  }
  if (number === '1' || number === '2') return 'incisor';
  if (number === '3') return 'canine';
  if (number === '4' || number === '5') return 'premolar';
  return 'molar';
}

function toothPath(number, primary = false) {
  const type = toothType(number, primary);
  const scale = primary ? .78 : 1;
  const paths = {
    incisor: 'M -12 18 Q -18 12 -15 -2 L -8 -48 Q 0 -61 8 -48 L 15 -2 Q 18 12 12 18 Q 0 26 -12 18 Z',
    canine: 'M -13 18 Q -19 10 -14 -3 L -5 -66 Q 0 -78 5 -66 L 14 -3 Q 19 10 13 18 Q 0 29 -13 18 Z',
    premolar: 'M -15 17 Q -21 9 -16 -3 L -9 -48 Q -4 -59 0 -45 Q 4 -59 9 -48 L 16 -3 Q 21 9 15 17 Q 0 28 -15 17 Z',
    molar: 'M -20 16 Q -25 7 -19 -4 L -21 -43 Q -17 -57 -10 -42 L -7 -10 L -2 -48 Q 2 -61 6 -45 L 9 -10 L 17 -43 Q 24 -51 21 -35 L 19 -4 Q 25 7 20 16 Q 0 29 -20 16 Z',
  };
  return { path: paths[type], type, scale };
}

function makeSvg(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function createModalitySchematic(modality, compact = false) {
  const wrapper = document.createElement('div');
  wrapper.className = `modality-schematic${compact ? ' modality-schematic--compact' : ''}`;
  const svg = makeSvg('svg', { viewBox: '0 0 160 90', role: 'img', 'aria-label': `${modality} schematic` });
  const title = makeSvg('title'); title.textContent = `${modality} schematic`;
  svg.append(title);
  const line = (x1, y1, x2, y2, extra = {}) => makeSvg('line', { x1, y1, x2, y2, stroke: '#6d3a8a', 'stroke-width': 3, 'stroke-linecap': 'round', ...extra });
  const path = (d, extra = {}) => makeSvg('path', { d, fill: 'none', stroke: '#6d3a8a', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...extra });
  const circle = (cx, cy, r, extra = {}) => makeSvg('circle', { cx, cy, r, fill: '#eff8f3', stroke: '#68aa89', 'stroke-width': 3, ...extra });
  if (modality === 'Panoramic') {
    svg.append(path('M20 35 Q80 4 140 35'), path('M24 54 Q80 82 136 54'));
    for (let i = 0; i < 10; i += 1) svg.append(circle(32 + i * 11, 44 + Math.abs(i - 4.5) * 1.2, 4, { fill: '#fff' }));
  } else if (modality === 'Periapical') {
    for (let i = 0; i < 3; i += 1) svg.append(path(`M${51 + i * 27} 22 Q${61 + i * 27} 12 ${71 + i * 27} 22 L${68 + i * 27} 49 L${64 + i * 27} 75 L${59 + i * 27} 49 Z`, { fill: '#f4eff8' }));
    svg.append(path('M34 72 Q80 58 126 72', { stroke: '#68aa89' }));
  } else if (modality === 'Bitewing') {
    svg.append(makeSvg('rect', { x: 18, y: 12, width: 124, height: 66, rx: 10, fill: '#f7f3f9', stroke: '#8fa6d9', 'stroke-width': 3 }), line(26, 45, 134, 45, { stroke: '#68aa89' }));
    for (let i = 0; i < 5; i += 1) {
      svg.append(path(`M${34 + i * 22} 18 L${31 + i * 22} 38 Q${39 + i * 22} 45 ${47 + i * 22} 38 L${44 + i * 22} 18`));
      svg.append(path(`M${34 + i * 22} 72 L${31 + i * 22} 52 Q${39 + i * 22} 45 ${47 + i * 22} 52 L${44 + i * 22} 72`));
    }
  } else if (modality === 'CBCT') {
    svg.append(makeSvg('rect', { x: 38, y: 19, width: 57, height: 48, fill: '#f4eff8', stroke: '#6d3a8a', 'stroke-width': 3 }), path('M38 19 L61 9 L118 9 L95 19 M95 19 L118 9 L118 57 L95 67 M118 57 L95 67 L38 67'));
    svg.append(circle(67, 43, 14, { fill: 'none' }), line(67, 25, 67, 61, { stroke: '#68aa89', 'stroke-width': 2 }), line(49, 43, 85, 43, { stroke: '#68aa89', 'stroke-width': 2 }));
  } else if (modality === 'Hand/Wrist') {
    svg.append(path('M55 75 L49 46 L45 21 M59 47 L57 12 M66 45 L70 8 M73 46 L83 14 M79 51 L97 25 M55 75 Q76 84 95 64 L91 44 Q85 36 79 51 L73 46 L66 45 L59 47 L49 46'));
    for (const [x, y] of [[46, 20], [57, 12], [70, 9], [83, 15], [97, 26], [62, 65], [78, 65]]) svg.append(circle(x, y, 3, { fill: '#8fa6d9', stroke: 'none' }));
  } else if (modality === 'Occlusal') {
    svg.append(path('M21 48 Q80 7 139 48 Q80 85 21 48 Z', { fill: '#f4eff8' }), path('M39 48 Q80 25 121 48 Q80 67 39 48 Z', { stroke: '#68aa89' }));
    for (let i = 0; i < 7; i += 1) svg.append(circle(47 + i * 11, 47, 4, { fill: '#fff' }));
  } else if (modality === 'TMJ') {
    svg.append(path('M39 65 Q26 43 40 23 Q56 8 71 27 Q80 41 66 56 Q53 71 39 65'), path('M121 65 Q134 43 120 23 Q104 8 89 27 Q80 41 94 56 Q107 71 121 65'));
    svg.append(circle(58, 34, 7), circle(102, 34, 7), line(65, 68, 95, 68, { stroke: '#8fa6d9' }));
  } else if (modality === 'Cephalometric') {
    svg.append(path('M57 14 Q97 4 112 31 Q120 47 104 62 L88 64 Q80 78 64 69 Q49 61 47 44 Q45 26 57 14'));
    svg.append(line(21, 45, 139, 45, { stroke: '#68aa89', 'stroke-width': 2 }), line(80, 8, 80, 82, { stroke: '#8fa6d9', 'stroke-width': 2 }), circle(91, 34, 3, { fill: '#6d3a8a', stroke: 'none' }));
  } else {
    svg.append(makeSvg('rect', { x: 28, y: 15, width: 104, height: 60, rx: 8, fill: '#f7f3f9', stroke: '#6d3a8a', 'stroke-width': 3 }), circle(80, 45, 18), circle(80, 45, 8, { fill: '#8fa6d9' }), line(38, 67, 61, 50, { stroke: '#68aa89' }), line(99, 50, 122, 67, { stroke: '#68aa89' }));
  }
  wrapper.append(svg);
  return wrapper;
}

function allChartTeeth(mode = reportState.chartMode) {
  const teeth = [];
  for (const quadrant of ['UR', 'UL', 'LR', 'LL']) {
    for (let number = 1; number <= 8; number += 1) teeth.push(`perm-${quadrant}-${number}`);
    if (mode === 'mixed') for (const letter of ['A', 'B', 'C', 'D', 'E']) teeth.push(`primary-${quadrant}-${letter}`);
  }
  return teeth;
}

function toothPosition(id) {
  const [, dentition, quadrant, number] = /^(perm|primary)-(UR|UL|LR|LL)-([1-8A-E])$/.exec(id);
  const upper = quadrant.startsWith('U');
  const leftOnScreen = quadrant.endsWith('R');
  if (dentition === 'perm') {
    const index = Number(number) - 1;
    const x = (leftOnScreen ? 362 : 398) + (leftOnScreen ? -1 : 1) * index * 42;
    return { x, y: upper ? 112 : 408, rotation: upper ? 0 : 180, primary: false, upper };
  }
  const index = ['A', 'B', 'C', 'D', 'E'].indexOf(number);
  const x = (leftOnScreen ? 360 : 400) + (leftOnScreen ? -1 : 1) * index * 50;
  return { x, y: upper ? 214 : 306, rotation: upper ? 0 : 180, primary: true, upper };
}

function toggleTooth(id) {
  if (activeFinding === 'supernumeraryTooth') {
    toast('Use the region and description fields for a supernumerary tooth.');
    return;
  }
  const teeth = reportState.findings[activeFinding].teeth;
  if (teeth[id]) delete teeth[id];
  else teeth[id] = SURFACE_FINDINGS.includes(activeFinding)
    ? Object.fromEntries(TOOTH_SURFACES.map(([key]) => [key, false]))
    : {};
  setDirty();
  renderDentalChart();
  renderFindingButtons();
  renderActiveFindingEditor();
}

function renderDentalChart() {
  const container = $('#dentalChart');
  const svg = makeSvg('svg', { viewBox: '0 0 760 520', role: 'group', 'aria-label': `${reportState.chartMode === 'mixed' ? 'Primary and mixed' : 'Permanent'} four-quadrant dentition chart` });
  svg.append(makeSvg('line', { x1: 380, y1: 18, x2: 380, y2: 502, class: 'chart-axis' }));
  svg.append(makeSvg('line', { x1: 34, y1: 260, x2: 726, y2: 260, class: 'chart-axis' }));
  const labels = [
    [74, 247, 'PATIENT RIGHT'], [686, 247, 'PATIENT LEFT'],
    [92, 42, 'UPPER RIGHT · 1–8'], [668, 42, 'UPPER LEFT · 1–8'],
    [92, 495, 'LOWER RIGHT · 1–8'], [668, 495, 'LOWER LEFT · 1–8'],
  ];
  for (const [x, y, value] of labels) {
    const label = makeSvg('text', { x, y, class: 'quadrant-label' });
    label.textContent = value;
    svg.append(label);
  }
  if (reportState.chartMode === 'mixed') {
    const primaryUpper = makeSvg('text', { x: 380, y: 157, class: 'dentition-row-label' }); primaryUpper.textContent = 'PRIMARY A–E';
    const primaryLower = makeSvg('text', { x: 380, y: 370, class: 'dentition-row-label' }); primaryLower.textContent = 'PRIMARY A–E';
    svg.append(primaryUpper, primaryLower);
  }
  const currentTeeth = reportState.findings[activeFinding]?.teeth || {};
  for (const id of allChartTeeth()) {
    const [, dentition, , number] = /^(perm|primary)-(UR|UL|LR|LL)-([1-8A-E])$/.exec(id);
    const config = reportState.toothConfig[id] || { visible: true, status: 'erupted' };
    const pos = toothPosition(id);
    const group = makeSvg('g', {
      class: `tooth-control${currentTeeth[id] ? ' is-selected' : ''}${config.status === 'unerupted' ? ' is-unerupted' : ''}${config.visible === false ? ' is-hidden' : ''}`,
      transform: `translate(${pos.x} ${pos.y})`,
      tabindex: '0', role: 'button',
      'aria-label': `${toothLabel(id)}${config.status === 'unerupted' ? ', unerupted or developing' : ''}`,
      'aria-pressed': String(Boolean(currentTeeth[id])),
    });
    const shape = toothPath(number, dentition === 'primary');
    group.classList.add(`tooth--${shape.type}`, dentition === 'primary' ? 'tooth--primary' : 'tooth--permanent');
    const path = makeSvg('path', { d: shape.path, class: 'tooth-shape', transform: `rotate(${pos.rotation}) scale(${shape.scale})` });
    const text = makeSvg('text', { x: 0, y: pos.upper ? 10 : -4, class: 'tooth-number' }); text.textContent = number;
    const selectedDot = makeSvg('circle', { cx: 15, cy: pos.upper ? -15 : 15, r: 7, class: 'selection-dot' });
    const selectedCheck = makeSvg('text', { x: 15, y: pos.upper ? -12 : 18, class: 'selection-check' }); selectedCheck.textContent = '✓';
    group.append(path, text, selectedDot, selectedCheck);
    if (config.status === 'unerupted') group.append(makeSvg('circle', { cx: -15, cy: pos.upper ? -16 : 16, r: 3.5, class: 'tooth-status-dot' }));
    group.addEventListener('click', () => toggleTooth(id));
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleTooth(id); }
    });
    svg.append(group);
  }
  container.replaceChildren(svg);
  $$('[data-chart-mode]').forEach((button) => button.classList.toggle('is-active', button.dataset.chartMode === reportState.chartMode));
}

function renderFindingButtons() {
  $('#findingButtons').replaceChildren(...TOOTH_FINDINGS.map(([key, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `finding-button${key === activeFinding ? ' is-active' : ''}`;
    const name = document.createElement('span'); name.textContent = label;
    const count = document.createElement('span'); count.className = 'finding-count'; count.textContent = recordedCount(reportState.findings[key], key);
    button.append(name, count);
    button.addEventListener('click', () => {
      activeFinding = key;
      renderFindingButtons();
      renderDentalChart();
      renderActiveFindingEditor();
    });
    return button;
  }));
}

function renderModalityLinks(item, container) {
  const heading = document.createElement('p');
  heading.className = 'helper-text';
  heading.textContent = 'Optional modality association (one finding is printed only once):';
  const links = document.createElement('div');
  links.className = 'modality-links';
  for (const name of reportState.modalities.filter((modality) => DENTAL_MODALITIES.includes(modality))) {
    const label = document.createElement('label');
    label.className = 'modality-link';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = item.modalities?.includes(name);
    input.addEventListener('change', () => {
      item.modalities = input.checked ? [...new Set([...(item.modalities || []), name])] : (item.modalities || []).filter((value) => value !== name);
      setDirty();
    });
    label.append(input, document.createTextNode(name));
    links.append(label);
  }
  container.append(heading, links);
}

function labeledTextarea(labelText, value, onInput, rows = 2) {
  const label = document.createElement('label');
  label.textContent = labelText;
  const textarea = document.createElement('textarea');
  textarea.rows = rows;
  textarea.value = value || '';
  textarea.addEventListener('input', () => { onInput(textarea.value); setDirty(); });
  label.append(textarea);
  return label;
}

function renderActiveFindingEditor() {
  const editor = $('#activeFindingEditor');
  const [key, label] = TOOTH_FINDINGS.find(([findingKey]) => findingKey === activeFinding);
  const item = reportState.findings[key];
  const heading = document.createElement('h3'); heading.textContent = label;
  const helper = document.createElement('p'); helper.className = 'helper-text';
  helper.textContent = key === 'supernumeraryTooth'
    ? 'Describe the region instead of forcing an extra tooth into a normal identifier.'
    : SURFACE_FINDINGS.includes(key)
      ? 'Click teeth in the chart, then select the involved tooth surfaces.'
      : 'Click teeth in the chart. Tooth surfaces are not applicable to this finding.';
  editor.replaceChildren(heading, helper);
  if (key === 'supernumeraryTooth') {
    const region = document.createElement('label'); region.textContent = 'Region';
    const regionInput = document.createElement('input'); regionInput.value = item.region || ''; regionInput.placeholder = 'e.g., upper anterior region';
    regionInput.addEventListener('input', () => { item.region = regionInput.value; setDirty(); renderFindingButtons(); });
    region.append(regionInput);
    const description = labeledTextarea('Description', item.description, (value) => { item.description = value; renderFindingButtons(); }, 3);
    editor.append(region, description, labeledTextarea('Finding-specific note', item.note, (value) => { item.note = value; }));
    renderModalityLinks(item, editor);
    return;
  }
  const selected = Object.keys(item.teeth);
  if (!selected.length) {
    const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'No teeth selected for this finding.';
    editor.append(empty);
  } else {
    const list = document.createElement('div'); list.className = 'surface-list';
    for (const id of selected) {
      const surfaces = item.teeth[id];
      const showSurfaces = SURFACE_FINDINGS.includes(key);
      const row = document.createElement('div'); row.className = `surface-row${showSurfaces ? '' : ' surface-row--no-surfaces'}`;
      const name = document.createElement('strong'); name.textContent = toothLabel(id);
      const surfaceButtons = showSurfaces ? TOOTH_SURFACES.map(([surfaceKey, shortLabel, title]) => {
        const button = document.createElement('button'); button.type = 'button';
        button.className = `surface-toggle${surfaces[surfaceKey] ? ' is-active' : ''}`;
        button.textContent = shortLabel; button.title = title; button.setAttribute('aria-pressed', String(Boolean(surfaces[surfaceKey])));
        button.addEventListener('click', () => { surfaces[surfaceKey] = !surfaces[surfaceKey]; setDirty(); renderActiveFindingEditor(); });
        return button;
      }) : [];
      const config = document.createElement('div'); config.className = 'tooth-config';
      const configLabel = document.createElement('span'); configLabel.className = 'helper-text'; configLabel.textContent = 'Eruption status';
      const status = document.createElement('select');
      for (const [value, text] of [['erupted', 'Erupted'], ['unerupted', 'Unerupted / developing']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text;
        option.selected = (reportState.toothConfig[id]?.status || 'erupted') === value;
        status.append(option);
      }
      status.addEventListener('change', () => {
        reportState.toothConfig[id] = { visible: reportState.toothConfig[id]?.visible !== false, status: status.value };
        setDirty(); renderDentalChart();
      });
      config.append(configLabel, status);
      row.append(name, ...surfaceButtons, config);
      list.append(row);
    }
    editor.append(list);
  }
  editor.append(labeledTextarea('Finding-specific note', item.note, (value) => { item.note = value; }));
  renderModalityLinks(item, editor);
}

function renderSideGroups() {
  const root = $('#sideFindingGroups');
  root.replaceChildren(...SIDE_GROUPS.map(([groupLabel, findings]) => {
    const group = document.createElement('section'); group.className = 'finding-group';
    const heading = document.createElement('h3'); heading.textContent = groupLabel;
    group.append(heading);
    for (const [key, label] of findings) {
      const item = reportState.sideFindings[key];
      const row = document.createElement('div'); row.className = 'side-row';
      const name = document.createElement('strong'); name.textContent = label;
      const right = document.createElement('button'); right.type = 'button'; right.textContent = 'Right'; right.className = `side-button${item.right ? ' is-active' : ''}`;
      const left = document.createElement('button'); left.type = 'button'; left.textContent = 'Left'; left.className = `side-button${item.left ? ' is-active' : ''}`;
      const note = document.createElement('input'); note.value = item.note || ''; note.placeholder = 'Optional note'; note.setAttribute('aria-label', `${label} note`);
      right.addEventListener('click', () => { item.right = !item.right; setDirty(); renderSideGroups(); });
      left.addEventListener('click', () => { item.left = !item.left; setDirty(); renderSideGroups(); });
      note.addEventListener('input', () => { item.note = note.value; setDirty(); });
      row.append(name, right, left, note);
      group.append(row);
    }
    return group;
  }));
}

function selectedDentalModalities() {
  return reportState.modalities.filter((name) => DENTAL_MODALITIES.includes(name));
}

function selectedManualModalities() {
  return reportState.modalities.filter((name) => MANUAL_MODALITIES.includes(name));
}

function ensureActiveReportMode() {
  const available = [
    ...(selectedDentalModalities().length ? ['dental'] : []),
    ...selectedManualModalities(),
  ];
  if (!available.includes(activeReportMode)) activeReportMode = available[0] || 'dental';
}

function renderReportModeTabs() {
  ensureActiveReportMode();
  const root = $('#reportModeTabs');
  const modes = [
    ...(selectedDentalModalities().length ? [{ key: 'dental', label: 'Dental findings', schematic: selectedDentalModalities()[0] }] : []),
    ...selectedManualModalities().map((name) => ({ key: name, label: reportState.modalityDetails?.[name]?.label || name, schematic: name })),
  ];
  root.replaceChildren(...modes.map(({ key, label, schematic }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `report-mode-tab${key === activeReportMode ? ' is-active' : ''}`;
    button.setAttribute('aria-pressed', String(key === activeReportMode));
    button.append(createModalitySchematic(schematic, true));
    const text = document.createElement('span'); text.textContent = label;
    button.append(text);
    button.addEventListener('click', () => {
      activeReportMode = key;
      renderReportModeTabs();
      renderManualReport();
      applyReportModeVisibility();
    });
    return button;
  }));
}

function applyReportModeVisibility() {
  const onReportingStep = workspaceStep === 4;
  $('#reportModeTabs').hidden = !onReportingStep;
  $$('[data-report-mode="dental"]').forEach((section) => {
    section.hidden = !(onReportingStep && activeReportMode === 'dental');
  });
  $('#manualReportPanel').hidden = !(onReportingStep && MANUAL_MODALITIES.includes(activeReportMode));
}

function manualField(modality, labelText, key, options = {}) {
  const { textarea = false, rows = 3, required = false, placeholder = '' } = options;
  const label = document.createElement('label');
  label.textContent = `${labelText}${required ? ' *' : ''}`;
  const control = document.createElement(textarea ? 'textarea' : 'input');
  if (textarea) control.rows = rows;
  control.value = reportState.manualReports[modality]?.[key] || '';
  control.placeholder = placeholder;
  control.required = required;
  control.addEventListener('input', () => {
    reportState.manualReports[modality][key] = control.value;
    setDirty();
  });
  label.append(control);
  return label;
}

function renderManualReport() {
  const panel = $('#manualReportPanel');
  if (!MANUAL_MODALITIES.includes(activeReportMode)) {
    panel.replaceChildren();
    return;
  }
  const modality = activeReportMode;
  const report = reportState.manualReports[modality];
  const displayName = reportState.modalityDetails?.[modality]?.label || modality;
  const header = document.createElement('header'); header.className = 'manual-report-header';
  header.append(createModalitySchematic(modality));
  const headingWrap = document.createElement('div');
  const heading = document.createElement('h2'); heading.textContent = `${displayName} manual report`;
  const intro = document.createElement('p'); intro.className = 'helper-text';
  intro.textContent = 'Write a modality-appropriate narrative report. Dental chart findings are intentionally kept separate.';
  headingWrap.append(heading, intro); header.append(headingWrap);

  const form = document.createElement('div'); form.className = 'manual-report-form';
  const sideLabel = document.createElement('label'); sideLabel.textContent = 'Side';
  const side = document.createElement('select');
  const currentSide = report.side || reportState.modalityDetails?.[modality]?.side || 'Not applicable';
  for (const value of MODALITY_SIDES) {
    const option = document.createElement('option'); option.value = value; option.textContent = value; option.selected = currentSide === value; side.append(option);
  }
  side.addEventListener('change', () => { report.side = side.value; setDirty(); });
  sideLabel.append(side);
  form.append(
    sideLabel,
    manualField(modality, 'Examination type / protocol', 'examinationType', { placeholder: modality === 'CBCT' ? 'e.g., limited FOV maxilla, 0.2 mm voxel' : 'Projection or acquisition protocol' }),
    manualField(modality, 'Region examined', 'region', { placeholder: 'Anatomic region or field of view' }),
    manualField(modality, 'Clinical indication', 'clinicalIndication', { textarea: true, rows: 2 }),
    manualField(modality, 'Technique', 'technique', { textarea: true, rows: 2 }),
  );
  if (modality === 'Hand/Wrist') {
    form.append(manualField(modality, 'Skeletal / bone-age assessment', 'skeletalAssessment', { textarea: true, rows: 3, placeholder: 'Method, estimated skeletal age, maturation stage, and comparison with chronological age' }));
  }
  form.append(
    manualField(modality, 'Findings', 'findings', { textarea: true, rows: 7, required: true, placeholder: 'Describe the imaging findings.' }),
    manualField(modality, 'Impression / conclusion', 'impression', { textarea: true, rows: 5, required: true, placeholder: 'State the diagnostic impression.' }),
    manualField(modality, 'Recommendations', 'recommendations', { textarea: true, rows: 3 }),
    manualField(modality, 'Additional notes', 'notes', { textarea: true, rows: 3 }),
  );

  const actions = document.createElement('div'); actions.className = 'manual-report-actions';
  const save = document.createElement('button'); save.type = 'button'; save.className = 'button button--quiet'; save.textContent = 'Save draft'; save.addEventListener('click', () => saveCurrentReport());
  const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'button button--secondary'; preview.textContent = `Preview ${displayName} PDF`; preview.addEventListener('click', () => previewReport(modality));
  const download = document.createElement('button'); download.type = 'button'; download.className = 'button button--primary'; download.textContent = `Download ${displayName} PDF`; download.addEventListener('click', () => downloadReport(modality));
  actions.append(save, preview, download);
  panel.replaceChildren(header, form, actions);
}

function renderWorkspace() {
  renderWorkspaceHeader();
  renderImages();
  renderReportModeTabs();
  renderManualReport();
  renderDentalChart();
  renderFindingButtons();
  renderActiveFindingEditor();
  renderSideGroups();
  $('#osseousToggle').checked = reportState.osseousFracture.selected;
  $('#osseousDescription').value = reportState.osseousFracture.description || '';
  $('#osseousDescription').hidden = !reportState.osseousFracture.selected;
  $('#incidentalFindings').value = reportState.textSections.incidentalFindings || '';
  $('#otherAbnormalFindings').value = reportState.textSections.otherAbnormalFindings || '';
  $('#recommendations').value = reportState.textSections.recommendations || '';
  $('#additionalImagingToggle').checked = reportState.additionalImaging.selected;
  $('#additionalImagingText').value = reportState.additionalImaging.text || '';
  $('#additionalImagingText').hidden = !reportState.additionalImaging.selected;
  $('#includeRadiographs').checked = reportState.includeRadiographsInPdf;
  applyReportModeVisibility();
}

function reviewBlock(title, content) {
  const block = document.createElement('section'); block.className = 'review-block';
  const heading = document.createElement('h3'); heading.textContent = title;
  block.append(heading, content);
  return block;
}

function renderModalityReviewCards() {
  const grid = document.createElement('div'); grid.className = 'modality-review-grid';
  const dentalFindingCount = TOOTH_FINDINGS.reduce((sum, [key]) => sum + recordedCount(reportState.findings[key], key), 0)
    + SIDE_GROUPS.flatMap(([, findings]) => findings).filter(([key]) => reportState.sideFindings[key]?.left || reportState.sideFindings[key]?.right).length
    + (reportState.osseousFracture?.selected ? 1 : 0);
  for (const modality of reportState.modalities) {
    const card = document.createElement('article'); card.className = 'modality-review-card';
    card.append(createModalitySchematic(modality));
    const title = document.createElement('h4'); title.textContent = reportState.modalityDetails?.[modality]?.label || modality;
    const side = reportState.manualReports?.[modality]?.side || reportState.modalityDetails?.[modality]?.side;
    const meta = document.createElement('p'); meta.className = 'helper-text';
    meta.textContent = [side && side !== 'Not applicable' ? side : '', `${images.filter((item) => item.modality === modality).length} image(s)`].filter(Boolean).join(' · ');
    card.append(title, meta);
    if (DENTAL_MODALITIES.includes(modality)) {
      const summary = document.createElement('p'); summary.textContent = `${dentalFindingCount} dental finding(s) recorded in the shared dental section.`;
      const status = document.createElement('span'); status.className = `completeness-pill${dentalFindingCount ? ' is-complete' : ''}`; status.textContent = dentalFindingCount ? 'Complete' : 'Needs a finding';
      card.append(summary, status);
    } else {
      const report = reportState.manualReports[modality];
      const complete = Boolean(report.findings?.trim() && report.impression?.trim());
      const findings = document.createElement('p'); findings.textContent = report.findings?.trim() || 'No findings entered.';
      const impression = document.createElement('p'); impression.textContent = report.impression?.trim() ? `Impression: ${report.impression.trim()}` : 'No impression entered.';
      const status = document.createElement('span'); status.className = `completeness-pill${complete ? ' is-complete' : ''}`; status.textContent = complete ? 'Complete' : 'Findings and impression required';
      card.append(findings, impression, status);
    }
    grid.append(card);
  }
  return grid;
}

function renderReviewSummary() {
  syncWorkspaceFields();
  const root = $('#reviewSummary');
  const patient = document.createElement('p');
  patient.textContent = [reportState.patient.name, reportState.patient.id && `File ${reportState.patient.id}`, reportState.patient.birthDate && `Born ${reportState.patient.birthDate}`, reportState.patient.age && `Age ${reportState.patient.age}`, reportState.patient.sex, reportState.patient.phone, `Exam ${reportState.patient.date}`].filter(Boolean).join(' · ');
  const historyItems = [];
  const conditionLabels = { pregnancy: 'Pregnancy', diabetes: 'Diabetes', hypertension: 'Hypertension', cardiacDisease: 'Cardiac disease', bleedingDisorder: 'Bleeding disorder', malignancy: 'Malignancy', radiotherapy: 'Previous radiotherapy' };
  for (const [key, selected] of Object.entries(reportState.history.conditions || {})) if (selected) historyItems.push(conditionLabels[key] || key);
  for (const [key, value] of Object.entries(reportState.history)) if (key !== 'conditions' && typeof value === 'string' && value.trim()) historyItems.push(value.trim());
  const history = document.createElement('p'); history.textContent = historyItems.join(' · ') || 'No clinical history recorded.';
  const modalities = document.createElement('p'); modalities.textContent = reportState.modalities.map((name) => {
    const detail = reportState.modalityDetails?.[name] || {};
    return `${detail.label || name}${detail.side && detail.side !== 'Not applicable' ? ` (${detail.side})` : ''}`;
  }).join(', ');
  const findingsList = document.createElement('ul');
  for (const [key, label] of TOOTH_FINDINGS) {
    const item = reportState.findings[key];
    const teeth = Object.keys(item?.teeth || {});
    if (teeth.length) {
      const li = document.createElement('li'); li.textContent = `${label}: ${teeth.map(toothLabel).join(', ')}`; findingsList.append(li);
    } else if (key === 'supernumeraryTooth' && (item?.region || item?.description)) {
      const li = document.createElement('li'); li.textContent = `${label}: ${[item.region, item.description].filter(Boolean).join(' — ')}`; findingsList.append(li);
    }
  }
  for (const [, entries] of SIDE_GROUPS) {
    for (const [key, label] of entries) {
      const item = reportState.sideFindings?.[key];
      if (!item?.right && !item?.left) continue;
      const side = item.right && item.left ? 'Bilateral' : item.right ? 'Right' : 'Left';
      const li = document.createElement('li'); li.textContent = `${label}: ${side}${item.note ? ` — ${item.note}` : ''}`; findingsList.append(li);
    }
  }
  if (reportState.osseousFracture?.selected) {
    const li = document.createElement('li'); li.textContent = `Osseous fracture: ${reportState.osseousFracture.description || 'description required'}`; findingsList.append(li);
  }
  if (!findingsList.children.length) { const li = document.createElement('li'); li.textContent = 'No tooth findings recorded yet.'; findingsList.append(li); }
  const imageText = document.createElement('p'); imageText.textContent = images.length ? `${images.length} protected image${images.length === 1 ? '' : 's'} uploaded across ${new Set(images.map((item) => item.modality)).size} modality tab(s).` : 'No radiographs uploaded.';
  const notes = document.createElement('p');
  notes.textContent = [reportState.textSections?.incidentalFindings, reportState.textSections?.otherAbnormalFindings, reportState.textSections?.recommendations, reportState.additionalImaging?.selected && reportState.additionalImaging.text].filter(Boolean).join(' · ') || 'No narrative notes recorded.';
  root.replaceChildren(
    reviewBlock('Patient', patient),
    reviewBlock('History', history),
    reviewBlock('Modality review and completeness', renderModalityReviewCards()),
    reviewBlock('Selected modalities', modalities),
    reviewBlock('Recorded dental findings', findingsList),
    reviewBlock('Narrative', notes),
    reviewBlock('Images', imageText),
  );
}

function renderWorkspaceStep(step = workspaceStep) {
  workspaceStep = Math.max(4, Math.min(7, step));
  $$('[data-workspace-step]').forEach((section) => { section.hidden = Number(section.dataset.workspaceStep) !== workspaceStep; });
  updateProgress($('#workspaceView'), workspaceStep);
  $('#workspacePreviousButton').textContent = workspaceStep === 4 ? '← Edit imaging' : '← Previous';
  $('#workspaceNextButton').hidden = workspaceStep === 7;
  $$('.pdf-action').forEach((button) => { button.hidden = workspaceStep !== 7; });
  $('#includeRadiographs').closest('label').hidden = workspaceStep !== 7;
  if (workspaceStep === 6) renderReviewSummary();
  if (workspaceStep === 5) setTimeout(fitViewerImage, 0);
  applyReportModeVisibility();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadReports(query = '') {
  try {
    const rawReports = await api(`/api/reports${query ? `?q=${encodeURIComponent(query)}` : ''}`);
    reportListCache = rawReports;
    const statusFilter = $('#reportStatusFilter').value;
    const dateFilter = $('#reportDateFilter').value;
    const reports = rawReports.filter((report) => (!statusFilter || report.status === statusFilter) && (!dateFilter || report.examinationDate === dateFilter));
    const root = $('#reportList');
    if (!reports.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = query ? 'No patients match this search.' : 'No saved examinations yet.';
      root.replaceChildren(empty);
      return;
    }
    root.replaceChildren(...reports.map((report) => {
      const row = document.createElement('article'); row.className = 'report-row';
      const patient = document.createElement('div');
      const name = document.createElement('h3'); name.textContent = report.patientName;
      const file = document.createElement('small'); file.className = 'muted'; file.textContent = report.patientId ? `File ${report.patientId}` : 'No file number';
      patient.append(name, file);
      const status = document.createElement('span'); status.className = `status-pill${report.status === 'final' ? ' status-pill--final' : ''}`; status.textContent = report.status === 'final' ? 'Final report' : 'Draft';
      const details = document.createElement('div');
      const date = document.createElement('strong'); date.textContent = report.examinationDate;
      const mods = document.createElement('small'); mods.className = 'muted'; mods.textContent = report.modalities.join(', ');
      details.append(date, document.createElement('br'), mods);
      const open = document.createElement('button'); open.type = 'button'; open.className = 'button button--quiet'; open.textContent = 'Open';
      open.addEventListener('click', () => openReport(report.id));
      row.append(patient, status, details, open);
      return row;
    }));
  } catch (err) { toast(err.message, 'error'); }
}

async function openReport(id) {
  try {
    const report = await api(`/api/reports/${id}`);
    currentReportId = report.id;
    reportState = normalizeState(report.state);
    images = report.images || [];
    activeFinding = 'enamelCaries';
    activeReportMode = reportState.modalities.some((name) => DENTAL_MODALITIES.includes(name))
      ? 'dental'
      : (reportState.modalities.find((name) => MANUAL_MODALITIES.includes(name)) || 'dental');
    activeImageModality = reportState.modalities[0];
    activeImageId = images.find((image) => image.modality === activeImageModality)?.id || null;
    editingPatient = false;
    setDirty(false);
    renderWorkspace();
    workspaceStep = 4;
    renderWorkspaceStep(4);
    showView('workspaceView');
  } catch (err) { toast(err.message, 'error'); }
}

async function openSettings() {
  try {
    const settings = await api('/api/settings');
    const form = $('#settingsForm');
    Object.entries(settings).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value || ''; });
    showView('settingsView');
  } catch (err) { toast(err.message, 'error'); }
}

async function saveSettings(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  try {
    await api('/api/settings', { method: 'PUT', body: formData });
    await loadBranding();
    $('#logoInput').value = '';
    toast('Clinic settings saved.', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

function renderChartConfig() {
  const list = $('#chartConfigList');
  list.replaceChildren(...allChartTeeth().map((id) => {
    const current = reportState.toothConfig[id] || { visible: true, status: 'erupted' };
    const card = document.createElement('label'); card.className = 'config-tooth';
    const visible = document.createElement('input'); visible.type = 'checkbox'; visible.checked = current.visible !== false;
    const name = document.createElement('strong'); name.textContent = toothLabel(id);
    const status = document.createElement('select');
    for (const [value, text] of [['erupted', 'Erupted'], ['unerupted', 'Unerupted / developing']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = current.status === value; status.append(option);
    }
    const update = () => {
      reportState.toothConfig[id] = { visible: visible.checked, status: status.value };
      setDirty();
    };
    visible.addEventListener('change', update); status.addEventListener('change', update);
    card.append(visible, name, status);
    return card;
  }));
}

async function fetchPdf(preview, modality = null) {
  if (!(await saveCurrentReport({ quiet: true }))) return null;
  const include = reportState.includeRadiographsInPdf ? '1' : '0';
  const modalityQuery = modality ? `&modality=${encodeURIComponent(modality)}` : '';
  const response = await fetch(`/api/reports/${currentReportId}/pdf?preview=${preview ? '1' : '0'}&includeImages=${include}${modalityQuery}`);
  if (response.status === 401) { showLogin(); throw new Error('Your session has expired.'); }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'The PDF could not be generated.');
  }
  return { blob: await response.blob(), disposition: response.headers.get('content-disposition') || '' };
}

async function previewReport(modality = null) {
  try {
    const result = await fetchPdf(true, modality);
    if (!result) return;
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(result.blob);
    $('#previewFrame').src = previewObjectUrl;
    $('#previewDialogTitle').textContent = modality ? `${reportState.modalityDetails?.[modality]?.label || modality} Report` : 'Diagnostic Imaging Report';
    $('#previewDialog').showModal();
  } catch (err) { toast(err.message, 'error'); }
}

async function downloadReport(modality = null) {
  try {
    const result = await fetchPdf(false, modality);
    if (!result) return;
    const match = /filename="([^"]+)"/.exec(result.disposition);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(result.blob);
    link.download = match?.[1] || 'dental-radiology-report.pdf';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast(`${modality ? `${reportState.modalityDetails?.[modality]?.label || modality} ` : 'Combined '}PDF generated and downloaded.`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function initialize() {
  try {
    await loadBranding();
    const session = await api('/api/session');
    configureAuthScreen(session.setupRequired);
    if (session.authenticated) {
      currentUser = session.user;
      showApp();
      newExamination();
    } else showLogin();
  } catch (err) {
    showLogin();
    $('#loginError').textContent = err.message;
    $('#loginError').hidden = false;
  }
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('#loginError'); error.hidden = true;
  const form = event.currentTarget;
  try {
    const result = await api('/api/login', { method: 'POST', body: { username: form.elements.username.value, password: form.elements.password.value } });
    currentUser = result.user;
    form.reset();
    showApp();
    newExamination();
  } catch (err) { error.textContent = err.message; error.hidden = false; }
});

$('#setupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $('#setupError');
  error.hidden = true;
  if (!form.reportValidity()) return;
  try {
    const result = await api('/api/setup', {
      method: 'POST',
      body: {
        username: form.elements.username.value,
        password: form.elements.password.value,
        confirmation: form.elements.confirmation.value,
      },
    });
    currentUser = result.user;
    form.reset();
    configureAuthScreen(false);
    showApp();
    newExamination();
    toast('Administrator account created. Confirm the bundled clinic identity in Settings.', 'success');
    await openSettings();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

$('#logoutButton').addEventListener('click', async () => {
  if (dirty && !window.confirm('Log out with unsaved changes?')) return;
  try { await api('/api/logout', { method: 'POST' }); } catch { /* local logout still applies */ }
  currentReportId = null; reportState = createEmptyState(); images = []; dirty = false; showLogin();
});
$('#patientForm').addEventListener('submit', handlePatientSubmit);
$('#entryNextButton').addEventListener('click', () => {
  const form = $('#patientForm');
  if (entryStep === 1 && !form.reportValidity()) return;
  renderEntryStep(entryStep + 1);
});
$('#entryPreviousButton').addEventListener('click', () => renderEntryStep(entryStep - 1));
$('#newExamButton').addEventListener('click', newExamination);
$('#homeButton').addEventListener('click', async () => { showView('reportsView'); await loadReports(); });
$('#reportsButton').addEventListener('click', async () => { showView('reportsView'); await loadReports(); });
$('#settingsButton').addEventListener('click', openSettings);
$('#settingsForm').addEventListener('submit', saveSettings);
$('#editPatientButton').addEventListener('click', () => { editingPatient = true; entryStep = 1; populatePatientForm(); showView('entryView'); });
$('#saveDraftButton').addEventListener('click', () => saveCurrentReport());
$('#workspacePreviousButton').addEventListener('click', () => {
  if (workspaceStep === 4) { editingPatient = true; entryStep = 3; populatePatientForm(); showView('entryView'); return; }
  renderWorkspaceStep(workspaceStep - 1);
});
$('#workspaceNextButton').addEventListener('click', async () => {
  if (!(await saveCurrentReport({ quiet: true }))) return;
  renderWorkspaceStep(workspaceStep + 1);
});
$('#previewButton').addEventListener('click', () => previewReport());
$('#downloadButton').addEventListener('click', () => downloadReport());
$('#imageInput').addEventListener('change', (event) => { uploadImages(event.target.files); event.target.value = ''; });
$('#viewerImage').addEventListener('load', fitViewerImage);
$('#zoomInButton').addEventListener('click', () => zoomViewer(1.25));
$('#zoomOutButton').addEventListener('click', () => zoomViewer(.8));
$('#fitImageButton').addEventListener('click', fitViewerImage);
$('#resetImageButton').addEventListener('click', () => { viewer.scale = 1; viewer.x = 0; viewer.y = 0; applyViewerTransform(); });
$('#imageViewer').addEventListener('wheel', (event) => { if (!$('#viewerImage').hidden) { event.preventDefault(); zoomViewer(event.deltaY < 0 ? 1.12 : .89); } }, { passive: false });
$('#imageViewer').addEventListener('pointerdown', (event) => {
  if ($('#viewerImage').hidden) return;
  viewer.dragging = true; viewer.startX = event.clientX; viewer.startY = event.clientY; viewer.originX = viewer.x; viewer.originY = viewer.y;
  event.currentTarget.setPointerCapture(event.pointerId);
});
$('#imageViewer').addEventListener('pointermove', (event) => {
  if (!viewer.dragging) return;
  viewer.x = viewer.originX + event.clientX - viewer.startX; viewer.y = viewer.originY + event.clientY - viewer.startY; applyViewerTransform();
});
$('#imageViewer').addEventListener('pointerup', () => { viewer.dragging = false; });

$$('[data-chart-mode]').forEach((button) => button.addEventListener('click', () => {
  reportState.chartMode = button.dataset.chartMode;
  setDirty(); renderDentalChart(); renderActiveFindingEditor();
}));
$('#configureChartButton').addEventListener('click', () => { renderChartConfig(); $('#chartConfigDialog').showModal(); });
$('#closeChartConfigButton').addEventListener('click', () => { $('#chartConfigDialog').close(); renderDentalChart(); });
$('#doneChartConfigButton').addEventListener('click', () => { $('#chartConfigDialog').close(); renderDentalChart(); });
$('#osseousToggle').addEventListener('change', (event) => { reportState.osseousFracture.selected = event.target.checked; $('#osseousDescription').hidden = !event.target.checked; setDirty(); });
$('#osseousDescription').addEventListener('input', () => setDirty());
['incidentalFindings', 'otherAbnormalFindings', 'recommendations'].forEach((id) => $(`#${id}`).addEventListener('input', () => setDirty()));
$('#additionalImagingToggle').addEventListener('change', (event) => { reportState.additionalImaging.selected = event.target.checked; $('#additionalImagingText').hidden = !event.target.checked; setDirty(); });
$('#additionalImagingText').addEventListener('input', () => setDirty());
$('#includeRadiographs').addEventListener('change', () => setDirty());
$('#reportSearch').addEventListener('input', (event) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadReports(event.target.value.trim()), 250); });
$('#reportStatusFilter').addEventListener('change', () => loadReports($('#reportSearch').value.trim()));
$('#reportDateFilter').addEventListener('change', () => loadReports($('#reportSearch').value.trim()));
$('#closePreviewButton').addEventListener('click', () => $('#previewDialog').close());
$('#previewDialog').addEventListener('close', () => { $('#previewFrame').src = 'about:blank'; if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; });
$('#logoInput').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const img = $('#settingsLogoImage'); img.src = URL.createObjectURL(file); img.hidden = false; $('#settingsLogoFallback').hidden = true;
});
window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });

initialize();
