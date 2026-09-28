const trafficActors = new Map();
let heroActor = { position: null, speed: 0 };

export function updateTrafficActor(id, data) {
  trafficActors.set(id, {
    id,
    position: data.position.clone(),
    velocity: data.velocity.clone(),
    speed: data.speed,
    halfLength: data.halfLength ?? 1.93,
    halfWidth: data.halfWidth ?? 0.86,
    updatedAt: performance.now()
  });
}

export function removeTrafficActor(id) {
  trafficActors.delete(id);
}

export function getTrafficActors() {
  return Array.from(trafficActors.values());
}

export function updateHeroActor(data) {
  heroActor = {
    position: data.position ? data.position.clone() : null,
    speed: data.speed ?? 0
  };
}

export function getHeroActor() {
  return heroActor;
}
