import React from 'react';
import ProductPageTemplate from '../../components/ProductPageTemplate';

const MrBio = () => {
  const productData = {
    name: 'Mr Bio',
    subtitle: 'Sustainable 3-in-1 Charging Cable from Wheat Straw',
    productKey: 'mr-bio',
    rating: 4.6,
    reviews: 94,
    badge: 'Sustainable',

    colors: [
      { id: 'natural', name: 'Natural Wheat', hex: '#e8dcc4', image: '🌱' },
      { id: 'earth-brown', name: 'Earth Brown', hex: '#8b6f47', image: '🌱' },
      { id: 'sage-green', name: 'Sage Green', hex: '#9caf88', image: '🌱' },
      { id: 'clay', name: 'Terracotta Clay', hex: '#c47b5f', image: '🌱' }
    ],

    features: [
      'Biodegradable Wheat Straw Material',
      '3-in-1 Charging Solution',
      'Environmentally Friendly',
      'Lightweight & Portable',
      'Natural Aesthetic',
      'Ideal for Eco-Conscious Brands'
    ],

    description: 'Mr Bio represents the future of sustainable promotional products. Made from biodegradable wheat straw composite, this charging cable offers eco-friendly functionality without compromising on quality. The unique natural texture and earthy tones make it stand out from conventional cables while aligning your brand with environmental responsibility. An excellent choice for companies committed to reducing their environmental footprint.',

    specifications: {
      cableLength: '18cm',
      connectorTypes: 'USB-A to USB-C, Lightning, Micro-USB',
      chargingPower: 'Up to 2A',
      material: 'Wheat Straw Composite (50% Wheat Fiber)',
      printArea: '28mm x 20mm',
      weight: '28g',
      packaging: 'Compostable Packaging',
      biodegradability: 'Biodegradable in 2-3 years'
    },

    pricingTiers: [
      { min: 25, max: 99, price: 3.80 },
      { min: 100, max: 249, price: 3.50 },
      { min: 250, max: 499, price: 3.20 },
      { min: 500, max: null, price: 2.90 }
    ],

    minQuantity: 25,
    basePrice: 3.80
  };

  return <ProductPageTemplate productData={productData} />;
};

export default MrBio;
