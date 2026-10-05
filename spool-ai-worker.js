/**
 * SPOOL Reference Studio — AI image Worker (Cloudflare Workers)
 *
 * Keeps your API keys secret. The studio page sends references + prompt here.
 *  task "design"  (default): body.n images (1–4, default 2), split evenly between OpenAI and
 *                  Gemini when both keys exist. body.quality = "low" | "medium" | "high" (OpenAI).
 *                  body.wide = true → landscape 3:2. body.provider = "openai" | "gemini" forces one model.
 *  task "extract": 1 image — the print graphic alone, transparent background when supported.
 *
 * Secrets (set in Cloudflare → Worker → Settings → Variables and Secrets):
 *   OPENAI_API_KEY   your OpenAI API key (platform.openai.com)
 *   GEMINI_API_KEY   your Gemini API key (aistudio.google.com)
 * Optional plain variables:
 *   OPENAI_MODEL     default "gpt-image-2"
 *   GEMINI_MODEL     default "gemini-3.1-flash-image"
 *   OPENAI_QUALITY   default "medium"  (low | medium | high)
 *   ALLOWED_ORIGINS  default "https://spoolnyc.com,https://www.spoolnyc.com"
 */

const MAX_IMAGES = 4;
const MAX_BODY = 12 * 1024 * 1024; // 12 MB

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || 'https://spoolnyc.com,https://www.spoolnyc.com')
      .split(',').map(s => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'GET') return json({ ok: true, openai: !!env.OPENAI_API_KEY, gemini: !!env.GEMINI_API_KEY });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!okOrigin) return json({ error: 'Origin not allowed' }, 403);
    if (Number(req.headers.get('Content-Length') || 0) > MAX_BODY) return json({ error: 'Images too large' }, 413);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
    const prompt = String(body.prompt || '').slice(0, 4000);
    const images = (Array.isArray(body.images) ? body.images : [])
      .filter(i => typeof i?.dataUrl === 'string' && i.dataUrl.startsWith('data:image/'))
      .slice(0, MAX_IMAGES);
    if (!prompt) return json({ error: 'Missing prompt' }, 400);

    const task = body.task === 'extract' ? 'extract' : 'design';
    const jobs = [];
    if (task === 'extract') {
      if (env.OPENAI_API_KEY) jobs.push(openai(env, prompt, images, { n: 1, background: 'transparent', quality: 'high' }));
      else if (env.GEMINI_API_KEY) jobs.push(gemini(env, prompt, images));
    } else {
      const n = Math.max(1, Math.min(4, parseInt(body.n, 10) || 2));
      const quality = ['low', 'medium', 'high'].includes(body.quality) ? body.quality : undefined;
      const both = env.OPENAI_API_KEY && env.GEMINI_API_KEY;
      // body.provider = "openai" | "gemini" forces one model (used to keep front/back from the same AI)
      let nOpenai = !env.OPENAI_API_KEY ? 0 : both ? Math.ceil(n / 2) : n;
      if (body.provider === 'openai' && env.OPENAI_API_KEY) nOpenai = n;
      if (body.provider === 'gemini' && env.GEMINI_API_KEY) nOpenai = 0;
      const nGemini = !env.GEMINI_API_KEY ? 0 : n - nOpenai;
      const wide = body.wide === true;
      if (nOpenai) jobs.push(openai(env, prompt, images, { n: nOpenai, quality, size: wide ? '1536x1024' : '1024x1024' }));
      for (let i = 0; i < nGemini; i++) jobs.push(gemini(env, prompt, images, wide ? '3:2' : '1:1'));
    }
    if (!jobs.length) return json({ error: 'No API keys configured on the Worker' }, 500);

    const settled = await Promise.allSettled(jobs);
    const out = [], errors = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') out.push(...r.value);
      else errors.push(String(r.reason?.message || r.reason).slice(0, 300));
    }
    if (!out.length) return json({ error: 'Generation failed', errors }, 502);
    return json({ images: out, errors });
  }
};

/* ---------- OpenAI: one call, n images ---------- */
async function openai(env, prompt, images, opt = {}) {
  const model = env.OPENAI_MODEL || 'gpt-image-2';
  const common = { model, prompt, n: opt.n || 2, size: opt.size || '1024x1024', quality: opt.quality || env.OPENAI_QUALITY || 'medium' };
  if (opt.background) common.background = opt.background;
  const url = images.length ? 'https://api.openai.com/v1/images/edits' : 'https://api.openai.com/v1/images/generations';
  const call = async (extra) => {
    const payload = images.length ? { ...common, ...extra, images: images.map(i => ({ image_url: i.dataUrl })) } : { ...common, ...extra };
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return [r, await r.json().catch(() => ({}))];
  };
  let [r, data] = await call({});
  // Some models don't support transparent backgrounds — retry without it.
  if (!r.ok && common.background && /background|transparen/i.test(data?.error?.message || '')) {
    delete common.background;
    [r, data] = await call({});
  }
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${data?.error?.message || 'error'}`);
  return (data.data || []).map(d => ({
    provider: 'ChatGPT',
    src: d.b64_json ? `data:image/png;base64,${d.b64_json}` : d.url
  })).filter(x => x.src);
}

/* ---------- Gemini: one image per call ---------- */
async function gemini(env, prompt, images, aspect = '1:1') {
  const model = env.GEMINI_MODEL || 'gemini-3.1-flash-image';
  const parts = [{ text: prompt }];
  for (const i of images) {
    const m = i.dataUrl.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect } }
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${data?.error?.message || 'error'}`);
  const out = [];
  for (const c of data.candidates || []) {
    for (const p of c.content?.parts || []) {
      const d = p.inlineData || p.inline_data;
      if (d?.data) out.push({ provider: 'Gemini', src: `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}` });
    }
  }
  if (!out.length) throw new Error('Gemini returned no image');
  return out.slice(0, 1);
}
