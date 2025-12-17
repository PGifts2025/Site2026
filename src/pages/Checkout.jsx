import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { ShoppingBag, Trash2, Package, User, MapPin, CreditCard, Lock, AlertCircle, ChevronLeft, CheckCircle } from 'lucide-react';

const Checkout = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { cart, removeFromCart, updateQuantity, calculateTotals, clearCart } = useCart();
  const totals = calculateTotals();

  // TODO: Future shipping calculator integration
  // Will need to consider:
  // - Product dimensions and weight from database
  // - Quantity ordered
  // - Box sizes and how many items fit per box
  // - Number of boxes required
  // - Delivery postcode/zone
  // - Carrier rates (Royal Mail, DPD, etc.)
  //
  // For now using flat rate: £10.00
  // This will be replaced with: calculateShipping(cartItems, postcode)

  const calculateShipping = (items, postcode) => {
    // Placeholder for future implementation
    // Will fetch product weights, calculate boxes needed, get carrier rates
    return 10.00; // Flat rate for MVP
  };

  // Form states
  const [customerInfo, setCustomerInfo] = useState({
    fullName: '',
    email: '',
    phone: '',
    companyName: ''
  });

  const [shippingAddress, setShippingAddress] = useState({
    addressLine1: '',
    addressLine2: '',
    city: '',
    county: '',
    postcode: '',
    country: 'United Kingdom'
  });

  const [billingAddress, setBillingAddress] = useState({
    addressLine1: '',
    addressLine2: '',
    city: '',
    county: '',
    postcode: '',
    country: 'United Kingdom'
  });

  const [sameAsShipping, setSameAsShipping] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  // Redirect to home if cart is empty
  useEffect(() => {
    if (cart.length === 0) {
      navigate('/');
    }
  }, [cart.length, navigate]);

  // Handle canceled payment
  useEffect(() => {
    if (searchParams.get('canceled') === 'true') {
      alert('Payment was canceled. Please try again.');
      // Remove the query param
      window.history.replaceState({}, '', '/checkout');
    }
  }, [searchParams]);

  // Validation function
  const validateForm = () => {
    const newErrors = {};

    // Customer info validation
    if (!customerInfo.fullName.trim()) newErrors.fullName = 'Full name is required';
    if (!customerInfo.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(customerInfo.email)) {
      newErrors.email = 'Email is invalid';
    }
    if (!customerInfo.phone.trim()) newErrors.phone = 'Phone number is required';

    // Shipping address validation
    if (!shippingAddress.addressLine1.trim()) newErrors.shippingAddressLine1 = 'Address is required';
    if (!shippingAddress.city.trim()) newErrors.shippingCity = 'City is required';
    if (!shippingAddress.postcode.trim()) newErrors.shippingPostcode = 'Postcode is required';
    if (!shippingAddress.country.trim()) newErrors.shippingCountry = 'Country is required';

    // Billing address validation (if different from shipping)
    if (!sameAsShipping) {
      if (!billingAddress.addressLine1.trim()) newErrors.billingAddressLine1 = 'Address is required';
      if (!billingAddress.city.trim()) newErrors.billingCity = 'City is required';
      if (!billingAddress.postcode.trim()) newErrors.billingPostcode = 'Postcode is required';
      if (!billingAddress.country.trim()) newErrors.billingCountry = 'Country is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      // Scroll to first error
      const firstErrorElement = document.querySelector('.border-red-300');
      if (firstErrorElement) {
        firstErrorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    setIsSubmitting(true);

    try {
      // Build order data in the format expected by Stripe server
      const orderData = {
        orderNumber: 'PG' + Date.now(),
        date: new Date().toISOString(),
        customer: {
          name: customerInfo.fullName,
          email: customerInfo.email,
          phone: customerInfo.phone,
          company: customerInfo.companyName || ''
        },
        shippingAddress: {
          line1: shippingAddress.addressLine1,
          line2: shippingAddress.addressLine2 || '',
          city: shippingAddress.city,
          county: shippingAddress.county || '',
          postcode: shippingAddress.postcode,
          country: shippingAddress.country
        },
        items: cart.map(item => {
          const itemPrice = item.price || 0;
          const itemTotal = itemPrice * item.quantity;
          return {
            name: item.product_name,
            product_name: item.product_name,
            color: item.color,
            quantity: item.quantity,
            price: itemPrice,
            unitPrice: itemPrice,
            unit_price: itemPrice,
            total: itemTotal
          };
        }),
        subtotal: totals.subtotal,
        shipping: totals.shipping,
        vat: totals.vat,
        total: (parseFloat(totals.subtotal) + parseFloat(totals.shipping) + parseFloat(totals.vat)).toFixed(2)
      };

      // Save to localStorage for retrieval after Stripe redirect
      console.log('=== SAVING ORDER TO LOCALSTORAGE ===');
      console.log('[Checkout] cart:', cart);
      console.log('[Checkout] totals.subtotal:', totals.subtotal);
      console.log('[Checkout] totals.shipping:', totals.shipping);
      console.log('[Checkout] totals.vat:', totals.vat);
      console.log('[Checkout] calculated total:', (parseFloat(totals.subtotal) + parseFloat(totals.shipping) + parseFloat(totals.vat)).toFixed(2));
      console.log('[Checkout] Full orderData:', JSON.stringify(orderData, null, 2));

      localStorage.setItem('pendingOrder', JSON.stringify(orderData));
      console.log('[Checkout] ✓ Saved pending order to localStorage');

      // Verify what was actually saved
      const savedData = localStorage.getItem('pendingOrder');
      console.log('[Checkout] Verification - Raw saved data:', savedData);
      console.log('[Checkout] Verification - Parsed back:', JSON.parse(savedData));

      // Create Stripe Checkout Session
      console.log('[Checkout] Creating Stripe Checkout Session...');

      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderData: orderData,
          successUrl: window.location.origin + '/order-confirmation?session_id={CHECKOUT_SESSION_ID}',
          cancelUrl: window.location.origin + '/checkout?canceled=true'
        })
      });

      const data = await response.json();
      console.log('[Checkout] Server response:', data);

      if (data.error) {
        console.error('[Checkout] Error:', data.error);
        alert('Payment error: ' + data.error);
        setIsSubmitting(false);
        return;
      }

      if (data.url) {
        console.log('[Checkout] Redirecting to Stripe...');
        window.location.href = data.url;
      } else {
        console.error('[Checkout] No URL in response');
        alert('Failed to create checkout session');
        setIsSubmitting(false);
      }

    } catch (error) {
      console.error('[Checkout] Error:', error);
      alert('Failed to process checkout. Please try again.');
      setIsSubmitting(false);
    }
  };


  const isFormValid = () => {
    return (
      customerInfo.fullName.trim() &&
      customerInfo.email.trim() &&
      customerInfo.phone.trim() &&
      shippingAddress.addressLine1.trim() &&
      shippingAddress.city.trim() &&
      shippingAddress.postcode.trim() &&
      shippingAddress.country.trim() &&
      (sameAsShipping || (
        billingAddress.addressLine1.trim() &&
        billingAddress.city.trim() &&
        billingAddress.postcode.trim() &&
        billingAddress.country.trim()
      ))
    );
  };

  if (cart.length === 0) {
    return null; // Will redirect via useEffect
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
          >
            <ChevronLeft className="h-5 w-5 mr-1" />
            Back
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Checkout</h1>
          <p className="text-gray-600 mt-2">Complete your order and proceed to secure payment</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid lg:grid-cols-3 gap-8">
            {/* LEFT SIDE - 2/3 width */}
            <div className="lg:col-span-2 space-y-6">
              {/* Order Summary Section */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center space-x-2 mb-4">
                  <Package className="h-6 w-6 text-blue-600" />
                  <h2 className="text-xl font-semibold text-gray-900">Order Summary</h2>
                  <span className="text-sm text-gray-500">({cart.length} items)</span>
                </div>

                <div className="space-y-4">
                  {cart.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center space-x-4 py-4 border-b border-gray-100 last:border-0"
                    >
                      {/* Product Image */}
                      <div className="flex-shrink-0 w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center">
                        {item.image ? (
                          <span className="text-3xl">{item.image}</span>
                        ) : (
                          <ShoppingBag className="h-8 w-8 text-gray-400" />
                        )}
                      </div>

                      {/* Product Details */}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-900">{item.product_name}</h3>
                        <p className="text-xs text-gray-600 mt-1">Color: {item.color}</p>
                        <div className="flex items-center space-x-4 mt-2">
                          <div className="flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, Math.max(1, item.quantity - 1))}
                              className="p-1 border border-gray-300 rounded hover:bg-gray-100"
                            >
                              <span className="text-xs">-</span>
                            </button>
                            <span className="text-sm font-medium w-8 text-center">{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, item.quantity + 1)}
                              className="p-1 border border-gray-300 rounded hover:bg-gray-100"
                            >
                              <span className="text-xs">+</span>
                            </button>
                          </div>
                          <span className="text-sm text-gray-600">
                            £{item.price?.toFixed(2)} each
                          </span>
                        </div>
                      </div>

                      {/* Line Total & Remove */}
                      <div className="flex flex-col items-end space-y-2">
                        <span className="text-base font-bold text-gray-900">
                          £{((item.price || 0) * item.quantity).toFixed(2)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.id)}
                          className="text-red-600 hover:text-red-700 text-xs flex items-center"
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Customer Information Section */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center space-x-2 mb-4">
                  <User className="h-6 w-6 text-blue-600" />
                  <h2 className="text-xl font-semibold text-gray-900">Customer Information</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={customerInfo.fullName}
                      onChange={(e) => setCustomerInfo({ ...customerInfo, fullName: e.target.value })}
                      className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        errors.fullName ? 'border-red-300 bg-red-50' : 'border-gray-300'
                      }`}
                      placeholder="John Smith"
                    />
                    {errors.fullName && (
                      <p className="text-red-600 text-xs mt-1 flex items-center">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {errors.fullName}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      value={customerInfo.email}
                      onChange={(e) => setCustomerInfo({ ...customerInfo, email: e.target.value })}
                      className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        errors.email ? 'border-red-300 bg-red-50' : 'border-gray-300'
                      }`}
                      placeholder="john@example.com"
                    />
                    {errors.email && (
                      <p className="text-red-600 text-xs mt-1 flex items-center">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {errors.email}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Phone Number <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      value={customerInfo.phone}
                      onChange={(e) => setCustomerInfo({ ...customerInfo, phone: e.target.value })}
                      className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        errors.phone ? 'border-red-300 bg-red-50' : 'border-gray-300'
                      }`}
                      placeholder="01234 567890"
                    />
                    {errors.phone && (
                      <p className="text-red-600 text-xs mt-1 flex items-center">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {errors.phone}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Company Name <span className="text-gray-400">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      value={customerInfo.companyName}
                      onChange={(e) => setCustomerInfo({ ...customerInfo, companyName: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Acme Corporation"
                    />
                  </div>
                </div>
              </div>

              {/* Shipping Address Section */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center space-x-2 mb-4">
                  <MapPin className="h-6 w-6 text-blue-600" />
                  <h2 className="text-xl font-semibold text-gray-900">Shipping Address</h2>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Address Line 1 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={shippingAddress.addressLine1}
                      onChange={(e) => setShippingAddress({ ...shippingAddress, addressLine1: e.target.value })}
                      className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        errors.shippingAddressLine1 ? 'border-red-300 bg-red-50' : 'border-gray-300'
                      }`}
                      placeholder="123 High Street"
                    />
                    {errors.shippingAddressLine1 && (
                      <p className="text-red-600 text-xs mt-1 flex items-center">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {errors.shippingAddressLine1}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Address Line 2 <span className="text-gray-400">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      value={shippingAddress.addressLine2}
                      onChange={(e) => setShippingAddress({ ...shippingAddress, addressLine2: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Flat 4B"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        City <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={shippingAddress.city}
                        onChange={(e) => setShippingAddress({ ...shippingAddress, city: e.target.value })}
                        className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          errors.shippingCity ? 'border-red-300 bg-red-50' : 'border-gray-300'
                        }`}
                        placeholder="London"
                      />
                      {errors.shippingCity && (
                        <p className="text-red-600 text-xs mt-1 flex items-center">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          {errors.shippingCity}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        County/State <span className="text-gray-400">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={shippingAddress.county}
                        onChange={(e) => setShippingAddress({ ...shippingAddress, county: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Greater London"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Postcode <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={shippingAddress.postcode}
                        onChange={(e) => setShippingAddress({ ...shippingAddress, postcode: e.target.value })}
                        className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          errors.shippingPostcode ? 'border-red-300 bg-red-50' : 'border-gray-300'
                        }`}
                        placeholder="SW1A 1AA"
                      />
                      {errors.shippingPostcode && (
                        <p className="text-red-600 text-xs mt-1 flex items-center">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          {errors.shippingPostcode}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Country <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={shippingAddress.country}
                        onChange={(e) => setShippingAddress({ ...shippingAddress, country: e.target.value })}
                        className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          errors.shippingCountry ? 'border-red-300 bg-red-50' : 'border-gray-300'
                        }`}
                      >
                        <option value="United Kingdom">United Kingdom</option>
                        <option value="Ireland">Ireland</option>
                        <option value="United States">United States</option>
                        <option value="Canada">Canada</option>
                        <option value="Australia">Australia</option>
                      </select>
                      {errors.shippingCountry && (
                        <p className="text-red-600 text-xs mt-1 flex items-center">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          {errors.shippingCountry}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Billing Address Section */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center space-x-2 mb-4">
                  <CreditCard className="h-6 w-6 text-blue-600" />
                  <h2 className="text-xl font-semibold text-gray-900">Billing Address</h2>
                </div>

                <div className="mb-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sameAsShipping}
                      onChange={(e) => setSameAsShipping(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">
                      Same as shipping address
                    </span>
                  </label>
                </div>

                {!sameAsShipping && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Address Line 1 <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={billingAddress.addressLine1}
                        onChange={(e) => setBillingAddress({ ...billingAddress, addressLine1: e.target.value })}
                        className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          errors.billingAddressLine1 ? 'border-red-300 bg-red-50' : 'border-gray-300'
                        }`}
                        placeholder="123 High Street"
                      />
                      {errors.billingAddressLine1 && (
                        <p className="text-red-600 text-xs mt-1 flex items-center">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          {errors.billingAddressLine1}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Address Line 2 <span className="text-gray-400">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={billingAddress.addressLine2}
                        onChange={(e) => setBillingAddress({ ...billingAddress, addressLine2: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Flat 4B"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          City <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={billingAddress.city}
                          onChange={(e) => setBillingAddress({ ...billingAddress, city: e.target.value })}
                          className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            errors.billingCity ? 'border-red-300 bg-red-50' : 'border-gray-300'
                          }`}
                          placeholder="London"
                        />
                        {errors.billingCity && (
                          <p className="text-red-600 text-xs mt-1 flex items-center">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            {errors.billingCity}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          County/State <span className="text-gray-400">(Optional)</span>
                        </label>
                        <input
                          type="text"
                          value={billingAddress.county}
                          onChange={(e) => setBillingAddress({ ...billingAddress, county: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Greater London"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Postcode <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={billingAddress.postcode}
                          onChange={(e) => setBillingAddress({ ...billingAddress, postcode: e.target.value })}
                          className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            errors.billingPostcode ? 'border-red-300 bg-red-50' : 'border-gray-300'
                          }`}
                          placeholder="SW1A 1AA"
                        />
                        {errors.billingPostcode && (
                          <p className="text-red-600 text-xs mt-1 flex items-center">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            {errors.billingPostcode}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Country <span className="text-red-500">*</span>
                        </label>
                        <select
                          value={billingAddress.country}
                          onChange={(e) => setBillingAddress({ ...billingAddress, country: e.target.value })}
                          className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            errors.billingCountry ? 'border-red-300 bg-red-50' : 'border-gray-300'
                          }`}
                        >
                          <option value="United Kingdom">United Kingdom</option>
                          <option value="Ireland">Ireland</option>
                          <option value="United States">United States</option>
                          <option value="Canada">Canada</option>
                          <option value="Australia">Australia</option>
                        </select>
                        {errors.billingCountry && (
                          <p className="text-red-600 text-xs mt-1 flex items-center">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            {errors.billingCountry}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT SIDE - 1/3 width - Order Total Panel (Sticky) */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-6 sticky top-8">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Order Total</h2>

                <div className="space-y-3 mb-6">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Subtotal:</span>
                    <span>£{totals.subtotal}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Shipping:</span>
                    <span>£{totals.shipping}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>VAT (20%):</span>
                    <span>£{totals.vat}</span>
                  </div>
                  <div className="border-t border-gray-200 pt-3">
                    <div className="flex justify-between text-lg font-bold text-gray-900">
                      <span>Total:</span>
                      <span>£{(parseFloat(totals.subtotal) + parseFloat(totals.shipping) + parseFloat(totals.vat)).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!isFormValid() || isSubmitting}
                  className={`w-full py-3 rounded-lg font-semibold text-white transition-all flex items-center justify-center space-x-2 ${
                    !isFormValid() || isSubmitting
                      ? 'bg-gray-300 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700 hover:shadow-lg'
                  }`}
                >
                  {isSubmitting ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      <span>Redirecting to Payment...</span>
                    </>
                  ) : (
                    <>
                      <Lock className="h-5 w-5" />
                      <span>Proceed to Secure Payment</span>
                    </>
                  )}
                </button>

                <p className="text-xs text-center text-gray-500 mt-3">
                  You'll be redirected to Stripe's secure payment page
                </p>

                <div className="mt-4 flex items-start space-x-2 text-xs text-gray-500">
                  <Lock className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <p>
                    Your payment information is secure. We use industry-standard encryption to protect your data.
                  </p>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex items-center justify-center space-x-2 text-xs text-gray-500">
                    <span>Trusted by businesses worldwide</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Checkout;
