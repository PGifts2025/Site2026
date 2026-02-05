import React, { useRef, useEffect, Suspense, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Center } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import * as THREE from 'three';
import { X } from 'lucide-react';

// ============================================================
// WATER BOTTLE 3D PREVIEW - v4
// ============================================================
// STRATEGY (fixed from v3):
// 1. ALL meshes stay VISIBLE (hiding Mesh006 removed base/shoulder)
// 2. Everything is WHITE except LabelBody_2
// 3. LabelBody_2 = main body cylinder = gets design texture
// 4. UV coords on LabelBody_2 remapped to 0.0-1.0 range
// 5. Mesh006 + Mesh006_1 = shoulder/base structure = white
// 6. LabelBody_1 = inner body = white (no texture = no ridges)
// 7. Lid = white
// ============================================================

const GLB_BASE_URL = 'https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/water-bottle/water%20bottle.glb';
const getGLBURL = () => `${GLB_BASE_URL}?v=${Date.now()}`;

function BottleModel({ designTexture, bottleColor }) {
  const groupRef = useRef();
  const [scene, setScene] = useState(null);
  const [labelMesh, setLabelMesh] = useState(null);

  // Auto-rotate
  useFrame((state, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.3;
    }
  });

  // Load GLB
  useEffect(() => {
    const url = getGLBURL();
    console.log('[WaterBottle3D] Loading GLB from:', url);
    const loader = new GLTFLoader();

    loader.load(
      url,
      (gltf) => {
        console.log('[WaterBottle3D] ✓ GLB loaded successfully');

        const clonedScene = gltf.scene.clone(true);
        let foundLabelMesh = null;
        let totalMeshes = 0;

        // The ONLY mesh that gets the design texture
        const DESIGN_MESH = 'LabelBody_2';

        clonedScene.traverse((child) => {
          if (!child.isMesh) return;
          totalMeshes++;
          const name = child.name;

          // Log UV for diagnostics
          if (child.geometry?.attributes?.uv) {
            const uvAttr = child.geometry.attributes.uv;
            let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
            for (let i = 0; i < uvAttr.count; i++) {
              const u = uvAttr.getX(i), v = uvAttr.getY(i);
              uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
              vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
            }
            console.log(`[WaterBottle3D] Mesh: ${name}  UV: U=${uMin.toFixed(3)}..${uMax.toFixed(3)}, V=${vMin.toFixed(3)}..${vMax.toFixed(3)}`);
          } else {
            console.log(`[WaterBottle3D] Mesh: ${name}  (no UV)`);
          }

          // ── LabelBody_2 = DESIGN TEXTURE (the smooth outer body cylinder) ──
          if (name === DESIGN_MESH) {
            // Remap UV to fill 0.0-1.0
            const uv = child.geometry.attributes.uv;
            if (uv) {
              let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
              for (let i = 0; i < uv.count; i++) {
                minU = Math.min(minU, uv.getX(i));
                maxU = Math.max(maxU, uv.getX(i));
                minV = Math.min(minV, uv.getY(i));
                maxV = Math.max(maxV, uv.getY(i));
              }
              const uRange = maxU - minU;
              const vRange = maxV - minV;
              console.log(`[WaterBottle3D] 📐 BEFORE remap: U=${minU.toFixed(3)}..${maxU.toFixed(3)}, V=${minV.toFixed(3)}..${maxV.toFixed(3)}`);

              if (uRange > 0.01 && vRange > 0.01) {
                for (let i = 0; i < uv.count; i++) {
                  uv.setXY(i,
                    (uv.getX(i) - minU) / uRange,
                    (uv.getY(i) - minV) / vRange
                  );
                }
                uv.needsUpdate = true;
                console.log(`[WaterBottle3D] ✅ UV REMAPPED to 0.0..1.0`);
              }
            }

            // Start with white, texture applied in next effect
            child.material = new THREE.MeshStandardMaterial({
              color: bottleColor || '#ffffff',
              roughness: 0.3,
              metalness: 0.1,
              side: THREE.DoubleSide,
            });
            foundLabelMesh = child;
            console.log(`[WaterBottle3D] 🎯 DESIGN MESH: ${name}`);
            return;
          }

          // ── Everything else = WHITE (visible, no texture) ──
          child.material = new THREE.MeshStandardMaterial({
            color: '#ffffff',
            roughness: 0.3,
            metalness: 0.1,
            side: THREE.DoubleSide,
          });
          console.log(`[WaterBottle3D] ⚪ WHITE: ${name}`);
        });

        console.log('[WaterBottle3D] ═══════════════════════════════════');
        console.log('[WaterBottle3D] Total meshes:', totalMeshes);
        console.log('[WaterBottle3D] Design mesh:', foundLabelMesh ? foundLabelMesh.name : 'NOT FOUND!');
        console.log('[WaterBottle3D] All others: white (visible)');
        console.log('[WaterBottle3D] ═══════════════════════════════════');

        setLabelMesh(foundLabelMesh);
        setScene(clonedScene);
      },
      (progress) => {
        if (progress.total > 0) {
          console.log('[WaterBottle3D] Loading:', Math.round((progress.loaded / progress.total) * 100) + '%');
        }
      },
      (error) => {
        console.error('[WaterBottle3D] ✗ Error loading GLB:', error);
      }
    );
  }, []);

  // Apply design texture to LabelBody_2 only
  useEffect(() => {
    if (!designTexture || !labelMesh) {
      return;
    }

    console.log('[WaterBottle3D] Applying design texture to', labelMesh.name);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      console.log('[WaterBottle3D] Design image loaded:', img.width, 'x', img.height);

      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 1024;
      const ctx = canvas.getContext('2d');

      // Background color
      ctx.fillStyle = bottleColor || '#ffffff';
      ctx.fillRect(0, 0, 1024, 1024);

      // Draw design
      ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, 1024, 1024);

      const texture = new THREE.CanvasTexture(canvas);
      texture.flipY = false;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;

      labelMesh.material = new THREE.MeshStandardMaterial({
        map: texture,
        color: '#ffffff',
        side: THREE.DoubleSide,
        roughness: 0.3,
        metalness: 0.1,
      });
      labelMesh.material.needsUpdate = true;
      console.log('[WaterBottle3D] ✅ Texture applied to:', labelMesh.name);
    };
    img.onerror = (err) => console.error('[WaterBottle3D] ✗ Image load error:', err);
    img.src = designTexture;
  }, [designTexture, labelMesh, bottleColor]);

  if (!scene) {
    return (
      <mesh>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshStandardMaterial color="#999999" wireframe />
      </mesh>
    );
  }

  return (
    <group
      ref={groupRef}
      scale={24}
      position={[0, -1.5, 0]}
      rotation={[0, 0, 0]}
    >
      <primitive object={scene} />
    </group>
  );
}

function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#cccccc" wireframe />
    </mesh>
  );
}

// No isOpen prop - Designer.jsx mounts/unmounts to control visibility
export default function WaterBottle3DPreview({ designTexture, bottleColor, onClose }) {
  console.log('[WaterBottle3D] === COMPONENT MOUNTED ===');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl h-[600px] overflow-hidden relative">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-800">3D Preview - Water Bottle</h3>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <Canvas
          camera={{ position: [0, 0, 5], fov: 45 }}
          className="bg-gradient-to-b from-gray-100 to-gray-300"
          style={{ width: '100%', height: '100%' }}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          dpr={[1, 2]}
        >
          <Suspense fallback={<LoadingFallback />}>
            <ambientLight intensity={1.5} />
            <directionalLight position={[5, 5, 5]} intensity={1} />
            <directionalLight position={[-5, 5, -5]} intensity={0.5} />
            <Center>
              <BottleModel designTexture={designTexture} bottleColor={bottleColor} />
            </Center>
            <OrbitControls enablePan={false} enableZoom={true} minDistance={2} maxDistance={15} />
          </Suspense>
        </Canvas>

        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-gray-500 bg-white/90 px-4 py-2 rounded-full shadow">
          Drag to rotate - Scroll to zoom
        </div>
      </div>
    </div>
  );
}