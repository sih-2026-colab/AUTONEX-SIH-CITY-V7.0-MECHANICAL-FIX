const trafficActors = new Map();

export function updateTrafficActor(id, data) {
  trafficActors.set(id, {
    id,
    position: data.position.clone(),
    velocity: data.velocity.clone(),
    speed: data.speed,
    updatedAt: performance.now()
  });
}

export function removeTrafficActor(id) {
  trafficActors.delete(id);
}

export function getTrafficActors() {
  return Array.from(trafficActors.values());
}
