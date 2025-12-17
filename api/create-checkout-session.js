import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

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
      payment_intent_data: {
        receipt_email: orderData.customer.email,
      },
      metadata: {
        orderNumber: orderData.orderNumber,
        customerName: orderData.customer.name,
        customerEmail: orderData.customer.email,
      },
    });

    console.log('[Stripe] ✓ Checkout Session created:', session.id);
    console.log('[Stripe] Total amount:', (session.amount_total / 100).toFixed(2), 'GBP');

    res.status(200).json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('[Stripe] Error creating Checkout Session:', error.message);
    res.status(500).json({ error: error.message });
  }
}
