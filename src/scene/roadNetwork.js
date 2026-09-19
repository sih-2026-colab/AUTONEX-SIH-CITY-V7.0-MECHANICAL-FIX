import * as THREE from "three";

export const ROAD_WIDTH = 9.2;
export const LANE_OFFSET = ROAD_WIDTH * 0.22;
export const HOME_NODE = "c165";

// Three long north-south roads connected by six cross streets.
// Destination parking bays sit on short spurs beyond the outer boulevards.
export const ROAD_NODES = {
  c165: [0, 0.34, 165],

  l110: [-52, 0.34, 110],
  c110: [0, 0.34, 110],
  r110: [52, 0.34, 110],
  team: [67, 0.34, 110],

  l35: [-52, 0.34, 35],
  c35: [0, 0.34, 35],
  r35: [52, 0.34, 35],
  prototype: [-67, 0.34, 35],

  l50: [-52, 0.34, -50],
  c50: [0, 0.34, -50],
  r50: [52, 0.34, -50],
  matlab: [67, 0.34, -50],

  l140: [-52, 0.34, -140],
  c140: [0, 0.34, -140],
  r140: [52, 0.34, -140],
  github: [-67, 0.34, -140],

  l230: [-52, 0.34, -230],
  c230: [0, 0.34, -230],
  r230: [52, 0.34, -230],
  video: [67, 0.34, -230],

  l320: [-52, 0.34, -320],
  c320: [0, 0.34, -320],
  r320: [52, 0.34, -320],
  architecture: [-67, 0.34, -320],

  c360: [0, 0.34, -360]
};

const rows = [110, 35, -50, -140, -230, -320];
const rowIds = ["110", "35", "50", "140", "230", "320"];

export const ROAD_EDGES = [
  ["c165", "c110"],
  ["c110", "c35"],
  ["c35", "c50"],
  ["c50", "c140"],
  ["c140", "c230"],
  ["c230", "c320"],
  ["c320", "c360"],

  ["l110", "l35"], ["l35", "l50"], ["l50", "l140"], ["l140", "l230"], ["l230", "l320"],
  ["r110", "r35"], ["r35", "r50"], ["r50", "r140"], ["r140", "r230"], ["r230", "r320"],

  ["l110", "c110"], ["c110", "r110"],
  ["l35", "c35"], ["c35", "r35"],
  ["l50", "c50"], ["c50", "r50"],
  ["l140", "c140"], ["c140", "r140"],
  ["l230", "c230"], ["c230", "r230"],
  ["l320", "c320"], ["c320", "r320"],

  ["r110", "team"],
  ["l35", "prototype"],
  ["r50", "matlab"],
  ["l140", "github"],
  ["r230", "video"],
  ["l320", "architecture"]
];

export const DESTINATION_NODE = {
  team: "team",
  prototype: "prototype",
  matlab: "matlab",
  github: "github",
  video: "video",
  architecture: "architecture"
};

export function vecForNode(id) {
  const p = ROAD_NODES[id];
  return new THREE.Vector3(p[0], p[1], p[2]);
}

function edgeDistance(a, b) {
  return vecForNode(a).distanceTo(vecForNode(b));
}

function adjacency() {
  const graph = Object.fromEntries(Object.keys(ROAD_NODES).map((id) => [id, []]));
  for (const [a, b] of ROAD_EDGES) {
    const w = edgeDistance(a, b);
    graph[a].push([b, w]);
    graph[b].push([a, w]);
  }
  return graph;
}

const GRAPH = adjacency();

export function nearestRoadNode(position) {
  let best = HOME_NODE;
  let bestDistance = Infinity;
  for (const id of Object.keys(ROAD_NODES)) {
    const d = vecForNode(id).distanceTo(position);
    if (d < bestDistance) {
      best = id;
      bestDistance = d;
    }
  }
  return best;
}

export function shortestNodePath(startId, endId) {
  if (startId === endId) return [startId];

  const dist = {};
  const prev = {};
  const unvisited = new Set(Object.keys(ROAD_NODES));
  for (const id of unvisited) dist[id] = Infinity;
  dist[startId] = 0;

  while (unvisited.size) {
    let current = null;
    let currentDistance = Infinity;
    for (const id of unvisited) {
      if (dist[id] < currentDistance) {
        current = id;
        currentDistance = dist[id];
      }
    }
    if (!current || current === endId) break;
    unvisited.delete(current);

    for (const [neighbor, weight] of GRAPH[current]) {
      if (!unvisited.has(neighbor)) continue;
      const next = dist[current] + weight;
      if (next < dist[neighbor]) {
        dist[neighbor] = next;
        prev[neighbor] = current;
      }
    }
  }

  const path = [endId];
  while (path[0] !== startId) {
    const p = prev[path[0]];
    if (!p) return [startId, endId];
    path.unshift(p);
  }
  return path;
}

function sampleQuadratic(a, b, c, segments = 12) {
  return new THREE.QuadraticBezierCurve3(a, b, c).getPoints(segments);
}

export function makeRoadLockedWaypoints(nodeIds, currentPosition) {
  const raw = nodeIds.map(vecForNode);
  if (!raw.length) return [];

  if (currentPosition && currentPosition.distanceTo(raw[0]) > 3.0) {
    raw.unshift(currentPosition.clone());
  }
  if (raw.length <= 2) return raw;

  const result = [raw[0].clone()];
  const turnRadius = 4.1;

  for (let i = 1; i < raw.length - 1; i++) {
    const prev = raw[i - 1];
    const corner = raw[i];
    const next = raw[i + 1];
    const inDir = prev.clone().sub(corner).normalize();
    const outDir = next.clone().sub(corner).normalize();
    const dot = inDir.dot(outDir);

    // Straight-through nodes need no curve.
    if (dot < -0.985) {
      result.push(corner.clone());
      continue;
    }

    const inLength = corner.distanceTo(prev);
    const outLength = corner.distanceTo(next);
    const radius = Math.min(turnRadius, inLength * 0.28, outLength * 0.28);
    const entry = corner.clone().add(inDir.multiplyScalar(radius));
    const exit = corner.clone().add(outDir.multiplyScalar(radius));
    result.push(entry);

    const curve = sampleQuadratic(entry, corner, exit, 12);
    for (let j = 1; j < curve.length; j++) result.push(curve[j]);
  }

  result.push(raw[raw.length - 1].clone());
  return result;
}

export function buildPolylineMetrics(points) {
  const cumulative = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += points[i - 1].distanceTo(points[i]);
    cumulative.push(total);
  }
  return { cumulative, total };
}

export function pointAlongPolyline(points, cumulative, distance, laneOffset = LANE_OFFSET) {
  if (points.length === 1) {
    return { position: points[0].clone(), tangent: new THREE.Vector3(0, 0, -1) };
  }

  const d = THREE.MathUtils.clamp(distance, 0, cumulative[cumulative.length - 1]);
  let segment = 1;
  while (segment < cumulative.length && cumulative[segment] < d) segment++;
  segment = Math.min(segment, points.length - 1);

  const a = points[segment - 1];
  const b = points[segment];
  const span = Math.max(0.0001, cumulative[segment] - cumulative[segment - 1]);
  const t = (d - cumulative[segment - 1]) / span;
  const position = a.clone().lerp(b, t);
  const tangent = b.clone().sub(a).normalize();
  const laneNormal = new THREE.Vector3(tangent.z, 0, -tangent.x);
  if (laneNormal.lengthSq() > 1e-6) position.add(laneNormal.normalize().multiplyScalar(laneOffset));
  return { position, tangent };
}

// Exported for world-generation convenience.
export const CITY_ROWS = rows;
export const CITY_ROW_IDS = rowIds;
