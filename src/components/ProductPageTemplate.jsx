import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Heart, Share2, ShoppingCart, Check, Zap, Shield, Truck, ChevronLeft, ChevronRight, Plus, Minus } from 'lucide-react';
import { useCart } from '../context/CartContext';

const ProductPageTemplate = ({ productData }) => {
  const navigate = useNavigate();
  const { addToCart, openCart } = useCart();
  const [selectedColor, setSelectedColor] = useState(productData.colors[0]?.id || '');
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(productData.minQuantity || 25);
  const [isLiked, setIsLiked] = useState(false);
  const [animatePrice, setAnimatePrice] = useState(false);

  // Get current pricing tier
  const getCurrentTier = () => {
    return productData.pricingTiers.find(tier =>
      quantity >= tier.min && (tier.max === null || quantity <= tier.max)
    ) || productData.pricingTiers[0];
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
    // Handle empty input
    if (value === '' || isNaN(value)) {
      setQuantity('');
      return;
    }
    const numValue = parseInt(value, 10);
    // Don't enforce min/max while typing, only on blur
    setQuantity(numValue);
  };

  const handleQuantityBlur = () => {
    const minQty = productData.minQuantity || 25;
    // Enforce min/max when user leaves the field
    if (quantity === '' || quantity < minQty) {
      setQuantity(minQty);
    } else if (quantity > 10000) {
      setQuantity(10000);
    }
  };

  const handleCustomizeNow = () => {
    navigate(`/designer?product=${productData.productKey}`);
  };

  const handleAddToQuote = () => {
    const selectedColorData = productData.colors.find(c => c.id === selectedColor);
    const cartItem = {
      id: `${productData.productKey}-${selectedColor}-${Date.now()}`,
      product_template_id: productData.productKey,
      product_name: productData.name,
      product_key: productData.productKey,
      color: selectedColorData?.name || selectedColor,
      colorHex: selectedColorData?.hex,
      quantity: quantity,
      price: currentTier.price,
      specifications: productData.specifications,
      image: selectedColorData?.image || '📦'
    };

    addToCart(cartItem);
    openCart();

    // Show success feedback
    alert(`Added ${quantity}x ${productData.name} (${cartItem.color}) to your quote!`);
  };

  const images = Array(4).fill(null).map((_, i) => ({
    id: i,
    url: `Product image ${i + 1}`,
    alt: `${productData.name} - View ${i + 1}`
  }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/cables')}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <h1 className="text-xl font-bold text-gray-900">Back to Cables</h1>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setIsLiked(!isLiked)}
                className={`p-2 rounded-full transition-all ${isLiked ? 'bg-red-50 text-red-500' : 'hover:bg-gray-100'}`}
              >
                <Heart className={`h-5 w-5 ${isLiked ? 'fill-current' : ''}`} />
              </button>
              <button className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                <Share2 className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid lg:grid-cols-2 gap-12">
          {/* Left Column - Images */}
          <div className="space-y-6">
            {/* Main Image */}
            <div className="relative bg-white rounded-3xl shadow-xl overflow-hidden group">
              <div className="aspect-square flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 p-12">
                <div className="text-8xl">{productData.colors.find(c => c.id === selectedColor)?.image || '📦'}</div>
              </div>

              {productData.badge && (
                <div className="absolute top-6 left-6 bg-blue-600 text-white px-4 py-2 rounded-full text-sm font-semibold shadow-lg">
                  {productData.badge}
                </div>
              )}

              <button className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/90 p-3 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/90 p-3 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {/* Thumbnail Gallery */}
            <div className="grid grid-cols-4 gap-4">
              {images.map((img, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedImage(idx)}
                  className={`relative aspect-square rounded-xl overflow-hidden transition-all ${
                    selectedImage === idx
                      ? 'ring-4 ring-blue-500 scale-105'
                      : 'hover:scale-105 opacity-70 hover:opacity-100'
                  }`}
                >
                  <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-4xl">
                    📦
                  </div>
                </button>
              ))}
            </div>

            {/* Key Features - Moved below thumbnails */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-100">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Key Features</h3>
              <div className="grid grid-cols-1 gap-3">
                {productData.features.map((feature, idx) => (
                  <div key={idx} className="flex items-start space-x-2">
                    <Check className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-gray-700">{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column - Product Details */}
          <div className="space-y-8">
            {/* Title & Rating */}
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">{productData.name}</h1>
              <p className="text-lg text-gray-600 mb-4">{productData.subtitle}</p>

              <div className="flex items-center space-x-4">
                <div className="flex items-center">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className={`h-5 w-5 ${
                        i < Math.floor(productData.rating)
                          ? 'text-yellow-400 fill-yellow-400'
                          : 'text-gray-300'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-sm text-gray-600">
                  {productData.rating} ({productData.reviews} reviews)
                </span>
              </div>
            </div>

            {/* Color Selector */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                Color: <span className="font-normal text-gray-600">
                  {productData.colors.find(c => c.id === selectedColor)?.name}
                </span>
              </h3>
              <div className="flex flex-wrap gap-3">
                {productData.colors.map((color) => (
                  <button
                    key={color.id}
                    onClick={() => setSelectedColor(color.id)}
                    className={`group relative w-12 h-12 rounded-full transition-all ${
                      selectedColor === color.id
                        ? 'ring-4 ring-blue-500 ring-offset-2 scale-110'
                        : 'hover:scale-110'
                    }`}
                    title={color.name}
                  >
                    <div
                      className="w-full h-full rounded-full border-2 border-gray-200"
                      style={{ backgroundColor: color.hex }}
                    />
                    {selectedColor === color.id && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Check className="h-5 w-5 text-white drop-shadow-lg" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Specifications - Moved up from tabs */}
            <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl p-6 border border-purple-100">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Specifications</h3>
              <div className="space-y-3">
                {Object.entries(productData.specifications).map(([key, value]) => (
                  <div key={key} className="flex justify-between items-start py-2 border-b border-purple-100 last:border-0">
                    <span className="font-semibold text-gray-700 text-sm capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                    <span className="text-gray-900 text-sm text-right ml-4">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Quantity Selector */}
            <div>
              <label className="text-sm font-semibold text-gray-900 mb-3 block">
                Quantity (Min: {productData.minQuantity})
              </label>
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => handleQuantityChange(quantity - 1)}
                  className="p-3 bg-white border-2 border-gray-200 rounded-xl hover:border-blue-500 hover:text-blue-600 transition-all"
                >
                  <Minus className="h-5 w-5" />
                </button>
                <input
                  type="number"
                  min={productData.minQuantity || 25}
                  max={10000}
                  value={quantity}
                  onChange={(e) => handleQuantityChange(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onBlur={handleQuantityBlur}
                  className="w-24 px-4 py-3 text-center text-lg font-semibold border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={() => handleQuantityChange(quantity + 1)}
                  className="p-3 bg-white border-2 border-gray-200 rounded-xl hover:border-blue-500 hover:text-blue-600 transition-all"
                >
                  <Plus className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Price Display */}
            <div className={`bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-6 border border-green-200 ${animatePrice ? 'scale-105' : ''} transition-transform`}>
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-sm text-gray-600">Unit Price:</span>
                <span className="text-2xl font-bold text-green-600">£{currentTier.price.toFixed(2)}</span>
              </div>
              <div className="flex items-baseline justify-between pt-2 border-t border-green-200">
                <span className="text-sm font-semibold text-gray-900">Total:</span>
                <span className="text-3xl font-bold text-green-700">£{totalPrice}</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col space-y-3">
              <button
                onClick={handleCustomizeNow}
                className="w-full bg-blue-600 text-white py-4 rounded-xl font-semibold text-lg hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2 shadow-lg hover:shadow-xl"
              >
                <span>Customize Now</span>
                <ChevronRight className="h-5 w-5" />
              </button>
              <button
                onClick={handleAddToQuote}
                className="w-full bg-white text-gray-900 py-4 rounded-xl font-semibold text-lg border-2 border-gray-200 hover:border-blue-500 hover:text-blue-600 transition-all flex items-center justify-center space-x-2"
              >
                <ShoppingCart className="h-5 w-5" />
                <span>Add to Quote</span>
              </button>
            </div>

            {/* Trust Badges */}
            <div className="grid grid-cols-3 gap-4 pt-6 border-t border-gray-200">
              <div className="text-center">
                <Zap className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                <p className="text-xs font-medium text-gray-600">Fast Delivery</p>
              </div>
              <div className="text-center">
                <Shield className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                <p className="text-xs font-medium text-gray-600">Quality Guarantee</p>
              </div>
              <div className="text-center">
                <Truck className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                <p className="text-xs font-medium text-gray-600">Free Shipping</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductPageTemplate;
