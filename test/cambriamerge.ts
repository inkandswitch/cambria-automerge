import assert from "assert";
import { inspect } from "util";
import { addProperty, renameProperty, LensSource, reverseLens } from "cloudina";
import * as Backend from "../src/index";

const ACTOR_ID_1 = "111111";
const ACTOR_ID_2 = "222222";
const AUTOMERGE_ROOT_ID = "00000000-0000-0000-0000-000000000000";

const ProjectV1: LensSource = [
  addProperty({ name: "title", type: "string" }),
  addProperty({ name: "summary", type: "string" }),
];

const ProjectV2: LensSource = [renameProperty("title", "name")];

const V1Lens = {
  kind: "lens" as const,
  from: "mu",
  to: "projectv1",
  lens: ProjectV1,
};

const V2Lens = {
  kind: "lens" as const,
  from: "projectv1",
  to: "projectv2",
  lens: ProjectV2,
};

const AllLenses: Backend.RegisteredLens[] = [V1Lens, V2Lens];

const V1FirstWrite = {
  kind: "change" as const,
  schema: "projectv1",
  change: {
    message: "",
    actor: ACTOR_ID_1,
    seq: 1,
    deps: { "0000000000": 1 },
    ops: [
      {
        action: "set" as const,
        obj: AUTOMERGE_ROOT_ID,
        key: "title",
        value: "hello",
      },
    ],
  },
};

/*
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
*/

function deepInspect(object: any) {
  return inspect(object, false, null, true);
}

describe("Has basic schema tools", () => {
  it("can accept a single schema and fill out default values", () => {
    const ProjectV1: LensSource = [
      addProperty({ name: "title", type: "string" }),
      addProperty({ name: "summary", type: "string" }),
    ];

    const doc1 = Backend.init({ schema: "projectv1" });

    const [doc2, patch2] = Backend.applyChanges(doc1, [
      {
        kind: "lens",
        from: "mu",
        to: "projectv1",
        lens: ProjectV1,
      },
    ]);

    assert.deepEqual(patch2.diffs, [
      {
        action: 'set',
        key: 'title',
        obj: '00000000-0000-0000-0000-000000000000',
        path: [],
        type: 'map',
        value: ''
      },
      {
        action: 'set',
        key: 'summary',
        obj: '00000000-0000-0000-0000-000000000000',
        path: [],
        type: 'map',
        value: ''
      }
    ])
  });

  it("can accept a real change", () => {
    const doc1 = Backend.init({ schema: "projectv1" });

    const [doc2, patch2] = Backend.applyChanges(doc1, [V1Lens]);

    const [doc3, patch3] = Backend.applyChanges(doc2, [V1FirstWrite]);

    assert.deepEqual(patch3.diffs, [
      {
        action: 'set',
        key: 'title',
        obj: '00000000-0000-0000-0000-000000000000',
        path: [],
        type: 'map',
        value: 'hello'
      }
    ])
  });

  it("can accept a real change with its lens", () => {
    const doc1 = Backend.init({ schema: "projectv1" });

    const [doc2, patch2] = Backend.applyChanges(doc1, [V1Lens, V1FirstWrite]);

    assert.deepEqual(patch2.diffs, [
      {
        action: 'set',
        key: 'title',
        obj: '00000000-0000-0000-0000-000000000000',
        path: [],
        type: 'map',
        value: ''
      },
      {
        action: 'set',
        key: 'summary',
        obj: '00000000-0000-0000-0000-000000000000',
        path: [],
        type: 'map',
        value: ''
      },
      {
        action: 'set',
        key: 'title',
        obj: '00000000-0000-0000-0000-000000000000',
        path: [],
        type: 'map',
        value: 'hello'
      }
    ])
  });

  it("converts a patch from v1 to v2", () => {
    const doc1 = Backend.init({ schema: "projectv2", lenses: AllLenses });

    const [doc2, patch2] = Backend.applyChanges(doc1, [V1Lens, V1FirstWrite]);

    assert.deepEqual(patch2.diffs, [
      {
        "action": "set",
        "key": "name",
        "obj": "00000000-0000-0000-0000-000000000000",
        "path": [],
        "type": "map",
        "value": ""
      },
      {
        "action": "set",
        "key": "summary",
        "obj": "00000000-0000-0000-0000-000000000000",
        "path": [],
        "type": "map",
        "value": ""
      },
      {
        "action": "set",
        "key": "name",
        "obj": "00000000-0000-0000-0000-000000000000",
        "path": [],
        "type": "map",
        "value": "hello"
      }
    ]);
  });
});

describe("lensFromTo", () => {
  it("correctly computes a lens path", () => {
    const doc1 = Backend.init({ schema: "projectv2", lenses: AllLenses });
    assert.deepEqual(doc1.lensesFromTo("mu", "projectv2"), [
      ...V1Lens.lens,
      ...V2Lens.lens,
    ]);

    assert.deepEqual(
      doc1.lensesFromTo("projectv2", "mu"),
      reverseLens([...V1Lens.lens, ...V2Lens.lens])
    );

    assert.deepEqual(doc1.lensesFromTo("projectv1", "projectv2"), V2Lens.lens);
  });
});
