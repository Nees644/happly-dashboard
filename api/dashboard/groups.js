// api/dashboard/groups.js
// Een groep is een invite met een label: één link voor een groep deelnemers of medewerkers.
//
// GET   ?tenant=slug   → groepen van die klant, met cijfers uit de view report_group
//                        (die geeft alleen rijen bij 5 of meer actieve gebruikers)
// POST  { tenantSlug, context, label, start_date, verwacht_aantal_deelnemers,
//         expires_at, max_uses, agb_code_coach, coach_signaal_aan }
//                      → maakt de groep aan, geeft link, QR-code en coachinstructie terug
// PATCH { id, active } → groep (de)activeren

import QRCode from 'qrcode';
import {
  supabase, cors, isAdmin, CONTEXTS, weekSinceStart, phaseFor, PHASE_LABELS, COACH_INSTRUCTIE, appUrl,
} from '../_lib/common.js';

const INVITE_FIELDS = 'id, token, label, context, start_date, expires_at, max_uses, verwacht_aantal_deelnemers, agb_code_coach, coach_signaal_aan, active, created_at';

function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function linkFor(token) {
  return `${appUrl()}/?token=${token}`;
}

async function loadTenant(slug) {
  const { data } = await supabase.from('tenants').select('id, name, slug, type').eq('slug', slug).maybeSingle();
  return data;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  // ── Overzicht ────────────────────────────────────────────────
  if (req.method === 'GET') {
    const tenant = await loadTenant(req.query.tenant);
    if (!tenant) return res.status(404).json({ error: 'Klant niet gevonden' });

    const { data: invites, error } = await supabase
      .from('invites').select(INVITE_FIELDS)
      .eq('tenant_id', tenant.id).not('label', 'is', null)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    // Alleen de view: nooit sessies direct lezen voor groepscijfers.
    const { data: report } = await supabase.from('report_group').select('*').eq('tenant_id', tenant.id);
    const byInvite = Object.fromEntries((report || []).map((r) => [r.invite_id, r]));

    const { count: losseLinks } = await supabase
      .from('invites').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).is('label', null);

    const groups = (invites || []).map((i) => {
      const week = i.context === 'gli' ? weekSinceStart(i.start_date) : null;
      const phase = phaseFor(week);
      const r = byInvite[i.id];
      return {
        id: i.id,
        label: i.label,
        context: i.context,
        start_date: i.start_date,
        expires_at: i.expires_at,
        max_uses: i.max_uses,
        verwacht: i.verwacht_aantal_deelnemers,
        coach_signaal_aan: i.coach_signaal_aan,
        active: i.active,
        verlopen: !!i.expires_at && Date.parse(i.expires_at) <= Date.now(),
        link: linkFor(i.token),
        week,
        phase,
        phase_label: phase ? PHASE_LABELS[phase] : null,
        cijfers: r ? {
          actieve_gebruikers: r.actieve_gebruikers,
          sessies: r.sessies,
          sessies_deze_maand: r.sessies_deze_maand,
          geholpen: r.geholpen,
          met_terugkoppeling: r.met_terugkoppeling,
          poortwachter: r.poortwachter,
          laatste_activiteit: r.laatste_activiteit,
          blokkades: r.blokkades,
          momenten: r.momenten,
          poortwachter_redenen: r.poortwachter_redenen,
        } : null,
      };
    });

    return res.status(200).json({ tenant, groups, losse_links: losseLinks || 0 });
  }

  // ── Groep aanmaken ───────────────────────────────────────────
  if (req.method === 'POST') {
    const b = req.body || {};
    const tenant = await loadTenant(b.tenantSlug);
    if (!tenant) return res.status(404).json({ error: 'Klant niet gevonden' });

    const context = b.context;
    if (!CONTEXTS.includes(context)) return res.status(400).json({ error: 'Kies een context' });
    const label = String(b.label || '').trim();
    if (!label) return res.status(400).json({ error: 'Geef de groep een naam' });

    const start = b.start_date || null;
    if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) return res.status(400).json({ error: 'Startdatum klopt niet' });
    if (context === 'gli' && !start) return res.status(400).json({ error: 'Startdatum is verplicht bij een leefstijlprogramma' });

    const today = new Date().toISOString().slice(0, 10);
    let expires = b.expires_at || (context === 'gli' ? addMonths(start, 24) : addMonths(today, 12));
    if (!/^\d{4}-\d{2}-\d{2}/.test(expires)) return res.status(400).json({ error: 'Geldig tot klopt niet' });
    // Einde van die dag in Nederland (21:59 UTC valt in zomer- en wintertijd vóór middernacht)
    expires = expires.slice(0, 10) + 'T21:59:59Z';

    const toInt = (x) => (x === '' || x == null ? null : parseInt(x, 10));
    const maxUses = toInt(b.max_uses);
    const verwacht = toInt(b.verwacht_aantal_deelnemers);
    if (maxUses !== null && !(maxUses > 0)) return res.status(400).json({ error: 'Maximaal aantal gebruikers moet 1 of meer zijn' });
    if (verwacht !== null && !(verwacht >= 0)) return res.status(400).json({ error: 'Verwacht aantal deelnemers klopt niet' });

    const agbCoach = String(b.agb_code_coach || '').replace(/\s/g, '');
    if (agbCoach && !/^[0-9]{8}$/.test(agbCoach)) return res.status(400).json({ error: 'AGB-code coach moet uit 8 cijfers bestaan' });

    const { data: product } = await supabase.from('products').select('id').eq('slug', 'zetjes').single();

    const { data: invite, error } = await supabase.from('invites').insert({
      tenant_id: tenant.id,
      product_id: product?.id || null,
      context,
      theme: ['werk', 'ondernemen'].includes(context) ? context : 'werk',
      label,
      start_date: start,
      expires_at: expires,
      max_uses: maxUses,
      verwacht_aantal_deelnemers: verwacht,
      agb_code_coach: context === 'gli' && agbCoach ? agbCoach : null,
      coach_signaal_aan: context === 'gli' ? !!b.coach_signaal_aan : false,
    }).select(INVITE_FIELDS).single();
    if (error) return res.status(500).json({ error: error.message });

    const link = linkFor(invite.token);
    const qr = await QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: '#1A0A12', light: '#FFFFFF' } });

    return res.status(200).json({
      group: { ...invite, link },
      qr,
      instructie: context === 'gli' ? COACH_INSTRUCTIE : null,
    });
  }

  // ── Groep (de)activeren ──────────────────────────────────────
  if (req.method === 'PATCH') {
    const { id, active } = req.body || {};
    if (!id || typeof active !== 'boolean') return res.status(400).json({ error: 'id en active zijn verplicht' });
    const { error } = await supabase.from('invites').update({ active }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
