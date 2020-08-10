"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.opToPatch = exports.buildPath = exports.CambriaBackend = exports.merge = exports.getMissignDeps = exports.getChangesForActor = exports.getMissingChanges = exports.getChanges = exports.getPatch = exports.applyLocalChange = exports.applyChanges = exports.init = exports.mkBlock = exports.CAMBRIA_MAGIC_ACTOR = void 0;
const immutable_1 = require("immutable");
const cloudina_1 = require("cloudina");
const uuid_1 = require("uuid");
// This import doesn't pull in types for the Backend functions,
// maybe because we're importing from a non-root file?
const automerge_1 = require("automerge");
const util_1 = require("util");
const MAGIC_UUID = 'f1bb7a0b-2d26-48ca-aaa3-92c63bbb5c50';
// applyPatch PATCH needs to become - buildChange
// buildChange needs to incrementally track op state re 'make' - list 'insert' 'del'
// need to track deps/clock differently at the top level than at the instance level
// seq will be different b/c of lenses
const ROOT_ID = '00000000-0000-0000-0000-000000000000';
exports.CAMBRIA_MAGIC_ACTOR = '0000000000';
function deepInspect(object) {
    return util_1.inspect(object, false, null, true);
}
function mkBlock(mini) {
    return {
        schema: mini.schema,
        change: mini.change,
        lenses: mini.lenses || [],
        actor: mini.change.actor,
        seq: mini.change.seq,
    };
}
exports.mkBlock = mkBlock;
function init(options) {
    return new CambriaBackend(options);
}
exports.init = init;
function applyChanges(doc, changes) {
    const patch = doc.applyChanges(changes);
    if (patch && patch.clock) {
        delete patch.clock[exports.CAMBRIA_MAGIC_ACTOR];
    }
    if (patch && patch.deps) {
        delete patch.deps[exports.CAMBRIA_MAGIC_ACTOR];
    }
    return [doc, patch];
}
exports.applyChanges = applyChanges;
function applyLocalChange(doc, request) {
    const [patch, block] = doc.applyLocalChange(request);
    if (patch && patch.clock) {
        delete patch.clock[exports.CAMBRIA_MAGIC_ACTOR];
    }
    if (patch && patch.deps) {
        delete patch.deps[exports.CAMBRIA_MAGIC_ACTOR];
    }
    return [doc, patch, block];
}
exports.applyLocalChange = applyLocalChange;
function getPatch(doc) {
    const patch = doc.getPatch();
    if (patch && patch.clock) {
        delete patch.clock[exports.CAMBRIA_MAGIC_ACTOR];
    }
    if (patch && patch.deps) {
        delete patch.deps[exports.CAMBRIA_MAGIC_ACTOR];
    }
    return patch;
}
exports.getPatch = getPatch;
function getChanges(oldState, newState) {
    const newClock = newState.primaryInstance().clock;
    const oldClock = oldState.primaryInstance().clock;
    if (!lessOrEqual(oldClock, newClock)) {
        throw new RangeError('Cannot diff two states that have diverged');
    }
    return newState.getMissingChanges(oldClock);
}
exports.getChanges = getChanges;
function getMissingChanges(doc, haveDeps) {
    return doc.getMissingChanges(haveDeps);
}
exports.getMissingChanges = getMissingChanges;
function getChangesForActor(doc, actor, after = 0) {
    return doc.history.filter((c) => c.change.actor === actor && c.change.seq > after);
}
exports.getChangesForActor = getChangesForActor;
function getMissignDeps(doc) {
    return automerge_1.Backend.getMissingDeps(doc.primaryInstance().state);
}
exports.getMissignDeps = getMissignDeps;
function merge(local, remote) {
    const changes = getMissingChanges(remote, local.primaryInstance().clock);
    return applyChanges(local, changes);
}
exports.merge = merge;
class CambriaBackend {
    constructor({ schema = 'mu', lenses = [] }) {
        this.schema = schema;
        this.history = [];
        this.instances = {};
        this.lenses = lenses;
        this.lensState = {
            inDoc: immutable_1.Set(),
            graph: lenses.reduce((graph, lens) => cloudina_1.registerLens(graph, lens.from, lens.to, lens.lens), cloudina_1.initLensGraph()),
        };
        cloudina_1.lensFromTo(this.lensState.graph, "mu", schema); // throws error if no valid path
    }
    primaryInstance() {
        return this.getInstance(this.schema);
    }
    applyLocalChange(request) {
        let lenses = [];
        if (!this.lensState.inDoc.has(this.schema)) {
            lenses = this.lenses; // todo - dont have to put them ALL in
            this.lensState.inDoc = this.lensState.inDoc.union(immutable_1.Set(this.lenses.map((l) => l.to)));
        }
        const block = {
            schema: this.schema,
            lenses,
            change: request,
            actor: request.actor,
            seq: request.seq,
        };
        if (request.seq === 1) {
            request.deps[exports.CAMBRIA_MAGIC_ACTOR] = 1;
        }
        let instance = this.getInstance(this.schema);
        let bootdiffs = [];
        this.history.push(block);
        if (!instance.bootstrapped) {
            const bootstrapChange = bootstrap(instance, this.lensState);
            const [newInstance, bootPatch] = applyChangesToInstance(instance, [bootstrapChange]);
            bootdiffs = bootPatch.diffs;
            instance = newInstance;
        }
        const [newState, patch] = automerge_1.Backend.applyLocalChange(instance.state, request);
        instance.state = newState;
        instance.clock = patch.clock || {};
        instance.deps = patch.deps || {};
        this.instances[this.schema] = instance;
        patch.diffs.unshift(...bootdiffs);
        return [patch, block];
    }
    getPatch() {
        this.applyChanges([]); // trigger the bootstrap block if need be
        return automerge_1.Backend.getPatch(this.getInstance(this.schema).state);
    }
    // take a change and apply it everywhere
    // take a change and apply it everywhere except one place
    // take all changes and apply them in one place
    applyChanges(blocks) {
        const instance = this.getInstance(this.schema);
        const fBlocks = blocks.filter((block) => block.seq > (instance.clock[block.actor] || 0));
        this.history.push(...fBlocks);
        const { history } = this;
        const [newInstance, patch, newLensState] = applySchemaChanges(fBlocks, instance, this.lensState, history);
        this.instances[this.schema] = newInstance;
        this.lensState = newLensState;
        return patch;
    }
    getMissingChanges(haveDeps) {
        return this.history.filter((block) => block.change.seq > (haveDeps[block.change.actor] || 0));
    }
    getInstance(schema) {
        if (!this.instances[schema]) {
            this.instances[schema] = initInstance(schema);
        }
        return this.instances[schema];
    }
}
exports.CambriaBackend = CambriaBackend;
function initInstance(schema) {
    const state = automerge_1.Backend.init();
    return {
        state,
        elem: {},
        deps: {},
        schema,
        bootstrapped: false,
        clock: {},
    };
}
function convertOp(change, index, from, to, lensState, elemCache) {
    // toggle this comment block to toggle on/off debug logging inside this function
    // const debug = console.log
    const debug = (str) => { };
    const op = change.ops[index];
    debug('\n convertOp pipeline:');
    debug({ from: from.schema, to: to.schema, op });
    const lensStack = cloudina_1.lensFromTo(lensState.graph, from.schema, to.schema);
    const jsonschema7 = cloudina_1.lensGraphSchema(lensState.graph, from.schema);
    const patch = opToPatch(op, from, elemCache);
    debug({ patch });
    const convertedPatch = cloudina_1.applyLensToPatch(lensStack, patch, jsonschema7);
    debug({ convertedPatch });
    // todo: optimization idea:
    // if cloudina didn't do anything (convertedPatch deepEquals patch)
    // then we should just be able to set convertedOps = [op]
    const convertedOps = patchToOps(convertedPatch, change, index, to);
    debug({ convertedOps });
    return convertedOps;
}
function getInstanceAt(schema, actorId, seq, lensState, history) {
    const blockIndex = history.findIndex((block) => block.change.actor === actorId && block.change.seq === seq);
    if (blockIndex === -1)
        throw new Error(`Could not find block with actorId ${actorId} and seq ${seq}`);
    const blocksToApply = history.slice(0, blockIndex);
    // todo: make sure we set default values even if lens not in doc
    const empty = initInstance(schema);
    const [instance, , newGraph] = applySchemaChanges(blocksToApply, empty, lensState, history);
    return [instance, newGraph];
}
// returns a change with list of ops sorted in the order we'd like to process them.
// currently only does one thing:
// for each array insertion, puts the 'set' immediately after its corresponding 'ins'.
// TODO: consider insertions of objects or lists -- there are additional ops
//   besides just the ins and set
function sortOps(change) {
    const originalOps = [...change.ops];
    const sortedOps = [];
    // add an op to the sortedOps array; delete from originalOps
    const appendOp = (op) => {
        sortedOps.push(op);
        originalOps.splice(originalOps.indexOf(op), 1);
    };
    for (const op of originalOps) {
        sortedOps.push(op);
        // An 'ins' op just creates a placeholder. Later on, that gets filled in by
        // what we'll call here reifying ops, which can be:
        // 1) 'set' (for a list of scalars)
        // 2) 'makeMap' + 'link' (for a list of objects)
        // 3) 'makeList' + 'link' (for a list of lists)
        // In all 3 of these cases, we need to ensure that those subsequent ops
        // come immediately after the 'ins'. This turns the insertion from a placeholder
        // into an actual reified operation, and simplifies the processing of future
        // operations later on because the insert has been fully processed.
        if (op.action === 'ins') {
            // todo: can there be more than one of these in a change? if so what happens?
            const reifyingOp = originalOps.find((o) => ['set', 'link'].includes(o.action) && o.key === `${change.actor}:${op.elem}`);
            if (!reifyingOp)
                throw new Error(`expected to find a reifying op corresponding to ins op: ${op}`);
            if (reifyingOp.action === 'set') {
                appendOp(reifyingOp);
            }
            else if (reifyingOp.action === 'link') {
                // Here we can't just pull up the link op;
                // we need to find the new map or list it's referring to,
                // and make the order [ins, make*, link, ...]
                const makeOp = originalOps.find((o) => o.obj === reifyingOp.value);
                if (!makeOp)
                    throw new Error(`expected make op corresponding to link ${reifyingOp}`);
                appendOp(makeOp);
                appendOp(reifyingOp);
            }
        }
        if (['makeList', 'makeMap', 'makeTable', 'makeText'].includes(op.action)) {
            const linkOp = originalOps.find((o) => o.action === 'link' && o.value === op.obj);
            if (!linkOp)
                throw new Error(`expected to find link op corresponding to makeMap: ${op}`);
            // add the set op after the insert, and remove from the original list
            appendOp(linkOp);
        }
    }
    return Object.assign(Object.assign({}, change), { ops: sortedOps });
}
function convertChange(block, fromInstance, toInstance, lensState) {
    const ops = [];
    // copy the from and to instances locally to ensure we don't mutate them.
    // we're going to play these instances forward locally here as we apply the ops,
    // but then we'll throw that out and just return a change which will be
    // applied by the caller of this function to the toInstance.
    // TODO: determine whether this is actually necessary -- might not be since
    // we do some copying at the layer above this
    let fromInstanceClone = Object.assign({}, fromInstance);
    let toInstanceClone = Object.assign({}, toInstance);
    // cache array insert ops by the elem that they created
    // (cache is change-scoped because we assume insert+set combinations are within same change)
    const elemCache = {};
    const sortedChange = sortOps(block.change);
    sortedChange.ops.forEach((op, i) => {
        if (op.action === 'ins') {
            // add the elem to cache
            elemCache[`${block.change.actor}:${op.elem}`] = op;
            // apply the discarded op to the from instance
            fromInstanceClone = applyOps(fromInstanceClone, [op], block.change.actor);
            return;
        }
        if (['makeMap', 'makeList', 'makeText', 'makeTable'].includes(op.action)) {
            // apply the discarded op to the from instance
            fromInstanceClone = applyOps(fromInstanceClone, [op], block.change.actor);
            return;
        }
        const convertedOps = convertOp(sortedChange, i, fromInstanceClone, toInstanceClone, lensState, elemCache);
        ops.push(...convertedOps);
        // After we convert this op, we need to incrementally apply it
        // to our instances so that we can do path-objId resolution using
        // these instances
        fromInstanceClone = applyOps(fromInstanceClone, [op], block.change.actor);
        toInstanceClone = applyOps(toInstanceClone, convertedOps, block.change.actor);
    });
    const change = {
        ops,
        message: block.change.message,
        actor: block.change.actor,
        seq: block.change.seq,
        deps: block.change.deps,
    };
    return [change, fromInstanceClone, toInstanceClone];
}
// write a change to the instance,
// and update all the metadata we're keeping track of in the Instance
// only apply changes through this function!!
function applySchemaChanges(blocks, instance, lensState, history) {
    const changesToApply = [];
    let fromInstance;
    let toInstance;
    for (const block of blocks) {
        for (const lens of block.lenses) {
            // FIXME
            const oldInDoc = lensState.inDoc;
            lensState = {
                inDoc: oldInDoc.add(lens.to),
                graph: cloudina_1.registerLens(lensState.graph, lens.from, lens.to, lens.lens),
            };
        }
        if (block.schema === instance.schema) {
            changesToApply.push(block.change);
        }
        else {
            fromInstance =
                fromInstance ||
                    getInstanceAt(block.schema, block.change.actor, block.change.seq, lensState, history)[0];
            // copy our main instance before passing into convertChange;
            // convertChange is going to incrementally play ops into the copy
            // we also need to bootstrap it before starting to incrementally apply ops
            toInstance = toInstance || Object.assign({}, instance);
            if (!toInstance.bootstrapped) {
                const bootstrapChange = bootstrap(toInstance, lensState);
                [toInstance] = applyChangesToInstance(toInstance, [bootstrapChange]);
                toInstance.bootstrapped = true;
            }
            let newChange;
            [newChange, fromInstance, toInstance] = convertChange(block, fromInstance, toInstance, lensState);
            changesToApply.push(newChange);
        }
    }
    if (!instance.bootstrapped) {
        const bootstrapChange = bootstrap(instance, lensState);
        changesToApply.unshift(bootstrapChange);
        instance.bootstrapped = true;
    }
    //console.log(`applying final changes to ${instance.schema}`, deepInspect(changesToApply))
    const [newInstance, patch] = applyChangesToInstance(instance, changesToApply);
    return [newInstance, patch, lensState];
}
function bootstrap(instance, lensState) {
    const urOp = [{ op: 'add', path: '', value: {} }];
    const jsonschema7 = cloudina_1.lensGraphSchema(lensState.graph, instance.schema);
    if (jsonschema7 === undefined) {
        throw new Error(`Could not find JSON schema for schema ${instance.schema}`);
    }
    const defaultsPatch = cloudina_1.applyLensToPatch([], urOp, jsonschema7).slice(1);
    const bootstrapChange = {
        actor: exports.CAMBRIA_MAGIC_ACTOR,
        message: '',
        deps: {},
        seq: 1,
        ops: [],
    };
    bootstrapChange.ops = patchToOps(defaultsPatch, bootstrapChange, 1, instance);
    return bootstrapChange;
}
// convert a patch back into automerge ops
function patchToOps(patch, origin, opIndex, instance) {
    // as we create objects in our conversion process, remember object IDs by path
    const pathCache = { '': ROOT_ID };
    // todo: see if we can refactor to have TS tell us what's missing here
    const ops = patch
        .map((patchop, i) => {
        const acc = [];
        const makeObj = uuid_1.v5(`${origin.actor}:${origin.seq}:${opIndex}:${i}"`, MAGIC_UUID);
        let action;
        if (patchop.op === 'remove') {
            action = 'del';
        }
        else if (patchop.op === 'add' || patchop.op === 'replace') {
            if (patchop.value === null ||
                ['string', 'number', 'boolean'].includes(typeof patchop.value)) {
                action = 'set';
            }
            else if (Array.isArray(patchop.value)) {
                action = 'link';
                acc.push({ action: 'makeList', obj: makeObj });
                pathCache[patchop.path] = makeObj;
            }
            else if (typeof patchop.value === 'object' && Object.keys(patchop.value).length === 0) {
                action = 'link';
                acc.push({ action: 'makeMap', obj: makeObj });
                pathCache[patchop.path] = makeObj;
            }
            else {
                throw new RangeError(`bad value for patchop=${deepInspect(patchop)}`);
            }
        }
        else {
            throw new RangeError(`bad op type for patchop=${deepInspect(patchop)}`);
        }
        // todo: in the below code, we need to resolve array indexes to element ids
        // (maybe some of it can happen in getObjId? consider array indexes
        // at intermediate points in the path)
        const pathParts = patchop.path.split('/');
        let key = pathParts.pop();
        const objPath = pathParts.join('/');
        // console.log({ pathCache })
        const objId = pathCache[objPath] || getObjId(instance.state, objPath);
        if (getObjType(instance.state, objId) === 'list') {
            if (key === undefined || Number.isNaN(parseInt(key, 10))) {
                throw new Error(`Expected array index on path ${patchop.path}`);
            }
            const originalOp = origin.ops[opIndex];
            if (patchop.op === 'add') {
                const arrayIndex = parseInt(key, 10) - 1;
                const insertAfter = findElemOfIndex(instance.state, objId, arrayIndex);
                if (insertAfter === null)
                    throw new Error(`expected to find array element at ${arrayIndex} in ${patchop.path}`);
                //if (originalOp.key === undefined) throw new Error(`expected key on op: ${originalOp}`)
                const insertElemId = parseInt((originalOp.key || "").split(':')[1], 10);
                const elem = insertElemId || (instance.elem[origin.actor] || 0) + 1;
                key = `${origin.actor}:${elem}`;
                acc.push({
                    action: 'ins',
                    obj: objId,
                    key: insertAfter,
                    elem
                });
            }
            else {
                const arrayIndex = parseInt(key, 10);
                const insertAt = findElemOfIndex(instance.state, objId, arrayIndex);
                if (insertAt === null)
                    return []; // this element doesnt exist - do nothing
                // this shouldnt be needed once we wrap defaults - todo
                key = insertAt;
            }
        }
        if (getObjType(instance.state, objId) === 'list') {
            // todo: maybe need to do some stuff here for object-in-array?
            // look up the obj, generate the makeMap/link ops?
        }
        if (objId === undefined)
            throw new Error(`Could not find object with path ${objPath}`);
        if (action === 'link') {
            const op = { action, obj: objId, key, value: makeObj };
            acc.push(op);
        }
        else if (patchop.op === 'add' || patchop.op === 'replace') {
            const op = { action, obj: objId, key, value: patchop.value };
            acc.push(op);
        }
        else {
            const op = { action, obj: objId, key };
            acc.push(op);
        }
        // console.log('converted one patchop', { patchop, acc })
        return acc;
    })
        .flat();
    return ops;
}
function buildPath(op, instance, elemCache) {
    const { obj } = op;
    const path = getPath(instance.state, obj) || [];
    let { key } = op;
    let arrayIndex;
    if (getObjType(instance.state, obj) === 'list') {
        if (key === undefined)
            throw new Error('expected key on op');
        // if the key is in the elem cache (ie, inserted earlier in this change), look there.
        // otherwise we can just find the key in the
        if (Object.keys(elemCache).includes(key)) {
            const prevKey = elemCache[key].key;
            if (prevKey === undefined)
                throw new Error('expected key on insert op');
            delete elemCache[key];
            key = prevKey;
            arrayIndex = findIndexOfElem(instance.state, obj, key) + 1;
        }
        else {
            arrayIndex = findIndexOfElem(instance.state, obj, key);
        }
        key = String(arrayIndex);
    }
    const finalPath = `/${[...path, key].join('/')}`;
    return finalPath;
}
exports.buildPath = buildPath;
// given an automerge instance, an array obj id, and an elem ID, return the array index
function findIndexOfElem(state, objId, insertKey) {
    if (insertKey === '_head')
        return -1;
    // find the index of the element ID in the array
    // note: this code not exercised yet, but hopefully roughly right
    return state.getIn(['opSet', 'byObject', objId, '_elemIds']).indexOf(insertKey);
}
// given an automerge instance, an array obj id, and an index, return the elem ID
function findElemOfIndex(state, objId, index) {
    if (index === -1)
        return '_head';
    const elemId = state.getIn(['opSet', 'byObject', objId, '_elemIds']).keyOf(index); // todo: is this the right way to look for an index in SkipList?
    if (elemId === undefined || elemId === null) {
        return null;
        //throw new Error(`expected to find elem ID at index ${index} in obj ${objId}`)
    }
    return elemId;
}
// Given a json path in a json doc, return the object ID at that path.
// If the path doesn't resolve to an existing object ID, returns null
function getObjId(state, path) {
    if (path === '')
        return ROOT_ID;
    const pathSegments = path.split('/').slice(1);
    const opSet = state.get('opSet');
    let objectId = ROOT_ID;
    for (const pathSegment of pathSegments) {
        const objType = getObjType(state, objectId);
        if (objType === 'object') {
            const objectKeys = opSet.getIn(['byObject', objectId]);
            // _keys contains an array for each key in case there are conflicts;
            // it's sorted so we can just take the first element
            const newObjectId = objectKeys.getIn(['_keys', pathSegment, 0, 'value']);
            // Sometimes, the path we're looking for isn't in the instance, give up
            if (newObjectId === undefined) {
                return null;
            }
            objectId = newObjectId;
        }
        else {
            // getting object ID for list
            const arrayIndex = parseInt(pathSegment, 10);
            const elemId = findElemOfIndex(state, objectId, arrayIndex);
            const objId = opSet.getIn(['byObject', objectId, '_elemIds']).getValue(elemId).obj;
            return objId;
        }
    }
    return objectId;
}
// given an automerge backend state and object ID, returns the type of the object
function getObjType(state, objId) {
    const objType = state.getIn(['opSet', 'byObject', objId, '_init', 'action']);
    return objType === 'makeList' || objType === 'makeText' ? 'list' : 'object';
}
function getPath(state, obj) {
    const opSet = state.get('opSet');
    const path = [];
    while (obj !== ROOT_ID) {
        const ref = opSet.getIn(['byObject', obj, '_inbound'], immutable_1.Set()).first();
        if (!ref)
            return null;
        obj = ref.get('obj');
        if (getObjType(state, obj) === 'list') {
            const index = opSet.getIn(['byObject', obj, '_elemIds']).indexOf(ref.get('key'));
            if (index < 0)
                return null;
            path.unshift(index);
        }
        else {
            path.unshift(ref.get('key'));
        }
    }
    return path;
}
function opToPatch(op, instance, elemCache) {
    switch (op.action) {
        case 'set': {
            // if the elemCache has the key, we're processing an insert
            //const action = op.key && elemCache[op.key] ? 'add' : 'replace'
            let action;
            const objType = getObjType(instance.state, op.obj);
            if (objType === "list") {
                action = (op.key && elemCache[op.key] ? 'add' : 'replace');
            }
            else {
                const oldVal = getMapValue(instance.state, op.obj, op.key);
                action = (oldVal === null ? "add" : "replace");
            }
            const path = buildPath(op, instance, elemCache);
            const { value } = op;
            return [{ op: action, path, value }];
        }
        case 'del': {
            const path = buildPath(op, instance, elemCache);
            return [{ op: 'remove', path }];
        }
        case 'link': {
            // We need to play an empty object/list creation into the to instance
            const action = op.key && elemCache[op.key] ? 'add' : 'replace';
            const path = buildPath(op, instance, elemCache);
            // figure out what type of empty container to create, based on whether
            // makeMap or makeList was used to create the object being linked
            const objType = getObjType(instance.state, op.value);
            return [{ op: action, path, value: objType === 'list' ? [] : {} }];
        }
        default:
            // note: inserts in Automerge 0 don't produce a patch, so we don't have a case for them here.
            // (we swallow them earlier in the process)
            throw new RangeError(`unsupported op ${deepInspect(op)}`);
    }
}
exports.opToPatch = opToPatch;
function applyChangesToInstance(instance, changes) {
    //console.log(`applying changes to ${instance.schema}`, deepInspect(changes))
    let elem = changes.reduce((acc, change) => {
        const oldMax = acc[change.actor] || 0;
        const maxElem = Math.max(oldMax, ...change.ops.map(op => op.elem || 0));
        return Object.assign(Object.assign({}, acc), { [change.actor]: maxElem });
    }, instance.elem);
    const [backendState, patch] = automerge_1.Backend.applyChanges(instance.state, changes);
    return [
        {
            clock: patch.clock || {},
            schema: instance.schema,
            elem,
            bootstrapped: true,
            deps: patch.deps || {},
            state: backendState,
        },
        patch,
    ];
}
function applyOps(instance, ops, actor = exports.CAMBRIA_MAGIC_ACTOR) {
    // construct a change out of the ops
    const change = {
        ops,
        message: '',
        actor,
        seq: (instance.clock[actor] || 0) + 1,
        deps: instance.deps,
    };
    const [newInstance] = applyChangesToInstance(instance, [change]);
    return newInstance;
}
function lessOrEqual(clock1, clock2) {
    const keys = Object.keys(clock1).concat(Object.keys(clock2));
    return keys.reduce((result, key) => (result && (clock1[key] || 0) <= (clock2[key] || 0)), true);
}
function getMapValue(state, obj, key) {
    const value = state.getIn(['opSet', 'byObject', obj, '_keys', key, 0, 'value']);
    //const value = objectKeys.getIn(['_keys', key, 0, 'value'])
    return value;
}
//# sourceMappingURL=cambriamerge.js.map