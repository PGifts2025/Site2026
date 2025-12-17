import React from 'react';
import ProductPageTemplate from '../../components/ProductPageTemplate';

const MrBioPDLong = () => {
  const productData = {
    name: 'Mr Bio PD Long',
    subtitle: 'Extended Biodegradable Cable with Power Delivery Fast Charging',
    productKey: 'mr-bio-pd-long',
    rating: 4.9,
    reviews: 112,
    badge: 'Fast Charge',

    colors: [
      { id: 'natural', name: 'Natural Wheat', hex: '#e8dcc4', image: '⚡' },
      { id: 'charcoal', name: 'Charcoal Grey', hex: '#4a4a4a', image: '⚡' },
      { id: 'forest', name: 'Forest Green', hex: '#2d5016', image: '⚡' },
      { id: 'stone', name: 'Stone Grey', hex: '#9ca3af', image: '⚡' }
    ],

    features: [
      'Power Delivery Fast Charging',
      'Extended 1m Cable Length',
      'Biodegradable Wheat Straw',
      'USB-C to USB-C Connection',
      'Up to 60W Power Output',
      'Premium Sustainable Choice'
    ],

    description: 'The Mr Bio PD Long takes sustainable charging to the next level with Power Delivery fast charging technology and an extended 1-meter cable length. Perfect for modern devices requiring USB-C fast charging, this eco-friendly cable delivers up to 60W of power while maintaining environmental responsibility. The longer cable provides added convenience for desks, cars, and travel. An exceptional promotional item for tech-forward brands with environmental values.',

    specifications: {
      cableLength: '1m (100cm)',
      connectorTypes: 'USB-C to USB-C',
      chargingPower: 'Up to 60W (20V/3A)',
      powerDelivery: 'USB PD 3.0 Compatible',
      dataTransfer: 'USB 2.0 (480Mbps)',
      material: 'Wheat Straw Composite (50% Wheat Fiber)',
      printArea: '35mm x 25mm',
      weight: '45g',
      packaging: 'Compostable Packaging',
      biodegradability: 'Biodegradable in 2-3 years'
    },

    pricingTiers: [
      { min: 25, max: 99, price: 4.95 },
      { min: 100, max: 249, price: 4.65 },
      { min: 250, max: 499, price: 4.35 },
      { min: 500, max: null, price: 3.95 }
    ],

    minQuantity: 25,
    basePrice: 4.95
  };

  return <ProductPageTemplate productData={productData} />;
};

export default MrBioPDLong;
