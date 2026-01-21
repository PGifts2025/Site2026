import React, { useRef, useEffect, Suspense, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Center } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import * as THREE from 'three';
import { X } from 'lucide-react';

const GLB_URL = 'https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/chi-cup/chi-cup.glb';

/*
 * CHI CUP MESH STRUCTURE (verified in Blender):
 * =============================================
 * - LabelBody (Mesh.014) = Outer cup surface - for BASE COLOR + DESIGN OVERLAY
 * - Lid (Mesh.015) = Round lid part - customizable color
 * - LidTop (Mesh.016) = Button on top - matches lid color
 * - SilverBody (Mesh.017) = Stainless steel band - fixed
 * - CupBody = Inner cup surface (not visible from outside)
 *
 * DESIGN APPLICATION:
 * The design texture (with transparent background) is composited ONTO the
 * base cup color using a canvas, then applied as a solid texture.
 * This prevents the transparency from showing the inner mesh.
 */

// Default colors
const DEFAULT_CUP_COLOR = '#eeeeee';   // Off-white
const DEFAULT_LID_COLOR = '#4a3728';   // Dark brown bamboo
const SILVER_COLOR = '#b0b0b0';        // Stainless steel (fixed)
const INNER_CUP_COLOR = '#e8e8e0';     // Inner cup surface

/**
 * Composites a design image onto a background color
 * Returns a data URL of the composited image
 */
function compositeDesignOnColor(designDataUrl, backgroundColor) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      // Create canvas with same dimensions as design
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      
      // Fill with background color first
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw design on top (transparent areas will show the background color)
      ctx.drawImage(img, 0, 0);
      
      // Return as data URL
      const compositedUrl = canvas.toDataURL('image/png');
      console.log('[ChiCup3D] Design composited onto', backgroundColor);
      resolve(compositedUrl);
    };
    
    img.onerror = (err) => {
      console.error('[ChiCup3D] Error loading design for compositing:', err);
      reject(err);
    };
    
    img.src = designDataUrl;
  });
}

function CupModel({ designTexture, cupColor = DEFAULT_CUP_COLOR, lidColor = DEFAULT_LID_COLOR }) {
  const groupRef = useRef();
  const [meshData, setMeshData] = useState(null);
  const loadedRef = useRef(false);
  const labelMeshRef = useRef();
  const materialRefs = useRef({});

  // Auto-rotate
  useFrame((state, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.3;
    }
  });

  // Load GLB model
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    console.log('[ChiCup3D] Loading Chi Cup model...');
    console.log('[ChiCup3D] Cup color:', cupColor);
    console.log('[ChiCup3D] Lid color:', lidColor);

    const loader = new GLTFLoader();
    loader.load(
      GLB_URL + '?v=' + Date.now(),
      (gltf) => {
        console.log('[ChiCup3D] GLB loaded successfully');
        gltf.scene.updateMatrixWorld(true);

        const meshes = [];

        gltf.scene.traverse((child) => {
          if (child.isMesh) {
            const name = child.name || 'unnamed';
            
            // Clone geometry and apply world transform
            const geometry = child.geometry.clone();
            geometry.applyMatrix4(child.matrixWorld);

            // Remove vertex colors if present
            if (geometry.attributes.color) {
              geometry.deleteAttribute('color');
            }

            // Determine mesh configuration
            let config = { color: '#cccccc', isLabelBody: false };

            switch (name) {
              case 'LabelBody':
                config = { color: cupColor, isLabelBody: true };
                console.log('[ChiCup3D] LabelBody (outer cup) -> Color:', cupColor);
                break;
              case 'CupBody':
                config = { color: INNER_CUP_COLOR, isLabelBody: false };
                console.log('[ChiCup3D] CupBody (inner) -> Color:', INNER_CUP_COLOR);
                break;
              case 'Lid':
              case 'LidTop':
                config = { color: lidColor, isLabelBody: false };
                console.log(`[ChiCup3D] ${name} -> Color:`, lidColor);
                break;
              case 'SilverBody':
                config = { color: SILVER_COLOR, isLabelBody: false };
                console.log('[ChiCup3D] SilverBody -> Color:', SILVER_COLOR);
                break;
              default:
                console.log(`[ChiCup3D] ${name} -> default color`);
            }

            meshes.push({ name, geometry, ...config });
          }
        });

        console.log('[ChiCup3D] Total meshes:', meshes.length);
        setMeshData(meshes);
      },
      undefined,
      (error) => console.error('[ChiCup3D] Error loading GLB:', error)
    );
  }, [cupColor, lidColor]);

  // Apply design texture to LabelBody (composited onto base color)
  useEffect(() => {
    if (!designTexture || !labelMeshRef.current) {
      return;
    }

    console.log('[ChiCup3D] Processing design texture...');

    // Composite the design onto the cup base color
    compositeDesignOnColor(designTexture, cupColor)
      .then((compositedUrl) => {
        const loader = new THREE.TextureLoader();
        loader.load(
          compositedUrl,
          (texture) => {
            // Configure texture
            texture.flipY = false;
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;

            if (labelMeshRef.current && labelMeshRef.current.material) {
              labelMeshRef.current.material.map = texture;
              labelMeshRef.current.material.needsUpdate = true;
              console.log('[ChiCup3D] ✅ Composited design texture applied!');
            }
          },
          undefined,
          (error) => console.error('[ChiCup3D] Error applying texture:', error)
        );
      })
      .catch((error) => {
        console.error('[ChiCup3D] Error compositing design:', error);
      });
  }, [designTexture, meshData, cupColor]);

  // Update colors when props change
  useEffect(() => {
    if (!meshData) return;
    
    Object.entries(materialRefs.current).forEach(([name, material]) => {
      if (name === 'LabelBody') {
        // Only update if no texture applied
        if (!material.map) {
          material.color.set(cupColor);
        }
      } else if (name === 'Lid' || name === 'LidTop') {
        material.color.set(lidColor);
      }
      material.needsUpdate = true;
    });
  }, [cupColor, lidColor, meshData]);

  // Loading state
  if (!meshData) {
    return (
      <mesh>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshBasicMaterial color="#999" wireframe />
      </mesh>
    );
  }

  // Render all meshes
  return (
    <group ref={groupRef} scale={15} position={[0, -1.0 , 0]}>
      {meshData.map((mesh, index) => (
        <mesh 
          key={mesh.name + index} 
          geometry={mesh.geometry}
          ref={mesh.isLabelBody ? labelMeshRef : null}
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
  console.log('[ChiCup3D] ===== ChiCup3DPreview MOUNTED =====');
  console.log('[ChiCup3D] Props - cupColor:', cupColor, '| lidColor:', lidColor, '| hasDesign:', !!designTexture);

  return (
    <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
      <div className='bg-white rounded-xl shadow-2xl w-full max-w-2xl h-[600px] overflow-hidden relative'>
        {/* Header */}
        <div className='flex items-center justify-between p-4 border-b'>
          <h3 className='text-lg font-semibold text-gray-800'>3D Preview - Chi Cup</h3>
          <button
            onClick={onClose}
            className='p-2 rounded-full hover:bg-gray-100 transition-colors'
          >
            <X className='w-5 h-5' />
          </button>
        </div>

        {/* 3D Canvas */}
        <Canvas 
          camera={{ position: [0, 0.3, 4], fov: 45 }} 
          className='bg-gradient-to-b from-gray-100 to-gray-300'
          style={{ width: '100%', height: '100%' }}
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

        {/* Footer */}
        <div className='absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-gray-500 bg-white/90 px-4 py-2 rounded-full shadow'>
          Drag to rotate • Scroll to zoom
        </div>
      </div>
    </div>
  );
}

// Export default colors for use in Designer.jsx
export { DEFAULT_CUP_COLOR, DEFAULT_LID_COLOR };