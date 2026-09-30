const trafficActors = new Map();
let heroActor = { position: null, speed: 0 };

export function updateTrafficActor(id, data) {
  trafficActors.set(id, {
    id,
    position: data.position.clone(),
    velocity: data.velocity.clone(),
    speed: data.speed,
    halfLength: data.halfLength ?? 1.93,
    halfWidth: data.halfWidth ?? 1.0,
    updatedAt: performance.now()
  });
}

export function removeTrafficActor(id) {
  trafficActors.delete(id);
}

export function getTrafficActors() {
  return Array.from(trafficActors.values());
}

export function updateHeroActor(data) {
  heroActor = {
    position: data.position ? data.position.clone() : null,
    speed: data.speed ?? 0,
    yaw: data.yaw ?? 0
  };
}

export function getHeroActor() {
  return heroActor;
}

// Shared swept envelopes include bodywork, wheels and clearance.
export function vehicleBounds(yaw = 0, halfWidth = 0.85, halfLength = 2.45) {
  return {
    x: Math.abs(Math.cos(yaw)) * halfWidth + Math.abs(Math.sin(yaw)) * halfLength,
    z: Math.abs(Math.sin(yaw)) * halfWidth + Math.abs(Math.cos(yaw)) * halfLength
  };
}

export function safeMotionFraction(from, to, bounds, obstacles, clearance = 0.25) {
  if (![from.x, from.z, to.x, to.z].every(Number.isFinite)) return 0;
  let fraction = 1;
  for (const actor of obstacles) {
    if (!actor.position) continue;
    const other = actor.bounds ?? vehicleBounds(0, actor.halfWidth ?? 0.85, actor.halfLength ?? 1.93);

    const reqX = (bounds.x ?? 0.85) + (other.x ?? 0.85) + clearance;
    const reqZ = (bounds.z ?? 2.45) + (other.z ?? 1.93) + clearance;

    const dxFrom = from.x - actor.position.x;
    const dzFrom = from.z - actor.position.z;
    const dxTo = to.x - actor.position.x;
    const dzTo = to.z - actor.position.z;

    // Check box overlap on both X and Z axes
    const overlapFromX = Math.abs(dxFrom) < reqX;
    const overlapFromZ = Math.abs(dzFrom) < reqZ;
    const overlapToX = Math.abs(dxTo) < reqX;
    const overlapToZ = Math.abs(dzTo) < reqZ;

    // If there is no overlap on at least one axis at both start and end, motion is safe!
    if ((!overlapFromX || !overlapFromZ) && (!overlapToX || !overlapToZ)) {
      continue;
    }

    // Check 2D distance change: if moving away or laterally out of alignment, allow motion
    const distFromSq = dxFrom * dxFrom + dzFrom * dzFrom;
    const distToSq = dxTo * dxTo + dzTo * dzTo;
    if (distToSq >= distFromSq - 1e-4) {
      continue;
    }

    // Moving closer within overlap zone: scale motion smoothly to avoid instant zero-speed lockup
    const hardLimitSq = Math.pow(reqX * 0.5, 2) + Math.pow(reqZ * 0.5, 2);
    if (distFromSq < hardLimitSq) {
      const minMargin = Math.max(0, distFromSq - 0.25);
      const safeScale = minMargin / (distFromSq || 1);
      fraction = Math.min(fraction, Math.max(0, safeScale));
    } else {
      fraction = Math.min(fraction, 0.85);
    }
  }
  return fraction;
}
