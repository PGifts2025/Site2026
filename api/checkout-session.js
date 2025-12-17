const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { sessionId } = req.query;

  if (!sessionId) {
    res.status(400).json({ error: 'Session ID is required' });
    return;
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    console.log('[Stripe] Retrieved Checkout Session:', session.id);
    console.log('[Stripe] Payment status:', session.payment_status);

    res.status(200).json({
      sessionId: session.id,
      status: session.payment_status,
      customerEmail: session.customer_email || session.customer_details?.email,
      amountTotal: session.amount_total,
      currency: session.currency,
      metadata: session.metadata,
    });
  } catch (error) {
    console.error('[Stripe] Error retrieving Checkout Session:', error.message);

    if (error.type === 'StripeInvalidRequestError') {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.status(500).json({ error: error.message });
  }
};
