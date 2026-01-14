import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Zap, Shield, Clock, Loader } from 'lucide-react';
import { supabase } from '../services/supabaseService';

const CategoryPage = ({ categorySlug }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState(null);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchCategoryData();
  }, [categorySlug]);

  const fetchCategoryData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch category info
      const { data: categoryData, error: categoryError } = await supabase
        .from('catalog_categories')
        .select('*')
        .eq('slug', categorySlug)
        .single();

      if (categoryError) throw categoryError;
      if (!categoryData) throw new Error('Category not found');

      setCategory(categoryData);

      // Fetch products for this category
      const { data: productsData, error: productsError } = await supabase
        .from('catalog_products')
        .select(`
          *,
          catalog_product_images!inner(image_url, thumbnail_url, is_primary),
          catalog_pricing_tiers(min_quantity, price_per_unit)
        `)
        .eq('category_id', categoryData.id)
        .eq('status', 'active')
        .order('created_at', { ascending: true });

      if (productsError) throw productsError;

      // Process products to get lowest price and primary image
      const processedProducts = productsData.map(product => {
        // Get primary image or first image
        const primaryImage = product.catalog_product_images.find(img => img.is_primary)
          || product.catalog_product_images[0];

        // Get lowest price from pricing tiers
        const lowestPrice = product.catalog_pricing_tiers.length > 0
          ? Math.min(...product.catalog_pricing_tiers.map(tier => tier.price_per_unit))
          : null;

        return {
          ...product,
          primaryImage: primaryImage?.thumbnail_url || primaryImage?.image_url,
          lowestPrice
        };
      });

      setProducts(processedProducts);
    } catch (err) {
      console.error('Error fetching category data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <Loader className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading products...</p>
        </div>
      </div>
    );
  }

  if (error || !category) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg mb-4">Error loading category</p>
          <p className="text-gray-600 mb-6">{error || 'Category not found'}</p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

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
            <span className="text-gray-900 font-semibold">{category.name}</span>
          </div>

          {/* Title */}
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">{category.name}</h1>
            <p className="text-lg text-gray-600">
              {category.description || `Premium branded ${category.name.toLowerCase()} for your promotional needs`}
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
        {products.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 text-lg">No products available in this category yet.</p>
            <p className="text-gray-500 text-sm mt-2">Check back soon for new items!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {products.map((product) => (
              <div
                key={product.id}
                className="group bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 cursor-pointer"
                onClick={() => navigate(`/${categorySlug}/${product.slug}`)}
              >
                {/* Product Image */}
                <div className="relative aspect-square bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center p-8">
                  {product.primaryImage ? (
                    <img
                      src={product.primaryImage}
                      alt={product.name}
                      className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-300"
                    />
                  ) : (
                    <div className="text-8xl group-hover:scale-110 transition-transform duration-300">
                      📦
                    </div>
                  )}
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
                    {product.short_description || product.description}
                  </p>

                  {/* Price */}
                  <div className="flex items-baseline justify-between mb-4">
                    <div>
                      {product.lowestPrice && (
                        <>
                          <span className="text-sm text-gray-500">From</span>
                          <span className="text-2xl font-bold text-green-600 ml-2">
                            £{product.lowestPrice.toFixed(2)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* View Details Button */}
                  <button
                    className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2 group-hover:shadow-lg"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/${categorySlug}/${product.slug}`);
                    }}
                  >
                    <span>View Details</span>
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Bottom CTA Section */}
        <div className="mt-16 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl p-12 text-center shadow-2xl">
          <h2 className="text-3xl font-bold text-white mb-4">
            Need Help Choosing?
          </h2>
          <p className="text-lg text-blue-100 mb-8 max-w-2xl mx-auto">
            Our team can help you select the perfect {category.name.toLowerCase()} for your promotional campaign
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

export default CategoryPage;
