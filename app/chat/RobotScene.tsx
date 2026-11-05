"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export type Companion = "pixel" | "luna";

function roundedBox(width: number, height: number, depth: number, radius = 0.16) {
  return new RoundedBoxGeometry(width, height, depth, 5, radius);
}

export default function RobotScene({ companion, speaking }: { companion: Companion; speaking: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const speakingRef = useRef(speaking);
  useEffect(() => { speakingRef.current = speaking; }, [speaking]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const luna = companion === "luna";
    const colors = luna
      ? { shell: 0xf1a4cf, trim: 0xd44fa7, light: 0xffd7f1, screen: 0x241630, eye: 0xff9ed9, chest: 0xffe0f3 }
      : { shell: 0x8bdaf7, trim: 0x2586d4, light: 0xc9f5ff, screen: 0x101b37, eye: 0x71eaff, chest: 0xb6edff };

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    camera.position.set(0, 0.35, 6.7);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, luna ? 0x693258 : 0x183860, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(-3, 5, 6);
    scene.add(key);
    const rim = new THREE.PointLight(luna ? 0xff70cd : 0x4edaff, 18, 12);
    rim.position.set(3, 1, 3);
    scene.add(rim);

    const root = new THREE.Group();
    scene.add(root);
    const head = new THREE.Group();
    head.position.y = 1.16;
    root.add(head);

    const shellMaterial = new THREE.MeshStandardMaterial({ color: colors.shell, metalness: 0.5, roughness: 0.3 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: colors.trim, metalness: 0.42, roughness: 0.26 });
    const lightMaterial = new THREE.MeshStandardMaterial({ color: colors.light, metalness: 0.24, roughness: 0.22 });
    const screenMaterial = new THREE.MeshStandardMaterial({ color: colors.screen, metalness: 0.35, roughness: 0.19 });
    const eyeMaterial = new THREE.MeshStandardMaterial({ color: colors.eye, emissive: colors.eye, emissiveIntensity: 2.2, roughness: 0.16 });
    const chestMaterial = new THREE.MeshStandardMaterial({ color: colors.chest, emissive: colors.eye, emissiveIntensity: 0.16, metalness: 0.25, roughness: 0.28 });

    const addMesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, position: [number, number, number], scale?: [number, number, number]) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      if (scale) mesh.scale.set(...scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    addMesh(roundedBox(luna ? 1.64 : 1.72, luna ? 1.42 : 1.3, 0.88, 0.25), shellMaterial, head, [0, 0, 0]);
    addMesh(roundedBox(1.42, 0.91, 0.1, 0.2), screenMaterial, head, [0, -0.02, 0.46]);

    const eyeGeometry = new THREE.SphereGeometry(0.13, 24, 18);
    const eyes: THREE.Mesh[] = [];
    for (const x of [-0.34, 0.34]) {
      addMesh(new THREE.SphereGeometry(0.19, 24, 18), trimMaterial, head, [x, 0.11, 0.54]);
      eyes.push(addMesh(eyeGeometry, eyeMaterial, head, [x, 0.11, 0.7]));
      addMesh(new THREE.SphereGeometry(0.045, 16, 12), lightMaterial, head, [x - 0.035, 0.16, 0.76]);
      if (luna) {
        const lash = addMesh(new THREE.BoxGeometry(0.2, 0.025, 0.025), trimMaterial, head, [x, 0.31, 0.67]);
        lash.rotation.z = x < 0 ? 0.12 : -0.12;
      }
    }
    const mouth = addMesh(roundedBox(luna ? 0.35 : 0.31, 0.09, 0.055, 0.04), eyeMaterial, head, [0, -0.29, 0.68]);

    // Antenna and side caps make the two companion silhouettes easy to distinguish.
    const antenna = new THREE.Group();
    antenna.position.set(0, luna ? 0.73 : 0.67, 0);
    head.add(antenna);
    const antennaStem = addMesh(new THREE.CylinderGeometry(0.035, 0.055, 0.28, 16), trimMaterial, antenna, [0, 0.12, 0]);
    antennaStem.rotation.z = luna ? -0.15 : 0;
    addMesh(new THREE.SphereGeometry(luna ? 0.15 : 0.13, 24, 18), eyeMaterial, antenna, [luna ? -0.05 : 0, 0.29, 0]);
    for (const x of [-0.89, 0.89]) {
      addMesh(new THREE.SphereGeometry(luna ? 0.24 : 0.2, 24, 18), trimMaterial, head, [x, -0.04, 0]);
      addMesh(new THREE.SphereGeometry(luna ? 0.12 : 0.1, 20, 16), lightMaterial, head, [x, -0.04, 0.1]);
    }

    const torso = new THREE.Group();
    torso.position.y = -0.28;
    root.add(torso);
    addMesh(roundedBox(1.22, 1.22, 0.78, 0.24), shellMaterial, torso, [0, 0, 0]);
    addMesh(roundedBox(0.78, 0.46, 0.1, 0.13), screenMaterial, torso, [0, 0.1, 0.43]);
    addMesh(new THREE.SphereGeometry(luna ? 0.15 : 0.12, 24, 18), eyeMaterial, torso, [0, 0.1, 0.52]);
    addMesh(roundedBox(0.6, 0.18, 0.1, 0.07), chestMaterial, torso, [0, -0.3, 0.43]);

    const arms: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.7, 0.04, 0);
      torso.add(arm);
      const upper = addMesh(new THREE.CapsuleGeometry(0.16, 0.52, 5, 12), shellMaterial, arm, [side * 0.08, -0.15, 0]);
      upper.rotation.z = side * -0.3;
      addMesh(new THREE.SphereGeometry(0.18, 20, 16), trimMaterial, arm, [side * 0.12, -0.47, 0.05]);
      const hand = addMesh(new THREE.SphereGeometry(0.2, 20, 16), lightMaterial, arm, [side * 0.18, -0.65, 0.05]);
      hand.scale.set(1.05, 0.8, 0.9);
      arms.push(arm);
    }
    for (const x of [-0.32, 0.32]) {
      const leg = addMesh(new THREE.CapsuleGeometry(0.15, 0.27, 4, 12), trimMaterial, root, [x, -1.22, 0]);
      leg.rotation.x = -0.08;
      addMesh(roundedBox(0.42, 0.2, 0.5, 0.09), shellMaterial, root, [x, -1.48, 0.1]);
    }

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.75, 0.012, 8, 120),
      new THREE.MeshBasicMaterial({ color: colors.light, transparent: true, opacity: 0.46 }),
    );
    halo.position.set(0, 0.05, -0.55);
    halo.rotation.x = 0.12;
    root.add(halo);

    const stars: THREE.Mesh[] = [];
    const starMaterial = new THREE.MeshBasicMaterial({ color: colors.light, transparent: true, opacity: 0.9 });
    for (const [x, y, size] of [[-1.9, 1.3, 0.055], [1.9, 0.7, 0.075], [-1.7, -0.8, 0.045], [1.75, -1.05, 0.05]] as const) {
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(size, 0), starMaterial);
      star.position.set(x, y, -0.3);
      scene.add(star);
      stars.push(star);
    }

    const resizeObserver = new ResizeObserver(() => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight, false);
    });
    resizeObserver.observe(mount);
    const timer = new THREE.Timer();
    timer.connect(document);
    let frame = 0;
    const animate = (timestamp: number) => {
      frame = requestAnimationFrame(animate);
      timer.update(timestamp);
      const time = timer.getElapsed();
      root.position.y = Math.sin(time * 1.5) * 0.055;
      root.rotation.y = Math.sin(time * 0.45) * 0.13;
      head.rotation.z = Math.sin(time * 0.7) * 0.025 + (speakingRef.current ? Math.sin(time * 8) * 0.045 : 0);
      mouth.scale.y = speakingRef.current ? 0.6 + (Math.sin(time * 12) + 1) * 0.6 : 0.55;
      arms.forEach((arm, index) => { arm.rotation.z = Math.sin(time * 1.7 + index) * 0.035 + (speakingRef.current ? Math.sin(time * 5 + index) * 0.08 : 0); });
      eyes.forEach((eye) => { eye.scale.y = 0.85 + Math.max(0, Math.sin(time * 0.63)) ** 30 * 0.15; });
      halo.rotation.z = time * (luna ? -0.08 : 0.08);
      stars.forEach((star, index) => { star.rotation.y = time * (0.35 + index * 0.08); star.scale.setScalar(0.75 + (Math.sin(time * 1.8 + index) + 1) * 0.18); });
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frame);
      timer.disconnect();
      timer.dispose();
      resizeObserver.disconnect();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [companion]);

  return <div ref={mountRef} className="robot-canvas" aria-label={`${companion === "pixel" ? "Pixel" : "Luna"}, animated AI companion`} role="img" />;
}
