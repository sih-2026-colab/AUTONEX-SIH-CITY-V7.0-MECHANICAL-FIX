export default function ArrivalPanel({
  destination,
  doorOpen,
  onOpenDoor,
  onBack
}) {
  function visit() {
    if (destination.url.startsWith("#")) {
      alert(
        `${destination.label} section placeholder.\nReplace its URL in src/data.js with your final SIH link.`
      );
      return;
    }
    window.open(destination.url, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="arrival-panel">
      <div className="arrival-status">PARKED · BAY CENTER CONFIRMED</div>
      <h2>{destination.label}</h2>
      <p>{destination.subtitle}</p>

      {!doorOpen ? (
        <button className="primary-button wide" onClick={onOpenDoor}>
          OPEN DOOR
        </button>
      ) : (
        <div className="arrival-actions">
          <button className="primary-button" onClick={visit}>
            ENTER {destination.label.toUpperCase()}
          </button>
          <button className="secondary-button" onClick={onBack}>
            NEXT DESTINATION
          </button>
        </div>
      )}
    </section>
  );
}
