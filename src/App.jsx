import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { useProgress } from "@react-three/drei";
import Experience from "./Experience";
import HUD from "./components/HUD";
import IntroOverlay from "./components/IntroOverlay";
import EngineOverlay from "./components/EngineOverlay";
import DestinationPanel from "./components/DestinationPanel";
import ArrivalPanel from "./components/ArrivalPanel";

import { DESTINATIONS } from "./data";

// Real asset-loading progress via Drei's useProgress hook.
function LoadingScreen() {
  const { progress, item } = useProgress();
  const pct = Math.round(progress);
  return (
    <div className="scene-loading">
      <strong>AUTONEX</strong>
      <span>{item ? `Loading ${item.split("/").pop()}…` : "Preparing vehicle and cinematic scene…"}</span>
      <div className="loading-bar-track">
        <div className="loading-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <small className="loading-pct">{pct}%</small>
    </div>
  );
}

class SceneErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("AUTONEX 3D scene error:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="scene-error">
          <strong>AUTONEX 3D could not start.</strong>
          <span>{this.state.error.message}</span>
          <small>Open DevTools → Console and send the red error if this remains visible.</small>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [phase, setPhase] = useState("loading");
  const [introProgress, setIntroProgress] = useState(0);
  const [engineOn, setEngineOn] = useState(false);
  const [targetId, setTargetId] = useState(null);
  const [arrivedAt, setArrivedAt] = useState(null);
  const [doorOpen, setDoorOpen] = useState(false);
  const [driveProgress, setDriveProgress] = useState(0);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [cameraMode, setCameraMode] = useState("cockpit");
  const [driveStatus, setDriveStatus] = useState({ command: "IDLE", decision: "ROAD CLEAR", signal: null, frontDistance: null, passingClear: true, turnAhead: false, ttc: null });
  const bootTimer = useRef(null);

  const target = useMemo(
    () => DESTINATIONS.find((d) => d.id === targetId) ?? null,
    [targetId]
  );

  const handleSceneReady = useCallback(() => {
    setPhase((current) => current === "loading" ? "intro" : current);
  }, []);

  const finishIntro = useCallback(() => {
    setIntroProgress(1);
    setPhase("cockpit");
  }, []);

  function startEngine() {
    if (engineOn) return;
    setEngineOn(true);
    setCameraMode("cockpit");
    setPhase("boot");
    window.clearTimeout(bootTimer.current);
    bootTimer.current = window.setTimeout(() => setPhase("world"), 2400);
  }

  function chooseDestination(id) {
    // Every new route starts in the requested default driver view.
    setCameraMode("cockpit");
    setDoorOpen(false);
    setArrivedAt(null);
    setDriveProgress(0);
    setTargetId(id);
  }

  function onArrival(id) {
    setArrivedAt(id);
    setDoorOpen(true);
    setDriveProgress(1);
    setSpeedKmh(0);
    setDriveStatus({ command: "PARK", decision: "DESTINATION REACHED", signal: null, frontDistance: null, passingClear: true, turnAhead: false, ttc: null });
  }

  function resetRoute() {
    setCameraMode("cockpit");
    setTargetId(null);
    setArrivedAt(null);
    setDoorOpen(false);
    setDriveProgress(0);
    setSpeedKmh(0);
    setDriveStatus({ command: "IDLE", decision: "ROAD CLEAR", signal: null, frontDistance: null, passingClear: true, turnAhead: false, ttc: null });
  }

  // Arrival UI is intentionally enabled only by Experience.onArrival after exact bay docking.
  const activeDestination = DESTINATIONS.find((d) => d.id === arrivedAt) ?? null;

  return (
    <main className="app-shell">
      <SceneErrorBoundary>
      <Canvas
        shadows={false}
        dpr={[1, 1.18]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ position: [7, 3.2, 92], fov: 48, near: 0.02, far: 380 }}
      >
        {/* Fix #10: Suspense gate — intro will only start after the GLB
            is fully decoded and bones are ready, even on slow machines. */}
        <Suspense fallback={null}>
          <Experience
            phase={phase}
            engineOn={engineOn}
            target={target}
            arrivedAt={arrivedAt}
            onArrival={onArrival}
            onDriveProgress={setDriveProgress}
            onSpeedChange={setSpeedKmh}
            onDriveStatus={setDriveStatus}
            doorOpen={doorOpen}
            onSceneReady={handleSceneReady}
            onIntroProgress={setIntroProgress}
            onIntroComplete={finishIntro}
            cameraMode={cameraMode}
          />
        </Suspense>
      </Canvas>
      </SceneErrorBoundary>

      <div className="scanlines" />

      {phase === "loading" && <LoadingScreen />}

      {phase === "intro" && <IntroOverlay progress={introProgress} />}

      {(phase === "cockpit" || phase === "boot") && (
        <EngineOverlay
          onStart={startEngine}
          starting={phase === "boot"}
          engineOn={engineOn}
        />
      )}

      {phase === "world" && (
        <>
          <HUD
            target={target}
            arrived={Boolean(arrivedAt)}
            progress={driveProgress}
            engineOn={engineOn}
            speedKmh={speedKmh}
            status={driveStatus}
          />

          <button
            className={`camera-toggle ${cameraMode === "top" ? "active" : ""}`}
            onClick={() => setCameraMode((mode) => mode === "cockpit" ? "top" : "cockpit")}
            aria-label={cameraMode === "cockpit" ? "Switch to top view" : "Return to cockpit view"}
          >
            <span>{cameraMode === "cockpit" ? "TOP VIEW" : "COCKPIT VIEW"}</span>
            <small>{cameraMode === "cockpit" ? "CAR + ROAD VIEW" : "RETURN TO DRIVER VIEW"}</small>
          </button>

          {!targetId && (
            <DestinationPanel destinations={DESTINATIONS} onChoose={chooseDestination} />
          )}

          {targetId && !arrivedAt && (
            <button className="floating-back" onClick={resetRoute}>
              CANCEL ROUTE
            </button>
          )}

          {activeDestination && (
            <ArrivalPanel
              destination={activeDestination}
              doorOpen={doorOpen}
              onOpenDoor={() => setDoorOpen(true)}
              onBack={resetRoute}
            />
          )}
        </>
      )}
    </main>
  );
}
