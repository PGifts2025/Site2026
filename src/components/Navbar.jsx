import { Link } from "react-router-dom";
import { navLinks } from "../data/navLinks";

function Navbar() {
  return (
    <header className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4">
        {/* Promo bar with logo, search, icons */}
        <div className="flex items-center justify-between py-4">
          <h1 className="font-bold text-lg text-red-600">Promo Gifts</h1>
          <input type="text" placeholder="Search..." className="border px-2 py-1 rounded" />
          <div className="flex space-x-4">
            <Link to="/account">My Account</Link>
            <Link to="/cart">Basket</Link>
          </div>
        </div>

        {/* Black bar navigation */}
        <nav className="bg-black text-white px-2 py-2 flex space-x-4">
          {navLinks.map((link) => (
            <Link key={link.path} to={link.path} className="hover:underline">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export default Navbar;
