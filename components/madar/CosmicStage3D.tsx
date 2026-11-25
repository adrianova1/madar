'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

interface CosmicStage3DProps {
  evolutionStage: number;
  ringAccent: string;
  liteMode: boolean;
  onHardwareFallback?: () => void;
}

function detectSoftwareOrWeakWebGL(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      const vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '');
      const rendererStr = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
      if (/SwiftShader|llvmpipe|Software|Mesa OffScreen/i.test(`${vendor} ${rendererStr}`)) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function createPlanetCanvasTexture(stage: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Deep cosmic ocean base
  const grad = ctx.createLinearGradient(0, 0, 512, 256);
  if (stage >= 3) {
    grad.addColorStop(0, '#0c1644');
    grad.addColorStop(0.5, '#1e1b6e');
    grad.addColorStop(1, '#09112b');
  } else {
    grad.addColorStop(0, '#071c3e');
    grad.addColorStop(0.5, '#0c3664');
    grad.addColorStop(1, '#071430');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  // Stylized luminous landmasses & aurora bands
  const blobs = [
    { x: 110, y: 95, rx: 55, ry: 28, c: stage >= 3 ? 'rgba(245, 158, 11, 0.34)' : 'rgba(34, 211, 238, 0.36)' },
    { x: 255, y: 125, rx: 72, ry: 34, c: 'rgba(56, 189, 248, 0.35)' },
    { x: 390, y: 88, rx: 64, ry: 26, c: 'rgba(124, 58, 237, 0.40)' },
    { x: 185, y: 185, rx: 50, ry: 20, c: 'rgba(34, 211, 238, 0.28)' },
    { x: 340, y: 175, rx: 58, ry: 22, c: stage >= 3 ? 'rgba(251, 191, 36, 0.28)' : 'rgba(99, 102, 241, 0.32)' },
  ];
  for (const b of blobs) {
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.rx, b.ry, 0.2, 0, Math.PI * 2);
    ctx.fillStyle = b.c;
    ctx.fill();
  }

  // Subtle latitude grid & cloud streaks
  ctx.strokeStyle = 'rgba(186, 230, 253, 0.14)';
  ctx.lineWidth = 1.5;
  for (let y = 32; y < 256; y += 36) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(170, y - 10, 340, y + 10, 512, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export default function CosmicStage3D({
  evolutionStage,
  ringAccent,
  liteMode,
  onHardwareFallback,
}: CosmicStage3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const fallbackRef = useRef(onHardwareFallback);

  useEffect(() => {
    fallbackRef.current = onHardwareFallback;
  }, [onHardwareFallback]);

  useEffect(() => {
    if (liteMode || webglFailed) return;
    const container = hostRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      const id = requestAnimationFrame(() => {
        setWebglFailed(true);
        fallbackRef.current?.();
      });
      return () => cancelAnimationFrame(id);
    }

    const isSoftware = detectSoftwareOrWeakWebGL(renderer);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSoftware ? 1 : 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const width = container.clientWidth || 360;
    const height = container.clientHeight || 360;
    renderer.setSize(width, height, false);
    const canvasEl = renderer.domElement;
    canvasEl.style.width = '100%';
    canvasEl.style.height = '100%';
    canvasEl.style.display = 'block';
    container.appendChild(canvasEl);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 60);
    camera.position.set(0, 0.55, 5.2);
    camera.lookAt(0, 0, 0);

    // Environment & Lighting
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;

    const keyLight = new THREE.DirectionalLight(0x93c5fd, 2.2);
    keyLight.position.set(4, 3, 5);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(0x7c3aed, 5.5, 18);
    rimLight.position.set(-4.5, -2, 3);
    scene.add(rimLight);

    const goldAccentLight = new THREE.PointLight(evolutionStage >= 3 ? 0xf59e0b : 0x22d3ee, 3.2, 14);
    goldAccentLight.position.set(2.5, 3.5, -2);
    scene.add(goldAccentLight);

    // Composite Multi-Part Cosmic Planet Assembly
    const planetGroup = new THREE.Group();
    scene.add(planetGroup);

    const planetTex = createPlanetCanvasTexture(evolutionStage);
    const coreGeo = new THREE.SphereGeometry(1.12, 48, 48);
    const coreMat = new THREE.MeshStandardMaterial({
      map: planetTex,
      roughness: 0.36,
      metalness: 0.22,
      emissive: new THREE.Color(evolutionStage >= 3 ? '#1e1b4b' : '#082f49'),
      emissiveIntensity: 0.45,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    planetGroup.add(coreMesh);

    // Translucent atmospheric Fresnel-like shell
    const atmoGeo = new THREE.SphereGeometry(1.22, 36, 36);
    const atmoMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(ringAccent || '#38bdf8'),
      transparent: true,
      opacity: 0.16,
      roughness: 0.15,
      transmission: 0.4,
      side: THREE.BackSide,
    });
    const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
    planetGroup.add(atmoMesh);

    // Primary tilted astrolabe ring
    const ring1Geo = new THREE.TorusGeometry(1.75, 0.022, 16, 100);
    const ring1Mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(evolutionStage >= 3 ? '#fbbf24' : '#38bdf8'),
      emissive: new THREE.Color(evolutionStage >= 3 ? '#f59e0b' : '#0ea5e9'),
      emissiveIntensity: 0.65,
      metalness: 0.85,
      roughness: 0.2,
    });
    const ring1 = new THREE.Mesh(ring1Geo, ring1Mat);
    ring1.rotation.set(Math.PI * 0.38, 0.22, 0);
    planetGroup.add(ring1);

    // Secondary counter-tilted cosmic purple ring
    const ring2Geo = new THREE.TorusGeometry(2.12, 0.014, 14, 100);
    const ring2Mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#a78bfa'),
      emissive: new THREE.Color('#7c3aed'),
      emissiveIntensity: 0.55,
      metalness: 0.7,
      roughness: 0.25,
    });
    const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2.rotation.set(-Math.PI * 0.34, -0.35, 0.2);
    planetGroup.add(ring2);

    // Orbiting miniature moons / satellites (composite detail)
    const satGroup = new THREE.Group();
    planetGroup.add(satGroup);
    const satGeo = new THREE.OctahedronGeometry(0.08, 1);
    const satColors = ['#22d3ee', '#f59e0b', '#c084fc'];
    const satMats: THREE.MeshStandardMaterial[] = [];
    satColors.forEach((col, i) => {
      const m = new THREE.MeshStandardMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 0.8,
        roughness: 0.2,
      });
      satMats.push(m);
      const sat = new THREE.Mesh(satGeo, m);
      const angle = (i / satColors.length) * Math.PI * 2;
      sat.position.set(Math.cos(angle) * 1.75, Math.sin(angle) * 0.55, Math.sin(angle) * 1.65);
      satGroup.add(sat);
    });

    // Instanced deep-space starfield
    const starCount = isSoftware ? 90 : 220;
    const starGeo = new THREE.OctahedronGeometry(0.025, 0);
    const starMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
    const stars = new THREE.InstancedMesh(starGeo, starMat, starCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < starCount; i++) {
      const r = 3.2 + ((i * 73) % 100) * 0.07;
      const theta = ((i * 137.5) % 360) * (Math.PI / 180);
      const phi = Math.acos(1 - 2 * (((i * 29) % 97) / 97));
      dummy.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi) * 0.65, r * Math.sin(phi) * Math.sin(theta) - 2);
      const s = 0.5 + ((i * 17) % 10) * 0.12;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      stars.setMatrixAt(i, dummy.matrix);
    }
    stars.instanceMatrix.needsUpdate = true;
    scene.add(stars);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 360;
      const h = container.clientHeight || 360;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    window.addEventListener('resize', onResize);

    let rafId = 0;
    let lastTime = performance.now();
    const minFrameMs = isSoftware ? 65 : 16;

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      if (now - lastTime < minFrameMs) return;
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      coreMesh.rotation.y += dt * 0.24;
      ring1.rotation.z += dt * 0.16;
      ring2.rotation.z -= dt * 0.11;
      satGroup.rotation.y += dt * 0.35;
      stars.rotation.y += dt * 0.025;

      renderer.render(scene, camera);
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      coreGeo.dispose();
      coreMat.dispose();
      planetTex.dispose();
      atmoGeo.dispose();
      atmoMat.dispose();
      ring1Geo.dispose();
      ring1Mat.dispose();
      ring2Geo.dispose();
      ring2Mat.dispose();
      satGeo.dispose();
      satMats.forEach((m) => m.dispose());
      starGeo.dispose();
      starMat.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (canvasEl.parentNode === container) {
        container.removeChild(canvasEl);
      }
    };
  }, [evolutionStage, ringAccent, liteMode, webglFailed]);

  if (liteMode || webglFailed) {
    return (
      <div
        key="cosmic-stage-lite"
        className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden rounded-3xl"
      >
        <div className="w-[72%] h-[72%] rounded-full bg-gradient-to-tr from-[#0d1b4a] via-[#2e1065]/40 to-[#0e7490]/30 blur-2xl opacity-70" />
      </div>
    );
  }

  return (
    <div
      key="cosmic-stage-webgl"
      ref={hostRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl opacity-85"
    />
  );
}
