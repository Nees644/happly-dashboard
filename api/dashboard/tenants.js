// api/dashboard/tenants.js
// POST { name, slug, products: [{slug, theme}], inviteCount }
// PATCH { slug, active }

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const VALID_THEMES = ['werk', 'ondernemen'];

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'POST') {
    const { name, slug, products: productList = [], inviteCount = 10 } = req.body || {};
    if (!name || !slug) return res.status(400).json({ error: 'name en slug zijn verplicht' });
    if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Slug: alleen kleine letters, cijfers en -' });

    // productList is array van { slug, theme } of legacy array van strings
    const normalizedProducts = productList.map(p =>
      typeof p === 'string'
        ? { slug: p, theme: 'werk' }
        : { slug: p.slug, theme: VALID_THEMES.includes(p.theme) ? p.theme : 'werk' }
    );

    // Maak tenant aan
    const { data: tenant, error: tErr } = await supabase
      .from('tenants').insert({ name, slug }).select('id, name, slug').single();
    if (tErr) return res.status(500).json({ error: tErr.message });

    const allLinks = {};
    const appUrl = process.env.APP_URL || 'https://jouw-app.vercel.app';

    for (const { slug: productSlug, theme } of normalizedProducts) {
      const { data: product, error: pErr } = await supabase
        .from('products').select('id, name').eq('slug', productSlug).single();
      if (pErr || !product) continue;

      // Tenant-product koppeling
      await supabase.from('tenant_products').insert({ tenant_id: tenant.id, product_id: product.id });

      // Invites aanmaken met thema
      const inserts = Array.from({ length: inviteCount }, () => ({
        tenant_id: tenant.id,
        product_id: product.id,
        theme,
      }));
      const { data: invites } = await supabase.from('invites').insert(inserts).select('token');

      const key = `${productSlug}__${theme}`;
      allLinks[key] = {
        productSlug,
        theme,
        label: `${productSlug.charAt(0).toUpperCase() + productSlug.slice(1)} — thema: ${theme}`,
        links: (invites || []).map(i => `${appUrl}/?token=${i.token}`)
      };
    }

    return res.status(200).json({ tenant, links: allLinks });
  }

  if (req.method === 'PATCH') {
    const { slug, active } = req.body || {};
    const { error } = await supabase.from('tenants').update({ active }).eq('slug', slug);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
