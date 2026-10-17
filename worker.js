const CACHE_TTL = 300; // 5分钟缓存

// 主入口
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // API 路由
    if (path.startsWith('/api/')) {
      return handleAPI(request, env, path);
    }

    // 健康检查
    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'ok', ts: Date.now() }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 前端页面
    return new Response(HTML_PAGE, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60'
      }
    });
  }
};

// ===== API 处理 =====
async function handleAPI(request, env, path) {
  const url = new URL(request.url);

  try {
    // 边缘信息
    if (path === '/api/whoami') {
      return jsonResponse({
        ip: request.headers.get('CF-Connecting-IP') || 'unknown',
        country: request.headers.get('CF-IPCountry') || 'unknown',
        colo: request.headers.get('CF-RAY') ? request.headers.get('CF-RAY').split('-')[1] : 'unknown',
        asn: request.headers.get('CF-Connecting-ASN') || 'unknown',
        tls: request.headers.get('CF-Connecting-TLS') || 'unknown',
        ua: request.headers.get('User-Agent') || 'unknown',
        time: new Date().toISOString()
      });
    }

    // 访问统计
    if (path === '/api/stats') {
      let count = 0;
      if (env.EDGEHUB_KV) {
        const stored = await env.EDGEHUB_KV.get('visit_count');
        count = stored ? parseInt(stored) : 0;
        count++;
        ctx = { env }; // placeholder
        // 异步更新
        env.EDGEHUB_KV.put('visit_count', count.toString());
      }
      return jsonResponse({ count, hasKV: !!env.EDGEHUB_KV });
    }

    // 留言墙
    if (path === '/api/messages') {
      if (request.method === 'GET') {
        if (env.EDGEHUB_KV) {
          const data = await env.EDGEHUB_KV.get('messages');
          const messages = data ? JSON.parse(data) : [];
          return jsonResponse({ messages: messages.slice(-50) });
        }
        return jsonResponse({ messages: [] });
      }
      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const text = (body.text || '').trim().slice(0, 500);
        const name = (body.name || '匿名').trim().slice(0, 50);
        if (!text) return jsonResponse({ error: '内容不能为空' }, 400);

        if (env.EDGEHUB_KV) {
          const data = await env.EDGEHUB_KV.get('messages');
          const messages = data ? JSON.parse(data) : [];
          messages.push({
            id: Date.now(),
            name,
            text,
            time: new Date().toISOString(),
            colo: request.headers.get('CF-RAY') ? request.headers.get('CF-RAY').split('-')[1] : 'unknown'
          });
          // 只保留最近200条
          if (messages.length > 200) messages.shift();
          await env.EDGEHUB_KV.put('messages', JSON.stringify(messages));
        }
        return jsonResponse({ ok: true });
      }
    }

    // 汇率
    if (path === '/api/exchange') {
      try {
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
          headers: { 'Accept': 'application/json' },
          cf: { cacheTtl: CACHE_TTL }
        });
        if (res.ok) {
          const data = await res.json();
          const rates = data.rates || {};
          return jsonResponse({
            base: 'USD',
            cny: rates.CNY || 7.2,
            eur: rates.EUR || 0.92,
            jpy: rates.JPY || 149,
            gbp: rates.GBP || 0.79,
            hkd: rates.HKD || 7.8,
            sgd: rates.SGD || 1.34,
            updated: data.date || new Date().toISOString().slice(0, 10)
          });
        }
      } catch (e) {}
      // 降级数据
      return jsonResponse({
        base: 'USD',
        cny: 7.23, eur: 0.92, jpy: 149.5, gbp: 0.79, hkd: 7.81, sgd: 1.34,
        updated: new Date().toISOString().slice(0, 10), fallback: true
      });
    }

    // 加密行情
    if (path === '/api/crypto') {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,dogecoin&vs_currencies=usd&include_24hr_change=true', {
          cf: { cacheTtl: CACHE_TTL }
        });
        if (res.ok) {
          const data = await res.json();
          return jsonResponse({
            btc: { price: data.bitcoin?.usd || 0, change: data.bitcoin?.usd_24h_change || 0 },
            eth: { price: data.ethereum?.usd || 0, change: data.ethereum?.usd_24h_change || 0 },
            sol: { price: data.solana?.usd || 0, change: data.solana?.usd_24h_change || 0 },
            doge: { price: data.dogecoin?.usd || 0, change: data.dogecoin?.usd_24h_change || 0 }
          });
        }
      } catch (e) {}
      return jsonResponse({
        btc: { price: 67500, change: 2.3 },
        eth: { price: 3520, change: -1.2 },
        sol: { price: 168,