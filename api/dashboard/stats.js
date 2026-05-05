// api/dashboard/stats.js
// GET /api/dashboard/stats                        → alle tenants
// GET /api/dashboard/stats?tenant=slug            → detail tenant (alle producten)
// GET /api/dashboard/stats?tenant=slug&product=slug → detail per product

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
}

function getWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - y) / 86400000) + 1) / 7);
}

async function tenantProductStats(tenantId, productId = null) {
  let query = supabase.from('sessions')
    .select('created_at, feedback, blocker_type, anon_id')
    .eq('tenant_id', tenantId);
  if (productId) query = query.eq('product_id', productId);

  const { data: sessions } = await query.order('created_at', { ascending: true });

  const fb = { ja: 0, beetje: 0, nee: 0, skip: 0 };
  const blockerMap = {};
  const uniqueUsers = new Set();
  const weekMap = {};

  for (let w = 11; w >= 0; w--) {
    const d = new Date(); d.setDate(d.getDate() - w * 7);
    const key = `${d.getFullYear()}-W${String(getWeek(d)).padStart(2,'0')}`;
    weekMap[key] = { week: key, sessions: 0, users: new Set() };
  }

  (sessions || []).forEach(s => {
    if (s.feedback && fb[s.feedback] !== undefined) fb[s.feedback]++;
    if (s.blocker_type) blockerMap[s.blocker_type] = (blockerMap[s.blocker_type] || 0) + 1;
    if (s.anon_id) uniqueUsers.add(s.anon_id);
    const d = new Date(s.created_at);
    const key = `${d.getFullYear()}-W${String(getWeek(d)).padStart(2,'0')}`;
    if (weekMap[key]) { weekMap[key].sessions++; weekMap[key].users.add(s.anon_id); }
  });

  const totalSessions = sessions?.length || 0;
  const uUsers = uniqueUsers.size;
  const withFb = fb.ja + fb.beetje + fb.nee;
  const effectScore = withFb > 0
    ? Math.round(((fb.ja + fb.beetje * 0.5) / withFb) * 100) : null;

  return {
    total_sessions: totalSessions,
    unique_users: uUsers,
    avg_sessions_per_user: uUsers > 0 ? parseFloat((totalSessions / uUsers).toFixed(1)) : 0,
    effect_score: effectScore,
    feedback: fb,
    blockers: Object.entries(blockerMap).sort((a,b) => b[1]-a[1]).map(([type,count]) => ({type,count})),
    weekly: Object.values(weekMap).map(w => ({ week: w.week, sessions: w.sessions, users: w.users.size })),
  };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const { tenant: tenantSlug, product: productSlug } = req.query;

  // Verbindingscheck — geeft duidelijke fout als credentials ontbreken
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase credentials ontbreken in environment variables' });
  }

  // ── Overzicht alle tenants ──
  if (!tenantSlug) {
    const { data: tenants, error: tErr } = await supabase
      .from('tenants').select('id, name, slug, active, created_at')
      .order('created_at', { ascending: false });

    if (tErr) return res.status(500).json({ error: 'Database fout: ' + tErr.message });

    const { data: products } = await supabase
      .from('products').select('id, slug, name').eq('active', true);

    const results = await Promise.all((tenants || []).map(async t => {
      // Welke producten heeft deze tenant
      const { data: tp } = await supabase
        .from('tenant_products')
        .select('product_id, products(slug, name)')
        .eq('tenant_id', t.id).eq('active', true);

      const productStats = await Promise.all((tp || []).map(async p => {
        const stats = await tenantProductStats(t.id, p.product_id);
        return { slug: p.products.slug, name: p.products.name, ...stats };
      }));

      // Totalen over alle producten
      const totalSessions = productStats.reduce((s, p) => s + p.total_sessions, 0);
      const uniqueUsers   = productStats.reduce((s, p) => s + p.unique_users, 0);

      const { data: last } = await supabase.from('sessions')
        .select('created_at').eq('tenant_id', t.id)
        .order('created_at', { ascending: false }).limit(1);

      return {
        id: t.id, name: t.name, slug: t.slug, active: t.active, created_at: t.created_at,
        total_sessions: totalSessions,
        unique_users: uniqueUsers,
        last_session: last?.[0]?.created_at || null,
        products: productStats,
      };
    }));

    const { data: allProducts } = await supabase.from('products').select('id, slug, name').eq('active', true);
    return res.status(200).json({ tenants: results, products: allProducts || [] });
  }

  // ── Detail voor één tenant ──
  const { data: tenant } = await supabase
    .from('tenants').select('id, name, slug, active').eq('slug', tenantSlug).single();
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  // Welke producten heeft tenant
  const { data: tp } = await supabase
    .from('tenant_products')
    .select('product_id, products(slug, name)')
    .eq('tenant_id', tenant.id).eq('active', true);

  // Invites per product
  const { count: totalInvites } = await supabase.from('invites')
    .select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id);
  const { count: usedInvites } = await supabase.from('invites')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id).not('used_at', 'is', null);

  // Als product filter meegegeven
  let filteredProductId = null;
  if (productSlug) {
    const found = (tp || []).find(p => p.products.slug === productSlug);
    filteredProductId = found?.product_id || null;
  }

  const stats = await tenantProductStats(tenant.id, filteredProductId);

  const productList = await Promise.all((tp || []).map(async p => {
    const ps = await tenantProductStats(tenant.id, p.product_id);
    return { slug: p.products.slug, name: p.products.name, ...ps };
  }));

  return res.status(200).json({
    tenant,
    stats: { ...stats, total_invites: totalInvites || 0, used_invites: usedInvites || 0 },
    feedback: stats.feedback,
    blockers: stats.blockers,
    weekly: stats.weekly,
    products: productList,
    active_product: productSlug || null,
  });
}
