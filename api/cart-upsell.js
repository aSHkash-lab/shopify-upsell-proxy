
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { cartItems, cartTotal, catalog } = req.body;
  const gap = 80 - cartTotal;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: `You are a cart upsell engine. Analyze the cart and pick ONE strategy:
- "complementary": missing accessories
- "threshold": cart is close to free shipping (only if gap $2-$25)
- "bundle": items are thematically related
- "upgrade": a premium version exists

Respond ONLY in raw JSON, no markdown:
{
  "strategy": "complementary|threshold|bundle|upgrade",
  "hook": "short headline max 8 words",
  "subtext": "one supporting sentence",
  "suggestions": [
    { "name": "product name", "reason": "why it fits", "price": 00 }
  ]
}`,
      messages: [{
        role: 'user',
        content: `Cart: ${JSON.stringify(cartItems)}. Total: $${cartTotal}. Gap to free shipping: $${gap.toFixed(0)}. Available products: ${JSON.stringify(catalog)}`
      }]
    })
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || '{}';

  try {
    res.status(200).json(JSON.parse(text));
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    res.status(200).json(match ? JSON.parse(match[0]) : { error: 'parse_failed' });
  }
}
