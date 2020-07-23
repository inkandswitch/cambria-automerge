import { inspect } from 'util'

export const ROOT_ID = '00000000-0000-0000-0000-000000000000'

function deepInspect(object: any) {
  return inspect(object, false, null, true)
}

export interface Op {
  opId?: string
  schema?: string
  action: string
  obj: string
  key: string
  insert: boolean
  value?: string | number | boolean
}

export interface Change {
  actor: string
  schema?: string
  seq: number
  deps: Clock
  startOp: number
  ops: Op[]
}

export interface Clock {
  [actorId: string]: number
}

interface Metadata {
  [objectId: string]: ObjMetadata | ListMetadata[]
}

interface ObjMetadata {
  [key: string]: string
}

interface ListMetadata {
  elemId: string
  valueId: string
  deleted: boolean
}

export class Micromerge {
  byActor: { [actorId: string]: Change[] } // Do I need this?
  byObjId: { [objectId: string]: any }
  metadata: Metadata
  ops: { [opId: string]: Op }

  constructor() {
    this.byActor = {}
    this.byObjId = { [ROOT_ID]: {} }
    this.metadata = { [ROOT_ID]: {} }
    this.ops = {}
  }

  get length(): number {
    return Object.values(this.byActor).reduce((i, changes) => i + changes.length, 0)
  }

  processPath(path: (string | number)[], insert: boolean): { obj: string; key: string } {
    if (path.length === 0) {
      return { obj: '', key: '' }
    }
    let obj = ROOT_ID
    while (true) {
      let key = path.shift() as string
      if (Array.isArray(this.byObjId[obj])) {
        const keyindex = parseInt(key)
        if (keyindex === 0 && path.length === 0 && insert) {
          return { obj, key: '_head' }
        }
        let elemId
        const meta = this.metadata[obj] as ListMetadata[]
        for (let i = 0, visible = 0; i < meta.length; i++) {
          if (!meta[i].deleted) {
            if (visible === keyindex) {
              elemId = meta[i].elemId
              break
            }
            visible++
          }
        }
        if (elemId === undefined) {
          throw new RangeError(`Array index ${keyindex} out of range for obj ${obj}`)
        }
        key = elemId
      }
      if (path.length === 0) {
        return { obj, key }
      }
      obj = this.metadata[obj][key]
    }
  }

  get root(): any {
    return this.byObjId[ROOT_ID]
  }

  applyChange(change: Change) {
    // Check that the change's dependencies are met
    const lastSeq = this.byActor[change.actor] ? this.byActor[change.actor].length : 0
    if (change.seq !== lastSeq + 1) {
      throw new RangeError(`Expected sequence number ${lastSeq + 1}, got ${change.seq}`)
    }
    for (const [actor, dep] of Object.entries(change.deps || {})) {
      if (!this.byActor[actor] || this.byActor[actor].length < dep) {
        throw new RangeError(`Missing dependency: change ${dep} by actor ${actor}`)
      }
    }

    this.recordChange(change)

    change.ops.forEach((op, index) => {
      this.applyOp(Object.assign({ opId: `${change.startOp + index}@${change.actor}` }, op))
    })
  }

  recordChange(change) {
    if (!this.byActor[change.actor]) this.byActor[change.actor] = []
    this.byActor[change.actor].push(change)
  }

  applyOp(op) {
    if (!this.metadata[op.obj]) throw new RangeError(`Object does not exist: ${op.obj}`)
    this.ops[op.opId] = op
    if (op.action === 'makeMap') {
      this.byObjId[op.opId] = {}
      this.metadata[op.opId] = {}
    } else if (op.action === 'makeList') {
      this.byObjId[op.opId] = []
      this.metadata[op.opId] = []
    } else if (op.action !== 'set' && op.action !== 'del') {
      throw new RangeError(`Unsupported operation type: ${op.action}`)
    }

    if (Array.isArray(this.metadata[op.obj])) {
      if (op.insert) this.applyListInsert(op)
      else this.applyListUpdate(op)
    } else if (
      !this.metadata[op.obj][op.key] ||
      this.compareOpIds(this.metadata[op.obj][op.key], op.opId)
    ) {
      this.metadata[op.obj][op.key] = op.opId
      if (op.action === 'del') {
        delete this.byObjId[op.obj][op.key]
      } else if (op.action.startsWith('make')) {
        this.byObjId[op.obj][op.key] = this.byObjId[op.opId]
      } else {
        this.byObjId[op.obj][op.key] = op.value
      }
    } else {
    }
  }

  applyListInsert(op) {
    const meta = this.metadata[op.obj] as ListMetadata[] // the caller tests this
    const value = op.action.startsWith('make') ? this.byObjId[op.opId] : op.value
    let { index, visible } =
      op.key === '_head' ? { index: -1, visible: 0 } : this.findListElement(op.obj, op.key)
    if (index >= 0 && !meta[index].deleted) visible++
    index++
    while (index < meta.length && this.compareOpIds(op.opId, meta[index].elemId)) {
      if (!meta[index].deleted) visible++
      index++
    }
    meta.splice(index, 0, { elemId: op.opId, valueId: op.opId, deleted: false })
    this.byObjId[op.obj].splice(visible, 0, value)
  }

  applyListUpdate(op) {
    const { index, visible } = this.findListElement(op.obj, op.key)
    const meta = this.metadata[op.obj][index]
    if (op.action === 'del') {
      if (!meta.deleted) this.byObjId[op.obj].splice(visible, 1)
      meta.deleted = true
    } else if (this.compareOpIds(meta.valueId, op.opId)) {
      if (!meta.deleted) {
        this.byObjId[op.obj][visible] = op.action.startsWith('make')
          ? this.byObjId[op.opId]
          : op.value
      }
      meta.valueId = op.opId
    }
  }

  findListElement(objectId, elemId) {
    let index = 0
    let visible = 0
    const meta = this.metadata[objectId]
    while (index < meta.length && meta[index].elemId !== elemId) {
      if (!meta[index].deleted) visible++
      index++
    }
    if (index === meta.length) throw new RangeError(`List element not found: ${objectId}:${elemId}`)
    return { index, visible }
  }

  compareOpIds(id1, id2) {
    const regex = /^([0-9.]+)@(.*)$/
    const match1 = regex.exec(id1)
    const match2 = regex.exec(id2)
    if (match1 == null || match2 == null) {
      throw new RangeError(`Invalid OpId ${id1} vs ${id2}`)
    }
    const counter1 = parseFloat(match1[1])
    const counter2 = parseFloat(match2[1])
    return counter1 < counter2 || (counter1 === counter2 && match1[2] < match2[2])
  }
}

export function parseOpId(opid: string): { counter: number; actor: string } {
  const regex = /^([0-9.]+)@(.*)$/
  const match = regex.exec(opid)
  if (match == null) {
    throw new RangeError(`Invalid OpId ${opid}`)
  }
  const counter = parseFloat(match[1])
  const actor = match[2]
  return { counter, actor }
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
