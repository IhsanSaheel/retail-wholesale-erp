# Etihad Traders — Next.js application

This is the separate professional application under development. The existing root `index.html` remains the current production application until the new version is approved.

## Local development

1. Install Node.js 22.x.
2. Copy `.env.example` to `.env.local`.
3. Add the existing Supabase project URL and publishable key.
4. Run:

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Vercel deployment

Set the Vercel project's framework to **Next.js**, Node.js runtime to **22.x**, and Root Directory to **next-app** when using the repository Git integration. Configure only these public browser variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Do not add a Supabase service-role key to any `NEXT_PUBLIC_*` variable or browser bundle. The employee provisioning Edge Function uses the server-side Supabase Edge Function environment.

The current Vercel preview was deployed from the `vercel-professional-rebuild` branch. Git auto-deploy is not connected yet because the Vercel team needs a GitHub Login Connection. Add the GitHub connection in Vercel before enabling automatic branch deployments.

## Supabase

This application intentionally uses the existing Etihad Traders Supabase project and existing business records.

Database migration files are in `supabase/migrations/`; the corresponding migrations have already been applied to the connected project. The employee account creation function source is in `supabase/functions/etihad-create-employee/index.ts` and is deployed as an authenticated Supabase Edge Function.

## Authentication redirect URLs

When enabling password reset on a new production domain, add that exact HTTPS domain to Supabase Auth > URL Configuration > Redirect URLs. Keep the existing production URL in the allow-list until cutover is approved.

## Offline status

The PWA manifest, service worker, and offline fallback page are installed. This currently provides an offline fallback shell and static asset caching; it does **not** yet provide offline POS transactions or an automatic transaction-sync queue. Do not record sales while offline in this preview.

## Release safety

- Keep the existing GitHub Pages application live during testing.
- Test employee login, role permissions, POS, purchases, returns, customer payments, stock transfers, payroll and backups before release.
- Do not promote a preview or change the production domain until those workflows have passed authenticated desktop and Android testing.
