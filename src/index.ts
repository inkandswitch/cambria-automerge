import { Set } from "immutable";
import { LensGraph, initLensGraph, registerLens, lensGraphSchema, lensFromTo, lensGraphSchemas } from 'cloudina/dist/lens-graph'

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
  lensGraph: LensGraph;
  private instances: { [schema: string]: Instance };

  constructor({schema = 'mu', lenses = []}: InitOptions) {
    this.schema = schema;
    this.history = [];
    this.instances = {};
    this.lensGraph = lenses.reduce<LensGraph>( (graph, lens) =>
      registerLens(graph, lens.from, lens.to, lens.lens)
    , initLensGraph());
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
    const history = this.history
    const [newInstance, patch, newLensGraph] = applySchemaChanges(
      blocks,
      instance,
      this.lensGraph,
      history
    );
    this.instances[this.schema] = newInstance;
    this.lensGraph = newLensGraph
    return patch;
  }

  getChanges(haveDeps: Clock): CambriaBlock[] {
    // FIXME - todo
    return [];
  }

  private getInstance(schema: string): Instance {
    if (!this.instances[schema]) {
      this.instances[schema] = initInstance(schema);
    }
    return this.instances[schema];
  }
}

function initInstance(schema): Instance {
  const state = Backend.init();
  return {
    state,
    deps: {},
    schema,
    bootstrapped: false,
    clock: {},
  };
}

function convertOp(
  change: Change,
  index: number,
  from: Instance,
  to: Instance,
  lensGraph: LensGraph
): Op[] {
  const op = change.ops[index];
  const lensStack = lensFromTo(lensGraph, from.schema, to.schema);
  const jsonschema7 = lensGraphSchema(lensGraph, from.schema);
  const patch = opToPatch(op, from);
  const convertedPatch = applyLensToPatch(lensStack, patch, jsonschema7);
  const convertedOps = patchToOps(convertedPatch, change, index, to);

  // a convenient debug print to see the pipeline:
  // original automerge op -> json patch -> cloudina converted json patch -> new automerge op
  // console.log({ op, patch, convertedPatch, convertedOps });

  return convertedOps;
}

function getInstanceAt(
  schema: string,
  actorId: string,
  seq: number,
  graph: LensGraph,
  history: CambriaBlock[]
): [Instance, LensGraph] {
  const blockIndex = history.findIndex(
    (block) =>
      block.kind === "change" &&
      block.change.actor === actorId &&
      block.change.seq == seq
  );

  if (blockIndex === -1)
    throw new Error(
      `Could not find block with actorId ${actorId} and seq ${seq}`
    );

  const blocksToApply = history.slice(0, blockIndex);

  // todo: make sure we set default values even if lens not in doc
  const empty = initInstance(schema);
  const [instance, _, newGraph] = applySchemaChanges(blocksToApply, empty, graph, history);
  return [instance, newGraph];
}


function convertChange(
  block: AutomergeChange,
  from_instance: Instance,
  to_instance: Instance,
  lensGraph: LensGraph
): Change {
  const ops: Op[] = [];

  from_instance = { ...from_instance };
  to_instance = { ...to_instance };

  for (let i = 0; i < block.change.ops.length; i++) {
    const op = block.change.ops[i];
    const convertedOps = convertOp(
      block.change,
      i,
      from_instance,
      to_instance,
      lensGraph
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
    deps: block.change.deps, // todo: does this make sense? I think so?
  };

  return change;
}

// write a change to the instance,
// and update all the metadata we're keeping track of in the Instance
// only apply changes through this function!!

function applySchemaChanges(
  blocks: CambriaBlock[],
  instance: Instance,
  lensGraph: LensGraph,
  history: CambriaBlock[],
): [Instance, AutomergePatch, LensGraph] {
  const changesToApply: Change[] = [];

  for (let block of blocks) {
    if (block.kind === "lens") {
      lensGraph = registerLens(lensGraph, block.from, block.to, block.lens);
      continue;
    }

    if (block.schema === instance.schema) {
      changesToApply.push(block.change);
    } else {
      const [from_instance, _] = getInstanceAt(
        block.schema,
        block.change.actor,
        block.change.seq,
        lensGraph,
        history
      );
      const newChange = convertChange(block, from_instance, instance, lensGraph);
      changesToApply.push(newChange);
    }
  }

  if (!instance.bootstrapped) {
    const bootstrapChange = bootstrap(instance, lensGraph);

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

  return [newInstance, patch, lensGraph];
}

function bootstrap(instance: Instance, lensGraph: LensGraph): Change {
  const urOp = [{ op: "add" as const, path: "", value: {} }];
  const jsonschema7: JSONSchema7 = lensGraphSchema(lensGraph, instance.schema)
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

      const obj = getObjId(instance.state, obj_path) || pathCache[obj_path];
      if (obj === undefined)
        throw new Error(`Could not find object with path ${obj_path}`);

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
  const finalPath = "/" + [...path, op.key].join("/");
  return finalPath;
}

// Given a json path in a json doc, return the object ID at that path
// Todo: support lists
function getObjId(state: any, path: string): string {
  if (path === "") return ROOT_ID;

  const pathSegments = path.split("/").slice(1);
  const opSet = state.get("opSet");

  let objectId = ROOT_ID;

  for (const pathSegment of pathSegments) {
    const objectKeys = opSet.getIn(["byObject", objectId]);
    // todo: don't just take the first one here -- pick the right one (sort by seq?)
    objectId = objectKeys.getIn(["_keys", pathSegment, 0, "value"]);
  }

  return objectId;
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

