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
import CablesCategory from './pages/CablesCategory';
import Octomini from './pages/products/Octomini';
import OceanOctopus from './pages/products/OceanOctopus';
import MrBio from './pages/products/MrBio';
import MrBioPDLong from './pages/products/MrBioPDLong';
import Checkout from './pages/Checkout';
import OrderConfirmation from './pages/OrderConfirmation';
import HeaderBar from './components/HeaderBar';
import AuthProvider from './components/AuthProvider';
import { CartProvider } from './context/CartContext';
import Cart from './components/Cart';

function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <Router>
          <HeaderBar />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/clothing" element={<Clothing />} />
            <Route path="/notebooks" element={<Notebooks />} />
            <Route path="/water-bottles" element={<WaterBottles />} />
            <Route path="/cups" element={<Cups />} />
            <Route path="/bags" element={<Bags />} />
            <Route path="/hi-vis" element={<HiVis />} />
            <Route path="/cables" element={<CablesCategory />} />
            <Route path="/power" element={<Power />} />
            <Route path="/speakers" element={<Speakers />} />
            <Route path="/pens" element={<Pens />} />
            <Route path="/tea-towels" element={<TeaTowels />} />
            <Route path="/designer" element={<Designer />} />
            <Route path="/admin/products" element={<ProductManager />} />
            <Route path="/admin/seed-data" element={<AdminSeedData />} />
            <Route path="/cables/octomini" element={<Octomini />} />
            <Route path="/cables/ocean-octopus" element={<OceanOctopus />} />
            <Route path="/cables/mr-bio" element={<MrBio />} />
            <Route path="/cables/mr-bio-pd-long" element={<MrBioPDLong />} />
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
