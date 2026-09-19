export default function EngineOverlay({ onStart, starting }) {
  return (
    <section className={`overlay cockpit-overlay cockpit-v3 ${starting ? "cockpit-starting" : ""}`}>
      <div className="cockpit-topline">
        <span>AUTONEX // DRIVER VIEW</span>
        <strong>{starting ? "IGNITION" : "READY"}</strong>
      </div>

      <div className="windshield-hud">
        <span>RADAR <b>{starting ? "SYNC" : "READY"}</b></span>
        <span>VISION <b>{starting ? "SYNC" : "READY"}</b></span>
        <span>TRACKING <b>{starting ? "SYNC" : "READY"}</b></span>
        <span>PLANNER <b>{starting ? "SYNC" : "READY"}</b></span>
      </div>

      {/* Small ignition control positioned over the centre console/dashboard area.
          It intentionally avoids the old floating modal-card look. */}
      <div className="cockpit-ignition">
        <span>{starting ? "AUTONEX BOOT" : "CENTRE CONSOLE"}</span>
        <button
          className={`push-start-v4 ${starting ? "starting" : ""}`}
          onClick={onStart}
          disabled={starting}
          aria-label="Start AutoNex engine"
        >
          <i />
          <small>{starting ? "SYSTEM" : "START"}</small>
          <b>{starting ? "BOOT" : "ENGINE"}</b>
        </button>
      </div>

      <div className="cockpit-message">
        {starting
          ? "Engine confirmed · sensor fusion and navigation are coming online…"
          : "Press the illuminated dashboard ignition to start AutoNex."}
      </div>
    </section>
  );
}
