# Stripe Payment Integration - PGifts

## Overview

PGifts now includes full Stripe payment processing integration with a two-step checkout flow:
1. **Step 1:** Customer details and shipping address
2. **Step 2:** Secure payment processing with Stripe

## What's Been Installed

### NPM Packages
- `stripe` - Stripe Node.js library for server
- `@stripe/stripe-js` - Stripe.js client library
- `@stripe/react-stripe-js` - React components for Stripe
- `express` - Web server for Stripe API
- `cors` - CORS middleware
- `concurrently` - Run multiple npm scripts simultaneously

### New Files Created
- `server/stripe-server.js` - Express server for Stripe API
- `src/components/StripePaymentForm.jsx` - Payment form component
- `.env.example` - Environment variables template

### Updated Files
- `src/pages/Checkout.jsx` - Two-step checkout process
- `src/pages/OrderConfirmation.jsx` - Payment details display
- `package.json` - Added Stripe server scripts

## Setup Instructions

### 1. Get Your Stripe API Keys

1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy your **Publishable key** (starts with `pk_test_`)
3. Copy your **Secret key** (starts with `sk_test_`)

### 2. Create .env File

```bash
# Copy the example file
cp .env.example .env
```

### 3. Add Your Stripe Keys to .env

Open `.env` and add your keys:

```env
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_ACTUAL_KEY_HERE
STRIPE_SECRET_KEY=sk_test_YOUR_ACTUAL_KEY_HERE
```

⚠️ **IMPORTANT:** Never commit `.env` to version control!

### 4. Start the Application

You have two options:

#### Option A: Run Both Servers Together (Recommended)
```bash
npm run dev:full
```

This starts:
- Vite dev server on http://localhost:5173 (or 3000)
- Stripe API server on http://localhost:3001

#### Option B: Run Servers Separately

Terminal 1 - Vite:
```bash
npm run dev
```

Terminal 2 - Stripe Server:
```bash
npm run stripe-server
```

## Testing the Integration

### Test Credit Cards

Stripe provides test cards that simulate different scenarios:

**Successful Payment:**
- Card: `4242 4242 4242 4242`
- Expiry: Any future date (e.g., 12/34)
- CVC: Any 3 digits (e.g., 123)
- ZIP: Any 5 digits (e.g., 12345)

**Declined Payment:**
- Card: `4000 0000 0000 0002`

**More test cards:** https://stripe.com/docs/testing

### Testing the Checkout Flow

1. Add items to cart from product pages (e.g., /cables/octomini)
2. Click "Proceed to Checkout" in cart
3. Fill in customer details and shipping address
4. Click "Continue to Payment"
5. Enter test card details in Stripe payment form
6. Click "Pay Now"
7. View order confirmation with payment details

## How It Works

### Architecture

```
┌─────────────────┐
│   React App     │ (Port 5173/3000)
│   (Frontend)    │
└────────┬────────┘
         │
         │ 1. Create PaymentIntent
         ▼
┌─────────────────┐
│ Stripe Server   │ (Port 3001)
│   (Backend)     │
└────────┬────────┘
         │
         │ 2. Generate client_secret
         ▼
┌─────────────────┐
│   Stripe API    │
│   (External)    │
└─────────────────┘
         │
         │ 3. Process payment
         ▼
     SUCCESS!
```

### Two-Step Checkout Process

#### Step 1: Customer Details
- Order summary with quantity controls
- Customer information form
- Shipping address form
- Billing address form (optional)
- Form validation
- Button: "Continue to Payment"

#### Step 2: Payment
- Compact order summary
- Customer & shipping info review
- Stripe Payment Element (embedded)
- Secure card input
- Button: "Pay Now"
- Real-time payment processing

### Components

**StripePaymentForm.jsx:**
- Creates PaymentIntent via API call to server
- Loads Stripe.js client library
- Renders Stripe Payment Element
- Handles payment submission
- Shows loading and error states

**Checkout.jsx:**
- Manages two-step flow with state
- Step indicator UI
- Form validation
- Passes order data to payment step
- Handles payment success/error callbacks

**stripe-server.js:**
- Express API server
- `/api/create-payment-intent` - Creates PaymentIntent
- `/api/payment-intent/:id` - Retrieves payment status
- `/api/webhook` - Webhook endpoint (for production)
- Runs on port 3001

## Security Best Practices

✅ **DO:**
- Keep `STRIPE_SECRET_KEY` in `.env` (server-only)
- Use `VITE_STRIPE_PUBLISHABLE_KEY` for client
- Never commit `.env` to Git
- Use test keys for development
- Use live keys only in production

❌ **DON'T:**
- Commit API keys to version control
- Use live keys in development
- Expose secret key in client code
- Skip webhook verification in production

## Order Confirmation

After successful payment, users see:
- ✅ Green success animation
- Order number
- Payment confirmation card with:
  - Payment ID
  - Payment status
  - Amount paid
  - Payment method
- Order summary
- Customer details
- Shipping address
- "Continue Shopping" button → /cables
- "Print Receipt" button
- "Track Order" button (placeholder)

## Available Scripts

```bash
# Start Vite dev server only
npm run dev

# Start Stripe server only
npm run stripe-server

# Start both servers together (recommended)
npm run dev:full

# Build for production
npm run build

# Preview production build
npm run preview
```

## Troubleshooting

### Error: "Failed to initialize payment"
- Check that Stripe server is running on port 3001
- Verify `.env` has correct Stripe keys
- Check browser console for errors

### Error: "Stripe.js has not loaded yet"
- Check internet connection
- Verify `VITE_STRIPE_PUBLISHABLE_KEY` in `.env`
- Check browser console for errors

### Payment Form Not Showing
- Ensure `VITE_STRIPE_PUBLISHABLE_KEY` is set
- Check that API call to `/api/create-payment-intent` succeeds
- Open browser DevTools → Network tab to debug

### Server Won't Start
- Check if port 3001 is already in use
- Verify `node_modules` are installed: `npm install`
- Check `.env` file exists and has STRIPE_SECRET_KEY

## Production Deployment

### Before Going Live:

1. **Switch to Live Keys:**
   - Get live keys from https://dashboard.stripe.com/apikeys
   - Update `.env` with live keys (pk_live_ and sk_live_)

2. **Set Up Webhooks:**
   - Configure webhook endpoint in Stripe Dashboard
   - Add STRIPE_WEBHOOK_SECRET to `.env`
   - Update webhook handler in `stripe-server.js`

3. **Update CORS:**
   - Configure production domain in `stripe-server.js`
   - Update allowed origins for security

4. **Environment Variables:**
   - Set all env vars in production hosting platform
   - Never commit `.env` to production

5. **Test Thoroughly:**
   - Test with live Stripe test mode first
   - Verify webhooks are working
   - Test all payment scenarios

## Support

### Stripe Documentation
- Dashboard: https://dashboard.stripe.com
- API Docs: https://stripe.com/docs/api
- Testing: https://stripe.com/docs/testing
- Elements: https://stripe.com/docs/stripe-js

### Need Help?
- Check Stripe logs: https://dashboard.stripe.com/test/logs
- Check browser console for errors
- Check Stripe server logs in terminal
- Review this documentation

## Features Implemented

✅ Two-step checkout flow
✅ Secure Stripe payment processing
✅ Real-time payment validation
✅ Order summary with editable quantities
✅ Customer information collection
✅ Shipping & billing address forms
✅ Payment confirmation page
✅ Order details display
✅ Print receipt functionality
✅ Email confirmation message
✅ Mobile responsive design
✅ Loading & error states
✅ Test mode indicators

## Test Card Cheat Sheet

```
✅ Success:           4242 4242 4242 4242
❌ Declined:          4000 0000 0000 0002
⚠️  Requires Auth:    4000 0025 0000 3155
💳 Insufficient:      4000 0000 0000 9995
🔒 Stolen Card:       4000 0000 0000 9979
```

**All test cards:**
- Any future expiry date
- Any 3-digit CVC
- Any 5-digit ZIP code

---

**Integration Complete!** 🎉

The PGifts checkout now has full Stripe payment processing with a professional two-step flow.
