// api/chat.js
// Vercel Serverless Function — OpenAI 代理
// API Key 存在 Vercel 环境变量 OPENAI_API_KEY 中，前端看不到

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method Not Allowed' } });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: { message: '服务器未配置 API Key，请联系站长' } });
  }

  const { system, messages } = req.body;

  // 构造 OpenAI messages 格式
  const openaiMessages = [];
  if (system) {
    openaiMessages.push({ role: 'system', content: system });
  }
  if (messages && messages.length > 0) {
    openaiMessages.push(...messages);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1000,
        messages: openaiMessages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: { message: data.error?.message || '调用失败，请稍后重试' }
      });
    }

    // 转换成前端期望的格式（兼容 data.content[0].text）
    const text = data.choices?.[0]?.message?.content || '（获取建议失败）';
    return res.status(200).json({
      content: [{ type: 'text', text }]
    });

  } catch (err) {
    return res.status(500).json({ error: { message: '网络错误，请稍后重试' } });
  }
}
