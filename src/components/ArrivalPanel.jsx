export default function ArrivalPanel({
  destination,
  doorOpen,
  onOpenDoor,
  onBack
}) {
  function visit(url) {
    if (!url || url.startsWith("#")) {
      alert(
        `${destination.label} section placeholder.\nReplace its URL in src/data.js with your final SIH link.`
      );
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const hasSubLinks = destination.subLinks && destination.subLinks.length > 0;

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
          {hasSubLinks ? (
            <>
              <div className="arrival-sublinks">
                {destination.subLinks.map((link) => (
                  <button
                    key={link.url}
                    className="primary-button wide arrival-sublink-btn"
                    onClick={() => visit(link.url)}
                  >
                    {link.label}
                  </button>
                ))}
              </div>
              <button className="secondary-button wide" onClick={onBack}>
                NEXT DESTINATION
              </button>
            </>
          ) : (
            <>
              <button className="primary-button" onClick={() => visit(destination.url)}>
                ENTER {destination.label.toUpperCase()}
              </button>
              <button className="secondary-button" onClick={onBack}>
                NEXT DESTINATION
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
