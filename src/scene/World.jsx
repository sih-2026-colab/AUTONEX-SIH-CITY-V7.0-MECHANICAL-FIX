import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CITY_ROWS, ROAD_WIDTH, LANE_OFFSET } from "./roadNetwork";
import { getHeroActor, removeTrafficActor, updateTrafficActor } from "./trafficState";

const FLOOR_H = 2.55;
const SIGN_RED = "#ff142d";

function makeSignTexture(title, subtitle) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#050608";
  ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = "#230007";
  ctx.fillRect(20, 20, 984, 216);
  ctx.strokeStyle = "#ff1730";
  ctx.lineWidth = 13;
  ctx.strokeRect(26, 26, 972, 204);

  const grad = ctx.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, "#4b000a");
  grad.addColorStop(0.18, "#a90017");
  grad.addColorStop(0.5, "#e40024");
  grad.addColorStop(0.82, "#a90017");
  grad.addColorStop(1, "#4b000a");
  ctx.fillStyle = grad;
  ctx.fillRect(44, 44, 936, 168);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "#ff0b26";
  ctx.shadowBlur = 30;
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 60px Arial";
  ctx.fillText(title, 512, 104);
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#ffd7dc";
  ctx.font = "600 27px Arial";
  ctx.fillText(subtitle, 512, 171);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function makeFacadeTexture(floors, cols, glass, seed = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = glass ? "#0d2633" : "#171c22";
  ctx.fillRect(0, 0, 256, 512);

  const rows = Math.min(15, floors);
  const gapX = 6;
  const gapY = 6;
  const cellW = (256 - gapX * (cols + 1)) / cols;
  const cellH = (512 - gapY * (rows + 1)) / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const code = (r * 17 + c * 11 + seed * 7) % 13;
      const lit = code < 8;
      const warm = code === 1 || code === 6;
      ctx.fillStyle = lit
        ? warm
          ? "#ddc38d"
          : glass
            ? "#69bad1"
            : "#8fa4ad"
        : glass
          ? "#173541"
          : "#22282d";
      ctx.fillRect(
        gapX + c * (cellW + gapX),
        gapY + r * (cellH + gapY),
        cellW,
        cellH
      );
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function Windows({ width, depth, floors, glass = false, seed = 1, yOffset = 0 }) {
  const frontTexture = useMemo(
    () => makeFacadeTexture(floors, Math.max(4, Math.floor(width / 1.2)), glass, seed),
    [width, floors, glass, seed]
  );
  const sideTexture = useMemo(
    () => makeFacadeTexture(floors, Math.max(3, Math.floor(depth / 1.2)), glass, seed + 3),
    [depth, floors, glass, seed]
  );

  useEffect(() => () => {
    frontTexture.dispose();
    sideTexture.dispose();
  }, [frontTexture, sideTexture]);

  const h = floors * FLOOR_H;
  const y = yOffset + h / 2;
  const matProps = {
    emissive: glass ? "#2b7891" : "#6f858e",
    emissiveIntensity: glass ? 0.54 : 0.27,
    roughness: glass ? 0.18 : 0.42,
    metalness: glass ? 0.48 : 0.12
  };

  return (
    <group>
      <mesh position={[0, y, -depth / 2 - 0.014]}>
        <planeGeometry args={[Math.max(0.4, width - 0.45), Math.max(0.4, h - 0.35)]} />
        <meshStandardMaterial map={frontTexture} emissiveMap={frontTexture} {...matProps} />
      </mesh>
      <mesh position={[0, y, depth / 2 + 0.014]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[Math.max(0.4, width - 0.45), Math.max(0.4, h - 0.35)]} />
        <meshStandardMaterial map={frontTexture} emissiveMap={frontTexture} {...matProps} />
      </mesh>
      <mesh position={[-width / 2 - 0.014, y, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[Math.max(0.4, depth - 0.45), Math.max(0.4, h - 0.35)]} />
        <meshStandardMaterial map={sideTexture} emissiveMap={sideTexture} {...matProps} />
      </mesh>
      <mesh position={[width / 2 + 0.014, y, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[Math.max(0.4, depth - 0.45), Math.max(0.4, h - 0.35)]} />
        <meshStandardMaterial map={sideTexture} emissiveMap={sideTexture} {...matProps} />
      </mesh>
    </group>
  );
}

function RoadStrip({ position, size, dawn = false }) {
  const horizontal = size[0] > size[2];
  const length = horizontal ? size[0] : size[2];
  const dashCount = Math.max(2, Math.floor(length / 6));

  return (
    <group position={position}>
      <mesh receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color="#171b20" roughness={0.95} />
      </mesh>

      {[-1, 1].map((side) => (
        <mesh
          key={`curb-${side}`}
          position={horizontal
            ? [0, 0.11, side * (ROAD_WIDTH / 2 + 0.20)]
            : [side * (ROAD_WIDTH / 2 + 0.20), 0.11, 0]}
        >
          <boxGeometry args={horizontal ? [length, 0.18, 0.30] : [0.30, 0.18, length]} />
          <meshStandardMaterial color="#666a6f" roughness={0.82} />
        </mesh>
      ))}

      {Array.from({ length: dashCount }).map((_, i) => {
        const offset = -length / 2 + 3 + i * 6;
        return (
          <mesh key={i} position={horizontal ? [offset, 0.075, 0] : [0, 0.075, offset]}>
            <boxGeometry args={horizontal ? [2.4, 0.024, 0.08] : [0.08, 0.024, 2.4]} />
            <meshStandardMaterial color="#d8dcdf" emissive="#7b8287" emissiveIntensity={0.17} />
          </mesh>
        );
      })}

      {[-1, 1].map((side) => (
        <mesh
          key={`edge-${side}`}
          position={horizontal
            ? [0, 0.084, side * (ROAD_WIDTH / 2 - 0.58)]
            : [side * (ROAD_WIDTH / 2 - 0.58), 0.084, 0]}
        >
          <boxGeometry args={horizontal ? [length - 0.5, 0.018, 0.045] : [0.045, 0.018, length - 0.5]} />
          <meshStandardMaterial color="#58d8ff" emissive="#2da9d1" emissiveIntensity={0.72} />
        </mesh>
      ))}
    </group>
  );
}

function StreetLight({ position, rotation = 0, bright = false, dawn = false }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 2.55, 0]}>
        <cylinderGeometry args={[0.05, 0.075, 5.1, 10]} />
        <meshStandardMaterial color="#2d353d" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0.56, 5.02, 0]}>
        <boxGeometry args={[1.16, 0.08, 0.11]} />
        <meshStandardMaterial color="#343d46" metalness={0.8} roughness={0.28} />
      </mesh>
      <mesh position={[1.08, 4.91, 0]}>
        <boxGeometry args={[0.24, 0.08, 0.19]} />
        <meshStandardMaterial color="#fff1c6" emissive="#ffd47f" emissiveIntensity={dawn ? 1.8 : 3.0} />
      </mesh>
      {bright && <pointLight position={[1.08, 4.5, 0]} color="#ffdca2" intensity={dawn ? 1.15 : 2.1} distance={12} />}
    </group>
  );
}

function DestinationTower({ destination }) {
  const texture = useMemo(
    () => makeSignTexture(destination.label, destination.subtitle),
    [destination.label, destination.subtitle]
  );
  useEffect(() => () => texture.dispose(), [texture]);

  const floors = destination.floors;
  const h = floors * FLOOR_H;
  const style = destination.towerStyle;
  const glass = style === "glass" || style === "twin" || style === "atrium" || style === "frame";
  const width = style === "twin" ? 12.5 : 10.4;
  const depth = style === "atrium" ? 9.1 : 8.0;

  return (
    <group position={destination.buildingPosition} rotation={[0, destination.buildingRotation ?? 0, 0]}>
      {/* Broad architectural podium keeps signs/entrance at human scale. */}
      <mesh castShadow receiveShadow position={[0, 1.4, 0]}>
        <boxGeometry args={[14.2, 2.8, 11.0]} />
        <meshStandardMaterial color="#171c22" metalness={0.58} roughness={0.31} />
      </mesh>

      {style === "twin" ? (
        <>
          {[-3.35, 3.35].map((x, idx) => (
            <group key={x} position={[x, 0, idx ? 0.55 : -0.55]}>
              <mesh castShadow position={[0, h / 2 + 2.8, 0]}>
                <boxGeometry args={[5.0, h, depth]} />
                <meshPhysicalMaterial color="#143747" metalness={0.66} roughness={0.12} transparent opacity={0.94} />
              </mesh>
              <Windows width={5.0} depth={depth} floors={floors} glass yOffset={2.8} seed={idx + 40} />
            </group>
          ))}
          <mesh position={[0, h * 0.61 + 2.8, 0]}>
            <boxGeometry args={[2.4, 2.5, 6.0]} />
            <meshStandardMaterial color="#222b34" metalness={0.72} roughness={0.24} />
          </mesh>
        </>
      ) : style === "stepped" ? (
        <>
          <mesh castShadow position={[-0.9, h * 0.30 + 2.8, 0]}>
            <boxGeometry args={[width, h * 0.60, depth]} />
            <meshStandardMaterial color="#24282d" metalness={0.44} roughness={0.34} />
          </mesh>
          <mesh castShadow position={[1.35, h * 0.75 + 2.8, -0.35]}>
            <boxGeometry args={[width * 0.68, h * 0.50, depth * 0.76]} />
            <meshPhysicalMaterial color="#204052" metalness={0.59} roughness={0.14} />
          </mesh>
          <Windows width={width} depth={depth} floors={Math.ceil(floors * 0.62)} yOffset={2.8} seed={17} />
        </>
      ) : style === "crown" ? (
        <>
          <mesh castShadow position={[0, h / 2 + 2.8, 0]}>
            <boxGeometry args={[width, h, depth]} />
            <meshStandardMaterial color="#20262d" metalness={0.53} roughness={0.29} />
          </mesh>
          <Windows width={width} depth={depth} floors={floors} yOffset={2.8} seed={23} />
          <mesh position={[0, h + 3.8, 0]} rotation={[0, Math.PI / 4, 0]}>
            <boxGeometry args={[5.7, 1.6, 5.7]} />
            <meshStandardMaterial color="#861326" emissive="#510711" emissiveIntensity={0.48} metalness={0.68} roughness={0.2} />
          </mesh>
          <mesh position={[0, h + 6.0, 0]}>
            <cylinderGeometry args={[0.15, 0.22, 4.5, 10]} />
            <meshStandardMaterial color="#8f202e" emissive="#4c0812" emissiveIntensity={0.5} />
          </mesh>
        </>
      ) : style === "frame" ? (
        <>
          <mesh castShadow position={[0, h / 2 + 2.8, 0]}>
            <boxGeometry args={[width, h, depth]} />
            <meshPhysicalMaterial color="#183847" metalness={0.68} roughness={0.12} />
          </mesh>
          <Windows width={width} depth={depth} floors={floors} glass yOffset={2.8} seed={29} />
          {[-1, 1].map((x) => (
            <mesh key={x} position={[x * (width / 2 + 0.32), h / 2 + 2.8, 0]}>
              <boxGeometry args={[0.48, h + 1.4, depth + 0.95]} />
              <meshStandardMaterial color="#9d1729" emissive="#650713" emissiveIntensity={0.44} metalness={0.75} roughness={0.2} />
            </mesh>
          ))}
        </>
      ) : (
        <>
          <mesh castShadow position={[0, h / 2 + 2.8, 0]}>
            <boxGeometry args={[width, h, depth]} />
            <meshPhysicalMaterial
              color={glass ? "#143b4e" : "#252a30"}
              metalness={glass ? 0.71 : 0.46}
              roughness={glass ? 0.10 : 0.32}
              transparent={glass}
              opacity={glass ? 0.95 : 1}
            />
          </mesh>
          <Windows width={width} depth={depth} floors={floors} glass={glass} yOffset={2.8} seed={31} />
          {style === "atrium" && (
            <mesh position={[0, h * 0.32 + 2.8, depth / 2 + 0.18]}>
              <boxGeometry args={[width * 0.72, h * 0.54, 0.32]} />
              <meshPhysicalMaterial color="#64c9e8" emissive="#124e64" emissiveIntensity={0.34} metalness={0.52} roughness={0.07} transparent opacity={0.64} />
            </mesh>
          )}
        </>
      )}

      {/* Physical red illuminated sign enclosure — no floating labels. */}
      <mesh position={[0, 5.7, depth / 2 + 0.26]}>
        <boxGeometry args={[8.4, 2.25, 0.30]} />
        <meshStandardMaterial color="#210207" emissive={SIGN_RED} emissiveIntensity={0.56} metalness={0.42} roughness={0.25} />
      </mesh>
      <mesh position={[0, 5.7, depth / 2 + 0.43]}>
        <planeGeometry args={[8.0, 1.88]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 5.4, depth / 2 + 2.8]} color={SIGN_RED} intensity={9} distance={14} />

      {/* Entrance canopy / glass lobby. */}
      <mesh position={[0, 2.0, depth / 2 + 1.65]}>
        <boxGeometry args={[5.7, 0.24, 3.1]} />
        <meshStandardMaterial color="#242d35" metalness={0.74} roughness={0.2} />
      </mesh>
      <mesh position={[0, 1.4, depth / 2 + 0.15]}>
        <boxGeometry args={[3.6, 2.45, 0.18]} />
        <meshPhysicalMaterial color="#79c9df" transparent opacity={0.42} transmission={0.40} roughness={0.06} />
      </mesh>
    </group>
  );
}

function BackgroundTower({ x, z, floors, variant }) {
  const h = floors * FLOOR_H;
  const width = 7.0 + (variant % 4) * 1.0;
  const depth = 6.2 + ((variant + 1) % 3) * 0.95;
  const mode = variant % 7;
  const glass = mode === 0 || mode === 3 || mode === 6;

  return (
    <group position={[x, 0, z]} rotation={[0, ((variant % 5) - 2) * 0.035, 0]}>
      {mode === 5 ? (
        // Faceted glass tower.
        <>
          <mesh castShadow position={[0, h / 2, 0]}>
            <cylinderGeometry args={[width * 0.43, width * 0.50, h, 8]} />
            <meshPhysicalMaterial color="#173848" metalness={0.68} roughness={0.13} />
          </mesh>
          {Array.from({ length: floors }).map((_, i) => (
            <mesh key={i} position={[0, 1.2 + i * FLOOR_H, 0]}>
              <torusGeometry args={[width * 0.48, 0.035, 4, 8]} />
              <meshStandardMaterial color="#68aec1" emissive="#265969" emissiveIntensity={0.35} />
            </mesh>
          ))}
        </>
      ) : mode === 4 ? (
        // Offset twin slabs.
        <>
          <mesh castShadow position={[-width * 0.24, h / 2, -0.6]}>
            <boxGeometry args={[width * 0.48, h, depth]} />
            <meshStandardMaterial color="#242a31" metalness={0.52} roughness={0.3} />
          </mesh>
          <mesh castShadow position={[width * 0.27, h * 0.42, 0.65]}>
            <boxGeometry args={[width * 0.40, h * 0.84, depth * 0.78]} />
            <meshPhysicalMaterial color="#1a4052" metalness={0.64} roughness={0.13} />
          </mesh>
        </>
      ) : mode === 2 ? (
        // Terraced architecture.
        <>
          <mesh castShadow position={[0, h * 0.28, 0]}>
            <boxGeometry args={[width, h * 0.56, depth]} />
            <meshStandardMaterial color="#282c31" metalness={0.42} roughness={0.35} />
          </mesh>
          <mesh castShadow position={[0.75, h * 0.70, -0.2]}>
            <boxGeometry args={[width * 0.72, h * 0.40, depth * 0.82]} />
            <meshPhysicalMaterial color="#1d3f50" metalness={0.58} roughness={0.15} />
          </mesh>
        </>
      ) : (
        <>
          <mesh castShadow position={[0, h / 2, 0]}>
            <boxGeometry args={[width, h, depth]} />
            <meshPhysicalMaterial
              color={glass ? "#123344" : mode % 2 ? "#252a30" : "#1c232a"}
              metalness={glass ? 0.66 : 0.42}
              roughness={glass ? 0.14 : 0.34}
              transparent={glass}
              opacity={glass ? 0.96 : 1}
            />
          </mesh>
          <Windows width={width} depth={depth} floors={floors} glass={glass} seed={variant + 70} />
        </>
      )}

      {mode === 1 && (
        <mesh position={[0, h + 0.42, 0]}>
          <boxGeometry args={[width * 0.82, 0.65, depth * 0.82]} />
          <meshStandardMaterial color="#62101b" emissive="#2b0308" emissiveIntensity={0.34} />
        </mesh>
      )}
      {mode === 6 && (
        <mesh position={[0, h * 0.58, depth / 2 + 0.18]}>
          <boxGeometry args={[width * 0.82, 0.20, 0.24]} />
          <meshStandardMaterial color="#e91931" emissive="#a80c20" emissiveIntensity={1.2} />
        </mesh>
      )}
    </group>
  );
}

function ParkingBay({ position, rotation = 0 }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.09, 0]}>
        <boxGeometry args={[2.9, 0.025, 5.9]} />
        <meshStandardMaterial color="#1a2026" />
      </mesh>
      {[-1, 1].map((x) => (
        <mesh key={x} position={[x * 1.31, 0.115, 0]}>
          <boxGeometry args={[0.065, 0.02, 5.45]} />
          <meshStandardMaterial color="#ff2038" emissive="#b40b20" emissiveIntensity={1.15} />
        </mesh>
      ))}
      <mesh position={[0, 0.118, -2.34]}>
        <boxGeometry args={[2.68, 0.022, 0.075]} />
        <meshStandardMaterial color="#ff2038" emissive="#b40b20" emissiveIntensity={1.15} />
      </mesh>
      <mesh position={[0, 0.12, 0]}>
        <boxGeometry args={[0.09, 0.024, 0.72]} />
        <meshStandardMaterial color="#ff7a88" emissive="#ff2038" emissiveIntensity={0.9} />
      </mesh>
    </group>
  );
}

function TrafficCar({ id, x, startZ, direction = -1, speed = 10, color = "#38424b", offset = 0 }) {
  const ref = useRef();

  useEffect(() => () => { if (id) removeTrafficActor(id); }, [id]);

  useFrame((state, delta) => {
    if (!ref.current) return;

    // Traffic Collision Avoidance: Check distance to hero vehicle
    const hero = getHeroActor();
    let currentSpeed = speed;

    if (hero && hero.position) {
      const heroPos = hero.position;
      const dx = Math.abs(ref.current.position.x - heroPos.x);
      // dz is positive if hero is ahead of traffic car along travel direction
      const dz = (heroPos.z - ref.current.position.z) * direction;

      // Only adjust speed if hero car is in the SAME lane (lateral clearance < 1.6m)
      if (dx < 1.6) {
        if (dz > 0 && dz < 18.0) {
          // Hero car is ahead in same lane: match speed to maintain safe gap
          const safeGap = 8.0;
          const stopGap = 5.5;
          if (dz <= stopGap && hero.speed < 0.5) {
            currentSpeed = 0; // Stop only if hero is completely stationary right ahead
          } else if (dz < safeGap) {
            currentSpeed = Math.min(speed, Math.max(0, hero.speed * ((dz - stopGap) / (safeGap - stopGap))));
          } else {
            currentSpeed = Math.min(speed, Math.max(hero.speed, speed * 0.8));
          }
        }
      }
    }

    ref.current.position.z += direction * currentSpeed * delta;
    const minZ = -350;
    const maxZ = 178;
    if (direction < 0 && ref.current.position.z < minZ) ref.current.position.z = maxZ + offset;
    if (direction > 0 && ref.current.position.z > maxZ) ref.current.position.z = minZ - offset;

    if (id) {
      updateTrafficActor(id, {
        position: ref.current.position,
        velocity: new THREE.Vector3(0, 0, direction * currentSpeed),
        speed: currentSpeed
      });
    }
  });

  // Fix #5: Proper multi-part car silhouette instead of plain boxes.
  const facing = direction < 0 ? 0 : Math.PI;
  const isForward = direction < 0;

  return (
    <group ref={ref} position={[x, 0.25, startZ]} rotation={[0, facing, 0]}>
      {/* Main body */}
      <mesh castShadow position={[0, 0.33, 0]}>
        <boxGeometry args={[1.72, 0.52, 3.85]} />
        <meshStandardMaterial color={color} metalness={0.75} roughness={0.22} />
      </mesh>

      {/* Cabin / greenhouse */}
      <mesh position={[0, 0.72, 0.18]}>
        <boxGeometry args={[1.44, 0.44, 1.72]} />
        <meshStandardMaterial color="#14202a" metalness={0.45} roughness={0.20} />
      </mesh>

      {/* Windshield tint */}
      <mesh position={[0, 0.70, -0.64]}>
        <boxGeometry args={[1.30, 0.36, 0.06]} />
        <meshStandardMaterial color="#1e3040" metalness={0.3} roughness={0.12} transparent opacity={0.82} />
      </mesh>
      <mesh position={[0, 0.70, 1.02]}>
        <boxGeometry args={[1.24, 0.32, 0.06]} />
        <meshStandardMaterial color="#1e3040" metalness={0.3} roughness={0.12} transparent opacity={0.76} />
      </mesh>

      {/* 4 wheels */}
      {[[-0.92, -1.32], [0.92, -1.32], [-0.92, 1.30], [0.92, 1.30]].map(([wx, wz], i) => (
        <group key={i} position={[wx, 0.08, wz]} rotation={[0, 0, Math.PI / 2]}>
          {/* Tyre */}
          <mesh>
            <cylinderGeometry args={[0.28, 0.28, 0.20, 14]} />
            <meshStandardMaterial color="#111518" roughness={0.92} />
          </mesh>
          {/* Rim */}
          <mesh>
            <cylinderGeometry args={[0.17, 0.17, 0.22, 10]} />
            <meshStandardMaterial color="#6a7580" metalness={0.85} roughness={0.22} />
          </mesh>
        </group>
      ))}

      {/* Front light bar */}
      <mesh position={[0, 0.36, isForward ? -1.94 : 1.94]}>
        <boxGeometry args={[1.28, 0.10, 0.04]} />
        <meshStandardMaterial
          color={isForward ? "#e9fbff" : "#ff3348"}
          emissive={isForward ? "#b7f0ff" : "#fa1830"}
          emissiveIntensity={2.4}
          toneMapped={false}
        />
      </mesh>

      {/* Rear light bar (opposite end) */}
      <mesh position={[0, 0.36, isForward ? 1.94 : -1.94]}>
        <boxGeometry args={[1.14, 0.08, 0.04]} />
        <meshStandardMaterial color="#ff2336" emissive="#e0111e" emissiveIntensity={1.8} toneMapped={false} />
      </mesh>

      {/* Side door lines */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.87, 0.40, 0]}>
          <mesh>
            <boxGeometry args={[0.022, 0.26, 3.50]} />
            <meshStandardMaterial color="#0c1016" roughness={0.9} />
          </mesh>
          {/* Door handle detail */}
          <mesh position={[side > 0 ? 0.02 : -0.02, 0.04, 0]}>
            <boxGeometry args={[0.06, 0.032, 0.14]} />
            <meshStandardMaterial color="#9daab5" metalness={0.82} roughness={0.18} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export default function World({ destinations, dawn = false }) {
  const background = useMemo(() => {
    const zBands = [146, 74, -7, -94, -185, -275, -348];
    const xs = [-106, -27, 27, 106];
    const towers = [];
    zBands.forEach((z, zi) => {
      xs.forEach((x, xi) => {
        // Keep a little extra space around destination podiums.
        const floors = 10 + ((zi * 5 + xi * 3) % 6);
        towers.push({
          x: x + ((zi + xi) % 2 ? 2.2 : -1.5),
          z: z + ((xi % 2) ? 5.5 : -4.5),
          floors,
          variant: zi * xs.length + xi
        });
      });
    });
    return towers;
  }, []);

  const lampZs = useMemo(() => Array.from({ length: 30 }, (_, i) => 170 - i * 18), []);

  return (
    <group>
      {/* Ground plane extends well beyond the camera fog. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, -90]} receiveShadow>
        <planeGeometry args={[300, 650]} />
        <meshStandardMaterial color={dawn ? "#6f7c84" : "#080d12"} roughness={1} />
      </mesh>

      {/* Three long boulevards. */}
      {[-52, 0, 52].map((x) => (
        <RoadStrip key={`v-${x}`} position={[x, 0, -88]} size={[ROAD_WIDTH, 0.13, 536]} dawn={dawn} />
      ))}

      {/* Six cross streets create a true city grid and real intersection turns. */}
      {CITY_ROWS.map((z) => (
        <RoadStrip key={`h-${z}`} position={[0, 0, z]} size={[142, 0.13, ROAD_WIDTH]} dawn={dawn} />
      ))}

      {/* Sidewalk ribbons along the main central avenue. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 6.35, 0.055, -88]} receiveShadow>
          <boxGeometry args={[2.25, 0.12, 536]} />
          <meshStandardMaterial color="#252a2f" roughness={0.88} />
        </mesh>
      ))}

      {/* Long perspective rhythm — lamps make distance unmistakable. */}
      {lampZs.flatMap((z, i) => [
        <StreetLight key={`cl-${i}`} position={[-6.35, 0, z]} bright={i % 5 === 0} dawn={dawn} />,
        <StreetLight key={`cr-${i}`} position={[6.35, 0, z]} rotation={Math.PI} bright={i % 5 === 2} dawn={dawn} />,
        <StreetLight key={`ll-${i}`} position={[-58.3, 0, z]} bright={false} dawn={dawn} />,
        <StreetLight key={`rr-${i}`} position={[58.3, 0, z]} rotation={Math.PI} bright={false} dawn={dawn} />
      ])}

      {/* Destination parking bays. */}
      <ParkingBay position={[67, 0, 110]} rotation={Math.PI / 2} />
      <ParkingBay position={[-67, 0, 35]} rotation={Math.PI / 2} />
      <ParkingBay position={[67, 0, -50]} rotation={Math.PI / 2} />
      <ParkingBay position={[-67, 0, -140]} rotation={Math.PI / 2} />
      <ParkingBay position={[67, 0, -230]} rotation={Math.PI / 2} />
      <ParkingBay position={[-67, 0, -320]} rotation={Math.PI / 2} />

      {destinations.map((destination) => (
        <DestinationTower key={destination.id} destination={destination} />
      ))}

      {background.map((tower) => (
        <BackgroundTower key={`${tower.x}-${tower.z}`} {...tower} />
      ))}

      {/* Ambient traffic moving at natural city cruising speeds. */}
      <TrafficCar id="lead-main" x={-LANE_OFFSET} startZ={126} direction={-1} speed={19.5} color="#39444e" />
      <TrafficCar id="passing-main" x={LANE_OFFSET} startZ={86} direction={-1} speed={23.0} color="#7b2a31" offset={18} />
      <TrafficCar id="side-left-1" x={-50.4} startZ={128} direction={-1} speed={20.0} color="#313a44" />
      <TrafficCar id="side-left-2" x={-53.7} startZ={-90} direction={1} speed={18.5} color="#6a2028" offset={20} />
      <TrafficCar id="side-right-1" x={50.4} startZ={62} direction={-1} speed={22.0} color="#263f4b" offset={35} />
      <TrafficCar id="side-right-2" x={53.7} startZ={-250} direction={1} speed={19.0} color="#414850" offset={50} />

      {/* Distant landmark improves skyline depth. */}
      <group position={[110, 0, -82]}>
        <mesh position={[0, 14, 0]} castShadow>
          <cylinderGeometry args={[4.5, 6.2, 28, 10]} />
          <meshPhysicalMaterial color="#173b4d" metalness={0.68} roughness={0.12} />
        </mesh>
        <mesh position={[0, 28.8, 0]}>
          <cylinderGeometry args={[2.8, 4.4, 1.5, 10]} />
          <meshStandardMaterial color="#8a1425" emissive="#500610" emissiveIntensity={0.52} />
        </mesh>
      </group>
    </group>
  );
}
