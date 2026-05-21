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

  // ── 注册初始化（Google OAuth 用户 trigger 未触发时兜底）──
  if (action === 'register' && req.method === 'POST') {
    const { user_id } = req.body || {};
    if (!user_id) return res.status(200).json({ ok: true });

    const profiles = await dbGet('user_profiles', { id: user_id });
    if (!profiles?.[0]) {
      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      await dbInsert('user_profiles', { id: user_id, credits: 100, total_earned: 100, total_spent: 0, invite_code: inviteCode });
      await dbInsert('huigen_transactions', { user_id, amount: 100, type: 'signup_bonus', description: '注册奖励' }).catch(() => {});
    }
    return res.status(200).json({ ok: true });
  }

  // ── 注册（跳过邮件确认）──
  if (action === 'signup' && req.method === 'POST') {
    const { email, password, invite_code } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: '缺少邮箱或密码' });

    // Create user via admin API so email is auto-confirmed
    const adminResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true })
    });
    const adminData = await adminResp.json();
    if (!adminResp.ok) {
      const msg = adminData.message || adminData.error_description || adminData.msg || '注册失败';
      return res.status(400).json({ error: msg });
    }

    // Sign in immediately to get session tokens
    const signInResp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const signInData = await signInResp.json();
    if (!signInResp.ok) {
      return res.status(200).json({ ok: true, user_id: adminData.id, needs_login: true });
    }

    return res.status(200).json({
      ok: true,
      user_id: adminData.id,
      access_token: signInData.access_token,
      refresh_token: signInData.refresh_token,
      expires_in: signInData.expires_in
    });
  }

  // ── 消耗慧根值 ──
  if (action === 'deduct' && req.method === 'POST') {
    const { user_id, amount = 5, description = 'AI功能' } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'missing user_id' });

    let profiles = await dbGet('user_profiles', { id: user_id });
    let profile = profiles?.[0];

    // Profile not found — auto-init (Google OAuth users whose trigger didn't fire)
    if (!profile || !Array.isArray(profiles)) {
      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      await dbInsert('user_profiles', { id: user_id, credits: 100, total_earned: 100, total_spent: 0, invite_code: inviteCode });
      profiles = await dbGet('user_profiles', { id: user_id });
      profile = profiles?.[0];
    }

    const currentCredits = profile?.credits ?? 0;
    if (currentCredits < amount) {
      return res.status(402).json({ error: '慧根值不足', credits: currentCredits });
    }

    const newCredits = currentCredits - amount;
    const newSpent = (profile.total_spent ?? 0) + amount;
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
      const p = (await dbGet('user_profiles', { id: user_id }))?.[0];
      return res.status(200).json({ already_checked: true, credits: p?.credits, total_earned: p?.total_earned });
    }

    // 确保 profile 存在（Google OAuth 用户的 trigger 可能未触发）
    let profiles = await dbGet('user_profiles', { id: user_id });
    let profile = profiles?.[0];
    if (!profile) {
      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      await dbInsert('user_profiles', { id: user_id, credits: 100, total_earned: 100, total_spent: 0, invite_code: inviteCode });
      await dbInsert('huigen_transactions', { user_id, amount: 100, type: 'signup_bonus', description: '注册奖励' }).catch(() => {});
      profiles = await dbGet('user_profiles', { id: user_id });
      profile = profiles?.[0];
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

    // 更新积分（credits为NULL时按100初始化）
    const baseCredits = profile?.credits ?? 100;
    const newCredits = baseCredits + reward;
    const newEarned = (profile?.total_earned ?? 100) + reward;
    await dbUpdate('user_profiles', { id: user_id }, { credits: newCredits, total_earned: newEarned });

    // 记录交易流水
    const txType = streak % 7 === 0 ? 'streak_bonus' : 'daily_checkin';
    await dbInsert('huigen_transactions', {
      user_id, amount: reward, type: txType,
      description: streak % 7 === 0 ? `连续签到${streak}天双倍奖励` : '每日签到'
    }).catch(() => {});

    return res.status(200).json({ credits: newCredits, reward, streak, already_checked: false, total_earned: newEarned });
  }

  // ── 修正慧根值（credits 低于应有值时自动补正）──
  if (action === 'fixcredits' && req.method === 'POST') {
    const { user_id, credits, total_earned } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'missing user_id' });
    const profiles = await dbGet('user_profiles', { id: user_id });
    const profile = profiles?.[0];
    if (!profile) return res.status(404).json({ error: 'profile not found' });
    // 只允许补增，不允许减少
    if ((profile.credits ?? 0) >= credits) return res.status(200).json({ ok: true, skipped: true });
    await dbUpdate('user_profiles', { id: user_id }, {
      credits,
      total_earned: Math.max(profile.total_earned ?? 0, total_earned ?? 0)
    });
    return res.status(200).json({ ok: true, credits });
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
