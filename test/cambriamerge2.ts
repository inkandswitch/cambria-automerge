// ======================================
// This file shows how Cloudina can be used to implement Chitin
// ======================================

import assert from "assert";
import { inspect } from "util";
import { addProperty, renameProperty, LensSource } from "cloudina";
import { Micromerge, ROOT_ID } from "../src/micromerge";
import { Cambriamerge, opToPatch, applyPatch } from "../src/cambriamerge";
import {
  init,
  registerLens,
  applyChanges,
  applyLocalChange,
  getChanges,
  CAMBRIA_MAGIC_ACTOR,
} from "../src/index";

export interface ProjectV1 {
  title: string;
  summary: boolean;
}

export interface ProjectV2 {
  name: string;
  description: string;
  complete: boolean;
}

export interface ProjectV3 {
  name: string;
  description: string;
  status: string;
}

export interface ProjectV4 {
  title: string;
  description: string;
  status: string;
  age: number;
}

function deepInspect(object: any) {
  return inspect(object, false, null, true);
}

describe("cambriamerge", () => {
  it("can bootstrap a new doc", () => {
    const actorId = "1234"; // todo: is this a valid actorId?
    let doc = init({ schema: "projectv1" });

    doc = registerLens(doc, "mu", "projectv1", [
      addProperty({ name: "title", type: "string" }),
      addProperty({ name: "summary", type: "string" }),
    ]);

    applyChanges(doc, [
      {
        kind: "change" as const,
        schema: "projectv1",
        change: {
          message: "",
          actor: actorId,
          seq: 0,
          deps: [],
          ops: [
            {
              action: "makeMap",
              obj: ROOT_ID,
              key: "test",
              insert: false,
            },
          ],
        },
      },
    ]);
  });
});
