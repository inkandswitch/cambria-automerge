import assert from "assert";
import { inspect } from "util";
import { addProperty, renameProperty, LensSource } from "cloudina";
import * as Backend from "../src/index";

const ACTOR_ID_1 = "111111";
const ACTOR_ID_2 = "222222";
const AUTOMERGE_ROOT_ID = "00000000-0000-0000-0000-000000000000";

const ProjectV1: LensSource = [
  addProperty({ name: "title", type: "string" }),
  addProperty({ name: "summary", type: "string" }),
];

const ProjectV2: LensSource = [
  renameProperty("title", "name")
];

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

const AllLenses : Backend.RegisteredLens[] = [ V1Lens, V2Lens ]

const V1FirstWrite = {
        kind: "change" as const,
        schema: "projectv1",
        change: {
          message: "",
          actor: ACTOR_ID_1,
          seq: 1,
          deps: ['f758ca33017e3dc867dc10a8090ce0ff55ec461af8d9f45544a167d1ed74a3bf'],
          time: 0,
          startOp: 3, // applyLocalChange actually computes this for us
          ops: [
            {
              action: "set" as const,
              obj: AUTOMERGE_ROOT_ID,
              key: "title",
              insert: false,
              value: "hello",
              pred: ["1@0000000000"]
            },
          ],
        },
      }

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

    assert.deepEqual(patch2.diffs, {
      objectId: AUTOMERGE_ROOT_ID,
      type: "map",
      props: {
        summary: {
          "2@0000000000": {
            value: "",
          },
        },
        title: {
          "1@0000000000": {
            value: "",
          },
        },
      },
    });
  });

  it("can accept a real change", () => {

    const doc1 = Backend.init({ schema: "projectv1" });

    const [doc2, patch2] = Backend.applyChanges(doc1, [ V1Lens ]);

    const [doc3, patch3] = Backend.applyChanges(doc2, [ V1FirstWrite ]);

    assert.deepEqual(patch3.diffs, {
      objectId: '00000000-0000-0000-0000-000000000000',
      props: { title: { '3@111111': { value: 'hello' } } },
      type: 'map'
    })
  });

  it("can accept a real change with its lens", () => {

    const doc1 = Backend.init({ schema: "projectv1" });

    const [doc2, patch2] = Backend.applyChanges(doc1, [ V1Lens, V1FirstWrite ]);

    assert.deepEqual(patch2.diffs, {
      objectId: '00000000-0000-0000-0000-000000000000',
      props: { title: { '3@111111': { value: 'hello' } }, summary: { '2@0000000000': { value: '' } }  },
      type: 'map'
    })
  });

  it("when missing a lens, it uses lenses loaded in at init", () => {

    const doc1 = Backend.init({ schema: "projectv2", lenses: AllLenses });

    const [doc2, patch2] = Backend.applyChanges(doc1, [ V1Lens, V1FirstWrite ])

    assert.deepEqual(patch2.diffs, {
      objectId: '00000000-0000-0000-0000-000000000000',
      props: { name: { '3@111111': { value: 'hello' } }, summary: { '2@0000000000': { value: '' } }  },
      type: 'map'
    })

  });
});
