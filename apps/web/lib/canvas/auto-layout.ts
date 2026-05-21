/**
 * Layered LR layout for the canvas.
 *
 * No external graph library — we run a small BFS to rank nodes by their
 * distance from "source" nodes (no incoming edges), group same-rank nodes
 * into columns, and place each column from left to right. Zones are left
 * untouched.
 *
 * Good enough for the common topology shape (attacker → firewall → DMZ →
 * AD) where dagre's hierarchical layout would also produce a similar grid.
 */

export interface LayoutInputNode {
  id: string;
  type?: string;
}

export interface LayoutInputEdge {
  source: string;
  target: string;
}

export interface LayoutPosition {
  id: string;
  position: { x: number; y: number };
}

interface Options {
  columnSpacing?: number;
  rowSpacing?: number;
  originX?: number;
  originY?: number;
}

const DEFAULTS: Required<Options> = {
  columnSpacing: 260,
  rowSpacing: 180,
  originX: 80,
  originY: 80,
};

export function layoutTopology(
  nodes: LayoutInputNode[],
  edges: LayoutInputEdge[],
  opts: Options = {},
): LayoutPosition[] {
  const o = { ...DEFAULTS, ...opts };
  if (nodes.length === 0) return [];

  const ids = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    outgoing.get(e.source)!.push(e.target);
    incoming.get(e.target)!.push(e.source);
  }

  // Rank = longest path from any source. Sources are nodes with no incoming
  // edges; if every node has an incoming edge (a cycle), seed with the node
  // with the fewest incoming.
  const rank = new Map<string, number>();
  const sources = nodes.filter((n) => (incoming.get(n.id)?.length ?? 0) === 0);
  const seeds = sources.length > 0
    ? sources
    : [...nodes].sort(
        (a, b) =>
          (incoming.get(a.id)?.length ?? 0) - (incoming.get(b.id)?.length ?? 0),
      ).slice(0, 1);
  for (const s of seeds) rank.set(s.id, 0);

  // Iterative relaxation. Bounded by nodes.length iterations to handle
  // cycles without infinite loops.
  let changed = true;
  let guard = nodes.length + 4;
  while (changed && guard-- > 0) {
    changed = false;
    for (const n of nodes) {
      const inc = incoming.get(n.id) ?? [];
      if (inc.length === 0) continue;
      let best = -1;
      for (const src of inc) {
        const r = rank.get(src);
        if (r !== undefined && r > best) best = r;
      }
      if (best >= 0) {
        const next = best + 1;
        const prev = rank.get(n.id);
        if (prev === undefined || next > prev) {
          rank.set(n.id, next);
          changed = true;
        }
      }
    }
  }

  // Any orphan with neither incoming edge nor reachable seed lands in column 0.
  for (const n of nodes) {
    if (!rank.has(n.id)) rank.set(n.id, 0);
  }

  // Bucket by column.
  const columns = new Map<number, LayoutInputNode[]>();
  for (const n of nodes) {
    const c = rank.get(n.id) ?? 0;
    if (!columns.has(c)) columns.set(c, []);
    columns.get(c)!.push(n);
  }

  // Stable within-column order: by type, then id.
  for (const list of columns.values()) {
    list.sort((a, b) => {
      const t = (a.type ?? "").localeCompare(b.type ?? "");
      if (t !== 0) return t;
      return a.id.localeCompare(b.id);
    });
  }

  const out: LayoutPosition[] = [];
  const sortedCols = [...columns.keys()].sort((a, b) => a - b);
  const tallest = Math.max(...sortedCols.map((c) => columns.get(c)!.length));
  for (const col of sortedCols) {
    const list = columns.get(col)!;
    const colHeight = list.length;
    // Center each column vertically relative to the tallest column.
    const topPad = ((tallest - colHeight) * o.rowSpacing) / 2;
    list.forEach((n, idx) => {
      out.push({
        id: n.id,
        position: {
          x: o.originX + col * o.columnSpacing,
          y: o.originY + topPad + idx * o.rowSpacing,
        },
      });
    });
  }

  return out;
}
