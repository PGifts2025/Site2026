
import React, { useState, useRef, useEffect } from 'react';
import * as fabric from 'fabric';
import { jsPDF } from 'jspdf';
import { createClient } from '@supabase/supabase-js';
import { supabaseConfig, isMockAuth } from '../config/supabase';
import { createMockSupabase } from '../utils/mockAuth';
import { 
  Upload, 
  Download, 
  RotateCcw, 
  RotateCw, 
  Trash2, 
  Move, 
  Square, 
  Circle, 
  Type, 
  Palette,
  User,
  LogIn,
  LogOut,
  Eye,
  EyeOff,
  Save,
  FileImage,
  FileText
} from 'lucide-react';

// Initialize Supabase or mock auth
const supabase = isMockAuth 
  ? createMockSupabase() 
  : createClient(supabaseConfig.url, supabaseConfig.anonKey);

const Designer = () => {
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const [canvas, setCanvas] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState('tshirt');
  const [selectedColor, setSelectedColor] = useState('#ffffff');
  const [printArea, setPrintArea] = useState('full');
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [watermarkVisible, setWatermarkVisible] = useState(true);

  // Product configurations
  const products = {
    tshirt: {
      name: 'T-Shirt',
      image: '/api/placeholder/400/400',
      printAreas: {
        'left-breast': { x: 50, y: 80, width: 80, height: 80, name: 'Left Breast' },
        'right-breast': { x: 270, y: 80, width: 80, height: 80, name: 'Right Breast' },
        'full': { x: 50, y: 120, width: 300, height: 200, name: 'Full Size' }
      },
      colors: ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff']
    },
    pen: {
      name: 'Pen',
      image: '/api/placeholder/300/100',
      printAreas: {
        'barrel': { x: 50, y: 40, width: 200, height: 20, name: 'Barrel' }
      },
      colors: ['#000000', '#0000ff', '#ff0000', '#ffffff']
    },
    bag: {
      name: 'Bag',
      image: '/api/placeholder/350/350',
      printAreas: {
        'front': { x: 75, y: 100, width: 200, height: 150, name: 'Front Panel' }
      },
      colors: ['#000000', '#8B4513', '#ffffff', '#ff0000', '#0000ff']
    },
    magnet: {
      name: 'Magnet',
      image: '/api/placeholder/200/200',
      printAreas: {
        'full': { x: 25, y: 25, width: 150, height: 150, name: 'Full Surface' }
      },
      colors: ['#ffffff', '#000000', '#ff0000', '#0000ff']
    },
    notebook: {
      name: 'Notebook',
      image: '/api/placeholder/300/400',
      printAreas: {
        'cover': { x: 50, y: 50, width: 200, height: 100, name: 'Cover' }
      },
      colors: ['#000000', '#8B4513', '#0000ff', '#ff0000']
    },
    chicup: {
      name: 'Chi Cup',
      image: '/api/placeholder/250/300',
      printAreas: {
        'wrap': { x: 50, y: 100, width: 150, height: 100, name: 'Wrap Around' }
      },
      colors: ['#ffffff', '#000000', '#ff0000', '#0000ff']
    },
    waterbottle: {
      name: 'Water Bottle',
      image: '/api/placeholder/200/400',
      printAreas: {
        'label': { x: 50, y: 150, width: 100, height: 100, name: 'Label Area' }
      },
      colors: ['#ffffff', '#000000', '#0000ff', '#ff0000', '#00ff00']
    },
    cable: {
      name: 'Xoopar Charging Cable',
      image: '/api/placeholder/300/150',
      printAreas: {
        'connector': { x: 100, y: 50, width: 100, height: 50, name: 'Connector' }
      },
      colors: ['#000000', '#ffffff', '#ff0000', '#0000ff']
    }
  };

  // Initialize canvas
  useEffect(() => {
    if (canvasRef.current && !canvas) {
      const fabricCanvas = new fabric.Canvas(canvasRef.current, {
        width: 800,
        height: 600,
        backgroundColor: '#f8f9fa'
      });

      // Add watermark
      if (watermarkVisible && !user) {
        addWatermark(fabricCanvas);
      }

      setCanvas(fabricCanvas);

      return () => {
        fabricCanvas.dispose();
      };
    }
  }, []);

  // Check authentication state
  useEffect(() => {
    // Handle both real Supabase and mock auth systems
    const authResponse = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
      if (session?.user && canvas) {
        removeWatermark();
      } else if (!session?.user && canvas) {
        addWatermark(canvas);
      }
    });

    // Extract subscription - handle both formats
    const subscription = authResponse?.data?.subscription || authResponse;

    return () => {
      if (subscription && typeof subscription.unsubscribe === 'function') {
        subscription.unsubscribe();
      }
    };
  }, [canvas]);

  // Add watermark to canvas
  const addWatermark = (fabricCanvas) => {
    const watermark = new fabric.Text('PROMO GIFTS - SIGN IN TO REMOVE WATERMARK', {
      left: 400,
      top: 300,
      fontSize: 24,
      fill: 'rgba(255, 0, 0, 0.3)',
      angle: -45,
      selectable: false,
      evented: false,
      id: 'watermark'
    });
    fabricCanvas.add(watermark);
    fabricCanvas.renderAll();
  };

  // Remove watermark from canvas
  const removeWatermark = () => {
    if (canvas) {
      const objects = canvas.getObjects();
      const watermark = objects.find(obj => obj.id === 'watermark');
      if (watermark) {
        canvas.remove(watermark);
        canvas.renderAll();
      }
    }
  };

  // Authentication functions
  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password
        });
        if (error) throw error;
        if (!isMockAuth) {
          alert('Check your email for verification link!');
        }
      }
      setShowAuth(false);
      setEmail('');
      setPassword('');
    } catch (error) {
      alert(error.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // File upload handler
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const imgUrl = event.target.result;
      
      if (file.type.includes('svg')) {
        fabric.loadSVGFromString(imgUrl).then((result) => {
          const obj = fabric.util.groupSVGElements(result.objects, result.options);
          obj.set({
            left: 100,
            top: 100,
            scaleX: 0.5,
            scaleY: 0.5
          });
          canvas.add(obj);
          canvas.renderAll();
        }).catch((error) => {
          console.error('Error loading SVG:', error);
        });
      } else {
        fabric.Image.fromURL(imgUrl).then((img) => {
          img.set({
            left: 100,
            top: 100,
            scaleX: 0.5,
            scaleY: 0.5
          });
          canvas.add(img);
          canvas.renderAll();
        }).catch((error) => {
          console.error('Error loading image:', error);
        });
      }
    };

    if (file.type.includes('svg')) {
      reader.readAsText(file);
    } else {
      reader.readAsDataURL(file);
    }
  };

  // Add text
  const addText = () => {
    const text = new fabric.Text('Your Text Here', {
      left: 100,
      top: 100,
      fontSize: 24,
      fill: '#000000'
    });
    canvas.add(text);
    canvas.renderAll();
  };

  // Add shapes
  const addShape = (type) => {
    let shape;
    if (type === 'rectangle') {
      shape = new fabric.Rect({
        left: 100,
        top: 100,
        width: 100,
        height: 100,
        fill: '#ff0000'
      });
    } else if (type === 'circle') {
      shape = new fabric.Circle({
        left: 100,
        top: 100,
        radius: 50,
        fill: '#00ff00'
      });
    }
    canvas.add(shape);
    canvas.renderAll();
  };

  // Delete selected object
  const deleteSelected = () => {
    const activeObject = canvas.getActiveObject();
    if (activeObject) {
      canvas.remove(activeObject);
      canvas.renderAll();
    }
  };

  // Rotate selected object
  const rotateSelected = (direction) => {
    const activeObject = canvas.getActiveObject();
    if (activeObject) {
      const currentAngle = activeObject.angle || 0;
      activeObject.rotate(currentAngle + (direction === 'left' ? -15 : 15));
      canvas.renderAll();
    }
  };

  // Download as JPEG
  const downloadJPEG = () => {
    if (!user) {
      alert('Please sign in to download without watermark');
      return;
    }

    const dataURL = canvas.toDataURL({
      format: 'jpeg',
      quality: 0.9
    });
    
    const link = document.createElement('a');
    link.download = `design-${selectedProduct}-${Date.now()}.jpg`;
    link.href = dataURL;
    link.click();
  };

  // Download as PDF
  const downloadPDF = () => {
    if (!user) {
      alert('Please sign in to download without watermark');
      return;
    }

    const pdf = new jsPDF();
    const imgData = canvas.toDataURL('image/jpeg', 0.9);
    
    pdf.addImage(imgData, 'JPEG', 10, 10, 190, 142);
    pdf.save(`design-${selectedProduct}-${Date.now()}.pdf`);
  };

  // Update print area overlay
  const updatePrintArea = () => {
    if (!canvas) return;

    // Remove existing print area guides
    const objects = canvas.getObjects();
    objects.forEach(obj => {
      if (obj.id === 'print-area-guide') {
        canvas.remove(obj);
      }
    });

    // Add new print area guide
    const area = products[selectedProduct].printAreas[printArea];
    if (area) {
      const guide = new fabric.Rect({
        left: area.x,
        top: area.y,
        width: area.width,
        height: area.height,
        fill: 'transparent',
        stroke: '#ff0000',
        strokeWidth: 2,
        strokeDashArray: [5, 5],
        selectable: false,
        evented: false,
        id: 'print-area-guide'
      });
      canvas.add(guide);
      canvas.sendObjectToBack(guide);
      canvas.renderAll();
    }
  };

  useEffect(() => {
    updatePrintArea();
  }, [selectedProduct, printArea, canvas]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <div className="bg-red-500 text-white rounded-full w-10 h-10 flex items-center justify-center font-bold text-lg mr-3">
                PG
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Promo Gifts</h1>
                <p className="text-sm text-red-600 font-semibold">Design Tool</p>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              {user ? (
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">Welcome, {user.email}</span>
                  <button
                    onClick={handleLogout}
                    className="flex items-center space-x-1 text-red-600 hover:text-red-700"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Logout</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAuth(true)}
                  className="flex items-center space-x-1 bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
                >
                  <LogIn className="h-4 w-4" />
                  <span>Sign In</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Left Sidebar - Product Selection */}
          <div className="col-span-3 bg-white rounded-lg shadow p-4">
            <h3 className="font-bold text-lg mb-4">Select Product</h3>
            <div className="space-y-2">
              {Object.entries(products).map(([key, product]) => (
                <button
                  key={key}
                  onClick={() => setSelectedProduct(key)}
                  className={`w-full text-left p-3 rounded border ${
                    selectedProduct === key
                      ? 'border-red-500 bg-red-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {product.name}
                </button>
              ))}
            </div>

            {/* Color Selection */}
            <div className="mt-6">
              <h4 className="font-semibold mb-3">Product Color</h4>
              <div className="grid grid-cols-4 gap-2">
                {products[selectedProduct].colors.map((color) => (
                  <button
                    key={color}
                    onClick={() => setSelectedColor(color)}
                    className={`w-8 h-8 rounded border-2 ${
                      selectedColor === color ? 'border-gray-800' : 'border-gray-300'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            {/* Print Area Selection */}
            <div className="mt-6">
              <h4 className="font-semibold mb-3">Print Area</h4>
              <div className="space-y-2">
                {Object.entries(products[selectedProduct].printAreas).map(([key, area]) => (
                  <button
                    key={key}
                    onClick={() => setPrintArea(key)}
                    className={`w-full text-left p-2 rounded text-sm ${
                      printArea === key
                        ? 'bg-red-500 text-white'
                        : 'bg-gray-100 hover:bg-gray-200'
                    }`}
                  >
                    {area.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Center - Canvas */}
          <div className="col-span-6 bg-white rounded-lg shadow p-4">
            <div className="mb-4 flex justify-between items-center">
              <h3 className="font-bold text-lg">Design Canvas</h3>
              <div className="flex items-center space-x-2">
                {!user && (
                  <div className="flex items-center space-x-1 text-sm text-red-600">
                    <EyeOff className="h-4 w-4" />
                    <span>Watermarked Preview</span>
                  </div>
                )}
              </div>
            </div>
            
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4">
              <canvas ref={canvasRef} className="border border-gray-200 rounded" />
            </div>

            {/* Canvas Controls */}
            <div className="mt-4 flex justify-center space-x-2">
              <button
                onClick={() => rotateSelected('left')}
                className="p-2 bg-gray-100 rounded hover:bg-gray-200"
                title="Rotate Left"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                onClick={() => rotateSelected('right')}
                className="p-2 bg-gray-100 rounded hover:bg-gray-200"
                title="Rotate Right"
              >
                <RotateCw className="h-4 w-4" />
              </button>
              <button
                onClick={deleteSelected}
                className="p-2 bg-red-100 text-red-600 rounded hover:bg-red-200"
                title="Delete Selected"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Right Sidebar - Tools */}
          <div className="col-span-3 bg-white rounded-lg shadow p-4">
            <h3 className="font-bold text-lg mb-4">Design Tools</h3>
            
            {/* File Upload */}
            <div className="mb-6">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center space-x-2 p-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400"
              >
                <Upload className="h-5 w-5" />
                <span>Upload Design</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.svg,.pdf,.ai"
                onChange={handleFileUpload}
                className="hidden"
              />
              <p className="text-xs text-gray-500 mt-1">
                Supports: PNG, JPEG, SVG, PDF, AI, Corel Draw
              </p>
            </div>

            {/* Add Elements */}
            <div className="mb-6">
              <h4 className="font-semibold mb-3">Add Elements</h4>
              <div className="space-y-2">
                <button
                  onClick={addText}
                  className="w-full flex items-center space-x-2 p-2 bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                >
                  <Type className="h-4 w-4" />
                  <span>Add Text</span>
                </button>
                <button
                  onClick={() => addShape('rectangle')}
                  className="w-full flex items-center space-x-2 p-2 bg-green-50 text-green-700 rounded hover:bg-green-100"
                >
                  <Square className="h-4 w-4" />
                  <span>Add Rectangle</span>
                </button>
                <button
                  onClick={() => addShape('circle')}
                  className="w-full flex items-center space-x-2 p-2 bg-purple-50 text-purple-700 rounded hover:bg-purple-100"
                >
                  <Circle className="h-4 w-4" />
                  <span>Add Circle</span>
                </button>
              </div>
            </div>

            {/* Download Options */}
            <div className="mb-6">
              <h4 className="font-semibold mb-3">Download</h4>
              <div className="space-y-2">
                <button
                  onClick={downloadJPEG}
                  className="w-full flex items-center space-x-2 p-2 bg-orange-50 text-orange-700 rounded hover:bg-orange-100"
                >
                  <FileImage className="h-4 w-4" />
                  <span>Download JPEG</span>
                </button>
                <button
                  onClick={downloadPDF}
                  className="w-full flex items-center space-x-2 p-2 bg-red-50 text-red-700 rounded hover:bg-red-100"
                >
                  <FileText className="h-4 w-4" />
                  <span>Download PDF</span>
                </button>
              </div>
              {!user && (
                <p className="text-xs text-red-500 mt-2">
                  Sign in to download without watermark
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Authentication Modal */}
      {showAuth && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="text-xl font-bold mb-4">
              {authMode === 'login' ? 'Sign In' : 'Sign Up'}
            </h3>
            
            <form onSubmit={handleAuth} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded"
                  required
                />
              </div>
              
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-red-500 text-white p-2 rounded hover:bg-red-600 disabled:opacity-50"
              >
                {loading ? 'Loading...' : (authMode === 'login' ? 'Sign In' : 'Sign Up')}
              </button>
            </form>
            
            <div className="mt-4 text-center">
              <button
                onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
                className="text-blue-600 hover:text-blue-700 text-sm"
              >
                {authMode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>
            </div>
            
            <button
              onClick={() => setShowAuth(false)}
              className="mt-4 w-full text-gray-600 hover:text-gray-700 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Designer;
