"use client";

/**
 * VoiceScene — the 3D universe of the public homepage.
 *
 * Concept: AXON (proprietary core) orchestrates job-specialized voice agents.
 * Three orbits around the core:
 *   1. Métiers   — the business verticals the voice agents serve
 *   2. Voix      — premium voice engines (ElevenLabs, MiniMax)
 *   3. Cerveaux  — text LLMs (OpenAI, Anthropic, DeepSeek)
 * Two particle streams cross the scene: inbound calls flowing toward the
 * core, outbound calls flowing away from it.
 *
 * Rendered client-side only (dynamic import with ssr:false in HomeLanding).
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, Stars } from "@react-three/drei";
import {
  IconAssurance,
  IconBrain,
  IconEcommerce,
  IconHotellerie,
  IconImmobilier,
  IconMic,
  IconSante,
  IconSupport,
} from "./icons";

type Theme = "dark" | "light";

type Palette = {
  core: string;
  coreEmissive: string;
  ring: string;
  metier: string;
  voice: string;
  brain: string;
  inbound: string;
  outbound: string;
  ambient: number;
};

const PALETTES: Record<Theme, Palette> = {
  dark: {
    core: "#a855f7",
    coreEmissive: "#7c3aed",
    ring: "#a855f7",
    metier: "#c084fc",
    voice: "#22d3ee",
    brain: "#f0abfc",
    inbound: "#34d399",
    outbound: "#e879f9",
    ambient: 0.55,
  },
  light: {
    core: "#7c3aed",
    coreEmissive: "#6d28d9",
    ring: "#7c3aed",
    metier: "#8b5cf6",
    voice: "#0891b2",
    brain: "#c026d3",
    inbound: "#059669",
    outbound: "#c026d3",
    ambient: 1.15,
  },
};

const CORE_RADIUS = 1.35;

/* ─── Slow auto-rotation + pointer parallax ─── */
function Rig({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state, delta) => {
    const g = ref.current;
    if (!g) return;
    g.rotation.y += delta * 0.05;
    // Gentle parallax toward the pointer.
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, state.pointer.y * -0.12, 0.04);
    g.position.x = THREE.MathUtils.lerp(g.position.x, state.pointer.x * 0.35, 0.04);
  });
  return <group ref={ref}>{children}</group>;
}

/* ─── AXON core ─── */
function AxonCore({ c }: { c: Palette }) {
  const inner = useRef<THREE.Mesh>(null);
  const wire = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    inner.current?.scale.setScalar(1 + Math.sin(t * 1.6) * 0.045);
    if (wire.current) {
      wire.current.rotation.y -= delta * 0.25;
      wire.current.rotation.x += delta * 0.1;
    }
  });
  return (
    <group>
      <mesh ref={inner}>
        <icosahedronGeometry args={[CORE_RADIUS, 3]} />
        <meshStandardMaterial
          color={c.core}
          emissive={c.coreEmissive}
          emissiveIntensity={0.9}
          roughness={0.25}
          metalness={0.25}
        />
      </mesh>
      <mesh ref={wire} scale={1.22}>
        <icosahedronGeometry args={[CORE_RADIUS, 1]} />
        <meshBasicMaterial color={c.core} wireframe transparent opacity={0.28} />
      </mesh>
      <mesh scale={1.9}>
        <sphereGeometry args={[CORE_RADIUS, 24, 24]} />
        <meshBasicMaterial color={c.core} transparent opacity={0.06} depthWrite={false} />
      </mesh>
      <Html center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="mk-core-label">
          AXON
          <span>Orchestrateur</span>
        </div>
      </Html>
    </group>
  );
}

/* ─── One tilted orbit: ring + evenly spaced labeled nodes ─── */
type OrbitItem = { icon: React.ReactNode; label: string; sub?: string };

function Orbit({
  radius,
  speed,
  tilt,
  items,
  color,
  ringColor,
  nodeSize = 0.2,
  kind,
}: {
  radius: number;
  speed: number;
  tilt: number;
  items: OrbitItem[];
  color: string;
  ringColor: string;
  nodeSize?: number;
  kind: "metier" | "voice" | "brain";
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * speed;
  });
  return (
    <group rotation-x={tilt}>
      <mesh rotation-x={Math.PI / 2}>
        <torusGeometry args={[radius, 0.012, 8, 160]} />
        <meshBasicMaterial color={ringColor} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <group ref={ref}>
        {items.map((item, i) => {
          const a = (i / items.length) * Math.PI * 2;
          return (
            <group key={item.label} position={[Math.cos(a) * radius, 0, Math.sin(a) * radius]}>
              <mesh>
                <sphereGeometry args={[nodeSize, 24, 24]} />
                <meshStandardMaterial
                  color={color}
                  emissive={color}
                  emissiveIntensity={0.7}
                  roughness={0.3}
                />
              </mesh>
              <mesh scale={1.8}>
                <sphereGeometry args={[nodeSize, 16, 16]} />
                <meshBasicMaterial color={color} transparent opacity={0.12} depthWrite={false} />
              </mesh>
              <Html center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
                <div className={`mk-node-label mk-node-${kind}`}>
                  <em>{item.icon}</em>
                  <strong>{item.label}</strong>
                  {item.sub && <span>{item.sub}</span>}
                </div>
              </Html>
            </group>
          );
        })}
      </group>
    </group>
  );
}

/* ─── Call particles: inbound spiral toward the core, outbound away ─── */
function CallStream({
  inbound,
  color,
  count = 220,
  rMax = 8,
}: {
  inbound: boolean;
  color: string;
  count?: number;
  rMax?: number;
}) {
  const ref = useRef<THREE.Points>(null);
  const data = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        angle: Math.random() * Math.PI * 2,
        t: Math.random(), // progress 0 (core) → 1 (edge)
        speed: 0.08 + Math.random() * 0.16,
        swirl: 0.25 + Math.random() * 0.6,
        y: (Math.random() - 0.5) * 2.4,
      })),
    [count],
  );
  const positions = useMemo(() => new Float32Array(count * 3), [count]);

  useFrame((_, delta) => {
    const geo = ref.current?.geometry;
    if (!geo) return;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < data.length; i++) {
      const p = data[i];
      p.t += delta * p.speed * (inbound ? -1 : 1);
      if (inbound && p.t <= 0) p.t = 1;
      if (!inbound && p.t >= 1) p.t = 0;
      p.angle += delta * p.swirl * 0.4;
      const r = CORE_RADIUS + 0.2 + p.t * (rMax - CORE_RADIUS);
      pos.setXYZ(i, Math.cos(p.angle) * r, p.y * p.t, Math.sin(p.angle) * r);
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        size={0.075}
        transparent
        opacity={0.85}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  );
}

/* ─── Floating direction badges ─── */
function CallBadges() {
  return (
    <>
      <Html position={[-7.2, 2.1, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="mk-flow-badge mk-flow-in">↘ Appels entrants</div>
      </Html>
      <Html position={[7.2, -1.6, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="mk-flow-badge mk-flow-out">↗ Appels sortants</div>
      </Html>
    </>
  );
}

const METIERS: OrbitItem[] = [
  { icon: <IconSante size={15} />, label: "Santé" },
  { icon: <IconImmobilier size={15} />, label: "Immobilier" },
  { icon: <IconHotellerie size={15} />, label: "Hôtellerie" },
  { icon: <IconEcommerce size={15} />, label: "E-commerce" },
  { icon: <IconAssurance size={15} />, label: "Assurance" },
  { icon: <IconSupport size={15} />, label: "Support" },
];

const VOICES: OrbitItem[] = [
  { icon: <IconMic size={16} />, label: "ElevenLabs", sub: "Voix premium" },
  { icon: <IconMic size={16} />, label: "MiniMax", sub: "Voix premium" },
];

const BRAINS: OrbitItem[] = [
  { icon: <IconBrain size={16} />, label: "OpenAI", sub: "Cerveau LLM" },
  { icon: <IconBrain size={16} />, label: "Anthropic", sub: "Cerveau LLM" },
  { icon: <IconBrain size={16} />, label: "DeepSeek", sub: "Cerveau LLM" },
];

export default function VoiceScene({ theme }: { theme: Theme }) {
  const c = PALETTES[theme];
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 2.6, 11.5], fov: 42 }}
      gl={{ alpha: true, antialias: true }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={c.ambient} />
      <pointLight position={[0, 0, 0]} intensity={28} color={c.core} />
      <directionalLight position={[6, 8, 4]} intensity={0.7} />
      {theme === "dark" && (
        <Stars radius={55} depth={30} count={1600} factor={3.2} saturation={0.5} fade speed={0.5} />
      )}
      <Rig>
        <AxonCore c={c} />
        <Orbit
          radius={3.4}
          speed={0.1}
          tilt={0.16}
          items={METIERS}
          color={c.metier}
          ringColor={c.ring}
          nodeSize={0.18}
          kind="metier"
        />
        <Orbit
          radius={5.1}
          speed={-0.07}
          tilt={-0.34}
          items={VOICES}
          color={c.voice}
          ringColor={c.voice}
          nodeSize={0.24}
          kind="voice"
        />
        <Orbit
          radius={6.7}
          speed={0.05}
          tilt={0.46}
          items={BRAINS}
          color={c.brain}
          ringColor={c.brain}
          nodeSize={0.22}
          kind="brain"
        />
        <CallStream inbound color={c.inbound} />
        <CallStream inbound={false} color={c.outbound} />
        <CallBadges />
      </Rig>
    </Canvas>
  );
}
