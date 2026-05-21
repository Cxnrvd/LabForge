import type { NodeType } from "@labforge/schema";
import type { NodeTypes } from "@xyflow/react";

import { AttackerNode } from "./AttackerNode";
import { CameraNode } from "./CameraNode";
import { DatabaseNode } from "./DatabaseNode";
import { DomainControllerNode } from "./DomainControllerNode";
import { FirewallNode } from "./FirewallNode";
import { IcsHmiNode } from "./IcsHmiNode";
import { IcsPlcNode } from "./IcsPlcNode";
import { InternetNode } from "./InternetNode";
import { RouterNode } from "./RouterNode";
import { ServerNode } from "./ServerNode";
import { TargetNode } from "./TargetNode";
import { WorkstationNode } from "./WorkstationNode";
import { ZoneNode } from "./ZoneNode";

const labNodeTypes: Record<NodeType, NodeTypes[string]> = {
  workstation: WorkstationNode,
  server: ServerNode,
  domain_controller: DomainControllerNode,
  router: RouterNode,
  firewall: FirewallNode,
  attacker: AttackerNode,
  target: TargetNode,
  database: DatabaseNode,
  ics_plc: IcsPlcNode,
  ics_hmi: IcsHmiNode,
  camera: CameraNode,
  internet: InternetNode,
};

export const nodeTypes: NodeTypes = {
  ...labNodeTypes,
  zone: ZoneNode,
};
