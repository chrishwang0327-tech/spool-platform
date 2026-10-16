/**
 * SPOOL Reference Studio — AI image Worker (Cloudflare Workers)
 *
 * Keeps your API keys secret. The studio page sends references + prompt here.
 *  task "design"  (default): body.n images (1–4, default 2), split evenly between OpenAI and
 *                  Gemini when both keys exist. body.quality = "low" | "medium" | "high" (OpenAI).
 *                  body.wide = true → landscape 3:2; body.aspect = "3:4" | "4:3" | "3:2" | "1:1" sets it exactly. body.provider = "openai" | "gemini" forces one model.
 *                  body.calls = 1–3 usage rows this call counts as (default 1).
 *  task "extract": 1 image — the print graphic alone, transparent background when supported.
 *  task "sample":  { id } of a row in Supabase "sample_requests" (saved by the site) → emails it to
 *                  SAMPLE_TO with the design images attached, plus a short confirmation to the account email.
 *                  Each request id is emailed once; at most SAMPLE_DAILY (default 5) requests per account per day.
 *  task "plan":     { pro, status, renews, techpacks } — SPOOL Studio subscription status (Stripe).
 *  task "checkout": { url } — Stripe Checkout page for SPOOL Studio.
 *  task "portal":   { url } — Stripe customer portal (card, invoices, cancel).
 *  task "clean":    1 image → the same garment with every print removed (blank body). Used by the editor to
 *                  move / resize artwork. Fixed prompt, low quality, not counted in the free designs
 *                  (own daily cap: CLEAN_FREE_DAILY default 10, CLEAN_DAILY for Studio default 20).
 *  task "techpack": { project } → { ok } if this account may download a tech pack PDF
 *                  (Studio, admin, or within 1 free + 1 per sample request), else { ok:false, code }.
 *
 * Limits: each account gets FREE_DESIGNS free Creates in total (+ extra_designs from the Supabase "credits" table),
 *         and at most DAILY_LIMIT AI calls per day. One Create = 3 calls. Admins (Supabase "admins") are unlimited.
 *
 * Secrets (set in Cloudflare → Worker → Settings → Variables and Secrets):
 *   OPENAI_API_KEY   your OpenAI API key (platform.openai.com)
 *   GEMINI_API_KEY   your Gemini API key (aistudio.google.com)
 *   RESEND_API_KEY   Resend API key (resend.com) — sends sample request emails
 *   STRIPE_SECRET_KEY Stripe secret key (sk_test_… while testing, sk_live_… when live)
 *   SUPABASE_SECRET_KEY Supabase secret key (sb_secret_… or the service_role key) — only the Worker
 *                    writes usage rows to "generations", so accounts can't add tech pack / sample rows themselves
 * Optional plain variables:
 *   OPENAI_MODEL     default "gpt-image-2"
 *   GEMINI_MODEL     default "gemini-3.1-flash-image"
 *   OPENAI_QUALITY   default "medium"  (low | medium | high)
 *   ALLOWED_ORIGINS  default "https://spoolnyc.com,https://www.spoolnyc.com"
 *   FREE_DESIGNS     default "5"   (free Creates per account, lifetime)
 *   DAILY_LIMIT      default "30"  (AI calls per user per day; 3 calls = 1 Create)
 *   SAMPLE_TO        default "chris@noboundaryapparel.com"
 *   MAIL_FROM        default "SPOOL <noreply@spoolnyc.com>"
 *   STRIPE_PRICE     SPOOL Studio monthly price id (default = the sandbox price below)
 *   FREE_TECHPACKS   default "1"  (tech pack PDFs per free account; designs with a sample request are always allowed)
 *   SITE_URL         default "https://spoolnyc.com"
 */

const MAX_IMAGES = 6;
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin'
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'GET') {
      // supabase: "ok" when SUPABASE_SECRET_KEY works, "missing" when it isn't set, "not a secret key", or the error status
      let supabase = 'missing';
      if (env.SUPABASE_SECRET_KEY) {
        try { const r = await fetch(`${SB_URL}/rest/v1/generations?select=id&limit=1`, { headers: secretHeaders(env.SUPABASE_SECRET_KEY.trim()) }); const rows = r.ok ? await r.json().catch(() => []) : null;
          // the secret key bypasses row security and sees rows; a publishable/anon key sees none
          supabase = !r.ok ? `error ${r.status}` : rows.length ? 'ok' : 'not a secret key'; }
        catch { supabase = 'error'; }
      }
      return json({ ok: true, openai: !!env.OPENAI_API_KEY, gemini: !!env.GEMINI_API_KEY, stripe: !!env.STRIPE_SECRET_KEY, supabase });
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!okOrigin) return json({ error: 'Origin not allowed' }, 403);
    if (Number(req.headers.get('Content-Length') || 0) > MAX_BODY) return json({ error: 'Images too large' }, 413);

    // Signed-in SPOOL users only (set REQUIRE_LOGIN = "false" in Cloudflare to switch this off)
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    let who = null;
    if (env.REQUIRE_LOGIN !== 'false') {
      who = await checkUser(token);
      if (!who) return json({ error: 'Sign in to use SPOOL AI' }, 401);
    }

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }

    // sample request → email (always needs a signed-in user)
    if (body.task === 'sample') {
      const uid = who || await checkUser(token);
      if (!uid) return json({ error: 'Sign in to request a sample' }, 401);
      try { return json(await sendSample(env, token, String(body.id || ''), emailOf(token))); }
      catch (e) { return json({ error: String(e?.message || e).slice(0, 300) }, 502); }
    }

    // SPOOL Studio billing (Stripe) + tech pack allowance
    if (['plan', 'checkout', 'portal', 'techpack'].includes(body.task)) {
      const uid = who || await checkUser(token);
      if (!uid) return json({ error: 'Sign in first' }, 401);
      const email = emailOf(token);
      try {
        if (body.task === 'plan') {
          const [pl, tp] = await Promise.all([planOf(env, email, body.fresh === true), techpackInfo(env, token)]);
          return json({ ...pl, techpacks: tp });
        }
        if (body.task === 'checkout') return json(await checkout(env, uid, email));
        if (body.task === 'portal') return json(await portal(env, email));
        return json(await techpackCheck(env, token, email, String(body.project || '').slice(0, 64)));
      } catch (e) { return json({ error: String(e?.message || e).slice(0, 300) }, 502); }
    }

    // blank body for moving / resizing artwork in the editor — fixed prompt, not counted in free designs
    if (body.task === 'clean') {
      const uid = who || await checkUser(token);
      if (!uid) return json({ error: 'Sign in first' }, 401);
      const src = (Array.isArray(body.images) ? body.images : []).find(i => typeof i?.dataUrl === 'string' && i.dataUrl.startsWith('data:image/'));
      if (!src) return json({ error: 'Missing image' }, 400);
      const h = { apikey: SB_KEY, Authorization: `Bearer ${token}` };
      const capErr = await dayCap(env, token, h, 'clean', envInt(env.CLEAN_FREE_DAILY, 10), envInt(env.CLEAN_DAILY, 20), "You've reached today's limit for moving artwork. It resets at midnight UTC.", 'clean_limit');
      if (capErr) return json(capErr, 429);
      await logUse(env, token, 'clean');
      const P_CLEAN = 'REMOVE ALL PRINTS: Edit this garment product photo. Remove every printed graphic, logo, text, patch and trim from the garment so it is completely blank. Keep the garment type, color, wash, fabric texture, folds, distressing, camera angle and background exactly the same.';
      try {
        const out = env.OPENAI_API_KEY ? await openai(env, P_CLEAN, [src], { n: 1, quality: 'low', size: '1024x1024' }) : await gemini(env, P_CLEAN, [src], '1:1');
        return json({ images: out.slice(0, 1) });
      } catch (e) { return json({ error: String(e?.message || e).slice(0, 300) }, 502); }
    }

    // flat technical sketch for the tech pack — fixed prompt, not counted in free designs
    if (body.task === 'flat') {
      const uid = who || await checkUser(token);
      if (!uid) return json({ error: 'Sign in first' }, 401);
      const src = (Array.isArray(body.images) ? body.images : []).find(i => typeof i?.dataUrl === 'string' && i.dataUrl.startsWith('data:image/'));
      if (!src) return json({ error: 'Missing image' }, 400);
      const h = { apikey: SB_KEY, Authorization: `Bearer ${token}` };
      const capErr = await dayCap(env, token, h, 'flat', envInt(env.FLAT_FREE_DAILY, 6), envInt(env.FLAT_DAILY, 20), "You've reached today's limit for flat sketches. It resets at midnight UTC.", 'flat_limit');
      if (capErr) return json(capErr, 429);
      await logUse(env, token, 'flat');
      const P_FLAT = 'FLAT TECHNICAL SKETCH: Redraw this blank garment as a clean black-line technical flat sketch (fashion CAD style) on a pure white background. Trace the exact silhouette, proportions, seams, stitching, pockets, hood, cuffs, hem and collar exactly as in the photo. Construction detail lines only: no shading, no color fill, no artwork, no text, no model, no shadow. Same camera angle as the photo.';
      try {
        const out = env.OPENAI_API_KEY ? await openai(env, P_FLAT, [src], { n: 1, quality: 'low', size: '1024x1024' }) : await gemini(env, P_FLAT, [src], '1:1');
        return json({ images: out.slice(0, 1) });
      } catch (e) { return json({ error: String(e?.message || e).slice(0, 300) }, 502); }
    }

    // daily limit per user (detect is text-only and cheap → not counted)
    let quota = null;
    if (body.task === 'quota') { if (!who) return json({ error: 'Sign in' }, 401); return json(await quotaInfo(env, token, true)); }
    if (who && body.task !== 'detect') {
      // the front call of a Create (n=2, no provider) reserves the whole Create (3 calls)
      // body.calls (1–3) = how many usage rows this call counts as. "Keep it" sends 2 on its front call,
      // so front + back = 3 rows = 1 design, like a Create. It can only add usage, never remove it.
      const calls = Math.max(1, Math.min(3, parseInt(body.calls, 10) || 1));
      const need = Math.max(calls, (!body.task || body.task === 'design') && !body.provider && (parseInt(body.n, 10) || 2) >= 2 ? 3 : 1);
      const q = await useQuota(env, token, body.task === 'extract' ? 'extract' : 'design', need, calls);
      if (!q.ok) return json({ error: q.error, code: q.code, limit: q.limit, used: q.used }, 429);
      quota = q.info || null;
    }
    const prompt = String(body.prompt || '').slice(0, 4000);
    const images = (Array.isArray(body.images) ? body.images : [])
      .filter(i => typeof i?.dataUrl === 'string' && i.dataUrl.startsWith('data:image/'))
      .slice(0, MAX_IMAGES);
    if (!prompt) return json({ error: 'Missing prompt' }, 400);

    // task "detect": find the graphics on a garment photo — returns text (boxes), no image, very cheap
    if (body.task === 'detect') {
      if (!env.GEMINI_API_KEY) return json({ error: 'Detect needs GEMINI_API_KEY' }, 500);
      if (!images.length) return json({ error: 'Missing image' }, 400);
      { const hd = { apikey: SB_KEY, Authorization: `Bearer ${token}` }; const capErr = await dayCap(env, token, hd, 'detect', envInt(env.DETECT_DAILY, 200), envInt(env.DETECT_DAILY, 200) * 3, "You've reached today's limit for auto-detect. It resets at midnight UTC.", 'detect_limit'); if (capErr) return json(capErr, 429); await logUse(env, token, 'detect'); }
      try { return json(await geminiDetect(env, images[0])); }
      catch (e) { return json({ error: String(e?.message || e).slice(0, 300) }, 502); }
    }

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
      const SIZES = { '3:4': '1024x1536', '4:3': '1536x1024', '3:2': '1536x1024', '1:1': '1024x1024' };
      const aspect = SIZES[body.aspect] ? body.aspect : body.wide === true ? '3:2' : '1:1';
      if (nOpenai) jobs.push(openai(env, prompt, images, { n: nOpenai, quality, size: SIZES[aspect] }));
      for (let i = 0; i < nGemini; i++) jobs.push(gemini(env, prompt, images, aspect));
    }
    if (!jobs.length) return json({ error: 'No API keys configured on the Worker' }, 500);

    const settled = await Promise.allSettled(jobs);
    const out = [], errors = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') out.push(...r.value);
      else errors.push(String(r.reason?.message || r.reason).slice(0, 300));
    }
    if (!out.length) return json({ error: 'Generation failed', errors }, 502);
    return json({ images: out, errors, quota });
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

/* ---------- Gemini: detect graphic areas (text answer) ---------- */
async function geminiDetect(env, image) {
  const model = env.GEMINI_TEXT_MODEL || 'gemini-flash-latest';
  const m = image.dataUrl.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
  if (!m) throw new Error('Bad image');
  const prompt = 'This is a garment product photo. First name the garment type as exactly one of: tee, hoodie, zip, crew, trucker, sweatpant, denim, shorts ' +
    '(hoodie = pullover with a hood; zip = full-zip hoodie or zip jacket; crew = crewneck sweatshirt with long sleeves and no hood; tee = short-sleeve t-shirt; trucker = jacket with collar and buttons; denim = jeans). ' +
    'Then find each separate design element ON the garment: printed graphics, text blocks, logos, patches, embroidery, rhinestone or stud areas — on the body AND on the sleeves (shoulder, upper arm, forearm and cuff area). ' +
    'Group letters of one word or one slogan together. Ignore the garment itself, seams, collar, plain rib cuffs, hems, pockets, wrinkles, distressing and the background. ' +
    'Return JSON: {"garment": "hoodie", "items": [{"label": "short name, 1-4 words", "box_2d": [ymin, xmin, ymax, xmax]}]} with at most 8 items and coordinates normalized 0-1000. Use "items": [] if there are none.';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: m[1], data: m[2] } }, { text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 }
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${data?.error?.message || 'error'}`);
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  let obj; try { obj = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()); } catch { throw new Error('Could not read the detect answer'); }
  const arr = Array.isArray(obj) ? obj : (obj?.items || []);
  const g = String((!Array.isArray(obj) && obj?.garment) || '').toLowerCase();
  const garment = ['tee', 'hoodie', 'zip', 'crew', 'trucker', 'sweatpant', 'denim', 'shorts'].includes(g) ? g : null;
  const parts = arr.slice(0, 8).map(o => {
    const b = (o.box_2d || o.box || []).map(Number);
    if (b.length !== 4 || b.some(v => !isFinite(v))) return null;
    const [y0, x0, y1, x1] = b.map(v => Math.max(0, Math.min(1000, v)));
    if (x1 - x0 < 8 || y1 - y0 < 8) return null;
    return { label: String(o.label || 'Graphic').slice(0, 40), box: [x0, y0, x1 - x0, y1 - y0] }; // [x, y, w, h] in 0-1000
  }).filter(Boolean);
  return { parts, garment };
}

/* ---------- Supabase sign-in check ---------- */
const SB_URL = 'https://deblflfpfapfajghhufv.supabase.co';
const SB_KEY = 'sb_publishable_SmsPhhRum8I32qTCfdqceQ_H6Wcwdf4'; // public key, safe here
const seen = new Map(); // token -> {id, email, until}
const uidOf = token => seen.get(String(token || '').replace(/^Bearer\s+/i, '').trim())?.id || '';
const emailOf = token => (seen.get(String(token || '').replace(/^Bearer\s+/i, '').trim())?.email || '').toLowerCase();
async function checkUser(auth) {
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const hit = seen.get(token);
  if (hit && hit.until > Date.now()) return hit.id;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  if (!u?.id) return null;
  if (seen.size > 500) seen.clear();
  seen.set(token, { id: u.id, email: u.email || '', until: Date.now() + 5 * 60 * 1000 });
  return u.id;
}


/* ---------- limits (Supabase: generations = one row per AI call; credits = extra designs; admins = unlimited) ---------- */
/* v12: per-day caps that differ for free and Studio accounts (admins are never capped).
   Free accounts hit freeCap first; only then is the plan looked up (Stripe), so most calls cost no extra request. */
async function dayCap(env, token, h, kind, freeCap, proCap, message, code) {
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const used = (await sbCount(`${SB_URL}/rest/v1/generations?select=id&kind=eq.${kind}&created_at=gte.${encodeURIComponent(day.toISOString())}`, h).catch(() => 0)) || 0;
  if (used < freeCap) return null;
  let admin = false, pro = false;
  try { admin = await fetch(`${SB_URL}/rest/v1/rpc/is_admin`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.ok ? r.json() : false) === true; } catch {}
  if (admin) return null;
  try { pro = (await planOf(env, emailOf(token))).pro; } catch {}
  if (pro && used < proCap) return null;
  return { error: message, code };
}
// usage rows are written with the Worker's secret key (accounts can only read their own rows);
// without SUPABASE_SECRET_KEY it falls back to the account's token, as before
const secretHeaders = k => k.startsWith('eyJ') ? { apikey: k, Authorization: `Bearer ${k}` } : { apikey: k };
function logUse(env, token, kind, count = 1) {
  const k = (env.SUPABASE_SECRET_KEY || '').trim(), uid = uidOf(token);
  const h = k && uid ? secretHeaders(k) : { apikey: SB_KEY, Authorization: `Bearer ${token}` };
  const row = k && uid ? { kind, user_id: uid } : { kind };
  return fetch(`${SB_URL}/rest/v1/generations`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(count > 1 ? Array(count).fill(row) : row) })
    .then(async r => { if (!r.ok) console.error('usage row not saved', kind, r.status, (await r.text()).slice(0, 200)); })
    .catch(e => console.error('usage row not saved', kind, String(e)));
}
const envInt = (v, d) => Math.max(1, parseInt(v || String(d), 10) || d);

async function sbCount(url, h) {
  const r = await fetch(url, { headers: { ...h, Prefer: 'count=exact', Range: '0-0' } });
  if (!r.ok) return null;
  return parseInt((r.headers.get('Content-Range') || '').split('/')[1], 10) || 0;
}
async function quotaInfo(env, token, withPlan) {
  const h = { apikey: SB_KEY, Authorization: `Bearer ${token}` };
  const per = 3, free = Math.max(0, parseInt(env.FREE_DESIGNS || '5', 10));
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const [adm, total, today, cr] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/rpc/is_admin`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.ok ? r.json() : false).catch(() => false),
    sbCount(`${SB_URL}/rest/v1/generations?select=id&kind=in.(design,extract)`, h),
    sbCount(`${SB_URL}/rest/v1/generations?select=id&kind=in.(design,extract)&created_at=gte.${encodeURIComponent(day.toISOString())}`, h),
    fetch(`${SB_URL}/rest/v1/credits?select=email,extra_designs`, { headers: h }).then(r => r.ok ? r.json() : []).catch(() => [])
  ]);
  const me = emailOf(token);
  const extra = (Array.isArray(cr) ? cr : []).filter(x => me && String(x.email || '').toLowerCase() === me).reduce((m, x) => Math.max(m, x.extra_designs || 0), 0);
  const limitCalls = (free + extra) * per;
  const info = { admin: adm === true, usedCalls: total, todayCalls: today, limitCalls, designsLeft: total === null ? null : Math.max(0, Math.floor((limitCalls - total) / per)), freeDesigns: free + extra, pro: false };
  if (withPlan && !info.admin) { try { info.pro = (await planOf(env, emailOf(token))).pro; } catch {} }
  return info;
}
async function useQuota(env, token, kind, need, rows = 1) {
  const daily = Math.max(1, parseInt(env.DAILY_LIMIT || '30', 10) || 30);
  try {
    const info = await quotaInfo(env, token);
    if (info.usedCalls === null || info.todayCalls === null) return QUOTA_DOWN; // can't count → don't run paid AI calls
    if (!info.admin) {
      // over the free designs → only SPOOL Studio subscribers keep going (Stripe is checked only here, not on every call)
      if (info.usedCalls + need > info.limitCalls) {
        let pro = false; try { pro = (await planOf(env, emailOf(token))).pro; } catch {}
        if (!pro) return { ok: false, code: 'free_limit', limit: info.freeDesigns, used: info.usedCalls, error: `You've used your ${info.freeDesigns} free designs. Upgrade to SPOOL Studio for unlimited designs, or request a sample of a design you like.` };
        info.pro = true;
      }
      const dailyMax = info.pro ? Math.max(daily, parseInt(env.PRO_DAILY_LIMIT || '30', 10) || 30) : daily;
      if (info.todayCalls >= dailyMax)
        return { ok: false, code: 'daily_limit', limit: dailyMax, used: info.todayCalls, error: `You've reached today's limit. It resets at midnight UTC.` };
    }
    await logUse(env, token, kind, rows);
    info.usedCalls += rows; info.designsLeft = info.pro ? null : Math.max(0, Math.floor((info.limitCalls - info.usedCalls) / 3));
    return { ok: true, info };
  } catch { return QUOTA_DOWN; }
}
const QUOTA_DOWN = { ok: false, code: 'quota_unavailable', error: "We couldn't check your design limit just now. Please try again in a minute." };

/* ---------- SPOOL Studio subscription (Stripe) ----------
   No webhooks / no extra tables: the Stripe customer is found by the account's email, and the
   subscription status is read from Stripe (cached ~2 min per email inside the Worker). */
const STRIPE_PRICE_DEFAULT = 'price_1UOSW4R0XHe9thUgcFOg523O'; // sandbox price (SPOOL Studio, $29/month)
const planCache = new Map(); // email -> {v, until}
async function stripe(env, method, path, params) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('Billing is not set up yet');
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const url = `https://api.stripe.com/v1/${path}` + (method === 'GET' && body ? `?${body}` : '');
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(method !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: method !== 'GET' ? body : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Stripe: ' + (j.error?.message || r.status));
  return j;
}
async function findCustomer(env, email) {
  if (!email) return null;
  const j = await stripe(env, 'GET', 'customers', { email, limit: '1' });
  return j.data?.[0] || null;
}
async function planOf(env, email, fresh) {
  const none = { pro: false, status: null, renews: null, cancelAt: null };
  if (!email || !env.STRIPE_SECRET_KEY) return none;
  const hit = planCache.get(email);
  if (!fresh && hit && hit.until > Date.now()) return hit.v;
  const c = await findCustomer(env, email);
  let v = none;
  if (c) {
    const subs = await stripe(env, 'GET', 'subscriptions', { customer: c.id, status: 'all', limit: '10' });
    const live = (subs.data || []).find(x => ['active', 'trialing', 'past_due'].includes(x.status));
    if (live) {
      const end = live.current_period_end || live.items?.data?.[0]?.current_period_end || null;
      v = { pro: true, status: live.status, renews: end ? new Date(end * 1000).toISOString() : null,
            cancelAt: live.cancel_at_period_end && end ? new Date(end * 1000).toISOString() : (live.cancel_at ? new Date(live.cancel_at * 1000).toISOString() : null) };
    }
  }
  if (planCache.size > 1000) planCache.clear();
  planCache.set(email, { v, until: Date.now() + (v.pro ? 120 : 20) * 1000 }); // a fresh payment shows up within ~20 s
  return v;
}
async function checkout(env, uid, email) {
  if (!email) throw new Error('Your account has no email');
  const site = (env.SITE_URL || 'https://spoolnyc.com').replace(/\/$/, '');
  const now = await planOf(env, email, true);
  if (now.pro) return { url: (await portal(env, email)).url, already: true };
  let c = await findCustomer(env, email);
  if (!c) c = await stripe(env, 'POST', 'customers', { email, 'metadata[spool_uid]': uid });
  const s = await stripe(env, 'POST', 'checkout/sessions', {
    mode: 'subscription', customer: c.id, client_reference_id: uid,
    'line_items[0][price]': env.STRIPE_PRICE || STRIPE_PRICE_DEFAULT, 'line_items[0][quantity]': '1',
    'subscription_data[metadata][spool_uid]': uid, allow_promotion_codes: 'true',
    success_url: `${site}/studio.html?upgraded=1`, cancel_url: `${site}/studio.html?upgrade=cancel`
  });
  planCache.delete(email);
  return { url: s.url };
}
async function portal(env, email) {
  const c = await findCustomer(env, email);
  if (!c) throw new Error('No billing account yet');
  const site = (env.SITE_URL || 'https://spoolnyc.com').replace(/\/$/, '');
  planCache.delete(email);
  const s = await stripe(env, 'POST', 'billing_portal/sessions', { customer: c.id, return_url: `${site}/studio.html` });
  return { url: s.url };
}

/* ---------- tech pack allowance: rows in "generations" with kind "tp:<project id>" ---------- */
async function techpackInfo(env, token) {
  const h = { apikey: SB_KEY, Authorization: `Bearer ${token}` };
  const free = Math.max(0, parseInt(env.FREE_TECHPACKS || '1', 10));
  const [rows, sampled, adm] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/generations?select=kind&kind=like.tp:*&limit=500`, { headers: h }).then(r => r.ok ? r.json() : []).catch(() => []),
    // only sample requests the Worker actually emailed count (rows "mail:<id>", written by the Worker)
    sbCount(`${SB_URL}/rest/v1/generations?select=id&kind=like.mail:*`, h).then(n => n || 0).catch(() => 0),
    fetch(`${SB_URL}/rest/v1/rpc/is_admin`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.ok ? r.json() : false).catch(() => false)
  ]);
  const projects = [...new Set((Array.isArray(rows) ? rows : []).map(x => String(x.kind).slice(3)))];
  const allow = free + sampled; // +1 tech pack for every sample request
  return { free: allow, used: projects.length, left: Math.max(0, allow - projects.length), projects, samples: sampled, admin: adm === true };
}
async function techpackCheck(env, token, email, project) {
  if (!project) return { ok: false, code: 'bad_request', error: 'Missing project' };
  const t = await techpackInfo(env, token);
  let pro = false; try { pro = (await planOf(env, email)).pro; } catch {}
  const allowed = t.admin || pro || t.projects.includes(project) || t.used < t.free;
  if (!allowed) return { ok: false, code: 'techpack_limit', error: `You've used your free tech pack. Upgrade to SPOOL Studio for unlimited tech packs, or request a sample of this design (each sample request adds one).` };
  if (!t.projects.includes(project))
    await logUse(env, token, 'tp:' + project);
  return { ok: true, pro, via: t.admin ? 'admin' : pro ? 'studio' : 'free' };
}

/* ---------- sample request email (Resend) ---------- */
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function b64(buf) { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); }
async function sendSample(env, token, id, account) {
  if (!env.RESEND_API_KEY) throw new Error('Email is not set up yet (RESEND_API_KEY)');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Bad request id');
  const h = { apikey: SB_KEY, Authorization: `Bearer ${token}` };
  const r = await fetch(`${SB_URL}/rest/v1/sample_requests?id=eq.${id}&select=*`, { headers: h });
  const row = (await r.json().catch(() => []))[0];
  if (!row) throw new Error('Request not found');
  // each request is emailed once, and a few requests per day at most (stops email flooding)
  const mailKind = 'mail:' + id.toLowerCase();
  if (await sbCount(`${SB_URL}/rest/v1/generations?select=id&kind=eq.${mailKind}`, h)) return { ok: true, already: true };
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const today = (await sbCount(`${SB_URL}/rest/v1/generations?select=id&kind=like.mail:*&created_at=gte.${encodeURIComponent(day.toISOString())}`, h)) || 0;
  if (today >= envInt(env.SAMPLE_DAILY, 5)) throw new Error("You've sent the most sample requests for today. Email info@spoolnyc.com and we'll help.");
  const attachments = [];
  for (const [label, path] of Object.entries(row.images || {})) {
    if (!path || attachments.length >= 6) continue;
    const f = await fetch(`${SB_URL}/storage/v1/object/samples/${path}`, { headers: h });
    if (!f.ok) continue;
    const ext = (path.split('.').pop() || 'jpg').toLowerCase();
    attachments.push({ filename: `${label}.${ext}`, content: b64(await f.arrayBuffer()) });
  }
  const links = []; // logo files + SPOOL vector drafts: links (7 days) instead of attachments
  for (const [label, path] of Object.entries(row.files || {})) {
    try { const sr = await fetch(`${SB_URL}/storage/v1/object/sign/samples/${path}`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 604800 }) });
      const sj = await sr.json().catch(() => ({})); const u = sj.signedURL || sj.signedUrl; if (u) links.push([label, `${SB_URL}/storage/v1${u.startsWith('/') ? u : '/' + u}`]); } catch {}
  }
  const d = row.design || {}, rows = [
    ['Name', row.name], ['Brand', row.brand], ['Email', row.email], ['Phone', row.phone],
    ['Ship to', [row.city, row.state, row.zip, row.country].filter(Boolean).join(', ')],
    ['Sample size', row.sample_size], ['Sample qty', row.sample_qty], ['Production qty', row.production_qty],
    ['Needed by', row.needed_by], ['Target price / unit', row.target_price], ['Fabric / weight', row.fabric],
    ['Notes', row.notes], ['Design', d.name], ['Body', d.body], ['Color', d.color], ['Wash', d.wash],
    ['Distress', d.distress], ['Trims', d.trims], ['Artwork', (d.graphics || []).join('\n')], ['Idea', d.idea],
    ['Rights confirmed', row.rights ? 'Yes' : 'No'], ['Request ID', row.id]
  ].filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#201D18"><h2 style="margin:0 0 12px">New sample request — ${esc(d.name || 'SPOOL design')}</h2>
<table cellpadding="6" style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="color:#7a7566;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="white-space:pre-wrap">${esc(v)}</td></tr>`).join('')}</table>
${links.length ? `<p style="margin:14px 0 4px"><b>Files</b> <span style="color:#7a7566">(logo files from the customer, auto-traced vector drafts · links work for 7 days, also in admin.html)</span></p><ul style="margin:0;padding-left:18px">${links.map(([k, u]) => `<li><a href="${esc(u)}">${esc(k)}</a></li>`).join('')}</ul>` : ''}
<p style="color:#7a7566">Design images are attached. Reply to this email to answer the customer.</p></div>`;
  const send = body => fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async x => { if (!x.ok) throw new Error('Email failed: ' + (await x.text()).slice(0, 200)); });
  const from = env.MAIL_FROM || 'SPOOL <noreply@spoolnyc.com>';
  await send({ from, to: [env.SAMPLE_TO || 'chris@noboundaryapparel.com'], reply_to: row.email || undefined,
    subject: `Sample request: ${d.name || 'SPOOL design'} — ${row.name || row.email}`, html, attachments });
  await logUse(env, token, mailKind);
  // confirmation goes to the signed-in account's (verified) email, never to an address typed in the form
  const to = account || '';
  if (to) { try { await send({ from, to: [to], reply_to: 'info@spoolnyc.com', subject: 'We got your SPOOL sample request',
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#201D18"><p>Hi ${esc(row.name || '')},</p><p>Thanks — we received your sample request for <b>${esc(d.name || 'your design')}</b>. We'll review it and reply with a quote within 1–2 business days.</p><p>Questions? Just reply to this email.</p><p>— SPOOL</p></div>` }); } catch {} }
  return { ok: true };
}
