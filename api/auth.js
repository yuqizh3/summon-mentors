import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  const { action } = req.query;

  // ── 签到 ──
  if (action === 'checkin' && req.method === 'POST') {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'missing user_id' });

    // 检查今天是否已签到
    const today = new Date().toISOString().slice(0, 10);
    const { data: existing } = await supabase
      .from('check_ins')
      .select('id')
      .eq('user_id', user_id)
      .eq('checked_at', today)
      .single();

    if (existing) return res.status(400).json({ error: '今天已经签到了' });

    // 写签到记录
    await supabase.from('check_ins').insert({ user_id, checked_at: today });

    // 加10慧根值
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('credits')
      .eq('id', user_id)
      .single();

    const newCredits = (profile?.credits || 0) + 10;
    await supabase.from('user_profiles').update({ credits: newCredits }).eq('id', user_id);
    await supabase.from('credit_logs').insert({ user_id, amount: 10, reason: 'checkin' });

    return res.status(200).json({ credits: newCredits });
  }

  // ── 获取用户信息 ──
  if (action === 'profile' && req.method === 'GET') {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'missing user_id' });

    const { data } = await supabase
      .from('user_profiles')
      .select('credits, invite_code, created_at')
      .eq('id', user_id)
      .single();

    // 检查今天是否已签到
    const today = new Date().toISOString().slice(0, 10);
    const { data: checkin } = await supabase
      .from('check_ins')
      .select('id')
      .eq('user_id', user_id)
      .eq('checked_at', today)
      .single();

    return res.status(200).json({ ...data, checked_in_today: !!checkin });
  }

  // ── 消耗慧根值（AI调用前检查） ──
  if (action === 'deduct' && req.method === 'POST') {
    const { user_id, amount = 5 } = req.body;
    if (!user_id) return res.status(400).json({ error: 'missing user_id' });

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('credits')
      .eq('id', user_id)
      .single();

    if (!profile || profile.credits < amount) {
      return res.status(402).json({ error: '慧根值不足', credits: profile?.credits || 0 });
    }

    const newCredits = profile.credits - amount;
    await supabase.from('user_profiles').update({ credits: newCredits }).eq('id', user_id);
    await supabase.from('credit_logs').insert({ user_id, amount: -amount, reason: 'ai_call' });

    return res.status(200).json({ credits: newCredits });
  }

  return res.status(404).json({ error: 'unknown action' });
}
