// api/_lib/common.js
// Gedeelde helpers voor de dashboard-routes (bestanden met _ worden geen route).

import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const TENANT_TYPES = ['werkgever', 'gli_aanbieder', 'salesorganisatie', 'personal', 'overig'];
export const GLI_PROGRAMMAS = ['CooL', 'BeweegKuur', 'SLIMMER', 'SSiB', 'X-Fittt', 'KeerDiabetes2Om'];
export const RAPPORTAGE = ['maandelijks', 'kwartaal', 'geen'];
export const CONTEXTS = ['werk', 'ondernemen', 'sales', 'managers', 'gli'];

export function cors(res, methods = 'GET, POST, PATCH, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
}

export function isAdmin(req) {
  return !!process.env.ADMIN_KEY && req.headers['x-admin-key'] === process.env.ADMIN_KEY;
}

// Zelfde regels als de app: week 0 = week van de startdatum, bij overlap wint de latere fase.
export function weekSinceStart(startDate) {
  if (!startDate) return null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date());
  const days = Math.floor((Date.parse(today) - Date.parse(startDate)) / 86400000);
  return Math.max(0, Math.floor(days / 7));
}

export function phaseFor(week) {
  if (week == null) return null;
  if (week < 3) return 'start';
  if (week < 12) return 'eerste_terugval';
  if (week < 39) return 'behandelfase';
  if (week < 52) return 'overgang';
  return 'onderhoud';
}

export const PHASE_LABELS = {
  start: 'Start',
  eerste_terugval: 'Eerste terugval',
  behandelfase: 'Behandelfase',
  overgang: 'Overgang',
  onderhoud: 'Onderhoud',
};

export const COACH_INSTRUCTIE = 'Dit is de link naar Zetjes voor jouw groep. Deel hem bij de eerste bijeenkomst en zeg erbij: dit is je hulpje tussendoor, voor als het even niet lukt. Noem Zetjes daarna elke bijeenkomst één keer. Je ziet in je overzicht hoeveel deelnemers het gebruiken, nooit wie of wat.';

export function appUrl() {
  return (process.env.APP_URL || 'https://happly-zetjes.vercel.app').replace(/\/$/, '');
}
