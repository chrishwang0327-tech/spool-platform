# SPOOL Platform

Static site for spoolnyc.com, published with GitHub Pages (`CNAME`). No build step.

## Pages
- `index.html` — landing page
- `studio.html` — Design Studio (AI designs from references)
- `editor.html` — design editor, projects, tech pack and production files
- `techpack.html` — tech pack preparation
- `admin.html` — SPOOL team dashboard (needs `is_admin`)
- `privacy.html`, `terms.html`
- `v1/` — archived V1 site (see `v1/README.md`)

## Shared scripts
- `auth.js` — Supabase sign-in, cloud projects, usage events, Crisp chat, SPOOL Studio plan/checkout
- `sample.js` — sample request flow (uploads to the `samples` bucket, notifies the Worker)

## Backend
- Cloudflare Worker `spool-studio-ai` — AI image generation, plans/limits, Stripe checkout and portal, sample emails.
  `spool-ai-worker.js` is a copy of the live code — after changing it, paste it into Cloudflare
  (Workers → spool-studio-ai → Edit code) and deploy; the repo does not deploy it.
- Supabase project — auth, tables (`projects`, `events`, `sample_requests`, `creations`, `brand_kits`),
  storage buckets (`projects`, `samples`) and admin RPCs. Only `supabase/migrations/` for
  `spool_email_requests` is in this repo; the rest of the schema and RLS policies live in Supabase.
- `supabase/functions/spool-send-request` — email request function; not called by the current pages.

`DESIGN-STUDIO.md` describes the V1 Design Studio update and is kept for history.
