// TIJDELIJK: vergelijkt de live admin-sleutel zonder hem te tonen.
import crypto from 'crypto';
export default function handler(req, res) {
  const k = process.env.ADMIN_KEY || '';
  const fp = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 6);
  const sent = req.headers['x-admin-key'] || '';
  res.status(200).json({
    omgeving: process.env.VERCEL_ENV || 'onbekend',
    server: { lengte: k.length, spaties: /\s/.test(k), vingerafdruk: k ? fp(k) : null },
    verstuurd: { lengte: sent.length, vingerafdruk: sent ? fp(sent) : null },
    gelijk: !!k && k === sent,
  });
}
