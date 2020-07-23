import { Graph, alg } from 'graphlib'
import { Patch, LensSource, LensOp, updateSchema, reverseLens, applyLensToPatch } from 'cloudina'
import { JSONSchema7 } from 'json-schema'
import { inspect } from 'util'
import { Op, Clock, Change, Micromerge, parseOpId } from './micromerge'

export const ROOT_ID = '00000000-0000-0000-0000-000000000000'

function deepInspect(object: any) {
  return inspect(object, false, null, true)
}

export interface ChangeRequest {
  ops: RequestOp[]
}

export interface RequestOp {
  action: string
  path: (string | number)[]
  // obj: string,
  // key: string,
  insert?: boolean
  value?: string | number | boolean
}

const emptySchema = {
  $schema: 'http://json-schema.org/draft-07/schema',
  type: 'object' as const,
  additionalProperties: false,
}

export class Cambriamerge {
  private actor: string
  history: Change[]
  private seq: number
  private maxOp: number
  private deps: Clock
  private clock: Clock
  private instances: { [schema: string]: Micromerge }
  private graph: Graph
  private jsonschema7: { [schema: string]: JSONSchema7 }

  constructor(actor?: string) {
    this.actor = actor || Math.floor(Math.random() * 100000).toString()
    this.history = []
    this.instances = {}
    this.seq = 0
    this.maxOp = 0
    this.deps = {}
    this.clock = {}
    this.graph = new Graph()
    this.jsonschema7 = { mu: emptySchema }
    this.graph.setNode('mu', true)
  }

  registerLens(from: string, to: string, lenses: LensSource) {
    if (!this.graph.node(from)) {
      throw new RangeError(`unknown schema ${from}`)
    }

    if (this.graph.node(to)) {
      throw new RangeError(`already have a schema named ${to}`)
    }

    // if there's already a lens between two schemas, don't add this new one
    // if (this.graph.edge({ v: lens.source, w: lens.destination })) return

    this.graph.setNode(to, true)
    this.graph.setEdge(from, to, lenses)
    this.graph.setEdge(to, from, reverseLens(lenses))

    this.jsonschema7[to] = updateSchema(this.jsonschema7[from], lenses)

    for (const change of this.history) {
      for (const op of change.ops) {
        this.lensOpToSchemaAndApply(op, to)
      }
    }
  }

  private bootstrap(instance: Micromerge, schema: string) {
    const urOp = [{ op: 'add' as const, path: '', value: {} }]
    const jsonschema7 = this.jsonschema7[schema]
    const defaultsPatch = applyLensToPatch([], urOp, jsonschema7).slice(1)
    applyPatch(instance, defaultsPatch, '0.1@ca4b41a')
  }

  private getInstance(schema: string): Micromerge {
    if (!this.instances[schema]) {
      const instance = new Micromerge()
      this.bootstrap(instance, schema)
      this.instances[schema] = instance
    }
    return this.instances[schema]
  }

  applyLocalChange(schema: string, request: ChangeRequest) {
    const instance = this.getInstance(schema)

    const deps = { ...this.deps }
    delete deps[this.actor]
    const startOp = this.maxOp + 1
    const { actor } = this
    const seq = this.seq + 1

    const ops = request.ops.map((reqOp, index) => {
      const insert = !!reqOp.insert
      const { obj, key } = instance.processPath(reqOp.path, insert)
      const op: Op = { schema, action: reqOp.action, obj, key, insert }
      if (reqOp.value) {
        op.value = reqOp.value
      }
      instance.applyOp({ ...op, opId: `${startOp + index}@${actor}` })
      return op
    })

    const change = { schema, actor, seq, deps, startOp, ops }

    instance.recordChange(change)
    this.applyChange(change)

    this.seq += 1
  }

  as(schema: string): any {
    const instance = this.getInstance(schema)
    return instance.root
  }

  get schemas(): string[] {
    return this.graph.nodes()
  }

  private lensesFromTo(from: string, to: string): LensSource {
    const migrationPaths = alg.dijkstra(this.graph, to)
    const lenses: LensOp[] = []
    if (migrationPaths[from].distance == Infinity) {
      console.log('infinity... error?')
      return [] // error?
    }
    if (migrationPaths[from].distance == 0) {
      return []
    }
    for (let v = from; v != to; v = migrationPaths[v].predecessor) {
      const w = migrationPaths[v].predecessor
      const edge = this.graph.edge({ v, w })
      lenses.push(...edge)
    }
    return lenses
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

  applyChange(change: Change) {
    this.history.push(change)
    this.clock[change.actor] = change.seq
    this.maxOp = Math.max(this.maxOp, change.startOp + change.ops.length - 1)
    this.deps = calcDeps(change, this.deps)

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
}

function calcDeps(change: Change, deps: Clock): Clock {
  const newDeps = {}
  for (const actor in deps) {
    if (deps[actor] > (change.deps[actor] || 0)) {
      newDeps[actor] = deps[actor]
    }
  }
  newDeps[change.actor] = change.seq
  return newDeps
}

export function applyOps(instance: Micromerge, ops: Op[]) {
  for (const op of ops) {
    instance.applyOp(op)
  }
}

function buildPath(op: Op, instance: Micromerge): string {
  let { obj } = op
  let { key } = op
  const path: (string | number)[] = []
  while (obj !== ROOT_ID) {
    if (Array.isArray(instance.byObjId[op.obj])) {
      const { visible } = instance.findListElement(op.obj, op.key)
      path.push(visible)
    } else {
      path.push(key)
    }
    ; ({ key, obj } = instance.ops[obj])
  }
  path.push(key)
  path.reverse()
  return `/${path.join('/')}`
}

function setAction(op: Op, instance: Micromerge): 'add' | 'replace' {
  if (Array.isArray(instance.byObjId[op.obj])) {
    return op.insert ? 'add' : 'replace'
  }
  return instance.metadata[op.obj][op.key] ? 'replace' : 'add'
}

export function opToPatch(op: Op, instance: Micromerge): Patch {
  switch (op.action) {
    case 'set': {
      const path = buildPath(op, instance)
      const { value } = op
      const action = setAction(op, instance)
      return [{ op: action, path, value }]
    }
    case 'del': {
      const path = buildPath(op, instance)
      return [{ op: 'remove', path }]
    }
    default:
      throw new RangeError(`unsupported op ${deepInspect(op)}`)
  }
}

export function applyPatch(instance: Micromerge, patch: Patch, incomingOpId: string): Op[] {
  let { counter, actor } = parseOpId(incomingOpId)
  return patch.map((patchop) => {
    let action
    if (patchop.op === 'remove') {
      action = 'del'
    } else if (patchop.op === 'add' || patchop.op === 'replace') {
      if (
        patchop.value === null ||
        ['string', 'number', 'boolean'].includes(typeof patchop.value)
      ) {
        action = 'set'
      } else if (Array.isArray(patchop.value)) {
        action = 'makeList'
      } else if (typeof patchop.value === 'object' && Object.keys(patchop.value).length === 0) {
        action = 'makeMap'
      } else {
        throw new RangeError(`bad value for patchop=${deepInspect(patchop)}`)
      }
    } else {
      throw new RangeError(`bad op type for patchop=${deepInspect(patchop)}`)
    }
    const path = patchop.path.split('/').slice(1)
    const { obj, key } = instance.processPath(path, patchop.op === 'add')
    const insert = patchop.op === 'add' && Array.isArray(instance.byObjId[obj])
    const opId = `${counter}@${actor}`
    counter += 0.1
    if (patchop.op === 'add' || patchop.op === 'replace') {
      const op = { opId, action, obj, key, insert, value: patchop.value }
      instance.applyOp(op) // side effect!!!
      return op
    }
    const op = { opId, action, obj, key, insert }
    instance.applyOp(op) // side effect!!!
    return op
  })
}
