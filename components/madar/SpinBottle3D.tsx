'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { madarSound } from './SoundFX';

interface SpinBottle3DProps {
  targetAngleDeg: number; // Authoritative angle from backend (0 deg = top/12 o'clock, clockwise)
  spinId: string | null;
  liteMode: boolean;
  onSpinComplete?: () => void;
}

function isSoftwareWebGL(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      const str = `${gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)} ${gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)}`;
      return /SwiftShader|llvmpipe|Software|Mesa OffScreen/i.test(str);
    }
  } catch {
    return false;
  }
  return false;
}

export default function SpinBottle3D({
  targetAngleDeg,
  spinId,
  liteMode,
  onSpinComplete,
}: SpinBottle3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const currentAngleRef = useRef<number>(targetAngleDeg);
  const animStateRef = useRef<{
    spinning: boolean;
    startAngle: number;
    endAngle: number;
    startTime: number;
    durationMs: number;
    lastTickBucket: number;
  }>({
    spinning: false,
    startAngle: targetAngleDeg,
    endAngle: targetAngleDeg,
    startTime: 0,
    durationMs: 3200,
    lastTickBucket: 0,
  });

  const lastSpinIdRef = useRef<string | null>(spinId);
  const onCompleteRef = useRef(onSpinComplete);
  useEffect(() => {
    onCompleteRef.current = onSpinComplete;
  }, [onSpinComplete]);

  const [webglFailed, setWebglFailed] = useState(false);

  // Trigger physics spin whenever a new backend spinId arrives
  useEffect(() => {
    if (!spinId || spinId === lastSpinIdRef.current) return;
    lastSpinIdRef.current = spinId;

    const start = currentAngleRef.current;
    const end = targetAngleDeg;
    animStateRef.current = {
      spinning: true,
      startAngle: start,
      endAngle: end,
      startTime: performance.now(),
      durationMs: 3300,
      lastTickBucket: Math.floor(start / 45),
    };

    if (liteMode || webglFailed) {
      const t = setTimeout(() => {
        currentAngleRef.current = end;
        madarSound.playBottleStop();
        onCompleteRef.current?.();
      }, 2800);
      return () => clearTimeout(t);
    }
  }, [spinId, targetAngleDeg, liteMode, webglFailed]);

  useEffect(() => {
    if (liteMode || webglFailed) return;
    const container = hostRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      const id = requestAnimationFrame(() => setWebglFailed(true));
      return () => cancelAnimationFrame(id);
    }

    const software = isSoftwareWebGL(renderer);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, software ? 1 : 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const size = Math.min(container.clientWidth || 220, container.clientHeight || 220);
    renderer.setSize(size, size, false);
    const canvasEl = renderer.domElement;
    canvasEl.style.width = '100%';
    canvasEl.style.height = '100%';
    canvasEl.style.display = 'block';
    container.appendChild(canvasEl);

    const scene = new THREE.Scene();
    // Top-down slightly tilted dramatic table view
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
    camera.position.set(0, 6.4, 1.35);
    camera.lookAt(0, 0, 0);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;

    const spot = new THREE.DirectionalLight(0xe0f2fe, 2.5);
    spot.position.set(3, 8, 4);
    scene.add(spot);

    const rimPurple = new THREE.PointLight(0x8b5cf6, 4.5, 16);
    rimPurple.position.set(-3, 2, -2);
    scene.add(rimPurple);

    const rimCyan = new THREE.PointLight(0x22d3ee, 4.0, 16);
    rimCyan.position.set(3, 2, 2);
    scene.add(rimCyan);

    // Subtle tabletop shadow disc
    const discGeo = new THREE.RingGeometry(0.15, 1.65, 48);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.36;
    scene.add(disc);

    // Composite 3D Glass Bottle Assembly (points along -Z at angle=0 so 0 deg = 12 o'clock top!)
    const spinnerPivot = new THREE.Group();
    scene.add(spinnerPivot);

    const bottleGroup = new THREE.Group();
    // LatheGeometry builds along +Y; rotate -PI/2 around X so bottle neck points toward -Z (top of screen!)
    bottleGroup.rotation.x = -Math.PI / 2;
    spinnerPivot.add(bottleGroup);

    // 1. Authentic curved bottle profile using LatheGeometry
    const points = [
      new THREE.Vector2(0.01, -1.25),
      new THREE.Vector2(0.42, -1.25),
      new THREE.Vector2(0.46, -1.12),
      new THREE.Vector2(0.46, -0.05),
      new THREE.Vector2(0.42, 0.25),
      new THREE.Vector2(0.24, 0.56),
      new THREE.Vector2(0.17, 0.86),
      new THREE.Vector2(0.17, 1.32),
      new THREE.Vector2(0.21, 1.38),
      new THREE.Vector2(0.15, 1.42),
    ];
    const glassGeo = new THREE.LatheGeometry(points, 36);
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#67e8f9'),
      roughness: 0.08,
      metalness: 0.05,
      transmission: 0.82,
      thickness: 0.65,
      ior: 1.5,
      transparent: true,
      opacity: 0.92,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
    });
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    bottleGroup.add(glassMesh);

    // 2. Inner glowing cosmic elixir liquid
    const liquidGeo = new THREE.CylinderGeometry(0.36, 0.38, 0.95, 28);
    const liquidMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#7c3aed'),
      emissive: new THREE.Color('#38bdf8'),
      emissiveIntensity: 0.7,
      roughness: 0.2,
      transparent: true,
      opacity: 0.72,
    });
    const liquidMesh = new THREE.Mesh(liquidGeo, liquidMat);
    liquidMesh.position.y = -0.62;
    bottleGroup.add(liquidMesh);

    // 3. Golden collar ring around neck
    const collarGeo = new THREE.TorusGeometry(0.19, 0.032, 12, 32);
    const collarMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#fbbf24'),
      emissive: new THREE.Color('#f59e0b'),
      emissiveIntensity: 0.55,
      metalness: 0.9,
      roughness: 0.18,
    });
    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.24;
    bottleGroup.add(collar);

    // 4. Cork stopper & glowing directional pointer beacon at bottle mouth
    const corkGeo = new THREE.CylinderGeometry(0.13, 0.11, 0.24, 20);
    const corkMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#d97706'),
      roughness: 0.78,
    });
    const cork = new THREE.Mesh(corkGeo, corkMat);
    cork.position.y = 1.48;
    bottleGroup.add(cork);

    const tipGeo = new THREE.ConeGeometry(0.11, 0.24, 16);
    const tipMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#fde047'),
      emissive: new THREE.Color('#f59e0b'),
      emissiveIntensity: 1.2,
      roughness: 0.2,
    });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.y = 1.72;
    bottleGroup.add(tip);

    // Initial rotation
    spinnerPivot.rotation.y = -(currentAngleRef.current * Math.PI) / 180;

    let rafId = 0;
    let lastRender = performance.now();
    const minFrameMs = software ? 50 : 16;

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      if (now - lastRender < minFrameMs) return;
      lastRender = now;

      const anim = animStateRef.current;
      if (anim.spinning) {
        const t = Math.min(1, (now - anim.startTime) / anim.durationMs);
        // Realistic quartic deceleration ease-out
        const eased = 1 - Math.pow(1 - t, 4);
        const angle = anim.startAngle + (anim.endAngle - anim.startAngle) * eased;
        currentAngleRef.current = angle;
        // Negative Y rotation = clockwise on screen from top-down camera
        spinnerPivot.rotation.y = -(angle * Math.PI) / 180;
        // Subtle wobble while fast
        bottleGroup.rotation.z = Math.sin(t * Math.PI * 14) * (1 - t) * 0.06;

        const bucket = Math.floor(angle / 55);
        if (bucket !== anim.lastTickBucket) {
          anim.lastTickBucket = bucket;
          madarSound.playBottleTick();
        }

        if (t >= 1) {
          anim.spinning = false;
          bottleGroup.rotation.z = 0;
          madarSound.playBottleStop();
          onCompleteRef.current?.();
        }
      } else {
        // Gentle floating sheen shimmer at rest
        spinnerPivot.position.y = Math.sin(now * 0.0024) * 0.035;
      }

      renderer.render(scene, camera);
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      glassGeo.dispose();
      glassMat.dispose();
      liquidGeo.dispose();
      liquidMat.dispose();
      collarGeo.dispose();
      collarMat.dispose();
      corkGeo.dispose();
      corkMat.dispose();
      tipGeo.dispose();
      tipMat.dispose();
      discGeo.dispose();
      discMat.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (canvasEl.parentNode === container) {
        container.removeChild(canvasEl);
      }
    };
  }, [liteMode, webglFailed]);

  if (liteMode || webglFailed) {
    return (
      <div
        key="spin-bottle-lite"
        className="w-40 h-40 sm:w-48 sm:h-48 flex items-center justify-center"
      >
        <svg
          viewBox="0 0 120 120"
          className="w-full h-full drop-shadow-[0_0_24px_rgba(34,211,238,0.4)]"
          style={{
            transform: `rotate(${targetAngleDeg}deg)`,
            transition: 'transform 2.8s cubic-bezier(0.12, 0.85, 0.2, 1)',
          }}
        >
          <defs>
            <linearGradient id="liteBottleGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.9" />
              <stop offset="55%" stopColor="#7c3aed" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#1e3a8a" stopOpacity="0.95" />
            </linearGradient>
          </defs>
          {/* Pointer Beacon */}
          <polygon points="60,5 54,17 66,17" fill="#fbbf24" />
          {/* Cork & Neck */}
          <rect x="54" y="17" width="12" height="8" rx="2" fill="#d97706" />
          <path
            d="M 53 25 L 67 25 L 67 42 L 77 56 L 77 104 C 77 109 73 112 68 112 L 52 112 C 47 112 43 109 43 104 L 43 56 L 53 42 Z"
            fill="url(#liteBottleGrad)"
            stroke="#bae6fd"
            strokeWidth="1.5"
          />
          <rect x="52" y="34" width="16" height="4" rx="2" fill="#fbbf24" />
          <line x1="51" y1="60" x2="51" y2="100" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  return <div key="spin-bottle-webgl" ref={hostRef} className="w-44 h-44 sm:w-56 sm:h-56 select-none" />;
}
