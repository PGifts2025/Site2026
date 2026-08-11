import { Link, useLocation } from 'react-router-dom';
import { Phone, Mail } from 'lucide-react';
import { BUSINESS, registeredOfficeLine } from '../config/business';

/**
 * Global site footer, rendered once in App.jsx on every route (replacing the
 * old homepage-only footer and the dead Footer.jsx stub). Carries the Companies
 * Act 2006 s.1202-1204 disclosure (corporate name + registered office + VAT
 * number) and working links to /privacy and /terms, so both appear site-wide
 * rather than on the homepage alone (audit-legal-pages.md).
 *
 * Appearance matches the previous homepage footer verbatim; this is about reach,
 * not redesign. Business identity is imported from the single source
 * (src/config/business.js), never duplicated.
 *
 * Hidden on /admin/*: the admin dashboard has its own full-screen chrome and is
 * not a public-facing page, so a marketing/legal footer there is out of place.
 * It IS shown on the customer dashboard (/account) and everywhere else.
 */
function SiteFooter() {
  const { pathname } = useLocation();
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return null;

  return (
    <footer className="bg-gray-800 text-white py-6 sm:py-8 lg:py-12">
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
          <div>
            <div className="flex items-center mb-6">
              <div className="bg-red-500 text-white rounded-full w-10 h-10 flex items-center justify-center font-bold text-lg mr-3">
                PG
              </div>
              <div>
                <h4 className="font-bold text-lg">{BUSINESS.tradingName}</h4>
                <p className="text-sm text-gray-300">YOUR PROMOTIONAL PARTNER</p>
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <h5 className="font-semibold text-white mb-2">Contact Details</h5>
                <div className="text-gray-300 space-y-1">
                  <p className="font-medium">Lines open 8:30-17:00, Monday-Friday</p>
                  <div className="flex items-center space-x-2">
                    <Phone className="h-4 w-4 text-red-500" />
                    <span>{BUSINESS.phone}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Mail className="h-4 w-4 text-red-500" />
                    <span>{BUSINESS.email}</span>
                  </div>
                </div>
              </div>

              <div>
                <h5 className="font-semibold text-white mb-2">Address</h5>
                <div className="text-gray-300 text-sm leading-relaxed">
                  {BUSINESS.tradingAddress.map((line, i) => <p key={i}>{line}</p>)}
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-lg mb-6">Product Categories</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <ul className="space-y-2 text-sm text-gray-300">
                  <li><Link to="/cups" className="hover:text-white cursor-pointer">Cups</Link></li>
                  <li><Link to="/water-bottles" className="hover:text-white cursor-pointer">Water Bottles</Link></li>
                  <li><Link to="/bags" className="hover:text-white cursor-pointer">Bags</Link></li>
                  <li><Link to="/clothing" className="hover:text-white cursor-pointer">Clothing</Link></li>
                  <li><Link to="/hi-vis" className="hover:text-white cursor-pointer">Hi Vis</Link></li>
                  <li><Link to="/cables" className="hover:text-white cursor-pointer">Cables</Link></li>
                </ul>
              </div>
              <div>
                <ul className="space-y-2 text-sm text-gray-300">
                  <li><Link to="/power" className="hover:text-white cursor-pointer">Power</Link></li>
                  <li><Link to="/speakers" className="hover:text-white cursor-pointer">Speakers</Link></li>
                  <li><Link to="/pens" className="hover:text-white cursor-pointer">Pens & Writing</Link></li>
                  <li><Link to="/notebooks" className="hover:text-white cursor-pointer">Notebooks</Link></li>
                  <li><Link to="/tea-towels" className="hover:text-white cursor-pointer">Tea Towels</Link></li>
                </ul>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-lg mb-6">Information</h4>
            <ul className="space-y-2 text-sm text-gray-300">
              <li><Link to="/privacy" className="hover:text-white cursor-pointer">Privacy Policy</Link></li>
              <li><Link to="/terms" className="hover:text-white cursor-pointer">Terms of Sale</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-700 mt-8 pt-6 text-center text-sm text-gray-400">
          <p>
            &copy; {new Date().getFullYear()} {BUSINESS.tradingName}. All rights reserved.
            {' '}<Link to="/privacy" className="underline hover:text-white">Privacy Policy</Link>
            {' | '}<Link to="/terms" className="underline hover:text-white">Terms of Sale</Link>
          </p>
          <p className="mt-2 text-xs text-gray-500 leading-relaxed">
            {BUSINESS.disclosure} Registered office: {registeredOfficeLine}. VAT No: {BUSINESS.vatNumber}.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default SiteFooter;
