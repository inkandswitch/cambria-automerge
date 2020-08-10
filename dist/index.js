"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Backend = void 0;
var cambriamerge_1 = require("./cambriamerge");
Object.defineProperty(exports, "init", { enumerable: true, get: function () { return cambriamerge_1.init; } });
Object.defineProperty(exports, "applyChanges", { enumerable: true, get: function () { return cambriamerge_1.applyChanges; } });
Object.defineProperty(exports, "applyLocalChange", { enumerable: true, get: function () { return cambriamerge_1.applyLocalChange; } });
Object.defineProperty(exports, "getChanges", { enumerable: true, get: function () { return cambriamerge_1.getChanges; } });
Object.defineProperty(exports, "getPatch", { enumerable: true, get: function () { return cambriamerge_1.getPatch; } });
var cambriamerge_2 = require("./cambriamerge");
Object.defineProperty(exports, "BackendState", { enumerable: true, get: function () { return cambriamerge_2.CambriaBackend; } });
var automerge_1 = require("automerge");
Object.defineProperty(exports, "Frontend", { enumerable: true, get: function () { return automerge_1.Frontend; } });
Object.defineProperty(exports, "Text", { enumerable: true, get: function () { return automerge_1.Text; } });
Object.defineProperty(exports, "change", { enumerable: true, get: function () { return automerge_1.change; } });
var helpers_1 = require("cloudina/dist/helpers");
Object.defineProperty(exports, "inside", { enumerable: true, get: function () { return helpers_1.inside; } });
Object.defineProperty(exports, "addProperty", { enumerable: true, get: function () { return helpers_1.addProperty; } });
Object.defineProperty(exports, "plungeProperty", { enumerable: true, get: function () { return helpers_1.plungeProperty; } });
Object.defineProperty(exports, "removeProperty", { enumerable: true, get: function () { return helpers_1.removeProperty; } });
Object.defineProperty(exports, "hoistProperty", { enumerable: true, get: function () { return helpers_1.hoistProperty; } });
const cambriamerge_3 = require("./cambriamerge");
exports.Backend = {
    init: cambriamerge_3.init,
    applyChanges: cambriamerge_3.applyChanges,
    applyLocalChange: cambriamerge_3.applyLocalChange,
    getChanges: cambriamerge_3.getChanges,
    getPatch: cambriamerge_3.getPatch
};
// missing functions
// getChangesForActor, getMissingChanges, getMissingDeps, merge
//# sourceMappingURL=index.js.map