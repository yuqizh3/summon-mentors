const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

async function dbGet(table, filters = {}, select = '*', order = '') {
  let qs = Object.entries(filters).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  if (order) qs += '&order=' + order;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}&select=${select}`, { headers: H });
  return r.json();
}
async function dbInsert(table, row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row)
  });
  return { data: await r.json(), ok: r.ok, status: r.status };
}
async function dbUpdate(table, filters, updates) {
  const qs = Object.entries(filters).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(updates)
  });
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // ── 注册初始化 ──
  if (action === 'register' && req.method === 'POST') {
    const { email, invite_code } = req.body || {};
    // Profile created by DB trigger, just log transaction
    // (trigger handles 100 credits bonus)
    return res.status(200).json({ ok: true });
  }

  // ── 消耗慧根值 ──
  if (action === 'deduct' && req.method === 'POST') {
    const { user_id, amount = 5, description = 'AI功能' } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'missing user_id' });

    const profiles = await dbGet('user_profiles', { id: user_id });
    const profile = profiles?.[0];
    if (!profile || profile.credits < amount) {
      return res.status(402).json({ error: '慧根值不足', credits: profile?.credits || 0 });
    }

    const newCredits = profile.credits - amount;
    const newSpent = (profile.total_spent || 0) + amount;
    await dbUpdate('user_profiles', { id: user_id }, { credits: newCredits, total_spent: newSpent });

    // Log transaction
    await dbInsert('huigen_transactions', {
      user_id, amount: -amount, type: 'usage_cost', description
    }).catch(() => {});

    return res.status(200).json({ credits: newCredits });
  }

  // ── 每日签到 ──
  if (action === 'checkin' && req.method === 'POST') {
    const { user_id } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'missing user_id' });

    const today = new Date().toISOString().slice(0, 10);

    // 检查今天是否已签到
    const existing = await dbGet('check_ins', { user_id, checked_at: today });
    if (existing?.length > 0) {
      return res.status(200).json({ already_checked: true, credits: (await dbGet('user_profiles', { id: user_id }))?.[0]?.credits });
    }

    // 计算连续签到天数
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const lastCheckins = await dbGet('check_ins', { user_id }, 'streak_count,checked_at', 'checked_at.desc');
    const last = lastCheckins?.[0];
    let streak = 1;
    if (last?.checked_at === yesterday) {
      streak = (last.streak_count || 1) + 1;
    }

    // 双倍奖励：每第7天
    const reward = (streak % 7 === 0) ? 10 : 5;

    // 写签到记录
    await dbInsert('check_ins', { user_id, checked_at: today, streak_count: streak, reward_amount: reward });

    // 更新积分
    const profiles = await dbGet('user_profiles', { id: user_id });
    const profile = profiles?.[0];
    const newCredits = (profile?.credits || 0) + reward;
    const newEarned = (profile?.total_earned || 0) + reward;
    await dbUpdate('user_profiles', { id: user_id }, { credits: newCredits, total_earned: newEarned });

    // Log transaction
    const txType = streak % 7 === 0 ? 'streak_bonus' : 'daily_checkin';
    await dbInsert('huigen_transactions', {
      user_id, amount: reward, type: txType,
      description: streak % 7 === 0 ? `连续签到${streak}天双倍奖励` : '每日签到'
    }).catch(() => {});

    return res.status(200).json({ credits: newCredits, reward, streak, already_checked: false });
  }

  // ── 获取个人资料 ──
  if (action === 'profile' && req.method === 'GET') {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'missing user_id' });
    const profiles = await dbGet('user_profiles', { id: user_id });
    return res.status(200).json(profiles?.[0] || {});
  }

  return res.status(404).json({ error: 'unknown action' });
}
