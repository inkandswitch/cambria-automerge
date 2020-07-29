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
  private instances: { [schema: string]: Instance };
  private graph: Graph;
  private jsonschema7: { [schema: string]: JSONSchema7 };

  constructor(opts: InitOptions) {
    this.schema = opts.schema || "mu";
    this.history = [];
    this.instances = {};
    this.graph = new Graph();
    this.jsonschema7 = { mu: emptySchema };
    this.graph.setNode("mu", true);

    for (let lens of opts.lenses || []) {
      this.addLens(lens);
    }
  }

  applyLocalChange(request: Change): AutomergePatch {
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
    this.applySchemaChanges([block], this.schemas);

    return patch;
  }

  reset() {
    this.instances = {};
  }

  addLens(block: RegisteredLens) {
    const from = block.from;
    const to = block.to;
    const lens = block.lens;

    // we reqire for now that lenses be loaded in the right order - from before to
    if (!this.graph.node(from)) {
      throw new RangeError(`unknown schema ${from}`);
    }

    // if to exists this is a dup - ignore
    if (this.graph.node(to)) {
      return;
    }

    // if there's already a lens between two schemas, don't add this new one
    // if (this.graph.edge({ v: lens.source, w: lens.destination })) return

    this.graph.setNode(to, true);
    this.graph.setEdge(from, to, lens);
    this.graph.setEdge(to, from, reverseLens(lens));

    this.jsonschema7[to] = updateSchema(this.jsonschema7[from], lens);
  }

  // take a change and apply it everywhere
  // take a change and apply it everywhere except one place
  // take all changes and apply them in one place

  applyChanges(blocks: CambriaBlock[]): AutomergePatch {
    this.history.push(...blocks);
    return this.applySchemaChanges(blocks, this.schemas);
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

  convertOp(change: Change, index: number, from: Instance, to: Instance): Op[] {
    const op = change.ops[index];
    const lensStack = this.lensesFromTo(from.schema, to.schema);
    const jsonschema7 = this.jsonschema7[from.schema];
    const patch = opToPatch(op, from);
    const convertedPatch = applyLensToPatch(lensStack, patch, jsonschema7);
    const convertedOps = patchToOps(convertedPatch, change, index, to);

    return convertedOps;
  }

  convertChange(block: AutomergeChange, to: string): Change {
    const lensStack = this.lensesFromTo(block.schema, to);

    const ops: Op[] = [];

    let from_instance = this.cloneInstance(block.schema);
    let to_instance = this.cloneInstance(to);

    for (let i = 0; i < block.change.ops.length; i++) {
      const op = block.change.ops[i];
      const convertedOps = this.convertOp(
        block.change,
        i,
        from_instance,
        to_instance
      );
      ops.push(...convertedOps);
      from_instance = this.applyOps(from_instance, [op]);
      to_instance = this.applyOps(to_instance, convertedOps);
    }

    /*
    const from = this.getInstanceAtSeq(block.schema, block.seq) // assume clones
    const to = this.getInstanceAtSeq(to, block.seq)

    for (let op of block.change.ops) {
      const convertedOps = this.convertOp(op, from, to);
      ops.push(... convertedOps)
      from = this.applyOps(from, [op])
      to = this.applyOps(to, convertedOps)
    }

    // save cange to getInstanceAtSeq can do something with it
    */

    const change = {
      ops,
      message: block.change.message,
      actor: block.change.actor,
      seq: block.change.seq,
      deps: to_instance.deps,
    };

    return change;
  }

  applyOps(instance: Instance, ops: Op[]): Instance {
    // construct a change out of the ops
    const change = {
      ops,
      message: "",
      actor: CAMBRIA_MAGIC_ACTOR,
      seq: (instance.clock[CAMBRIA_MAGIC_ACTOR] || 0) + 1,
      deps: instance.deps,
    };

    const [newInstance, _] = this.applyChangesToInstance(instance, [change]);
    return newInstance;
  }

  // write a change to the instance,
  // and update all the metadata we're keeping track of in the Instance
  // only apply changes through this function!!
  applyChangesToInstance(
    instance: Instance,
    changes: Change[]
  ): [Instance, AutomergePatch] {
    // FIXME
    //fillOutDeps(instance.deps, changesToApply)
    //fillOutStartOps()
    //fillOutPred()

    const [backendState, patch] = Backend.applyChanges(instance.state, changes);

    return [
      {
        clock: patch.clock || {},
        schema: instance.schema,
        bootstrapped: instance.bootstrapped,
        deps: patch.deps || {},
        // seq: number; // for now, use clock instead -- multiple actors w/ different sequences
        state: backendState,
      },
      patch,
    ];
  }

  applySchemaChanges(
    blocks: CambriaBlock[],
    schemas: string[]
  ): AutomergePatch {
    const changesToApply: Change[] = [];

    for (let block of blocks) {
      if (block.kind === "lens") {
        this.addLens(block);
        continue;
      }

      if (block.schema === this.schema) {
        changesToApply.push(block.change);
      } else {
        const newChange = this.convertChange(block, this.schema);
        changesToApply.push(newChange);
      }
    }

    const instance = this.getInstance(this.schema);

    if (!instance.bootstrapped) {
      const bootstrapChange = this.bootstrap(instance);

      changesToApply.unshift(bootstrapChange);
      instance.bootstrapped = true;
    }

    const [newInstance, patch] = this.applyChangesToInstance(
      instance,
      changesToApply
    );

    this.instances[this.schema] = newInstance;

    return patch;
  }

  /*
    const instanceCache = {};
    const opCache = {};
    const changeCache = {};

    for (let schema of schemas) {
      instanceCache[schema] = { ...this.getInstance(schema) };
      opCache[schema] = [];
      changeCache[schema] = [];
    }

    // run the ops through one at a time to apply the change
    // we're throwing all this away and will start over below
    // I can probably replace this by lifting the LocalChange code from automerge

    for (let block of blocks) {
      if (block.kind === "lens") {
        this.addLens(block.from, block.to, block.lens);
        continue;
      }

      for (let i in block.change.ops) {
        const op = block.change.ops[i];
        for (let schema of schemas) {
          const from = instanceCache[block.schema];
          const to = instanceCache[schema];
          const convertedOps = this.convertOp(op, from, to);
          const deps = to.deps; // FIXME - need to actually translate the deps
          const microChange = {
            actor: block.change.actor,
            message: block.change.message,
            deps,
            seq: to.seq,
            startOp: to.startOp,
            time: 0,
            ops: convertedOps,
          };
          opCache[schema].push(...convertedOps);
          const binMicroChange = encodeChange(microChange);
          const [newDoc, patch] = Backend.applyChanges(to.doc, [
            binMicroChange,
          ]);
          to.doc = newDoc;
          to.seq += 1;
          to.startOp += 1;
          to.deps = patch.deps;
        }
      }

      for (let schema of schemas) {
        const instance = this.getInstance(block.schema);
        const doc = instance.doc;
        const ops = opCache[schema];
        const deps = instance.deps;
        instance.seq += 1;
        const change: Change = {
          actor: block.change.actor,
          message: block.change.message,
          deps,
          seq: instance.seq,
          startOp: instance.startOp,
          ops,
          time: 0,
        };
        const binChange = encodeChange(change);
        changeCache[schema].push(binChange);
        opCache[schema] = [];
      }
    }

    // rewind and apply the ops all at once - get the patch

    let finalPatch;

    for (let schema of schemas) {
      const instance = this.getInstance(schema);
      const [newDoc, patch] = Backend.applyChanges(
        instance.doc,
        changeCache[schema]
      );
      // FIXME - startOp / seq
      instance.doc = newDoc;
      instance.deps = patch.deps;
      if (schema === this.schema) {
        finalPatch = patch;
      }
    }

    if (finalPatch === undefined) {
      finalPatch = Backend.getPatch(this.getInstance(this.schema).doc);
    }

    return finalPatch;
  }
*/

  /*
  applyChange2(change: Change) {
    this.history.push(change)
    //this.clock[change.actor] = change.seq
    //this.deps = calcDeps(change, this.deps)

    for (const index in change.ops) {
      if (change.ops[index]) {
        const op = change.ops[index]
        op.opId = `${change.startOp + index}@${change.actor}`
        this.schemas
          // sort schemas so that op.schema is run last ... FIXME
          .forEach((schema) => {
            this.lensOpToSchemaAndApply(op, schema)
          })
      }
    }
  }

  private lensOpToSchemaAndApply(op: Op, schema: string) {
    const fromInstance = this.getInstance(op.schema || 'mu')
    const toInstance = this.getInstance(schema)

    const lenses = this.lensesFromTo(op.schema || 'mu', schema)
    const patch = opToPatch(op, fromInstance)
    const jsonschema7 = this.jsonschema7[op.schema || "mu"]
    const newpatch = applyLensToPatch(lenses, patch, jsonschema7)
    applyPatch(toInstance, newpatch, op.opId as string)
  }
*/

  private cloneInstance(schema: string): Instance {
    const instance = this.getInstance(schema);
    return { ...instance };
  }

  private getInstance(schema: string): Instance {
    if (!this.instances[schema]) {
      const state = Backend.init();
      const instance = {
        state,
        deps: {},
        schema,
        bootstrapped: false,
        clock: {},
      };
      this.instances[schema] = instance;
    }
    return this.instances[schema];
  }

  private bootstrap(instance: Instance): Change {
    const urOp = [{ op: "add" as const, path: "", value: {} }];
    const jsonschema7: JSONSchema7 = this.jsonschema7[instance.schema];
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
    return this.graph.nodes();
  }

  public lensesFromTo(from: string, to: string): LensSource {
    const migrationPaths = alg.dijkstra(this.graph, to);
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
      const edge = this.graph.edge({ v, w });
      lenses.push(...edge);
    }
    return lenses;
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

      "/foo/bar/baz";
      "/foo/bar";

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
  let path: string[] = [];
  while (obj !== ROOT_ID) {
    const ref = opSet.getIn(["byObject", obj, "_inbound"], Set()).first();
    if (!ref) throw new RangeError(`No path found to object ${obj}`);
    path.unshift(ref as string);
    obj = ref.get("obj");
  }
  const finalPath = "/" + path.join("/") + op.key;
  return finalPath;
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
