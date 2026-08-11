import { Link } from 'react-router-dom';

// Shared presentation for the legal pages (Privacy, Terms). Keeps them matching
// the site's typography and each other, so the content files stay readable.

export function LegalPage({ title, lastUpdated, children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-10 sm:py-14">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 sm:p-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-1">{title}</h1>
          <p className="text-sm text-gray-500 mb-8">Last updated: {lastUpdated}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export const H2 = ({ children }) => (
  <h2 className="text-xl font-bold text-gray-900 mt-8 mb-3">{children}</h2>
);

export const H3 = ({ children }) => (
  <h3 className="text-base font-semibold text-gray-900 mt-5 mb-2">{children}</h3>
);

export const P = ({ children }) => (
  <p className="text-gray-700 leading-relaxed mb-4">{children}</p>
);

export const UL = ({ children }) => (
  <ul className="list-disc pl-6 space-y-2 text-gray-700 leading-relaxed mb-4">{children}</ul>
);

export const LI = ({ children }) => <li>{children}</li>;

// A visible, deliberately-unmissable placeholder for the two facts Dave still
// has to supply. Do NOT remove these until the real values are filled in.
export const ToConfirm = ({ children }) => (
  <div className="border-l-4 border-amber-500 bg-amber-50 text-amber-900 p-4 rounded my-4 text-sm leading-relaxed">
    <span className="font-bold uppercase tracking-wide">To confirm: </span>{children}
  </div>
);

export const MailLink = ({ address }) => (
  <a href={`mailto:${address}`} className="text-blue-700 underline hover:text-blue-900">{address}</a>
);

export const TermsLink = ({ children }) => (
  <Link to="/terms" className="text-blue-700 underline hover:text-blue-900">{children}</Link>
);
