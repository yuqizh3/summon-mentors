export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // WorldRouter：OpenAI 兼容端点。可用环境变量 ANTHROPIC_BASE_URL 覆盖（要带 /v1）。
  const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://inference-api.worldrouter.ai/v1';

  try {
    const { model, max_tokens, system, messages } = req.body;

    // 前端仍用 Anthropic 风格（顶层 system + messages）。这里转成 OpenAI 的 messages 数组：
    // system 作为一条 role:'system' 放最前；其余消息原样带过（content 若是 block 数组则抽 text）。
    const oaMessages = [];
    if (system) oaMessages.push({ role: 'system', content: String(system) });
    (Array.isArray(messages) ? messages : []).forEach(m => {
      let content = m.content;
      if (Array.isArray(content)) content = content.map(b => (b && b.text) ? b.text : '').join('');
      oaMessages.push({ role: m.role || 'user', content: String(content == null ? '' : content) });
    });

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-6',
        max_tokens: max_tokens || 500,
        messages: oaMessages,
      }),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      const msg = (data.error && (data.error.message || data.error)) || `HTTP ${response.status}`;
      return res.status(response.ok ? 400 : response.status).json({ error: typeof msg === 'string' ? msg : JSON.stringify(msg) });
    }

    // 把 OpenAI 响应转回前端期望的 Anthropic 形状：{ content:[{type:'text',text}] }
    const text = data?.choices?.[0]?.message?.content ?? '';
    return res.status(200).json({
      content: [{ type: 'text', text }],
      model: data.model,
      usage: data.usage,
      stop_reason: data?.choices?.[0]?.finish_reason,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
