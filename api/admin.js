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
  if (!r.ok) return [];
  return r.json();
}

async function count(table, filter = '') {
  const qs = filter ? `${filter}&select=id` : `select=id`;
  const url = `${SUPABASE_URL}/rest/v1/${table}?${qs}&limit=1`;
  const r = await fetch(url, { headers: { ...SH, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } });
  const cr = r.headers.get('content-range') || '';
  const n = parseInt(cr.split('/')[1]);
  return isNaN(n) ? 0 : n;
}

async function getAuthUsers(limit = 20) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=${limit}&page=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  if (!r.ok) return [];
  const d = await r.json();
  return d.users || [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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

  const action = req.query?.action;

  // ── 积分空投：给选中的用户发慧根 ──
  if (req.method === 'POST' && action === 'airdrop') {
    const { user_ids, amount, note } = req.body || {};
    const amt = Math.floor(Number(amount));
    if (!Array.isArray(user_ids) || !user_ids.length || !amt || amt <= 0) {
      return res.status(400).json({ error: '参数无效：需要用户列表和正整数积分' });
    }
    const ids = user_ids.slice(0, 1000);
    const profs = await q(`user_profiles?id=in.(${ids.join(',')})&select=id,credits,total_earned`);
    const byId = {}; (profs || []).forEach(p => { byId[p.id] = p; });
    let granted = 0;
    for (const id of ids) {
      const p = byId[id];
      const cur = p?.credits ?? 0;
      const earned = p?.total_earned ?? 0;
      // profile 不存在则先建一个（Google 用户可能没 trigger）
      if (!p) {
        await fetch(`${SUPABASE_URL}/rest/v1/user_profiles`, {
          method: 'POST', headers: { ...SH, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ id, credits: amt, total_earned: amt, total_spent: 0, invite_code: Math.random().toString(36).substring(2, 8).toUpperCase() })
        }).catch(() => {});
      } else {
        await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${id}`, {
          method: 'PATCH', headers: { ...SH, Prefer: 'return=minimal' },
          body: JSON.stringify({ credits: cur + amt, total_earned: earned + amt })
        });
      }
      await fetch(`${SUPABASE_URL}/rest/v1/huigen_transactions`, {
        method: 'POST', headers: { ...SH, Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: id, amount: amt, type: 'admin_grant', description: note ? String(note).slice(0, 60) : '管理员空投' })
      }).catch(() => {});
      granted++;
    }
    return res.status(200).json({ ok: true, granted, amount: amt });
  }

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [
    totalUsers, newToday, newWeek, totalQA, qaToday, totalCheckins,
    profiles, profilesRecent, authUsers, mentorStats, modeStats, txSummary,
    signups30, qa30, checkins30, tx30
  ] = await Promise.all([
    count('user_profiles'),
    count('user_profiles', `created_at=gte.${today}`),
    count('user_profiles', `created_at=gte.${weekAgo}`),
    count('qa_history'),
    count('qa_history', `created_at=gte.${today}`),
    count('check_ins'),
    q('user_profiles?select=credits,total_earned,total_spent'),
    q('user_profiles?select=id,credits,invite_code,created_at&order=created_at.desc&limit=500'),
    getAuthUsers(200),
    q('qa_history?select=mentor_name&mentor_name=not.is.null&limit=5000'),
    q('qa_history?select=mode&limit=5000'),
    q('huigen_transactions?select=amount,type&limit=5000'),
    q(`user_profiles?select=created_at&created_at=gte.${monthAgo}&limit=10000`),
    q(`qa_history?select=created_at&created_at=gte.${monthAgo}&limit=10000`),
    q(`check_ins?select=checked_at&checked_at=gte.${monthAgo}&limit=10000`),
    q(`huigen_transactions?select=amount,type,created_at&created_at=gte.${monthAgo}&limit=10000`)
  ]);

  // Merge auth email into profile rows
  const emailMap = {};
  (authUsers || []).forEach(u => { emailMap[u.id] = u.email; });
  const withEmail = (profilesRecent || []).map(p => ({ ...p, email: emailMap[p.id] || '' }));
  const recentUsers = withEmail.slice(0, 20);       // 最近注册表格
  const allUsers = withEmail.map(p => ({ id: p.id, email: p.email, credits: p.credits ?? 0, created_at: p.created_at })); // 空投选择器

  res.status(200).json({
    totalUsers, newToday, newWeek, totalQA, qaToday, totalCheckins,
    profiles, recentUsers, allUsers, mentorStats, modeStats, txSummary,
    dailyQA: qa30, signups30, qa30, checkins30, tx30
  });
}
