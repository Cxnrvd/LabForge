/**
 * Attack-path computation for the canvas.
 *
 * Given a topology, find the set of nodes reachable from any attacker
 * node by following edges that aren't blocked by a firewall, and weight
 * each path by:
 *   • the severity of the CVEs pinned on intermediate nodes;
 *   • whether the target carries a vulnerable role (web, db, identity);
 *   • the protocol on each edge (privileged paths score higher).
 *
 * The output is consumed by the canvas to dim edges that aren't on any
 * attack path and to colour the highest-risk paths red.
 *
 * This is intentionally a heuristic — it's a *design-time hint*, not an
 * exploit planner. Real attack-graph tooling (BloodHound, MulVAL) does
 * the proper thing post-deployment; this just helps the user spot the
 * "oh I forgot to put the DB behind the firewall" mistake at design.
 */
import type { LabConfig, NodeType, TopologyEdge, TopologyNode } from "@labforge/schema";

export interface AttackPath {
  /** Node ids in order, attacker → target. */
  nodes: string[];
  /** Edge ids touched, in the same order. */
  edges: string[];
  /** 0–100 score; higher = more likely / more impactful. */
  score: number;
  /** Why it scored — surfaces in a tooltip on the canvas. */
  rationale: string[];
}

export interface AttackPathResult {
  paths: AttackPath[];
  /** Edge ids that appear on *any* path (used for opacity). */
  involvedEdges: Set<string>;
  /** Node ids that appear on any path (used for the badge). */
  involvedNodes: Set<string>;
  /** Highest score across all paths. */
  maxScore: number;
}

const HIGH_VALUE_ROLES = new Set([
  "AD-Domain-Services",
  "DNS",
  "mysql",
  "postgresql",
  "mongodb",
  "redis",
  "keycloak",
  "vault",
  "openplc",
  "rapidscada",
  "modbus-tcp",
  "wazuh-manager",
  "splunk",
  "elastic",
]);

const PRIVILEGED_PROTOCOLS = new Set(["ssh", "rdp", "smb", "ldap", "kerberos"]);

function roleScore(node: TopologyNode): number {
  let s = 0;
  for (const role of node.config.roles) {
    const bare = role.split("@", 1)[0] ?? role;
    if (HIGH_VALUE_ROLES.has(bare)) s += 10;
  }
  return s;
}

function cveScore(node: TopologyNode): number {
  return node.config.cves.length * 8;
}

function nodeIsBlocker(node: TopologyNode | undefined): boolean {
  if (!node) return false;
  // Firewalls don't fully block — they just impose a (small) cost. The
  // hint is "this node is at least *behind* something" rather than "no
  // attack possible".
  return node.type === ("firewall" satisfies NodeType);
}

function edgeWeight(
  edge: TopologyEdge,
  source: TopologyNode | undefined,
  target: TopologyNode | undefined,
): number {
  let w = 4;
  if (PRIVILEGED_PROTOCOLS.has(edge.protocol)) w += 6;
  if (nodeIsBlocker(source) || nodeIsBlocker(target)) w -= 5;
  return w;
}

export function computeAttackPaths(topology: LabConfig, maxDepth = 5): AttackPathResult {
  const nodesById = new Map<string, TopologyNode>();
  for (const n of topology.nodes) nodesById.set(n.id, n);

  // Undirected adjacency. We index outgoing edges in both directions so
  // an attacker reaching a server via inbound traffic isn't artificially
  // blocked by edge directionality the user happened to draw.
  const adj = new Map<string, { edge: TopologyEdge; other: string }[]>();
  for (const e of topology.edges) {
    adj.set(e.source, [...(adj.get(e.source) ?? []), { edge: e, other: e.target }]);
    adj.set(e.target, [...(adj.get(e.target) ?? []), { edge: e, other: e.source }]);
  }

  const attackers = topology.nodes.filter((n) => n.type === "attacker");
  const paths: AttackPath[] = [];
  const involvedEdges = new Set<string>();
  const involvedNodes = new Set<string>();

  for (const start of attackers) {
    // BFS so we get shortest paths first.
    type Frame = { nodeId: string; path: string[]; edges: string[]; visited: Set<string> };
    const queue: Frame[] = [
      { nodeId: start.id, path: [start.id], edges: [], visited: new Set([start.id]) },
    ];
    while (queue.length > 0) {
      const frame = queue.shift()!;
      const here = nodesById.get(frame.nodeId);
      if (!here) continue;
      // Score this position as a candidate terminus.
      if (here.id !== start.id) {
        const rationale: string[] = [];
        let score = 0;
        score += roleScore(here);
        if (roleScore(here) > 0) rationale.push("high-value role");
        score += cveScore(here);
        if (cveScore(here) > 0) {
          rationale.push(`${here.config.cves.length} CVE(s) pinned`);
        }
        if (frame.path.length <= 2) {
          score += 6;
          rationale.push("one-hop from attacker");
        }
        if (
          frame.path.some((id) => {
            const inter = nodesById.get(id);
            return inter && inter.type === "firewall";
          })
        ) {
          score -= 8;
          rationale.push("traverses firewall");
        }
        // Floor + ceiling
        score = Math.max(0, Math.min(100, score));
        if (score > 0) {
          paths.push({
            nodes: [...frame.path],
            edges: [...frame.edges],
            score,
            rationale,
          });
          for (const id of frame.path) involvedNodes.add(id);
          for (const id of frame.edges) involvedEdges.add(id);
        }
      }
      if (frame.path.length >= maxDepth) continue;
      for (const { edge, other } of adj.get(frame.nodeId) ?? []) {
        if (frame.visited.has(other)) continue;
        const visited = new Set(frame.visited);
        visited.add(other);
        queue.push({
          nodeId: other,
          path: [...frame.path, other],
          edges: [...frame.edges, edge.id],
          visited,
        });
      }
    }
  }

  paths.sort((a, b) => b.score - a.score);
  const maxScore = paths.length > 0 && paths[0] ? paths[0].score : 0;
  return { paths, involvedEdges, involvedNodes, maxScore };
}

/** Tailwind colour token for the given score. */
export function pathColour(score: number): string {
  if (score >= 60) return "rgb(220 38 38)"; // red-600
  if (score >= 30) return "rgb(234 88 12)"; // orange-600
  if (score > 0) return "rgb(202 138 4)"; // yellow-600
  return "rgb(100 116 139)"; // slate-500
}
