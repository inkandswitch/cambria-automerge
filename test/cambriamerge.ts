import assert from "assert";
import { inspect } from "util";
import { addProperty, renameProperty, LensSource } from "cloudina";
import * as Backend from "../src/index";

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

const ACTOR_ID_1 = "111111";
const ACTOR_ID_2 = "222222";

const AUTOMERGE_ROOT_ID = "00000000-0000-0000-0000-000000000000";

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

    const [doc3, patch3] = Backend.applyChanges(doc2, [
      {
        kind: "change" as const,
        schema: "projectv1",
        change: {
          message: "",
          actor: ACTOR_ID_1,
          seq: 1,
          deps: patch2.deps,
          time: 0,
          startOp: 3, // applyLocalChange actually computes this for us
          ops: [
            {
              action: "set",
              obj: AUTOMERGE_ROOT_ID,
              key: "title",
              insert: false,
              value: "hello",
              pred: patch2.diffs.props
                ? [Object.keys(patch2.diffs.props.title)[0]]
                : [],
            },
          ],
        },
      },
    ]);
  });
});
