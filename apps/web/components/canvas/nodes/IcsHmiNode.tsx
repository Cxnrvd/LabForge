"use client";

import { type NodeProps } from "@xyflow/react";

import { BaseNode } from "./BaseNode";
import type { FlowNodeData } from "@/lib/store/topology-store";

export function IcsHmiNode({ id, data, selected }: NodeProps) {
  return (
    <BaseNode
      id={id}
      data={data as FlowNodeData}
      selected={selected ?? false}
      type="ics_hmi"
    />
  );
}
