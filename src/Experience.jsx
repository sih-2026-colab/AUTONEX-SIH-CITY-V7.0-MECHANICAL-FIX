import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import HeroCar from "./scene/HeroCar";
import World from "./scene/World";
import { DESTINATIONS } from "./data";
import {
  DESTINATION_NODE,
  HOME_NODE,
  buildPolylineMetrics,
  makeRoadLockedWaypoints,
  nearestRoadNode,
  pointAlongPolyline,
  shortestNodePath,
  vecForNode,
  LANE_OFFSET
} from "./scene/roadNetwork";
import { getTrafficActors, updateHeroActor } from "./scene/trafficState";

const HOME = vecForNode(HOME_NODE);
const HOME_LANE = HOME.clone().add(new THREE.Vector3(-LANE_OFFSET, 0, 0));
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const INTRO_DURATION = 3.2;

// Cockpit points are vehicle-local coordinates. The imported GT500's steering
// assembly sits on local -X after the model is recentered/rotated in HeroCar.
const DRIVER_EYE_LOCAL = new THREE.Vector3(-0.42, 0.96, 0.16);
const DRIVER_LOOK_LOCAL = new THREE.Vector3(-0.44, 0.92, -15.5);
const WINDSHIELD_ENTRY_LOCAL = new THREE.Vector3(-0.40, 1.00, -0.26);

function carLocalToWorld(car, local) {
  return car.position.clone().add(local.clone().applyAxisAngle(Y_AXIS, car.rotation.y));
}

function driverEyeLocal(car) {
  return car.userData?.driverEyeLocal ?? DRIVER_EYE_LOCAL;
}

function driverLookLocal(car) {
  return car.userData?.driverLookLocal ?? DRIVER_LOOK_LOCAL;
}

function windshieldEntryLocal(car) {
  return car.userData?.windshieldEntryLocal ?? WINDSHIELD_ENTRY_LOCAL;
}

function smooth01(t) {
  const v = THREE.MathUtils.clamp(t, 0, 1);
  return v * v * (3 - 2 * v);
}

function dampAngle(current, target, lambda, delta) {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + diff * (1 - Math.exp(-lambda * delta));
}

function dampFov(camera, target, delta) {
  const next = THREE.MathUtils.damp(camera.fov, target, 8, delta);
  if (Math.abs(next - camera.fov) > 0.001) {
    camera.fov = next;
    camera.updateProjectionMatrix();
  }
}

export default function Experience({
  phase,
  engineOn,
  target,
  arrivedAt,
  onArrival,
  onDriveProgress,
  onSpeedChange,
  onDriveStatus,
  doorOpen,
  onSceneReady,
  onIntroProgress,
  onIntroComplete,
  cameraMode = "cockpit"
}) {
  const carRef = useRef();
  const cameraRig = useRef();
  const introTime = useRef(0);
  const lastReportedSpeed = useRef(-1);
  const lastIntroPercent = useRef(-1);
  const introCompleted = useRef(false);
  const { camera } = useThree();

  useEffect(() => {
    camera.near = 0.03;
    camera.far = 700;
    camera.updateProjectionMatrix();
  }, [camera]);
  const route = useRef({
    active: false,
    points: [HOME.clone()],
    cumulative: [0],
    total: 0,
    distance: 0,
    speed: 0,
    targetId: null,
    laneOffset: LANE_OFFSET,
    desiredLaneOffset: LANE_OFFSET,
    mode: "CRUISE",
    overtakeActorId: null,
    dockPoint: HOME.clone()
  });

  const destinations = useMemo(() => DESTINATIONS, []);

  useEffect(() => {
    if (!carRef.current || !cameraRig.current) return;
    const car = carRef.current;

    if (phase === "intro") {
      introTime.current = 0;
      introCompleted.current = false;
      lastIntroPercent.current = -1;
      onIntroProgress?.(0);
      route.current.active = false;
      car.position.set(-LANE_OFFSET, 0.34, 216);
      car.rotation.set(0, 0, 0);
      car.userData.speed = 35;
      car.userData.steer = 0;
      cameraRig.current.position.set(4.8, 1.55, 203);
      camera.position.copy(cameraRig.current.position);
      camera.fov = 39;
      camera.updateProjectionMatrix();
    }

    if (phase === "cockpit" || phase === "boot") {
      car.position.copy(HOME_LANE);
      car.rotation.set(0, 0, 0);
      car.userData.speed = 0;
      car.userData.steer = 0;
      route.current.active = false;
    }
  }, [phase, camera]);

  useEffect(() => {
    if (!target || !carRef.current || arrivedAt) return;

    const startNode = nearestRoadNode(carRef.current.position);
    const destNode = DESTINATION_NODE[target.id];
    const nodePath = shortestNodePath(startNode, destNode);
    const points = makeRoadLockedWaypoints(nodePath, carRef.current.position);
    const { cumulative, total } = buildPolylineMetrics(points);

    route.current.active = true;
    route.current.points = points;
    route.current.cumulative = cumulative;
    route.current.total = total;
    route.current.distance = 0;
    route.current.speed = 0;
    route.current.targetId = target.id;
    route.current.laneOffset = LANE_OFFSET;
    route.current.desiredLaneOffset = LANE_OFFSET;
    route.current.mode = "CRUISE";
    route.current.overtakeActorId = null;
    route.current.dockPoint = vecForNode(destNode);

    onDriveProgress?.(0);
    onSpeedChange?.(0);
  }, [target, arrivedAt, onDriveProgress, onSpeedChange]);

  useFrame((state, delta) => {
    if (!carRef.current || !cameraRig.current) return;
    const car = carRef.current;

    // Broadcast hero car position to traffic system for dual-sided collision avoidance
    updateHeroActor({ position: car.position, speed: car.userData?.speed ?? 0 });

    if (phase === "loading") return;

    if (phase === "intro") {
      const introDelta = Math.min(delta, 0.05);
      introTime.current = Math.min(INTRO_DURATION, introTime.current + introDelta);
      const t = introTime.current;
      const p = smooth01(t / INTRO_DURATION);

      const startZ = 216;
      const endZ = HOME_LANE.z;
      car.position.set(-LANE_OFFSET, 0.34, THREE.MathUtils.lerp(startZ, endZ, p));
      car.userData.speed = p * 25;
      car.userData.steer = 0;

      const introPct = Math.round(p * 100);
      if (introPct !== lastIntroPercent.current) {
        lastIntroPercent.current = introPct;
        onIntroProgress?.(p);
      }

      // ── SINGLE CONTINUOUS FLUID INTRO FLIGHT ─────────────────────────────────────
      // One smooth, unbroken 3D camera trajectory from exterior front-left directly
      // into the driver cockpit seat — ZERO jump cuts, ZERO repeated seat views!
      const startExteriorCam = carLocalToWorld(car, new THREE.Vector3(-2.2, 1.45, 5.5));
      const startExteriorLook = carLocalToWorld(car, new THREE.Vector3(-0.35, 0.90, -1.8));
      const endCockpitCam = carLocalToWorld(car, driverEyeLocal(car));
      const endCockpitLook = carLocalToWorld(car, driverLookLocal(car));

      // Ease-in-out flight progress
      const flightP = p * p * (3 - 2 * p);
      const currentCamPos = new THREE.Vector3().lerpVectors(startExteriorCam, endCockpitCam, flightP);
      const currentLookPos = new THREE.Vector3().lerpVectors(startExteriorLook, endCockpitLook, flightP);

      cameraRig.current.position.copy(currentCamPos);
      camera.position.copy(currentCamPos);
      camera.lookAt(currentLookPos);
      dampFov(camera, THREE.MathUtils.lerp(48, 74, flightP), delta);

      if (t >= INTRO_DURATION && !introCompleted.current) {
        introCompleted.current = true;
        onIntroProgress?.(1);
        onIntroComplete?.();
      }
      return;
    }

    if (phase === "cockpit" || phase === "boot") {
      // Hold the camera physically inside the GT500 cabin. This used to use
      // absolute world X coordinates, which placed the camera beside the car
      // whenever the vehicle occupied the lane offset.
      const targetCam = carLocalToWorld(car, driverEyeLocal(car));
      const targetLook = carLocalToWorld(car, driverLookLocal(car));
      // No follow smoothing here: smoothing causes the driver's eye to lag behind
      // the car during acceleration/turning and looks like the camera moves back
      // and forth inside the cabin. Lock it directly to the driver-eye point.
      cameraRig.current.position.copy(targetCam);
      camera.position.copy(targetCam);
      camera.lookAt(targetLook);
      dampFov(camera, 74, delta);
      return;
    }

    if (route.current.active) {
      const r = route.current;
      const remaining = Math.max(0, r.total - r.distance);
      const nowSample = pointAlongPolyline(r.points, r.cumulative, r.distance, r.laneOffset);
      const futureSample = pointAlongPolyline(
        r.points,
        r.cumulative,
        Math.min(r.total, r.distance + 12),
        r.laneOffset
      );

      const tangent = nowSample.tangent;
      const futureTangent = futureSample.tangent;
      const turnDot = THREE.MathUtils.clamp(tangent.dot(futureTangent), -1, 1);
      const turnAngle = Math.acos(turnDot);
      const signedTurn = Math.atan2(
        tangent.z * futureTangent.x - tangent.x * futureTangent.z,
        turnDot
      );
      // Turn detection: only trigger for sharp intersection turns (>20 degrees) nearing within 14m
      const turnApproaching = turnAngle > 0.35 && remaining > 5;

      const normal = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
      const actors = getTrafficActors();
      let lead = null;
      let leadDistance = Infinity;

      for (const actor of actors) {
        const rel = actor.position.clone().sub(car.position);
        const longitudinal = rel.dot(tangent);
        const lateral = Math.abs(rel.dot(normal));
        const actorDir = actor.velocity.lengthSq() > 0.01 ? actor.velocity.clone().normalize() : tangent;
        if (longitudinal > 0 && longitudinal < 50 && lateral < 1.8 && actorDir.dot(tangent) > 0.3) {
          if (longitudinal < leadDistance) {
            leadDistance = longitudinal;
            lead = actor;
          }
        }
      }

      const passingOffset = -LANE_OFFSET;
      const laneDelta = passingOffset - r.laneOffset;
      const passingLaneCenter = car.position.clone().add(normal.clone().multiplyScalar(laneDelta));
      let passingClear = true;
      for (const actor of actors) {
        if (lead && actor.id === lead.id) continue;
        const rel = actor.position.clone().sub(passingLaneCenter);
        const longitudinal = rel.dot(tangent);
        const lateral = Math.abs(rel.dot(normal));
        if (longitudinal > -15 && longitudinal < 30 && lateral < 1.6) {
          passingClear = false;
          break;
        }
      }

      let command = "CRUISE";
      let decision = "ROAD CLEAR";
      let signal = null;

      if (r.mode === "OVERTAKE") {
        const passedActor = actors.find((a) => a.id === r.overtakeActorId);
        const relative = passedActor ? passedActor.position.clone().sub(car.position).dot(tangent) : -20;
        r.desiredLaneOffset = passingOffset;
        const overtakeDelta = passingOffset - r.laneOffset;
        signal = Math.abs(overtakeDelta) > 0.14
          ? (overtakeDelta < 0 ? "RIGHT" : "LEFT")
          : null;
        command = "OVERTAKE";
        decision = "PASSING LANE CLEAR";
        if (relative < -10.0 || (turnApproaching && remaining < 25)) {
          r.mode = "RETURN";
          r.desiredLaneOffset = LANE_OFFSET;
        }
      } else if (r.mode === "RETURN") {
        r.desiredLaneOffset = LANE_OFFSET;
        const returnDelta = LANE_OFFSET - r.laneOffset;
        signal = Math.abs(returnDelta) > 0.14
          ? (returnDelta < 0 ? "RIGHT" : "LEFT")
          : null;
        command = "RETURN LANE";
        decision = "SAFE GAP CONFIRMED";
        if (Math.abs(r.laneOffset - LANE_OFFSET) < 0.14) {
          r.mode = "CRUISE";
          r.overtakeActorId = null;
        }
      } else if (lead && leadDistance < 35) {
        if (passingClear && !turnApproaching && remaining > 30) {
          r.mode = "OVERTAKE";
          r.overtakeActorId = lead.id;
          r.desiredLaneOffset = passingOffset;
          signal = passingOffset < r.laneOffset ? "RIGHT" : "LEFT";
          command = "OVERTAKE";
          decision = "FRONT VEHICLE + PASSING LANE CLEAR";
        } else {
          r.mode = "FOLLOW";
          r.desiredLaneOffset = LANE_OFFSET;
          command = "WAIT";
          decision = passingClear ? "TURN AHEAD — HOLD POSITION" : "PASSING LANE OCCUPIED";
        }
      } else if (r.mode === "FOLLOW") {
        r.mode = "CRUISE";
        r.desiredLaneOffset = LANE_OFFSET;
      }

      if (turnApproaching && r.mode !== "OVERTAKE") {
        signal = signedTurn > 0 ? "LEFT" : "RIGHT";
        command = "TURN";
        decision = "SLOWING FOR INTERSECTION";
      }

      // Destination docking
      const docking = remaining < 14.0;
      const finalAlign = remaining < 7.0;
      if (docking) {
        r.mode = "DOCK";
        r.desiredLaneOffset = 0;
        signal = null;
        command = "DOCK";
        decision = finalAlign ? "CENTERING IN RED PARKING BAY" : "ALIGNING WITH DESTINATION BAY";
      }

      r.laneOffset = THREE.MathUtils.damp(
        r.laneOffset,
        r.desiredLaneOffset,
        docking ? (finalAlign ? 6.4 : 4.5) : 4.2,
        delta
      );
      if (remaining < 1.0 && Math.abs(r.laneOffset) < 0.07) r.laneOffset = 0;

      // ── Realistic City Autonomous Speed Model (68 km/h Cruise, 82 km/h Overtake) ─────
      const TOP_SPEED_KMH = 68; // ~18.89 m/s realistic boulevard cruising top speed
      const TOP_SPEED_MS = TOP_SPEED_KMH / 3.6;
      const OVERTAKE_SPEED_MS = 82 / 3.6; // ~22.78 m/s passing speed

      const smoothDecelDist = Math.max(0, remaining);
      const brakingSpeed = Math.sqrt(Math.max(0, 2 * 6.5 * smoothDecelDist));

      let targetSpeed = Math.min(TOP_SPEED_MS, brakingSpeed);
      if (turnApproaching && !docking) targetSpeed = Math.min(targetSpeed, 11.0); // ~40 km/h cornering
      if (r.mode === "OVERTAKE") targetSpeed = Math.min(OVERTAKE_SPEED_MS, Math.max(targetSpeed, 22.0)); // ~80 km/h pass speed
      if (docking) targetSpeed = Math.min(targetSpeed, 6.5);
      if (finalAlign) targetSpeed = Math.min(targetSpeed, 2.5);
      if (remaining < 0.34) targetSpeed = 0;

      // ── SMART TRAFFIC DECELERATION & COLLISION SAFETY GOVERNOR ─────────────────────
      if (lead && leadDistance < 40.0) {
        const leadLaneOffset = (r.mode === "OVERTAKE" || r.mode === "RETURN") ? passingOffset : LANE_OFFSET;
        const currentLaneDiff = Math.abs(r.laneOffset - leadLaneOffset);

        // If hero car is in (or shifting into) lead car's lane:
        if (currentLaneDiff < 1.5) {
          const stopGap = 6.2; // Absolute center-to-center limit (~1.8m bumper gap)
          const safeGap = 12.0; // Comfortable follow buffer

          if (leadDistance <= stopGap) {
            targetSpeed = 0; // Immediate safety brake to PREVENT ANY CONTACT!
          } else if (leadDistance < safeGap) {
            // Smoothly decelerate to match lead speed or hold safe buffer
            const gapRatio = (leadDistance - stopGap) / (safeGap - stopGap);
            targetSpeed = Math.min(targetSpeed, Math.max(0, lead.speed * gapRatio));
          } else if (r.mode === "FOLLOW") {
            // Follow mode: match lead speed smoothly while waiting for passing lane to clear
            const followRatio = Math.min(1.0, (leadDistance - safeGap) / 20.0);
            targetSpeed = Math.min(targetSpeed, lead.speed + (targetSpeed - lead.speed) * followRatio);
          }
        } else if (r.mode === "OVERTAKE" && leadDistance < 10.0 && currentLaneDiff > 0.5) {
          // Cap speed to lead speed while shifting laterally out of lane
          targetSpeed = Math.min(targetSpeed, lead.speed + 2.0);
        }
      }

      // Progressive realistic acceleration throttle curve (no instantaneous 150+ km/h jumps)
      let accel;
      if (targetSpeed > r.speed) {
        if (r.speed < 8.0) {
          // Smooth 0 -> 30 km/h launch rollout over ~2 seconds
          accel = 2.0;
        } else {
          // Realistic smooth torque pull up to top cruising speed
          accel = 1.6;
        }
      } else {
        // Natural progressive braking
        accel = (r.speed - targetSpeed > 8.0) ? 4.5 : 2.5;
      }

      r.speed = THREE.MathUtils.damp(r.speed, targetSpeed, accel, delta);
      r.distance = Math.min(r.total, r.distance + r.speed * delta);
      if (r.total - r.distance < 0.02) {
        r.distance = r.total;
        r.laneOffset = 0;
        r.desiredLaneOffset = 0;
      }

      const { position, tangent: motionTangent } = pointAlongPolyline(
        r.points,
        r.cumulative,
        r.distance,
        r.laneOffset
      );
      car.position.copy(position);
      car.position.y = 0.34 + Math.sin(state.clock.elapsedTime * 12) * 0.0025;

      const desiredYaw = Math.atan2(-motionTangent.x, -motionTangent.z);
      const yawBefore = car.rotation.y;
      car.rotation.y = dampAngle(car.rotation.y, desiredYaw, 10.0, delta);
      const yawError = Math.atan2(Math.sin(desiredYaw - yawBefore), Math.cos(desiredYaw - yawBefore));

      // ── Steering Calculation ───────────────────────────────────────────────────
      // Combine yaw turning rate with lane change shift for smooth, expressive steering
      const laneChangeRate = (r.desiredLaneOffset - r.laneOffset);
      const computedSteer = yawError * 4.8 + laneChangeRate * 0.35;
      car.userData.speed = r.speed;
      car.userData.steer = THREE.MathUtils.clamp(computedSteer, -1, 1);
      car.userData.signal = signal;

      const progress = r.total > 0 ? r.distance / r.total : 1;
      onDriveProgress?.(progress);

      const kmh = Math.round(r.speed * 3.6);
      if (kmh !== lastReportedSpeed.current) {
        lastReportedSpeed.current = kmh;
        onSpeedChange?.(kmh);
      }

      const closingSpeed = lead ? Math.max(0, r.speed - lead.speed) : 0;
      const ttc = lead && closingSpeed > 0.25 ? leadDistance / closingSpeed : null;

      if (state.clock.elapsedTime % 0.2 < delta) {
        onDriveStatus?.({
          command,
          decision,
          signal,
          frontDistance: Number.isFinite(leadDistance) ? Math.round(leadDistance) : null,
          passingClear,
          turnAhead: turnApproaching,
          ttc: ttc != null ? Number(ttc.toFixed(1)) : null
        });
      }

      // ── Robust Arrival & Docking Trigger ──────────────────────────────────────
      // Triggers reliably when remaining distance is under 0.35m or total distance
      // is reached, ensuring the open door UI always triggers on destination arrival.
      const remainingDist = r.total - r.distance;
      const atDockCenter = remainingDist < 0.35 || r.distance >= r.total - 0.02;
      if (atDockCenter) {
        const final = pointAlongPolyline(r.points, r.cumulative, r.total, 0);
        car.position.copy(r.dockPoint ?? final.position);
        car.position.y = 0.34;
        const finalYaw = Math.atan2(-final.tangent.x, -final.tangent.z);
        car.rotation.y = finalYaw;
        r.laneOffset = 0;
        r.desiredLaneOffset = 0;
        r.distance = r.total;

        // Decelerate speed cleanly to 0, then fire onArrival
        if (r.speed >= 0.12) {
          r.speed = THREE.MathUtils.damp(r.speed, 0, 8.0, delta);
          onDriveProgress?.(0.999);
          onDriveStatus?.({
            command: "DOCK",
            decision: "FINAL STOP IN RED PARKING BAY",
            signal: null,
            frontDistance: null,
            passingClear: true,
            turnAhead: false,
            ttc: null
          });
        } else {
          r.speed = 0;
          r.active = false;
          car.userData.speed = 0;
          car.userData.steer = 0;
          car.userData.signal = null;
          onDriveProgress?.(1);
          onSpeedChange?.(0);
          onDriveStatus?.({
            command: "PARK",
            decision: "CENTERED IN RED PARKING BAY",
            signal: null,
            frontDistance: null,
            passingClear: true,
            turnAhead: false,
            ttc: null
          });
          onArrival(r.targetId);
        }
      }
    } else {
      car.userData.speed = 0;
      car.userData.steer = 0;
      car.userData.signal = null;
    }

    let desiredCamera;
    let lookTarget;

    if (cameraMode === "top") {
      // "TOP VIEW" means the earlier third-person car + road view, not a vertical
      // bird's-eye view. If switching from the cockpit, jump just outside the car
      // first so the transition never travels through the roof/body geometry.
      const chaseOffset = new THREE.Vector3(0.9, 4.25, 11.8).applyAxisAngle(Y_AXIS, car.rotation.y);
      if (cameraRig.current.position.distanceTo(car.position) < 3.0) {
        const safeExteriorOffset = new THREE.Vector3(0.7, 3.0, 7.2).applyAxisAngle(Y_AXIS, car.rotation.y);
        cameraRig.current.position.copy(car.position.clone().add(safeExteriorOffset));
      }
      desiredCamera = car.position.clone().add(chaseOffset);
      const chaseLookAhead = new THREE.Vector3(0, 0.90, -9.5).applyAxisAngle(Y_AXIS, car.rotation.y);
      lookTarget = car.position.clone().add(chaseLookAhead);
      dampFov(camera, 49, delta);

      // Smoothing is useful only for the optional exterior view.
      cameraRig.current.position.lerp(desiredCamera, 1 - Math.pow(0.012, delta));
      camera.position.copy(cameraRig.current.position);
      camera.lookAt(lookTarget);
    } else {
      // DEFAULT: rigid driver-eye view. No chase, orbit, zoom-in/out or fore/aft
      // drift while driving. The camera rotates only because the vehicle turns.
      desiredCamera = carLocalToWorld(car, driverEyeLocal(car));
      lookTarget = carLocalToWorld(car, driverLookLocal(car));
      cameraRig.current.position.copy(desiredCamera);
      camera.position.copy(desiredCamera);
      camera.lookAt(lookTarget);

      // Dynamic high-speed FOV effect: FOV widens smoothly as vehicle reaches 350 km/h
      const speedRatio = Math.min(1, (car.userData.speed ?? 0) / 97.22);
      const dynamicFov = 74 + speedRatio * 9;
      dampFov(camera, dynamicFov, delta);
    }
  });

  return (
    <>
      <color attach="background" args={["#8aa3c4"]} />
      <fog attach="fog" args={["#8aa3c4", 120, 450]} />

      <ambientLight intensity={0.8} color="#fff5eb" />
      <hemisphereLight args={["#b9def0", "#d4b497", 1.25]} />
      <directionalLight
        castShadow={false}
        position={[-48, 46, 52]}
        intensity={2.6}
        color="#ffd09a"
      />
      <directionalLight position={[38, 16, -80]} intensity={0.42} color="#ff9d58" />
      <pointLight position={[0, 24, 146]} color="#ffb36a" intensity={4.5} distance={60} />
      <pointLight position={[-72, 18, -140]} color="#ff1730" intensity={5.2} distance={36} />

      <group ref={cameraRig} />
      <World destinations={destinations} dawn />
      <HeroCar ref={carRef} engineOn={engineOn} doorOpen={doorOpen} headlights onReady={onSceneReady} />
    </>
  );
}
