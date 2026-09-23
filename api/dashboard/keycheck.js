// TIJDELIJK: vergelijkt de admin-sleutel zonder hem te tonen. Alleen actief in previews.
import crypto from 'crypto';
export default function handler(req, res) {
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).end();
  const k = process.env.ADMIN_KEY || '';
  const fp = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 6);
  const sent = req.headers['x-admin-key'] || '';
  res.status(200).json({
    server: { lengte: k.length, spaties: /\s/.test(k), vingerafdruk: k ? fp(k) : null },
    verstuurd: { lengte: sent.length, vingerafdruk: sent ? fp(sent) : null },
    gelijk: !!k && k === sent,
  });
}
