"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Backend = void 0;
const cambriamerge_1 = require("./cambriamerge");
var cambriamerge_2 = require("./cambriamerge");
Object.defineProperty(exports, "init", { enumerable: true, get: function () { return cambriamerge_2.init; } });
Object.defineProperty(exports, "applyChanges", { enumerable: true, get: function () { return cambriamerge_2.applyChanges; } });
Object.defineProperty(exports, "applyLocalChange", { enumerable: true, get: function () { return cambriamerge_2.applyLocalChange; } });
Object.defineProperty(exports, "getChanges", { enumerable: true, get: function () { return cambriamerge_2.getChanges; } });
Object.defineProperty(exports, "getPatch", { enumerable: true, get: function () { return cambriamerge_2.getPatch; } });
var cambriamerge_3 = require("./cambriamerge");
Object.defineProperty(exports, "BackendState", { enumerable: true, get: function () { return cambriamerge_3.CambriaBackend; } });
var automerge_1 = require("automerge");
Object.defineProperty(exports, "Frontend", { enumerable: true, get: function () { return automerge_1.Frontend; } });
Object.defineProperty(exports, "Text", { enumerable: true, get: function () { return automerge_1.Text; } });
Object.defineProperty(exports, "change", { enumerable: true, get: function () { return automerge_1.change; } });
var cambria_1 = require("cambria");
Object.defineProperty(exports, "inside", { enumerable: true, get: function () { return cambria_1.inside; } });
Object.defineProperty(exports, "addProperty", { enumerable: true, get: function () { return cambria_1.addProperty; } });
Object.defineProperty(exports, "plungeProperty", { enumerable: true, get: function () { return cambria_1.plungeProperty; } });
Object.defineProperty(exports, "removeProperty", { enumerable: true, get: function () { return cambria_1.removeProperty; } });
Object.defineProperty(exports, "hoistProperty", { enumerable: true, get: function () { return cambria_1.hoistProperty; } });
exports.Backend = {
    init: cambriamerge_1.init,
    applyChanges: cambriamerge_1.applyChanges,
    applyLocalChange: cambriamerge_1.applyLocalChange,
    getChanges: cambriamerge_1.getChanges,
    getPatch: cambriamerge_1.getPatch,
    getChangesForActor: cambriamerge_1.getChangesForActor,
    getMissingChanges: cambriamerge_1.getMissingChanges,
    getMissingDeps: cambriamerge_1.getMissingDeps,
    merge: cambriamerge_1.merge,
};
//# sourceMappingURL=index.js.map