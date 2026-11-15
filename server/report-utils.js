export const DENTAL_MODALITIES = ['Panoramic', 'Periapical', 'Bitewing'];
export const MANUAL_MODALITIES = ['CBCT', 'Hand/Wrist', 'Occlusal', 'TMJ', 'Cephalometric', 'Other'];
export const MODALITIES = [...DENTAL_MODALITIES, ...MANUAL_MODALITIES];
export const SURFACE_FINDINGS = ['enamelCaries', 'dentinalCaries'];

export const TOOTH_FINDINGS = [
  ['enamelCaries', 'Enamel caries'],
  ['dentinalCaries', 'Dentinal caries'],
  ['pulpalInvolvement', 'Pulpal involvement'],
  ['pulpoPeriapicalLesion', 'Pulpo-periapical lesion'],
  ['dentalFracture', 'Dental fracture'],
  ['retainedRoot', 'Retained root'],
  ['supernumeraryTooth', 'Supernumerary tooth'],
  ['missingTooth', 'Missing tooth'],
  ['impactedTooth', 'Impacted tooth'],
  ['radiolucency', 'Radiolucency'],
  ['radiopacity', 'Radiopacity'],
  ['boneLoss', 'Bone loss'],
  ['rootResorption', 'Root resorption'],
  ['restoration', 'Restoration'],
  ['crown', 'Crown'],
  ['implant', 'Implant'],
  ['endodonticTreatment', 'Endodontic treatment'],
  ['cysticLesion', 'Cystic lesion'],
  ['otherToothFinding', 'Other tooth finding'],
];

export const SIDE_FINDINGS = [
  ['sinusHaziness', 'Maxillary sinus haziness', 'Maxillary sinus'],
  ['stylohyoidOssification', 'Ossification of the stylohyoid ligament', 'Stylohyoid ligament'],
  ['calcifiedLymphNode', 'Calcified lymph node', 'Calcifications'],
  ['atheroscleroticPlaque', 'Atherosclerotic plaque', 'Calcifications'],
  ['sialolith', 'Sialolith', 'Calcifications'],
  ['tonsillolith', 'Tonsillolith', 'Calcifications'],
  ['triticeousCalcification', 'Triticeous cartilage calcification', 'Calcifications'],
];

export function safeJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function hasDentalRecordedFindings(state) {
  const findings = state?.findings || {};
  const toothFinding = TOOTH_FINDINGS.some(([key]) => {
    const item = findings[key] || {};
    if (key === 'supernumeraryTooth') return cleanText(item.region) || cleanText(item.description);
    return Object.keys(item.teeth || {}).length > 0;
  });
  const sides = Object.values(state?.sideFindings || {}).some((item) => item?.right || item?.left);
  const texts = ['incidentalFindings', 'otherAbnormalFindings', 'recommendations']
    .some((key) => cleanText(state?.textSections?.[key]));
  return Boolean(
    toothFinding ||
    state?.osseousFracture?.selected ||
    sides ||
    texts ||
    (state?.additionalImaging?.selected && cleanText(state.additionalImaging.text))
  );
}

export function validateManualReport(state, modality) {
  if (!MANUAL_MODALITIES.includes(modality)) return [`${modality || 'Manual'} is not a manual-report modality.`];
  const report = state?.manualReports?.[modality] || {};
  const errors = [];
  if (!cleanText(report.findings)) errors.push(`Complete ${modality} findings before finalizing.`);
  if (!cleanText(report.impression)) errors.push(`Complete ${modality} impression before finalizing.`);
  return errors;
}

export function hasRecordedFindings(state) {
  if (hasDentalRecordedFindings(state)) return true;
  return MANUAL_MODALITIES.some((name) => {
    const report = state?.manualReports?.[name];
    return cleanText(report?.findings) || cleanText(report?.impression);
  });
}

export function validateReportState(state, { final = false } = {}) {
  const errors = [];
  if (!cleanText(state?.patient?.name) && !cleanText(`${state?.patient?.firstName || ''} ${state?.patient?.lastName || ''}`)) {
    errors.push('Patient name is required.');
  }
  const modalities = Array.isArray(state?.modalities) ? state.modalities : [];
  if (!modalities.length || modalities.some((item) => !MODALITIES.includes(item))) {
    errors.push('Select at least one valid examination modality.');
  }
  if (final && modalities.some((name) => DENTAL_MODALITIES.includes(name)) && !hasDentalRecordedFindings(state)) {
    errors.push('Record at least one dental finding before finalizing the report.');
  }
  if (final) {
    for (const modality of modalities.filter((name) => MANUAL_MODALITIES.includes(name))) {
      errors.push(...validateManualReport(state, modality));
    }
  }
  if (final && state?.osseousFracture?.selected && !cleanText(state.osseousFracture.description)) {
    errors.push('Enter an osseous fracture description before finalizing.');
  }
  if (final && state?.additionalImaging?.selected && !cleanText(state.additionalImaging.text)) {
    errors.push('Enter the requested imaging and reason before finalizing.');
  }
  return errors;
}

export function parseToothId(id) {
  const match = /^(perm|primary)-(UR|UL|LR|LL)-([1-8A-E])$/.exec(id || '');
  if (!match) return null;
  return { dentition: match[1], quadrant: match[2], number: match[3] };
}

export function sideLabel(item) {
  if (item?.right && item?.left) return 'Bilateral';
  if (item?.right) return 'Right';
  if (item?.left) return 'Left';
  return '';
}

export function surfaceTextForFinding(findingKey, surfaces = {}) {
  if (!SURFACE_FINDINGS.includes(findingKey)) return '';
  const labels = { m: 'M', d: 'D', o: 'O', b: 'B', l: 'L', p: 'P', i: 'I', apical: 'AP', general: 'GEN' };
  return Object.entries(labels).filter(([key]) => surfaces?.[key]).map(([, label]) => label).join('/');
}

export function sanitizeFilename(value) {
  return (value || 'patient')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'patient';
}
