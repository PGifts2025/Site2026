// src/App.jsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Clothing from './pages/Clothing';
import Notebooks from './pages/Notebooks';
import WaterBottles from './pages/WaterBottles';
import Cups from './pages/Cups';
import Bags from './pages/Bags';
import HiVis from './pages/HiVis';
import Power from './pages/Power';
import Speakers from './pages/Speakers';
import Pens from './pages/Pens';
import TeaTowels from './pages/TeaTowels';
import Designer from './pages/Designer';
import ProductManager from './pages/ProductManager';
import AdminSeedData from './pages/AdminSeedData';
import Checkout from './pages/Checkout';
import OrderConfirmation from './pages/OrderConfirmation';
import HeaderBar from './components/HeaderBar';
import AuthProvider from './components/AuthProvider';
import { CartProvider } from './context/CartContext';
import Cart from './components/Cart';

// Dynamic Catalog Category Pages
import BagsCategory from './pages/categories/BagsCategory';
import CupsCategory from './pages/categories/CupsCategory';
import WaterBottlesCategory from './pages/categories/WaterBottlesCategory';
import ClothingCategory from './pages/categories/ClothingCategory';
import PowerCategory from './pages/categories/PowerCategory';
import HiVisCategory from './pages/categories/HiVisCategory';
import NotebooksCategory from './pages/categories/NotebooksCategory';
import TeaTowelsCategory from './pages/categories/TeaTowelsCategory';
import PensCategory from './pages/categories/PensCategory';
import SpeakersCategory from './pages/categories/SpeakersCategory';
import CablesCategory from './pages/categories/CablesCategory';

// Dynamic Product Detail
import ProductDetail from './pages/ProductDetail';

function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <Router>
          <HeaderBar />
          <Routes>
            {/* Home */}
            <Route path="/" element={<Home />} />

            {/* Dynamic Product Detail Routes - Must come BEFORE category routes */}
            <Route path="/bags/:productSlug" element={<ProductDetail />} />
            <Route path="/cups/:productSlug" element={<ProductDetail />} />
            <Route path="/water-bottles/:productSlug" element={<ProductDetail />} />
            <Route path="/clothing/:productSlug" element={<ProductDetail />} />
            <Route path="/cables/:productSlug" element={<ProductDetail />} />
            <Route path="/power/:productSlug" element={<ProductDetail />} />
            <Route path="/hi-vis/:productSlug" element={<ProductDetail />} />
            <Route path="/notebooks/:productSlug" element={<ProductDetail />} />
            <Route path="/tea-towels/:productSlug" element={<ProductDetail />} />
            <Route path="/pens/:productSlug" element={<ProductDetail />} />
            <Route path="/speakers/:productSlug" element={<ProductDetail />} />

            {/* Dynamic Catalog Category Pages */}
            <Route path="/bags" element={<BagsCategory />} />
            <Route path="/cups" element={<CupsCategory />} />
            <Route path="/water-bottles" element={<WaterBottlesCategory />} />
            <Route path="/clothing" element={<ClothingCategory />} />
            <Route path="/cables" element={<CablesCategory />} />
            <Route path="/power" element={<PowerCategory />} />
            <Route path="/hi-vis" element={<HiVisCategory />} />
            <Route path="/notebooks" element={<NotebooksCategory />} />
            <Route path="/tea-towels" element={<TeaTowelsCategory />} />
            <Route path="/pens" element={<PensCategory />} />
            <Route path="/speakers" element={<SpeakersCategory />} />

            {/* Legacy Static Category Pages (keeping for backwards compatibility) */}
            <Route path="/clothing-legacy" element={<Clothing />} />
            <Route path="/notebooks-legacy" element={<Notebooks />} />
            <Route path="/water-bottles-legacy" element={<WaterBottles />} />
            <Route path="/cups-legacy" element={<Cups />} />
            <Route path="/bags-legacy" element={<Bags />} />
            <Route path="/hi-vis-legacy" element={<HiVis />} />
            <Route path="/power-legacy" element={<Power />} />
            <Route path="/speakers-legacy" element={<Speakers />} />
            <Route path="/pens-legacy" element={<Pens />} />
            <Route path="/tea-towels-legacy" element={<TeaTowels />} />

            {/* Tools */}
            <Route path="/designer" element={<Designer />} />

            {/* Admin */}
            <Route path="/admin/products" element={<ProductManager />} />
            <Route path="/admin/seed-data" element={<AdminSeedData />} />

            {/* Checkout */}
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/order-confirmation" element={<OrderConfirmation />} />
          </Routes>
          <Cart />
        </Router>
      </CartProvider>
    </AuthProvider>
  );
}

export default App;
