import assert from 'assert'
import { inspect } from 'util'
import { addProperty, renameProperty, LensSource } from 'cloudina'
import { Frontend } from 'automerge'
import { inside, plungeProperty, removeProperty, hoistProperty } from 'cloudina/dist/helpers'
import * as Cambria from '../src/index'

const ACTOR_ID_1 = '111111'
const ACTOR_ID_2 = '222222'

const InitialProjectLens: LensSource = [
  addProperty({ name: 'name', type: 'string' }),
  addProperty({ name: 'summary', type: 'string' }),
]

const FillOutProjectLens: LensSource = [
  addProperty({ name: 'created_at', type: 'string' }),
  addProperty({ name: 'details', type: 'object' }),
  inside('details', [
    addProperty({ name: 'author', type: 'string' }),
    addProperty({ name: 'date', type: 'string' }),
  ]),
]

const RenameLens: LensSource = [renameProperty('name', 'title')]
const PlungeIntoDetailsLens: LensSource = [plungeProperty('details', 'created_at')]
const RenameNestedLens: LensSource = [inside('details', [renameProperty('date', 'updated_at')])]

// use these to just get a stack of all the lenses we have
const AllLenses: LensSource[] = [
  InitialProjectLens,
  FillOutProjectLens,
  RenameLens,
  PlungeIntoDetailsLens,
  RenameNestedLens,
]

const AllLensChanges: Cambria.RegisteredLens[] = AllLenses.map((current, currentIndex) => ({
  kind: 'lens' as const,
  from: currentIndex === 0 ? 'mu' : `project-v${currentIndex}`,
  to: `project-v${currentIndex + 1}`,
  lens: current,
}))
const LAST_SCHEMA = AllLensChanges[AllLensChanges.length - 1].to

// Use these when you need less
const InitialLensChange = {
  kind: 'lens' as const,
  from: 'mu',
  to: 'project-v1',
  lens: InitialProjectLens,
}

const FillOutProjectLensChange = {
  kind: 'lens' as const,
  from: 'project-v1',
  to: 'project-filled-out',
  lens: FillOutProjectLens,
}

const RenameLensChange = {
  kind: 'lens' as const,
  from: 'project-v1',
  to: 'project-rename',
  lens: RenameLens,
}

// eslint-disable-next-line
function deepInspect(object: any) {
  return inspect(object, false, null, true)
}

const [v1Cambria, v1InitialPatch] = Cambria.applyChanges(Cambria.init({ schema: 'project-v1' }), [
  InitialLensChange,
])
const v1Frontend = Frontend.applyPatch(Frontend.init(ACTOR_ID_1), v1InitialPatch)

describe('Has basic schema tools', () => {
  it('can accept a single schema and fill out default values', () => {
    assert.deepEqual(v1InitialPatch.diffs, [
      {
        action: 'set',
        key: 'name',
        obj: '00000000-0000-0000-0000-000000000000',
        path: [],
        type: 'map',
        value: '',
      },
      {
        action: 'set',
        key: 'summary',
        obj: '00000000-0000-0000-0000-000000000000',
        path: [],
        type: 'map',
        value: '',
      },
    ])
  })

  it('can accept a real change', () => {
    const [, change] = Frontend.change(v1Frontend, (doc: any) => {
      doc.title = 'hello'
    })
    const cambriaChange = {
      kind: 'change' as const,
      schema: 'project-v1',
      change,
    }
    const [, patch] = Cambria.applyChanges(v1Cambria, [cambriaChange])

    assert.deepEqual(patch.diffs, [
      {
        action: 'set',
        key: 'title',
        obj: '00000000-0000-0000-0000-000000000000',
        path: [],
        type: 'map',
        value: 'hello',
      },
    ])
  })

  // XXX: i'm testing... something here. it's not really clear to me why, though.
  it('can accept a real change with its lens', () => {
    const doc1 = Cambria.init({
      schema: 'project-rename',
      lenses: [InitialLensChange],
    })

    // this is cheating... i know the property will be called title post-lens application
    const v2Frontend = v1Frontend
    const [, change] = Frontend.change(v2Frontend, (doc: any) => {
      doc.title = 'hello'
    })
    const cambriaChange = {
      kind: 'change' as const,
      schema: 'project-rename',
      change,
    }
    const [, patch2] = Cambria.applyChanges(doc1, [RenameLensChange, cambriaChange])

    assert.deepEqual(patch2.diffs, [
      {
        action: 'set',
        key: 'title',
        obj: '00000000-0000-0000-0000-000000000000',
        path: [],
        type: 'map',
        value: '',
      },
      {
        action: 'set',
        key: 'summary',
        obj: '00000000-0000-0000-0000-000000000000',
        path: [],
        type: 'map',
        value: '',
      },
      {
        action: 'set',
        key: 'title',
        obj: '00000000-0000-0000-0000-000000000000',
        path: [],
        type: 'map',
        value: 'hello',
      },
    ])
  })

  it('converts a doc from v1 to v2', () => {
    const [, change] = Frontend.change(v1Frontend, (doc: any) => {
      doc.name = 'hello'
    })
    const cambriaChange = {
      kind: 'change' as const,
      schema: 'project-v1',
      change,
    }

    const [cambria, initialPatch] = Cambria.applyChanges(
      Cambria.init({ schema: LAST_SCHEMA }),
      AllLensChanges
    )
    const frontend = Frontend.applyPatch(Frontend.init(ACTOR_ID_1), initialPatch)

    const [, convertedV1Patch] = Cambria.applyChanges(cambria, [RenameLensChange, cambriaChange])

    const finalFrontend = Frontend.applyPatch(frontend, convertedV1Patch)
    assert.deepEqual(finalFrontend, {
      title: 'hello',
      summary: '',
      details: {
        author: '',
        created_at: '',
        updated_at: '',
      },
    })
  })

  it.skip('can handle writes from v1 and v2', () => {
    const state1 = Cambria.init({ schema: 'project-v1' })

    const [, nameChange] = Frontend.change(v1Frontend, (doc: any) => {
      doc.name = 'hello'
    })
    const [, filloutChange] = Frontend.change(v1Frontend, (doc: any) => {
      doc.details = {}
      doc.details.author = 'Peter'
    })

    const [, patch2] = Cambria.applyChanges(state1, [
      InitialLensChange,
      { kind: 'change', schema: InitialLensChange.to, change: nameChange },
      FillOutProjectLensChange,
      {
        kind: 'change',
        schema: FillOutProjectLensChange.to,
        change: filloutChange,
      },
    ])

    let doc = Frontend.init()
    doc = Frontend.applyPatch(doc, patch2)

    assert.deepEqual(doc, {
      name: 'actor 2 says hi',
      summary: '',
    })
  })

  it('can handle writes from v1 and v2 when lenses are in memory, not in doc', () => {
    const state1 = Cambria.init({
      schema: 'project-v5',
      lenses: AllLensChanges,
    })

    const [frontEnd, nameChange] = Frontend.change(v1Frontend, (doc: any) => {
      doc.name = 'hello'
    })
    const [, filloutChange] = Frontend.change(frontEnd, (doc: any) => {
      doc.details = {}
      doc.details.author = 'Peter'
    })

    const [, patch2] = Cambria.applyChanges(state1, [
      { kind: 'change', schema: InitialLensChange.to, change: nameChange },
      {
        kind: 'change',
        schema: AllLensChanges.slice(-1)[0].to,
        change: filloutChange,
      },
    ])

    let doc = Frontend.init()
    doc = Frontend.applyPatch(doc, patch2)

    assert.deepEqual(doc, {
      title: 'hello',
      summary: '',
      details: { author: 'Peter' },
    })
  })

  it.skip('can convert data when necessary lens comes after the write', () => {
    const state1 = Cambria.init({ schema: 'project-filled-out' })

    const [, nameChange] = Frontend.change(v1Frontend, (doc: any) => {
      doc.name = 'hello'
    })
    const [, filloutChange] = Frontend.change(v1Frontend, (doc: any) => {
      doc.details = {}
      doc.details.author = 'Peter'
    })

    const [, patch2] = Cambria.applyChanges(state1, [
      InitialLensChange,
      { kind: 'change', schema: InitialLensChange.to, change: nameChange },
      FillOutProjectLensChange,
      {
        kind: 'change',
        schema: FillOutProjectLensChange.to,
        change: filloutChange,
      },
    ])

    let doc = Frontend.init()
    doc = Frontend.applyPatch(doc, patch2)

    assert.deepEqual(doc, {
      name: 'actor 2 says hi',
      summary: '',
    })
  })

  describe('removeProperty lens', () => {
    const RemoveLens: LensSource = [removeProperty({ name: 'name', type: 'string' })]
    const RemoveLensChange = {
      kind: 'lens' as const,
      from: 'project-v1',
      to: 'project-remove',
      lens: RemoveLens,
    }
    it('can convert with a removeProperty lens', () => {
      const removeCambria = Cambria.init({
        schema: RemoveLensChange.to,
        lenses: [InitialLensChange, RemoveLensChange],
      })

      // V1 writes to the title property, which should become a no-op
      const [, nameChange] = Frontend.change(v1Frontend, (doc: any) => {
        doc.name = 'hello'
      })
      const [, noOpPatch] = Cambria.applyChanges(removeCambria, [
        { kind: 'change', schema: InitialLensChange.to, change: nameChange },
      ])

      let doc = Frontend.init()
      doc = Frontend.applyPatch(doc, noOpPatch)

      assert.deepEqual(doc, {
        summary: '',
      })
    })
  })

  describe('nested objects', () => {
    it('can accept a single schema and fill out default values', () => {
      const [, initialPatch] = Cambria.applyChanges(
        Cambria.init({ schema: LAST_SCHEMA }),
        AllLensChanges
      )
      const doc = Frontend.applyPatch(Frontend.init(ACTOR_ID_1), initialPatch)

      assert.deepEqual(doc, {
        summary: '',
        title: '',
        details: {
          author: '',
          created_at: '',
          updated_at: '',
        },
      })
    })

    it.skip('can accept a real change', () => {
      const [cambria, initialPatch] = Cambria.applyChanges(
        Cambria.init({ schema: LAST_SCHEMA }),
        AllLensChanges
      )
      const frontend = Frontend.applyPatch(Frontend.init(ACTOR_ID_1), initialPatch)

      const [, filledOutInitialPatch] = Cambria.applyChanges(
        Cambria.init({ schema: 'project-v2' }),
        AllLensChanges
      )
      const filledOutFrontend = Frontend.applyPatch(
        Frontend.init(ACTOR_ID_1),
        filledOutInitialPatch
      )

      const [, change] = Frontend.change(filledOutFrontend, (doc: any) => {
        doc.details.author = 'Klaus'
      })

      // wrap that change in Cambria details
      const [, editPatch] = Cambria.applyChanges(cambria, [
        {
          kind: 'change' as const,
          schema: 'project-v2',
          change,
        },
      ])

      // confirm the resulting patch is correct!
      const patchedFrontend = Frontend.applyPatch(frontend, editPatch)

      assert.deepEqual(patchedFrontend, {
        details: {
          author: 'Klaus',
          created_at: '',
          updated_at: '',
        },
        summary: '',
        title: '',
      })
    })

    it('can apply a change from another V2', () => {
      // Create an old v2 format patch
      const [, v2InitialPatch] = Cambria.applyChanges(
        Cambria.init({ schema: 'project-v2' }),
        AllLensChanges
      )
      const v2Frontend = Frontend.applyPatch(Frontend.init(ACTOR_ID_1), v2InitialPatch)
      // Apply a V2 change to a full-fledged backend and read it successfully
      const [, change] = Frontend.change(v2Frontend, (doc: any) => {
        doc.details.author = 'R. van Winkel'
      })

      // make a new modern Cambria and apply the patch
      const [cambria, initialPatch] = Cambria.applyChanges(
        Cambria.init({ schema: LAST_SCHEMA }),
        AllLensChanges
      )
      const initialFrontend = Frontend.applyPatch(Frontend.init(ACTOR_ID_1), initialPatch)

      const [, patch] = Cambria.applyChanges(cambria, [
        {
          kind: 'change' as const,
          schema: 'project-v2',
          change,
        },
      ])

      const frontend = Frontend.applyPatch(initialFrontend, patch)

      assert.deepEqual(frontend, {
        title: '',
        summary: '',
        details: {
          author: 'R. van Winkel',
          created_at: '',
          updated_at: '',
        },
      })
    })

    it('can convert a rename inside an object', () => {
      const [cambria, initialPatch] = Cambria.applyChanges(
        Cambria.init({ schema: LAST_SCHEMA }),
        AllLensChanges
      )

      const [, v2InitialPatch] = Cambria.applyChanges(
        Cambria.init({ schema: 'project-v2' }),
        AllLensChanges
      )
      const v2Frontend = Frontend.applyPatch(Frontend.init(ACTOR_ID_2), v2InitialPatch)
      // Apply a V2 change to a full-fledged backend and read it successfully
      const [, change] = Frontend.change(v2Frontend, (doc: any) => {
        doc.details.date = 'long long ago'
      })

      const [, patch] = Cambria.applyChanges(cambria, [
        {
          kind: 'change' as const,
          schema: 'project-v2',
          change,
        },
      ])

      let doc = Frontend.applyPatch(Frontend.init(ACTOR_ID_1), initialPatch)
      doc = Frontend.applyPatch(doc, patch)

      assert.deepEqual(doc, {
        title: '',
        summary: '',
        details: {
          author: '',
          updated_at: 'long long ago',
          created_at: '',
        },
      })
    })

    it('can plunge a property', () => {
      const PlungeLensChange = {
        kind: 'lens' as const,
        from: 'project-filled-out',
        to: 'project-plunged',
        lens: PlungeIntoDetailsLens,
      }

      const LensChanges = [InitialLensChange, FillOutProjectLensChange, PlungeLensChange]

      const [cambria, initialPatch] = Cambria.applyChanges(
        Cambria.init({ schema: 'project-plunged' }),
        LensChanges
      )

      const [, v2InitialPatch] = Cambria.applyChanges(
        Cambria.init({ schema: 'project-filled-out' }),
        LensChanges
      )
      const v2Frontend = Frontend.applyPatch(Frontend.init(ACTOR_ID_1), v2InitialPatch)

      // Apply a V2 change to a full-fledged backend and read it successfully
      const [, change] = Frontend.change(v2Frontend, (doc: any) => {
        doc.created_at = 'recently'
      })

      const [, patch] = Cambria.applyChanges(cambria, [
        {
          kind: 'change' as const,
          schema: 'project-filled-out',
          change,
        },
      ])

      let doc = Frontend.applyPatch(Frontend.init(ACTOR_ID_1), initialPatch)
      doc = Frontend.applyPatch(doc, patch)

      assert.deepEqual(doc, {
        name: '',
        summary: '',
        details: {
          author: '',
          date: '',
          created_at: 'recently',
        },
      })
    })

    it('can hoist a property', () => {
      const HoistLens = [hoistProperty('details', 'author')]
      const HoistLensChange = {
        kind: 'lens' as const,
        from: 'project-filled-out',
        to: 'project-hoisted',
        lens: HoistLens,
      }

      const LensChanges = [InitialLensChange, FillOutProjectLensChange, HoistLensChange]

      const [cambria, initialPatch] = Cambria.applyChanges(
        Cambria.init({ schema: 'project-hoisted' }),
        LensChanges
      )

      const [, v2InitialPatch] = Cambria.applyChanges(
        Cambria.init({ schema: 'project-filled-out' }),
        LensChanges
      )
      const v2Frontend = Frontend.applyPatch(Frontend.init(ACTOR_ID_1), v2InitialPatch)

      // Apply a V2 change to a full-fledged backend and read it successfully
      const [, change] = Frontend.change(v2Frontend, (doc: any) => {
        doc.details.author = 'Steven King'
      })

      const [, patch] = Cambria.applyChanges(cambria, [
        {
          kind: 'change' as const,
          schema: 'project-filled-out',
          change,
        },
      ])

      let doc = Frontend.applyPatch(Frontend.init(ACTOR_ID_1), initialPatch)
      doc = Frontend.applyPatch(doc, patch)

      assert.deepEqual(doc, {
        name: '',
        summary: '',
        author: 'Steven King',
        created_at: '',
        details: {
          date: '',
        },
      })
    })

    it('can hoist a property from 2 levels deep', () => {
      const deepNestingLensChange = {
        kind: 'lens' as const,
        from: 'mu',
        to: 'nested-v1',
        lens: [
          addProperty({ name: 'branch1', type: 'object' }),
          inside('branch1', [
            addProperty({ name: 'branch2', type: 'object' }),
            inside('branch2', [
              addProperty({ name: 'leaf1', type: 'string' }),
              addProperty({ name: 'leaf2', type: 'string' }),
            ]),
          ]),
        ],
      }

      const hoistLensChange = {
        kind: 'lens' as const,
        from: 'nested-v1',
        to: 'nested-v2',
        lens: [inside('branch1', [hoistProperty('branch2', 'leaf1')])],
      }

      const doc1 = Cambria.init({
        schema: 'nested-v2',
        lenses: [deepNestingLensChange, hoistLensChange],
      })

      // fill in default values by applying an empty change
      // (todo: reconsider this workflow)
      const [, patch2] = Cambria.applyChanges(doc1, [])

      // get the generated obj ID for the branch2 map from the default values,
      // to use in the change below
      const branch2ObjId = patch2.diffs.find(
        (d) =>
          d.action === 'set' &&
          d.path?.length === 1 &&
          d.path[0] === 'branch1' &&
          d.key === 'branch2' &&
          d.link
      )

      if (!branch2ObjId) throw new Error('expected to find objID for branch2 map')

      const [, patch3] = Cambria.applyChanges(doc1, [
        {
          kind: 'change' as const,
          schema: 'nested-v1',
          change: {
            message: '',
            actor: ACTOR_ID_1,
            seq: 1,
            deps: { '0000000000': 1 },
            ops: [
              {
                action: 'set' as const,
                obj: branch2ObjId.obj, // todo: fill in object id of branch1
                key: 'leaf1',
                value: 'hello',
              },
            ],
          },
        },
      ])

      let doc = Frontend.init()
      doc = Frontend.applyPatch(doc, patch2)
      doc = Frontend.applyPatch(doc, patch3)

      assert.deepEqual(doc, {
        branch1: {
          leaf1: 'hello',
          branch2: {
            leaf2: '',
          },
        },
      })
    })

    // todo: test other ops inside changes, besides just set
    // use makeMap and link to create a new object in the change

    // todo: when we remove an obj property, make sure to swallow makemap + link ops
  })

  describe('arrays', () => {
    const ARRAY_V1_LENS_CHANGE = {
      kind: 'lens' as const,
      from: 'mu',
      to: 'array-v1',
      lens: [addProperty({ name: 'tags', type: 'array', arrayItemType: 'string' })],
    }

    const ARRAY_V2_LENS_CHANGE = {
      kind: 'lens' as const,
      from: 'array-v1',
      to: 'array-v2',
      lens: [addProperty({ name: 'other', type: 'string' })],
    }

    interface ArrayTestDoc {
      tags: string[]
    }

    it('can accept a single schema and fill out default values', () => {
      const doc1 = Cambria.init({
        schema: 'array-v1',
        lenses: [ARRAY_V1_LENS_CHANGE],
      })

      // fill in default values by applying an empty change
      // (todo: reconsider this workflow)
      const [, patch2] = Cambria.applyChanges(doc1, [])

      let doc = Frontend.init()
      doc = Frontend.applyPatch(doc, patch2)

      assert.deepEqual(doc, {
        tags: [],
      })
    })

    it('can write and read to an array via push (no lens conversion)', () => {
      const doc1 = Cambria.init({
        schema: 'array-v1',
        lenses: [ARRAY_V1_LENS_CHANGE],
      })

      // fill in default values by applying an empty change
      const [, initialPatch] = Cambria.applyChanges(doc1, [])

      // fill in default values by applying a patch full of defaults
      const changeMaker = Frontend.applyPatch(Frontend.init(), initialPatch)
      const [, change] = Frontend.change<unknown, ArrayTestDoc>(changeMaker, (doc) => {
        doc.tags.push('fun')
        doc.tags.push('relaxing')
        doc.tags.push('lovecraftian')
      })

      const [, arrayPatch] = Cambria.applyChanges(doc1, [
        { kind: 'change' as const, schema: 'array-v1', change },
      ])

      let doc = Frontend.applyPatch(Frontend.init(), initialPatch)
      doc = Frontend.applyPatch(doc, arrayPatch)

      assert.deepEqual(doc, {
        tags: ['fun', 'relaxing', 'lovecraftian'],
      })
    })

    it('can write and read to an array via assignment (no lens conversion)', () => {
      const doc1 = Cambria.init({
        schema: 'array-v1',
        lenses: [ARRAY_V1_LENS_CHANGE],
      })

      // fill in default values by applying an empty change
      const [, initialPatch] = Cambria.applyChanges(doc1, [])

      // fill in default values by applying a patch full of defaults
      const changeMaker = Frontend.applyPatch(Frontend.init(), initialPatch)
      const [, change] = Frontend.change<unknown, ArrayTestDoc>(changeMaker, (doc) => {
        doc.tags = ['maddening', 'infuriating', 'adorable']
      })

      const [, arrayPatch] = Cambria.applyChanges(doc1, [
        { kind: 'change' as const, schema: 'array-v1', change },
      ])

      let doc = Frontend.applyPatch(Frontend.init(), initialPatch)
      doc = Frontend.applyPatch(doc, arrayPatch)

      assert.deepEqual(doc, {
        tags: ['maddening', 'infuriating', 'adorable'],
      })
    })

    it('can write and read with an unrelated lens conversion', () => {
      const doc1 = Cambria.init({
        schema: 'array-v1',
        lenses: [ARRAY_V1_LENS_CHANGE, ARRAY_V2_LENS_CHANGE],
      })

      // fill in default values by applying an empty change
      const [, initialPatch] = Cambria.applyChanges(doc1, [])

      // fill in default values by applying a patch full of defaults
      const changeMaker = Frontend.applyPatch(Frontend.init(), initialPatch)
      const [, change] = Frontend.change<unknown, ArrayTestDoc>(changeMaker, (doc) => {
        doc.tags = ['maddening', 'infuriating', 'adorable']
        doc.tags[1] = 'excruciating'
      })

      const [, arrayPatch] = Cambria.applyChanges(doc1, [
        { kind: 'change' as const, schema: 'array-v1', change },
      ])

      let doc = Frontend.applyPatch(Frontend.init(), initialPatch)
      doc = Frontend.applyPatch(doc, arrayPatch)

      assert.deepEqual(doc, {
        tags: ['maddening', 'excruciating', 'adorable'],
      })
    })

    it('can handle array deletes', () => {
      // this lens has nothing to do with arrays but still pushes the patch thru cloudina
      const doc1 = Cambria.init({
        schema: 'array-v1',
        lenses: [ARRAY_V1_LENS_CHANGE, ARRAY_V2_LENS_CHANGE],
      })

      // fill in default values by applying an empty change
      const [, initialPatch] = Cambria.applyChanges(doc1, [])

      // fill in default values by applying a patch full of defaults
      const changeMaker = Frontend.applyPatch(Frontend.init(), initialPatch)
      const [docWithArrays, change] = Frontend.change<unknown, ArrayTestDoc>(changeMaker, (doc) => {
        doc.tags = ['maddening', 'infuriating', 'adorable']
      })
      const [, delChange] = Frontend.change<unknown, ArrayTestDoc>(docWithArrays, (doc) => {
        delete doc.tags[1]
      })

      const [, arrayPatch] = Cambria.applyChanges(doc1, [
        { kind: 'change' as const, schema: 'array-v1', change },
        { kind: 'change' as const, schema: 'array-v1', change: delChange },
      ])

      let doc = Frontend.applyPatch(Frontend.init(), initialPatch)
      doc = Frontend.applyPatch(doc, arrayPatch)

      assert.deepEqual(doc, {
        tags: ['maddening', 'adorable'],
      })
    })

    // todo: insert an object into an array (not implemented yet)
    // (we have unimplemented paths on sending in make ops)

    // notes from orion:
    // -getPath needs to do this too
  })

  // lists
  // - default values
  // - no lens
  // - simple lens
  // - obj in array: default values, renaming, etc
  // - head/wrap

  // - obj in array in obj...
})
