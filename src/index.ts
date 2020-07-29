import { Graph, alg } from "graphlib";

import { Set } from "immutable";

import { v5 } from "uuid";

const MAGIC_UUID = "f1bb7a0b-2d26-48ca-aaa3-92c63bbb5c50";

// This import doesn't pull in types for the Backend functions,
// maybe because we're importing from a non-root file?
import {
  Backend,
  Op,
  Clock,
  Change,
  Patch as AutomergePatch,
  BackendState,
} from "automerge";

import { JSONSchema7 } from "json-schema";
import {
  Patch as CloudinaPatch,
  LensSource,
  LensOp,
  updateSchema,
  reverseLens,
  applyLensToPatch,
} from "cloudina";
import { inspect } from "util";

// applyPatch PATCH needs to become - buildChange
// buildChange needs to incrementally track op state re 'make' - list 'insert' 'del'
// need to track deps/clock differently at the top level than at the instance level
// seq will be different b/c of lenses

const ROOT_ID = "00000000-0000-0000-0000-000000000000";
export const CAMBRIA_MAGIC_ACTOR = "0000000000";

function deepInspect(object: any) {
  return inspect(object, false, null, true);
}

const emptySchema = {
  $schema: "http://json-schema.org/draft-07/schema",
  type: "object" as const,
  additionalProperties: false,
};

export interface Instance {
  clock: Clock;
  schema: string;
  deps: Clock;
  bootstrapped: boolean;
  // seq: number; // for now, use clock instead -- multiple actors w/ different sequences
  state: BackendState;
}

export type CambriaBlock = AutomergeChange | RegisteredLens;

export interface RegisteredLens {
  kind: "lens";
  to: string;
  from: string;
  lens: LensSource;
}

export interface AutomergeChange {
  kind: "change";
  schema: string;
  change: Change;
}

export interface CloudinaState {
  graph: Graph;
  jsonschema7: { [schema: string]: JSONSchema7 };
}

export type InitOptions = {
  actorId?: string;
  schema?: string;
  lenses?: RegisteredLens[];
  deferActorId?: boolean;
  freeze?: boolean;
};

export function init(options: InitOptions = {}): CambriaState {
  return new CambriaState(options);
}

export function applyChanges(
  doc: CambriaState,
  changes: CambriaBlock[]
): [CambriaState, AutomergePatch] {
  const patch = doc.applyChanges(changes);
  return [doc, patch];
}

export function applyLocalChange(
  doc: CambriaState,
  request: Change
): [CambriaState, AutomergePatch] {
  let patch = doc.applyLocalChange(request);
  return [doc, patch];
}

export function getChanges(doc: CambriaState, haveDeps: Clock): CambriaBlock[] {
  return doc.getChanges(haveDeps);
}

export class CambriaState {
  schema: string;
  history: CambriaBlock[];
  cloudinaState: CloudinaState;
  private instances: { [schema: string]: Instance };

  constructor(opts: InitOptions) {
    this.schema = opts.schema || "mu";
    this.history = [];
    this.instances = {};

    this.cloudinaState = {
      jsonschema7: { mu: emptySchema },
      graph: new Graph(),
    };
    this.cloudinaState.graph.setNode("mu", true);

    for (let lens of opts.lenses || []) {
      addLens(this.cloudinaState, lens);
    }
  }

  applyLocalChange(request: Change): AutomergePatch {
    /*
    const instance = this.instances[this.schema];

    if (instance === undefined) {
      throw new RangeError(
        `cant apply change - no instance for '${this.schema}'`
      );
    }

    const oldDeps = instance.deps;

    const [state, patch] = Backend.applyLocalChange(instance.state, request);

    const changes = Backend.getChanges(state, oldDeps);

    if (changes.length !== 1) {
      throw new RangeError(
        `apply local changes produced invalid (${changes.length}) changes`
      );
    }

    const change: Change = changes[0];
    const block: AutomergeChange = {
      kind: "change",
      schema: this.schema,
      change,
      // FIXME hash // deps // actor
    };

    this.history.push(block);
    this.applySchemaChanges([block]);

    return patch;
     */
    throw new RangeError("unimplemented");
  }

  reset() {
    this.instances = {};
  }

  // take a change and apply it everywhere
  // take a change and apply it everywhere except one place
  // take all changes and apply them in one place

  applyChanges(blocks: CambriaBlock[]): AutomergePatch {
    this.history.push(...blocks);
    const instance: Instance = this.getInstance(this.schema);
    const [newInstance, patch] = this.applySchemaChanges(
      blocks,
      instance,
      this.cloudinaState
    );
    this.instances[this.schema] = newInstance;
    return patch;
  }

  getChanges(haveDeps: Clock): CambriaBlock[] {
    // FIXME - todo
    return [];
  }

  schemasEndingIn(schema: string): string[] {
    return this.schemas
      .filter((n) => n !== "mu")
      .sort((a, b) => (a === schema ? 1 : -1));
  }

  convertOp(
    change: Change,
    index: number,
    from: Instance,
    to: Instance,
    state: CloudinaState
  ): Op[] {
    const op = change.ops[index];
    const lensStack = lensesFromTo(state, from.schema, to.schema);
    const jsonschema7 = state.jsonschema7[from.schema];
    const patch = opToPatch(op, from);
    const convertedPatch = applyLensToPatch(lensStack, patch, jsonschema7);
    const convertedOps = patchToOps(convertedPatch, change, index, to);

    return convertedOps;
  }

  getInstanceAt(
    schema: string,
    actorId: string,
    seq: number,
    graph: CloudinaState
  ): Instance {
    const blockIndex = this.history.findIndex(
      (block) =>
        block.kind === "change" &&
        block.change.actor === actorId &&
        block.change.seq == seq
    );

    if (blockIndex === -1)
      throw new Error(
        `Could not find block with actorId ${actorId} and seq ${seq}`
      );

    const blocksToApply = this.history.slice(0, blockIndex);
    const instance = this.initInstance(schema);
    this.applySchemaChanges(blocksToApply, instance, graph);
    return instance;
  }

  convertChange(
    block: AutomergeChange,
    target: Instance,
    state: CloudinaState
  ): Change {
    const lensStack = lensesFromTo(state, block.schema, target.schema);

    const ops: Op[] = [];

    let from_instance = this.getInstanceAt(
      block.schema,
      block.change.actor,
      block.change.seq,
      state
    );
    let to_instance = { ...target };

    for (let i = 0; i < block.change.ops.length; i++) {
      const op = block.change.ops[i];
      // FIXME convertOp is pure if we pass in graph
      const convertedOps = this.convertOp(
        block.change,
        i,
        from_instance,
        to_instance,
        state
      );
      ops.push(...convertedOps);
      from_instance = applyOps(from_instance, [op]);
      to_instance = applyOps(to_instance, convertedOps);
    }

    const change = {
      ops,
      message: block.change.message,
      actor: block.change.actor,
      seq: block.change.seq,
      deps: to_instance.deps,
    };

    return change;
  }

  // write a change to the instance,
  // and update all the metadata we're keeping track of in the Instance
  // only apply changes through this function!!

  applySchemaChanges(
    blocks: CambriaBlock[],
    instance: Instance,
    state: CloudinaState
  ): [Instance, AutomergePatch] {
    const changesToApply: Change[] = [];

    for (let block of blocks) {
      if (block.kind === "lens") {
        addLens(state, block);
        continue;
      }

      if (block.schema === instance.schema) {
        changesToApply.push(block.change);
      } else {
        const newChange = this.convertChange(block, instance, state);
        changesToApply.push(newChange);
      }
    }

    if (!instance.bootstrapped) {
      const bootstrapChange = this.bootstrap(instance);

      // console.log(
      //   deepInspect({ schema: instance.schema, change: bootstrapChange })
      // );

      changesToApply.unshift(bootstrapChange);
      instance.bootstrapped = true;
    }

    const [newInstance, patch] = applyChangesToInstance(
      instance,
      changesToApply
    );

    return [newInstance, patch];
  }

  private getInstance(schema: string): Instance {
    if (!this.instances[schema]) {
      this.instances[schema] = this.initInstance(schema);
    }
    return this.instances[schema];
  }

  private initInstance(schema): Instance {
    const state = Backend.init();
    return {
      state,
      deps: {},
      schema,
      bootstrapped: false,
      clock: {},
    };
  }

  private bootstrap(instance: Instance): Change {
    const urOp = [{ op: "add" as const, path: "", value: {} }];
    const jsonschema7: JSONSchema7 = this.cloudinaState.jsonschema7[
      instance.schema
    ];
    if (jsonschema7 === undefined) {
      throw new Error(
        `Could not find JSON schema for schema ${instance.schema}`
      );
    }
    const defaultsPatch = applyLensToPatch([], urOp, jsonschema7).slice(1);

    const bootstrapChange: Change = {
      actor: CAMBRIA_MAGIC_ACTOR,
      message: "",
      deps: {},
      seq: 1,
      ops: [],
    };

    bootstrapChange.ops = patchToOps(
      defaultsPatch,
      bootstrapChange,
      1,
      instance
    );

    return bootstrapChange;
  }

  get schemas(): string[] {
    return this.cloudinaState.graph.nodes();
  }
}

function patchToOps(
  patch: CloudinaPatch,
  origin: Change,
  opIndex: number,
  instance: Instance
): Op[] {
  const opCache = {};
  const pathCache = { [""]: ROOT_ID };
  const ops = patch
    .map((patchop, i) => {
      const acc: Op[] = [];
      let makeObj = v5(
        `${origin.actor}:${origin.seq}:${opIndex}:${i}"`,
        MAGIC_UUID
      );
      let action;
      if (patchop.op === "remove") {
        action = "del";
      } else if (patchop.op === "add" || patchop.op === "replace") {
        if (
          patchop.value === null ||
          ["string", "number", "boolean"].includes(typeof patchop.value)
        ) {
          action = "set";
        } else if (Array.isArray(patchop.value)) {
          action = "makeList";
        } else if (
          typeof patchop.value === "object" &&
          Object.keys(patchop.value).length === 0
        ) {
          action = "link";
          acc.push({ action: "makeMap", obj: makeObj });
          pathCache[patchop.path] = makeObj;
        } else {
          throw new RangeError(`bad value for patchop=${deepInspect(patchop)}`);
        }
      } else {
        throw new RangeError(`bad op type for patchop=${deepInspect(patchop)}`);
      }

      let path_parts = patchop.path.split("/");
      let key = path_parts.pop();
      let obj_path = path_parts.join("/");

      const obj = pathCache[obj_path];

      if (action === "link") {
        const op = { action, obj, key, value: makeObj };
        acc.push(op);
      } else if (patchop.op === "add" || patchop.op === "replace") {
        const op = { action, obj, key, value: patchop.value };
        acc.push(op);
      } else {
        const op = { action, obj, key };
        acc.push(op);
      }
      return acc;
    })
    .flat();

  return ops;
}

/*
function applyPatch(
  instance: Instance,
  patch: CloudinaPatch,
  incomingOpId: string
): Op[] {
  let { counter, actor } = parseOpId(incomingOpId);
  return patch.map((patchop) => {
    let action;
    if (patchop.op === "remove") {
      action = "del";
    } else if (patchop.op === "add" || patchop.op === "replace") {
      if (
        patchop.value === null ||
        ["string", "number", "boolean"].includes(typeof patchop.value)
      ) {
        action = "set";
      } else if (Array.isArray(patchop.value)) {
        action = "makeList";
      } else if (
        typeof patchop.value === "object" &&
        Object.keys(patchop.value).length === 0
      ) {
        action = "makeMap";
      } else {
        throw new RangeError(`bad value for patchop=${deepInspect(patchop)}`);
      }
    } else {
      throw new RangeError(`bad op type for patchop=${deepInspect(patchop)}`);
    }
    const path = patchop.path.split("/").slice(1);
    const { obj, key } = instance.processPath(path, patchop.op === "add");
    const insert = patchop.op === "add" && Array.isArray(instance.byObjId[obj]);
    const opId = `${counter}@${actor}`;
    counter += 0.1;
    if (patchop.op === "add" || patchop.op === "replace") {
      const op = { opId, action, obj, key, insert, value: patchop.value };
      instance.applyOp(op); // side effect!!!
      return op;
    } else {
      const op = { opId, action, obj, key, insert };
      instance.applyOp(op); // side effect!!!
      return op;
    }
  });
}
*/

function parseOpId(opid: string): { counter: number; actor: string } {
  const regex = /^([0-9.]+)@(.*)$/;
  const match = regex.exec(opid);
  if (match == null) {
    throw new RangeError(`Invalid OpId ${opid}`);
  }
  const counter = parseFloat(match[1]);
  const actor = match[2];
  return { counter, actor };
}

export function buildPath(op: Op, instance: Instance): string {
  const backendState: any = instance.state;
  const opSet = backendState.state;
  let obj = op.obj;
  let path: string[] = getPath(instance.state, obj) || [];
  console.log(deepInspect({ path }));
  const finalPath = "/" + path.join("/") + op.key;
  return finalPath;
}

function getPath(state: any, obj: string): string[] | null {
  const opSet = state.get("opSet");
  let path: string[] = [];
  while (obj !== ROOT_ID) {
    const ref = opSet.getIn(["byObject", obj, "_inbound"], Set()).first();
    if (!ref) return null;
    obj = ref.get("obj");
    const objType = opSet.getIn(["byObject", obj, "_init", "action"]);

    if (objType === "makeList" || objType === "makeText") {
      const index = opSet
        .getIn(["byObject", obj, "_elemIds"])
        .indexOf(ref.get("key"));
      if (index < 0) return null;
      path.unshift(index);
    } else {
      path.unshift(ref.get("key"));
    }
  }
  return path;
}

export function opToPatch(op: Op, instance: Instance): CloudinaPatch {
  if (op.obj) {
    console.log(
      deepInspect({ op: op.obj, path: getPath(instance.state, op.obj) })
    );
  }
  switch (op.action) {
    case "set": {
      const path = buildPath(op, instance);
      const { value } = op;
      const action = "replace";
      return [{ op: action, path, value }];
    }
    case "ins": {
      const path = buildPath(op, instance);
      const { value } = op;
      const action = "add";
      return [{ op: action, path, value }];
    }
    case "del": {
      const path = buildPath(op, instance);
      return [{ op: "remove", path }];
    }
    default:
      throw new RangeError(`unsupported op ${deepInspect(op)}`);
  }
}

function calcDeps(change: Change, deps: Clock): Clock {
  const newDeps = {};
  for (const actor in deps) {
    if (deps[actor] > (change.deps[actor] || 0)) {
      newDeps[actor] = deps[actor];
    }
  }
  newDeps[change.actor] = change.seq;
  return newDeps;
}

// function lessOrEqual(clock1, clock2): boolean {
//   return Object.keys(clock1)
//     .concat(Object.keys(clock2))
//     .reduce(
//       (result, key) => result && (clock1[key] || 0) <= (clock2[key] || 0),
//       true
//     );
// }

// function clockEquals(clock1, clock2): boolean {
//   return lessOrEqual(clock1, clock2) && lessOrEqual(clock2, clock1);
// }

function applyChangesToInstance(
  instance: Instance,
  changes: Change[]
): [Instance, AutomergePatch] {
  const [backendState, patch] = Backend.applyChanges(instance.state, changes);

  return [
    {
      clock: patch.clock || {},
      schema: instance.schema,
      bootstrapped: instance.bootstrapped,
      deps: patch.deps || {},
      state: backendState,
    },
    patch,
  ];
}

function applyOps(instance: Instance, ops: Op[]): Instance {
  // construct a change out of the ops
  const change = {
    ops,
    message: "",
    actor: CAMBRIA_MAGIC_ACTOR,
    seq: (instance.clock[CAMBRIA_MAGIC_ACTOR] || 0) + 1,
    deps: instance.deps,
  };

  const [newInstance, _] = applyChangesToInstance(instance, [change]);
  return newInstance;
}

function addLens(state: CloudinaState, block: RegisteredLens) {
  const from = block.from;
  const to = block.to;
  const lens = block.lens;

  // we reqire for now that lenses be loaded in the right order - from before to
  if (!state.graph.node(from)) {
    throw new RangeError(`unknown schema ${from}`);
  }

  // if to exists this is a dup - ignore
  if (state.graph.node(to)) {
    return;
  }

  // if there's already a lens between two schemas, don't add this new one
  // if (this.graph.edge({ v: lens.source, w: lens.destination })) return

  state.graph.setNode(to, true);
  state.graph.setEdge(from, to, lens);
  state.graph.setEdge(to, from, reverseLens(lens));

  state.jsonschema7[to] = updateSchema(state.jsonschema7[from], lens);
}

export function lensesFromTo(
  cloudinaState: CloudinaState,
  from: string,
  to: string
): LensSource {
  const migrationPaths = alg.dijkstra(cloudinaState.graph, to);
  const lenses: LensOp[] = [];
  if (migrationPaths[from].distance == Infinity) {
    throw new Error(
      `Could not find lens path between schemas: ${from} and ${to}`
    );
  }
  if (migrationPaths[from].distance == 0) {
    return [];
  }
  for (let v = from; v != to; v = migrationPaths[v].predecessor) {
    const w = migrationPaths[v].predecessor;
    const edge = cloudinaState.graph.edge({ v, w });
    lenses.push(...edge);
  }
  return lenses;
}
