export default function HUD({ target, arrived, progress, engineOn, speedKmh = 0, status = {} }) {
  const pct = Math.round((progress || 0) * 100);
  const command = arrived ? "PARK" : (status.command || (target ? "CRUISE" : "IDLE"));

  return (
    <>
      <div className="hud hud-left">
        <div className="hud-brand">
          <b>AUTONEX</b>
          <span>INDIADRIVE AI</span>
        </div>
        <div className="hud-row"><span>ENGINE</span><strong>{engineOn ? "ONLINE" : "OFF"}</strong></div>
        <div className="hud-row"><span>RADAR</span><strong>ACTIVE</strong></div>
        <div className="hud-row"><span>VISION</span><strong>ACTIVE</strong></div>
        <div className="hud-row"><span>PATH PLANNER</span><strong>{target ? "ADAPTIVE" : "STANDBY"}</strong></div>
      </div>

      <div className="hud hud-right">
        <div className="metric"><span>SPEED</span><strong>{arrived ? 0 : speedKmh}</strong><small>km/h</small></div>
        <div className="metric"><span>TARGET</span><strong className="metric-target">{target?.label ?? "NONE"}</strong></div>
        <div className="metric"><span>ROUTE</span><strong>{target ? `${pct}%` : "--"}</strong></div>
        <div className="metric"><span>COMMAND</span><strong>{command}</strong></div>
      </div>

      {target && !arrived && (
        <div className="decision-hud">
          <span className="decision-title">AUTONEX DECISION</span>
          <strong>{status.decision || "ROAD CLEAR"}</strong>
          <div><span>FRONT VEHICLE</span><b>{status.frontDistance != null ? `${status.frontDistance} m` : "CLEAR"}</b></div>
          <div><span>TTC</span><b>{status.ttc != null ? `${status.ttc} s` : "SAFE"}</b></div>
          <div><span>PASSING LANE</span><b>{status.passingClear === false ? "OCCUPIED" : "CLEAR"}</b></div>
          <div><span>INDICATOR</span><b>{status.signal || "OFF"}</b></div>
        </div>
      )}

      {target && !arrived && (
        <div className="route-progress">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
    </>
  );
}
