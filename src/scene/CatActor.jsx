import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DETECTION_RANGE } from "./catReflexEngine.js";

// Cat behaviour state machine
// IDLE        -> cat is off-screen or on the sidewalk
// APPROACHING -> cat walks toward the road edge
// CROSSING    -> cat is crossing the road (danger zone)
// PAUSED      -> cat stops mid-road (unpredictable pause)
// RETREATING  -> cat turns back
// DONE        -> cat has fully crossed

const STATES = { IDLE: 0, APPROACHING: 1, CROSSING: 2, PAUSED: 3, RETREATING: 4, DONE: 5 };

// Cat physical dimensions (matches catReflexEngine constants)
const CAT_BODY_W = 0.32;
const CAT_BODY_H = 0.22;
const CAT_BODY_L = 0.44;

// Returns a random float in [min, max)
function rnd(min, max) { return min + Math.random() * (max - min); }

/**
 * CatActor
 * ─────────
 * Self-contained animated cat that:
 *  - Spawns on a sidewalk beside the ego's road
 *  - Waits until the ego vehicle is approaching (within detection range)
 *  - Suddenly darts across the road at a random speed
 *  - May pause mid-road to simulate Indian street-animal unpredictability
 *  - Resets after crossing or retreating
 *
 * Props:
 *   active        {bool}    – whether cat reflex mode is enabled
 *   egoPosition   {THREE.Vector3|null}
 *   onCatState    {fn}      – callback({ catPos, catState, catVisible })
 *   scenarioType  {number}  – 0=normal cross, 1=pause, 2=retreat, 3=fast-cross
 */
const CatActor = forwardRef(function CatActor({ active, egoPosition, egoYaw = 0, onCatState, scenarioType = 0 }, ref) {
  const groupRef = useRef();
  const stateRef = useRef(STATES.IDLE);
  const phaseTimer = useRef(0);
  const catSpeed = useRef(1.8);
  const crossDir = useRef(1); // +1 = right-to-left, -1 = left-to-right
  const pauseDuration = useRef(0);
  const legPhase = useRef(0);

  // Direction-aware motion vectors
  const spawnPos = useRef(new THREE.Vector3());
  const targetPos = useRef(new THREE.Vector3());
  const roadEdgePos = useRef(new THREE.Vector3());
  const crossVec = useRef(new THREE.Vector3());

  useImperativeHandle(ref, () => ({
    reset: () => {
      stateRef.current = STATES.IDLE;
      phaseTimer.current = 0;
    },
    getPosition: () => groupRef.current ? {
      x: groupRef.current.position.x,
      z: groupRef.current.position.z
    } : null,
    isVisible: () => stateRef.current !== STATES.IDLE && stateRef.current !== STATES.DONE,
  }));

  // Reset cat position and behaviour when activated or scenario changes
  useEffect(() => {
    if (!active || !groupRef.current) return;

    const egoX = egoPosition ? egoPosition.x : 0;
    const egoZ = egoPosition ? egoPosition.z : 0;
    const yaw = egoYaw || 0;

    // Vehicle forward and right vectors in world space
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    // Spawn 14 to 18m ahead of vehicle along current motion vector
    const forwardDist = rnd(14, 18);
    const sideDist = 6.2; // sidewalk offset
    const roadEdgeDist = 4.2;

    const dir = Math.random() > 0.5 ? 1 : -1;
    crossDir.current = dir;

    const startX = egoX + fwdX * forwardDist + rightX * sideDist * dir;
    const startZ = egoZ + fwdZ * forwardDist + rightZ * sideDist * dir;

    const edgeX = egoX + fwdX * forwardDist + rightX * roadEdgeDist * dir;
    const edgeZ = egoZ + fwdZ * forwardDist + rightZ * roadEdgeDist * dir;

    const endX = egoX + fwdX * forwardDist - rightX * sideDist * dir;
    const endZ = egoZ + fwdZ * forwardDist - rightZ * sideDist * dir;

    spawnPos.current.set(startX, 0, startZ);
    roadEdgePos.current.set(edgeX, 0, edgeZ);
    targetPos.current.set(endX, 0, endZ);

    // Crossing direction vector (perpendicular to road)
    crossVec.current.set(-rightX * dir, 0, -rightZ * dir).normalize();

    if (groupRef.current) {
      groupRef.current.position.set(startX, 0, startZ);
      // Face towards crossing direction
      const catYaw = Math.atan2(crossVec.current.x, crossVec.current.z);
      groupRef.current.rotation.y = catYaw;
    }

    // Speed and scenario parameters
    switch (scenarioType) {
      case 1: // pausing cat
        catSpeed.current = rnd(1.4, 2.0);
        pauseDuration.current = rnd(1.2, 2.5);
        break;
      case 2: // retreating cat
        catSpeed.current = rnd(1.2, 1.8);
        pauseDuration.current = 0;
        break;
      case 3: // fast crossing
        catSpeed.current = rnd(3.2, 4.2);
        pauseDuration.current = 0;
        break;
      default: // normal crossing
        catSpeed.current = rnd(1.8, 2.6);
        pauseDuration.current = 0;
    }

    stateRef.current = STATES.APPROACHING;
    phaseTimer.current = 0;
  }, [active, scenarioType]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state, delta) => {
    if (!groupRef.current || !active) return;
    const dt = Math.min(delta, 0.05);
    const cat = groupRef.current;
    const catState = stateRef.current;

    // Leg/tail animation
    legPhase.current += dt * catSpeed.current * 6;

    switch (catState) {
      case STATES.APPROACHING: {
        // Move toward the road edge from sidewalk
        const distToEdge = cat.position.distanceTo(roadEdgePos.current);
        if (distToEdge < 0.25) {
          stateRef.current = STATES.CROSSING;
          phaseTimer.current = 0;
        } else {
          cat.position.x += crossVec.current.x * catSpeed.current * 0.6 * dt;
          cat.position.z += crossVec.current.z * catSpeed.current * 0.6 * dt;
        }
        break;
      }

      case STATES.CROSSING: {
        phaseTimer.current += dt;
        const distToTarget = cat.position.distanceTo(targetPos.current);

        if (distToTarget < 0.35) {
          stateRef.current = STATES.DONE;
          onCatState?.({ catPos: null, catState: STATES.DONE, catVisible: false });
          return;
        }

        const distFromSpawn = cat.position.distanceTo(spawnPos.current);

        // Scenario 1: pause mid-road (approx 6-8m into crossing)
        if (scenarioType === 1 && distFromSpawn > 5.0 && distFromSpawn < 7.5 && phaseTimer.current > 0.3) {
          stateRef.current = STATES.PAUSED;
          phaseTimer.current = 0;
          break;
        }

        // Scenario 2: retreat after entering road (~3.5m into crossing)
        if (scenarioType === 2 && distFromSpawn > 3.5 && phaseTimer.current > 0.4) {
          stateRef.current = STATES.RETREATING;
          phaseTimer.current = 0;
          break;
        }

        cat.position.x += crossVec.current.x * catSpeed.current * dt;
        cat.position.z += crossVec.current.z * catSpeed.current * dt;
        break;
      }

      case STATES.PAUSED: {
        phaseTimer.current += dt;
        cat.rotation.y += Math.sin(phaseTimer.current * 3.0) * 0.008;
        if (phaseTimer.current >= pauseDuration.current) {
          stateRef.current = STATES.CROSSING;
        }
        break;
      }

      case STATES.RETREATING: {
        const distToSpawn = cat.position.distanceTo(spawnPos.current);
        if (distToSpawn < 0.35) {
          stateRef.current = STATES.DONE;
          onCatState?.({ catPos: null, catState: STATES.DONE, catVisible: false });
          return;
        }
        // Move backward toward spawn position
        const catYaw = Math.atan2(-crossVec.current.x, -crossVec.current.z);
        cat.rotation.y = catYaw;
        cat.position.x -= crossVec.current.x * catSpeed.current * dt;
        cat.position.z -= crossVec.current.z * catSpeed.current * dt;
        break;
      }

      case STATES.DONE:
      case STATES.IDLE:
        return;
    }

    // Leg animation - oscillate leg groups
    const legSwing = Math.sin(legPhase.current) * 0.28;

    // Report cat position back to Experience
    onCatState?.({
      catPos: { x: cat.position.x, z: cat.position.z },
      catState,
      catVisible: catState === STATES.CROSSING || catState === STATES.PAUSED || catState === STATES.APPROACHING || catState === STATES.RETREATING,
    });
  });

  const isVisible = active;

  return (
    <group ref={groupRef} visible={isVisible}>
      {/* Body */}
      <mesh position={[0, CAT_BODY_H / 2, 0]}>
        <boxGeometry args={[CAT_BODY_W, CAT_BODY_H, CAT_BODY_L]} />
        <meshStandardMaterial color="#c8a87c" roughness={0.88} />
      </mesh>

      {/* Head */}
      <mesh position={[0, CAT_BODY_H + 0.10, CAT_BODY_L * 0.38]}>
        <sphereGeometry args={[0.14, 8, 6]} />
        <meshStandardMaterial color="#c8a87c" roughness={0.88} />
      </mesh>

      {/* Ears */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.07, CAT_BODY_H + 0.22, CAT_BODY_L * 0.38]} rotation={[0, 0, s * 0.3]}>
          <coneGeometry args={[0.04, 0.08, 4]} />
          <meshStandardMaterial color="#c8a87c" roughness={0.88} />
        </mesh>
      ))}

      {/* Eyes */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.055, CAT_BODY_H + 0.115, CAT_BODY_L * 0.52]}>
          <sphereGeometry args={[0.022, 6, 4]} />
          <meshStandardMaterial color="#ffdd44" emissive="#ffaa00" emissiveIntensity={1.2} />
        </mesh>
      ))}

      {/* Tail */}
      <mesh position={[0, CAT_BODY_H * 0.7, -CAT_BODY_L * 0.52]} rotation={[0.7, 0, 0]}>
        <cylinderGeometry args={[0.025, 0.015, 0.38, 6]} />
        <meshStandardMaterial color="#b89060" roughness={0.9} />
      </mesh>

      {/* Front legs */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.10, 0.04, CAT_BODY_L * 0.28]}>
          <cylinderGeometry args={[0.025, 0.022, 0.18, 6]} />
          <meshStandardMaterial color="#c4a478" roughness={0.9} />
        </mesh>
      ))}

      {/* Rear legs */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.10, 0.04, -CAT_BODY_L * 0.28]}>
          <cylinderGeometry args={[0.025, 0.022, 0.18, 6]} />
          <meshStandardMaterial color="#c4a478" roughness={0.9} />
        </mesh>
      ))}

      {/* Subtle ambient glow so the cat is visible in the scene */}
      <pointLight position={[0, 0.4, 0]} color="#ffc870" intensity={0.6} distance={3.5} />
    </group>
  );
});

export default CatActor;
export { STATES as CAT_STATES };
