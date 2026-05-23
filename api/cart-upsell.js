export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    // Vercel doesn't auto-parse JSON bodies — read and parse manually
    let body = req.body;
    if (!body || typeof body === 'string') {
      const raw = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      try { body = JSON.parse(raw); } catch { return res.status(400).json({ error: 'invalid_json' }); }
    }

    const { cartItems, cartTotal, catalog } = body;

    if (!cartItems?.length || !catalog?.length) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    const gap = Math.max(0, 80 - cartTotal);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // faster + cheaper for upsell calls
        max_tokens: 600,
        system: `You are a cart upsell engine. Analyze the cart and pick ONE strategy:
- "complementary": missing accessories
- "threshold": cart is close to free shipping (only if gap $2-$25)
- "bundle": items are thematically related
- "upgrade": a premium version exists
IMPORTANT: Each suggestion must copy the variant_id EXACTLY from the available products list.
Respond ONLY in raw JSON, no markdown:
{
  "strategy": "complementary|threshold|bundle|upgrade",
  "hook": "short headline max 8 words",
  "subtext": "one supporting sentence",
  "suggestions": [
    { "name": "product name", "reason": "why it fits", "price": 00, "variant_id": 0 }
  ]
}`,
        messages: [{
          role: 'user',
          content: `Cart: ${JSON.stringify(cartItems)}. Total: $${cartTotal}. Gap to free shipping: $${gap.toFixed(0)}. Available products: ${JSON.stringify(catalog)}`
        }]
      })
    });

    const data = await response.json();

    if (data.error) {
      console.error('Anthropic error:', data.error);
      return res.status(500).json({ error: data.error.message });
    }

    const text = data.content?.[0]?.text || '{}';
    let upsell;
    try {
      upsell = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return res.status(200).json({ error: 'parse_failed' });
      upsell = JSON.parse(match[0]);
    }

    if (Array.isArray(upsell.suggestions)) {
      upsell.suggestions = upsell.suggestions
        .map(s => {
          if (!s.variant_id) {
            const found = catalog.find(p => p.name === s.name);
            if (found) s.variant_id = found.variant_id;
          }
          return s;
        })
        .filter(s => s.variant_id);
    }

    return res.status(200).json(upsell);

  } catch (err) {
    console.error('cart-upsell handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
