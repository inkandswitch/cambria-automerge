import { Set } from 'immutable'
import {
  LensGraph,
  initLensGraph,
  registerLens,
  lensGraphSchema,
  lensFromTo,
} from 'cloudina/dist/lens-graph'

import { v5 } from 'uuid'

// This import doesn't pull in types for the Backend functions,
// maybe because we're importing from a non-root file?
import { Backend, Op, Clock, Change, Patch as AutomergePatch, BackendState } from 'automerge'

import { JSONSchema7 } from 'json-schema'

import { Patch as CloudinaPatch, LensSource, applyLensToPatch } from 'cloudina'

import { inspect } from 'util'

const MAGIC_UUID = 'f1bb7a0b-2d26-48ca-aaa3-92c63bbb5c50'

type ObjectId = string
type ObjectType = 'list' | 'object'

// applyPatch PATCH needs to become - buildChange
// buildChange needs to incrementally track op state re 'make' - list 'insert' 'del'
// need to track deps/clock differently at the top level than at the instance level
// seq will be different b/c of lenses

const ROOT_ID = '00000000-0000-0000-0000-000000000000'
export const CAMBRIA_MAGIC_ACTOR = '0000000000'

function deepInspect(object: any) {
  return inspect(object, false, null, true)
}

export interface LensState {
  inDoc: Set<string>
  graph: LensGraph
}

export interface Instance {
  clock: Clock
  schema: string
  deps: Clock
  bootstrapped: boolean
  // seq: number; // for now, use clock instead -- multiple actors w/ different sequences
  state: BackendState
}

// export type CambriaBlock = AutomergeChange | RegisteredLens

type ElemCache = { [key: string]: Op }

export interface RegisteredLens {
  to: string
  from: string
  lens: LensSource
}

export interface CambriaBlock {
  schema: string
  lenses: RegisteredLens[]
  change: Change
}

export type InitOptions = {
  schema: string
  lenses: RegisteredLens[]
  // actorId?: string
  // deferActorId?: boolean
  // freeze?: boolean
}

export function init(options: InitOptions): CambriaBackend {
  return new CambriaBackend(options)
}

export function applyChanges(
  doc: CambriaBackend,
  changes: CambriaBlock[]
): [CambriaBackend, AutomergePatch] {
  const patch = doc.applyChanges(changes)
  return [doc, patch]
}

export function applyLocalChange(
  doc: CambriaBackend,
  request: Change
): [CambriaBackend, AutomergePatch, CambriaBlock ] {
  const [patch, block] = doc.applyLocalChange(request)
  return [doc, patch, block]
}

export function getPatch(doc: CambriaBackend): AutomergePatch {
  return doc.getPatch()
}

export function getChanges(doc: CambriaBackend, haveDeps: Clock): CambriaBlock[] {
  return doc.getChanges(haveDeps)
}

export class CambriaBackend {
  schema: string

  history: CambriaBlock[]

  lenses: RegisteredLens[]

  lensState: LensState

  private instances: { [schema: string]: Instance }

  constructor({ schema = 'mu', lenses = [] }: InitOptions) {
    this.schema = schema
    this.history = []
    this.instances = {}
    this.lenses = lenses
    this.lensState = {
      inDoc: Set(),
      graph: lenses.reduce<LensGraph>(
        (graph, lens) => registerLens(graph, lens.from, lens.to, lens.lens),
        initLensGraph()
      ),
    }
  }

  applyLocalChange(request: Change): [AutomergePatch, CambriaBlock] {
    let lenses: RegisteredLens[] = []

    if (!this.lensState.inDoc.has(this.schema)) {
      lenses = this.lenses // todo - dont have to put them ALL in
      this.lensState.inDoc = this.lensState.inDoc.union(Set(this.lenses.map((l) => l.to)))
    }

    const block = {
      schema: this.schema,
      lenses,
      change: request,
    }

    const instance = this.getInstance(this.schema)

    this.history.push(block)

    const [newState, patch] = Backend.applyLocalChange(instance.state, request)

    instance.state = newState

    return [patch, block]
  }

  getPatch(): AutomergePatch {
    this.applyChanges([]) // trigger the bootstrap block if need be
    return Backend.getPatch(this.getInstance(this.schema).state)
  }

  // take a change and apply it everywhere
  // take a change and apply it everywhere except one place
  // take all changes and apply them in one place

  applyChanges(blocks: CambriaBlock[]): AutomergePatch {
    this.history.push(...blocks)
    const instance: Instance = this.getInstance(this.schema)
    const { history } = this
    const [newInstance, patch, newLensState] = applySchemaChanges(
      blocks,
      instance,
      this.lensState,
      history
    )
    this.instances[this.schema] = newInstance
    this.lensState = newLensState
    return patch
  }

  getChanges(haveDeps: Clock): CambriaBlock[] {
    // FIXME - todo
    return []
  }

  private getInstance(schema: string): Instance {
    if (!this.instances[schema]) {
      this.instances[schema] = initInstance(schema)
    }
    return this.instances[schema]
  }
}

function initInstance(schema): Instance {
  const state = Backend.init()
  return {
    state,
    deps: {},
    schema,
    bootstrapped: false,
    clock: {},
  }
}

function convertOp(
  change: Change,
  index: number,
  from: Instance,
  to: Instance,
  lensState: LensState,
  elemCache: ElemCache
): Op[] {
  const op = change.ops[index]
  console.log('\n convertOp pipeline:')
  console.log({ from: from.schema, to: to.schema, op })
  const lensStack = lensFromTo(lensState.graph, from.schema, to.schema)
  const jsonschema7 = lensGraphSchema(lensState.graph, from.schema)
  const patch = opToPatch(op, from, elemCache)
  console.log({ patch })
  const convertedPatch = applyLensToPatch(lensStack, patch, jsonschema7)
  console.log({ convertedPatch })
  // todo: optimization idea:
  // if cloudina didn't do anything (convertedPatch deepEquals patch)
  // then we should just be able to set convertedOps = [op]

  const convertedOps = patchToOps(convertedPatch, change, index, to)
  console.log({ convertedOps })

  return convertedOps
}

function getInstanceAt(
  schema: string,
  actorId: string,
  seq: number,
  lensState: LensState,
  history: CambriaBlock[]
): [Instance, LensState] {
  const blockIndex = history.findIndex(
    (block) => block.change.actor === actorId && block.change.seq === seq
  )

  if (blockIndex === -1)
    throw new Error(`Could not find block with actorId ${actorId} and seq ${seq}`)

  const blocksToApply = history.slice(0, blockIndex)

  // todo: make sure we set default values even if lens not in doc
  const empty = initInstance(schema)
  const [instance, , newGraph] = applySchemaChanges(blocksToApply, empty, lensState, history)
  return [instance, newGraph]
}

function convertChange(
  block: CambriaBlock,
  fromInstance: Instance,
  toInstance: Instance,
  lensState: LensState
): Change {
  const ops: Op[] = []
  // copy the from and to instances locally to ensure we don't mutate them.
  // we're going to play these instances forward locally here as we apply the ops,
  // but then we'll throw that out and just return a change which will be
  // applied by the caller of this function to the toInstance.
  // todo: is this unnecessary?
  let from = { ...fromInstance }
  let to = { ...toInstance }

  // cache array insert ops by the elem that they created
  // (cache is change-scoped because we assume insert+set combinations are within same change)
  const elemCache: ElemCache = {}

  block.change.ops.forEach((op, i) => {
    if (op.action === 'ins') {
      // add the elem to cache
      elemCache[`${block.change.actor}:${op.elem}`] = op

      // apply the discarded insert to the from instance before we skip conversion
      from = applyOps(from, [op], block.change.actor)
      return
    }
    const convertedOps = convertOp(block.change, i, from, to, lensState, elemCache)
    ops.push(...convertedOps)

    // After we convert this op, we need to incrementally apply it
    // to our instances so that we can do path-objId resolution using
    // these instances
    from = applyOps(from, [op], block.change.actor)
    to = applyOps(to, convertedOps, block.change.actor)
  })

  const change = {
    ops,
    message: block.change.message,
    actor: block.change.actor,
    seq: block.change.seq,
    deps: block.change.deps, // todo: does this make sense? I think so?
  }

  return change
}

// write a change to the instance,
// and update all the metadata we're keeping track of in the Instance
// only apply changes through this function!!

function applySchemaChanges(
  blocks: CambriaBlock[],
  instance: Instance,
  lensState: LensState,
  history: CambriaBlock[]
): [Instance, AutomergePatch, LensState] {
  const changesToApply: Change[] = []

  for (const block of blocks) {
    for (const lens of block.lenses) {
      // FIXME
      const oldInDoc = lensState.inDoc
      lensState = {
        inDoc: oldInDoc.add(lens.to),
        graph: registerLens(lensState.graph, lens.from, lens.to, lens.lens),
      }
    }

    if (block.schema === instance.schema) {
      changesToApply.push(block.change)
    } else {
      const [fromInstance] = getInstanceAt(
        block.schema,
        block.change.actor,
        block.change.seq,
        lensState,
        history
      )

      const newChange = convertChange(block, fromInstance, instance, lensState)
      changesToApply.push(newChange)
    }
  }

  if (!instance.bootstrapped) {
    const bootstrapChange = bootstrap(instance, lensState)

    changesToApply.unshift(bootstrapChange)
    instance.bootstrapped = true
  }

  // console.log("about to apply the final constructed change");
  const [newInstance, patch] = applyChangesToInstance(instance, changesToApply)

  return [newInstance, patch, lensState]
}

function bootstrap(instance: Instance, lensState: LensState): Change {
  const urOp = [{ op: 'add' as const, path: '', value: {} }]
  const jsonschema7: JSONSchema7 = lensGraphSchema(lensState.graph, instance.schema)
  if (jsonschema7 === undefined) {
    throw new Error(`Could not find JSON schema for schema ${instance.schema}`)
  }
  const defaultsPatch = applyLensToPatch([], urOp, jsonschema7).slice(1)

  const bootstrapChange: Change = {
    actor: CAMBRIA_MAGIC_ACTOR,
    message: '',
    deps: {},
    seq: 1,
    ops: [],
  }

  bootstrapChange.ops = patchToOps(defaultsPatch, bootstrapChange, 1, instance)

  return bootstrapChange
}

function patchToOps(
  patch: CloudinaPatch,
  origin: Change,
  opIndex: number,
  instance: Instance
): Op[] {
  const pathCache = { '': ROOT_ID }
  // todo: see if we can refactor to have TS tell us what's missing here
  const ops = patch
    .map((patchop, i) => {
      const acc: Op[] = []
      const makeObj = v5(`${origin.actor}:${origin.seq}:${opIndex}:${i}"`, MAGIC_UUID)
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
          action = 'link'
          acc.push({ action: 'makeList', obj: makeObj })
          pathCache[patchop.path] = makeObj
        } else if (typeof patchop.value === 'object' && Object.keys(patchop.value).length === 0) {
          action = 'link'
          acc.push({ action: 'makeMap', obj: makeObj })
          pathCache[patchop.path] = makeObj
        } else {
          throw new RangeError(`bad value for patchop=${deepInspect(patchop)}`)
        }
      } else {
        throw new RangeError(`bad op type for patchop=${deepInspect(patchop)}`)
      }

      // todo: in the below code, we need to resolve array indexes to element ids
      // (maybe some of it can happen in getObjId? consider array indexes
      // at intermediate points in the path)
      const pathParts = patchop.path.split('/')
      let key = pathParts.pop()
      const objPath = pathParts.join('/')

      const objId = getObjId(instance.state, objPath) || pathCache[objPath]

      if (getObjType(instance.state, objId) === 'list') {
        if (key === undefined || Number.isNaN(parseInt(key, 10))) {
          throw new Error(`Expected array index on path ${patchop.path}`)
        }
        const originalOp = origin.ops[opIndex]
        const opKey = originalOp.key

        if (patchop.op === 'add') {
          const insertAfter = findElemOfIndex(instance.state, objId, parseInt(key, 10) - 1)
          if (opKey === undefined) throw new Error(`expected key on op: ${originalOp}`)
          const insertElemId = parseInt(opKey.split(':')[1], 10)
          acc.push({
            action: 'ins',
            obj: objId,
            key: insertAfter,
            elem: insertElemId,
          })
        }
        key = opKey
      }

      if (objId === undefined) throw new Error(`Could not find object with path ${objPath}`)

      if (action === 'link') {
        const op = { action, obj: objId, key, value: makeObj }
        acc.push(op)
      } else if (patchop.op === 'add' || patchop.op === 'replace') {
        const op = { action, obj: objId, key, value: patchop.value }
        acc.push(op)
      } else {
        const op = { action, obj: objId, key }
        acc.push(op)
      }
      return acc
    })
    .flat()

  return ops
}

export function buildPath(op: Op, instance: Instance, elemCache: ElemCache): string {
  const { obj } = op
  const path: string[] = getPath(instance.state, obj) || []
  let { key } = op
  let arrayIndex
  if (getObjType(instance.state, obj) === 'list') {
    if (key === undefined) throw new Error('expected key on op')
    // if the key is in the elem cache (ie, inserted earlier in this change), look there.
    // otherwise we can just find the key in the
    if (Object.keys(elemCache).includes(key)) {
      const prevKey = elemCache[key].key
      if (prevKey === undefined) throw new Error('expected key on insert op')
      delete elemCache[key]
      key = prevKey
      arrayIndex = findIndexOfElem(instance.state, obj, key) + 1
    } else {
      arrayIndex = findIndexOfElem(instance.state, obj, key)
    }
    key = String(arrayIndex)
  }
  const finalPath = `/${[...path, key].join('/')}`
  return finalPath
}

// given an automerge instance, an array obj id, and an elem ID, return the array index
function findIndexOfElem(state: any, objId: ObjectId, insertKey: string): number {
  if (insertKey === '_head') return -1

  // find the index of the element ID in the array
  // note: this code not exercised yet, but hopefully roughly right
  return state.getIn(['opSet', 'byObject', objId, '_elemIds']).indexOf(insertKey)
}

// given an automerge instance, an array obj id, and an index, return the elem ID
function findElemOfIndex(state: any, objId: ObjectId, index: number): string {
  if (index === -1) return '_head'

  const elemId = state.getIn(['opSet', 'byObject', objId, '_elemIds']).keyOf(index) // todo: is this the right way to look for an index in SkipList?
  if (elemId === undefined || elemId === null) {
    throw new Error(`Couldn't find array index ${index} in object ${objId}`)
  }
  return elemId
}

// Given a json path in a json doc, return the object ID at that path.
// If the path doesn't resolve to an existing object ID, returns null
// Todo: support lists
function getObjId(state: any, path: string): ObjectId | null {
  if (path === '') return ROOT_ID

  const pathSegments = path.split('/').slice(1)
  const opSet = state.get('opSet')

  let objectId = ROOT_ID

  for (const pathSegment of pathSegments) {
    const objectKeys = opSet.getIn(['byObject', objectId])

    // _keys contains an array for each key in case there are conflicts;
    // it's sorted so we can just take the first element
    const newObjectId = objectKeys.getIn(['_keys', pathSegment, 0, 'value'])

    // Sometimes, the path we're looking for isn't in the instance, give up
    if (newObjectId === undefined) {
      return null
    }

    objectId = newObjectId
  }

  return objectId
}

// given an automerge backend state and object ID, returns the type of the object
function getObjType(state: any, objId: ObjectId): ObjectType {
  const objType = state.getIn(['opSet', 'byObject', objId, '_init', 'action'])
  return objType === 'makeList' || objType === 'makeText' ? 'list' : 'object'
}

function getPath(state: any, obj: string): string[] | null {
  const opSet = state.get('opSet')
  const path: string[] = []
  while (obj !== ROOT_ID) {
    const ref = opSet.getIn(['byObject', obj, '_inbound'], Set()).first()
    if (!ref) return null
    obj = ref.get('obj')
    if (getObjType(state, obj) === 'list') {
      const index = opSet.getIn(['byObject', obj, '_elemIds']).indexOf(ref.get('key'))
      if (index < 0) return null
      path.unshift(index)
    } else {
      path.unshift(ref.get('key'))
    }
  }

  return path
}

export function opToPatch(op: Op, instance: Instance, elemCache: ElemCache): CloudinaPatch {
  switch (op.action) {
    case 'set': {
      // if the elemCache has the key, we're processing an insert
      const action = op.key && elemCache[op.key] ? 'add' : 'replace'
      const path = buildPath(op, instance, elemCache)
      const { value } = op

      return [{ op: action, path, value }]
    }
    case 'del': {
      const path = buildPath(op, instance, elemCache)
      return [{ op: 'remove', path }]
    }
    default:
      // note: inserts in Automerge 0 don't produce a patch, so we don't have a case for them here.
      // (we swallow them earlier in the process)
      throw new RangeError(`unsupported op ${deepInspect(op)}`)
  }
}

function applyChangesToInstance(instance: Instance, changes: Change[]): [Instance, AutomergePatch] {
  // console.log(`applying changes to ${instance.schema}`, deepInspect(changes));
  const [backendState, patch] = Backend.applyChanges(instance.state, changes)

  return [
    {
      clock: patch.clock || {},
      schema: instance.schema,
      bootstrapped: instance.bootstrapped,
      deps: patch.deps || {},
      state: backendState,
    },
    patch,
  ]
}

function applyOps(instance: Instance, ops: Op[], actor: string = CAMBRIA_MAGIC_ACTOR): Instance {
  // construct a change out of the ops
  const change = {
    ops,
    message: '',
    actor,
    seq: (instance.clock[actor] || 0) + 1,
    deps: instance.deps,
  }

  const [newInstance] = applyChangesToInstance(instance, [change])
  return newInstance
}
