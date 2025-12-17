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
   - **Important**: Only add variables starting with `VITE_` as "Production" and "Preview"
   - Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as "Production" only
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

### Server-side Variables (Serverless Functions Only)
- `STRIPE_SECRET_KEY` - Your Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - Your Stripe webhook secret (optional)

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

1. Go to https://dashboard.stripe.com/webhooks
2. Click "Add endpoint"
3. Enter your webhook URL: `https://your-app.vercel.app/api/webhook`
4. Select events to listen to:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
5. Copy the webhook signing secret
6. Add it to Vercel environment variables as `STRIPE_WEBHOOK_SECRET`

## Serverless Function Endpoints

Your Vercel deployment includes these serverless functions:

- **POST** `/api/create-checkout-session` - Create Stripe Checkout Session
- **GET** `/api/checkout-session?sessionId=xxx` - Retrieve session details

These replace the Express server (`server/stripe-server.cjs`) used in local development.

## Troubleshooting

### Issue: Payment not processing
- Check that `STRIPE_SECRET_KEY` is set correctly in Vercel
- Verify `VITE_API_URL` points to your Vercel domain

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
