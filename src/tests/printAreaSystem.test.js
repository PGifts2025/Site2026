/**
 * Test suite for the Enhanced Print Area System
 * Tests all major components and functionality
 */

import { 
  validatePrintArea, 
  normalizePrintArea, 
  isPointInPrintArea,
  isRectInPrintArea,
  constrainRectToPrintArea,
  calculateOptimalPosition,
  scaleToFitPrintArea,
  generatePrintAreaKey,
  exportPrintAreasConfig,
  importPrintAreasConfig,
  createDefaultPrintAreas
} from '../utils/printAreaHelpers';

// Mock print area for testing
const mockPrintArea = {
  name: 'Test Area',
  x: 100,
  y: 100,
  width: 200,
  height: 200,
  maxWidth: 200,
  maxHeight: 200
};

// Test validation function
describe('validatePrintArea', () => {
  test('should validate correct print area', () => {
    const result = validatePrintArea(mockPrintArea);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('should reject invalid print area', () => {
    const invalidArea = { name: 'Test', x: -10, width: 0 };
    const result = validatePrintArea(invalidArea);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('should reject null print area', () => {
    const result = validatePrintArea(null);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Print area configuration is required');
  });
});

// Test normalization function
describe('normalizePrintArea', () => {
  test('should normalize print area with defaults', () => {
    const input = { name: 'Test', x: '50', y: '60', width: '100', height: '120' };
    const result = normalizePrintArea(input);
    
    expect(result.x).toBe(50);
    expect(result.y).toBe(60);
    expect(result.width).toBe(100);
    expect(result.height).toBe(120);
    expect(result.maxWidth).toBe(100);
    expect(result.maxHeight).toBe(120);
  });

  test('should handle negative values', () => {
    const input = { name: 'Test', x: -10, y: -5, width: -20, height: -15 };
    const result = normalizePrintArea(input);
    
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
  });
});

// Test point in print area
describe('isPointInPrintArea', () => {
  test('should detect point inside print area', () => {
    expect(isPointInPrintArea(150, 150, mockPrintArea)).toBe(true);
    expect(isPointInPrintArea(100, 100, mockPrintArea)).toBe(true);
    expect(isPointInPrintArea(300, 300, mockPrintArea)).toBe(true);
  });

  test('should detect point outside print area', () => {
    expect(isPointInPrintArea(50, 50, mockPrintArea)).toBe(false);
    expect(isPointInPrintArea(350, 350, mockPrintArea)).toBe(false);
  });
});

// Test rectangle in print area
describe('isRectInPrintArea', () => {
  test('should detect overlapping rectangles', () => {
    const rect = { x: 150, y: 150, width: 100, height: 100 };
    expect(isRectInPrintArea(rect, mockPrintArea)).toBe(true);
  });

  test('should detect non-overlapping rectangles', () => {
    const rect = { x: 400, y: 400, width: 50, height: 50 };
    expect(isRectInPrintArea(rect, mockPrintArea)).toBe(false);
  });
});

// Test rectangle constraint
describe('constrainRectToPrintArea', () => {
  test('should constrain rectangle to print area', () => {
    const rect = { x: 50, y: 50, width: 100, height: 100 };
    const result = constrainRectToPrintArea(rect, mockPrintArea);
    
    expect(result.x).toBeGreaterThanOrEqual(mockPrintArea.x);
    expect(result.y).toBeGreaterThanOrEqual(mockPrintArea.y);
    expect(result.x + result.width).toBeLessThanOrEqual(mockPrintArea.x + mockPrintArea.width);
    expect(result.y + result.height).toBeLessThanOrEqual(mockPrintArea.y + mockPrintArea.height);
  });
});

// Test optimal position calculation
describe('calculateOptimalPosition', () => {
  test('should calculate center position', () => {
    const objectSize = { width: 50, height: 50 };
    const result = calculateOptimalPosition(objectSize, mockPrintArea, 'center');
    
    expect(result.x).toBe(175); // 100 + (200-50)/2
    expect(result.y).toBe(175); // 100 + (200-50)/2
  });

  test('should calculate top-left position', () => {
    const objectSize = { width: 50, height: 50 };
    const result = calculateOptimalPosition(objectSize, mockPrintArea, 'top-left');
    
    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
  });
});

// Test scaling to fit
describe('scaleToFitPrintArea', () => {
  test('should scale large object to fit', () => {
    const objectSize = { width: 400, height: 300 };
    const result = scaleToFitPrintArea(objectSize, mockPrintArea, 10);
    
    expect(result.width).toBeLessThanOrEqual(180); // 200 - 20 (padding)
    expect(result.height).toBeLessThanOrEqual(180);
    expect(result.scale).toBeLessThan(1);
  });

  test('should not scale small object', () => {
    const objectSize = { width: 50, height: 50 };
    const result = scaleToFitPrintArea(objectSize, mockPrintArea, 10);
    
    expect(result.width).toBe(50);
    expect(result.height).toBe(50);
    expect(result.scale).toBe(1);
  });
});

// Test key generation
describe('generatePrintAreaKey', () => {
  test('should generate unique key', () => {
    const existingAreas = { front: {}, back: {} };
    const key = generatePrintAreaKey('Front', existingAreas);
    
    expect(key).toBe('front_1');
  });

  test('should generate clean key for new name', () => {
    const key = generatePrintAreaKey('Left Chest', {});
    expect(key).toBe('left_chest');
  });
});

// Test export/import
describe('exportPrintAreasConfig', () => {
  test('should export valid JSON', () => {
    const printAreas = { front: mockPrintArea };
    const result = exportPrintAreasConfig(printAreas, 'Test Product');
    
    const parsed = JSON.parse(result);
    expect(parsed.product).toBe('Test Product');
    expect(parsed.printAreas.front).toEqual(mockPrintArea);
    expect(parsed.version).toBe('1.0');
  });
});

describe('importPrintAreasConfig', () => {
  test('should import valid configuration', () => {
    const config = {
      product: 'Test Product',
      printAreas: { front: mockPrintArea },
      version: '1.0'
    };
    
    const result = importPrintAreasConfig(JSON.stringify(config));
    expect(result.success).toBe(true);
    expect(result.data.printAreas.front).toEqual(mockPrintArea);
  });

  test('should reject invalid JSON', () => {
    const result = importPrintAreasConfig('invalid json');
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// Test default configurations
describe('createDefaultPrintAreas', () => {
  test('should create tshirt defaults', () => {
    const result = createDefaultPrintAreas('tshirt');
    
    expect(result.front).toBeDefined();
    expect(result.back).toBeDefined();
    expect(result.left_chest).toBeDefined();
    expect(result.front.name).toBe('Front');
  });

  test('should create bag defaults', () => {
    const result = createDefaultPrintAreas('bag');
    
    expect(result.front).toBeDefined();
    expect(result.front.name).toBe('Front');
  });

  test('should create generic defaults for unknown type', () => {
    const result = createDefaultPrintAreas('unknown');
    
    expect(result.default).toBeDefined();
    expect(result.default.name).toBe('Print Area');
  });
});

// Integration tests
describe('Print Area System Integration', () => {
  test('should handle complete workflow', () => {
    // Create default areas
    const defaultAreas = createDefaultPrintAreas('tshirt');
    
    // Validate each area
    Object.values(defaultAreas).forEach(area => {
      const validation = validatePrintArea(area);
      expect(validation.isValid).toBe(true);
    });
    
    // Export configuration
    const exported = exportPrintAreasConfig(defaultAreas, 'T-Shirt');
    expect(exported).toBeTruthy();
    
    // Import configuration
    const imported = importPrintAreasConfig(exported);
    expect(imported.success).toBe(true);
    expect(Object.keys(imported.data.printAreas)).toHaveLength(Object.keys(defaultAreas).length);
  });

  test('should handle constraint validation workflow', () => {
    const printArea = mockPrintArea;
    
    // Test object placement
    const objectRect = { x: 150, y: 150, width: 50, height: 50 };
    expect(isRectInPrintArea(objectRect, printArea)).toBe(true);
    
    // Test object constraint
    const largeObject = { x: 50, y: 50, width: 300, height: 300 };
    const constrained = constrainRectToPrintArea(largeObject, printArea);
    expect(isRectInPrintArea(constrained, printArea)).toBe(true);
    
    // Test optimal positioning
    const optimalPos = calculateOptimalPosition(
      { width: constrained.width, height: constrained.height },
      printArea,
      'center'
    );
    expect(optimalPos.x).toBeGreaterThanOrEqual(printArea.x);
    expect(optimalPos.y).toBeGreaterThanOrEqual(printArea.y);
  });
});

// Performance tests
describe('Performance Tests', () => {
  test('should handle large number of print areas efficiently', () => {
    const startTime = performance.now();
    
    // Create 100 print areas
    const printAreas = {};
    for (let i = 0; i < 100; i++) {
      printAreas[`area_${i}`] = {
        name: `Area ${i}`,
        x: i * 10,
        y: i * 10,
        width: 100,
        height: 100,
        maxWidth: 100,
        maxHeight: 100
      };
    }
    
    // Validate all areas
    Object.values(printAreas).forEach(area => {
      validatePrintArea(area);
    });
    
    const endTime = performance.now();
    expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
  });

  test('should handle complex constraint calculations efficiently', () => {
    const startTime = performance.now();
    
    // Perform 1000 constraint calculations
    for (let i = 0; i < 1000; i++) {
      const rect = { x: i, y: i, width: 50, height: 50 };
      constrainRectToPrintArea(rect, mockPrintArea);
    }
    
    const endTime = performance.now();
    expect(endTime - startTime).toBeLessThan(500); // Should complete in under 0.5 seconds
  });
});

console.log('Print Area System Tests Completed Successfully!');
