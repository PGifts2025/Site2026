import React, { useRef, useEffect, Suspense, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Center } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import * as THREE from 'three';
import { X } from 'lucide-react';

const GLB_BASE_URL = 'https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/chi-cup/chi-cup.glb';

// Cache-busting: Generate fresh URL with timestamp on each call
const getGLBURL = () => `${GLB_BASE_URL}?v=${Date.now()}`;

// For backward compatibility
const GLB_URL = GLB_BASE_URL;

/*
 * CHI CUP UV LAYOUT (from Blender export - LabelBody.png)
 * ======================================================
 * 
 * Canvas: 1024 x 1024 pixels
 * 
 * Trapezoid body (main cup wrap area):
 * - Left edge: X ≈ 30
 * - Right edge: X ≈ 870  
 * - Top edge: Y ≈ 180 (cup rim - wider)
 * - Bottom edge: Y ≈ 1000 (cup base - narrower)
 * 
 * Circular element in top-right: rim/top detail (separate UV island)
 * 
 * MAPPING:
 * - Center of trapezoid (X ≈ 450) = FRONT of cup
 * - Left edge (X ≈ 30) connects to Right edge (X ≈ 870) = BACK of cup (seam)
 * 
 * For full wrap alignment:
 * - Design canvas matches UV layout exactly
 * - Front design placed at center
 * - Back design placed at edges
 */

const DEFAULT_CUP_COLOR = '#f5f5f0';
const DEFAULT_LID_COLOR = '#4a3728';
const LID_TOP_COLOR = '#6b5344';
const SILVER_COLOR = '#b0b0b0';
const INNER_CUP_COLOR = '#e8e8e0';

// UV Layout constants (from Blender - NEW FIXED MODEL)
// U range: 0.0000 to 1.0000 (full width, straight edges!)
// V range: 0.0011 to 0.9950
// 
// On 1024x1024 texture:
// - U maps directly to X: 0 to 1024
// - V maps to Y (V=0 is bottom, V=1 is top, canvas Y=0 is top)
const UV_SIZE = 1024;
const UV_BODY = {
  left: 0,        // U_min * 1024 = 0
  right: 1024,    // U_max * 1024 = 1024
  top: 5,         // (1 - V_max) * 1024 = (1 - 0.9950) * 1024 = 5
  bottom: 1023,   // (1 - V_min) * 1024 = (1 - 0.0011) * 1024 = 1023
  // Derived
  width: 1024,    // Full width!
  height: 1018,   // 1023 - 5
  centerX: 512,   // Center = front of cup
};

/**
 * Creates a UV-matched texture for the Chi Cup
 * 
 * Designer canvas (1024x600) maps to UV texture (1024x1024):
 * - X axis: 1:1 mapping (0-1024 → 0-1024)
 * - Y axis: Scale 600 → UV body height, positioned in body area
 * 
 * @param {string} designDataUrl - Base64 PNG of the design
 * @param {string} cupColorHex - Cup background color
 * @param {string} position - 'front', 'back', or 'fullwrap'
 */
function createUVMatchedTexture(designDataUrl, cupColorHex, position = 'fullwrap') {
  console.log('=== CREATE UV TEXTURE DEBUG ===');
  console.log('Received imageDataUrl length:', designDataUrl?.length);
  console.log('Position:', position);
  console.log('Cup color:', cupColorHex);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      console.log('╔════════════════════════════════════════════════════════════════╗');
      console.log('║ [3D PREVIEW] ChiCup3DPreview - Received Design Texture        ║');
      console.log('╠════════════════════════════════════════════════════════════════╣');
      console.log('[ChiCup3D] Loaded image NATURAL dimensions:', img.naturalWidth, 'x', img.naturalHeight);
      console.log('[ChiCup3D] Loaded image DISPLAY dimensions:', img.width, 'x', img.height);
      console.log('[ChiCup3D] Input design image:');
      console.log('  - Image width:', img.width);
      console.log('  - Image height:', img.height);

      console.log('[ChiCup3D] UV_BODY constants:');
      console.log('  - UV_SIZE:', UV_SIZE);
      console.log('  - UV_BODY.left:', UV_BODY.left);
      console.log('  - UV_BODY.right:', UV_BODY.right);
      console.log('  - UV_BODY.top:', UV_BODY.top);
      console.log('  - UV_BODY.bottom:', UV_BODY.bottom);
      console.log('  - UV_BODY.width:', UV_BODY.width);
      console.log('  - UV_BODY.height:', UV_BODY.height);
      console.log('  - UV_BODY.centerX:', UV_BODY.centerX);

      console.log('[ChiCup3D] Cup color:', cupColorHex);
      console.log('[ChiCup3D] Position mode:', position);

      // Create canvas matching UV layout size (1024x1024)
      const canvas = document.createElement('canvas');
      canvas.width = UV_SIZE;
      canvas.height = UV_SIZE;
      const ctx = canvas.getContext('2d');

      console.log('[ChiCup3D] Created UV texture canvas:', canvas.width, 'x', canvas.height);

      // Fill entire canvas with cup color
      ctx.fillStyle = cupColorHex;
      ctx.fillRect(0, 0, UV_SIZE, UV_SIZE);

      // Log incoming image vs UV body dimensions
      console.log('[ChiCup3D] Incoming image:', img.width, 'x', img.height);
      console.log('[ChiCup3D] UV body area:', UV_BODY.width, 'x', UV_BODY.height);
      console.log('[ChiCup3D] Scale factor:', (UV_BODY.width / img.width).toFixed(3));

      // For fullwrap position (cup products), scale incoming canvas to fill FULL UV body area
      if (position === 'fullwrap') {
        console.log('[ChiCup3D] Fullwrap mode - scaling to fill UV body');

        // Draw image directly without horizontal flip
        console.log('[ChiCup3D] About to drawImage:');
        console.log('  Source rect: sx=0, sy=0, sw=', img.width, ', sh=', img.height);
        console.log('  Dest rect: dx=0, dy=0, dw=1024, dh=1024');
        console.log('  Scale factor X:', (1024 / img.width).toFixed(3));
        console.log('  Scale factor Y:', (1024 / img.height).toFixed(3));

        // Draw the image to fill entire UV texture (no flip)
        ctx.drawImage(
          img,                    // Source image (from Designer canvas)
          0, 0, img.width, img.height,  // Source: entire image
          0, 0, 1024, 1024        // Destination: FILL entire 1024x1024 UV texture
        );

        console.log('[ChiCup3D] ✅ Scaled from', img.width, 'x', img.height, 'to 1024x1024');
        console.log('[ChiCup3D] ✅ No horizontal flip - design should match 2D canvas orientation');

        // DEBUG: Save UV texture canvas to see what it looks like
        const debugUvTextureUrl = canvas.toDataURL();
        console.log('[ChiCup3D] 🔍 UV texture debug URL created (length:', debugUvTextureUrl.length, ')');
        console.log('[ChiCup3D] 🔍 Check if design fills entire 1024x1024 canvas');
        // Save to window for inspection
        window.uvTextureDebug = debugUvTextureUrl;
        console.log('[ChiCup3D] 🔍 Saved to window.uvTextureDebug - paste in console to view');

        // Uncomment to auto-download for inspection:
        // const debugLink = document.createElement('a');
        // debugLink.download = 'uv-texture-debug.png';
        // debugLink.href = debugUvTextureUrl;
        // debugLink.click();

      } else {
        // Positioned mode: design at specific location
        const maxWidth = UV_BODY.width * 0.4;
        const maxHeight = UV_BODY.height * 0.8;
        
        const aspectRatio = img.width / img.height;
        let designWidth, designHeight;
        
        if (img.width / maxWidth > img.height / maxHeight) {
          designWidth = maxWidth;
          designHeight = maxWidth / aspectRatio;
        } else {
          designHeight = maxHeight;
          designWidth = maxHeight * aspectRatio;
        }
        
        let designX;
        if (position === 'front') {
          designX = UV_BODY.centerX - (designWidth / 2);
        } else if (position === 'back') {
          designX = UV_BODY.right - (designWidth / 2);
        } else {
          designX = UV_BODY.centerX - (designWidth / 2);
        }
        
        const designY = UV_BODY.top + (UV_BODY.height - designHeight) / 2;
        ctx.drawImage(img, designX, designY, designWidth, designHeight);
        
        console.log('[ChiCup3D] Positioned at:', designX, designY);
      }
      
      console.log('[ChiCup3D] ✅ UV texture created');
      resolve(canvas.toDataURL('image/png'));
    };
    
    img.onerror = (err) => {
      console.error('[ChiCup3D] Error loading design:', err);
      reject(err);
    };
    
    img.src = designDataUrl;
  });
}

function CupModel({ designTexture, cupColor = DEFAULT_CUP_COLOR, lidColor = DEFAULT_LID_COLOR }) {
  const groupRef = useRef();
  const [meshData, setMeshData] = useState(null);
  const loadedRef = useRef(false);
  const [labelMesh, setLabelMesh] = useState(null);  // CRITICAL: Use state instead of ref to trigger re-render
  const materialRefs = useRef({});

  // Slow rotation
  useFrame((state, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.3;
    }
  });

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    console.log('[ChiCup3D] Loading Chi Cup model...');

    const glbUrl = getGLBURL();
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║ LOADING 3D MODEL                                              ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log('Loading GLB from:', glbUrl);
    console.log('Cache-busting timestamp:', new Date(parseInt(glbUrl.split('v=')[1])).toISOString());
    console.log('╚════════════════════════════════════════════════════════════════╝');

    const loader = new GLTFLoader();
    loader.load(
      glbUrl,
      (gltf) => {
        console.log('[ChiCup3D] ✅ GLB loaded successfully');
        gltf.scene.updateMatrixWorld(true);

        const meshes = [];

        gltf.scene.traverse((child) => {
          if (child.isMesh) {
            const name = child.name || 'unnamed';
            
            const geometry = child.geometry.clone();
            geometry.applyMatrix4(child.matrixWorld);

            if (geometry.attributes.color) {
              geometry.deleteAttribute('color');
            }

            let config = { color: '#cccccc', isLabelBody: false };

            switch (name) {
              case 'LabelBody':
                config = { color: cupColor, isLabelBody: true };
                console.log('[ChiCup3D] LabelBody -> Cup color:', cupColor);

                // DIAGNOSTIC: Show actual UV coordinates of LabelBody mesh
                if (geometry.attributes.uv) {
                  const uvAttribute = geometry.attributes.uv;
                  let minU = Infinity, maxU = -Infinity;
                  let minV = Infinity, maxV = -Infinity;

                  for (let i = 0; i < uvAttribute.count; i++) {
                    const u = uvAttribute.getX(i);
                    const v = uvAttribute.getY(i);
                    minU = Math.min(minU, u);
                    maxU = Math.max(maxU, u);
                    minV = Math.min(minV, v);
                    maxV = Math.max(maxV, v);
                  }

                  console.log('╔════════════════════════════════════════════════════════════════╗');
                  console.log('║ LABELBODY UV COORDINATES (from 3D model)                      ║');
                  console.log('╠════════════════════════════════════════════════════════════════╣');
                  console.log('U range:', minU.toFixed(4), 'to', maxU.toFixed(4));
                  console.log('V range:', minV.toFixed(4), 'to', maxV.toFixed(4));
                  console.log('U width:', (maxU - minU).toFixed(4), '(0.0000 = 0%, 1.0000 = 100%)');
                  console.log('V height:', (maxV - minV).toFixed(4), '(0.0000 = 0%, 1.0000 = 100%)');
                  console.log('');
                  console.log('On 1024x1024 texture:');
                  console.log('  X range:', (minU * 1024).toFixed(1), 'to', (maxU * 1024).toFixed(1), 'pixels');
                  console.log('  Y range:', (minV * 1024).toFixed(1), 'to', (maxV * 1024).toFixed(1), 'pixels');
                  console.log('  Width:', ((maxU - minU) * 1024).toFixed(1), 'pixels');
                  console.log('  Height:', ((maxV - minV) * 1024).toFixed(1), 'pixels');
                  console.log('╚════════════════════════════════════════════════════════════════╝');
                }
                break;
              case 'CupBody':
                config = { color: INNER_CUP_COLOR, isLabelBody: false };
                break;
              case 'Lid':
                config = { color: lidColor, isLabelBody: false };
                break;
              case 'LidTop':
                config = { color: LID_TOP_COLOR, isLabelBody: false };
                break;
              case 'SilverBody':
                config = { color: SILVER_COLOR, isLabelBody: false };
                break;
            }

            meshes.push({ name, geometry, ...config });
          }
        });

        setMeshData(meshes);
      },
      undefined,
      (error) => console.error('[ChiCup3D] Error:', error)
    );
  }, [cupColor, lidColor]);

  // Apply design texture - TEXTURE EFFECT
  useEffect(() => {
    console.log('[ChiCup3D] --- TEXTURE EFFECT ---');
    console.log('[ChiCup3D] designTexture:', designTexture ? 'YES' : 'NO');
    console.log('[ChiCup3D] labelMesh state:', labelMesh ? 'EXISTS' : 'NULL');

    if (!designTexture || !labelMesh) {
      console.log('[ChiCup3D] Waiting for labelMesh or designTexture...');
      return;
    }
    console.log('[ChiCup3D] Found LabelBody, creating UV texture...');

    // Load the design image and create a properly scaled UV texture
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      console.log('[ChiCup3D] Loaded design image:', img.width, 'x', img.height);

      // Create a 1024x1024 canvas for the UV texture
      const uvCanvas = document.createElement('canvas');
      uvCanvas.width = 1024;
      uvCanvas.height = 1024;
      const ctx = uvCanvas.getContext('2d');

      // Fill with cup background color first
      ctx.fillStyle = cupColor || '#f5f5f0';
      ctx.fillRect(0, 0, 1024, 1024);

      // Draw the design image SCALED to fill the entire 1024x1024 canvas
      // No horizontal flip - design matches 2D canvas orientation
      ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, 1024, 1024);

      console.log('[ChiCup3D] UV canvas created: 1024x1024, design scaled from', img.width, 'x', img.height);

      // Save debug texture
      window.uvTextureDebug = uvCanvas.toDataURL();
      console.log('[ChiCup3D] UV texture saved to window.uvTextureDebug');

      // Create Three.js texture from our canvas
      const texture = new THREE.CanvasTexture(uvCanvas);
      texture.flipY = false;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;

      labelMesh.material.map = texture;
      labelMesh.material.color.set('#ffffff');
      labelMesh.material.needsUpdate = true;

      console.log('[ChiCup3D] ✓✓✓ UV TEXTURE APPLIED TO LABELBODY ✓✓✓');
    };
    img.onerror = (error) => {
      console.error('[ChiCup3D] Failed to load design image:', error);
    };
    img.src = designTexture;
  }, [designTexture, labelMesh, cupColor]);  // CRITICAL: labelMesh triggers re-run when mesh loads

  // Update colors dynamically
  useEffect(() => {
    if (!meshData) return;
    
    Object.entries(materialRefs.current).forEach(([name, material]) => {
      if (name === 'LabelBody' && !material.map) {
        material.color.set(cupColor);
      } else if (name === 'Lid') {
        material.color.set(lidColor);
      } else if (name === 'LidTop') {
        material.color.set(LID_TOP_COLOR);
      }
      material.needsUpdate = true;
    });
  }, [cupColor, lidColor, meshData]);

  if (!meshData) {
    return (
      <mesh>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshBasicMaterial color="#999" wireframe />
      </mesh>
    );
  }

  return (
    <group ref={groupRef} scale={15} position={[0, -0.5, 0]}>
      {meshData.map((mesh, index) => (
        <mesh
          key={mesh.name + index}
          geometry={mesh.geometry}
          ref={(ref) => {
            // CRITICAL: Set labelMesh state (not ref) to trigger texture useEffect
            if (mesh.isLabelBody && ref && !labelMesh) {
              console.log('[ChiCup3D] LabelBody mesh mounted, setting state');
              setLabelMesh(ref);
            }
          }}
        >
          <meshBasicMaterial
            ref={(ref) => {
              if (ref) materialRefs.current[mesh.name] = ref;
            }}
            color={mesh.color}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color='#cccccc' wireframe />
    </mesh>
  );
}

export default function ChiCup3DPreview({ 
  designTexture, 
  cupColor = DEFAULT_CUP_COLOR,
  lidColor = DEFAULT_LID_COLOR,
  onClose 
}) {
  return (
    <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
      <div className='bg-white rounded-xl shadow-2xl w-full max-w-2xl h-[600px] overflow-hidden relative'>
        <div className='flex items-center justify-between p-4 border-b'>
          <h3 className='text-lg font-semibold text-gray-800'>3D Preview - Chi Cup</h3>
          <button
            onClick={onClose}
            className='p-2 rounded-full hover:bg-gray-100 transition-colors'
          >
            <X className='w-5 h-5' />
          </button>
        </div>

        <Canvas 
          camera={{ position: [0, 0.3, 4], fov: 45 }} 
          className='bg-gradient-to-b from-gray-100 to-gray-300'
          style={{ width: '100%', height: '100%' }}
          gl={{ 
            antialias: true, 
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance'
          }}
          dpr={[1, 2]}
        >
          <Suspense fallback={<LoadingFallback />}>
            <Center>
              <CupModel 
                designTexture={designTexture}
                cupColor={cupColor}
                lidColor={lidColor}
              />
            </Center>
            <OrbitControls 
              enablePan={false} 
              enableZoom={true} 
              minDistance={2} 
              maxDistance={15} 
            />
          </Suspense>
        </Canvas>

        <div className='absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-gray-500 bg-white/90 px-4 py-2 rounded-full shadow'>
          Drag to rotate • Scroll to zoom
        </div>
      </div>
    </div>
  );
}

export { DEFAULT_CUP_COLOR, DEFAULT_LID_COLOR, LID_TOP_COLOR, UV_BODY, UV_SIZE };