import React, { useState, useEffect } from 'react';
import { Search, ShoppingCart, User, Phone, Mail, ChevronLeft, ChevronRight, Star, Loader } from 'lucide-react';
import { Link } from "react-router-dom";
import { getSupabaseClient } from '../services/productCatalogService';

const PromoGiftsApp = () => {
  const [bestSellersSlide, setBestSellersSlide] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSliderPaused, setIsSliderPaused] = useState(false);
  const [heroSlide, setHeroSlide] = useState(0);
  const [productsPerSlide, setProductsPerSlide] = useState(4);

  // State for fetched products from database
  const [featuredProducts, setFeaturedProducts] = useState([]);
  const [hotProducts, setHotProducts] = useState([]);
  const [loadingFeatured, setLoadingFeatured] = useState(true);
  const [loadingHot, setLoadingHot] = useState(true);

  // Hero slider content
  const heroSliderContent = [
    {
      id: 1,
      title: "BRANDED WATER BOTTLES",
      subtitle: "from just 85p",
      buttonText: "ORDER NOW",
      bgColor: "bg-blue-500",
      textColor: "text-white",
      imageUrl: "https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/hero-banners/left-slider-1.png",
      link: "/water-bottles/water-bottle"
    },
    {
      id: 2,
      title: "BRANDED CUPS",
      subtitle: "from just £1.20",
      buttonText: "ORDER NOW",
      bgColor: "bg-green-600",
      textColor: "text-white",
      imageUrl: "https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/hero-banners/left-slider-2.png",
      link: "/cups/chi-cup"
    }
  ];

  // Static right hero block
  const rightHeroBlock = {
    id: 3,
    title: "GRS RECYCLED TOTE BAGS",
    subtitle: "FROM JUST 58p A UNIT, WITH YOUR LOGO",
    description: "We've secured the UK's lowest prices for our best-selling promotional totes. Bag a bargain for your business today!",
    buttonText: "View Product",
    bgColor: "bg-gray-100",
    textColor: "text-gray-900",
    imageUrl: "https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/hero-banners/right-bags.png",
    link: "/bags"
  };

  const smallBlocks = [
    {
      id: 3,
      title: "CAMPAIGN TIMELINE BUILDER",
      bgColor: "bg-green-600",
      textColor: "text-white",
      image: "⏰"
    },
    {
      id: 4,
      title: "LIVE LOGO PLACEMENT",
      bgColor: "bg-purple-600",
      textColor: "text-white",
      image: "🎨"
    },
    {
      id: 5,
      title: "PRODUCT PROPOSAL GENERATOR",
      bgColor: "bg-blue-600",
      textColor: "text-white",
      image: "📊"
    },
    {
      id: 6,
      title: "ROI CALCULATOR",
      badge: "NEW",
      bgColor: "bg-orange-600",
      textColor: "text-white",
      image: "💰"
    }
  ];

  // Product categories
  const categories = [
    { name: 'Cups', icon: '☕' },
    { name: 'Water Bottles', icon: '🍼' },
    { name: 'Bags', icon: '👜' },
    { name: 'Clothing', icon: '👕' },
    { name: 'Hi Vis', icon: '🦺' },
    { name: 'Cables', icon: '🔌' },
    { name: 'Power', icon: '🔋' },
    { name: 'Speakers', icon: '🔊' },
    { name: 'Pens & Writing', icon: '✒️' },
    { name: 'Notebooks', icon: '📓' },
    { name: 'Tea Towels', icon: '🍽️' }
  ];

  // Use fetched products from database (must be declared before useEffects that reference them)
  const displayBestSellers = featuredProducts;
  const displayHotProducts = hotProducts;

  // Update products per slide based on screen width
  useEffect(() => {
    const updateProductsPerSlide = () => {
      const width = window.innerWidth;
      if (width < 640) {
        setProductsPerSlide(1); // Mobile: 1 product per slide
      } else if (width < 1024) {
        setProductsPerSlide(2); // Tablet: 2 products per slide
      } else {
        setProductsPerSlide(4); // Desktop: 4 products per slide
      }
    };

    updateProductsPerSlide();
    window.addEventListener('resize', updateProductsPerSlide);
    return () => window.removeEventListener('resize', updateProductsPerSlide);
  }, []);

  // Auto-slider for best sellers
  useEffect(() => {
    if (isSliderPaused || displayBestSellers.length === 0) return;

    const timer = setInterval(() => {
      setBestSellersSlide((prev) => (prev + 1) % Math.ceil(displayBestSellers.length / productsPerSlide));
    }, 4000);
    return () => clearInterval(timer);
  }, [displayBestSellers.length, isSliderPaused, productsPerSlide]);

  // Auto-slider for hero section
  useEffect(() => {
    const timer = setInterval(() => {
      setHeroSlide((prev) => (prev + 1) % heroSliderContent.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [heroSliderContent.length]);

  const nextBestSellers = () => {
    setBestSellersSlide((prev) => (prev + 1) % Math.ceil(displayBestSellers.length / productsPerSlide));
  };

  const prevBestSellers = () => {
    setBestSellersSlide((prev) => (prev - 1 + Math.ceil(displayBestSellers.length / productsPerSlide)) % Math.ceil(displayBestSellers.length / productsPerSlide));
  };

  // Fetch featured products for Best Sellers carousel
  useEffect(() => {
    const fetchFeaturedProducts = async () => {
      try {
        setLoadingFeatured(true);
        const supabase = getSupabaseClient();

        const { data, error } = await supabase
          .from('catalog_products')
          .select(`
            *,
            catalog_categories!inner(name, slug),
            catalog_product_images(image_url, thumbnail_url, is_primary, image_type),
            catalog_pricing_tiers(min_quantity, price_per_unit)
          `)
          .eq('is_featured', true)
          .eq('status', 'active')
          .limit(8);

        if (error) throw error;

        // Process products to extract primary image and lowest price
        const processedProducts = data.map(product => {
          const primaryImage = product.catalog_product_images.find(img => img.is_primary)
            || product.catalog_product_images.find(img => img.image_type === 'main')
            || product.catalog_product_images[0];

          const lowestPriceTier = product.catalog_pricing_tiers
            .sort((a, b) => a.price_per_unit - b.price_per_unit)[0];

          return {
            ...product,
            primaryImage: primaryImage?.thumbnail_url || primaryImage?.image_url,
            lowestPrice: lowestPriceTier?.price_per_unit
          };
        });

        console.log('[Home] Fetched featured products:', processedProducts.length);
        setFeaturedProducts(processedProducts);
      } catch (error) {
        console.error('[Home] Error fetching featured products:', error);
      } finally {
        setLoadingFeatured(false);
      }
    };

    fetchFeaturedProducts();
  }, []);

  // Fetch best seller products for HOT PRODUCTS section
  useEffect(() => {
    const fetchHotProducts = async () => {
      try {
        setLoadingHot(true);
        const supabase = getSupabaseClient();

        const { data, error } = await supabase
          .from('catalog_products')
          .select(`
            *,
            catalog_categories!inner(name, slug),
            catalog_product_images(image_url, thumbnail_url, is_primary, image_type),
            catalog_pricing_tiers(min_quantity, price_per_unit)
          `)
          .eq('badge', 'Best Seller')
          .eq('status', 'active')
          .limit(8);

        if (error) throw error;

        // Process products
        const processedProducts = data.map(product => {
          const primaryImage = product.catalog_product_images.find(img => img.is_primary)
            || product.catalog_product_images.find(img => img.image_type === 'main')
            || product.catalog_product_images[0];

          const lowestPriceTier = product.catalog_pricing_tiers
            .sort((a, b) => a.price_per_unit - b.price_per_unit)[0];

          return {
            ...product,
            primaryImage: primaryImage?.thumbnail_url || primaryImage?.image_url,
            lowestPrice: lowestPriceTier?.price_per_unit,
            minQuantity: product.min_order_quantity
          };
        });

        console.log('[Home] Fetched hot products:', processedProducts.length);
        setHotProducts(processedProducts);
      } catch (error) {
        console.error('[Home] Error fetching hot products:', error);
      } finally {
        setLoadingHot(false);
      }
    };

    fetchHotProducts();
  }, []);

  return (
    <div className="min-h-screen bg-white">
      
      {/* Hero Image Blocks */}
      <section className="max-w-7xl mx-auto px-4 py-6">
        {/* Top row - Slider left, Static right - Stack on mobile */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 md:h-64">
          {/* Left - Hero Slider */}
          <div className="relative overflow-hidden rounded-lg h-64">
            {heroSliderContent.map((block, index) => (
              <div
                key={block.id}
                className={`absolute inset-0 transition-opacity duration-1000 ${
                  index === heroSlide ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {/* Background Image */}
                <img
                  src={block.imageUrl}
                  alt={block.title}
                  className="absolute inset-0 w-full h-full object-cover object-center"
                />

                {/* Dark overlay for text readability */}
                <div className="absolute inset-0 bg-black/5"></div>

                {/* Content */}
                <div className={`absolute inset-0 ${block.textColor} p-4 sm:p-8 flex items-center justify-between`}>
                  <div className="z-10">
                    <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-2 drop-shadow-lg">{block.title}</h2>
                    <p className="text-base sm:text-xl text-yellow-300 font-bold mb-4 drop-shadow-lg">{block.subtitle}</p>
                    <Link to={block.link} className="inline-block bg-white text-gray-900 px-4 py-2 sm:px-6 sm:py-3 rounded font-semibold hover:bg-gray-100 transition-colors text-sm sm:text-base shadow-lg">
                      {block.buttonText}
                    </Link>
                  </div>
                </div>
              </div>
            ))}
            
            {/* Slide indicators */}
            <div className="absolute bottom-4 left-8 flex space-x-2 z-20">
              {heroSliderContent.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setHeroSlide(index)}
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    index === heroSlide ? 'bg-white w-6' : 'bg-white/50'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Right - Static Bags Block */}
          <div className="rounded-lg relative overflow-hidden h-64">
            {/* Background Image */}
            <img
              src={rightHeroBlock.imageUrl}
              alt={rightHeroBlock.title}
              className="absolute inset-0 w-full h-full object-cover object-center"
            />

            {/* Dark overlay for text readability */}
            <div className="absolute inset-0 bg-black/5"></div>

            {/* Content */}
            <div className="absolute inset-0 p-4 sm:p-8 flex items-center justify-between">
              <div className="z-10">
                <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-2 drop-shadow-lg text-white">{rightHeroBlock.title}</h2>
                <p className="text-base sm:text-xl text-red-500 font-bold mb-4 drop-shadow-lg">{rightHeroBlock.subtitle}</p>
                <p className="text-xs sm:text-sm mb-6 max-w-md drop-shadow-lg text-white/90">{rightHeroBlock.description}</p>
                <Link to={rightHeroBlock.link} className="inline-block bg-gray-800 text-white px-4 py-2 sm:px-6 sm:py-3 rounded font-semibold hover:bg-gray-700 transition-colors text-sm sm:text-base shadow-lg">
                  {rightHeroBlock.buttonText}
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom row - 4 tool blocks - 2x2 on mobile, 4x1 on desktop */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 h-auto md:h-32">
          {smallBlocks.map((block) => (
            <div
              key={block.id}
              className={`${block.bgColor} ${block.textColor} rounded-lg p-3 sm:p-4 min-h-[120px] md:min-h-0 flex flex-col items-center justify-center text-center relative overflow-hidden hover:scale-105 transition-transform cursor-pointer group`}
              onClick={() => {
                document.querySelector('[data-tools-section]')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              {block.badge && (
                <div className="absolute top-2 right-2 bg-white text-orange-600 px-2 py-1 rounded-full text-xs font-bold transform rotate-12">
                  {block.badge}
                </div>
              )}
              <div className="text-2xl sm:text-3xl mb-2 opacity-20 group-hover:opacity-100 group-hover:scale-110 transition-all duration-300">{block.image}</div>
              <h4 className="font-bold text-[10px] sm:text-xs leading-tight group-hover:font-extrabold transition-all duration-300">{block.title}</h4>

              <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            </div>
          ))}
        </div>
      </section>

      {/* Best Sellers Slider */}
      <section className="py-10 relative overflow-hidden bg-gray-50">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-100/50 via-blue-50/30 to-purple-50/50"></div>
        
        <div className="max-w-7xl mx-auto px-4 relative z-10">
          <div className="text-center mb-6">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Best Selling Products</h2>
            <p className="text-gray-600">Premium promotional items for your brand</p>
          </div>

          <div className="relative">
            <button
              onClick={prevBestSellers}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-20 bg-white/80 shadow-lg border border-gray-300/50 text-gray-600 p-3 rounded-full hover:bg-white hover:text-gray-900 transition-all duration-500 hover:scale-110"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={nextBestSellers}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-20 bg-white/80 shadow-lg border border-gray-300/50 text-gray-600 p-3 rounded-full hover:bg-white hover:text-gray-900 transition-all duration-500 hover:scale-110"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            <div className="relative h-52 overflow-hidden mx-12">
              {loadingFeatured ? (
                <div className="flex items-center justify-center h-full">
                  <Loader className="h-12 w-12 text-blue-600 animate-spin" />
                </div>
              ) : (
                <div
                  className="flex transition-all duration-1000 ease-out absolute inset-0"
                  style={{
                    transform: `translateX(-${bestSellersSlide * 100}%)`
                  }}
                >
                  {Array.from({ length: Math.ceil(displayBestSellers.length / productsPerSlide) }).map((_, slideIndex) => (
                    <div key={slideIndex} className="w-full flex-shrink-0 px-2 sm:px-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
                        {displayBestSellers.slice(slideIndex * productsPerSlide, slideIndex * productsPerSlide + productsPerSlide).map((product, index) => (
                          <Link
                            key={product.id || index}
                            to={`/${product.catalog_categories?.slug || 'products'}/${product.slug}`}
                            className="group relative transition-all duration-700 cursor-pointer"
                            onMouseEnter={() => setIsSliderPaused(true)}
                            onMouseLeave={() => setIsSliderPaused(false)}
                          >
                            <div className="bg-white/90 border border-gray-200/50 rounded-2xl p-4 shadow-lg hover:shadow-2xl transition-all duration-700 group-hover:scale-110 group-hover:-translate-y-6 overflow-hidden relative">

                              <div className="absolute inset-0 bg-gradient-to-br from-blue-400/10 via-purple-400/10 to-pink-400/10 opacity-0 group-hover:opacity-100 transition-all duration-700"></div>

                              <div className="relative z-10">
                                <div className="text-center mb-3">
                                  {product.primaryImage ? (
                                    <img
                                      src={product.primaryImage}
                                      alt={product.name}
                                      className="w-20 h-20 mx-auto mb-2 object-contain transform transition-all duration-700 ease-out group-hover:scale-150 group-hover:rotate-12"
                                    />
                                  ) : (
                                    <div className="text-3xl mb-2 transform transition-all duration-700 ease-out group-hover:scale-150 group-hover:rotate-12">
                                      {product.image || '📦'}
                                    </div>
                                  )}
                                  <span className="inline-block text-xs text-gray-500 bg-white/80 px-3 py-1 rounded-full border border-gray-200/50 group-hover:bg-gradient-to-r group-hover:from-blue-100 group-hover:to-purple-100 group-hover:text-blue-700 transition-all duration-500">
                                    {product.catalog_categories?.name || product.category}
                                  </span>
                                </div>

                                <div className="text-center">
                                  <h3 className="font-semibold text-xs text-gray-900 mb-2 leading-tight group-hover:text-blue-600 transition-all duration-500">
                                    {product.name}
                                  </h3>
                                  <p className="text-blue-600 font-bold text-sm mb-3 group-hover:text-purple-600 transition-all duration-500">
                                    {product.lowestPrice ? `From £${product.lowestPrice}` : product.price}
                                  </p>

                                  <button className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-2 rounded-xl text-xs font-medium transition-all duration-700 transform group-hover:scale-110 shadow-lg relative overflow-hidden">
                                    <span className="relative z-10">Customize Now</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {!loadingFeatured && displayBestSellers.length > 0 && (
            <div className="flex justify-center mt-6 space-x-3">
              {Array.from({ length: Math.ceil(displayBestSellers.length / productsPerSlide) }).map((_, index) => (
                <button
                  key={index}
                  onClick={() => setBestSellersSlide(index)}
                  className={`transition-all duration-500 rounded-full ${
                    index === bestSellersSlide
                      ? 'w-10 h-3 bg-gradient-to-r from-blue-500 to-purple-500 shadow-lg'
                      : 'w-3 h-3 bg-gray-400/60 hover:bg-gray-500/80 shadow-md'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Hot Products Section - Equal Height Cards */}
      <section className="py-6 sm:py-8 lg:py-12 bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/20">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-600 text-center mb-8 sm:mb-10 lg:mb-12 tracking-wider">
            HOT PRODUCTS
          </h2>

          {loadingHot ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="h-12 w-12 text-blue-600 animate-spin" />
            </div>
          ) : displayHotProducts.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>No hot products available at the moment. Check back soon!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
              {displayHotProducts.map((product, index) => (
                <Link
                  key={product.id || index}
                  to={`/${product.catalog_categories?.slug || 'products'}/${product.slug}`}
                  className="group cursor-pointer transform transition-all duration-700 hover:scale-105 h-full"
                >
                  <div className="bg-white/95 rounded-2xl shadow-lg hover:shadow-2xl border border-gray-200/50 p-3 sm:p-4 lg:p-6 relative overflow-hidden transition-all duration-700 group-hover:shadow-blue-500/20 group-hover:-translate-y-6 h-full flex flex-col">

                    {product.badge && (
                      <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-20 transform transition-all duration-500 group-hover:scale-125">
                        <Star className="h-5 w-5 sm:h-6 sm:w-6 text-red-500 fill-current drop-shadow-lg" />
                      </div>
                    )}

                    <div className="text-center mb-3 sm:mb-4">
                      {product.primaryImage ? (
                        <img
                          src={product.primaryImage}
                          alt={product.name}
                          className="w-24 h-24 sm:w-28 sm:h-28 lg:w-32 lg:h-32 mx-auto mb-2 sm:mb-3 object-contain transform transition-all duration-700 group-hover:scale-125 group-hover:rotate-12"
                        />
                      ) : (
                        <div className="text-4xl sm:text-5xl lg:text-6xl mb-2 sm:mb-3 transform transition-all duration-700 group-hover:scale-125 group-hover:rotate-12">
                          {product.image || '📦'}
                        </div>
                      )}
                    </div>

                    <div className="text-center flex-grow flex flex-col justify-between">
                      <div>
                        <h3 className="font-bold text-gray-900 text-sm mb-2 uppercase tracking-wide transition-all duration-500 group-hover:text-blue-600 min-h-[2.5rem] flex items-center justify-center">
                          {product.name}
                        </h3>
                        <p className="text-xs text-gray-600 mb-4 leading-relaxed transition-all duration-500 group-hover:text-gray-800 min-h-[3rem] flex items-center">
                          {product.subtitle || product.description}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-gray-900 transition-all duration-500 group-hover:text-blue-600">
                        {product.lowestPrice ? `FROM £${product.lowestPrice} ON 250+ (MQ ${product.minQuantity || 25})` : product.price}
                      </p>
                    </div>

                    <div className="absolute bottom-3 left-3">
                      <span className="text-xs text-gray-400 bg-white/80 px-3 py-1 rounded-full border border-gray-200/50 shadow-md">
                        {product.catalog_categories?.name || product.category}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Helpful Tools Section - 3D Enhanced */}
      <section className="py-8 sm:py-12 lg:py-16 bg-gradient-to-br from-blue-50 via-purple-50/50 to-pink-50/30 relative overflow-hidden" data-tools-section>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-blue-300/20 via-purple-300/20 to-pink-300/20 rounded-full blur-3xl"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-br from-purple-300/20 via-pink-300/20 to-orange-300/20 rounded-full blur-3xl"></div>
        </div>

        <div className="max-w-7xl mx-auto px-4 relative z-10">
          <div className="text-center mb-8 sm:mb-10 lg:mb-12">
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-3 sm:mb-4 drop-shadow-lg">Helpful Tools</h2>
            <p className="text-base sm:text-lg lg:text-xl text-gray-600 drop-shadow-sm">Free resources to make your promotional campaigns successful</p>
          </div>

          {/* Top Row - Main Tools */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8 mb-8 lg:mb-12">
            {/* Tool 1: Product Proposal Generator */}
            <div className="group bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl hover:shadow-blue-500/25 transition-all duration-700 p-4 sm:p-6 lg:p-8 transform hover:scale-105 hover:-translate-y-8 relative overflow-hidden border border-white/50">
              <div className="absolute -inset-2 bg-gradient-to-br from-blue-500/20 via-purple-500/20 to-pink-500/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700"></div>

              <div className="text-center mb-4 sm:mb-6 relative z-10">
                <div className="bg-gradient-to-br from-blue-500 via-purple-600 to-blue-700 w-16 h-16 sm:w-20 sm:h-20 rounded-3xl flex items-center justify-center mx-auto mb-4 sm:mb-6 shadow-2xl transform transition-all duration-700 group-hover:scale-125 group-hover:rotate-12">
                  <span className="text-3xl sm:text-4xl text-white drop-shadow-lg">📊</span>
                </div>
                <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 mb-2 sm:mb-3 drop-shadow-md">Product Proposal Generator</h3>
                <p className="text-sm sm:text-base text-gray-600 drop-shadow-sm">Create professional slideshow presentations with your chosen products for client meetings</p>
              </div>
              
              <div className="space-y-4 mb-8 relative z-10">
                <div className="flex justify-between items-center p-4 bg-gradient-to-r from-gray-50/80 to-blue-50/60 backdrop-blur-sm rounded-xl shadow-md border border-white/50 transform transition-all duration-500 group-hover:scale-105">
                  <span className="text-sm font-medium text-gray-700">🎯 Client Presentations</span>
                  <span className="text-blue-600 font-bold bg-blue-100/80 px-3 py-1 rounded-full text-xs shadow-sm">FREE</span>
                </div>
                <div className="flex justify-between items-center p-4 bg-gradient-to-r from-gray-50/80 to-purple-50/60 backdrop-blur-sm rounded-xl shadow-md border border-white/50 transform transition-all duration-500 group-hover:scale-105">
                  <span className="text-sm font-medium text-gray-700">📱 Professional Slides</span>
                  <span className="text-blue-600 font-bold bg-blue-100/80 px-3 py-1 rounded-full text-xs shadow-sm">FREE</span>
                </div>
                <div className="flex justify-between items-center p-4 bg-gradient-to-r from-gray-50/80 to-orange-50/60 backdrop-blur-sm rounded-xl shadow-md border border-white/50 transform transition-all duration-500 group-hover:scale-105">
                  <span className="text-sm font-medium text-gray-700">💧 Remove Watermarks</span>
                  <span className="text-orange-600 font-bold bg-orange-100/80 px-3 py-1 rounded-full text-xs shadow-sm">SIGNUP</span>
                </div>
              </div>
              
              <button className="w-full bg-gradient-to-r from-blue-600 via-purple-600 to-blue-700 text-white py-4 rounded-2xl font-semibold hover:from-blue-700 hover:via-purple-700 hover:to-blue-800 transition-all duration-500 shadow-2xl hover:shadow-blue-500/50 transform hover:scale-105 relative overflow-hidden">
                <span className="relative z-10">Create Proposal</span>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent transform -skew-x-12 -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
              </button>

              <div className="absolute -top-4 -right-4 bg-gradient-to-r from-yellow-400 via-orange-500 to-red-500 text-white text-sm px-6 py-3 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-700 transform scale-75 group-hover:scale-125 shadow-2xl z-20">
                <span className="font-bold">✨ Most Popular</span>
              </div>
            </div>

            {/* Tool 2: Campaign Timeline Builder */}
            <div className="group bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl hover:shadow-emerald-500/25 transition-all duration-700 p-4 sm:p-6 lg:p-8 transform hover:scale-105 hover:-translate-y-8 relative overflow-hidden border border-white/50">
              <div className="absolute -inset-2 bg-gradient-to-br from-green-500/20 via-emerald-500/20 to-teal-500/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700"></div>

              <div className="text-center mb-4 sm:mb-6 relative z-10">
                <div className="bg-gradient-to-br from-green-500 via-emerald-600 to-green-700 w-16 h-16 sm:w-20 sm:h-20 rounded-3xl flex items-center justify-center mx-auto mb-4 sm:mb-6 shadow-2xl transform transition-all duration-700 group-hover:scale-125 group-hover:rotate-12">
                  <span className="text-3xl sm:text-4xl text-white drop-shadow-lg">⏰</span>
                </div>
                <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 mb-2 sm:mb-3 drop-shadow-md">Campaign Timeline Builder</h3>
                <p className="text-sm sm:text-base text-gray-600 drop-shadow-sm">Never miss a deadline again! Auto-generates timelines with calendar integration and approval reminders</p>
              </div>
              
              <div className="space-y-4 mb-8 relative z-10">
                <div className="flex justify-between items-center p-4 bg-gradient-to-r from-gray-50/80 to-green-50/60 backdrop-blur-sm rounded-xl shadow-md border border-white/50 transform transition-all duration-500 group-hover:scale-105">
                  <span className="text-sm font-medium text-gray-700">📅 Calendar Sync</span>
                  <span className="text-green-600 font-bold bg-green-100/80 px-3 py-1 rounded-full text-xs shadow-sm">FREE</span>
                </div>
                <div className="flex justify-between items-center p-4 bg-gradient-to-r from-gray-50/80 to-emerald-50/60 backdrop-blur-sm rounded-xl shadow-md border border-white/50 transform transition-all duration-500 group-hover:scale-105">
                  <span className="text-sm font-medium text-gray-700">🚨 Auto Reminders</span>
                  <span className="text-green-600 font-bold bg-green-100/80 px-3 py-1 rounded-full text-xs shadow-sm">FREE</span>
                </div>
                <div className="flex justify-between items-center p-4 bg-gradient-to-r from-gray-50/80 to-teal-50/60 backdrop-blur-sm rounded-xl shadow-md border border-white/50 transform transition-all duration-500 group-hover:scale-105">
                  <span className="text-sm font-medium text-gray-700">💰 Cost Impact Alerts</span>
                  <span className="text-green-600 font-bold bg-green-100/80 px-3 py-1 rounded-full text-xs shadow-sm">FREE</span>
                </div>
              </div>
              
              <button className="w-full bg-gradient-to-r from-green-600 via-emerald-600 to-green-700 text-white py-4 rounded-2xl font-semibold hover:from-green-700 hover:via-emerald-700 hover:to-green-800 transition-all duration-500 shadow-2xl hover:shadow-emerald-500/50 transform hover:scale-105 relative overflow-hidden">
                <span className="relative z-10">Build Timeline</span>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent transform -skew-x-12 -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
              </button>
            </div>
          </div>

          {/* Second Row - Additional Tools */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8 mb-8 lg:mb-12">
            {/* Tool 3: Live Logo Placement */}
            <div className="group bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl hover:shadow-purple-500/25 transition-all duration-700 p-4 sm:p-6 lg:p-8 transform hover:scale-105 hover:-translate-y-6 relative overflow-hidden border border-white/50">
              <div className="absolute -inset-2 bg-gradient-to-br from-purple-500/20 via-pink-500/20 to-purple-500/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700"></div>

              <div className="text-center mb-4 sm:mb-6 relative z-10">
                <div className="bg-gradient-to-br from-purple-500 to-pink-600 w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4 shadow-xl transform transition-all duration-500 group-hover:scale-125 group-hover:rotate-12">
                  <span className="text-2xl sm:text-3xl text-white drop-shadow-lg">🎨</span>
                </div>
                <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 mb-2">Live Logo Placement</h3>
                <p className="text-sm sm:text-base text-gray-600">See your logo on ANY product in real-time. AI-powered background removal and positioning</p>
              </div>
              
              <div className="space-y-4 mb-6">
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg shadow-sm border border-white/50 transform transition-all duration-300 group-hover:scale-105">
                  <span className="text-sm font-medium">⚡ Real-Time Preview</span>
                  <span className="text-purple-600 font-bold bg-purple-100/80 px-3 py-1 rounded-full text-xs">FREE</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg shadow-sm border border-white/50 transform transition-all duration-300 group-hover:scale-105">
                  <span className="text-sm font-medium">🤖 AI Background Removal</span>
                  <span className="text-purple-600 font-bold bg-purple-100/80 px-3 py-1 rounded-full text-xs">FREE</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg shadow-sm border border-white/50 transform transition-all duration-300 group-hover:scale-105">
                  <span className="text-sm font-medium">📄 Download PDF Proof</span>
                  <span className="text-orange-600 font-bold bg-orange-100/80 px-3 py-1 rounded-full text-xs">SIGNUP</span>
                </div>
              </div>
              
              <button className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-3 rounded-xl font-semibold hover:from-purple-700 hover:to-pink-700 transition-all duration-300 shadow-xl hover:shadow-purple-500/50 transform hover:scale-105">
                Try Logo Tool
              </button>
            </div>

            {/* Tool 4: ROI Calculator */}
            <div className="group bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl hover:shadow-orange-500/25 transition-all duration-700 p-4 sm:p-6 lg:p-8 transform hover:scale-105 hover:-translate-y-6 relative overflow-hidden border border-white/50">
              <div className="absolute -inset-2 bg-gradient-to-br from-orange-500/20 via-red-500/20 to-orange-500/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700"></div>

              <div className="text-center mb-4 sm:mb-6 relative z-10">
                <div className="bg-gradient-to-br from-orange-500 to-red-600 w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4 shadow-xl transform transition-all duration-500 group-hover:scale-125 group-hover:rotate-12">
                  <span className="text-2xl sm:text-3xl text-white drop-shadow-lg">💰</span>
                </div>
                <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 mb-2">ROI Calculator</h3>
                <p className="text-sm sm:text-base text-gray-600">Calculate return on investment and generate professional reports for stakeholders</p>
              </div>
              
              <div className="space-y-4 mb-6">
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg shadow-sm border border-white/50 transform transition-all duration-300 group-hover:scale-105">
                  <span className="text-sm font-medium">📈 ROI Analysis</span>
                  <span className="text-orange-600 font-bold bg-orange-100/80 px-3 py-1 rounded-full text-xs">FREE</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg shadow-sm border border-white/50 transform transition-all duration-300 group-hover:scale-105">
                  <span className="text-sm font-medium">📊 Professional Report</span>
                  <span className="text-orange-600 font-bold bg-orange-100/80 px-3 py-1 rounded-full text-xs">SIGNUP</span>
                </div>
              </div>
              
              <button className="w-full bg-gradient-to-r from-orange-600 to-red-600 text-white py-3 rounded-xl font-semibold hover:from-orange-700 hover:to-red-700 transition-all duration-300 shadow-xl hover:shadow-orange-500/50 transform hover:scale-105">
                Calculate ROI
              </button>
            </div>

            {/* Tool 5: Industry Benchmarks */}
            <div className="group bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl hover:shadow-indigo-500/25 transition-all duration-700 p-4 sm:p-6 lg:p-8 transform hover:scale-105 hover:-translate-y-6 relative overflow-hidden border border-white/50">
              <div className="absolute -inset-2 bg-gradient-to-br from-indigo-500/20 via-blue-500/20 to-indigo-500/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700"></div>

              <div className="text-center mb-4 sm:mb-6 relative z-10">
                <div className="bg-gradient-to-br from-indigo-500 to-blue-600 w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4 shadow-xl transform transition-all duration-500 group-hover:scale-125 group-hover:rotate-12">
                  <span className="text-2xl sm:text-3xl text-white drop-shadow-lg">📊</span>
                </div>
                <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 mb-2">Industry Benchmarks</h3>
                <p className="text-sm sm:text-base text-gray-600">Compare your promotional spend against industry standards and competitors</p>
              </div>
              
              <div className="space-y-4 mb-6">
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg shadow-sm border border-white/50 transform transition-all duration-300 group-hover:scale-105">
                  <span className="text-sm font-medium">🏭 Industry Data</span>
                  <span className="text-indigo-600 font-bold bg-indigo-100/80 px-3 py-1 rounded-full text-xs">FREE</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg shadow-sm border border-white/50 transform transition-all duration-300 group-hover:scale-105">
                  <span className="text-sm font-medium">📈 Competitive Analysis</span>
                  <span className="text-orange-600 font-bold bg-orange-100/80 px-3 py-1 rounded-full text-xs">SIGNUP</span>
                </div>
              </div>
              
              <button className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 text-white py-3 rounded-xl font-semibold hover:from-indigo-700 hover:to-blue-700 transition-all duration-300 shadow-xl hover:shadow-indigo-500/50 transform hover:scale-105">
                View Benchmarks
              </button>
            </div>
          </div>

          {/* Bottom CTA */}
          <div className="text-center">
            <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-3xl p-4 sm:p-6 lg:p-8 text-white shadow-2xl transform hover:scale-105 transition-all duration-500 relative overflow-hidden border border-gray-700/50">
              <div className="absolute inset-0 bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm"></div>
              <div className="relative z-10">
                <h3 className="text-lg sm:text-xl lg:text-2xl font-bold mb-3 sm:mb-4 drop-shadow-lg">Need More Help?</h3>
                <p className="text-sm sm:text-base text-gray-300 mb-4 sm:mb-6 drop-shadow-sm">Our promotional product experts are here to help you create the perfect campaign</p>
                <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4">
                  <button className="bg-white text-gray-900 px-4 py-2 sm:px-6 sm:py-3 rounded-lg font-semibold hover:bg-gray-100 transition-all duration-300 shadow-xl hover:shadow-white/25 transform hover:scale-105 text-sm sm:text-base">
                    📞 Call Expert
                  </button>
                  <button className="border border-white text-white px-4 py-2 sm:px-6 sm:py-3 rounded-lg font-semibold hover:bg-white hover:text-gray-900 transition-all duration-300 shadow-xl hover:shadow-white/25 transform hover:scale-105 text-sm sm:text-base">
                    💬 Live Chat
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Blog Section */}
      <section className="py-6 sm:py-8 lg:py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-8 sm:mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-700 mb-2">The Latest From Our Blog</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {/* Blog Post 1 */}
            <article className="bg-white rounded-lg overflow-hidden group cursor-pointer shadow-sm hover:shadow-md transition-shadow duration-300">
              <div className="h-48 bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-cyan-400"></div>
                <div className="relative z-10 text-center">
                  <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto shadow-lg">
                    <div className="w-14 h-14 bg-gradient-to-br from-yellow-400 via-red-400 to-yellow-400 rounded-full flex items-center justify-center">
                      <div className="w-10 h-10 bg-white rounded-full"></div>
                    </div>
                  </div>
                </div>
                <div className="absolute top-4 right-4 w-8 h-8 bg-red-400 rounded-full"></div>
                <div className="absolute bottom-6 left-6 w-6 h-6 bg-yellow-300 rounded-full"></div>
              </div>
              <div className="p-4 bg-gray-50">
                <h3 className="text-base font-bold text-gray-900 mb-2 leading-tight group-hover:text-blue-600 transition-colors duration-300">
                  Best Summer Giveaways For 2025: Ideas For Any Business & Marketing Campaign
                </h3>
                <div className="text-sm text-red-500 font-semibold">09/06/2025</div>
              </div>
            </article>

            {/* Blog Post 2 */}
            <article className="bg-white rounded-lg overflow-hidden group cursor-pointer shadow-sm hover:shadow-md transition-shadow duration-300">
              <div className="h-48 bg-gradient-to-br from-purple-300 to-blue-400 flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-gray-300 via-purple-200 to-blue-300"></div>
                <div className="relative z-10 text-center">
                  <div className="text-5xl font-bold text-pink-400 mb-2 transform group-hover:scale-110 transition-transform duration-300 drop-shadow-lg">
                    PRIDE
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-6 flex">
                  <div className="flex-1 bg-red-500"></div>
                  <div className="flex-1 bg-orange-400"></div>
                  <div className="flex-1 bg-yellow-400"></div>
                  <div className="flex-1 bg-green-500"></div>
                  <div className="flex-1 bg-blue-500"></div>
                  <div className="flex-1 bg-purple-500"></div>
                </div>
              </div>
              <div className="p-4 bg-gray-50">
                <h3 className="text-base font-bold text-gray-900 mb-2 leading-tight group-hover:text-purple-600 transition-colors duration-300">
                  TM Edit: The Best Pride Promotional Products For Your Business In 2025
                </h3>
                <div className="text-sm text-red-500 font-semibold">08/05/2025</div>
              </div>
            </article>

            {/* Blog Post 3 */}
            <article className="bg-white rounded-lg overflow-hidden group cursor-pointer shadow-sm hover:shadow-md transition-shadow duration-300">
              <div className="h-48 bg-gradient-to-br from-teal-300 to-cyan-400 flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-teal-300 to-cyan-400"></div>
                <div className="relative z-10">
                  <div className="w-28 h-20 bg-amber-100 rounded-sm transform rotate-12 shadow-lg relative border-l-4 border-blue-600">
                    <div className="absolute top-2 left-6 right-2 h-0.5 bg-gray-300"></div>
                    <div className="absolute top-4 left-6 right-4 h-0.5 bg-gray-300"></div>
                    <div className="absolute top-6 left-6 right-6 h-0.5 bg-gray-300"></div>
                    <div className="absolute top-8 left-6 right-8 h-0.5 bg-gray-300"></div>
                  </div>
                  <div className="absolute -top-2 right-2 w-12 h-1 bg-orange-500 rounded-full transform rotate-45"></div>
                  <div className="absolute top-6 left-2 w-8 h-1 bg-purple-600 rounded transform -rotate-12"></div>
                </div>
              </div>
              <div className="p-4 bg-gray-50">
                <h3 className="text-base font-bold text-gray-900 mb-2 leading-tight group-hover:text-teal-600 transition-colors duration-300">
                  Promotional Merchandise Statistics: What's Working In 2025?
                </h3>
                <div className="text-sm text-red-500 font-semibold">09/04/2025</div>
              </div>
            </article>
          </div>

          <div className="text-center mt-10">
            <button className="text-red-500 font-semibold hover:text-red-600 transition-colors duration-300 text-lg">
              View All News
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-800 text-white py-6 sm:py-8 lg:py-12">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            <div>
              <div className="flex items-center mb-6">
                <div className="bg-red-500 text-white rounded-full w-10 h-10 flex items-center justify-center font-bold text-lg mr-3">
                  PG
                </div>
                <div>
                  <h4 className="font-bold text-lg">Promo Gifts</h4>
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
                      <span>01844 600900</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Mail className="h-4 w-4 text-red-500" />
                      <span>helpdesk@promo-gifts.co.uk</span>
                    </div>
                  </div>
                </div>
                
                <div>
                  <h5 className="font-semibold text-white mb-2">Address</h5>
                  <div className="text-gray-300 text-sm leading-relaxed">
                    <p>Unit 9,</p>
                    <p>Clearfields Industrial Estate</p>
                    <p>Wotton Underwood,</p>
                    <p>Bucks HP18 0RS</p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-bold text-lg mb-6">Product Categories</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <ul className="space-y-2 text-sm text-gray-300">
                    <li className="hover:text-white cursor-pointer">Cups</li>
                    <li className="hover:text-white cursor-pointer">Water Bottles</li>
                    <li className="hover:text-white cursor-pointer">Bags</li>
                    <li className="hover:text-white cursor-pointer">Clothing</li>
                    <li className="hover:text-white cursor-pointer">Hi Vis</li>
                    <li className="hover:text-white cursor-pointer">Cables</li>
                  </ul>
                </div>
                <div>
                  <ul className="space-y-2 text-sm text-gray-300">
                    <li className="hover:text-white cursor-pointer">Power</li>
                    <li className="hover:text-white cursor-pointer">Speakers</li>
                    <li className="hover:text-white cursor-pointer">Pens & Writing</li>
                    <li className="hover:text-white cursor-pointer">Notebooks</li>
                    <li className="hover:text-white cursor-pointer">Tea Towels</li>
                  </ul>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-bold text-lg mb-6">Our Services</h4>
              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-xs font-bold mt-0.5">24</div>
                  <div>
                    <h5 className="font-semibold">24hr Express Delivery</h5>
                    <p className="text-sm text-gray-300">Fast turnaround for urgent orders</p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-blue-600 rounded-sm flex items-center justify-center text-xs font-bold mt-0.5">UK</div>
                  <div>
                    <h5 className="font-semibold">Made in the UK</h5>
                    <p className="text-sm text-gray-300">Premium British quality products</p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-3">
                  <div className="text-2xl mt-0.5">♻️</div>
                  <div>
                    <h5 className="font-semibold">Eco-Friendly Options</h5>
                    <p className="text-sm text-gray-300">Sustainable promotional products</p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 border-2 border-blue-400 rounded-sm flex items-center justify-center mt-0.5 relative">
                    <div className="w-2 h-2 border border-blue-400 rounded-full"></div>
                    <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-blue-400 rounded-full"></div>
                  </div>
                  <div>
                    <h5 className="font-semibold">Real-Time Proof</h5>
                    <p className="text-sm text-gray-300">See your logo instantly on products</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-700 mt-8 pt-6 text-center text-sm text-gray-400">
            <p>&copy; 2025 Promo Gifts. All rights reserved. | Privacy Policy | Terms & Conditions</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default PromoGiftsApp;