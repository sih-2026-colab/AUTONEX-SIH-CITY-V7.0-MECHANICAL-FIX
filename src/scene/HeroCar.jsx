import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef
} from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

const MODEL_PATH = "/models/mustang-gt500.glb";

// Realistic GT500 road-car dimensions after scaling: ~1.99 m wide,
// ~1.47 m high and ~4.84 m long.
const MUSTANG_SCALE = 0.90;
const MODEL_CENTER_Z = 1.4448;
const MODEL_GROUND_Y = -0.0200;
const MODEL_Z_OFFSET = MODEL_CENTER_Z * MUSTANG_SCALE;
const MODEL_Y_OFFSET = 0.085 - 0.34 - MODEL_GROUND_Y * MUSTANG_SCALE;
const LOCAL_Y = new THREE.Vector3(0, 1, 0);

const HeroCar = forwardRef(function HeroCar(
  { engineOn = false, doorOpen = false, headlights = true, cockpitActive = false, onReady },
  ref
) {
  const group = useRef();
  const { scene } = useGLTF(MODEL_PATH);
  // SkeletonUtils.clone is required for this rigged GLB. A normal Object3D.clone(true)
  // can leave SkinnedMesh skeletons pointing at the cached source bones, which
  // makes door/interior bone animation unreliable.
  const model = useMemo(() => cloneSkeleton(scene), [scene]);

  // The DEF-Wheel nodes are the real wheel-center pivots in this Sketchfab rig.
  // Spin + steering must be composed on these pivots; rotating their correction
  // children caused the visible wheels to appear static / unstable.
  const frontLeftWheel = useRef();
  const frontRightWheel = useRef();
  const rearLeftWheel = useRef();
  const rearRightWheel = useRef();
  const frontLeftBaseQ = useRef();
  const frontRightBaseQ = useRef();
  const rearLeftBaseQ = useRef();
  const rearRightBaseQ = useRef();
  const wheelSpinAngle = useRef(0);

  const driverDoor = useRef();
  const driverDoorClosedQ = useRef();
  const steeringWheel = useRef();
  const steeringClosedQ = useRef();
  const dashLight = useRef();
  const leftIndicator = useRef();
  const rightIndicator = useRef();

  const hoodParts = useRef([]);

  useImperativeHandle(ref, () => group.current);

  useEffect(() => {
    model.traverse((obj) => {
      obj.castShadow = false;
      obj.receiveShadow = false;
      obj.frustumCulled = true;
      if (obj.isMesh && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((mat) => {
          if ("metalness" in mat && mat.metalness < 0.12) mat.metalness = 0.18;
          if ("roughness" in mat) mat.roughness = Math.min(0.85, mat.roughness ?? 0.55);
          if ("envMapIntensity" in mat) mat.envMapIntensity = 1.05;
          mat.needsUpdate = true;
        });
      }
    });

    // IMPORTANT: do NOT hide `extra controls_24`. In this Sketchfab GLB that
    // hierarchy contains the skinned doors, windows and interior pieces used by
    // the door bones. Hiding it was the reason cockpit/doors looked incomplete.
    const exportCone = model.getObjectByName("Cone_95");
    if (exportCone) exportCone.visible = false;

    // ── Fix #1: Robust wheel bone discovery ──────────────────────────────────
    // Try a priority list of known names; fall back to a regex scan over the
    // entire model so wheels are found even after a GLB re-export renames them.
    function findBone(primaryNames, fallbackPattern) {
      for (const name of primaryNames) {
        const obj = model.getObjectByName(name);
        if (obj) return obj;
      }
      // Regex fallback: scan all objects for the first match.
      let found = null;
      model.traverse((obj) => {
        if (!found && fallbackPattern.test(obj.name)) found = obj;
      });
      if (!found) console.warn(`[HeroCar] bone not found for pattern ${fallbackPattern}`);
      return found;
    }

    frontLeftWheel.current  = findBone(["DEF-Wheel.Ft.L_28", "Wheel.Ft.L", "wheel_front_left"],  /wheel.*ft.*l|front.*left.*wheel/i);
    frontRightWheel.current = findBone(["DEF-Wheel.Ft.R_30", "Wheel.Ft.R", "wheel_front_right"], /wheel.*ft.*r|front.*right.*wheel/i);
    rearLeftWheel.current   = findBone(["DEF-Wheel.Bk.L_32", "Wheel.Bk.L", "wheel_rear_left"],   /wheel.*bk.*l|rear.*left.*wheel/i);
    rearRightWheel.current  = findBone(["DEF-Wheel.Bk.R_34", "Wheel.Bk.R", "wheel_rear_right"],  /wheel.*bk.*r|rear.*right.*wheel/i);

    if (frontLeftWheel.current)  frontLeftBaseQ.current  = frontLeftWheel.current.quaternion.clone();
    if (frontRightWheel.current) frontRightBaseQ.current = frontRightWheel.current.quaternion.clone();
    if (rearLeftWheel.current)   rearLeftBaseQ.current   = rearLeftWheel.current.quaternion.clone();
    if (rearRightWheel.current)  rearRightBaseQ.current  = rearRightWheel.current.quaternion.clone();

    // After the model's 180-degree recenter rotation, the source right-door bone
    // is on the driver's/steering-wheel side of the displayed Mustang.
    driverDoor.current = model.getObjectByName("right door_17")
      || findBone(["door_right", "RightDoor"], /right.*door|door.*r/i);
    if (driverDoor.current) {
      driverDoorClosedQ.current = driverDoor.current.quaternion.clone();
    } else {
      console.warn("[HeroCar] driver door bone not found — door animation disabled");
    }

    // ── Fix #7 & #11: Fix steering bone lookup & error reporting ─────────────
    steeringWheel.current =
      model.getObjectByName("steering bone_10") ||
      model.getObjectByName("stering bone_10")  ||
      model.getObjectByName("steering wheel_23") ||
      model.getObjectByName("stering wheel_23")  ||
      findBone(["SteeringWheel", "steering_wheel"], /steering.*wheel|stering.*wheel|steering.*bone|stering.*bone/i);
    if (steeringWheel.current) {
      steeringClosedQ.current = steeringWheel.current.quaternion.clone();
    } else {
      console.warn("[HeroCar] steering wheel bone not found — steering animation disabled & using default cockpit eye");
    }

    // Derive the cockpit eye from the imported steering-wheel position instead
    // of guessing a camera coordinate. Fallback to default if bone missing.
    if (group.current) {
      if (steeringWheel.current) {
        group.current.updateMatrixWorld(true);
        steeringWheel.current.updateMatrixWorld(true);
        const steeringWorld = new THREE.Vector3();
        steeringWheel.current.getWorldPosition(steeringWorld);
        const steeringLocal = group.current.worldToLocal(steeringWorld.clone());
        group.current.userData.driverEyeLocal = steeringLocal.clone().add(new THREE.Vector3(0, 0.28, 0.38));
        group.current.userData.driverLookLocal = new THREE.Vector3(
          steeringLocal.x,
          steeringLocal.y + 0.24,
          -15.5
        );
        group.current.userData.windshieldEntryLocal = steeringLocal.clone().add(new THREE.Vector3(0, 0.30, -0.10));
      } else {
        group.current.userData.driverEyeLocal = new THREE.Vector3(-0.42, 0.96, 0.16);
        group.current.userData.driverLookLocal = new THREE.Vector3(-0.44, 0.92, -15.5);
        group.current.userData.windshieldEntryLocal = new THREE.Vector3(-0.40, 1.00, -0.26);
      }
    }

    // Keep the imported bonnet/hood geometry available: this is the engine cover.
    hoodParts.current = [
      model.getObjectByName("hood_9"),
      model.getObjectByName("bonnet_ok_20"),
      model.getObjectByName("bonnet_ok_20_correction")
    ].filter(Boolean);
    if (hoodParts.current.length > 0) {
      hoodParts.current.forEach((obj) => { obj.visible = true; });
    } else {
      console.warn("[HeroCar] bonnet/hood meshes not found");
    }

    onReady?.();
  }, [model, onReady]);


  useFrame((state, delta) => {
    const carObject = group.current;
    const linearSpeed = carObject?.userData?.speed ?? 0;
    const steeringInput = carObject?.userData?.steer ?? 0;

    // Fix #6: Spin wheels for both forward AND reverse movement.
    // The signed speed drives the angle so reverse speed spins them backward.
    if (Math.abs(linearSpeed) > 0.02) {
      wheelSpinAngle.current = (wheelSpinAngle.current - (linearSpeed / 0.355) * delta) % (Math.PI * 2);
    }

    // In this GLB's wheel-pivot coordinate system local X is the axle and local Z
    // is approximately vertical, so compose steering and spin on the real pivots.
    const spinQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      wheelSpinAngle.current
    );
    const steerQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      steeringInput * 0.24
    );

    if (frontLeftWheel.current && frontLeftBaseQ.current) {
      frontLeftWheel.current.quaternion.copy(frontLeftBaseQ.current).multiply(steerQ).multiply(spinQ);
    }
    if (frontRightWheel.current && frontRightBaseQ.current) {
      frontRightWheel.current.quaternion.copy(frontRightBaseQ.current).multiply(steerQ).multiply(spinQ);
    }
    if (rearLeftWheel.current && rearLeftBaseQ.current) {
      rearLeftWheel.current.quaternion.copy(rearLeftBaseQ.current).multiply(spinQ);
    }
    if (rearRightWheel.current && rearRightBaseQ.current) {
      rearRightWheel.current.quaternion.copy(rearRightBaseQ.current).multiply(spinQ);
    }

    // Animate the real skinned driver-side door bone while preserving its imported
    // closed orientation. The door only opens after exact destination docking.
    if (driverDoor.current && driverDoorClosedQ.current) {
      const doorSwingQ = new THREE.Quaternion().setFromAxisAngle(LOCAL_Y, doorOpen ? -1.04 : 0);
      const doorTargetQ = driverDoorClosedQ.current.clone().multiply(doorSwingQ);
      driverDoor.current.quaternion.slerp(doorTargetQ, 1 - Math.exp(-5 * delta));
    }

    // Steering wheel follows the planner and turns dynamically in cockpit view.
    if (steeringWheel.current && steeringClosedQ.current) {
      const wheelSteerAngle = steeringInput * 2.1;
      const wheelSteerQ = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        wheelSteerAngle
      );
      const steerTargetQ = steeringClosedQ.current.clone().multiply(wheelSteerQ);
      steeringWheel.current.quaternion.slerp(steerTargetQ, 1 - Math.exp(-12 * delta));
    }

    const signal = carObject?.userData?.signal ?? null;
    const blinkOn = Math.floor(state.clock.elapsedTime * 2.4) % 2 === 0;
    if (leftIndicator.current) leftIndicator.current.visible = signal === "LEFT" && blinkOn;
    if (rightIndicator.current) rightIndicator.current.visible = signal === "RIGHT" && blinkOn;

    if (dashLight.current) {
      dashLight.current.intensity = engineOn
        ? 0.55 + Math.sin(state.clock.elapsedTime * 2.1) * 0.04
        : 0;
    }
  });

  return (
    <group ref={group} position={[0, 0.34, 165]} rotation={[0, 0, 0]}>
      <group
        scale={[MUSTANG_SCALE, MUSTANG_SCALE, MUSTANG_SCALE]}
        position={[0, MODEL_Y_OFFSET, MODEL_Z_OFFSET]}
        rotation={[0, Math.PI, 0]}
      >
        <primitive object={model} />
      </group>

      {/* Warm premium cabin illumination. */}
      <pointLight ref={dashLight} position={[-0.34, 0.94, -0.15]} color="#ffd9a6" distance={2.4} intensity={0} />
      <pointLight position={[-0.30, 0.90, 0.12]} color="#ffb870" distance={1.8} intensity={engineOn ? 0.18 : 0} />
      <pointLight position={[0.28, 0.90, 0.12]} color="#7fe2ff" distance={1.6} intensity={engineOn ? 0.10 : 0} />

      {/* Mandatory turn / lane-change indicators. */}
      <group ref={leftIndicator} visible={false}>
        <mesh position={[-0.91, 0.65, -2.38]}>
          <boxGeometry args={[0.18, 0.10, 0.05]} />
          <meshStandardMaterial color="#ffb000" emissive="#ff9a00" emissiveIntensity={8} toneMapped={false} />
        </mesh>
        <mesh position={[-0.91, 0.65, 2.30]}>
          <boxGeometry args={[0.18, 0.10, 0.05]} />
          <meshStandardMaterial color="#ffb000" emissive="#ff9a00" emissiveIntensity={8} toneMapped={false} />
        </mesh>
        <pointLight position={[-0.96, 0.69, -2.28]} color="#ffad22" intensity={2.6} distance={3.5} />
      </group>
      <group ref={rightIndicator} visible={false}>
        <mesh position={[0.91, 0.65, -2.38]}>
          <boxGeometry args={[0.18, 0.10, 0.05]} />
          <meshStandardMaterial color="#ffb000" emissive="#ff9a00" emissiveIntensity={8} toneMapped={false} />
        </mesh>
        <mesh position={[0.91, 0.65, 2.30]}>
          <boxGeometry args={[0.18, 0.10, 0.05]} />
          <meshStandardMaterial color="#ffb000" emissive="#ff9a00" emissiveIntensity={8} toneMapped={false} />
        </mesh>
        <pointLight position={[0.96, 0.69, -2.28]} color="#ffad22" intensity={2.6} distance={3.5} />
      </group>

      {headlights && (
        <>
          <pointLight position={[-0.68, 0.69, -2.44]} color="#f8fbff" intensity={4.2} distance={18} />
          <pointLight position={[0.68, 0.69, -2.44]} color="#f8fbff" intensity={4.2} distance={18} />
        </>
      )}
    </group>
  );
});

useGLTF.preload(MODEL_PATH);

export default HeroCar;
