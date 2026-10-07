import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const url = Deno.env.get('SUPABASE_URL')!;
const namedKeys = (name: string) => { try { return Object.values(JSON.parse(Deno.env.get(name) || '{}'))[0] as string | undefined; } catch { return undefined; } };
const publicKey = namedKeys('SUPABASE_PUBLISHABLE_KEYS') || Deno.env.get('SUPABASE_ANON_KEY')!;
const adminKey = namedKeys('SUPABASE_SECRET_KEYS') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(url, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
const auth = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
const origins = new Set(['https://spoolnyc.com', 'https://www.spoolnyc.com']);

Deno.serve(async (req: Request) => {
 const origin = req.headers.get('origin');
 const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' };
 if (origin && origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
 const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
 if (origin && !origins.has(origin)) return reply({ error: 'This origin is not allowed.' }, 403);
 if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
 if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
 const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
 if (!token) return reply({ error: 'Sign in before sending a request.' }, 401);
 try {
  const { data: { user }, error: authError } = await auth.auth.getUser(token);
  if (authError || !user?.email || !user.email_confirmed_at) return reply({ error: 'Sign in before sending a request.' }, 401);
  if (Number(req.headers.get('content-length') || 0) > 24000) return reply({ error: 'Request is too large.' }, 413);
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > 24000) return reply({ error: 'Request is too large.' }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return reply({ error: 'Invalid request.' }, 400); }
  const id = typeof body.requestId === 'string' ? body.requestId : '';
  const kind = body.kind;
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !['sample','inquiry'].includes(String(kind)) || !subject || subject.length > 160 || /[\r\n]/.test(subject) || !message || message.length > 12000) return reply({ error: 'Check the request details and try again.' }, 400);
  const { data: reservation, error: reserveError } = await admin.rpc('reserve_spool_email', { p_id: id, p_user: user.id, p_kind: kind, p_subject: subject, p_message: message, p_reply_to: user.email });
  if (reserveError) { console.error('Request reservation failed', reserveError.code); return reply({ error: 'Could not save your request. Please try again.' }, 503); }
  if (reservation?.error === 'rate_limit') return reply({ error: 'Please wait a minute before sending another request. You can send up to five requests per hour.' }, 429);
  if (reservation?.error === 'conflict') return reply({ error: 'Request details changed. Start a new request.' }, 409);
  if (reservation?.status === 'sent') return reply({ ok: true, requestId: id });
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return reply({ error: 'Email delivery is not configured yet.' }, 503);
  let delivery: Response;
  try {
   delivery = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': 'spool-request/' + id },
    body: JSON.stringify({ from: 'SPOOL NYC <info@spoolnyc.com>', to: ['info@spoolnyc.com'], reply_to: user.email, subject: 'SPOOL ' + (kind === 'sample' ? 'sample request' : 'inquiry') + ' — ' + subject, text: 'Customer: ' + user.email + '\nRequest ID: ' + id + '\n\n' + message }), signal: AbortSignal.timeout(15000)
   });
  } catch {
   await admin.from('spool_email_requests').update({ status: 'failed' }).eq('id', id);
   return reply({ error: 'Email delivery could not be confirmed. Please retry this request.' }, 503);
  }
  const result = await delivery.json().catch(() => ({}));
  if (!delivery.ok || !result.id) {
   await admin.from('spool_email_requests').update({ status: 'failed' }).eq('id', id);
   console.error('Resend delivery failed', delivery.status, result.name || 'unknown');
   return reply({ error: 'We could not send your request yet. Please try again.' }, 502);
  }
  const { error: receiptError } = await admin.from('spool_email_requests').update({ status: 'sent', resend_id: result.id }).eq('id', id);
  if (receiptError) console.error('Email receipt update failed', receiptError.code);
  return reply({ ok: true, requestId: id });
 } catch (err) {
  console.error('Request handler failed', err instanceof Error ? err.name : 'unknown');
  return reply({ error: 'Something went wrong. Please try again.' }, 503);
 }
});
