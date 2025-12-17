/**
 * Utility functions for product management and filtering
 */

/**
 * Check if a template file exists for a given product
 * @param {string} templatePath - The template path from the product config
 * @returns {Promise<boolean>} - Whether the template exists
 */
export const checkTemplateExists = async (templatePath) => {
  try {
    const response = await fetch(templatePath, { method: 'HEAD' });
    return response.ok;
  } catch (error) {
    console.warn(`Template check failed for ${templatePath}:`, error);
    return false;
  }
};

/**
 * Filter products configuration to only include products with existing templates
 * @param {Object} productsConfig - The full products configuration
 * @returns {Promise<Object>} - Filtered products configuration
 */
export const getAvailableProducts = async (productsConfig) => {
  const availableProducts = {};
  
  // Check each product's template availability
  const productChecks = await Promise.all(
    Object.entries(productsConfig).map(async ([key, product]) => {
      const templateExists = await checkTemplateExists(product.template);
      return { key, product, templateExists };
    })
  );
  
  // Filter to only include products with existing templates
  productChecks.forEach(({ key, product, templateExists }) => {
    if (templateExists) {
      availableProducts[key] = product;
    } else {
      console.warn(`Template not found for product ${key}: ${product.template}`);
    }
  });
  
  return availableProducts;
};

/**
 * Get a list of available product keys with existing templates
 * @param {Object} productsConfig - The full products configuration
 * @returns {Promise<string[]>} - Array of available product keys
 */
export const getAvailableProductKeys = async (productsConfig) => {
  const availableProducts = await getAvailableProducts(productsConfig);
  return Object.keys(availableProducts);
};

/**
 * Validate if a product has the required configuration
 * @param {Object} product - Product configuration object
 * @returns {boolean} - Whether the product is valid
 */
export const validateProductConfig = (product) => {
  if (!product) return false;
  
  const requiredFields = ['name', 'template', 'colors', 'basePrice'];
  const hasRequiredFields = requiredFields.every(field => product.hasOwnProperty(field));
  
  if (!hasRequiredFields) {
    console.warn('Product missing required fields:', product);
    return false;
  }
  
  // Check if printAreas exist and are valid
  if (!product.printAreas || Object.keys(product.printAreas).length === 0) {
    console.warn('Product has no print areas configured:', product);
    return false;
  }
  
  // Validate each print area
  const validPrintAreas = Object.values(product.printAreas).every(area => {
    return area.name && 
           typeof area.x === 'number' && 
           typeof area.y === 'number' && 
           typeof area.width === 'number' && 
           typeof area.height === 'number';
  });
  
  if (!validPrintAreas) {
    console.warn('Product has invalid print areas:', product);
    return false;
  }
  
  return true;
};

/**
 * Get products with validation
 * @param {Object} productsConfig - The full products configuration
 * @returns {Promise<Object>} - Validated and filtered products configuration
 */
export const getValidatedProducts = async (productsConfig) => {
  const availableProducts = await getAvailableProducts(productsConfig);
  const validatedProducts = {};
  
  Object.entries(availableProducts).forEach(([key, product]) => {
    if (validateProductConfig(product)) {
      validatedProducts[key] = product;
    }
  });
  
  return validatedProducts;
};
