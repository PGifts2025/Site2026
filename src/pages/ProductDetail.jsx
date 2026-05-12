import React from 'react';
import { useParams } from 'react-router-dom';
import ProductDetailPage from '../components/ProductDetailPage';

const ProductDetail = () => {
  const { categorySlug, productSlug, identifier } = useParams();
  // Generic /products/:identifier route uses the unified loader.
  // Legacy /:categorySlug/:productSlug routes stay slug-based for the
  // 25 PGifts Direct products (hard constraint: identical rendering).
  const id = identifier || productSlug;
  return <ProductDetailPage identifier={id} categorySlug={categorySlug} productSlug={productSlug} />;
};

export default ProductDetail;
