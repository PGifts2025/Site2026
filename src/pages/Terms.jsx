import { BUSINESS } from '../config/business';
import { LegalPage, H2, H3, P, UL, LI, MailLink } from '../components/legal/Doc';

const HELPDESK = 'helpdesk@promo-gifts.co';

// A prominent, unmissable box for the point most likely to cause a dispute:
// personalised/printed goods are not cancellable.
const Prominent = ({ children }) => (
  <div className="border-l-4 border-blue-600 bg-blue-50 text-blue-900 p-4 rounded my-4 leading-relaxed">
    {children}
  </div>
);

function Terms() {
  return (
    <LegalPage title="Terms of Sale" lastUpdated="8 August 2026">
      <P>
        These terms govern the sale of products by {BUSINESS.legalEntity}, trading
        as {BUSINESS.tradingName} ("we", "us", "our"), through this website. Please
        read them before ordering. By placing an order you accept these terms.
      </P>

      <H2>1. Business and consumer customers</H2>
      <P>
        We sell to both businesses and consumers. Some rights in these terms apply
        only to consumers (an individual buying for purposes outside a business).
        Where a term is marked as applying to consumers, it does not apply to
        business customers. Business customers confirm that they are buying in the
        course of a business.
      </P>

      <H2>2. Placing an order and when a contract is formed</H2>
      <P>
        You choose products, quantities, colours, and any printing, and confirm
        your quote. Payment is taken at that point through our payment provider,
        Stripe. A binding contract is formed when we confirm your paid order. We
        may decline or cancel an order (see section 12), in which case we refund
        any payment taken.
      </P>

      <H2>3. Prices and VAT</H2>
      <P>
        Prices are shown exclusive of VAT. VAT is added at checkout and shown
        before you pay. Children's clothing lines are zero-rated on the garment
        portion, so VAT on those items applies only to the printing and services
        element; this is reflected in the checkout total.
      </P>

      <H2>4. Payment</H2>
      <P>
        Full payment is required with your order. We accept card payment only,
        processed securely by Stripe; we do not offer credit or account terms and
        do not store your card details.
      </P>

      <H2>5. Minimum order quantities</H2>
      <P>
        Products have minimum order quantities, shown on each product page. Some
        products can only be ordered up to a certain quantity online; above that
        threshold the site asks you to contact us so we can quote the larger run.
      </P>

      <H2>6. Your artwork and intellectual property</H2>
      <P>
        When you upload artwork (logos, designs, or print-ready files), you confirm
        that you own it or are licensed to use it for this purpose. You are
        responsible for making sure your artwork does not infringe anyone else's
        rights, and you agree to cover us against any third-party claim arising
        from the artwork you supply.
      </P>
      <P>
        You grant us the licence we need to reproduce your artwork in order to
        fulfil your order (including preparing proofs and production files).
      </P>

      <H2>7. Proofs and approval</H2>
      <P>
        Where a proof is provided, please check it carefully. Once you approve a
        proof, you are responsible for any errors within the approved artwork,
        including spelling, layout, and your choice of colours. We produce to the
        approved proof.
      </P>

      <H2>8. Colour reproduction</H2>
      <P>
        Colours shown on screen are indicative only. Printed and product colours
        may differ from what you see on your device, and a result within normal
        commercial tolerance is not a fault. If exact colour matching matters,
        please tell us before you approve your proof.
      </P>

      <H2>9. Lead times and delivery</H2>
      <P>
        Stated lead times are estimates and run from artwork approval, not from
        when the order is placed. Where an Express service (for example, our
        5-day Express) is offered, its timescale also runs from artwork approval.
      </P>
      <P>
        Stock levels shown for supplier products are refreshed periodically and
        are indicative, not a guarantee of availability; all orders are subject to
        stock. Delivery to one UK address is included in the price. Delivery
        outside the UK is by prior arrangement; please contact us before ordering.
      </P>

      <H2>10. Cancellation and returns</H2>

      <Prominent>
        <strong>Personalised and printed goods cannot be cancelled or returned.</strong>{' '}
        Because the products we print are made to your specification and clearly
        personalised, the 14-day right to cancel that normally applies to
        consumer distance sales does not apply once production or artwork approval
        has begun. Please make sure your order and approved proof are correct.
      </Prominent>

      <H3>Consumers</H3>
      <P>
        For non-personalised, unused stock items, a consumer's normal 14-day
        cancellation right under the Consumer Contracts Regulations 2013 applies.
        It does not apply to personalised or printed goods, as set out above.
        Nothing in these terms affects your statutory rights if goods are faulty,
        not as described, or not fit for purpose under the Consumer Rights Act
        2015; contact us and we will put it right.
      </P>

      <H3>Business customers</H3>
      <P>
        Consumer cancellation rights do not apply to business customers. Orders,
        once accepted, may only be cancelled with our agreement, and personalised
        or printed goods, or goods already in production, cannot be cancelled.
      </P>

      <H2>11. Faulty goods</H2>
      <P>
        If your goods arrive faulty, damaged, or not as described, please contact
        us promptly at <MailLink address={HELPDESK} /> with your order number and
        details (photos help). We will arrange a repair, replacement, or refund as
        appropriate.
      </P>

      <H2>12. Cancellation or refusal by us</H2>
      <P>
        We may cancel or decline an order, refunding any payment taken, for
        example if we cannot lawfully produce the artwork supplied, if a product
        is unavailable, or in the event of a genuine pricing error.
      </P>

      <H2>13. Our liability</H2>
      <P>
        We do not exclude or limit our liability where it would be unlawful to do
        so, including for death or personal injury caused by our negligence, or
        for fraud. Subject to that, our total liability for an order is limited to
        the price paid for that order, and we are not liable for indirect or
        consequential losses, or for loss of profit, business, or goodwill. For
        business customers, we are not liable for any losses beyond the price of
        the order.
      </P>

      <H2>14. Complaints</H2>
      <P>
        If something has gone wrong, please contact us at <MailLink address={HELPDESK} />{' '}
        or on {BUSINESS.phone}. We aim to acknowledge complaints promptly and to
        resolve them fairly.
      </P>

      <H2>15. Governing law</H2>
      <P>
        These terms and any dispute arising from them are governed by the law of
        England and Wales, and are subject to the courts of England and Wales.
      </P>
    </LegalPage>
  );
}

export default Terms;
