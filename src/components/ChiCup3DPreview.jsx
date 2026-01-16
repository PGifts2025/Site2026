import React, { useRef, useEffect, useState, Suspense, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, Center } from '@react-three/drei';
import * as THREE from 'three';
import { X } from 'lucide-react';

function CupModel({ designTexture, lidColor }) {
  const { scene } = useGLTF('https://cbcevjhvgmxrxeeyldza.supabase.co/storage/v1/object/public/product-templates/chi-cup/chi-cup.glb');
  const groupRef = useRef();
  const textureRef = useRef(null);

  // Apply materials once when scene loads
  useEffect(() => {
    if (!scene) return;

    console.log('[ChiCup3D] ===== APPLYING MATERIALS (Simple Approach) =====');

    scene.traverse((child) => {
      if (child.isMesh) {
        const meshName = child.name;
        console.log('[ChiCup3D] Mesh:', meshName);

        // Ensure material is not shared
        if (child.material) {
          child.material = child.material.clone();
        }

        // Set side to DoubleSide for ALL materials
        child.material.side = THREE.DoubleSide;

        // Apply colors based on mesh name
        if (meshName === 'Lid' || meshName === 'LidTop') {
          child.material.color.set(lidColor || '#4A3728');
          console.log('[ChiCup3D]   Lid color set:', child.material.color.getHexString());
        }
        else if (meshName === 'SilverBody') {
          child.material.color.set('#C0C0C0');
          child.material.metalness = 0.8;
          child.material.roughness = 0.2;
          console.log('[ChiCup3D]   Silver set:', child.material.color.getHexString());
        }
        else if (meshName === 'LabelBody') {
          child.material.color.set('#F5F5F0');
          console.log('[ChiCup3D]   LabelBody base color set:', child.material.color.getHexString());
        }
        else {
          // 3DGeom and other meshes - OFF WHITE
          child.material.color.set('#F5F5F0');
          console.log('[ChiCup3D]   Set off-white for:', meshName, child.material.color.getHexString());
        }

        child.material.needsUpdate = true;
      }
    });

    console.log('[ChiCup3D] ===== MATERIALS APPLIED =====');
  }, [scene, lidColor]);

  // Apply texture separately
  useEffect(() => {
    if (!designTexture || !scene) return;

    console.log('[ChiCup3D] Applying texture...');

    scene.traverse((child) => {
      if (child.isMesh && child.name === 'LabelBody') {
        const loader = new THREE.TextureLoader();
        loader.load(
          designTexture,
          (texture) => {
            texture.flipY = false;
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            child.material.map = texture;
            child.material.needsUpdate = true;
            textureRef.current = texture;
            console.log('[ChiCup3D] ✓ Texture applied to LabelBody');
          },
          undefined,
          (error) => {
            console.error('[ChiCup3D] ✗ Texture load error:', error);
          }
        );
      }
    });
  }, [designTexture, scene]);

  // Auto-rotate
  useFrame((state, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.3;
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={scene} scale={15} />
    </group>
  );
}

export default function ChiCup3DPreview({ designTexture, lidColor = '#4A3728', isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70'>
      <div className='relative bg-white rounded-xl shadow-2xl w-[90vw] max-w-3xl h-[80vh] overflow-hidden'>
        {/* Header */}
        <div className='absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-white to-transparent'>
          <h3 className='text-lg font-semibold text-gray-800'>3D Preview - Chi Cup</h3>
          <button onClick={onClose} className='p-2 rounded-full hover:bg-gray-100 transition-colors'>
            <X className='w-5 h-5' />
          </button>
        </div>

        {/* 3D Canvas */}
        <Canvas camera={{ position: [0, 2, 4], fov: 40 }} className='bg-gradient-to-b from-gray-100 to-gray-200'>
          <Suspense fallback={null}>
            <ambientLight intensity={2} />
            <directionalLight position={[5, 5, 5]} intensity={2} />
            <directionalLight position={[-5, 5, -5]} intensity={1} />
            <Center>
              <CupModel designTexture={designTexture} lidColor={lidColor} />
            </Center>
            <OrbitControls
              enablePan={false}
              enableZoom={true}
              minDistance={2}
              maxDistance={15}
              autoRotate={false}
            />
            <Environment preset='studio' />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}
