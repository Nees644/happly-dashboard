// api/dashboard/group-report.js
// GET ?id=<invite_id> → groepsrapport (één pagina PDF) voor de coach.
// Cijfers komen alleen uit de view report_group: onder de 5 actieve gebruikers
// bestaat er geen rij en toont het rapport alleen de kop en een melding.

import fs from 'fs';
import PDFDocument from 'pdfkit';
import { supabase, cors, isAdmin, weekSinceStart, phaseFor, PHASE_LABELS } from '../_lib/common.js';

const asset = (p) => fs.readFileSync(new URL(`../../assets/${p}`, import.meta.url));
const FONTS = {
  sans: asset('fonts/dm-sans-latin-400-normal.woff'),
  sansBold: asset('fonts/dm-sans-latin-600-normal.woff'),
  serif: asset('fonts/dm-serif-display-latin-400-normal.woff'),
};
const LOGO = asset('logo-wit.png');

const PINK = '#CC0066', PINK_L = '#FFF0F7', PLUM = '#2D1B36', TEXT = '#1A0A12', MID = '#5E3A4E', SOFT = '#A87A94', BORDER = '#ECD8E4';
const BLOKKADES = [
  ['energie', 'Geen energie', '#F59E0B'],
  ['vertrouwen', 'Geen vertrouwen', PINK],
  ['weerstand', 'Weerstand', PLUM],
  ['overtuigingen', 'Overtuigingen', '#1E7B55'],
];
const MOMENTEN = { schaamte: 'Schaamte na een terugval', groep: 'Twijfel over de groep', dip: 'Dip na de intensieve fase', stilte: 'Stille weken' };
const CONTEXT_LABELS = { werk: 'Werk', ondernemen: 'Ondernemen', sales: 'Sales', managers: 'Managers', gli: 'Leefstijlprogramma' };

// Welke blokkades je in een fase verwacht (uit de risico's per fase)
const FASE_VERWACHT = {
  start: ['vertrouwen'],
  eerste_terugval: ['vertrouwen'],
  behandelfase: ['weerstand', 'energie'],
  overgang: ['energie', 'overtuigingen'],
  onderhoud: ['overtuigingen', 'energie'],
};

const SUGGESTIE_MOMENT = {
  schaamte: 'Meerdere deelnemers gebruikten Zetjes rond een terugval. Het kan helpen om in de volgende bijeenkomst te benoemen dat een misstap erbij hoort en dat doorgaan telt.',
  groep: 'Meerdere deelnemers twijfelden of de groep bij hen past. Het kan helpen om in de volgende bijeenkomst ruimte te maken voor hoe het in de groep gaat.',
  dip: 'Meerdere deelnemers merkten een dip nu het programma minder intensief wordt. Het kan helpen om deelnemers hun eigen reden om te beginnen te laten terughalen.',
  stilte: 'Meerdere deelnemers gebruikten Zetjes in weken zonder bijeenkomst. Een kort berichtje aan de groep tussen de bijeenkomsten kan helpen.',
};
const SUGGESTIE_BLOKKADE = {
  energie: 'Geen energie kwam het vaakst voor. Het kan helpen om in de volgende bijeenkomst te laten zien hoe klein een stap mag zijn.',
  vertrouwen: 'Geen vertrouwen kwam het vaakst voor. Het kan helpen om in de volgende bijeenkomst kleine successen uit de groep te benoemen.',
  weerstand: 'Weerstand kwam het vaakst voor. Het kan helpen om in de volgende bijeenkomst te vragen wat deelnemers zelf wel willen.',
  overtuigingen: 'Overtuigingen als "zo ben ik nu eenmaal" kwamen het vaakst voor. Het kan helpen om in de volgende bijeenkomst een voorbeeld te delen van iemand bij wie het toch lukte.',
};

function poortwachterZinnen(redenen = {}) {
  const z = [];
  const n = (k) => redenen[k] || 0;
  const keer = (x) => `${x} keer`;
  if (n('voeding')) z.push(`${keer(n('voeding'))} doorverwezen naar de coach vanwege een vraag over voeding of gewicht.`);
  if (n('medisch')) z.push(`${keer(n('medisch'))} doorverwezen naar de huisarts of coach vanwege een medische vraag.`);
  if (n('mentaal')) z.push(`${keer(n('mentaal'))} doorverwezen vanwege zorgen over hoe het met iemand ging.`);
  if (n('offtopic')) z.push(`${keer(n('offtopic'))} teruggebracht naar het onderwerp.`);
  return z;
}

export default async function handler(req, res) {
  cors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { data: inv } = await supabase
    .from('invites').select('id, label, context, start_date, verwacht_aantal_deelnemers, tenants(name)')
    .eq('id', req.query.id).maybeSingle();
  if (!inv) return res.status(404).json({ error: 'Groep niet gevonden' });

  // Alleen de view — nooit sessies direct.
  const { data: r } = await supabase.from('report_group').select('*').eq('invite_id', inv.id).maybeSingle();

  const week = inv.context === 'gli' ? weekSinceStart(inv.start_date) : null;
  const phase = phaseFor(week);
  const vandaag = new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam' });
  const start = inv.start_date ? new Date(inv.start_date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Zetjes groepsrapport ${inv.label}`, Author: 'Happly' } });
  doc.registerFont('sans', FONTS.sans);
  doc.registerFont('sansBold', FONTS.sansBold);
  doc.registerFont('serif', FONTS.serif);
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));

  const M = 48, W = doc.page.width - 2 * M;
  const box = (x, y, w, h, color, r = 8) => doc.save().fillColor(color).roundedRect(x, y, w, h, r).fill().restore();

  // ── 1. Kop: wit logo op magenta ────────────────────────────────
  box(M, M, W, 118, PINK, 10);
  doc.image(LOGO, M + 20, M + 16, { height: 30 });
  doc.font('serif').fontSize(24).fillColor('#FFFFFF').text(inv.label, M + 20, M + 52, { width: W - 40 });
  const kop = [
    inv.tenants?.name,
    CONTEXT_LABELS[inv.context] || inv.context,
    start ? `gestart ${start}` : null,
    phase ? `fase: ${PHASE_LABELS[phase]} (week ${week})` : null,
  ].filter(Boolean).join('  ·  ');
  doc.font('sans').fontSize(10).fillColor('#FFD6EC').text(kop, M + 20, M + 84, { width: W - 40 });
  doc.text(`Stand op ${vandaag}, sinds de start van de groep`, M + 20, M + 98, { width: W - 40 });

  let y = M + 136;
  const section = (title) => {
    doc.font('sansBold').fontSize(11).fillColor(TEXT).text(title, M, y);
    y += 16;
    doc.save().strokeColor(BORDER).lineWidth(0.6).moveTo(M, y).lineTo(M + W, y).stroke().restore();
    y += 10;
  };
  const para = (text, opts = {}) => {
    doc.font(opts.bold ? 'sansBold' : 'sans').fontSize(opts.size || 10).fillColor(opts.color || MID)
      .text(text, M, y, { width: W, lineGap: 2 });
    y = doc.y + (opts.after ?? 8);
  };

  // ── 2. Vier cijfers ────────────────────────────────────────────
  section('Kerncijfers');
  const cw = (W - 3 * 10) / 4;
  const kpis = r ? [
    [String(r.actieve_gebruikers), inv.verwacht_aantal_deelnemers ? `actieve gebruikers van ${inv.verwacht_aantal_deelnemers}` : 'actieve gebruikers'],
    [String(r.sessies), `sessies (${r.sessies_deze_maand} deze maand)`],
    [(r.sessies / r.actieve_gebruikers).toFixed(1).replace('.', ','), 'sessies per gebruiker'],
    [r.met_terugkoppeling ? `${Math.round((r.geholpen / r.met_terugkoppeling) * 100)}%` : '–', 'zegt dat het zetje hielp'],
  ] : [['< 5', 'actieve gebruikers'], ['–', 'sessies'], ['–', 'sessies per gebruiker'], ['–', 'zegt dat het zetje hielp']];
  kpis.forEach(([v, l], i) => {
    const x = M + i * (cw + 10);
    box(x, y, cw, 64, i === 0 ? PINK_L : '#FDFAFB', 8);
    doc.save().roundedRect(x, y, cw, 64, 8).lineWidth(0.6).stroke(BORDER).restore();
    doc.font('serif').fontSize(24).fillColor(i === 0 ? PINK : TEXT).text(v, x, y + 9, { width: cw, align: 'center' });
    doc.font('sans').fontSize(8).fillColor(SOFT).text(l, x + 6, y + 42, { width: cw - 12, align: 'center' });
  });
  y += 80;

  if (!r) {
    para('Er zijn nog te weinig gebruikers voor cijfers. Zetjes toont cijfers pas vanaf vijf actieve gebruikers in een groep, zodat niemand herkenbaar is.', { after: 8 });
  } else {
    // ── 3. Blokkades ─────────────────────────────────────────────
    section('Waar deelnemers op vastliepen');
    const b = r.blokkades || {};
    const totB = BLOKKADES.reduce((s, [k]) => s + (b[k] || 0), 0);
    if (totB) {
      let bx = M;
      BLOKKADES.forEach(([k, , col]) => {
        const w = ((b[k] || 0) / totB) * W;
        if (w > 0) { doc.save().fillColor(col).rect(bx, y, w, 12).fill().restore(); bx += w; }
      });
      y += 20;
      let lx = M;
      BLOKKADES.forEach(([k, l, col]) => {
        doc.save().fillColor(col).circle(lx + 4, y + 5, 4).fill().restore();
        const t = `${l}  ${b[k] || 0}`;
        doc.font('sans').fontSize(9).fillColor(MID).text(t, lx + 12, y, { lineBreak: false });
        lx += 12 + doc.widthOfString(t) + 18;
      });
      y += 20;
      const [topK, topL] = BLOKKADES.reduce((best, cur) => ((b[cur[0]] || 0) > (b[best[0]] || 0) ? cur : best));
      let duiding = `${topL} was het meest voorkomend.`;
      if (phase && FASE_VERWACHT[phase]?.includes(topK)) duiding += ' Dat past bij de fase waarin de groep zit.';
      para(duiding);
    } else {
      para('Nog geen blokkades herkend.');
    }

    // ── 4. Risicomomenten (alleen GLI) ───────────────────────────
    if (inv.context === 'gli') {
      section('Risicomomenten');
      const m = r.momenten || {};
      const actief = Object.entries(MOMENTEN).filter(([k]) => m[k]);
      if (actief.length) actief.forEach(([k, l]) => para(`${l}: ${m[k]} keer`, { after: 3 }));
      else para('Geen van de vier risicomomenten kwam voor.');
      y += 5;
    }

    // ── 5. Poortwachter ──────────────────────────────────────────
    section('Doorverwijzingen');
    const pz = poortwachterZinnen(r.poortwachter_redenen);
    if (pz.length) pz.forEach((z) => para(z, { after: 3 }));
    else para('Zetjes hoefde niemand door te verwijzen.');
    y += 5;

    // ── 6. Suggestie voor de coach ───────────────────────────────
    const m = r.momenten || {};
    const topMoment = Object.keys(SUGGESTIE_MOMENT).sort((a, c) => (m[c] || 0) - (m[a] || 0))[0];
    const [topB] = BLOKKADES.reduce((best, cur) => ((b[cur[0]] || 0) > (b[best[0]] || 0) ? cur : best));
    const suggestie = inv.context === 'gli' && (m[topMoment] || 0) >= 2 ? SUGGESTIE_MOMENT[topMoment]
      : totB ? SUGGESTIE_BLOKKADE[topB] : null;
    if (suggestie) {
      section('Suggestie voor de coach');
      doc.font('sans').fontSize(10);
      const h = doc.heightOfString(suggestie, { width: W - 28, lineGap: 2 }) + 24;
      box(M, y, W, h, PINK_L, 8);
      doc.fillColor(PLUM).text(suggestie, M + 14, y + 12, { width: W - 28, lineGap: 2 });
      y += h + 10;
    }
  }

  // ── Voet ───────────────────────────────────────────────────────
  doc.page.margins.bottom = 0; // anders zet pdfkit de voet op een tweede pagina
  const fy = doc.page.height - 44;
  doc.save().strokeColor(BORDER).lineWidth(0.5).moveTo(M, fy).lineTo(M + W, fy).stroke().restore();
  doc.font('sans').fontSize(7.5).fillColor(SOFT).text(
    'Zetjes door Happly  ·  Alleen samengevoegde cijfers, pas vanaf vijf actieve gebruikers  ·  Nooit wie, nooit wat',
    M, fy + 8, { width: W, align: 'center', lineBreak: false });

  doc.end();
  await new Promise((resolve) => doc.on('end', resolve));
  const pdf = Buffer.concat(chunks);
  const filename = `zetjes-groepsrapport-${inv.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', pdf.length);
  return res.status(200).send(pdf);
}
