export { init, applyChanges, applyLocalChange, getChanges, getPatch } from "./cambriamerge";
export { RegisteredLens, CambriaBlock as Change, CambriaBackend as BackendState } from "./cambriamerge";
export { Frontend, Doc, ChangeFn, Proxy, Clock, Change as Request, Patch, Text, change } from 'automerge';
export { inside, addProperty, plungeProperty, removeProperty, hoistProperty } from 'cloudina/dist/helpers';
import { init, applyChanges, applyLocalChange, getChanges, getPatch } from "./cambriamerge";
export declare const Backend: {
    init: typeof init;
    applyChanges: typeof applyChanges;
    applyLocalChange: typeof applyLocalChange;
    getChanges: typeof getChanges;
    getPatch: typeof getPatch;
};
