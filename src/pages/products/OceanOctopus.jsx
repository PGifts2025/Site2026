import React from 'react';
import ProductPageTemplate from '../../components/ProductPageTemplate';

const OceanOctopus = () => {
  const productData = {
    name: 'Ocean Octopus',
    subtitle: 'Eco-Friendly Multi-Connector Cable from Recycled Ocean Plastic',
    productKey: 'ocean-octopus',
    rating: 4.7,
    reviews: 128,
    badge: 'Eco-Friendly',

    colors: [
      { id: 'ocean-blue', name: 'Ocean Blue', hex: '#0077be', image: '🌊' },
      { id: 'seafoam', name: 'Seafoam Green', hex: '#3eb489', image: '🌊' },
      { id: 'coral', name: 'Coral', hex: '#ff6b6b', image: '🌊' },
      { id: 'sand', name: 'Sand Beige', hex: '#d4a574', image: '🌊' }
    ],

    features: [
      'Made from Recycled Ocean Plastic',
      '5-in-1 Multi-Connector',
      'Carbon Neutral Production',
      'Durable & Water-Resistant',
      'Supports Environmental Causes',
      'Large Branding Surface'
    ],

    description: 'Make a statement about your brand\'s environmental commitment with the Ocean Octopus charging cable. Crafted from recycled ocean plastic, this eco-friendly cable combines functionality with sustainability. Each cable helps remove plastic from our oceans while providing a practical charging solution. Perfect for brands that want to showcase their environmental values and make a positive impact with every promotional item.',

    specifications: {
      cableLength: '20cm',
      connectorTypes: 'USB-A, USB-C, Lightning, Micro-USB (2x Output)',
      chargingPower: 'Up to 2.4A',
      material: 'Recycled Ocean Plastic, Aluminum Connectors',
      printArea: '30mm x 30mm',
      weight: '40g',
      packaging: 'Eco-Friendly Recycled Box',
      certification: 'RCS Certified Recycled Material'
    },

    pricingTiers: [
      { min: 25, max: 99, price: 5.20 },
      { min: 100, max: 249, price: 4.85 },
      { min: 250, max: 499, price: 4.50 },
      { min: 500, max: null, price: 4.10 }
    ],

    minQuantity: 25,
    basePrice: 5.20
  };

  return <ProductPageTemplate productData={productData} />;
};

export default OceanOctopus;
