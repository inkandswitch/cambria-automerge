import assert from "assert";
import { inspect } from "util";
import { addProperty, renameProperty, LensSource, reverseLens } from "cloudina";
import * as Cambria from "../src/index";
import { Frontend } from "automerge";
import { inside, plungeProperty } from "cloudina/dist/helpers";

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

    const PlungeSummary: LensSource = [plungeProperty("details", "created_at")];

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
      to: "project-plunge-summary",
      lens: PlungeSummary,
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
      const doc1 = Cambria.init({ schema: "projectv1" });

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
        details: {
          title: "hello",
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

    it("can plunge an object", () => {
      const doc1 = Cambria.init({
        schema: "project-plunge-summary",
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
                // Todo: this test still passed when setting created_at on the
                // details obj from v1, which shouldn't be possible -- why?
                // obj: patch2.diffs[0].obj,

                // V1 sets created_at property on the root obj
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
  });

  // nested objects
  // no lens at all
  // - rename in object
  // - hoist/plunge

  // lists
});
