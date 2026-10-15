import { beforeEach, describe, expect, it } from "vitest";

import { useTopologyStore } from "./topology-store";

const pos = (id: string) => useTopologyStore.getState().nodes.find((n) => n.id === id)!.position;

describe("undo and redo", () => {
  beforeEach(() => {
    useTopologyStore.getState().reset();
    useTopologyStore.getState().addNode("server", { x: 0, y: 0 });
  });

  it("undoes a whole drag back to where it started", () => {
    const { applyNodeChanges } = useTopologyStore.getState();
    const id = useTopologyStore.getState().nodes[0]!.id;
    const start = { ...pos(id) };

    // React Flow sends one change per mouse move while dragging, then one with dragging=false.
    for (const x of [10, 30, 60]) {
      applyNodeChanges([{ type: "position", id, position: { x, y: x }, dragging: true }]);
    }
    applyNodeChanges([{ type: "position", id, position: { x: 60, y: 60 }, dragging: false }]);
    expect(pos(id)).toEqual({ x: 60, y: 60 });

    useTopologyStore.getState().undo();
    expect(pos(id)).toEqual(start);

    useTopologyStore.getState().redo();
    expect(pos(id)).toEqual({ x: 60, y: 60 });
  });

  it("records one history step per drag, not one per mouse move", () => {
    const { applyNodeChanges } = useTopologyStore.getState();
    const id = useTopologyStore.getState().nodes[0]!.id;
    const before = useTopologyStore.getState().past.length;
    for (const x of [5, 10, 15, 20]) {
      applyNodeChanges([{ type: "position", id, position: { x, y: 0 }, dragging: true }]);
    }
    applyNodeChanges([{ type: "position", id, position: { x: 20, y: 0 }, dragging: false }]);
    expect(useTopologyStore.getState().past.length).toBe(before + 1);
  });
});

describe("adding nodes", () => {
  it("does not stack a second node on top of the first", () => {
    useTopologyStore.getState().reset();
    useTopologyStore.getState().addNode("workstation", { x: 100, y: 100 });
    useTopologyStore.getState().addNode("attacker", { x: 100, y: 100 });
    const [a, b] = useTopologyStore.getState().nodes.map((n) => n.position);
    expect(Math.abs(a!.x - b!.x) >= 150 || Math.abs(a!.y - b!.y) >= 130).toBe(true);
  });
});
