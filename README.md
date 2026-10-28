# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Admin order push notifications

1. Generate a VAPID key pair with `npm run generate:vapid`.
2. Put the generated public and private keys in the server's `.env` as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Set `VAPID_SUBJECT` to a contact address such as `mailto:admin@your-domain.com`. Never publish the private key.
3. Host the app over HTTPS, start the API, then sign in to `/admin` on each device and select **Aktifkan notifikasi**. On iPhone/iPad, add the site to the Home Screen first.

The Supabase migration creates the `push_subscriptions` table. Notifications are sent when a new order is saved; they do not contain customer details. The API must be running and able to reach the browser's push service.

## Deploying to Vercel with Supabase

The project uses Vite for the customer/admin web app, an Express API function in `api/[...path].ts`, Supabase PostgreSQL for application data, and Supabase Storage for product photos.

1. In Supabase, run the supplied MySQL-to-PostgreSQL migration only once on the intended project. It contains `DROP TABLE` statements and replaces those tables. After that migration, run the repository's `supabase_vercel_setup.sql` once to permit the application's `packed` order status.
2. In Supabase **Project Settings → Database → Connect**, copy the **Transaction Pooler** URI. Use the database password from Supabase; the publishable API key is not a database password.
3. Add the project to Vercel from its Git repository. Keep the **Vite** framework preset, project root at the repository root, and Node.js 24 (or another version supported by the installed Vite).
4. Add these environment variables in Vercel for Production and Preview:
   - `DATABASE_URL`: Supabase Transaction Pooler URI.
   - `SUPABASE_URL`: `https://rcbgqqwdbwrvhtgwvwzp.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY`: the Supabase secret/service-role key. Server-side only; never use a `VITE_` prefix or commit it.
   - `SUPABASE_STORAGE_BUCKET`: `products`
   - `JWT_SECRET`: a long, unique random value.
   - `APP_URL`: the deployed site origin, without a trailing slash.
   - `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `MIDTRANS_IS_PRODUCTION`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` when those features are enabled.
5. Deploy. The API creates the public `products` Storage bucket on the first product-photo upload. Re-upload photos from Admin for products whose migrated `image_url` still points to a local `/uploads/` file.
6. Create a fresh admin login if needed by running `npm run create:admin -- "Nama Admin" email password` with a local `.env` containing `DATABASE_URL`.
7. Test `/api/health`, customer login, product listing, checkout, admin updates, photo upload, and push notification permission on the HTTPS deployment.

Keep all secret values in Vercel Environment Variables and a local ignored `.env`; do not share database URIs, database passwords, VAPID private keys, or Supabase secret/service-role keys in chat or source control. The `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS, so it must only be used by the server.

The SPA fallback rewrite deliberately excludes `/api/*`, so API requests reach the Vercel Function instead of returning `index.html`.
