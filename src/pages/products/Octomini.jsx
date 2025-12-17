import React from 'react';
import ProductPageTemplate from '../../components/ProductPageTemplate';

const Octomini = () => {
  const productData = {
    name: 'Octomini',
    subtitle: 'Compact 8-in-1 Multi-Connector Charging Cable',
    productKey: 'octomini',
    rating: 4.8,
    reviews: 156,
    badge: 'Best Seller',

    colors: [
      { id: 'black', name: 'Black', hex: '#1a1a1a', image: '🔌' },
      { id: 'white', name: 'White', hex: '#ffffff', image: '🔌' },
      { id: 'blue', name: 'Blue', hex: '#3b82f6', image: '🔌' },
      { id: 'red', name: 'Red', hex: '#ef4444', image: '🔌' }
    ],

    features: [
      'Dual input: Type-C & USB',
      'Lightning & Type-C output',
      'Ultra-compact 13cm size',
      'GRS certified recycled plastic',
      '43% recycled materials',
      'Lightweight at only 12g',
      'Ideal for easy transport',
      'Available in 7 trendy colors'
    ],

    description: 'The Octomini is the ultimate eco-friendly promotional charging solution, featuring dual input connectors and multiple outputs in an ultra-compact design. Made from GRS certified recycled plastic (43% recycled materials), this sustainable cable is perfect for corporate gifts, trade shows, and client appreciation. Weighing only 12g and measuring just 13cm, it\'s incredibly portable while maintaining universal device compatibility. The generous branding area ensures your logo gets maximum visibility while demonstrating your commitment to sustainability.',

    specifications: {
      dimensions: '130 x 50 x 7mm',
      weight: '12g',
      material: 'Recycled Plastic (GRS Certified, 43% recycled)',
      printArea: '20 x 20mm',
      connectors: 'Dual input Type-C & USB, Lightning & Type-C Output',
      cableLength: '13cm (ultra-compact)',
      origin: 'China'
    },

    pricingTiers: [
      { min: 25, max: 99, price: 4.50 },
      { min: 100, max: 249, price: 4.20 },
      { min: 250, max: 499, price: 3.90 },
      { min: 500, max: null, price: 3.50 }
    ],

    minQuantity: 25,
    basePrice: 4.50
  };

  return <ProductPageTemplate productData={productData} />;
};

export default Octomini;
