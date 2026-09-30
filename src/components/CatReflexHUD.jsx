import { riskColor } from "../scene/catReflexEngine.js";

/**
 * CatReflexHUD
 * Full AutoNex Cat Reflex algorithm visualization overlay.
 * Displays every stage of the pipeline in real time.
 */
export default function CatReflexHUD({ catReflex, speedKmh, active }) {
  if (!active || !catReflex) return null;

  const r = catReflex;
  const rColor = riskColor(r.riskScore);
  const pct = Math.round((r.riskScore || 0) * 100);

  function fmt(v, digits, unit) {
    if (v == null || !Number.isFinite(v)) return "--";
    return v.toFixed(digits) + (unit ? " " + unit : "");
  }

  const commandColor =
    r.command === "EMERGENCY BRAKE" ? "#ff1a2e" :
    r.command === "BRAKE"           ? "#ff6a1a" :
    r.command === "REPLAN"          ? "#ffcc00" :
    r.command === "MONITORING OBJECT" ? "#57c8ff" :
    "#4dffaa";

  const stagesDone = r.riskScore > 0 || r.catInPath || r.catInPredictedPath;

  return (
    <div className="cat-reflex-hud">
      {/* Header */}
      <div className="crh-header">
        <span className="crh-badge">CAT REFLEX</span>
        <span className="crh-title">AutoNex Sudden-Intrusion Response</span>
      </div>

      {/* Pipeline stages */}
      <div className="crh-pipeline">
        <Stage label="DETECTION" active done={stagesDone} />
        <Arrow />
        <Stage label="ESTIMATION" active done={stagesDone} />
        <Arrow />
        <Stage label="PREDICTION" active done={stagesDone} />
        <Arrow />
        <Stage label="RISK" active done={stagesDone} color={rColor} />
        <Arrow />
        <Stage label="DECISION" active done={stagesDone} color={commandColor} />
      </div>

      {/* Metrics grid */}
      <div className="crh-metrics">
        <Metric label="EGO SPEED"      value={speedKmh + " km/h"} />
        <Metric label="CAT DIST"       value={fmt(r.longitudinalDist, 1, "m")} />
        <Metric label="LATERAL"        value={fmt(r.lateralDist != null ? Math.abs(r.lateralDist) : null, 2, "m")} />
        <Metric label="REL SPEED"      value={r.velocity ? fmt(r.velocity.speed, 1, "m/s") : "--"} />
        <Metric label="TTC"            value={r.ttc != null ? r.ttc + " s" : "SAFE"} highlight={r.ttc != null && r.ttc < 3} />
        <Metric label="UNCERTAINTY"    value={fmt(r.uncertainty, 2, "m")} />
        <Metric label="SAFETY MARGIN"  value={Number.isFinite(r.safetyMargin) ? fmt(r.safetyMargin, 2, "m") : "CLEAR"} />
        <Metric label="PATH STATUS"
          value={r.catInPath ? "IN PATH" : r.catInPredictedPath ? "PREDICTED" : "CLEAR"}
          color={r.catInPath ? "#ff1a2e" : r.catInPredictedPath ? "#ff9900" : "#4dffaa"}
        />
      </div>

      {/* Risk bar */}
      <div className="crh-risk-row">
        <span className="crh-risk-label">RISK</span>
        <div className="crh-risk-bar-track">
          <div className="crh-risk-bar-fill" style={{ width: pct + "%", background: rColor }} />
        </div>
        <span className="crh-risk-pct" style={{ color: rColor }}>{pct}%</span>
        <span className="crh-risk-level" style={{ color: rColor }}>{r.riskLevel}</span>
      </div>

      {/* Predicted position note */}
      {r.predictedCatPos && (
        <div className="crh-pred">
          <span>PREDICTED POS</span>
          <b>X {r.predictedCatPos.x.toFixed(1)} m &nbsp;|&nbsp; Z {r.predictedCatPos.z.toFixed(1)} m</b>
        </div>
      )}

      {/* Replan info */}
      {r.replanPossible && (
        <div className="crh-replan">REPLAN PATH: SHIFT {r.replanDirection}</div>
      )}

      {/* Decision banner */}
      <div className="crh-decision" style={{ borderColor: commandColor, color: commandColor }}>
        <span className="crh-decision-cmd">{r.command}</span>
        <span className="crh-decision-text">{r.decision}</span>
      </div>
    </div>
  );
}

function Stage({ label, active, done, color }) {
  return (
    <div className={"crh-stage" + (done ? " crh-stage-done" : "")} style={color ? { borderColor: color, color } : {}}>
      {done && <span className="crh-stage-tick">&#10003;</span>}
      {label}
    </div>
  );
}

function Arrow() {
  return <div className="crh-arrow">&#8594;</div>;
}

function Metric({ label, value, highlight, color }) {
  return (
    <div className="crh-metric">
      <span>{label}</span>
      <b style={{ color: color || (highlight ? "#ff6a1a" : undefined) }}>{value}</b>
    </div>
  );
}
