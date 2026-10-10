import { GAME } from '../config.js';

const T = GAME.tileSize;
const COST = { walk: 1, fall: 1.5, drop: 1.5, jump: 2.5, double_jump: 3.5 };

// Path finding over the stage's nav graph (built by backend/stage_analysis.py).
// Nodes are standable tiles [col, row]; edges carry the move that the analyzer
// verified with pessimistic physics, so the real jump always has margin.
export class NavGraph {
  constructor(graph) {
    this.nodes = graph.nodes;
    this.moves = graph.moves;
    this.index = new Map(this.nodes.map(([c, r], i) => [key(c, r), i]));
    this.out = this.nodes.map(() => []);
    for (const [from, to, type, moveId] of graph.edges) {
      this.out[from]?.push({ from, to, type, move: moveId == null ? null : this.moves[moveId] });
    }
  }

  static from(stage) {
    const g = stage.navGraph;
    return g?.nodes?.length && g.edges?.length ? new NavGraph(g) : null;
  }

  x(i) {
    return (this.nodes[i][0] + 0.5) * T;
  }

  // The node a grounded body stands on (its centre column, or a neighbour).
  nodeUnder(body) {
    const row = Math.round((body.y + body.h / 2) / T) - 1;
    const col = Math.floor(body.x / T);
    for (const c of [col, col - 1, col + 1]) {
      const i = this.index.get(key(c, row));
      if (i !== undefined) return i;
    }
    return null;
  }

  // The node closest to a point, preferring nodes at or below it.
  nearest(x, y) {
    let best = null;
    let bestD = Infinity;
    this.nodes.forEach(([c, r], i) => {
      const nx = (c + 0.5) * T;
      const ny = (r + 1) * T;
      const d = Math.hypot(nx - x, (ny - y) * (ny < y ? 1.6 : 1));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  // Cheapest edge sequence from a to b (Dijkstra; graphs are a few hundred nodes).
  path(a, b) {
    if (a === b) return [];
    const n = this.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const via = new Array(n).fill(null);
    const done = new Uint8Array(n);
    dist[a] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === b) break;
      done[u] = 1;
      for (const e of this.out[u]) {
        const d = dist[u] + (COST[e.type] ?? 3);
        if (d < dist[e.to]) {
          dist[e.to] = d;
          via[e.to] = e;
        }
      }
    }
    if (!via[b]) return null;
    const edges = [];
    for (let e = via[b]; e; e = via[e.from]) edges.unshift(e);
    return edges;
  }
}

const key = (c, r) => `${c},${r}`;
