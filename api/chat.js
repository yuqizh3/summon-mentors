export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // WorldRouter：OpenAI 兼容端点。base 用 host 即可，/v1 在下面拼。
  // 容错：无论环境变量带不带 /v1、带不带结尾斜杠，都会拼成 .../v1/chat/completions。
  let baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://inference-api.worldrouter.ai';
  baseUrl = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');

  try {
    const { model, max_tokens, system, messages } = req.body;

    // WorldRouter 同样在服务端注入约 2 万 token 的 Claude Code system，会淹掉我们的 system。
    // 验证有效的写法（测试 A）：把人设【完整塞进 user 消息】+ 强"虚构角色扮演/忽略Claude身份"框架，
    // 且【不单独发 system】。人设出现在 user 消息里（模型直接看到），才压得过被注入的身份。
    const msgs = (Array.isArray(messages) ? messages : []).map(m => {
      let content = m.content;
      if (Array.isArray(content)) content = content.map(b => (b && b.text) ? b.text : '').join('');
      return { role: m.role || 'user', content: String(content == null ? '' : content) };
    });

    // 把人设放进 user 消息（这样不发 system → WorldRouter 不注入那 2 万 token 的 Claude Code）。
    // 用【温和的正常角色扮演】措辞——不要写"否认你是AI/忽略此前指令"之类，否则干净 Claude 会当越狱而拒绝。
    const oaMessages = [];
    if (system && msgs.length) {
      const framing =
        '下面是一段角色扮演。请你化身成这个角色，全程用第一人称、以 TA 的口吻、性格、立场和思维方式来说话，就像 TA 本人在现场发言一样自然、投入。\n\n' +
        '【你要扮演的角色】\n' + system + '\n\n' +
        '【请以 TA 的身份，用中文回应下面的内容】\n';
      const reminder = '\n\n（请继续保持这个角色的口吻，自然地用中文说，不用说明你在扮演。）';
      const firstU = msgs.findIndex(m => m.role === 'user');
      if (firstU >= 0) msgs[firstU].content = framing + msgs[firstU].content;
      else msgs.unshift({ role: 'user', content: framing });
      let lastU = -1;
      for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].role === 'user') { lastU = i; break; } }
      if (lastU >= 0) msgs[lastU].content = msgs[lastU].content + reminder;
      // 关键：不单独发 system（发了 WorldRouter 会注入 2 万 token Claude Code；不发则是干净 Claude）
    } else if (system) {
      oaMessages.push({ role: 'system', content: String(system) });
    }
    oaMessages.push(...msgs);

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
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
