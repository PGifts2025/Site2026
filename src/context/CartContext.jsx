import React, { createContext, useContext, useState, useEffect } from 'react';

const CartContext = createContext();

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};

export const CartProvider = ({ children }) => {
  const [cart, setCart] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Load cart from localStorage on mount
  useEffect(() => {
    try {
      const savedCart = localStorage.getItem('pgifts_cart');
      if (savedCart) {
        setCart(JSON.parse(savedCart));
        console.log('[Cart] Loaded cart from localStorage:', JSON.parse(savedCart).length, 'items');
      }
    } catch (error) {
      console.error('[Cart] Error loading cart from localStorage:', error);
    }
  }, []);

  // Save cart to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('pgifts_cart', JSON.stringify(cart));
      console.log('[Cart] Saved cart to localStorage:', cart.length, 'items');
    } catch (error) {
      console.error('[Cart] Error saving cart to localStorage:', error);
    }
  }, [cart]);

  // Add item to cart
  const addToCart = (item) => {
    try {
      // Generate unique ID for cart item
      const cartItem = {
        id: `cart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        product_template_id: item.product_template_id,
        product_name: item.product_name,
        product_key: item.product_key,
        color: item.color,
        color_name: item.color_name,
        view: item.view,
        print_area: item.print_area,
        design_data: item.design_data, // Fabric.js JSON
        preview_image: item.preview_image, // Base64 thumbnail
        quantity: item.quantity || 1,
        price: item.price || 0,
        added_at: new Date().toISOString()
      };

      setCart(prevCart => [...prevCart, cartItem]);
      console.log('[Cart] Added item to cart:', cartItem.product_name);
      return cartItem;
    } catch (error) {
      console.error('[Cart] Error adding item to cart:', error);
      throw error;
    }
  };

  // Remove item from cart
  const removeFromCart = (itemId) => {
    try {
      setCart(prevCart => prevCart.filter(item => item.id !== itemId));
      console.log('[Cart] Removed item from cart:', itemId);
    } catch (error) {
      console.error('[Cart] Error removing item from cart:', error);
      throw error;
    }
  };

  // Update item quantity
  const updateQuantity = (itemId, quantity) => {
    try {
      if (quantity < 1) {
        removeFromCart(itemId);
        return;
      }

      setCart(prevCart =>
        prevCart.map(item =>
          item.id === itemId
            ? { ...item, quantity: quantity }
            : item
        )
      );
      console.log('[Cart] Updated quantity for item:', itemId, 'to', quantity);
    } catch (error) {
      console.error('[Cart] Error updating quantity:', error);
      throw error;
    }
  };

  // Calculate cart totals
  const calculateTotals = () => {
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shipping = cart.length > 0 ? 10 : 0; // Flat £10 shipping
    const vat = (subtotal + shipping) * 0.2; // 20% VAT on subtotal + shipping
    const total = subtotal + shipping + vat;

    return {
      subtotal: subtotal.toFixed(2),
      vat: vat.toFixed(2),
      tax: vat.toFixed(2), // Alias for backward compatibility
      shipping: shipping.toFixed(2),
      total: total.toFixed(2),
      itemCount: cart.reduce((sum, item) => sum + item.quantity, 0)
    };
  };

  // Clear entire cart
  const clearCart = () => {
    try {
      setCart([]);
      console.log('[Cart] Cleared cart');
    } catch (error) {
      console.error('[Cart] Error clearing cart:', error);
      throw error;
    }
  };

  // Open/close cart panel
  const openCart = () => setIsCartOpen(true);
  const closeCart = () => setIsCartOpen(false);
  const toggleCart = () => setIsCartOpen(prev => !prev);

  const value = {
    cart,
    isCartOpen,
    addToCart,
    removeFromCart,
    updateQuantity,
    calculateTotals,
    clearCart,
    openCart,
    closeCart,
    toggleCart
  };

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
};

export default CartContext;
