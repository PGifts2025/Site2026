import { BUSINESS, registeredOfficeLine } from '../config/business';
import { LegalPage, H2, P, UL, LI, MailLink } from '../components/legal/Doc';

// Data-rights / deletion route (Dave's decision). Distinct from the general
// contact address (BUSINESS.email).
const HELPDESK = 'helpdesk@promo-gifts.co';

function Privacy() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="8 August 2026">
      <P>
        This policy explains what personal data we collect when you use this
        website, why we use it, who we share it with, and how long we keep it. It
        is written to reflect what the site actually does.
      </P>

      <H2>Who we are</H2>
      <P>
        This website is operated by {BUSINESS.legalEntity}, trading as{' '}
        {BUSINESS.tradingName}. {BUSINESS.disclosure} We are the data controller
        for the personal data described here.
      </P>
      <UL>
        <LI>Registered office: {registeredOfficeLine}</LI>
        <LI>VAT number: {BUSINESS.vatNumber}</LI>
        <LI>General contact: <MailLink address={BUSINESS.email} /> or {BUSINESS.phone}</LI>
        <LI>Privacy and data-rights contact: <MailLink address={HELPDESK} /></LI>
      </UL>

      <H2>The personal data we collect</H2>
      <UL>
        <LI><strong>Account details:</strong> your name and email address, and a password (which we store only in an encrypted, hashed form and never see in plain text).</LI>
        <LI><strong>Profile and contact details:</strong> company name and phone number, where you provide them.</LI>
        <LI><strong>Orders and quotes:</strong> the products you order, quantities, prices, and your order history.</LI>
        <LI><strong>Delivery details:</strong> the delivery address, recipient name, phone number, and any delivery instructions you give.</LI>
        <LI><strong>Artwork you upload:</strong> logos, designs, and print-ready files you send us for your order. These may themselves contain personal data or third-party material, so please only upload what you are entitled to use (see our <a href="/terms" className="text-blue-700 underline hover:text-blue-900">Terms of Sale</a>).</LI>
        <LI><strong>AI assistant queries:</strong> the messages you type into our on-site AI assistant, and the search terms it uses to find products.</LI>
        <LI><strong>Anonymous visitor identification:</strong> if you use the AI assistant without signing in, we generate a device identifier to apply fair-use limits. See "Cookies and tracking" below for exactly how this works.</LI>
        <LI><strong>Payment information:</strong> your card payment is handled entirely by Stripe. We never receive or store your card number; we keep only a payment reference and the amount.</LI>
        <LI><strong>Technical data:</strong> your IP address and standard request logs, generated automatically when you visit the site.</LI>
      </UL>

      <H2>Why we use your data, and our lawful basis</H2>
      <UL>
        <LI><strong>To take and fulfil your orders</strong> (creating quotes and orders, processing payment, producing your artwork, arranging delivery, and sending order-related emails): <strong>performance of our contract</strong> with you.</LI>
        <LI><strong>To run the AI assistant, apply fair-use limits, and prevent fraud and abuse:</strong> our <strong>legitimate interests</strong> in providing and protecting the service.</LI>
        <LI><strong>To keep accounting and tax records:</strong> compliance with a <strong>legal obligation</strong> (UK tax law).</LI>
      </UL>

      <H2>Who we share your data with</H2>
      <P>
        We do not sell your personal data. We use the following service providers
        ("processors") to run the site. Each only receives the data it needs for
        its role.
      </P>
      <UL>
        <LI><strong>Supabase</strong>:our database, sign-in system, and file storage. Holds your account, order, and artwork data.</LI>
        <LI><strong>Vercel</strong>:hosts the website and its server functions. It does not hold your account data, but it processes your IP address and request logs as part of serving the site.</LI>
        <LI><strong>Stripe</strong>:processes card payments. Your card details go to Stripe, not to us.</LI>
        <LI><strong>Resend</strong>:sends our transactional emails (order confirmations, artwork notifications, sign-in emails). Receives your email address and the relevant order details.</LI>
        <LI><strong>Anthropic</strong>:provides the AI model behind the on-site assistant. It receives the messages you send to the assistant.</LI>
        <LI><strong>OpenAI</strong>:used separately from the assistant to turn your product-search wording into a form we can match against our catalogue. It receives your search query text. This is a distinct provider from the assistant above.</LI>
        <LI><strong>FingerprintJS</strong>:provides the code for the anonymous device identification used for AI fair-use limits. This runs entirely in your browser and does not receive your data (described under "Cookies and tracking").</LI>
      </UL>

      <H2>How long we keep it</H2>
      <UL>
        <LI><strong>Artwork files:</strong> kept for <strong>3 months</strong> after your order is completed, then deleted.</LI>
        <LI><strong>Order records:</strong> kept for <strong>6 years</strong>, because we are required to retain accounting records. If an order is "deleted" from your view, it is hidden rather than erased, and the underlying record is retained for this tax-record period.</LI>
        <LI><strong>Account data:</strong> kept for as long as you have an account. We keep it until you ask us to delete it. There is no self-service delete; email <MailLink address={HELPDESK} /> and we will action your request (subject to any records we must keep by law, such as orders within the 6-year period above).</LI>
        <LI><strong>AI assistant conversations:</strong> retained to operate and improve the service and to investigate misuse; ask us via <MailLink address={HELPDESK} /> if you want a conversation removed.</LI>
      </UL>

      <H2>Where your data is held, and international transfers</H2>
      <P>
        Your stored personal data is held in the United Kingdom: our database and
        file storage (Supabase) are hosted in London. Some of the providers that
        help run the site operate in the United States, so a limited amount of
        your data is processed there even though the main database stays in the
        UK: <strong>Vercel</strong> processes your IP address and request logs,{' '}
        <strong>Anthropic</strong> receives the messages you send to the AI
        assistant, and <strong>OpenAI</strong> receives your product-search
        wording. For these transfers, each of these providers' published
        data-processing terms relies on the UK's recognised safeguard for
        international transfers: the EU Standard Contractual Clauses together with
        the UK Addendum (also called the UK International Data Transfer Addendum),
        issued by the Information Commissioner's Office under section 119A of the
        Data Protection Act 2018. Our anonymous-visitor identification
        (FingerprintJS) runs entirely in your own browser and sends nothing to its
        provider, so it does not involve an international transfer; only the
        resulting one-way hash is stored, in our UK database.
      </P>

      <H2>Your rights</H2>
      <P>
        Under UK data protection law you have the right to access the personal
        data we hold about you, to have it corrected, to have it erased, to
        restrict or object to how we use it, and to receive a copy in a portable
        form. To exercise any of these, email <MailLink address={HELPDESK} />.
      </P>
      <P>
        We will respond within the time the law allows. In some cases we may need
        to keep certain data (for example, order records within the 6-year tax
        period) even after a deletion request, and we will tell you if so.
      </P>

      <H2>Cookies and tracking</H2>
      <P>
        We do not use advertising or analytics cookies. To keep you signed in, we
        store a small amount of information in your browser; this is essential to
        the site working and cannot be switched off without breaking sign-in.
      </P>
      <P>
        <strong>Device fingerprinting (FingerprintJS).</strong> When you use the
        AI assistant without signing in, we use FingerprintJS to build a device
        identifier from characteristics of your browser and device (a "device
        fingerprint"), which we use to apply fair-use limits to the anonymous
        assistant. This is <strong>not</strong> a cookie: it is derived from your
        device's own characteristics, so it <strong>cannot be removed by clearing
        your cookies</strong>, and clearing your browsing data does not reset it.
        We convert the identifier into a one-way hash before storing it, and we
        never store the raw fingerprint. Signing in avoids anonymous fingerprinting.
      </P>

      <H2>Complaints</H2>
      <P>
        If you are unhappy with how we handle your personal data, please contact
        us first at <MailLink address={HELPDESK} /> so we can try to put it right.
        You also have the right to complain to the Information Commissioner's
        Office (ICO), the UK's data protection regulator, at{' '}
        <a href="https://ico.org.uk" className="text-blue-700 underline hover:text-blue-900" target="_blank" rel="noreferrer">ico.org.uk</a>.
      </P>
      <P>
        {BUSINESS.legalEntity} is registered with the Information Commissioner's
        Office under registration number ZC222668.
      </P>

      <H2>Changes to this policy</H2>
      <P>
        We may update this policy from time to time. The date at the top shows
        when it was last changed.
      </P>
    </LegalPage>
  );
}

export default Privacy;
