const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const path = require('path');

// Load .env from project root
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Initialize Stripe with secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();

// Log to verify key is loaded (remove sensitive info in production)
console.log('[Stripe] API Key loaded:', process.env.STRIPE_SECRET_KEY ? 'Yes ✓' : 'No ✗ - Check .env file!');

// Middleware - Allow all localhost ports for development
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Allow all localhost origins for development
    if (origin.startsWith('http://localhost:')) {
      return callback(null, true);
    }

    // For production, you'd check against specific domains
    callback(null, false);
  }
}));
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Stripe server is running' });
});

// Create Checkout Session endpoint (NEW - replaces PaymentIntent)
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { orderData, successUrl, cancelUrl } = req.body;

    console.log('[Stripe] Creating Checkout Session...');
    console.log('[Stripe] Order Number:', orderData.orderNumber);
    console.log('[Stripe] Customer Email:', orderData.customer.email);
    console.log('[Stripe] Order amounts - Subtotal:', orderData.subtotal, 'Shipping:', orderData.shipping, 'VAT:', orderData.vat, 'Total:', orderData.total);

    // Build line items from order items
    const lineItems = orderData.items.map(item => ({
      price_data: {
        currency: 'gbp',
        product_data: {
          name: item.name || item.product_name,
          description: `Color: ${item.color}`,
        },
        unit_amount: Math.round((item.price || item.unitPrice) * 100), // Convert to pence
      },
      quantity: item.quantity,
    }));

    // Add shipping as a line item
    if (orderData.shipping && parseFloat(orderData.shipping) > 0) {
      lineItems.push({
        price_data: {
          currency: 'gbp',
          product_data: {
            name: 'Shipping',
            description: 'Standard delivery',
          },
          unit_amount: Math.round(parseFloat(orderData.shipping) * 100),
        },
        quantity: 1,
      });
    }

    // Add VAT as a line item
    if (orderData.vat && parseFloat(orderData.vat) > 0) {
      const vatAmount = Math.round(parseFloat(orderData.vat) * 100);
      lineItems.push({
        price_data: {
          currency: 'gbp',
          product_data: {
            name: 'VAT (20%)',
            description: 'Value Added Tax',
          },
          unit_amount: vatAmount,
        },
        quantity: 1,
      });
      console.log('[Stripe] ✓ Added VAT line item:', (vatAmount / 100).toFixed(2), 'GBP');
    }

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: orderData.customer.email,
      metadata: {
        orderNumber: orderData.orderNumber,
        customerName: orderData.customer.name,
        customerEmail: orderData.customer.email,
      },
    });

    console.log('[Stripe] ✓ Checkout Session created:', session.id);
    console.log('[Stripe] Total amount:', (session.amount_total / 100).toFixed(2), 'GBP');

    res.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('[Stripe] Error creating Checkout Session:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Retrieve Checkout Session endpoint (for order confirmation)
app.get('/api/checkout-session/:sessionId', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);

    console.log('[Stripe] Retrieved Checkout Session:', session.id);
    console.log('[Stripe] Payment status:', session.payment_status);

    res.json({
      sessionId: session.id,
      status: session.payment_status,
      customerEmail: session.customer_email || session.customer_details?.email,
      amountTotal: session.amount_total,
      currency: session.currency,
      metadata: session.metadata,
    });
  } catch (error) {
    console.error('[Stripe] Error retrieving Checkout Session:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Verify Payment Status
app.get('/api/payment-status/:paymentIntentId', async (req, res) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(req.params.paymentIntentId);
    res.json({ status: paymentIntent.status });
  } catch (error) {
    console.error('[Stripe] Error verifying payment:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Webhook endpoint for Stripe events (for production)
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[Stripe] Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('[Stripe] PaymentIntent succeeded:', paymentIntent.id);
      // TODO: Update order status in database
      break;
    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.log('[Stripe] Payment failed:', failedPayment.id);
      // TODO: Handle failed payment
      break;
    default:
      console.log('[Stripe] Unhandled event type:', event.type);
  }

  res.json({ received: true });
});

const PORT = process.env.STRIPE_SERVER_PORT || 3001;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('[Stripe Server] Running on http://localhost:' + PORT);
  console.log('[Stripe Server] Stripe API Version:', stripe.apiVersion);
  console.log('[Stripe Server] Environment:', process.env.STRIPE_SECRET_KEY ? 'Configured' : 'MISSING SECRET KEY!');
  console.log('[Stripe Server] Press Ctrl+C to stop');
});

// Keep the server running
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('\n[Stripe Server] Shutting down...');
  server.close(() => {
    console.log('[Stripe Server] Closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n[Stripe Server] Shutting down...');
  server.close(() => {
    process.exit(0);
  });
});

// Prevent the process from exiting
process.stdin.resume();
