import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DENTAL_MODALITIES,
  MANUAL_MODALITIES,
  TOOTH_FINDINGS,
  SIDE_FINDINGS,
  cleanText,
  parseToothId,
  sideLabel,
  surfaceTextForFinding,
} from './report-utils.js';

const COLORS = {
  purple: '#6D3A8A',
  purpleDark: '#4D2867',
  purplePale: '#F4EFF8',
  green: '#62A888',
  greenPale: '#EDF7F2',
  ink: '#20242B',
  muted: '#66707A',
  line: '#DCD8E2',
  white: '#FFFFFF',
};

function addFooter(doc, settings, pageNumber = null, pageCount = null) {
  const pageBottom = doc.page.height - 28;
  const previousX = doc.x;
  const previousY = doc.y;
  const previousBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.save();
  doc.strokeColor(COLORS.line).lineWidth(0.6).moveTo(40, pageBottom - 13).lineTo(doc.page.width - 40, pageBottom - 13).stroke();
  doc.font('Helvetica').fontSize(7.2).fillColor(COLORS.muted);
  const left = [settings.footer_text, pageNumber && pageCount ? `Page ${pageNumber} of ${pageCount}` : ''].filter(Boolean).join('  ·  ');
  const contact = [settings.telephone && `Tel: ${settings.telephone}`, settings.email, settings.website].filter(Boolean).join('  |  ');
  doc.text(left, 40, pageBottom - 7, { width: 230, lineBreak: false, ellipsis: true });
  doc.text(contact, 270, pageBottom - 7, {
    width: doc.page.width - 310,
    align: 'right',
    lineBreak: false,
  });
  doc.restore();
  doc.page.margins.bottom = previousBottomMargin;
  doc.x = previousX;
  doc.y = previousY;
}

function ensureSpace(doc, height) {
  if (doc.y + height > doc.page.height - 62) {
    doc.addPage();
    if (doc._clinicSettings) addFooter(doc, doc._clinicSettings);
  }
}

function sectionTitle(doc, title) {
  ensureSpace(doc, 30);
  doc.moveDown(0.45);
  const y = doc.y;
  doc.roundedRect(40, y, doc.page.width - 80, 22, 5).fill(COLORS.purplePale);
  doc.fillColor(COLORS.purpleDark).font('Helvetica-Bold').fontSize(10).text(title, 49, y + 6);
  doc.y = y + 27;
}

function drawToken(doc, x, y, number, surfaces, status) {
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9.2).text(number, x, y, { lineBreak: false });
  const baseWidth = doc.widthOfString(number);
  if (surfaces) {
    doc.font('Helvetica-Bold').fontSize(5.3).fillColor(COLORS.purpleDark)
      .text(surfaces, x + baseWidth + 0.8, y - 2.6, { lineBreak: false });
  }
  const surfaceWidth = surfaces ? doc.widthOfString(surfaces) + 1.5 : 0;
  if (status === 'unerupted') {
    doc.font('Helvetica').fontSize(5.7).fillColor(COLORS.muted)
      .text('(dev)', x + baseWidth + surfaceWidth + 1.5, y + 2, { lineBreak: false });
  }
  return baseWidth + surfaceWidth + (status === 'unerupted' ? 18 : 0) + 7;
}

function tokenWidth(doc, entry) {
  doc.font('Helvetica-Bold').fontSize(9.2);
  let width = doc.widthOfString(entry.number) + 7;
  if (entry.surfaces) {
    doc.fontSize(5.3);
    width += doc.widthOfString(entry.surfaces) + 1.5;
  }
  if (entry.status === 'unerupted') width += 18;
  return width;
}

function drawQuadrantEntries(doc, entries, x, y, width, alignRight) {
  if (!entries.length) return;
  const groups = [
    ['Permanent', entries.filter((entry) => entry.dentition === 'perm')],
    ['Primary', entries.filter((entry) => entry.dentition === 'primary')],
  ].filter(([, list]) => list.length);
  let rowY = y;
  for (const [label, list] of groups) {
    doc.font('Helvetica').fontSize(5.8).fillColor(COLORS.muted);
    const labelWidth = doc.widthOfString(`${label}:`);
    const itemsWidth = list.reduce((sum, item) => sum + tokenWidth(doc, item), 0);
    doc.font('Helvetica').fontSize(5.8).fillColor(COLORS.muted);
    let cursor = alignRight ? x + width - labelWidth - 4 - itemsWidth : x;
    doc.text(`${label}:`, cursor, rowY + 2, { lineBreak: false });
    cursor += labelWidth + 4;
    for (const item of list) cursor += drawToken(doc, cursor, rowY, item.number, item.surfaces, item.status);
    rowY += 15;
  }
}

function drawQuadrantChart(doc, x, y, width, teeth, toothConfig = {}, findingKey = '') {
  const height = 70;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  doc.save();
  doc.roundedRect(x, y, width, height, 5).fillAndStroke(COLORS.white, COLORS.line);
  doc.strokeColor(COLORS.green).lineWidth(0.8).moveTo(centerX, y + 8).lineTo(centerX, y + height - 8).stroke();
  doc.moveTo(x + 8, centerY).lineTo(x + width - 8, centerY).stroke();
  doc.font('Helvetica-Bold').fontSize(5.8).fillColor(COLORS.muted);
  doc.text('UPPER RIGHT', x + 7, y + 4, { width: width / 2 - 12, align: 'left' });
  doc.text('UPPER LEFT', centerX + 5, y + 4, { width: width / 2 - 12, align: 'right' });
  doc.text('LOWER RIGHT', x + 7, y + height - 10, { width: width / 2 - 12, align: 'left' });
  doc.text('LOWER LEFT', centerX + 5, y + height - 10, { width: width / 2 - 12, align: 'right' });

  const parsed = Object.entries(teeth).map(([id, surfaces]) => {
    const tooth = parseToothId(id);
    if (!tooth) return null;
    return {
      ...tooth,
      surfaces: surfaceTextForFinding(findingKey, surfaces),
      status: toothConfig[id]?.status,
    };
  }).filter(Boolean);
  const order = (a, b) => {
    const av = /^[A-E]$/.test(a.number) ? a.number.charCodeAt(0) - 64 : Number(a.number);
    const bv = /^[A-E]$/.test(b.number) ? b.number.charCodeAt(0) - 64 : Number(b.number);
    return av - bv;
  };
  for (const quadrant of ['UR', 'UL', 'LR', 'LL']) {
    const list = parsed.filter((entry) => entry.quadrant === quadrant).sort(order);
    const rightSide = quadrant.endsWith('L');
    const upper = quadrant.startsWith('U');
    drawQuadrantEntries(
      doc,
      list,
      rightSide ? centerX + 6 : x + 7,
      upper ? y + 14 : centerY + 6,
      width / 2 - 13,
      !rightSide,
    );
  }
  doc.restore();
  return height;
}

function drawFinding(doc, findingKey, label, item, toothConfig) {
  const note = cleanText(item.note);
  const modalities = Array.isArray(item.modalities) && item.modalities.length ? item.modalities.join(', ') : '';
  const height = 86 + (note ? Math.min(34, doc.heightOfString(note, { width: 230 })) : 0) + (modalities ? 10 : 0);
  ensureSpace(doc, height + 8);
  const y = doc.y;
  doc.roundedRect(40, y, doc.page.width - 80, height, 7).fillAndStroke('#FCFBFD', COLORS.line);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLORS.ink).text(label, 51, y + 10, { width: 235 });
  if (modalities) {
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted).text(`Associated modality: ${modalities}`, 51, y + 27, { width: 235 });
  }
  if (note) {
    doc.font('Helvetica').fontSize(8.2).fillColor(COLORS.ink)
      .text(note, 51, y + (modalities ? 40 : 30), { width: 235, lineGap: 2 });
  }
  drawQuadrantChart(doc, 305, y + 8, doc.page.width - 356, item.teeth || {}, toothConfig, findingKey);
  doc.y = y + height + 7;
}

function drawTextItem(doc, label, text) {
  const value = cleanText(text);
  if (!value) return;
  doc.font('Helvetica').fontSize(9);
  const bodyHeight = doc.heightOfString(value, { width: doc.page.width - 110, lineGap: 2 });
  const height = Math.max(38, bodyHeight + 28);
  ensureSpace(doc, height + 5);
  const y = doc.y;
  doc.roundedRect(40, y, doc.page.width - 80, height, 6).fillAndStroke('#FCFBFD', COLORS.line);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.purpleDark).text(label, 50, y + 8);
  doc.font('Helvetica').fontSize(8.7).fillColor(COLORS.ink).text(value, 50, y + 22, {
    width: doc.page.width - 100,
    lineGap: 2,
  });
  doc.y = y + height + 6;
}

function drawHeader(doc, state, settings, logoAsset, draft, reportTitle = 'Diagnostic Imaging Report') {
  const x = 40;
  const top = 36;
  if (logoAsset && (Buffer.isBuffer(logoAsset) || existsSync(logoAsset))) {
    try { doc.image(logoAsset, x, top, { fit: [78, 58], align: 'left', valign: 'center' }); } catch { /* retain text header */ }
  } else {
    doc.roundedRect(x, top, 54, 54, 12).fill(COLORS.purplePale);
    doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.purple).text('M', x, top + 15, { width: 54, align: 'center' });
  }
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.purpleDark).text(settings.clinician_name, 112, top + 3);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(settings.professional_title, 112, top + 22);
  const credential = settings.registration_number ? `${settings.center_descriptor} · Reg. ${settings.registration_number}` : settings.center_descriptor;
  doc.fontSize(8).text(credential, 112, top + 36, { width: 225, ellipsis: true, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(15).fillColor(COLORS.ink).text(reportTitle, 330, top + 7, {
    width: doc.page.width - 370,
    align: 'right',
  });
  if (draft) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.purple)
      .text('DRAFT PREVIEW', 345, top + 34, { width: doc.page.width - 385, align: 'right' });
  }
  const lineY = 101;
  doc.strokeColor(COLORS.green).lineWidth(2).moveTo(40, lineY).lineTo(doc.page.width - 40, lineY).stroke();
  const patient = state.patient || {};
  const infoY = 113;
  doc.roundedRect(40, infoY, doc.page.width - 80, 82, 6).fill(COLORS.greenPale);
  const modalityText = (state.modalities || []).map((name) => {
    const detail = state.modalityDetails?.[name] || {};
    return `${detail.label || name}${detail.side && detail.side !== 'Not applicable' ? ` (${detail.side})` : ''}`;
  }).join(', ');
  const items = [
    ['Patient', patient.name || '—'],
    ['File number', patient.id || '—'],
    ['Birth date / age', [patient.birthDate, patient.age && `Age ${patient.age}`].filter(Boolean).join(' · ') || '—'],
    ['Sex', patient.sex || '—'],
    ['Telephone', patient.phone || '—'],
    ['Examination date', patient.date || '—'],
    ['Referring clinician', patient.referringClinician || '—'],
    ['Modalities', modalityText || '—'],
    ['Patient notes', patient.additionalNotes || '—'],
  ];
  const columns = 3;
  const cellWidth = (doc.page.width - 100) / columns;
  items.forEach(([label, value], index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const cellX = 50 + col * cellWidth;
    const cellY = infoY + 8 + row * 25;
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor(COLORS.muted).text(label.toUpperCase(), cellX, cellY, { width: cellWidth - 10 });
    doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.ink).text(String(value), cellX, cellY + 9, { width: cellWidth - 10, lineBreak: false, ellipsis: true });
  });
  doc.y = 206;
}

function drawModalitySchematic(doc, modality, x, y, width = 112, height = 54) {
  const sx = width / 160;
  const sy = height / 90;
  const X = (value) => x + value * sx;
  const Y = (value) => y + value * sy;
  const line = (x1, y1, x2, y2, color = COLORS.purple) => doc.strokeColor(color).lineWidth(1.7).moveTo(X(x1), Y(y1)).lineTo(X(x2), Y(y2)).stroke();
  const ellipse = (cx, cy, rx, ry, color = COLORS.green) => doc.strokeColor(color).lineWidth(1.5).ellipse(X(cx), Y(cy), rx * sx, ry * sy).stroke();
  doc.save();
  doc.roundedRect(x, y, width, height, 5).fillAndStroke('#FCFBFD', COLORS.line);
  if (modality === 'Panoramic') {
    doc.strokeColor(COLORS.purple).lineWidth(1.8).moveTo(X(20), Y(37)).quadraticCurveTo(X(80), Y(7), X(140), Y(37)).stroke();
    doc.moveTo(X(24), Y(54)).quadraticCurveTo(X(80), Y(81), X(136), Y(54)).stroke();
    for (let i = 0; i < 9; i += 1) ellipse(36 + i * 11, 46, 3.5, 5, COLORS.green);
  } else if (modality === 'Periapical') {
    for (let i = 0; i < 3; i += 1) {
      const base = 48 + i * 28;
      doc.strokeColor(COLORS.purple).fillColor(COLORS.purplePale).lineWidth(1.6)
        .moveTo(X(base), Y(23)).lineTo(X(base + 6), Y(70)).lineTo(X(base + 12), Y(23)).quadraticCurveTo(X(base + 6), Y(13), X(base), Y(23)).fillAndStroke();
    }
    line(34, 72, 126, 72, COLORS.green);
  } else if (modality === 'Bitewing') {
    line(24, 45, 136, 45, COLORS.green);
    for (let i = 0; i < 5; i += 1) {
      const base = 31 + i * 22;
      doc.strokeColor(COLORS.purple).fillColor(COLORS.purplePale).lineWidth(1.4)
        .rect(X(base), Y(18), 14 * sx, 20 * sy).fillAndStroke()
        .rect(X(base), Y(52), 14 * sx, 20 * sy).fillAndStroke();
    }
  } else if (modality === 'CBCT') {
    doc.strokeColor(COLORS.purple).lineWidth(1.6).rect(X(40), Y(22), 58 * sx, 47 * sy).stroke();
    line(40, 22, 62, 10); line(98, 22, 120, 10); line(120, 10, 120, 57); line(98, 69, 120, 57); line(62, 10, 120, 10);
    ellipse(69, 45, 15, 15); line(69, 28, 69, 62, COLORS.green); line(52, 45, 86, 45, COLORS.green);
  } else if (modality === 'Hand/Wrist') {
    doc.strokeColor(COLORS.purple).lineWidth(2).moveTo(X(54), Y(77)).lineTo(X(49), Y(46)).lineTo(X(45), Y(18)).moveTo(X(58), Y(47)).lineTo(X(58), Y(10)).moveTo(X(66), Y(45)).lineTo(X(70), Y(7)).moveTo(X(73), Y(47)).lineTo(X(84), Y(14)).moveTo(X(79), Y(52)).lineTo(X(98), Y(26)).stroke();
    doc.moveTo(X(54), Y(77)).quadraticCurveTo(X(76), Y(85), X(96), Y(64)).lineTo(X(91), Y(43)).quadraticCurveTo(X(84), Y(37), X(79), Y(52)).lineTo(X(73), Y(47)).lineTo(X(66), Y(45)).lineTo(X(58), Y(47)).lineTo(X(49), Y(46)).stroke();
    ellipse(65, 66, 4, 4); ellipse(78, 66, 4, 4);
  } else if (modality === 'Occlusal') {
    doc.strokeColor(COLORS.purple).fillColor(COLORS.purplePale).lineWidth(1.7).ellipse(X(80), Y(47), 57 * sx, 30 * sy).fillAndStroke();
    doc.strokeColor(COLORS.green).ellipse(X(80), Y(47), 38 * sx, 16 * sy).stroke();
  } else if (modality === 'TMJ') {
    ellipse(55, 42, 23, 28, COLORS.purple); ellipse(105, 42, 23, 28, COLORS.purple); ellipse(61, 34, 7, 7); ellipse(99, 34, 7, 7); line(66, 70, 94, 70, COLORS.green);
  } else if (modality === 'Cephalometric') {
    doc.strokeColor(COLORS.purple).lineWidth(1.7).ellipse(X(80), Y(44), 32 * sx, 34 * sy).stroke();
    line(20, 45, 140, 45, COLORS.green); line(80, 8, 80, 82, '#8FA6D9'); ellipse(93, 34, 3, 3, COLORS.purple);
  } else {
    doc.strokeColor(COLORS.purple).lineWidth(1.6).roundedRect(X(29), Y(16), 102 * sx, 58 * sy, 4).stroke();
    ellipse(80, 45, 18, 18); ellipse(80, 45, 8, 8, COLORS.purple); line(38, 67, 61, 51, COLORS.green); line(99, 51, 122, 67, COLORS.green);
  }
  doc.restore();
}

function drawModalityOverview(doc, state, modalities) {
  if (!modalities.length) return;
  sectionTitle(doc, 'Imaging modalities');
  const cardWidth = (doc.page.width - 96) / 3;
  const cardHeight = 82;
  for (let rowStart = 0; rowStart < modalities.length; rowStart += 3) {
    ensureSpace(doc, cardHeight + 12);
    const rowY = doc.y;
    for (let col = 0; col < 3 && rowStart + col < modalities.length; col += 1) {
      const modality = modalities[rowStart + col];
      const detail = state.modalityDetails?.[modality] || {};
      const cardX = 40 + col * (cardWidth + 8);
      drawModalitySchematic(doc, modality, cardX + 5, rowY + 4, 72, 45);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.ink).text(detail.label || modality, cardX + 82, rowY + 12, { width: cardWidth - 87, ellipsis: true, lineBreak: false });
      const side = state.manualReports?.[modality]?.side || detail.side;
      doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted).text(side && side !== 'Not applicable' ? side : 'General examination', cardX + 82, rowY + 28, { width: cardWidth - 87 });
      doc.strokeColor(COLORS.line).roundedRect(cardX, rowY, cardWidth, cardHeight, 6).stroke();
      doc.y = rowY;
    }
    doc.y = rowY + cardHeight + 8;
  }
}

function renderManualReportSection(doc, state, modality) {
  const report = state.manualReports?.[modality] || {};
  const displayName = state.modalityDetails?.[modality]?.label || modality;
  sectionTitle(doc, `${displayName} report`);
  ensureSpace(doc, 76);
  drawModalitySchematic(doc, modality, 40, doc.y, 118, 66);
  const summary = [
    cleanText(report.side) && cleanText(report.side) !== 'Not applicable' ? `Side: ${cleanText(report.side)}` : '',
    cleanText(report.examinationType) && `Protocol: ${cleanText(report.examinationType)}`,
    cleanText(report.region) && `Region: ${cleanText(report.region)}`,
  ].filter(Boolean).join('\n');
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.ink).text(summary || 'Modality-specific manual report', 174, doc.y + 10, { width: doc.page.width - 214, lineGap: 4 });
  doc.y += 74;
  const fields = [
    ['Clinical indication', report.clinicalIndication],
    ['Technique', report.technique],
    ...(modality === 'Hand/Wrist' ? [['Skeletal / bone-age assessment', report.skeletalAssessment]] : []),
    ['Findings', report.findings],
    ['Impression / conclusion', report.impression],
    ['Recommendations', report.recommendations],
    ['Additional notes', report.notes],
  ];
  for (const [label, value] of fields) drawTextItem(doc, label, value);
}

function renderClinicalReport(doc, state, modalities) {
  drawModalityOverview(doc, state, modalities);
  const history = state.history || {};
  const historyItems = [
    ['Chief complaint / reason for referral', history.chiefComplaint],
    ['Clinical indication', history.clinicalIndication],
    ['Relevant dental history', history.dentalHistory],
    ['Relevant medical history', history.medicalHistory],
    ['Surgical history', history.surgicalHistory],
    ['Current medications', history.medications],
    ['Allergies', history.allergies],
    ['Symptoms and duration', history.symptoms],
    ['Previous imaging / comparison', history.previousImaging],
    ['Additional history notes', history.notes],
  ].filter(([, value]) => cleanText(value));
  const conditionLabels = { pregnancy: 'Pregnancy', diabetes: 'Diabetes', hypertension: 'Hypertension', cardiacDisease: 'Cardiac disease', bleedingDisorder: 'Bleeding disorder', malignancy: 'Malignancy', radiotherapy: 'Previous radiotherapy' };
  const conditions = Object.entries(history.conditions || {}).filter(([, selected]) => selected).map(([key]) => conditionLabels[key] || key).join(', ');
  if (conditions) historyItems.unshift(['Medical factors', conditions]);
  if (historyItems.length) {
    sectionTitle(doc, 'Clinical history');
    for (const [label, value] of historyItems) drawTextItem(doc, label, value);
  }
  const dentalIncluded = modalities.some((name) => DENTAL_MODALITIES.includes(name));
  if (dentalIncluded) {
  const toothConfig = state.toothConfig || {};
  const recordedToothFindings = TOOTH_FINDINGS.filter(([key]) => {
    const item = state.findings?.[key] || {};
    if (key === 'supernumeraryTooth') return cleanText(item.region) || cleanText(item.description);
    return Object.keys(item.teeth || {}).length;
  });
  if (recordedToothFindings.length) sectionTitle(doc, 'Recorded dental findings');
  for (const [key, label] of recordedToothFindings) {
    const item = state.findings[key];
    if (key === 'supernumeraryTooth') {
      const text = [cleanText(item.region) && `Region: ${cleanText(item.region)}`, cleanText(item.description), cleanText(item.note)]
        .filter(Boolean).join(' — ');
      drawTextItem(doc, label, text);
    } else {
      drawFinding(doc, key, label, item, toothConfig);
    }
  }

  if (state.osseousFracture?.selected && cleanText(state.osseousFracture.description)) {
    sectionTitle(doc, 'Osseous fracture');
    drawTextItem(doc, 'Description', state.osseousFracture.description);
  }

  const sideItems = SIDE_FINDINGS.map(([key, label, group]) => ({ key, label, group, item: state.sideFindings?.[key] }))
    .filter(({ item }) => item?.right || item?.left);
  for (const group of ['Maxillary sinus', 'Stylohyoid ligament', 'Calcifications']) {
    const groupItems = sideItems.filter((entry) => entry.group === group);
    if (!groupItems.length) continue;
    sectionTitle(doc, group);
    for (const { label, item } of groupItems) {
      const note = cleanText(item.note);
      drawTextItem(doc, label, `${sideLabel(item)}${note ? ` — ${note}` : ''}`);
    }
  }

  const texts = state.textSections || {};
  if (cleanText(texts.incidentalFindings)) {
    sectionTitle(doc, 'Incidental findings');
    drawTextItem(doc, 'Recorded finding', texts.incidentalFindings);
  }
  if (cleanText(texts.otherAbnormalFindings)) {
    sectionTitle(doc, 'Other abnormal findings');
    drawTextItem(doc, 'Recorded finding', texts.otherAbnormalFindings);
  }
  if (cleanText(texts.recommendations)) {
    sectionTitle(doc, 'Recommendations');
    drawTextItem(doc, 'Recommendation', texts.recommendations);
  }
  if (state.additionalImaging?.selected && cleanText(state.additionalImaging.text)) {
    sectionTitle(doc, 'Additional imaging required');
    drawTextItem(doc, 'Request', state.additionalImaging.text);
  }
  }
  for (const modality of modalities.filter((name) => MANUAL_MODALITIES.includes(name))) {
    renderManualReportSection(doc, state, modality);
  }
}

function addRadiographs(doc, images, uploadsDir) {
  if (!images?.length) return;
  for (const image of images) {
    const fileAsset = image.data || (uploadsDir ? join(uploadsDir, image.stored_name) : null);
    if (!fileAsset || (!Buffer.isBuffer(fileAsset) && !existsSync(fileAsset))) continue;
    doc.addPage();
    if (doc._clinicSettings) addFooter(doc, doc._clinicSettings);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.purpleDark)
      .text(`${image.modality} radiograph`, 40, 40, { width: doc.page.width - 80 });
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
      .text(image.original_name, 40, 58, { width: doc.page.width - 80 });
    try {
      doc.image(fileAsset, 40, 85, {
        fit: [doc.page.width - 80, doc.page.height - 155],
        align: 'center',
        valign: 'center',
      });
    } catch {
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text('This image could not be rendered in the PDF.', 40, 100);
    }
  }
}

export function streamReportPdf({ response, state, settings, images, uploadsDir, logoData = null, draft = false, includeImages = false, manualModality = null }) {
  const modalities = manualModality ? [manualModality] : (state.modalities || []);
  const reportTitle = manualModality
    ? `${state.modalityDetails?.[manualModality]?.label || manualModality} Report`
    : 'Diagnostic Imaging Report';
  const displayState = { ...state, modalities };
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: reportTitle } });
  doc.pipe(response);
  doc._clinicSettings = settings;
  addFooter(doc, settings);
  const logoAsset = logoData || settings.logo_path || null;
  drawHeader(doc, displayState, settings, logoAsset, draft, reportTitle);
  renderClinicalReport(doc, displayState, modalities);
  const selectedImages = manualModality ? images.filter((image) => image.modality === manualModality) : images;
  if (includeImages) addRadiographs(doc, selectedImages, uploadsDir);
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    addFooter(doc, settings, index - range.start + 1, range.count);
  }
  doc.end();
}
