// src/pages/Pens.jsx
import React, { useState, useEffect } from 'react';
import { Star, Heart, Share2, ShoppingCart, Check, Zap, Shield, Truck, ChevronLeft, ChevronRight, Plus, Minus } from 'lucide-react';

const Pens = () => {
  const [selectedColor, setSelectedColor] = useState('midnight');
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(48);
  const [activeTab, setActiveTab] = useState('details');
  const [isLiked, setIsLiked] = useState(false);
  const [animatePrice, setAnimatePrice] = useState(false);

  // Product data
  const product = {
    name: "Premium Vacuum Flask",
    subtitle: "Double-walled stainless steel with custom branding",
    rating: 4.8,
    reviews: 2847,
    badge: "Best Seller",
    description: "Experience premium quality with our flagship vacuum flask. Perfect for corporate gifts, events, and promotional campaigns.",
    
    colors: [
      { id: 'midnight', name: 'Midnight Black', hex: '#1a1a1a', image: '🍼' },
      { id: 'steel', name: 'Brushed Steel', hex: '#c0c0c0', image: '🍼' },
      { id: 'navy', name: 'Navy Blue', hex: '#1e3a8a', image: '🍼' },
      { id: 'forest', name: 'Forest Green', hex: '#166534', image: '🍼' },
      { id: 'crimson', name: 'Crimson Red', hex: '#dc2626', image: '🍼' }
    ],

    features: [
      "24-hour hot/cold retention",
      "Premium 304 stainless steel",
      "Leak-proof design",
      "BPA & PVC free",
      "Laser engraving included",
      "Gift box packaging"
    ],

    specifications: {
      capacity: "500ml",
      material: "Stainless Steel 304",
      dimensions: "26cm H x 7cm W",
      weight: "350g",
      printArea: "40mm x 15mm"
    }
  };

  // Pricing tiers
  const pricingTiers = [
    { min: 25, max: 49, price: 24.99, popular: false },
    { min: 50, max: 99, price: 19.99, popular: true },
    { min: 100, max: 249, price: 16.99, popular: false },
    { min: 250, max: 499, price: 14.99, popular: false },
    { min: 500, max: 999, price: 12.99, popular: false },
    { min: 1000, max: null, price: 10.99, popular: false }
  ];

  // Get current pricing tier
  const getCurrentTier = () => {
    return pricingTiers.find(tier => 
      quantity >= tier.min && (tier.max === null || quantity <= tier.max)
    ) || pricingTiers[0];
  };

  const currentTier = getCurrentTier();
  const totalPrice = (currentTier.price * quantity).toFixed(2);

  // Animate price changes
  useEffect(() => {
    setAnimatePrice(true);
    const timer = setTimeout(() => setAnimatePrice(false), 300);
    return () => clearTimeout(timer);
  }, [quantity]);

  const handleQuantityChange = (value) => {
    const newQuantity = Math.max(25, Math.min(10000, value));
    setQuantity(newQuantity);
  };

  const images = Array(4).fill(null).map((_, i) => ({
    id: i,
    url: `Product image ${i + 1}`,
    alt: `${product.name} - View ${i + 1}`
  }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <h1 className="text-xl font-bold text-gray-900">Back to Products</h1>
            </div>
            <div className="flex items-center space-x-4">
              <button 
                onClick={() => setIsLiked(!isLiked)}
                className={`p-3 rounded-full transition-all duration-300 ${
                  isLiked 
                    ? 'bg-red-500 text-white shadow-lg shadow-red-500/25' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <Heart className={`h-5 w-5 ${isLiked ? 'fill-current' : ''}`} />
              </button>
              <button className="p-3 bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200 transition-colors">
                <Share2 className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-12 gap-8">
          
          {/* Product Images */}
          <div className="col-span-5">
            <div className="sticky top-24">
              {/* Badge */}
              <div className="absolute top-4 left-4 z-10">
                <span className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-4 py-2 rounded-full text-sm font-bold shadow-lg">
                  {product.badge}
                </span>
              </div>

              {/* Main Image */}
              <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-3xl p-12 mb-6 aspect-square flex items-center justify-center relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                <div className="text-9xl transform transition-all duration-700 group-hover:scale-110 group-hover:rotate-12 relative z-10" style={{ color: product.colors.find(c => c.id === selectedColor)?.hex }}>
                  {product.colors.find(c => c.id === selectedColor)?.image}
                </div>
                
                {/* Floating elements for visual appeal */}
                <div className="absolute top-8 right-8 w-4 h-4 bg-blue-400 rounded-full opacity-30 animate-pulse"></div>
                <div className="absolute bottom-12 left-8 w-6 h-6 bg-purple-400 rounded-full opacity-20 animate-bounce" style={{ animationDelay: '1s' }}></div>
              </div>

              {/* Thumbnail Images */}
              <div className="flex space-x-4">
                {images.map((image, index) => (
                  <button
                    key={image.id}
                    onClick={() => setSelectedImage(index)}
                    className={`flex-1 aspect-square bg-gray-100 rounded-xl p-4 border-2 transition-all duration-300 ${
                      selectedImage === index 
                        ? 'border-blue-500 shadow-lg shadow-blue-500/25' 
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="w-full h-full flex items-center justify-center text-2xl">
                      {product.colors.find(c => c.id === selectedColor)?.image}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Product Info */}
          <div className="col-span-4 space-y-8">
            
            {/* Basic Info */}
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">{product.name}</h1>
              <p className="text-xl text-gray-600 mb-4">{product.subtitle}</p>
              
              {/* Rating */}
              <div className="flex items-center space-x-4 mb-6">
                <div className="flex items-center space-x-1">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className={`h-5 w-5 ${i < Math.floor(product.rating) ? 'text-yellow-400 fill-current' : 'text-gray-300'}`} />
                  ))}
                  <span className="ml-2 text-lg font-semibold text-gray-900">{product.rating}</span>
                </div>
                <span className="text-gray-500">({product.reviews.toLocaleString()} reviews)</span>
              </div>

              <p className="text-gray-700 leading-relaxed">{product.description}</p>
            </div>

            {/* Color Selection */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Choose Color</h3>
              <div className="flex space-x-3">
                {product.colors.map((color) => (
                  <button
                    key={color.id}
                    onClick={() => setSelectedColor(color.id)}
                    className={`relative w-12 h-12 rounded-full border-2 transition-all duration-300 ${
                      selectedColor === color.id 
                        ? 'border-gray-400 shadow-lg scale-110' 
                        : 'border-gray-200 hover:border-gray-300 hover:scale-105'
                    }`}
                    style={{ backgroundColor: color.hex }}
                  >
                    {selectedColor === color.id && (
                      <div className="absolute inset-0 rounded-full border-2 border-white shadow-inner"></div>
                    )}
                  </button>
                ))}
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Selected: {product.colors.find(c => c.id === selectedColor)?.name}
              </p>
            </div>

            {/* Features */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Key Features</h3>
              <div className="grid grid-cols-2 gap-3">
                {product.features.map((feature, index) => (
                  <div key={index} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                    <Check className="h-5 w-5 text-green-500 flex-shrink-0" />
                    <span className="text-sm text-gray-700">{feature}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tabs */}
            <div>
              <div className="flex space-x-1 mb-6 bg-gray-100 p-1 rounded-lg">
                {['details', 'specs'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all duration-300 ${
                      activeTab === tab 
                        ? 'bg-white text-gray-900 shadow-sm' 
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {tab === 'details' ? 'Product Details' : 'Specifications'}
                  </button>
                ))}
              </div>

              {activeTab === 'details' && (
                <div className="space-y-4">
                  <div className="flex items-center space-x-3 p-4 bg-blue-50 rounded-lg">
                    <Zap className="h-6 w-6 text-blue-500" />
                    <div>
                      <h4 className="font-semibold text-gray-900">24-Hour Temperature Retention</h4>
                      <p className="text-sm text-gray-600">Keeps drinks hot or cold for up to 24 hours</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 p-4 bg-green-50 rounded-lg">
                    <Shield className="h-6 w-6 text-green-500" />
                    <div>
                      <h4 className="font-semibold text-gray-900">Premium Materials</h4>
                      <p className="text-sm text-gray-600">Food-grade 304 stainless steel construction</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 p-4 bg-purple-50 rounded-lg">
                    <Truck className="h-6 w-6 text-purple-500" />
                    <div>
                      <h4 className="font-semibold text-gray-900">Free Delivery</h4>
                      <p className="text-sm text-gray-600">Express delivery on orders over £250</p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'specs' && (
                <div className="space-y-3">
                  {Object.entries(product.specifications).map(([key, value]) => (
                    <div key={key} className="flex justify-between py-3 border-b border-gray-100 last:border-0">
                      <span className="text-gray-600 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                      <span className="font-semibold text-gray-900">{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Pricing Panel */}
          <div className="col-span-3">
            <div className="sticky top-24">
              <div className="bg-white rounded-3xl shadow-xl border border-gray-200/50 overflow-hidden">
                
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-blue-700 p-6 text-white">
                  <h3 className="text-xl font-bold mb-2">Configure & Quote</h3>
                  <p className="text-blue-100 text-sm">Bulk pricing available</p>
                </div>

                <div className="p-6 space-y-6">
                  
                  {/* Quantity Selector */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">Quantity</label>
                    <div className="flex items-center space-x-4">
                      <button 
                        onClick={() => handleQuantityChange(quantity - 1)}
                        className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        type="number"
                        value={quantity}
                        onChange={(e) => handleQuantityChange(parseInt(e.target.value) || 25)}
                        className="flex-1 text-center py-3 px-4 border border-gray-300 rounded-lg font-semibold text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        min="25"
                      />
                      <button 
                        onClick={() => handleQuantityChange(quantity + 1)}
                        className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Minimum order: 25 units</p>
                  </div>

                  {/* Price Display */}
                  <div className="text-center p-6 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl">
                    <div className="mb-2">
                      <span className="text-sm text-gray-600">Price per unit</span>
                    </div>
                    <div className={`text-3xl font-bold text-blue-600 transition-all duration-300 ${animatePrice ? 'scale-110' : 'scale-100'}`}>
                      £{currentTier.price}
                    </div>
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Total:</span>
                        <span className="text-2xl font-bold text-gray-900">£{totalPrice}</span>
                      </div>
                    </div>
                  </div>

                  {/* Pricing Tiers */}
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-3">Volume Discounts</h4>
                    <div className="space-y-2">
                      {pricingTiers.map((tier, index) => (
                        <div 
                          key={index}
                          className={`flex justify-between items-center p-3 rounded-lg transition-all duration-300 ${
                            quantity >= tier.min && (tier.max === null || quantity <= tier.max)
                              ? 'bg-blue-100 border-2 border-blue-300 shadow-md' 
                              : 'bg-gray-50 border border-gray-200'
                          }`}
                        >
                          <span className="text-sm font-medium">
                            {tier.min}+ units
                          </span>
                          <span className="font-bold text-blue-600">
                            £{tier.price}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="space-y-3">
                    <button className="w-full bg-gradient-to-r from-blue-600 via-purple-600 to-blue-700 text-white py-4 rounded-xl font-semibold hover:from-blue-700 hover:via-purple-700 hover:to-blue-800 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 flex items-center justify-center space-x-2">
                      <ShoppingCart className="h-5 w-5" />
                      <span>Add to Quote</span>
                    </button>
                    
                    <button className="w-full border-2 border-gray-300 text-gray-700 py-4 rounded-xl font-semibold hover:border-gray-400 hover:bg-gray-50 transition-all duration-300">
                      Request Sample
                    </button>
                  </div>

                  {/* Trust Badges */}
                  <div className="pt-4 border-t border-gray-200">
                    <div className="grid grid-cols-2 gap-4 text-center">
                      <div>
                        <div className="text-2xl mb-1">🚚</div>
                        <div className="text-xs text-gray-600 font-medium">Free Delivery</div>
                      </div>
                      <div>
                        <div className="text-2xl mb-1">⭐</div>
                        <div className="text-xs text-gray-600 font-medium">5-Star Rated</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact Card */}
              <div className="mt-6 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl p-6 text-white">
                <h4 className="font-bold text-lg mb-2">Need Help?</h4>
                <p className="text-gray-300 text-sm mb-4">Speak to our promotional experts</p>
                <button className="w-full bg-white text-gray-900 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-colors">
                  📞 Call Now: 01844 600900
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Pens;