# PGifts Vercel Deployment Guide

## Prerequisites

1. A GitHub account
2. A Vercel account (sign up at https://vercel.com)
3. Your Stripe API keys (test and production)
4. Your Supabase project credentials

## Step 1: Prepare Your Environment Variables

Create a `.env` file in your project root with the following variables:

```env
# Stripe API Keys
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_key_here
STRIPE_SECRET_KEY=sk_test_your_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# API URL - Use your Vercel domain for production
VITE_API_URL=https://your-app.vercel.app

# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

## Step 2: Push to GitHub

```bash
# Initialize git if not already done
git init

# Add all files
git add .

# Commit your changes
git commit -m "Initial commit - PGifts e-commerce site"

# Create a new repository on GitHub, then:
git remote add origin https://github.com/yourusername/pgifts.git
git branch -M main
git push -u origin main
```

## Step 3: Deploy to Vercel

### Option A: Deploy via Vercel Dashboard (Recommended)

1. Go to https://vercel.com and sign in
2. Click "Add New..." → "Project"
3. Import your GitHub repository
4. Vercel will auto-detect the Vite framework
5. Add your environment variables:
   - Go to "Environment Variables" section
   - Add each variable from your `.env` file
   - **Important**: Vercel should hold ONLY the `VITE_`-prefixed variables (they are bundled into the browser build). Add them as "Production" and "Preview".
   - **Do NOT add `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` to Vercel.** The deployed Stripe path runs entirely in Supabase Edge Functions, which read those from **Supabase Edge Function secrets** (`supabase secrets set …`), not Vercel. Nothing on Vercel reads the secret key. See CLAUDE.md §16.2 / §17.4.
6. Click "Deploy"

### Option B: Deploy via Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Deploy
vercel

# Follow the prompts:
# - Link to existing project or create new
# - Set environment variables when prompted
```

## Step 4: Configure Environment Variables in Vercel

After deployment, go to your project settings:

1. Navigate to: **Settings** → **Environment Variables**
2. Add the following variables:

### Client-side Variables (Exposed to Browser)
- `VITE_STRIPE_PUBLISHABLE_KEY` - Your Stripe publishable key
- `VITE_API_URL` - Your Vercel domain (e.g., `https://your-app.vercel.app`)
- `VITE_SUPABASE_URL` - Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Your Supabase anonymous key

### Server-side Variables — Supabase Edge Function secrets, NOT Vercel
These are set with `supabase secrets set …` (see CLAUDE.md §17.4) and read by the
Edge Functions at runtime. They must NOT be added to Vercel — nothing on Vercel
reads them.
- `STRIPE_SECRET_KEY` - Stripe secret key. Read by `confirm-payment`, `create-checkout-session`, `stripe-webhook`.
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret (**required**, not optional — `stripe-webhook` verifies every event signature against it).

## Step 5: Update API URL for Production

After your first deployment, update the `VITE_API_URL` environment variable:

1. Copy your Vercel deployment URL (e.g., `https://your-app.vercel.app`)
2. Go to **Settings** → **Environment Variables**
3. Update `VITE_API_URL` to your Vercel domain
4. Redeploy (Vercel will auto-deploy when you push to GitHub)

## Step 6: Test Your Deployment

1. Visit your Vercel URL
2. Test the checkout flow with Stripe test card:
   - Card number: `4242 4242 4242 4242`
   - Expiry: Any future date
   - CVC: Any 3 digits
   - ZIP: Any 5 digits

## Step 7: Configure Stripe Webhook (Production)

The webhook is a Supabase Edge Function, NOT a Vercel route. Earlier
versions of this guide pointed at `your-app.vercel.app/api/webhook` —
that route does not exist; ignore any historic references.

1. Go to https://dashboard.stripe.com/webhooks (or `/test/webhooks` for test mode)
2. Click "Add endpoint"
3. Enter your webhook URL: `https://cbcevjhvgmxrxeeyldza.supabase.co/functions/v1/stripe-webhook`
4. Select events to listen to:
   - `checkout.session.completed`
5. Copy the webhook signing secret (starts with `whsec_`)
6. Add it to Supabase secrets (NOT Vercel — the function runs on Supabase):
   ```
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_... --project-ref cbcevjhvgmxrxeeyldza
   ```
7. Re-deploy the webhook function so the new secret takes effect:
   ```
   supabase functions deploy stripe-webhook --project-ref cbcevjhvgmxrxeeyldza --no-verify-jwt
   ```
   The `--no-verify-jwt` flag is required: Stripe does not send a Supabase
   JWT, so signature verification (inside the function) is the security
   boundary instead.

## Stripe endpoints (Supabase Edge Functions, NOT Vercel)

The Stripe payment path runs entirely as **Supabase Edge Functions** — there are no
Stripe serverless functions on Vercel. They read `STRIPE_SECRET_KEY` /
`STRIPE_WEBHOOK_SECRET` from Supabase Edge Function secrets:

- `create-checkout-session` - creates the Stripe Checkout Session from a quote
- `confirm-payment` - redirect path: verifies the paid session and creates the order (via `confirm_payment_atomic`)
- `stripe-webhook` - server-to-server backstop for the same, on `checkout.session.completed`

The legacy local Express server (`server/stripe-server.cjs`) that these replaced has been removed.

## Troubleshooting

### Issue: Payment not processing
- Check that `STRIPE_SECRET_KEY` is set correctly in **Supabase Edge Function secrets** (`supabase secrets list`), NOT Vercel
- Check the `stripe-webhook` function logs and the Stripe Dashboard → Webhooks event log

### Issue: CORS errors
- The serverless functions include CORS headers
- Verify you're using the correct API URL

### Issue: Environment variables not updating
- After changing environment variables, trigger a new deployment
- You can do this by pushing to GitHub or using "Redeploy" in Vercel dashboard

### Issue: Build fails
- Check that all dependencies are in `package.json`
- Verify `vercel.json` is in the project root
- Check build logs in Vercel dashboard

## Production Checklist

- [ ] Switch from test to production Stripe keys
- [ ] Update `VITE_API_URL` to production domain
- [ ] Configure Stripe webhook
- [ ] Test complete checkout flow
- [ ] Verify email confirmations work
- [ ] Test on mobile devices
- [ ] Set up custom domain (optional)
- [ ] Enable Vercel analytics (optional)

## Continuous Deployment

Once connected to GitHub, Vercel automatically deploys:
- **Production**: When you push to `main` branch
- **Preview**: When you push to other branches or create PRs

## Custom Domain (Optional)

1. Go to **Settings** → **Domains**
2. Add your custom domain
3. Update DNS records as instructed by Vercel
4. Update `VITE_API_URL` to use your custom domain

## Support

- Vercel Docs: https://vercel.com/docs
- Stripe Docs: https://stripe.com/docs
- Supabase Docs: https://supabase.com/docs

---

**Note**: Keep your `.env` file in `.gitignore` to prevent committing secrets to GitHub!
