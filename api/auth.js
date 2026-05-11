const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function dbGet(table, filters = {}) {
  const qs = Object.entries(filters).map(([k, v]) => `${k}=eq.${v}`).join('&');
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}&select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }
  });
  return resp.json();
}

async function dbInsert(table, row) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(row)
  });
  const data = await resp.json();
  return { data, ok: resp.ok, status: resp.status };
}

async function dbUpdate(table, filters, updates) {
  const qs = Object.entries(filters).map(([k, v]) => `${k}=eq.${v}`).join('&');
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(updates)
  });
  return resp.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { action } = req.query;

  // ── 签到 ──
  if (action === 'checkin' && req.method === 'POST') {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'missing user_id' });

    const today = new Date().toISOString().slice(0, 10);

    // 检查今天是否已签到
    const existing = await dbGet('check_ins', { user_id, checked_at: today });
    if (existing?.length > 0) return res.status(400).json({ error: '今天已经签到了' });

    // 写签到记录
    const { ok, status } = await dbInsert('check_ins', { user_id, checked_at: today });
    if (!ok && status !== 409) return res.status(400).json({ error: '签到失败' });

    // 加10慧根值
    const profiles = await dbGet('user_profiles', { id: user_id });
    const credits = (profiles?.[0]?.credits || 0) + 10;
    await dbUpdate('user_profiles', { id: user_id }, { credits });
    await dbInsert('credit_logs', { user_id, amount: 10, reason: 'checkin' });

    return res.status(200).json({ credits });
  }

  // ── 获取用户信息 ──
  if (action === 'profile' && req.method === 'GET') {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'missing user_id' });

    const profiles = await dbGet('user_profiles', { id: user_id });
    const profile = profiles?.[0];

    const today = new Date().toISOString().slice(0, 10);
    const checkins = await dbGet('check_ins', { user_id, checked_at: today });

    return res.status(200).json({ ...profile, checked_in_today: checkins?.length > 0 });
  }

  // ── 消耗慧根值 ──
  if (action === 'deduct' && req.method === 'POST') {
    const { user_id, amount = 5 } = req.body;
    if (!user_id) return res.status(400).json({ error: 'missing user_id' });

    const profiles = await dbGet('user_profiles', { id: user_id });
    const profile = profiles?.[0];

    if (!profile || profile.credits < amount) {
      return res.status(402).json({ error: '慧根值不足', credits: profile?.credits || 0 });
    }

    const credits = profile.credits - amount;
    await dbUpdate('user_profiles', { id: user_id }, { credits });
    await dbInsert('credit_logs', { user_id, amount: -amount, reason: 'ai_call' });

    return res.status(200).json({ credits });
  }

  return res.status(404).json({ error: 'unknown action' });
}
