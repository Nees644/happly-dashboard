// api/dashboard/tenants.js
// GET   ?slug=...                                  → gegevens van één klant (voor het bewerkformulier)
// POST  { name, slug, type, contact_email, rapportage_frequentie, agb_code_aanbieder, gli_programma }
// PATCH { slug, active } of { slug, fields: { type, contact_email, ... } }
// Links (groepen) maak je daarna aan via /api/dashboard/groups.

import { supabase, cors, isAdmin, TENANT_TYPES, GLI_PROGRAMMAS, RAPPORTAGE } from '../_lib/common.js';

const FIELDS = 'id, name, slug, active, type, contact_email, rapportage_frequentie, agb_code_aanbieder, gli_programma, created_at';

// Valideert en normaliseert de bewerkbare velden. Geeft { values } of { error }.
function cleanFields(input = {}) {
  const v = {};
  if (input.name !== undefined) {
    if (!String(input.name).trim()) return { error: 'Naam is verplicht' };
    v.name = String(input.name).trim();
  }
  if (input.type !== undefined) {
    if (!TENANT_TYPES.includes(input.type)) return { error: 'Onbekend type' };
    v.type = input.type;
  }
  if (input.contact_email !== undefined) {
    const e = String(input.contact_email || '').trim();
    if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { error: 'Contact-e-mail klopt niet' };
    v.contact_email = e || null;
  }
  if (input.rapportage_frequentie !== undefined) {
    if (!RAPPORTAGE.includes(input.rapportage_frequentie)) return { error: 'Onbekende rapportagefrequentie' };
    v.rapportage_frequentie = input.rapportage_frequentie;
  }
  const isGli = (v.type ?? input.type) === 'gli_aanbieder';
  if (input.agb_code_aanbieder !== undefined || input.type !== undefined) {
    const agb = String(input.agb_code_aanbieder || '').replace(/\s/g, '');
    if (isGli && agb && !/^[0-9]{8}$/.test(agb)) return { error: 'AGB-code aanbieder moet uit 8 cijfers bestaan' };
    v.agb_code_aanbieder = isGli && agb ? agb : null;
  }
  if (input.gli_programma !== undefined || input.type !== undefined) {
    const p = input.gli_programma || null;
    if (isGli && p && !GLI_PROGRAMMAS.includes(p)) return { error: 'Onbekend GLI-programma' };
    v.gli_programma = isGli ? p : null;
  }
  return { values: v };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('tenants').select(FIELDS).eq('slug', req.query.slug).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Klant niet gevonden' });
    return res.status(200).json({ tenant: data });
  }

  if (req.method === 'POST') {
    const { slug } = req.body || {};
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Slug: alleen kleine letters, cijfers en -' });
    const { values, error: vErr } = cleanFields({ type: 'werkgever', rapportage_frequentie: 'maandelijks', ...req.body });
    if (vErr) return res.status(400).json({ error: vErr });
    if (!values.name) return res.status(400).json({ error: 'Naam is verplicht' });

    const { data: tenant, error } = await supabase
      .from('tenants').insert({ ...values, slug }).select(FIELDS).single();
    if (error) {
      const dubbel = error.code === '23505';
      return res.status(dubbel ? 409 : 500).json({ error: dubbel ? 'Deze slug bestaat al' : error.message });
    }

    // Zetjes is het enige product dat groepen gebruikt
    const { data: product } = await supabase.from('products').select('id').eq('slug', 'zetjes').single();
    if (product) await supabase.from('tenant_products').insert({ tenant_id: tenant.id, product_id: product.id });

    return res.status(200).json({ tenant });
  }

  if (req.method === 'PATCH') {
    const { slug, active, fields } = req.body || {};
    if (!slug) return res.status(400).json({ error: 'slug ontbreekt' });
    let update = {};
    if (typeof active === 'boolean') update.active = active;
    if (fields) {
      const { values, error: vErr } = cleanFields(fields);
      if (vErr) return res.status(400).json({ error: vErr });
      update = { ...update, ...values };
    }
    const { data, error } = await supabase.from('tenants').update(update).eq('slug', slug).select(FIELDS).single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, tenant: data });
  }

  return res.status(405).end();
}
