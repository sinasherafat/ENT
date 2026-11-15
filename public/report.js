export const DENTAL_MODALITIES = ['Panoramic', 'Periapical', 'Bitewing'];
export const MANUAL_MODALITIES = ['CBCT', 'Hand/Wrist', 'Occlusal', 'TMJ', 'Cephalometric', 'Other'];
export const MODALITIES = [...DENTAL_MODALITIES, ...MANUAL_MODALITIES];
export const SURFACE_FINDINGS = ['enamelCaries', 'dentinalCaries'];
export const MODALITY_SIDES = ['Not applicable', 'Right', 'Left', 'Bilateral', 'Midline'];
export const TOOTH_SURFACES = [
  ['m', 'M', 'Mesial'],
  ['d', 'D', 'Distal'],
  ['o', 'O', 'Occlusal'],
  ['b', 'B', 'Buccal'],
  ['l', 'L', 'Lingual'],
  ['p', 'P', 'Palatal'],
  ['i', 'I', 'Incisal'],
  ['apical', 'AP', 'Apical'],
  ['general', 'GEN', 'General'],
];

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

export const SIDE_GROUPS = [
  ['Maxillary sinus', [['sinusHaziness', 'Maxillary sinus haziness']]],
  ['Stylohyoid ligament', [['stylohyoidOssification', 'Ossification of the stylohyoid ligament']]],
  ['Calcifications', [
    ['calcifiedLymphNode', 'Calcified lymph node'],
    ['atheroscleroticPlaque', 'Atherosclerotic plaque'],
    ['sialolith', 'Sialolith'],
    ['tonsillolith', 'Tonsillolith'],
    ['triticeousCalcification', 'Triticeous cartilage calcification'],
  ]],
];

export function emptyManualReport() {
  return {
    side: 'Not applicable', examinationType: '', region: '', clinicalIndication: '', technique: '',
    skeletalAssessment: '', findings: '', impression: '', recommendations: '', notes: '',
  };
}

export function createEmptyState(date = new Date().toISOString().slice(0, 10)) {
  const findings = Object.fromEntries(TOOTH_FINDINGS.map(([key]) => [key, {
    teeth: {},
    note: '',
    modalities: [],
    ...(key === 'supernumeraryTooth' ? { region: '', description: '' } : {}),
  }]));
  const sideFindings = Object.fromEntries(SIDE_GROUPS.flatMap(([, items]) => items).map(([key]) => [key, {
    right: false,
    left: false,
    note: '',
    modalities: [],
  }]));
  return {
    version: 4,
    patient: {
      firstName: '', lastName: '', name: '', id: '', birthDate: '', age: '', sex: '',
      phone: '', date, referringClinician: '', additionalNotes: '',
    },
    history: {
      chiefComplaint: '', clinicalIndication: '', dentalHistory: '', medicalHistory: '', symptoms: '',
      previousImaging: '', surgicalHistory: '', medications: '', allergies: '', notes: '',
      conditions: {
        pregnancy: false, diabetes: false, hypertension: false, cardiacDisease: false,
        bleedingDisorder: false, malignancy: false, radiotherapy: false,
      },
    },
    modalities: [],
    modalityDetails: {},
    manualReports: Object.fromEntries(MANUAL_MODALITIES.map((name) => [name, emptyManualReport()])),
    chartMode: 'mixed',
    toothConfig: {},
    findings,
    sideFindings,
    osseousFracture: { selected: false, description: '', modalities: [] },
    textSections: { incidentalFindings: '', otherAbnormalFindings: '', recommendations: '' },
    additionalImaging: { selected: false, text: '' },
    includeRadiographsInPdf: false,
  };
}

export function normalizeState(value) {
  const base = createEmptyState(value?.patient?.date);
  return {
    ...base,
    ...value,
    patient: { ...base.patient, ...(value?.patient || {}) },
    history: {
      ...base.history,
      ...(value?.history || {}),
      conditions: { ...base.history.conditions, ...(value?.history?.conditions || {}) },
    },
    modalityDetails: { ...base.modalityDetails, ...(value?.modalityDetails || {}) },
    manualReports: Object.fromEntries(MANUAL_MODALITIES.map((name) => [name, {
      ...emptyManualReport(),
      ...(value?.manualReports?.[name] || {}),
    }])),
    findings: Object.fromEntries(TOOTH_FINDINGS.map(([key]) => [key, {
      ...base.findings[key],
      ...(value?.findings?.[key] || {}),
      teeth: { ...(value?.findings?.[key]?.teeth || {}) },
    }])),
    sideFindings: Object.fromEntries(SIDE_GROUPS.flatMap(([, items]) => items).map(([key]) => [key, {
      ...base.sideFindings[key],
      ...(value?.sideFindings?.[key] || {}),
    }])),
    osseousFracture: { ...base.osseousFracture, ...(value?.osseousFracture || {}) },
    textSections: { ...base.textSections, ...(value?.textSections || {}) },
    additionalImaging: { ...base.additionalImaging, ...(value?.additionalImaging || {}) },
    toothConfig: { ...(value?.toothConfig || {}) },
  };
}

export function toothLabel(id) {
  const match = /^(perm|primary)-(UR|UL|LR|LL)-([1-8A-E])$/.exec(id || '');
  if (!match) return id;
  const dentition = match[1] === 'primary' ? 'Primary' : 'Permanent';
  const quadrants = { UR: 'upper right', UL: 'upper left', LR: 'lower right', LL: 'lower left' };
  return `${dentition} ${quadrants[match[2]]} tooth ${match[3]}`;
}

export function recordedCount(item, key) {
  if (key === 'supernumeraryTooth') return (item?.region?.trim() || item?.description?.trim()) ? 1 : 0;
  return Object.keys(item?.teeth || {}).length;
}

export function stateHasFindings(state) {
  return TOOTH_FINDINGS.some(([key]) => recordedCount(state.findings?.[key], key)) ||
    Object.values(state.sideFindings || {}).some((item) => item.right || item.left) ||
    state.osseousFracture?.selected ||
    Object.values(state.textSections || {}).some((value) => value?.trim()) ||
    (state.additionalImaging?.selected && state.additionalImaging.text?.trim()) ||
    Object.values(state.manualReports || {}).some((report) => report.findings?.trim() || report.impression?.trim());
}
