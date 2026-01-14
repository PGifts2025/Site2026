import React from 'react';
import { useParams } from 'react-router-dom';
import ProductDetailPage from '../components/ProductDetailPage';

const ProductDetail = () => {
  const { categorySlug, productSlug } = useParams();

  return <ProductDetailPage categorySlug={categorySlug} productSlug={productSlug} />;
};

export default ProductDetail;
