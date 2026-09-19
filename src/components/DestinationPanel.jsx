export default function DestinationPanel({ destinations, onChoose }) {
  return (
    <section className="destination-panel">
      <div className="panel-heading">
        <span>AUTONEX NAVIGATION</span>
        <h2>Select destination</h2>
        <p>Select a tower. AutoNex will follow the city roads and drive the full route to its parking bay.</p>
      </div>

      <div className="destination-grid">
        {destinations.map((d, index) => (
          <button
            className="destination-card"
            key={d.id}
            onClick={() => onChoose(d.id)}
          >
            <span className="level">LEVEL {String(index + 1).padStart(2, "0")}</span>
            <strong>{d.label}</strong>
            <small>{d.subtitle}</small>
            <i style={{ background: d.color }} />
          </button>
        ))}
      </div>
    </section>
  );
}
