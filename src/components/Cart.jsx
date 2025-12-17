import React from 'react';
import { X, Plus, Minus, Trash2, ShoppingBag, ArrowRight } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useNavigate } from 'react-router-dom';

const Cart = () => {
  const { cart, isCartOpen, closeCart, removeFromCart, updateQuantity, calculateTotals } = useCart();
  const navigate = useNavigate();
  const totals = calculateTotals();

  // Cart-specific VAT calculation (subtotal only, since shipping is "Calculated at checkout")
  const cartVAT = (parseFloat(totals.subtotal) * 0.2).toFixed(2);
  const cartTotal = (parseFloat(totals.subtotal) + parseFloat(cartVAT)).toFixed(2);

  const handleCheckout = () => {
    closeCart();
    navigate('/checkout');
  };

  if (!isCartOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity"
        onClick={closeCart}
      />

      {/* Cart Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center space-x-2">
            <ShoppingBag className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900">
              Shopping Cart
            </h2>
            {cart.length > 0 && (
              <span className="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                {totals.itemCount}
              </span>
            )}
          </div>
          <button
            onClick={closeCart}
            className="p-2 hover:bg-gray-200 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <ShoppingBag className="w-16 h-16 text-gray-300 mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Your cart is empty</h3>
              <p className="text-gray-600 mb-6">Add some custom designs to get started!</p>
              <button
                onClick={closeCart}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Continue Shopping
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {cart.map((item) => (
                <div
                  key={item.id}
                  className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex space-x-4">
                    {/* Preview Image */}
                    <div className="flex-shrink-0 w-20 h-20 bg-gray-100 rounded-md overflow-hidden">
                      {item.preview_image ? (
                        <img
                          src={item.preview_image}
                          alt={item.product_name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                          <ShoppingBag className="w-8 h-8" />
                        </div>
                      )}
                    </div>

                    {/* Item Details */}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-gray-900 truncate">
                        {item.product_name}
                      </h3>
                      <p className="text-xs text-gray-600 mt-1">
                        Color: {item.color_name || item.color}
                      </p>
                      {item.print_area && (
                        <p className="text-xs text-gray-600">
                          Print Area: {item.print_area}
                        </p>
                      )}
                      <p className="text-sm font-bold text-blue-600 mt-2">
                        £{item.price.toFixed(2)}
                      </p>

                      {/* Quantity Controls */}
                      <div className="flex items-center space-x-2 mt-2">
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="p-1 border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                        >
                          <Minus className="w-3 h-3 text-gray-600" />
                        </button>
                        <span className="text-sm font-medium text-gray-900 min-w-[2rem] text-center">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="p-1 border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                        >
                          <Plus className="w-3 h-3 text-gray-600" />
                        </button>
                      </div>
                    </div>

                    {/* Remove Button */}
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="flex-shrink-0 p-2 text-red-600 hover:bg-red-50 rounded-full transition-colors"
                      title="Remove item"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer with Totals and Checkout */}
        {cart.length > 0 && (
          <div className="border-t border-gray-200 px-6 py-4 bg-gray-50">
            {/* Totals */}
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Subtotal:</span>
                <span>£{totals.subtotal}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-600">
                <span>VAT (20%):</span>
                <span>£{cartVAT}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-500 italic">
                <span>Shipping:</span>
                <span>Calculated at checkout</span>
              </div>
              <div className="flex justify-between text-lg font-bold text-gray-900 pt-2 border-t border-gray-300">
                <span>Total:</span>
                <span>£{cartTotal}</span>
              </div>
            </div>

            {/* Checkout Button */}
            <button
              onClick={handleCheckout}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2"
            >
              <span>Proceed to Checkout</span>
              <ArrowRight className="w-5 h-5" />
            </button>

            <button
              onClick={closeCart}
              className="w-full mt-2 text-gray-600 py-2 rounded-lg font-medium hover:bg-gray-100 transition-colors"
            >
              Continue Shopping
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </>
  );
};

export default Cart;
