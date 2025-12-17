import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Zap, Shield, Clock } from 'lucide-react';

const CablesCategory = () => {
  const navigate = useNavigate();

  const products = [
    {
      id: 'octomini',
      name: 'Octomini',
      shortDescription: 'Compact 8-in-1 charging solution with multiple connectors in a pocket-sized design',
      startingPrice: '4.50',
      image: '🔌',
      path: '/cables/octomini',
      badge: 'Best Seller'
    },
    {
      id: 'ocean-octopus',
      name: 'Ocean Octopus',
      shortDescription: 'Eco-friendly charging cable made from recycled ocean plastic materials',
      startingPrice: '5.20',
      image: '🌊',
      path: '/cables/ocean-octopus',
      badge: 'Eco-Friendly'
    },
    {
      id: 'mr-bio',
      name: 'Mr Bio',
      shortDescription: 'Sustainable charging cable crafted from biodegradable wheat straw composite',
      startingPrice: '3.80',
      image: '🌱',
      path: '/cables/mr-bio',
      badge: 'Sustainable'
    },
    {
      id: 'mr-bio-pd-long',
      name: 'Mr Bio PD Long',
      shortDescription: 'Extended-length biodegradable cable with Power Delivery fast charging support',
      startingPrice: '4.95',
      image: '⚡',
      path: '/cables/mr-bio-pd-long',
      badge: 'Fast Charge'
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-6">
          {/* Breadcrumb */}
          <div className="flex items-center space-x-2 text-sm text-gray-600 mb-4">
            <button
              onClick={() => navigate('/')}
              className="hover:text-blue-600 transition-colors"
            >
              Home
            </button>
            <ChevronRight className="h-4 w-4" />
            <span className="text-gray-900 font-semibold">Cables & Charging</span>
          </div>

          {/* Title */}
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Cables & Charging</h1>
            <p className="text-lg text-gray-600">
              Premium branded charging cables and accessories for your promotional needs
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Features Banner */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="bg-white rounded-2xl p-6 shadow-md border border-gray-200 flex items-start space-x-4">
            <div className="bg-blue-100 p-3 rounded-xl">
              <Zap className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Fast Delivery</h3>
              <p className="text-sm text-gray-600">Quick turnaround on bulk orders</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-md border border-gray-200 flex items-start space-x-4">
            <div className="bg-green-100 p-3 rounded-xl">
              <Shield className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Quality Guaranteed</h3>
              <p className="text-sm text-gray-600">Premium materials and finishes</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-md border border-gray-200 flex items-start space-x-4">
            <div className="bg-purple-100 p-3 rounded-xl">
              <Clock className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Low Minimums</h3>
              <p className="text-sm text-gray-600">Order quantities from 25 units</p>
            </div>
          </div>
        </div>

        {/* Products Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {products.map((product) => (
            <div
              key={product.id}
              className="group bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 cursor-pointer"
              onClick={() => navigate(product.path)}
            >
              {/* Product Image */}
              <div className="relative aspect-square bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center p-8">
                <div className="text-8xl group-hover:scale-110 transition-transform duration-300">
                  {product.image}
                </div>
                {product.badge && (
                  <div className="absolute top-4 left-4 bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-semibold shadow-lg">
                    {product.badge}
                  </div>
                )}
              </div>

              {/* Product Info */}
              <div className="p-6">
                <h3 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">
                  {product.name}
                </h3>
                <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                  {product.shortDescription}
                </p>

                {/* Price */}
                <div className="flex items-baseline justify-between mb-4">
                  <div>
                    <span className="text-sm text-gray-500">From</span>
                    <span className="text-2xl font-bold text-green-600 ml-2">
                      £{product.startingPrice}
                    </span>
                  </div>
                </div>

                {/* View Details Button */}
                <button
                  className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2 group-hover:shadow-lg"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(product.path);
                  }}
                >
                  <span>View Details</span>
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom CTA Section */}
        <div className="mt-16 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl p-12 text-center shadow-2xl">
          <h2 className="text-3xl font-bold text-white mb-4">
            Need Help Choosing?
          </h2>
          <p className="text-lg text-blue-100 mb-8 max-w-2xl mx-auto">
            Our team can help you select the perfect charging solution for your promotional campaign
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button className="px-8 py-4 bg-white text-blue-600 rounded-xl font-semibold hover:bg-gray-100 transition-colors shadow-lg">
              Contact Sales
            </button>
            <button className="px-8 py-4 bg-transparent text-white border-2 border-white rounded-xl font-semibold hover:bg-white/10 transition-colors">
              Request Quote
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CablesCategory;
