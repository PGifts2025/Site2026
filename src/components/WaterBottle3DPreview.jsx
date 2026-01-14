import React, { useRef, useState, useEffect, Suspense } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { X } from 'lucide-react';

// Water bottle 3D model component
function WaterBottleModel({ designTexture }) {
  const bottleRef = useRef();
  const [labelTexture, setLabelTexture] = useState(null);

  // Load the design texture
  useEffect(() => {
    if (!designTexture) {
      console.log('[WaterBottle3D] No designTexture to load');
      return;
    }

    console.log('[WaterBottle3D] Loading texture from base64...');
    console.log('[WaterBottle3D] designTexture length:', designTexture.length);

    const loader = new THREE.TextureLoader();
    loader.load(
      designTexture,
      (texture) => {
        console.log('[WaterBottle3D] Texture loaded successfully!');
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.repeat.x = 1; // Fixed: was -1, causing mirrored design
        texture.needsUpdate = true;
        setLabelTexture(texture);
        console.log('[WaterBottle3D] Label texture state updated');
      },
      undefined,
      (error) => {
        console.error('[WaterBottle3D] Error loading texture:', error);
      }
    );
  }, [designTexture]);

  // Rotate bottle slowly
  useFrame((state, delta) => {
    if (bottleRef.current) {
      bottleRef.current.rotation.y += delta * 0.3;
    }
  });

  return (
    <group ref={bottleRef}>
      {/* Main bottle body - straight cylinder (lower portion) */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.2, 1.2, 5.8, 32]} />
        <meshStandardMaterial
          color="#e8f4f8"
          transparent
          opacity={0.6}
          roughness={0.1}
          metalness={0.1}
        />
      </mesh>

      {/* Tapered shoulder - connects body to neck */}
      <mesh position={[0, 3.6, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.45, 1.2, 0.8, 32]} />
        <meshStandardMaterial
          color="#e8f4f8"
          transparent
          opacity={0.6}
          roughness={0.1}
          metalness={0.1}
        />
      </mesh>

      {/* Bottle neck - narrow cylinder */}
      <mesh position={[0, 4.2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.4, 0.4, 0.4, 32]} />
        <meshStandardMaterial
          color="#e8f4f8"
          transparent
          opacity={0.6}
          roughness={0.1}
          metalness={0.1}
        />
      </mesh>

      {/* Label band with design texture - ONLY on straight cylinder portion */}
      {/* Print area: 70mm x 170mm, aspect ratio = 2.43 */}
      {/* Bottle body: radius 1.2, circumference = 7.54 */}
      {/* Label band: radius 1.205 (barely larger to prevent z-fighting) */}
      {/* Height: 5.8 (matches aspect ratio: 2.43 * 7.54/PI ≈ 5.8) */}
      {labelTexture && (
        <mesh position={[0, 0.5, 0]} rotation={[0, 0, 0]}>
          <cylinderGeometry args={[1.205, 1.205, 5.8, 64, 1, true]} />
          <meshStandardMaterial
            map={labelTexture}
            transparent={true}
            side={THREE.DoubleSide}
            roughness={0.3}
            metalness={0.1}
          />
        </mesh>
      )}

      {/* White screw cap */}
      <group position={[0, 4.6, 0]}>
        {/* Main cap body - white */}
        <mesh castShadow>
          <cylinderGeometry args={[0.45, 0.45, 0.4, 32]} />
          <meshStandardMaterial color="#ffffff" roughness={0.4} metalness={0.2} />
        </mesh>
        {/* Black seal ring */}
        <mesh position={[0, -0.15, 0]} castShadow>
          <cylinderGeometry args={[0.42, 0.42, 0.08, 32]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.6} metalness={0.1} />
        </mesh>
        {/* Cap top ridge */}
        <mesh position={[0, 0.25, 0]} castShadow>
          <cylinderGeometry args={[0.4, 0.45, 0.1, 32]} />
          <meshStandardMaterial color="#f5f5f5" roughness={0.4} metalness={0.2} />
        </mesh>
      </group>

      {/* Bottle bottom */}
      <mesh position={[0, -2.4, 0]} rotation={[Math.PI, 0, 0]} castShadow>
        <cylinderGeometry args={[1.1, 1.2, 0.1, 32]} />
        <meshStandardMaterial color="#e8f4f8" roughness={0.2} metalness={0.1} />
      </mesh>
    </group>
  );
}

// Loading fallback
function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#cccccc" />
    </mesh>
  );
}

// Main component
export default function WaterBottle3DPreview({ designTexture, isOpen, onClose }) {
  console.log('[WaterBottle3D] Received designTexture:', designTexture ? 'YES (length: ' + designTexture.length + ')' : 'NO');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-4xl h-[600px] m-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-xl font-semibold text-gray-800">3D Preview</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="Close preview"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* 3D Canvas */}
        <div className="w-full h-[calc(100%-140px)]">
          <Canvas
            camera={{ position: [0, 0, 6], fov: 50 }}
            shadows
          >
            <Suspense fallback={<LoadingFallback />}>
              {/* Lighting */}
              <ambientLight intensity={0.5} />
              <directionalLight
                position={[5, 5, 5]}
                intensity={1}
                castShadow
                shadow-mapSize-width={1024}
                shadow-mapSize-height={1024}
              />
              <pointLight position={[-5, 5, 5]} intensity={0.5} />

              {/* Environment for reflections */}
              <Environment preset="studio" />

              {/* Water bottle model */}
              <WaterBottleModel designTexture={designTexture} />

              {/* Controls */}
              <OrbitControls
                enablePan={false}
                enableZoom={true}
                minDistance={4}
                maxDistance={10}
                maxPolarAngle={Math.PI / 1.5}
                minPolarAngle={Math.PI / 3}
              />
            </Suspense>
          </Canvas>
        </div>

        {/* Footer with instructions */}
        <div className="p-4 border-t bg-gray-50">
          <p className="text-sm text-gray-600 text-center">
            Drag to rotate • Scroll to zoom • Your design will wrap around the bottle
          </p>
        </div>
      </div>
    </div>
  );
}
