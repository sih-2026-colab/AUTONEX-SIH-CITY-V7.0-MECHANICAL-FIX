/**
 * AutoNex Cat Reflex Engine
 * Pure algorithm module - implements the full sudden-intrusion pipeline.
 */

export const CAT_HALF_WIDTH   = 0.22;
export const CAT_HALF_LENGTH  = 0.28;
export const EGO_HALF_WIDTH   = 1.0;
export const EGO_HALF_LENGTH  = 2.45;
export const DETECTION_RANGE  = 30.0;
export const LATERAL_CONCERN  = 3.2;
export const SAFETY_MARGIN    = 0.55;

const BASE_UNCERTAINTY     = 0.18;
const SPEED_UNCERTAINTY_K  = 0.06;
const HORIZON_UNCERTAINTY_K= 0.04;

export const RISK_SAFE     = 0.25;
export const RISK_WARNING  = 0.50;
export const RISK_HIGH     = 0.72;
export const RISK_CRITICAL = 0.88;

export const DECISION_CRUISE    = "CRUISE";
export const DECISION_BRAKE     = "BRAKE";
export const DECISION_EMERGENCY = "EMERGENCY BRAKE";
export const DECISION_REPLAN    = "REPLAN";
export const DECISION_MONITORING= "MONITORING OBJECT";

export function estimateCatVelocity(prevPos, currentPos, dt) {
  if (!prevPos || dt < 0.001) return { vx: 0, vz: 0, speed: 0 };
  const vx = (currentPos.x - prevPos.x) / dt;
  const vz = (currentPos.z - prevPos.z) / dt;
  const speed = Math.sqrt(vx * vx + vz * vz);
  return { vx, vz, speed };
}

export function predictCatPosition(currentPos, velocity, horizon) {
  const h = Math.max(0, Math.min(horizon, 4.0));
  return { x: currentPos.x + velocity.vx * h, z: currentPos.z + velocity.vz * h };
}

export function computeUncertainty(catSpeed, horizon) {
  const sigma = BASE_UNCERTAINTY + catSpeed * SPEED_UNCERTAINTY_K + horizon * HORIZON_UNCERTAINTY_K;
  return Math.min(sigma, 1.8);
}

export function decomposeRelative(egoPos, catPos, tangent) {
  const dx = catPos.x - egoPos.x;
  const dz = catPos.z - egoPos.z;
  const longitudinal = dx * tangent.x + dz * tangent.z;
  const lateral      = dx * tangent.z - dz * tangent.x;
  return { longitudinal, lateral };
}

export function computeTTC(egoSpeed, longDist, catSpeedAlong) {
  if (longDist <= 0) return null;
  const closingSpeed = egoSpeed - catSpeedAlong;
  if (closingSpeed < 0.1) return null;
  const ttc = longDist / closingSpeed;
  return ttc > 15 ? null : Number(ttc.toFixed(1));
}

export function isInEgoPath(predictedCatPos, egoPos, tangent, margin) {
  const m = margin ?? SAFETY_MARGIN;
  const { longitudinal, lateral } = decomposeRelative(egoPos, predictedCatPos, tangent);
  const halfW = EGO_HALF_WIDTH + CAT_HALF_WIDTH + m;
  const halfL = EGO_HALF_LENGTH + CAT_HALF_LENGTH + m;
  return (longitudinal > -halfL && longitudinal < halfL + 15 && Math.abs(lateral) < halfW);
}

export function estimateRisk({ longitudinalDist, lateralDist, egoSpeed, catSpeed, ttc, uncertainty, catInPath, catInPredictedPath }) {
  const proxRisk = 1 - Math.min(1, longitudinalDist / DETECTION_RANGE);
  const lateralClearance = Math.max(0, Math.abs(lateralDist) - (EGO_HALF_WIDTH + CAT_HALF_WIDTH));
  const lateralRisk = 1 - Math.min(1, lateralClearance / LATERAL_CONCERN);
  const ttcRisk = ttc != null ? Math.min(1, 3.0 / Math.max(ttc, 0.1)) : 0;
  const speedRisk = Math.min(1, catSpeed / 5.0) * 0.4;
  const uncertaintyRisk = Math.min(1, uncertainty / 1.5) * 0.3;
  const pathOverlapBonus = (catInPath ? 0.25 : 0) + (catInPredictedPath ? 0.15 : 0);
  const raw = proxRisk * 0.22 + lateralRisk * 0.26 + ttcRisk * 0.28 + speedRisk * 0.10 + uncertaintyRisk * 0.08 + pathOverlapBonus;
  return Math.min(1, Math.max(0, raw));
}

export function riskLabel(risk) {
  if (risk >= RISK_CRITICAL) return "CRITICAL";
  if (risk >= RISK_HIGH)     return "HIGH";
  if (risk >= RISK_WARNING)  return "WARNING";
  return "LOW";
}

export function riskColor(risk) {
  if (risk >= RISK_CRITICAL) return "#ff1a2e";
  if (risk >= RISK_HIGH)     return "#ff6a1a";
  if (risk >= RISK_WARNING)  return "#ffcc00";
  return "#4dffaa";
}

export function checkReplan(catPos, egoPos, tangent, shiftAmount) {
  const shift = shiftAmount ?? 2.0;
  const normal = { x: tangent.z, z: -tangent.x };
  for (const sign of [1, -1]) {
    const shiftedEgo = { x: egoPos.x + normal.x * sign * shift, z: egoPos.z + normal.z * sign * shift };
    if (!isInEgoPath(catPos, shiftedEgo, tangent, 0.1)) {
      return { possible: true, direction: sign > 0 ? "LEFT" : "RIGHT" };
    }
  }
  return { possible: false, direction: null };
}

export function makeCatReflexDecision({ egoPos, egoSpeed, tangent, catPos, catPrevPos, catDt, detected }) {
  if (!detected || !catPos) {
    return {
      command: DECISION_CRUISE, decision: "ROAD CLEAR", riskScore: 0, riskLevel: "LOW",
      ttc: null, uncertainty: 0, safetyMargin: Infinity,
      catInPath: false, catInPredictedPath: false, predictedCatPos: null,
      replanPossible: false, replanDirection: null, targetSpeedOverride: null,
    };
  }

  const velocity = estimateCatVelocity(catPrevPos, catPos, catDt);
  const { longitudinal, lateral } = decomposeRelative(egoPos, catPos, tangent);
  const longDist = Math.max(0, longitudinal);
  const catSpeedAlong = velocity.vx * tangent.x + velocity.vz * tangent.z;
  const ttc = computeTTC(egoSpeed, longDist, catSpeedAlong);
  const horizon = Math.min(ttc != null ? ttc : 2.5, 2.5);
  const predictedCatPos = predictCatPosition(catPos, velocity, horizon);
  const uncertainty = computeUncertainty(velocity.speed, horizon);
  const catInPath = isInEgoPath(catPos, egoPos, tangent, SAFETY_MARGIN);
  const catInPredictedPath = isInEgoPath(predictedCatPos, egoPos, tangent, SAFETY_MARGIN + uncertainty);
  const safetyMargin = Math.max(0, Math.abs(lateral) - (EGO_HALF_WIDTH + CAT_HALF_WIDTH + SAFETY_MARGIN));

  const riskScore = estimateRisk({ longitudinalDist: longDist, lateralDist: lateral, egoSpeed, catSpeed: velocity.speed, ttc, uncertainty, catInPath, catInPredictedPath });
  const level = riskLabel(riskScore);
  const replan = (catInPath || catInPredictedPath) ? checkReplan(catPos, egoPos, tangent, 2.0) : { possible: false, direction: null };

  let command, decision, targetSpeedOverride;

  if (!catInPath && !catInPredictedPath) {
    if (riskScore >= RISK_WARNING) {
      command = DECISION_MONITORING;
      decision = "MONITORING — LATERAL CLEAR (" + safetyMargin.toFixed(1) + " m)";
      targetSpeedOverride = null;
    } else {
      command = DECISION_CRUISE;
      decision = "CAT DETECTED — PATH CLEAR";
      targetSpeedOverride = null;
    }
  } else if (riskScore >= RISK_CRITICAL) {
    if (replan.possible) {
      command = DECISION_REPLAN;
      decision = "EMERGENCY REPLAN — SHIFT " + replan.direction;
      targetSpeedOverride = Math.max(0, egoSpeed - 8);
    } else {
      command = DECISION_EMERGENCY;
      decision = "EMERGENCY BRAKE — NO SAFE PATH";
      targetSpeedOverride = 0;
    }
  } else if (riskScore >= RISK_HIGH) {
    if (replan.possible && ttc != null && ttc > 1.2) {
      command = DECISION_REPLAN;
      decision = "REPLAN — SHIFT " + replan.direction;
      targetSpeedOverride = Math.max(2, egoSpeed * 0.55);
    } else {
      command = DECISION_BRAKE;
      decision = "BRAKING — HIGH RISK OBJECT";
      targetSpeedOverride = Math.max(0, egoSpeed * 0.35);
    }
  } else if (riskScore >= RISK_WARNING) {
    command = DECISION_BRAKE;
    decision = "CAUTION — OBJECT IN PATH";
    targetSpeedOverride = Math.max(3, egoSpeed * 0.65);
  } else {
    command = DECISION_CRUISE;
    decision = "LOW RISK — CONTINUING";
    targetSpeedOverride = null;
  }

  return {
    command, decision, riskScore, riskLevel: level, ttc, uncertainty, safetyMargin,
    catInPath, catInPredictedPath, predictedCatPos,
    replanPossible: replan.possible, replanDirection: replan.direction,
    targetSpeedOverride, velocity, longitudinalDist: longDist, lateralDist: lateral,
  };
}
