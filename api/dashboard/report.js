// api/dashboard/report.js
// GET /api/dashboard/report?tenant=slug
// Returns a PDF file (application/pdf)
// Requires x-admin-key header

// NOTE: This endpoint uses a Python script via child_process to generate the PDF.
// Vercel Serverless supports Node.js. For PDF generation we use a lightweight
// approach: generate the PDF in-process using a JS PDF library (pdfkit).
// Install: npm install pdfkit

import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
}

// Happly brand colours
const PINK   = '#CC0066';
const PINK_L = '#FFF0F7';
const PLUM   = '#2D1B36';
const OK     = '#1E7B55';
const TMID   = '#5E3A4E';
const TSOFT  = '#A87A94';
const BORDER = '#ECD8E4';
const AMBER  = '#B45309';
const WHITE  = '#FFFFFF';
const DARK   = '#1A0A12';

function hex(h) {
  const r = parseInt(h.slice(1,3),16)/255;
  const g = parseInt(h.slice(3,5),16)/255;
  const b = parseInt(h.slice(5,7),16)/255;
  return [r, g, b];
}

function getWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - y) / 86400000) + 1) / 7);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const tenantSlug = req.query.tenant;
  if (!tenantSlug) return res.status(400).json({ error: 'tenant required' });

  // Fetch data
  const { data: tenant } = await supabase
    .from('tenants').select('id, name, slug').eq('slug', tenantSlug).single();
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const { data: sessions } = await supabase
    .from('sessions')
    .select('created_at, feedback, blocker_type, anon_id')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: true });

  const { count: totalInvites } = await supabase
    .from('invites').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id);
  const { count: usedInvites } = await supabase
    .from('invites').select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id).not('used_at', 'is', null);

  // Aggregate
  const fb = { ja: 0, beetje: 0, nee: 0, skip: 0 };
  const blockerMap = {};
  const uniqueUsers = new Set();
  const weekMap = {};

  for (let w = 11; w >= 0; w--) {
    const d = new Date(); d.setDate(d.getDate() - w * 7);
    const key = `W${getWeek(d)}`;
    weekMap[key] = 0;
  }

  (sessions || []).forEach(s => {
    if (s.feedback && fb[s.feedback] !== undefined) fb[s.feedback]++;
    if (s.blocker_type) blockerMap[s.blocker_type] = (blockerMap[s.blocker_type] || 0) + 1;
    if (s.anon_id) uniqueUsers.add(s.anon_id);
    const d = new Date(s.created_at);
    const key = `W${getWeek(d)}`;
    if (weekMap[key] !== undefined) weekMap[key]++;
  });

  const blockers = Object.entries(blockerMap).sort((a,b) => b[1]-a[1]).slice(0,5);
  const withFb = fb.ja + fb.beetje + fb.nee;
  const effectScore = withFb > 0 ? Math.round(((fb.ja + fb.beetje * 0.5) / withFb) * 100) : null;
  const totalSessions = sessions?.length || 0;
  const uUsers = uniqueUsers.size;
  const avgPerUser = uUsers > 0 ? (totalSessions / uUsers).toFixed(1) : 0;
  const weekly = Object.entries(weekMap);
  const maxWeekly = Math.max(...Object.values(weekMap), 1);

  // Build PDF with pdfkit
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks = [];
  doc.on('data', c => chunks.push(c));

  const W = doc.page.width;
  const M = 50;
  const CW = W - 2 * M;
  const today = new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });

  // Helper: rounded rect fill
  function filledRect(x, y, w, h, color, r = 6) {
    doc.save().fillColor(color).roundedRect(x, y, w, h, r).fill().restore();
  }

  // Helper: progress bar
  function progBar(x, y, w, h, pct, color, bg = '#F3E8EF') {
    doc.save()
      .fillColor(bg).roundedRect(x, y, w, h, 3).fill()
      .fillColor(color).roundedRect(x, y, Math.max(4, w * Math.min(pct, 1)), h, 3).fill()
      .restore();
  }

  // ── COVER HEADER ──
  filledRect(M, M, CW, 140, PINK, 8);

  // Logo text (replace with actual image if available)
  doc.save().fillColor(WHITE).font('Helvetica-Bold').fontSize(22)
     .text('happly', M + 20, M + 18).restore();

  doc.save().fillColor(WHITE).font('Helvetica-Bold').fontSize(20)
     .text('Zetjes Rapportage', M + 20, M + 50).restore();

  doc.save().fillColor('#FFD6EC').font('Helvetica').fontSize(12)
     .text(tenant.name, M + 20, M + 80)
     .text('Rapport gegenereerd: ' + today, M + 20, M + 98).restore();

  // Privacy strip
  filledRect(M, M + 148, CW, 24, PLUM, 4);
  doc.save().fillColor(WHITE).font('Helvetica').fontSize(8)
     .text('Alle data in dit rapport is geanonimiseerd en geaggregeerd. Individuele medewerkers zijn niet identificeerbaar. AVG-compliant.',
       M + 10, M + 155, { width: CW - 20 }).restore();

  let y = M + 188;

  // ── SECTION HELPER ──
  function sectionTitle(title) {
    doc.save().font('Helvetica-Bold').fontSize(13).fillColor(DARK)
       .text(title, M, y).restore();
    y += 18;
    doc.save().strokeColor(BORDER).lineWidth(0.5)
       .moveTo(M, y).lineTo(M + CW, y).stroke().restore();
    y += 8;
  }

  // ── KPI CARDS ──
  sectionTitle('Kerngetallen');
  const cardW = (CW - 9) / 4;
  const kpis = [
    { label: 'Effectiviteitsscore', value: effectScore !== null ? effectScore + '%' : '–', sub: 'Zetjes die hielpen', hl: true },
    { label: 'Sessies',    value: totalSessions,  sub: 'Zetjes gegeven' },
    { label: 'Gebruikers', value: uUsers,          sub: `gem. ${avgPerUser}x` },
    { label: 'Links actief', value: `${usedInvites}/${totalInvites}`, sub: 'geactiveerd' },
  ];
  kpis.forEach((kpi, i) => {
    const x = M + i * (cardW + 3);
    const bg = kpi.hl ? PINK : '#FDFAFB';
    const vc = kpi.hl ? WHITE : DARK;
    const lc = kpi.hl ? '#FFD6EC' : TSOFT;
    filledRect(x, y, cardW, 72, bg, 6);
    if (!kpi.hl) { doc.save().roundedRect(x, y, cardW, 72, 6).stroke(BORDER).restore(); }
    doc.save().fillColor(lc).font('Helvetica').fontSize(7.5)
       .text(kpi.label, x + 4, y + 8, { width: cardW - 8, align: 'center' }).restore();
    doc.save().fillColor(vc).font('Helvetica-Bold').fontSize(22)
       .text(String(kpi.value), x + 4, y + 24, { width: cardW - 8, align: 'center' }).restore();
    doc.save().fillColor(lc).font('Helvetica').fontSize(7)
       .text(kpi.sub, x + 4, y + 54, { width: cardW - 8, align: 'center' }).restore();
  });
  y += 82;

  // ── INSIGHT BOX ──
  sectionTitle('Toelichting');
  const insightText = `Van de ${uUsers} medewerkers die Happly gebruikten, gaf ${effectScore ?? '–'}% aan dat het Zetje hielp om weer door te gaan. De meest voorkomende blokkade was vermijding en uitstellen — een patroon dat in teams vaak onzichtbaar blijft maar veel productiviteit kost. Gemiddeld pakt een medewerker ${avgPerUser} keer per periode een Zetje — een teken van actief zelfmanagement.`;
  filledRect(M, y, CW, 54, PINK_L, 6);
  doc.save().roundedRect(M, y, CW, 54, 6).stroke('#FFD6EC').restore();
  doc.save().fillColor(PLUM).font('Helvetica').fontSize(9)
     .text(insightText, M + 12, y + 10, { width: CW - 24, align: 'left' }).restore();
  y += 66;

  // ── FEEDBACK ──
  sectionTitle('Feedback op Zetjes');
  const totalFbAll = Object.values(fb).reduce((a,b) => a+b, 0) || 1;
  const fbItems = [
    ['Ja, werkte top', fb.ja, OK],
    ['Een beetje',     fb.beetje, AMBER],
    ['Niet echt',      fb.nee,   PINK],
    ['Overgeslagen',   fb.skip,  TSOFT],
  ];
  fbItems.forEach(([label, count, color]) => {
    const pct = count / totalFbAll;
    doc.save().fillColor(TMID).font('Helvetica').fontSize(9).text(label, M, y + 2).restore();
    doc.save().fillColor(DARK).font('Helvetica-Bold').fontSize(10).text(String(count), M + 52, y + 1).restore();
    progBar(M + 70, y + 4, CW - 100, 8, pct, color);
    doc.save().fillColor(color).font('Helvetica-Bold').fontSize(9)
       .text(`${Math.round(pct*100)}%`, M + CW - 26, y + 1).restore();
    y += 22;
    doc.save().strokeColor(BORDER).lineWidth(0.3)
       .moveTo(M, y).lineTo(M + CW, y).stroke().restore();
    y += 2;
  });
  y += 4;

  // ── WEEKLY CHART ──
  sectionTitle('Gebruik per week (laatste 12 weken)');
  const barW2 = (CW - 11) / weekly.length;
  const chartH = 50;
  weekly.forEach(([label, val], i) => {
    const bh = Math.max(2, (val / maxWeekly) * chartH);
    const x = M + i * (barW2 + 1);
    filledRect(x, y + chartH - bh, barW2, bh, PINK, 2);
    doc.save().fillColor(TSOFT).font('Helvetica').fontSize(6)
       .text(label, x, y + chartH + 3, { width: barW2, align: 'center' }).restore();
    if (val > 0) {
      doc.save().fillColor(DARK).font('Helvetica-Bold').fontSize(6)
         .text(String(val), x, y + chartH - bh - 10, { width: barW2, align: 'center' }).restore();
    }
  });
  y += chartH + 18;

  // ── BLOCKERS ──
  sectionTitle('Meest voorkomende blokkades (intern)');
  doc.save().fillColor(AMBER).font('Helvetica').fontSize(8)
     .text('Deze categorieën zijn intern — worden nooit getoond aan medewerkers of vermeld in externe communicatie.', M, y, { width: CW }).restore();
  y += 18;

  const maxB2 = blockers[0]?.[1] || 1;
  blockers.forEach(([label, count]) => {
    const pct = count / maxB2;
    doc.save().fillColor(TMID).font('Helvetica').fontSize(9).text(label, M, y + 2, { width: 120 }).restore();
    progBar(M + 124, y + 4, CW - 150, 8, pct, PINK);
    doc.save().fillColor(DARK).font('Helvetica-Bold').fontSize(10)
       .text(String(count), M + CW - 22, y + 1).restore();
    y += 22;
    doc.save().strokeColor(BORDER).lineWidth(0.3)
       .moveTo(M, y).lineTo(M + CW, y).stroke().restore();
    y += 2;
  });

  // ── FOOTER ──
  doc.save()
    .strokeColor(BORDER).lineWidth(0.3)
    .moveTo(M, doc.page.height - 40).lineTo(M + CW, doc.page.height - 40).stroke()
    .fillColor(TSOFT).font('Helvetica').fontSize(7)
    .text(
      `happly Zetjes Rapportage  ·  ${tenant.name}  ·  Alle data geanonimiseerd en geaggregeerd  ·  AVG-compliant  ·  happly.nl`,
      M, doc.page.height - 32, { width: CW, align: 'center' })
    .restore();

  doc.end();

  await new Promise(resolve => doc.on('end', resolve));

  const pdfBuffer = Buffer.concat(chunks);
  const filename = `happly-rapport-${tenantSlug}-${new Date().toISOString().slice(0,10)}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', pdfBuffer.length);
  return res.status(200).send(pdfBuffer);
}
