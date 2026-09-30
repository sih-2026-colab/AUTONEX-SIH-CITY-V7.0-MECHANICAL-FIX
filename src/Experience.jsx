import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import HeroCar from "./scene/HeroCar";
import World from "./scene/World";
import CatActor from "./scene/CatActor";
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
import { getTrafficActors, updateHeroActor, safeMotionFraction, vehicleBounds } from "./scene/trafficState";
import { makeCatReflexDecision } from "./scene/catReflexEngine.js";

const HOME = vecForNode(HOME_NODE);
const HOME_LANE = HOME.clone().add(new THREE.Vector3(-LANE_OFFSET, 0, 0));
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const INTRO_DURATION = 3.2;

// Physical envelope used by the safety planner. Distances below are measured
// along the current road tangent, with a hard geometric guard as the final layer.
const EGO_HALF_LENGTH = 2.45;
const TRAFFIC_HALF_LENGTH = 1.93;
const HARD_BUMPER_GAP = 2.4;
const MIN_FOLLOW_GAP = 8.5;
const FOLLOW_HEADWAY = 0.85;
const OVERTAKE_TRIGGER_GAP = 28.0;
const RETURN_CLEARANCE = 9.0;

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
  onCatReflexUpdate,
  doorOpen,
  onSceneReady,
  onIntroProgress,
  onIntroComplete,
  cameraMode = "cockpit",
  catReflexActive = false,
  catScenarioType = 0,
}) {
  const carRef = useRef();
  const cameraRig = useRef();
  const introTime = useRef(0);
  const lastReportedSpeed = useRef(-1);
  const lastReportedProgress = useRef(-1);
  const lastIntroPercent = useRef(-1);
  const introCompleted = useRef(false);
  const { camera } = useThree();

  // Cat Reflex state
  const catActorRef = useRef();
  const catPosRef = useRef(null);       // current cat world position {x,z}
  const catPrevPosRef = useRef(null);   // previous frame cat position
  const catDtAccum = useRef(0);         // time since last cat pos update
  const catVisibleRef = useRef(false);
  const catReflexResult = useRef(null);
  const catReflexReportTimer = useRef(0);

  const handleCatState = useCallback(({ catPos, catState, catVisible }) => {
    catVisibleRef.current = catVisible;
    if (catPos) {
      catPosRef.current = catPos;
    } else {
      catPosRef.current = null;
    }
  }, []);

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
    stalledTime: 0,
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
      route.current.stalledTime = 0;
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
      route.current.stalledTime = 0;
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
    route.current.stalledTime = 0;
    route.current.dockPoint = vecForNode(destNode);

    lastReportedProgress.current = -1;
    onDriveProgress?.(0);
    onSpeedChange?.(0);
  }, [target, arrivedAt, onDriveProgress, onSpeedChange]);

  useFrame((state, delta) => {
    if (!carRef.current || !cameraRig.current) return;
    const car = carRef.current;
    delta = Math.min(delta, 0.05);

    // Broadcast hero car position to traffic system for dual-sided collision avoidance
    updateHeroActor({ position: car.position, speed: car.userData?.speed ?? 0, yaw: car.rotation.y });

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
      let leadGap = Infinity;

      // Nearest same-direction actor in the ego vehicle's CURRENT physical lane.
      // Keeping this active during a partial lane change prevents side/rear overlap.
      for (const actor of actors) {
        const rel = actor.position.clone().sub(car.position);
        const longitudinal = rel.dot(tangent);
        const lateral = Math.abs(rel.dot(normal));
        const actorDir = actor.velocity.lengthSq() > 0.01
          ? actor.velocity.clone().normalize()
          : tangent;

        if (
          longitudinal > 0 && longitudinal < 65 &&
          lateral < 1.0 + actor.halfWidth + 0.3 && actorDir.dot(tangent) > 0.35 &&
          longitudinal < leadDistance
        ) {
          leadDistance = longitudinal;
          lead = actor;
        }
      }

      if (lead) {
        const leadHalfLength = lead.halfLength ?? TRAFFIC_HALF_LENGTH;
        leadGap = Math.max(0, leadDistance - EGO_HALF_LENGTH - leadHalfLength);
      }

      // Immediate path hazard: same-lane oncoming or crossing traffic can be
      // outside the normal same-direction lead filter. Treat only the physical
      // corridor directly ahead as a blocker so the car cannot drive through an
      // intersection vehicle, while still allowing normal lane changes.
      let pathBlocker = null;
      let pathBlockerDistance = Infinity;
      for (const actor of actors) {
        const rel = actor.position.clone().sub(car.position);
        const longitudinal = rel.dot(tangent);
        const lateral = Math.abs(rel.dot(normal));
        const actorDir = actor.velocity.lengthSq() > 0.01
          ? actor.velocity.clone().normalize()
          : tangent;
        const sameDirection = actorDir.dot(tangent) > 0.35;

        if (
          !sameDirection &&
          longitudinal > -2.5 &&
          longitudinal < 9.0 &&
          lateral < 2.25 &&
          longitudinal < pathBlockerDistance
        ) {
          pathBlocker = actor;
          pathBlockerDistance = longitudinal;
        }
      }
      const immediatePathBlocker = Boolean(
        pathBlocker && pathBlockerDistance < 5.5
      );

      const closingSpeed = lead ? Math.max(0, r.speed - lead.speed) : 0;
      const ttc = lead && closingSpeed > 0.20 ? leadGap / closingSpeed : null;
      const desiredFollowGap = Math.max(MIN_FOLLOW_GAP, 5.5 + r.speed * FOLLOW_HEADWAY);
      const emergencyFrontRisk = Boolean(
        lead && (leadGap < HARD_BUMPER_GAP + 1.1 || (ttc != null && ttc < 1.35))
      );

      const passingOffset = -LANE_OFFSET;
      const passingLaneDelta = passingOffset - r.laneOffset;
      const originalLaneDelta = LANE_OFFSET - r.laneOffset;

      function laneHasSafeGap(targetLaneDelta, frontGap = 40, rearGap = 22) {
        for (const actor of actors) {
          const rel = actor.position.clone().sub(car.position);
          const longitudinal = rel.dot(tangent);
          const lateralFromTarget = Math.abs(rel.dot(normal) - targetLaneDelta);
          if (lateralFromTarget > 1.0 + actor.halfWidth + 0.3) continue;

          const actorDir = actor.velocity.lengthSq() > 0.01
            ? actor.velocity.clone().normalize()
            : tangent;
          if (actorDir.dot(tangent) < 0.2 && longitudinal > -14 && longitudinal < 52) {
            return false;
          }
          if (longitudinal > -rearGap && longitudinal < frontGap) return false;
        }
        return true;
      }

      const passingFrontGap = Math.max(40, r.speed * 1.35);
      const passingRearGap = Math.max(20, r.speed * 0.95);
      const passingClear = laneHasSafeGap(
        passingLaneDelta,
        passingFrontGap,
        passingRearGap
      );
      const originalLaneClear = laneHasSafeGap(
        originalLaneDelta,
        26,
        18
      );

      let command = "CRUISE";
      let decision = "ROAD CLEAR";
      let signal = null;

      if (r.mode === "OVERTAKE") {
        const passedActor = actors.find((a) => a.id === r.overtakeActorId);
        const relative = passedActor
          ? passedActor.position.clone().sub(car.position).dot(tangent)
          : -40;
        const passedHalf = passedActor?.halfLength ?? TRAFFIC_HALF_LENGTH;
        const fullyPast = relative < -(EGO_HALF_LENGTH + passedHalf + RETURN_CLEARANCE);

        r.desiredLaneOffset = passingClear ? passingOffset : r.laneOffset;
        const laneChangeDelta = passingOffset - r.laneOffset;
        const inPassingLane = Math.abs(laneChangeDelta) < 0.18;
        signal = !inPassingLane ? (laneChangeDelta < 0 ? "RIGHT" : "LEFT") : null;
        command = inPassingLane ? "OVERTAKE" : "LANE CHANGE";
        decision = inPassingLane ? "PASSING LEAD VEHICLE" : "MOVING TO VERIFIED PASSING LANE";

        // Never cut back in front of the passed vehicle. Return only after both
        // longitudinal clearance and the original-lane gap have been verified.
        if (fullyPast && originalLaneClear) {
          r.mode = "RETURN";
          r.desiredLaneOffset = LANE_OFFSET;
        }
      } else if (r.mode === "RETURN") {
        if (!originalLaneClear) {
          r.desiredLaneOffset = passingOffset;
          command = "WAIT";
          decision = "ORIGINAL LANE NOT CLEAR";
          signal = null;
        } else {
          r.desiredLaneOffset = LANE_OFFSET;
          const returnDelta = LANE_OFFSET - r.laneOffset;
          signal = Math.abs(returnDelta) > 0.14
            ? (returnDelta < 0 ? "RIGHT" : "LEFT")
            : null;
          command = "RETURN LANE";
          decision = "SAFE RETURN GAP CONFIRMED";
          if (Math.abs(returnDelta) < 0.12) {
            r.mode = "CRUISE";
            r.overtakeActorId = null;
          }
        }
      } else if (lead) {
        const shouldPass = leadGap < OVERTAKE_TRIGGER_GAP || leadGap < desiredFollowGap;

        // The lead vehicle is close enough that we must react to it.
        const leadTooClose = leadGap < desiredFollowGap;
        const leadStalled = lead.speed < 0.4 && leadGap < HARD_BUMPER_GAP + 3.5;
        // Too close to still be accelerating into it — we need lateral escape now.
        const imminent = leadGap < HARD_BUMPER_GAP + 4.0 || emergencyFrontRisk;

        // OVERTAKING IS THE DEFAULT RESPONSE TO A SLOWER CAR AHEAD.
        // Whenever the passing lane is clear we pull out and go around, rather
        // than braking to sit behind the vehicle. The old logic required
        // `!emergencyFrontRisk` and `remaining > 40`, so once the ego got close
        // it could never start the lane change and deadlocked against the car
        // in front. Only a physically occupied passing lane blocks this now.
        const wantOvertake = (leadTooClose || shouldPass || imminent || leadStalled);

        if (wantOvertake && passingClear) {
          r.mode = "OVERTAKE";
          r.overtakeActorId = lead.id;
          r.desiredLaneOffset = passingOffset;
          signal = passingOffset < r.laneOffset ? "RIGHT" : "LEFT";
          command = "LANE CHANGE";

          if (leadStalled) {
            decision = "LEAD VEHICLE STOPPED — ESCAPING TO PASSING LANE";
          } else if (imminent) {
            decision = "CLOSING ON SLOWER VEHICLE — OVERTAKING";
          } else {
            decision = "FRONT VEHICLE — PASSING LANE VERIFIED";
          }
        } else if (leadTooClose || imminent) {
          // The passing lane is genuinely blocked. Hold a safe gap in-lane and
          // keep re-testing every frame; we must not drive through the car.
          r.mode = "FOLLOW";
          r.desiredLaneOffset = LANE_OFFSET;
          command = emergencyFrontRisk ? "BRAKE" : "WAIT";
          decision = emergencyFrontRisk
            ? "PASSING LANE BLOCKED — HOLDING SAFE GAP"
            : "PASSING LANE OCCUPIED — WAITING TO OVERTAKE";
        } else {
          r.mode = "CRUISE";
          r.desiredLaneOffset = LANE_OFFSET;
        }
      } else if (r.mode === "FOLLOW") {
        r.mode = "CRUISE";
        r.desiredLaneOffset = LANE_OFFSET;
      }

      // Turn handling is lower priority than collision avoidance and lane changes.
      if (turnApproaching && r.mode === "CRUISE") {
        signal = signedTurn > 0 ? "LEFT" : "RIGHT";
        command = "TURN";
        decision = "SLOWING FOR INTERSECTION";
      }

      // Destination docking
      const docking = remaining < 14.0 && r.mode !== "OVERTAKE" && r.mode !== "RETURN";
      const finalAlign = remaining < 7.0;
      const maneuverInProgress = r.mode === "OVERTAKE" || r.mode === "RETURN";
      if (docking && !maneuverInProgress && !immediatePathBlocker) {
        r.mode = "DOCK";
        r.desiredLaneOffset = 0;
        signal = null;
        command = "DOCK";
        decision = finalAlign ? "CENTERING IN RED PARKING BAY" : "ALIGNING WITH DESTINATION BAY";
      }

      if (immediatePathBlocker && !maneuverInProgress && !docking) {
        r.mode = "FOLLOW";
        r.desiredLaneOffset = LANE_OFFSET;
        signal = null;
        command = "BRAKE";
        decision = "PATH BLOCKED — HOLDING SAFE GAP";
      }

      const previousLaneOffset = r.laneOffset;
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
      if (r.mode === "FOLLOW" && lead) {
        // Automatic car-following while the passing lane is unavailable.
        const gapError = leadGap - desiredFollowGap;
        const followTarget = THREE.MathUtils.clamp(
          lead.speed + gapError * 0.32,
          0,
          lead.speed + 0.8
        );
        targetSpeed = Math.min(targetSpeed, followTarget);

        // Never let a stopped lead vehicle hold us at a standstill forever.
        // If the lead is parked and the passing lane is clear, the mode logic
        // has already queued an escape overtake; until the lane change begins
        // we hold a safe stop, but we must not treat stopped traffic as a
        // permanent follow target.
        const leadStalled = lead.speed < 0.4 && leadGap < HARD_BUMPER_GAP + 2.5;
        if ((emergencyFrontRisk || leadGap <= HARD_BUMPER_GAP + 0.6) && !leadStalled) {
          targetSpeed = 0;
        } else if (leadStalled) {
          targetSpeed = Math.min(targetSpeed, leadGap <= HARD_BUMPER_GAP + 0.6 ? 0 : 1.6);
        }
      }

      if (r.mode === "OVERTAKE") {
        const passedActor = actors.find((a) => a.id === r.overtakeActorId);
        const laneChangeComplete = Math.abs(r.laneOffset - passingOffset) < 0.20;
        if (!laneChangeComplete && passedActor) {
          const lateralClearance = Math.abs(r.laneOffset - passingOffset);
          const targetLeadSpeed = Math.max(passedActor.speed, TOP_SPEED_MS * 0.55);
          if (lateralClearance > 1.2) {
            targetSpeed = Math.min(targetSpeed, Math.max(passedActor.speed, 6.0));
          } else {
            targetSpeed = Math.min(OVERTAKE_SPEED_MS, Math.max(targetSpeed, targetLeadSpeed + 2.0));
          }
          if (lead && leadGap < HARD_BUMPER_GAP + 1.5) {
            targetSpeed = Math.min(targetSpeed, Math.max(lead.speed, 2.0));
          }
        } else {
          targetSpeed = Math.min(OVERTAKE_SPEED_MS, Math.max(targetSpeed, (passedActor?.speed ?? 10) + 4.5));
        }
      }

      if (r.mode === "RETURN") targetSpeed = Math.min(targetSpeed, TOP_SPEED_MS * 0.92);

      if (immediatePathBlocker) {
        targetSpeed = 0;
      }

      // Progressive realistic acceleration/braking.
      let accel;
      if (targetSpeed > r.speed) {
        accel = r.speed < 8.0 ? 2.0 : 1.6;
      } else {
        // Only brake hard for a genuinely imminent rear-end in OUR lane. When we
        // have committed to an overtake the lateral separation is what keeps us
        // safe, and a full emergency stop would abort the lane change.
        const hardBrake = emergencyFrontRisk && r.mode !== "OVERTAKE" && r.mode !== "RETURN";
        accel = hardBrake ? 12.0 : ((r.speed - targetSpeed > 8.0) ? 5.0 : 3.0);
      }
      r.speed = THREE.MathUtils.damp(r.speed, targetSpeed, accel, delta);

      // A stopped car can pull out laterally without advancing into its lead.
      const yaw = Math.atan2(-tangent.x, -tangent.z);
      const bounds = vehicleBounds(car.rotation.y);
      const plannedBounds = vehicleBounds(yaw);
      bounds.x = Math.max(bounds.x, plannedBounds.x);
      bounds.z = Math.max(bounds.z, plannedBounds.z);
      const lateralPosition = pointAlongPolyline(r.points, r.cumulative, r.distance, r.laneOffset).position;
      const lateralFraction = safeMotionFraction(car.position, lateralPosition, bounds, actors);
      r.laneOffset = THREE.MathUtils.lerp(previousLaneOffset, r.laneOffset, lateralFraction);
      const startPosition = pointAlongPolyline(r.points, r.cumulative, r.distance, r.laneOffset).position;
      let frameAdvance = Math.min(r.speed * delta, remaining);
      if (lead && Math.abs(lead.position.clone().sub(startPosition).dot(normal)) < 1.0 + lead.halfWidth + 0.3) {
        frameAdvance = Math.min(frameAdvance, Math.max(0, leadGap - HARD_BUMPER_GAP));
      }
      const candidate = pointAlongPolyline(r.points, r.cumulative, r.distance + frameAdvance, r.laneOffset);
      const endBounds = vehicleBounds(Math.atan2(-candidate.tangent.x, -candidate.tangent.z));
      bounds.x = Math.max(bounds.x, endBounds.x);
      bounds.z = Math.max(bounds.z, endBounds.z);
      const motionFraction = safeMotionFraction(startPosition, candidate.position, bounds, actors);
      frameAdvance *= motionFraction;
      if (motionFraction < 0.1) {
        r.speed = THREE.MathUtils.damp(r.speed, 0, 6.0, delta);
      }

      if (immediatePathBlocker) {
        const blockerHalfLength = pathBlocker?.halfLength ?? TRAFFIC_HALF_LENGTH;
        const blockerCenterDistance = EGO_HALF_LENGTH + blockerHalfLength + HARD_BUMPER_GAP;
        if (pathBlockerDistance <= blockerCenterDistance + 0.05) {
          frameAdvance = 0;
          r.speed = 0;
        }
      }

      const previousDistance = r.distance;
      r.distance = Math.min(r.total, r.distance + frameAdvance);
      const movementBlockedByTraffic = Boolean(
        lead && leadDistance <=
          EGO_HALF_LENGTH + (lead.halfLength ?? TRAFFIC_HALF_LENGTH) + HARD_BUMPER_GAP + 0.05
      ) || immediatePathBlocker;

      if (
        r.mode === "CRUISE" &&
        !lead &&
        !movementBlockedByTraffic &&
        targetSpeed > 2.5 &&
        r.distance <= previousDistance + 0.0001
      ) {
        r.stalledTime = Math.min(2.0, r.stalledTime + delta);
        if (r.stalledTime > 0.75) {
          r.speed = Math.max(r.speed, Math.min(targetSpeed, 4.0));
          r.stalledTime = 0;
        }
      } else {
        r.stalledTime = 0;
      }

      if (docking && r.total - r.distance < 0.02) {
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
      const progressPct = Math.floor(progress * 100);
      if (progressPct !== lastReportedProgress.current) {
        lastReportedProgress.current = progressPct;
        onDriveProgress?.(progress);
      }

      const kmh = Math.round(r.speed * 3.6);
      if (kmh !== lastReportedSpeed.current) {
        lastReportedSpeed.current = kmh;
        onSpeedChange?.(kmh);
      }

      // ── Cat Reflex integration ─────────────────────────────────────────────
      // Run the Cat Reflex engine every frame when a cat is visible.
      // The engine outputs override command/decision and impose a speed cap.
      let catSpeedOverride = null;
      catDtAccum.current += delta;

      if (catReflexActive && catVisibleRef.current && catPosRef.current) {
        // Build tangent from current motion direction
        const crTangent = { x: tangent.x, z: tangent.z };
        const egoPos2d = { x: car.position.x, z: car.position.z };

        const crResult = makeCatReflexDecision({
          egoPos: egoPos2d,
          egoSpeed: r.speed,
          tangent: crTangent,
          catPos: catPosRef.current,
          catPrevPos: catPrevPosRef.current,
          catDt: catDtAccum.current,
          detected: true,
        });

        catReflexResult.current = crResult;
        catPrevPosRef.current = { ...catPosRef.current };
        catDtAccum.current = 0;

        // Override the drive command/decision with cat reflex output
        command = crResult.command;
        decision = crResult.decision;
        catSpeedOverride = crResult.targetSpeedOverride;

        // Report cat reflex data to UI every ~100ms
        catReflexReportTimer.current += delta;
        if (catReflexReportTimer.current >= 0.1) {
          catReflexReportTimer.current = 0;
          onCatReflexUpdate?.(crResult);
        }
      } else if (catReflexActive && !catVisibleRef.current) {
        // Cat gone / crossed — clear override
        catReflexResult.current = null;
        catPrevPosRef.current = null;
        catDtAccum.current = 0;
        onCatReflexUpdate?.(null);
      }

      // Apply cat speed override on top of normal speed logic
      if (catSpeedOverride != null) {
        // Use strong deceleration for emergency, gentle for warning
        const isEmergency = command === "EMERGENCY BRAKE";
        const brakeStrength = isEmergency ? 15.0 : 6.0;
        r.speed = THREE.MathUtils.damp(r.speed, catSpeedOverride, brakeStrength, delta);
      }

      if (state.clock.elapsedTime % 0.2 < delta) {
        onDriveStatus?.({
          command,
          decision,
          signal,
          frontDistance: Number.isFinite(leadGap)
            ? Math.max(0, Math.round(leadGap))
            : (Number.isFinite(pathBlockerDistance) ? Math.max(0, Math.round(pathBlockerDistance)) : null),
          passingClear,
          turnAhead: turnApproaching,
          ttc: ttc != null ? Number(ttc.toFixed(1)) : null
        });
      }

      // ── Robust Arrival & Docking Trigger ──────────────────────────────────────
      // Triggers reliably when remaining distance is under 0.35m or total distance
      // is reached, ensuring the open door UI always triggers on destination arrival.
      const remainingDist = r.total - r.distance;
      const atDockCenter = docking && (remainingDist < 0.35 || r.distance >= r.total - 0.02);
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

    updateHeroActor({ position: car.position, speed: car.userData.speed, yaw: car.rotation.y });

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

      {/* Cat Reflex: only rendered in the world phase when active */}
      {phase === "world" && catReflexActive && (
        <CatActor
          ref={catActorRef}
          active={catReflexActive}
          egoPosition={carRef.current?.position ?? null}
          egoYaw={carRef.current?.rotation?.y ?? 0}
          onCatState={handleCatState}
          scenarioType={catScenarioType}
        />
      )}
    </>
  );
}
