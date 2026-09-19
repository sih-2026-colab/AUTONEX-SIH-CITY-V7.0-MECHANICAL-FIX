export default function IntroOverlay({ progress = 0 }) {
  const pct = Math.max(0, Math.min(100, progress * 100));
  const stage = pct < 28
    ? "HERO APPROACH"
    : pct < 58
      ? "LOW TRACKING SHOT"
      : pct < 78
        ? "CITY SIDE TRACK"
        : "ENTERING COCKPIT";

  return (
    <section className={`overlay intro-overlay intro-auto ${pct > 76 ? "intro-fade" : ""}`}>
      <div className="intro-copy">
        <div className="eyebrow">SMART INDIA HACKATHON 2026</div>
        <h1>AUTONEX</h1>
        <h2>INDIADRIVE AI</h2>
        <p>Uncertainty-Aware Autonomous Driving for Unstructured Indian Roads</p>

        <div className="system-line">
          <span className="pulse-dot" />
          PERCEPTION · PREDICTION · PLANNING · CONTROL
        </div>

        <div className="intro-sequence">
          <span>{stage}</span>
          <div><i style={{ width: `${pct}%` }} /></div>
          <small>Scene synchronized · cinematic entry begins only after the vehicle is ready.</small>
        </div>
      </div>
    </section>
  );
}
