import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, MODALITIES, MODALITY_SIDES, SURFACE_FINDINGS, TOOTH_SURFACES, normalizeState } from '../public/report.js';
import { hasRecordedFindings, parseToothId, sideLabel, surfaceTextForFinding, validateManualReport, validateReportState } from '../server/report-utils.js';

function validState() {
  const state = createEmptyState('2026-10-28');
  state.patient.name = 'Synthetic Patient';
  state.modalities = ['Panoramic', 'Bitewing'];
  return state;
}

test('finalization requires an explicitly recorded finding', () => {
  const state = validState();
  assert.equal(hasRecordedFindings(state), false);
  assert.match(validateReportState(state, { final: true })[0], /at least one dental finding/i);
});

test('surface selections remain scoped to each tooth-finding pair', () => {
  const state = validState();
  state.findings.enamelCaries.teeth['perm-UR-6'] = { m: false, d: true };
  state.findings.dentinalCaries.teeth['perm-UR-6'] = { m: true, d: false };
  state.findings.dentalFracture.teeth['perm-UR-6'] = { m: false, d: false };
  assert.deepEqual(state.findings.enamelCaries.teeth['perm-UR-6'], { m: false, d: true });
  assert.deepEqual(state.findings.dentinalCaries.teeth['perm-UR-6'], { m: true, d: false });
  assert.deepEqual(state.findings.dentalFracture.teeth['perm-UR-6'], { m: false, d: false });
});

test('removing a tooth from one finding preserves other findings', () => {
  const state = validState();
  state.findings.enamelCaries.teeth['perm-UL-4'] = { m: false, d: true };
  state.findings.pulpoPeriapicalLesion.teeth['perm-UL-4'] = { m: false, d: false };
  delete state.findings.enamelCaries.teeth['perm-UL-4'];
  assert.equal(state.findings.enamelCaries.teeth['perm-UL-4'], undefined);
  assert.ok(state.findings.pulpoPeriapicalLesion.teeth['perm-UL-4']);
});

test('primary and permanent successor identifiers are independent', () => {
  assert.deepEqual(parseToothId('primary-UR-C'), { dentition: 'primary', quadrant: 'UR', number: 'C' });
  assert.deepEqual(parseToothId('perm-UR-3'), { dentition: 'perm', quadrant: 'UR', number: '3' });
});

test('new examinations open with the mixed local-number chart and empty clinical history', () => {
  const state = createEmptyState('2026-10-28');
  assert.equal(state.chartMode, 'mixed');
  assert.deepEqual(Object.keys(state.history), ['chiefComplaint', 'clinicalIndication', 'dentalHistory', 'medicalHistory', 'symptoms', 'previousImaging', 'surgicalHistory', 'medications', 'allergies', 'notes', 'conditions']);
  assert.ok(Object.entries(state.history).filter(([key]) => key !== 'conditions').every(([, value]) => value === ''));
  assert.ok(Object.values(state.history.conditions).every((value) => value === false));
});

test('the complete imaging catalogue and side choices are available', () => {
  assert.deepEqual(MODALITIES, ['Panoramic', 'Periapical', 'Bitewing', 'CBCT', 'Hand/Wrist', 'Occlusal', 'TMJ', 'Cephalometric', 'Other']);
  assert.deepEqual(MODALITY_SIDES, ['Not applicable', 'Right', 'Left', 'Bilateral', 'Midline']);
});

test('expanded patient, history and modality details survive normalization', () => {
  const normalized = normalizeState({
    patient: { firstName: 'Test', lastName: 'Patient', phone: '555' },
    history: { medications: 'Example', conditions: { diabetes: true } },
    modalityDetails: { CBCT: { side: 'Right', label: '' } },
  });
  assert.equal(normalized.patient.phone, '555');
  assert.equal(normalized.history.medications, 'Example');
  assert.equal(normalized.history.conditions.diabetes, true);
  assert.equal(normalized.history.conditions.hypertension, false);
  assert.equal(normalized.modalityDetails.CBCT.side, 'Right');
});

test('all requested tooth surface keys remain independent', () => {
  const surfaces = Object.fromEntries(TOOTH_SURFACES.map(([key]) => [key, false]));
  surfaces.m = true;
  surfaces.apical = true;
  assert.equal(surfaces.m, true);
  assert.equal(surfaces.d, false);
  assert.equal(surfaces.apical, true);
  assert.equal(surfaces.general, false);
});

test('side-specific findings report right, left, or bilateral accurately', () => {
  assert.equal(sideLabel({ right: true, left: false }), 'Right');
  assert.equal(sideLabel({ right: false, left: true }), 'Left');
  assert.equal(sideLabel({ right: true, left: true }), 'Bilateral');
  assert.equal(sideLabel({ right: false, left: false }), '');
});

test('required conditional descriptions are enforced only for final reports', () => {
  const state = validState();
  state.findings.dentalFracture.teeth['perm-LR-5'] = { m: false, d: false };
  state.osseousFracture.selected = true;
  state.additionalImaging.selected = true;
  assert.deepEqual(validateReportState(state), []);
  const errors = validateReportState(state, { final: true });
  assert.ok(errors.some((message) => /osseous fracture description/i.test(message)));
  assert.ok(errors.some((message) => /requested imaging/i.test(message)));
});

test('one finding associated with multiple modalities remains a single entry', () => {
  const state = validState();
  state.findings.enamelCaries.teeth['perm-UR-6'] = { m: false, d: true };
  state.findings.enamelCaries.modalities = ['Panoramic', 'Bitewing'];
  assert.equal(Object.keys(state.findings.enamelCaries.teeth).length, 1);
});

test('surface superscripts are limited to enamel and dentinal caries', () => {
  assert.deepEqual(SURFACE_FINDINGS, ['enamelCaries', 'dentinalCaries']);
  const surfaces = { m: true, d: true, apical: true };
  assert.equal(surfaceTextForFinding('enamelCaries', surfaces), 'M/D/AP');
  assert.equal(surfaceTextForFinding('dentinalCaries', surfaces), 'M/D/AP');
  assert.equal(surfaceTextForFinding('dentalFracture', surfaces), '');
  assert.equal(surfaceTextForFinding('restoration', surfaces), '');
});

test('manual modality reports are independent and survive old-record normalization', () => {
  const oldRecord = normalizeState({ patient: { name: 'Legacy Patient' }, modalities: ['CBCT'] });
  assert.equal(oldRecord.manualReports.CBCT.findings, '');
  assert.equal(oldRecord.manualReports['Hand/Wrist'].skeletalAssessment, '');
  oldRecord.manualReports.CBCT.findings = 'Localized radiolucency.';
  oldRecord.manualReports.CBCT.impression = 'Odontogenic lesion.';
  assert.equal(oldRecord.manualReports['Hand/Wrist'].findings, '');
  assert.deepEqual(validateManualReport(oldRecord, 'CBCT'), []);
});

test('manual-only finalization requires findings and impression but no dental chart finding', () => {
  const state = createEmptyState('2026-10-28');
  state.patient.name = 'Manual Report Patient';
  state.modalities = ['CBCT'];
  assert.ok(validateReportState(state, { final: true }).some((message) => /CBCT findings/i.test(message)));
  state.manualReports.CBCT.findings = 'No acute osseous abnormality.';
  state.manualReports.CBCT.impression = 'No acute finding.';
  assert.deepEqual(validateReportState(state, { final: true }), []);
});

test('Hand/Wrist supports an independent skeletal assessment', () => {
  const state = createEmptyState('2026-10-28');
  state.patient.name = 'Skeletal Patient';
  state.modalities = ['Hand/Wrist'];
  state.manualReports['Hand/Wrist'].skeletalAssessment = 'Skeletal age approximates 12 years.';
  state.manualReports['Hand/Wrist'].findings = 'Growth plates remain open.';
  state.manualReports['Hand/Wrist'].impression = 'Skeletal maturation is in progress.';
  assert.deepEqual(validateReportState(state, { final: true }), []);
});
