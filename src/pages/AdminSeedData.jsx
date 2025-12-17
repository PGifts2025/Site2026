/**
 * Admin Seed Data Page
 *
 * Provides UI for seeding the product catalog database with initial data.
 *
 * ⚠️ FOR DEVELOPMENT/TESTING ONLY
 */

import React, { useState, useRef, useEffect } from 'react';
import { Database, Plus, AlertTriangle, CheckCircle, XCircle, Trash2, Loader } from 'lucide-react';
import {
  seedCategories,
  seedBagsProduct,
  seedCupsProduct,
  seedAllProducts,
  clearCatalogData
} from '../utils/seedCatalogData';

const AdminSeedData = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const logContainerRef = useRef(null);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  /**
   * Add a log entry
   */
  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { message, type, timestamp }]);
  };

  /**
   * Clear logs
   */
  const clearLogs = () => {
    setLogs([]);
  };

  /**
   * Intercept console.log/error during seeding
   */
  const captureConsole = (callback) => {
    const originalLog = console.log;
    const originalError = console.error;

    console.log = (...args) => {
      const message = args.join(' ');
      if (message.includes('✓') || message.includes('Created')) {
        addLog(message, 'success');
      } else if (message.includes('✗') || message.includes('Failed')) {
        addLog(message, 'error');
      } else {
        addLog(message, 'info');
      }
      originalLog(...args);
    };

    console.error = (...args) => {
      addLog(args.join(' '), 'error');
      originalError(...args);
    };

    try {
      callback();
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  };

  /**
   * Handle seed categories
   */
  const handleSeedCategories = async () => {
    setIsLoading(true);
    addLog('Starting category seeding...', 'info');

    try {
      captureConsole(async () => {
        const results = await seedCategories();
        addLog(`✅ Categories seeded successfully! (${results.length}/11)`, 'success');
      });
    } catch (error) {
      addLog(`❌ Error seeding categories: ${error.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle seed bags product
   */
  const handleSeedBagsProduct = async () => {
    setIsLoading(true);
    addLog('Starting Bags product seeding...', 'info');

    try {
      captureConsole(async () => {
        const result = await seedBagsProduct();
        if (result) {
          addLog('✅ Bags product seeded successfully!', 'success');
        } else {
          addLog('⚠️ Bags product seeding completed with warnings', 'warning');
        }
      });
    } catch (error) {
      addLog(`❌ Error seeding Bags product: ${error.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle seed cups product
   */
  const handleSeedCupsProduct = async () => {
    setIsLoading(true);
    addLog('Starting Cups product seeding...', 'info');

    try {
      captureConsole(async () => {
        const result = await seedCupsProduct();
        if (result) {
          addLog('✅ Cups product seeded successfully!', 'success');
        } else {
          addLog('⚠️ Cups product seeding completed with warnings', 'warning');
        }
      });
    } catch (error) {
      addLog(`❌ Error seeding Cups product: ${error.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle seed all products
   */
  const handleSeedAllProducts = async () => {
    setIsLoading(true);
    addLog('🌱 Starting full catalog seeding...', 'info');

    try {
      captureConsole(async () => {
        const results = await seedAllProducts();
        addLog('✅ All products seeded successfully!', 'success');
        addLog(`📊 Categories: ${results.categories?.length || 0}/11`, 'info');
        addLog(`📦 Bags product: ${results.bagsProduct ? '✓' : '✗'}`, 'info');
        addLog(`☕ Cups product: ${results.cupsProduct ? '✓' : '✗'}`, 'info');
      });
    } catch (error) {
      addLog(`❌ Error seeding all products: ${error.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle clear all data (with confirmation)
   */
  const handleClearAllData = async () => {
    setIsLoading(true);
    addLog('🗑️ Clearing all catalog data...', 'warning');

    try {
      captureConsole(async () => {
        await clearCatalogData(true);
        addLog('✅ All catalog data cleared!', 'success');
      });
    } catch (error) {
      addLog(`❌ Error clearing data: ${error.message}`, 'error');
    } finally {
      setIsLoading(false);
      setShowClearConfirm(false);
    }
  };

  /**
   * Get log icon based on type
   */
  const getLogIcon = (type) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0" />;
      default:
        return <Database className="h-4 w-4 text-blue-500 flex-shrink-0" />;
    }
  };

  /**
   * Get log text color based on type
   */
  const getLogColor = (type) => {
    switch (type) {
      case 'success':
        return 'text-green-700';
      case 'error':
        return 'text-red-700';
      case 'warning':
        return 'text-yellow-700';
      default:
        return 'text-gray-700';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center space-x-3 mb-2">
            <Database className="h-8 w-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">Admin Seed Data</h1>
          </div>
          <p className="text-gray-600">
            Populate the catalog database with initial test data
          </p>
        </div>

        {/* Warning Banner */}
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">
                Development/Testing Only
              </h3>
              <div className="mt-2 text-sm text-yellow-700">
                <p>
                  This page is for seeding test data during development.
                  All seeded products start in <span className="font-semibold">'draft'</span> status and must be published manually.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Seeding Controls */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Seeding Operations
              </h2>

              <div className="space-y-3">

                {/* Seed Categories */}
                <button
                  onClick={handleSeedCategories}
                  disabled={isLoading}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border-2 transition-all ${
                    isLoading
                      ? 'bg-gray-100 border-gray-300 cursor-not-allowed'
                      : 'bg-white border-blue-200 hover:border-blue-400 hover:bg-blue-50'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Database className="h-5 w-5 text-blue-600" />
                    <div className="text-left">
                      <div className="font-medium text-gray-900">Seed Categories</div>
                      <div className="text-xs text-gray-500">Create 11 product categories</div>
                    </div>
                  </div>
                  {isLoading && <Loader className="h-4 w-4 animate-spin text-gray-400" />}
                </button>

                {/* Seed Bags Product */}
                <button
                  onClick={handleSeedBagsProduct}
                  disabled={isLoading}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border-2 transition-all ${
                    isLoading
                      ? 'bg-gray-100 border-gray-300 cursor-not-allowed'
                      : 'bg-white border-green-200 hover:border-green-400 hover:bg-green-50'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Plus className="h-5 w-5 text-green-600" />
                    <div className="text-left">
                      <div className="font-medium text-gray-900">Seed Bags Product</div>
                      <div className="text-xs text-gray-500">5oz Cotton Bag with full data</div>
                    </div>
                  </div>
                  {isLoading && <Loader className="h-4 w-4 animate-spin text-gray-400" />}
                </button>

                {/* Seed Cups Product */}
                <button
                  onClick={handleSeedCupsProduct}
                  disabled={isLoading}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border-2 transition-all ${
                    isLoading
                      ? 'bg-gray-100 border-gray-300 cursor-not-allowed'
                      : 'bg-white border-green-200 hover:border-green-400 hover:bg-green-50'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Plus className="h-5 w-5 text-green-600" />
                    <div className="text-left">
                      <div className="font-medium text-gray-900">Seed Cups Product</div>
                      <div className="text-xs text-gray-500">Premium Vacuum Flask with full data</div>
                    </div>
                  </div>
                  {isLoading && <Loader className="h-4 w-4 animate-spin text-gray-400" />}
                </button>

                {/* Divider */}
                <div className="border-t border-gray-200 my-4"></div>

                {/* Seed All Products */}
                <button
                  onClick={handleSeedAllProducts}
                  disabled={isLoading}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border-2 transition-all ${
                    isLoading
                      ? 'bg-gray-100 border-gray-300 cursor-not-allowed'
                      : 'bg-gradient-to-r from-blue-500 to-purple-600 border-transparent text-white hover:from-blue-600 hover:to-purple-700 shadow-md hover:shadow-lg'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Database className="h-5 w-5" />
                    <div className="text-left">
                      <div className="font-semibold">Seed All Products</div>
                      <div className="text-xs opacity-90">Run complete seeding process</div>
                    </div>
                  </div>
                  {isLoading && <Loader className="h-4 w-4 animate-spin" />}
                </button>

                {/* Divider */}
                <div className="border-t border-gray-200 my-4"></div>

                {/* Clear All Data */}
                {!showClearConfirm ? (
                  <button
                    onClick={() => setShowClearConfirm(true)}
                    disabled={isLoading}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border-2 transition-all ${
                      isLoading
                        ? 'bg-gray-100 border-gray-300 cursor-not-allowed'
                        : 'bg-white border-red-200 hover:border-red-400 hover:bg-red-50'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <Trash2 className="h-5 w-5 text-red-600" />
                      <div className="text-left">
                        <div className="font-medium text-gray-900">Clear All Data</div>
                        <div className="text-xs text-gray-500">⚠️ Delete all catalog data</div>
                      </div>
                    </div>
                  </button>
                ) : (
                  <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4">
                    <div className="flex items-start space-x-3 mb-3">
                      <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold text-red-900">Confirm Deletion</div>
                        <div className="text-sm text-red-700 mt-1">
                          This will permanently delete ALL catalog data including:
                          products, categories, colors, images, pricing, features, and specs.
                        </div>
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={handleClearAllData}
                        disabled={isLoading}
                        className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        {isLoading ? (
                          <span className="flex items-center justify-center">
                            <Loader className="h-4 w-4 animate-spin mr-2" />
                            Deleting...
                          </span>
                        ) : (
                          'Yes, Delete All'
                        )}
                      </button>
                      <button
                        onClick={() => setShowClearConfirm(false)}
                        disabled={isLoading}
                        className="flex-1 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Log Output */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Operation Log
                </h2>
                <button
                  onClick={clearLogs}
                  className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Clear
                </button>
              </div>

              {/* Log Container */}
              <div
                ref={logContainerRef}
                className="bg-gray-900 rounded-lg p-4 h-96 overflow-y-auto font-mono text-xs"
              >
                {logs.length === 0 ? (
                  <div className="text-gray-500 text-center py-8">
                    No operations run yet. Click a button above to start.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {logs.map((log, index) => (
                      <div key={index} className="flex items-start space-x-2">
                        <span className="text-gray-500 flex-shrink-0">{log.timestamp}</span>
                        <div className="flex items-start space-x-2 flex-1">
                          {getLogIcon(log.type)}
                          <span className={`${getLogColor(log.type)} break-all`}>
                            {log.message}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Status Indicator */}
              {isLoading && (
                <div className="mt-4 flex items-center justify-center space-x-2 text-blue-600">
                  <Loader className="h-4 w-4 animate-spin" />
                  <span className="text-sm font-medium">Operation in progress...</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Info Section */}
        <div className="mt-6 bg-blue-50 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-blue-900 mb-3">
            📝 Next Steps After Seeding
          </h3>
          <ul className="space-y-2 text-sm text-blue-800">
            <li className="flex items-start">
              <span className="mr-2">1.</span>
              <span>Review seeded data in Supabase dashboard</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">2.</span>
              <span>Upload real product images to <code className="bg-blue-100 px-1 rounded">catalog-images</code> bucket</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">3.</span>
              <span>Update image URLs in <code className="bg-blue-100 px-1 rounded">catalog_product_images</code> table</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">4.</span>
              <span>Link products to designer templates (set <code className="bg-blue-100 px-1 rounded">designer_product_id</code>)</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">5.</span>
              <span>Publish products (change status from <code className="bg-blue-100 px-1 rounded">draft</code> to <code className="bg-blue-100 px-1 rounded">active</code>)</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">6.</span>
              <span>Test product pages with real data</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default AdminSeedData;
