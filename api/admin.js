const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_EMAIL = 'zhangyuqi2017er@gmail.com';

const SH = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json'
};

async function q(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SH });
  return r.json();
}

async function count(table, filter = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filter}&select=id&limit=1`;
  const r = await fetch(url, { headers: { ...SH, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } });
  const cr = r.headers.get('content-range') || '';
  const n = parseInt(cr.split('/')[1]);
  return isNaN(n) ? 0 : n;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  // Verify caller is admin
  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` }
  });
  const user = await userResp.json();
  if (user?.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'forbidden' });

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const [
    totalUsers, newToday, newWeek, totalQA, qaToday, totalCheckins,
    profiles, recentUsers, mentorStats, modeStats, txSummary, dailyQA
  ] = await Promise.all([
    count('user_profiles'),
    count('user_profiles', `created_at=gte.${today}`),
    count('user_profiles', `created_at=gte.${weekAgo}`),
    count('qa_history'),
    count('qa_history', `created_at=gte.${today}`),
    count('check_ins'),
    q('user_profiles?select=credits,total_earned,total_spent'),
    q('user_profiles?select=id,email,credits,invite_code,created_at&order=created_at.desc&limit=20'),
    q('qa_history?select=mentor_name&mentor_name=neq.&mentor_name=not.is.null&limit=5000'),
    q('qa_history?select=mode&limit=5000'),
    q('huigen_transactions?select=amount,type&limit=5000'),
    q(`qa_history?select=created_at&created_at=gte.${weekAgo}&limit=5000`)
  ]);

  res.status(200).json({
    totalUsers, newToday, newWeek, totalQA, qaToday, totalCheckins,
    profiles, recentUsers, mentorStats, modeStats, txSummary, dailyQA
  });
}
