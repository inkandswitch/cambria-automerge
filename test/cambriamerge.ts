import assert from "assert";
import { inspect } from "util";
import { addProperty, renameProperty, LensSource, reverseLens } from "cloudina";
import * as Cambria from "../src/index";
import { Frontend } from "automerge";
import {
  inside,
  plungeProperty,
  removeProperty,
  hoistProperty,
} from "cloudina/dist/helpers";

const ACTOR_ID_1 = "111111";
const ACTOR_ID_2 = "222222";
const AUTOMERGE_ROOT_ID = "00000000-0000-0000-0000-000000000000";

const ProjectV1: LensSource = [
  addProperty({ name: "title", type: "string" }),
  addProperty({ name: "summary", type: "string" }),
];

const TitleToName: LensSource = [renameProperty("title", "name")];

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
  lens: TitleToName,
};

const AllLenses: Cambria.RegisteredLens[] = [V1Lens, V2Lens];

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

const V2Write = {
  kind: "change" as const,
  schema: "projectv2",
  change: {
    message: "",
    actor: ACTOR_ID_2,
    seq: 1,
    deps: { [ACTOR_ID_1]: 1 },
    ops: [
      {
        action: "set" as const,
        obj: AUTOMERGE_ROOT_ID,
        key: "name",
        value: "actor 2 says hi",
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

    const doc1 = Cambria.init({ schema: "projectv1" });

    const [doc2, patch2] = Cambria.applyChanges(doc1, [
      {
        kind: "lens",
        from: "mu",
        to: "projectv1",
        lens: ProjectV1,
      },
    ]);

    assert.deepEqual(patch2.diffs, [
      {
        action: "set",
        key: "title",
        obj: "00000000-0000-0000-0000-000000000000",
        path: [],
        type: "map",
        value: "",
      },
      {
        action: "set",
        key: "summary",
        obj: "00000000-0000-0000-0000-000000000000",
        path: [],
        type: "map",
        value: "",
      },
    ]);
  });

  it("can accept a real change", () => {
    const doc1 = Cambria.init({ schema: "projectv1" });

    const [doc2, patch2] = Cambria.applyChanges(doc1, [V1Lens]);

    const [doc3, patch3] = Cambria.applyChanges(doc2, [V1FirstWrite]);

    assert.deepEqual(patch3.diffs, [
      {
        action: "set",
        key: "title",
        obj: "00000000-0000-0000-0000-000000000000",
        path: [],
        type: "map",
        value: "hello",
      },
    ]);
  });

  it("can accept a real change with its lens", () => {
    const doc1 = Cambria.init({ schema: "projectv1" });

    const [doc2, patch2] = Cambria.applyChanges(doc1, [V1Lens, V1FirstWrite]);

    assert.deepEqual(patch2.diffs, [
      {
        action: "set",
        key: "title",
        obj: "00000000-0000-0000-0000-000000000000",
        path: [],
        type: "map",
        value: "",
      },
      {
        action: "set",
        key: "summary",
        obj: "00000000-0000-0000-0000-000000000000",
        path: [],
        type: "map",
        value: "",
      },
      {
        action: "set",
        key: "title",
        obj: "00000000-0000-0000-0000-000000000000",
        path: [],
        type: "map",
        value: "hello",
      },
    ]);
  });

  it("converts a patch from v1 to v2", () => {
    const state1 = Cambria.init({ schema: "projectv2", lenses: AllLenses });

    const [state2, patch2] = Cambria.applyChanges(state1, [
      V1Lens,
      V1FirstWrite,
    ]);

    assert.deepEqual(patch2.diffs, [
      {
        action: "set",
        key: "name",
        obj: "00000000-0000-0000-0000-000000000000",
        path: [],
        type: "map",
        value: "",
      },
      {
        action: "set",
        key: "summary",
        obj: "00000000-0000-0000-0000-000000000000",
        path: [],
        type: "map",
        value: "",
      },
      {
        action: "set",
        key: "name",
        obj: "00000000-0000-0000-0000-000000000000",
        path: [],
        type: "map",
        value: "hello",
      },
    ]);
  });

  it("converts a doc from v1 to v2", () => {
    const state1 = Cambria.init({ schema: "projectv2", lenses: AllLenses });

    const [state2, patch2] = Cambria.applyChanges(state1, [
      V1Lens,
      V1FirstWrite,
    ]);

    let doc = Frontend.init();
    doc = Frontend.applyPatch(doc, patch2);

    assert.deepEqual(doc, {
      name: "hello",
      summary: "",
    });
  });

  it("can handle writes from v1 and v2", () => {
    const state1 = Cambria.init({ schema: "projectv2", lenses: AllLenses });

    const [state2, patch2] = Cambria.applyChanges(state1, [
      V1Lens,
      V1FirstWrite,
      V2Lens,
      V2Write,
    ]);

    let doc = Frontend.init();
    doc = Frontend.applyPatch(doc, patch2);

    assert.deepEqual(doc, {
      name: "actor 2 says hi",
      summary: "",
    });
  });

  it("can handle writes from v1 and v2 when lenses are in memory, not in doc", () => {
    const state1 = Cambria.init({ schema: "projectv2", lenses: AllLenses });

    const [state2, patch2] = Cambria.applyChanges(state1, [
      V1FirstWrite,
      V2Write,
    ]);

    let doc = Frontend.init();
    doc = Frontend.applyPatch(doc, patch2);

    assert.deepEqual(doc, {
      name: "actor 2 says hi",
      summary: "",
    });
  });

  it("converts when lenses are in doc, all before any data writes", () => {
    const state1 = Cambria.init({ schema: "projectv2" });

    const [state2, patch2] = Cambria.applyChanges(state1, [
      V1Lens,
      V2Lens,
      V1FirstWrite,
      V2Write,
    ]);

    let doc = Frontend.init();
    doc = Frontend.applyPatch(doc, patch2);

    assert.deepEqual(doc, {
      name: "actor 2 says hi",
      summary: "",
    });
  });

  it.skip("can convert data when necessary lens comes after the write", () => {
    const state1 = Cambria.init({ schema: "projectv2" });

    const [state2, patch2] = Cambria.applyChanges(state1, [
      V1Lens,
      V1FirstWrite, // we don't have the v1 write -> v2 read lens at this point
      V2Lens,
      V2Write,
    ]);

    let doc = Frontend.init();
    doc = Frontend.applyPatch(doc, patch2);

    assert.deepEqual(doc, {
      name: "actor 2 says hi",
      summary: "",
    });
  });

  it("can convert with a removeProperty lens", () => {
    const state1 = Cambria.init({
      schema: "projectv2",
      lenses: [
        V1Lens,
        // V2 removes the title property
        {
          kind: "lens" as const,
          from: "projectv1",
          to: "projectv2",
          lens: [removeProperty({ name: "title", type: "string" })],
        },
      ],
    });

    // V1 writes to the title property, which should become a no-op
    const [state2, patch2] = Cambria.applyChanges(state1, [V1FirstWrite]);

    let doc = Frontend.init();
    doc = Frontend.applyPatch(doc, patch2);

    assert.deepEqual(doc, {
      summary: "",
    });
  });

  describe("nested objects", () => {
    const ProjectV1: LensSource = [
      addProperty({ name: "details", type: "object" }),
      addProperty({ name: "created_at", type: "string" }),
      inside("details", [
        addProperty({ name: "title", type: "string" }),
        addProperty({ name: "summary", type: "string" }),
      ]),
    ];

    const ProjectV2: LensSource = [
      inside("details", [renameProperty("title", "name")]),
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

    const PlungeLens = {
      kind: "lens" as const,
      from: "projectv2",
      to: "project-plunge-createdat",
      lens: [plungeProperty("details", "created_at")],
    };

    it("can accept a single schema and fill out default values", () => {
      const doc1 = Cambria.init({ schema: "projectv1" });

      const [doc2, patch2] = Cambria.applyChanges(doc1, [V1Lens]);

      let doc = Frontend.init();
      doc = Frontend.applyPatch(doc, patch2);

      assert.deepEqual(doc, {
        created_at: "",
        details: {
          title: "",
          summary: "",
        },
      });
    });

    it("can accept a real change", () => {
      let frontend = Frontend.init(ACTOR_ID_1);
      let initPatch, change;

      // establish a cambria backend with a v1 schema
      let cambria = Cambria.init({ schema: "projectv1" });
      [cambria, initPatch] = Cambria.applyChanges(cambria, [V1Lens]);

      // sync a frontend to it and produce a meaningful change
      frontend = Frontend.applyPatch(frontend, initPatch);
      [frontend, change] = Frontend.change(frontend, (doc: any) => {
        doc.details.title = "hello";
      });

      // wrap that change in Cambria details
      const [, editPatch] = Cambria.applyChanges(cambria, [
        {
          kind: "change" as const,
          schema: "projectv1",
          change: change,
        },
      ]);

      // confirm the resulting patch is correct!
      frontend = Frontend.applyPatch(frontend, editPatch);

      assert.deepEqual(frontend, {
        created_at: "",
        details: {
          title: "hello",
          summary: "",
        },
      });
    });

    it("can apply a change from another V1", () => {
      let frontendV1 = Frontend.init(ACTOR_ID_1);
      let initPatch, change;

      // Write a realistic V1 change.
      // establish a cambria backend with a v1 schema
      let cambriaV1 = Cambria.init({ schema: "projectv1", lenses: [V1Lens] });

      // FIXME: this is grody -- we should do this automatically during Cambria.applyLocalChanges
      [cambriaV1, initPatch] = Cambria.applyChanges(cambriaV1, []);

      // sync a frontend to it and produce a meaningful change
      frontendV1 = Frontend.applyPatch(frontendV1, initPatch);
      [frontendV1, change] = Frontend.change(frontendV1, (doc: any) => {
        doc.details.title = "hello";
      });

      const cambriaChange = [
        {
          kind: "change" as const,
          schema: "projectv1",
          change: change,
        },
      ];

      // wrap that change in Cambria details
      const [, editPatch] = Cambria.applyChanges(cambriaV1, cambriaChange);

      // Apply a V1 change to a V2 backend and read it successfully
      // establish a cambria backend with a v2 schema
      let cambriaV2 = Cambria.init({
        schema: "projectv2",
        lenses: [V1Lens, V2Lens],
      });
      let frontendV2 = Frontend.init(ACTOR_ID_2);

      let v2Patch;

      // FIXME: this is grody -- we should do this automatically during Cambria.applyLocalChanges
      [cambriaV2, v2Patch] = Cambria.applyChanges(cambriaV2, []);
      frontendV2 = Frontend.applyPatch(frontendV2, v2Patch);

      [cambriaV2, v2Patch] = Cambria.applyChanges(cambriaV2, cambriaChange);
      frontendV2 = Frontend.applyPatch(frontendV2, v2Patch);

      assert.deepEqual(frontendV2, {
        created_at: "",
        details: {
          name: "hello",
          summary: "",
        },
      });
    });

    it.skip("should fill in default values without an explicit empty applyChanges call", () => {
      let frontendV1 = Frontend.init(ACTOR_ID_1);
      let initPatch, change;

      // Write a realistic V1 change.
      // establish a cambria backend with a v1 schema
      let cambriaV1 = Cambria.init({ schema: "projectv1", lenses: [V1Lens] });
      // the above line should probably read:
      // let [cambriaV1, initPatch] = Cambria.init({ schema: "projectv1", lenses: [V1Lens] })

      // sync a frontend to it and produce a meaningful change
      frontendV1 = Frontend.applyPatch(frontendV1, initPatch);
      [frontendV1, change] = Frontend.change(frontendV1, (doc: any) => {
        doc.details.title = "hello";
      });

      assert.deepEqual(frontendV1, {
        created_at: "",
        details: {
          name: "",
          summary: "",
        },
      });
    });

    it("can convert a rename inside an object", () => {
      const doc1 = Cambria.init({
        schema: "projectv2",
        lenses: [V1Lens, V2Lens],
      });

      const [doc2, patch2] = Cambria.applyChanges(doc1, [V1Lens]);

      const [doc3, patch3] = Cambria.applyChanges(doc2, [
        {
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
                obj: patch2.diffs[0].obj,
                key: "title",
                value: "hello",
              },
            ],
          },
        },
      ]);

      let doc = Frontend.init();
      doc = Frontend.applyPatch(doc, patch2);
      doc = Frontend.applyPatch(doc, patch3);

      assert.deepEqual(doc, {
        created_at: "",
        details: {
          name: "hello",
          summary: "",
        },
      });
    });

    it("can plunge a property", () => {
      const doc1 = Cambria.init({
        schema: "project-plunge-createdat",
        lenses: [V1Lens, V2Lens, PlungeLens],
      });

      const [doc2, patch2] = Cambria.applyChanges(doc1, [V1Lens]);

      const [doc3, patch3] = Cambria.applyChanges(doc1, [
        {
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
                key: "created_at",
                value: "recently",
              },
            ],
          },
        },
      ]);

      let doc = Frontend.init();
      doc = Frontend.applyPatch(doc, patch2);
      doc = Frontend.applyPatch(doc, patch3);

      assert.deepEqual(doc, {
        details: {
          name: "",
          created_at: "recently",
          summary: "",
        },
      });
    });

    it("can hoist a property", () => {
      const hoistLens = {
        kind: "lens" as const,
        from: "projectv2",
        to: "project-hoist-title",
        lens: [hoistProperty("details", "name")],
      };

      const doc1 = Cambria.init({
        schema: "project-hoist-title",
        lenses: [V1Lens, V2Lens, hoistLens],
      });

      const [doc2, patch2] = Cambria.applyChanges(doc1, [V1Lens]);

      const [doc3, patch3] = Cambria.applyChanges(doc1, [
        {
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
                obj: patch2.diffs[0].obj,
                key: "title",
                value: "hello",
              },
            ],
          },
        },
      ]);

      let doc = Frontend.init();
      doc = Frontend.applyPatch(doc, patch2);
      doc = Frontend.applyPatch(doc, patch3);

      assert.deepEqual(doc, {
        created_at: "",
        name: "hello",
        details: {
          summary: "",
        },
      });
    });

    it("can hoist a property from 2 levels deep", () => {
      const deepNestingLens = {
        kind: "lens" as const,
        from: "mu",
        to: "nested-v1",
        lens: [
          addProperty({ name: "branch1", type: "object" }),
          inside("branch1", [
            addProperty({ name: "branch2", type: "object" }),
            inside("branch2", [
              addProperty({ name: "leaf1", type: "string" }),
              addProperty({ name: "leaf2", type: "string" }),
            ]),
          ]),
        ],
      };

      const hoistLens = {
        kind: "lens" as const,
        from: "nested-v1",
        to: "nested-v2",
        lens: [inside("branch1", [hoistProperty("branch2", "leaf1")])],
      };

      const doc1 = Cambria.init({
        schema: "nested-v2",
        lenses: [deepNestingLens, hoistLens],
      });

      // fill in default values by applying an empty change
      // (todo: reconsider this workflow)
      const [doc2, patch2] = Cambria.applyChanges(doc1, []);

      // get the generated obj ID for the branch2 map from the default values,
      // to use in the change below
      const branch2ObjId = patch2.diffs.find(
        (d) =>
          d.action === "set" &&
          d.path?.length === 1 &&
          d.path[0] === "branch1" &&
          d.key === "branch2" &&
          d.link
      );

      if (!branch2ObjId)
        throw new Error("expected to find objID for branch2 map");

      const [doc3, patch3] = Cambria.applyChanges(doc1, [
        {
          kind: "change" as const,
          schema: "nested-v1",
          change: {
            message: "",
            actor: ACTOR_ID_1,
            seq: 1,
            deps: { "0000000000": 1 },
            ops: [
              {
                action: "set" as const,
                obj: branch2ObjId.obj, // todo: fill in object id of branch1
                key: "leaf1",
                value: "hello",
              },
            ],
          },
        },
      ]);

      let doc = Frontend.init();
      doc = Frontend.applyPatch(doc, patch2);
      doc = Frontend.applyPatch(doc, patch3);

      assert.deepEqual(doc, {
        branch1: {
          leaf1: "hello",
          branch2: {
            leaf2: "",
          },
        },
      });
    });

    // todo: test other ops inside changes, besides just set
    // use makeMap and link to create a new object in the change

    // todo: when we remove an obj property, make sure to swallow makemap + link ops
  });

  describe("arrays", () => {
    const arrayV1Lens = {
      kind: "lens" as const,
      from: "mu",
      to: "array-v1",
      lens: [
        addProperty({ name: "tags", type: "array", arrayItemType: "string" }),
      ],
    };

    it("can accept a single schema and fill out default values", () => {
      const doc1 = Cambria.init({
        schema: "array-v1",
        lenses: [arrayV1Lens],
      });

      // fill in default values by applying an empty change
      // (todo: reconsider this workflow)
      const [doc2, patch2] = Cambria.applyChanges(doc1, []);

      let doc = Frontend.init();
      doc = Frontend.applyPatch(doc, patch2);

      assert.deepEqual(doc, {
        tags: [],
      });
    });

    it("can write and read to an array with no lens conversion", () => {
      const doc1 = Cambria.init({
        schema: "array-v1",
        lenses: [arrayV1Lens],
      });

      // fill in default values by applying an empty change
      // (todo: reconsider this workflow)
      const [doc2, patch2] = Cambria.applyChanges(doc1, []);

      const arrayObjId = patch2.diffs[0].obj;

      const [doc3, patch3] = Cambria.applyChanges(doc1, [
        {
          kind: "change" as const,
          schema: "array-v1",
          change: {
            message: "",
            actor: ACTOR_ID_1,
            seq: 1,
            deps: { "0000000000": 1 },
            ops: [
              // insert a new element with the value "bug" (two ops in automerge 0)
              { action: "ins", obj: arrayObjId, key: "_head", elem: 1 },
              {
                action: "set",
                obj: arrayObjId,
                key: `${ACTOR_ID_1}:1`,
                value: "bug",
              },
            ],
          },
        },
      ]);

      let doc = Frontend.init();
      doc = Frontend.applyPatch(doc, patch2);
      doc = Frontend.applyPatch(doc, patch3);

      assert.deepEqual(doc, {
        tags: ["bug"],
      });
    });

    it("can write and read with an unrelated lens conversion", () => {
      // this lens has nothing to do with arrays but still pushes the patch thru cloudina
      const arrayV2Lens = {
        kind: "lens" as const,
        from: "array-v1",
        to: "array-v2",
        lens: [addProperty({ name: "other", type: "string" })],
      };

      const doc1 = Cambria.init({
        schema: "array-v2",
        lenses: [arrayV1Lens, arrayV2Lens],
      });

      const [doc2, patch2] = Cambria.applyChanges(doc1, []);

      const arrayObjId = patch2.diffs[0].obj;

      const [doc3, patch3] = Cambria.applyChanges(doc1, [
        {
          kind: "change" as const,
          schema: "array-v1",
          change: {
            message: "",
            actor: ACTOR_ID_1,
            seq: 1,
            deps: { "0000000000": 1 },
            ops: [
              // insert "feature" at the beginning
              { action: "ins", obj: arrayObjId, key: "_head", elem: 1 },
              {
                action: "set",
                obj: arrayObjId,
                key: `${ACTOR_ID_1}:1`,
                value: "feature",
              },

              // insert "bug" as the second element
              // (commented out to simplify for now)
              // {
              //   action: "ins",
              //   obj: arrayObjId,
              //   key: `${ACTOR_ID_1}:1`,
              //   elem: 2,
              // },
              // {
              //   action: "set",
              //   obj: arrayObjId,
              //   key: `${ACTOR_ID_1}:2`,
              //   value: "bug",
              // },
              // {
              //   action: "set",
              //   obj: arrayObjId,
              //   key: `${ACTOR_ID_1}:2`,
              //   value: "defect",
              // },
            ],
          },
        },
      ]);

      let doc = Frontend.init();
      doc = Frontend.applyPatch(doc, patch2);
      doc = Frontend.applyPatch(doc, patch3);

      assert.deepEqual(doc, {
        tags: ["feature"],
        other: "",
      });
    });

    // todo: insert an object into an array (not implemented yet)
    // (we have unimplemented paths on sending in make ops)

    // notes from orion:
    // -getPath needs to do this too
  });

  // lists
  // - default values
  // - no lens
  // - simple lens
  // - obj in array: default values, renaming, etc
  // - head/wrap

  // - obj in array in obj...
});
