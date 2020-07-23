// ======================================
// This file shows how Cloudina can be used to implement Chitin
// ======================================

import assert from 'assert'
import { inspect } from 'util'
import { addProperty, renameProperty, LensSource } from 'cloudina'
import { Micromerge, ROOT_ID } from '../src/micromerge'
import { Cambriamerge, opToPatch, applyPatch } from '../src/cambriamerge'

export interface ProjectV1 {
  title: string
  summary: boolean
}

export interface ProjectV2 {
  name: string
  description: string
  complete: boolean
}

export interface ProjectV3 {
  name: string
  description: string
  status: string
}

export interface ProjectV4 {
  title: string
  description: string
  status: string
  age: number
}

function deepInspect(object: any) {
  return inspect(object, false, null, true)
}

describe('Has basic automerge functionality', () => {
  it('can pass martins baseline tests', () => {
    const change1 = {
      actor: '1234',
      seq: 1,
      deps: {},
      startOp: 1,
      ops: [
        { action: 'set', obj: ROOT_ID, key: 'title', insert: false, value: 'Hello' },
        { action: 'makeList', obj: ROOT_ID, key: 'tags', insert: false },
        { action: 'set', obj: '2@1234', key: '_head', insert: true, value: 'foo' },
      ],
    }

    const change2 = {
      actor: '1234',
      seq: 2,
      deps: {},
      startOp: 4,
      ops: [
        { action: 'set', obj: ROOT_ID, key: 'title', insert: false, value: 'Hello 1' },
        { action: 'set', obj: '2@1234', key: '3@1234', insert: true, value: 'bar' },
        { action: 'del', obj: '2@1234', key: '3@1234', insert: false },
      ],
    }

    const change3 = {
      actor: 'abcd',
      seq: 1,
      deps: { '1234': 1 },
      startOp: 4,
      ops: [
        { action: 'set', obj: ROOT_ID, key: 'title', insert: false, value: 'Hello 2' },
        { action: 'set', obj: '2@1234', key: '3@1234', insert: true, value: 'baz' },
      ],
    }

    const doc1 = new Micromerge()
    const doc2 = new Micromerge()
    for (const c of [change1, change2, change3]) doc1.applyChange(c)
    for (const c of [change1, change3, change2]) doc2.applyChange(c)
    assert.deepStrictEqual(doc1.root, { title: 'Hello 2', tags: ['baz', 'bar'] })
    assert.deepStrictEqual(doc2.root, { title: 'Hello 2', tags: ['baz', 'bar'] })

    const change4 = {
      actor: '2345',
      seq: 1,
      deps: {},
      startOp: 1,
      ops: [
        { action: 'makeList', obj: ROOT_ID, key: 'todos', insert: false },
        { action: 'set', obj: '1@2345', key: '_head', insert: true, value: 'Task 1' },
        { action: 'set', obj: '1@2345', key: '2@2345', insert: true, value: 'Task 2' },

      ],
    }

    const doc3 = new Micromerge()
    doc3.applyChange(change4)
    assert.deepStrictEqual(doc3.root, { todos: ['Task 1', 'Task 2'] })

    const change5 = {
      actor: '2345',
      seq: 2,
      deps: {},
      startOp: 4,
      ops: [
        { action: 'del', obj: '1@2345', key: '2@2345', insert: false },
        { action: 'set', obj: '1@2345', key: '3@2345', insert: true, value: 'Task 3' },
      ],
    }
    doc3.applyChange(change5)
    assert.deepStrictEqual(doc3.root, { todos: ['Task 2', 'Task 3'] })

    const change6 = {
      actor: '2345',
      seq: 3,
      deps: {},
      startOp: 6,
      ops: [
        { action: 'del', obj: '1@2345', key: '3@2345', insert: false },
        { action: 'set', obj: '1@2345', key: '5@2345', insert: false, value: 'Task 3b' },
        { action: 'set', obj: '1@2345', key: '5@2345', insert: true, value: 'Task 4' },
      ],
    }
    doc3.applyChange(change6)
    assert.deepStrictEqual(doc3.root, { todos: ['Task 3b', 'Task 4'] })
  })

  it.skip('can call applyLocalChange', () => {
    const request1 = {
      ops: [
        { action: 'set', path: ['title'], value: 'Hello' },
        { action: 'makeList', path: ['tags'], insert: false },
        { action: 'set', path: ['tags', 0], insert: true, value: 'foo' },
      ],
    }

    const request2 = {
      ops: [
        { action: 'set', path: ['title'], value: 'Hello 1' },
        { action: 'set', path: ['tags', 1], insert: true, value: 'bar' },
        { action: 'del', path: ['tags', 1] },
      ],
    }

    const change1 = {
      actor: '1234',
      seq: 1,
      deps: {},
      startOp: 1,
      ops: [
        { action: 'set', obj: ROOT_ID, key: 'title', insert: false, value: 'Hello' },
        { action: 'makeList', obj: ROOT_ID, key: 'tags', insert: false },
        { action: 'set', obj: '2@1234', key: '_head', insert: true, value: 'foo' },
      ],
    }

    const change2 = {
      actor: '1234',
      seq: 2,
      deps: {},
      startOp: 4,
      ops: [
        { action: 'set', obj: ROOT_ID, key: 'title', insert: false, value: 'Hello 1' },
        { action: 'set', obj: '2@1234', key: '3@1234', insert: true, value: 'bar' },
        { action: 'del', obj: '2@1234', key: '3@1234', insert: false },
      ],
    }

    const change3 = {
      actor: 'abcd',
      seq: 1,
      deps: { '1234': 1 },
      startOp: 4,
      ops: [
        { action: 'set', obj: ROOT_ID, key: 'title', insert: false, value: 'Hello 2' },
        { action: 'set', obj: '2@1234', key: '3@1234', insert: true, value: 'baz' },
      ],
    }

    const doc = new Cambriamerge('1234')

    doc.applyLocalChange('mu', request1)
    doc.applyLocalChange('mu', request2)
    doc.applyChange(change3)

    assert.deepStrictEqual(doc.history[0], change1)
    assert.deepStrictEqual(doc.history[1], change2)
    assert.deepStrictEqual(doc.history[2], change3)
  })
})

describe('Has basic migrations and type system', () => {
  it('can change ops into json patch', () => {
    const doc = new Micromerge()
    const opId = "1@1234"
    const change = {
      actor: '1234',
      seq: 1,
      deps: {},
      startOp: 1,
      ops: [
        { action: 'set', obj: ROOT_ID, key: 'title', insert: false, value: 'Hello' },
        { action: 'makeList', obj: ROOT_ID, key: 'tags', insert: false },
        { action: 'set', obj: '2@1234', key: '_head', insert: true, value: 'foo' },
        { action: 'set', obj: '2@1234', key: '_head', insert: true, value: 'bar' },
        { action: 'del', obj: '2@1234', key: '3@1234', insert: false },
        { action: 'makeMap', obj: ROOT_ID, key: 'config', insert: false },
        { action: 'set', obj: '6@1234', key: 'key1', insert: false, value: 'val1' },
        { action: 'set', obj: '6@1234', key: 'key2', insert: false, value: 'val2' },
      ],
    }
    doc.applyChange(change)
    assert.deepStrictEqual(doc.root, { title: "Hello", tags: ["bar"], config: { key1: "val1", key2: "val2" }})

    // nested maps
    const op1 = { opId, action: 'set', obj: '6@1234', key: 'key3', insert: false, value: 'val3' }
    const patch1 = opToPatch(op1,doc)
    const ops1 = applyPatch(doc, patch1, opId)
    assert.deepStrictEqual(patch1, [{ "op": "add", "path": "/config/key3", "value": "val3" }])
    assert.deepStrictEqual(ops1, [op1])

    const op2 = { opId, action: 'set', obj: '6@1234', key: 'key2', insert: false, value: 'val2a' }
    const patch2 = opToPatch(op2,doc)
    const ops2 = applyPatch(doc, patch2, opId)
    assert.deepStrictEqual(patch2, [{ "op": "replace", "path": "/config/key2", "value": "val2a" }])
    assert.deepStrictEqual(ops2, [op2])

    const op3 = { opId, action: 'del', obj: '6@1234', key: 'key2', insert: false }
    const patch3 = opToPatch(op3,doc)
    const ops3 = applyPatch(doc, patch3, opId)
    assert.deepStrictEqual(patch3, [{ "op": "remove", "path": "/config/key2" }])
    assert.deepStrictEqual(ops3, [op3])

    // lists 

    const op5 = { opId, action: 'set', obj: '2@1234', key: '4@1234', insert: false, value: "new1" }
    const patch5 = opToPatch(op5, doc)
    const ops5 = applyPatch(doc, patch5, opId)
    assert.deepStrictEqual(patch5, [{ "op": "replace", "path": "/tags/0", value: "new1" }])
    assert.deepStrictEqual(ops5, [{action: "set", insert: false, key: "4@1234", obj: "2@1234", value: "new1", opId } ])

    const op4 = { opId, action: 'del', obj: '2@1234', key: '4@1234', insert: false }
    const patch4 = opToPatch(op4,doc)
    const ops4 = applyPatch(doc, patch4, opId)
    assert.deepStrictEqual(patch4, [{ "op": "remove", "path": "/tags/0" }])

    const op6 = { opId, action: 'set', obj: '2@1234', key: '4@1234', insert: true, value: "new2" }
    const patch6 = opToPatch(op6, doc)
    const ops6 = applyPatch(doc, patch6, opId)
    assert.deepStrictEqual(patch6, [{ "op": "add", "path": "/tags/0", value: "new2" }])
    assert.deepStrictEqual(ops6, [{action: "set", insert: true, key: "_head", obj: "2@1234", value: "new2", opId } ])
  })

  it('can apply simple migration', () => {
    const doc = new Cambriamerge('1234')

    const v1lens: LensSource = [
      addProperty({ name: 'title', type: 'string' }),
      addProperty({ name: 'summary', type: 'string' }),
    ]

    const v2lens: LensSource = [
      renameProperty('summary', 'description'),
      addProperty({ name: 'complete', type: 'boolean' }),
    ]

    const request1 = {
      ops: [
        { action: 'set', path: ['title'], value: 'Hello' },
        { action: 'set', path: ['summary'], value: 'Goodbye' },
      ],
    }

    const request2 = { ops: [{ action: 'set', path: ['complete'], value: true }] }

    doc.registerLens('mu', 'v1', v1lens)
    assert.deepStrictEqual(doc.as('v1'), { title: '', summary: '' })
    doc.applyLocalChange('v1', request1)
    assert.deepStrictEqual(doc.as('v1'), { title: 'Hello', summary: 'Goodbye' })

    doc.registerLens('v1', 'v2', v2lens)
    assert.deepStrictEqual(doc.as('v2'), {
      title: 'Hello',
      description: 'Goodbye',
      complete: false,
    })

    doc.applyLocalChange('v2', request2)

    assert.deepStrictEqual(doc.as('v2'), { title: 'Hello', description: 'Goodbye', complete: true })

    assert.deepStrictEqual(doc.schemas, ['mu', 'v1', 'v2'])

    assert.deepStrictEqual(doc.as('v1'), { title: 'Hello', summary: 'Goodbye' })
  })

  it('can create phantom ops with sub points', () => {
    const doc = new Micromerge()
    const patch = [
      { op: 'replace' as const, path: '/title', value: "title" },
      { op: 'replace' as const, path: '/summary', value: "summary" },
      { op: 'replace' as const, path: '/desc', value: "desc" }
    ]
    const ops = applyPatch(doc, patch, "10@1234")
    assert.deepStrictEqual(ops, [
      { action: 'set', obj: ROOT_ID, key: "title", value: "title" , insert: false, opId: "10@1234" },
      { action: 'set', obj: ROOT_ID, key: "summary", value: "summary" , insert: false, opId: "10.1@1234" },
      { action: 'set', obj: ROOT_ID, key: "desc", value: "desc" , insert: false, opId: "10.2@1234" }
    ])
  })

  it('can bootstrap with recursive defaults', () => {
    const doc = new Cambriamerge('1234')

    const v1Lens: LensSource = [
        {
            "op": "add",
            "name": "tags",
            "type": "array",
            "arrayItemType": "object",
            "default": []
        },
        {
            "op": "in",
            "name": "tags",
            "lens": [
                {
                    "op": "map",
                    "lens": [
                        {
                            "op": "add",
                            "name": "name",
                            "type": "string",
                            "default": ""
                        },
                        {
                            "op": "add",
                            "name": "color",
                            "type": "string",
                            "default": "#ffffff"
                        }
                    ]
                }
            ]
        },
        {
            "op": "add",
            "name": "metadata",
            "type": "object",
            "default": {}
        },
        {
            "op": "in",
            "name": "metadata",
            "lens": [
                {
                    "op": "add",
                    "name": "title",
                    "type": "string",
                    "default": ""
                },
                {
                    "op": "add",
                    "name": "flags",
                    "type": "object",
                    "default": {}
                },
                {
                    "op": "in",
                    "name": "flags",
                    "lens": [
                        {
                            "op": "add",
                            "name": "O_CREATE",
                            "type": "boolean",
                            "default": true
                        }
                    ]
                }
            ]
        }
    ]

    doc.registerLens("mu","v1",v1Lens)

    assert.deepStrictEqual(doc.as("v1"), {
      tags:[],
      metadata: {
        title: '',
        flags: {
          O_CREATE: true
        }
      }
    })
  })
})
