"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const util_1 = require("util");
const cloudina_1 = require("cloudina");
const automerge_1 = require("automerge");
const helpers_1 = require("cloudina/dist/helpers");
const Cambria = __importStar(require("../src/index"));
const ACTOR_ID_1 = '111111';
const ACTOR_ID_2 = '222222';
const InitialProjectLens = [
    cloudina_1.addProperty({ name: 'name', type: 'string' }),
    cloudina_1.addProperty({ name: 'summary', type: 'string' }),
];
const FillOutProjectLens = [
    cloudina_1.addProperty({ name: 'created_at', type: 'string' }),
    cloudina_1.addProperty({ name: 'details', type: 'object' }),
    helpers_1.inside('details', [
        cloudina_1.addProperty({ name: 'author', type: 'string' }),
        cloudina_1.addProperty({ name: 'date', type: 'string' }),
    ]),
];
const RenameLens = [cloudina_1.renameProperty('name', 'title')];
const PlungeIntoDetailsLens = [helpers_1.plungeProperty('details', 'created_at')];
const RenameNestedLens = [helpers_1.inside('details', [cloudina_1.renameProperty('date', 'updated_at')])];
// use these to just get a stack of all the lenses we have
const AllLenses = [
    InitialProjectLens,
    FillOutProjectLens,
    RenameLens,
    PlungeIntoDetailsLens,
    RenameNestedLens,
];
const AllLensChanges = AllLenses.map((current, currentIndex) => ({
    from: currentIndex === 0 ? 'mu' : `project-v${currentIndex}`,
    to: `project-v${currentIndex + 1}`,
    lens: current,
}));
const LAST_SCHEMA = AllLensChanges[AllLensChanges.length - 1].to;
// Use these when you need less
const InitialLensChange = {
    from: 'mu',
    to: 'project-v1',
    lens: InitialProjectLens,
};
const FillOutProjectLensChange = {
    from: 'project-v1',
    to: 'project-filled-out',
    lens: FillOutProjectLens,
};
const RenameLensChange = {
    from: 'project-v1',
    to: 'project-rename',
    lens: RenameLens,
};
// eslint-disable-next-line
function deepInspect(object) {
    return util_1.inspect(object, false, null, true);
}
const [v1Cambria, v1InitialPatch] = Cambria.applyChanges(Cambria.init({ schema: 'project-v1', lenses: [InitialLensChange] }), []);
const v1Frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(ACTOR_ID_1), v1InitialPatch);
describe('Has basic schema tools', () => {
    it('can accept a single schema and fill out default values', () => {
        assert_1.default.deepEqual(v1InitialPatch.diffs, [
            {
                action: 'set',
                key: 'name',
                obj: '00000000-0000-0000-0000-000000000000',
                path: [],
                type: 'map',
                value: '',
            },
            {
                action: 'set',
                key: 'summary',
                obj: '00000000-0000-0000-0000-000000000000',
                path: [],
                type: 'map',
                value: '',
            },
        ]);
    });
    it('can accept a real change', () => {
        const [, change] = automerge_1.Frontend.change(v1Frontend, (doc) => {
            doc.title = 'hello';
        });
        const cambriaChange = {
            schema: 'project-v1',
            lenses: [],
            change,
        };
        const [, patch] = Cambria.applyChanges(v1Cambria, [cambriaChange]);
        assert_1.default.deepEqual(patch.diffs, [
            {
                action: 'set',
                key: 'title',
                obj: '00000000-0000-0000-0000-000000000000',
                path: [],
                type: 'map',
                value: 'hello',
            },
        ]);
    });
    // XXX: i'm testing... something here. it's not really clear to me why, though.
    it('can accept a real change with its lens', () => {
        const cambria = Cambria.init({
            schema: 'project-rename',
            lenses: [InitialLensChange, RenameLensChange],
        });
        // this is cheating... i know the property will be called title post-lens application
        const v2Frontend = v1Frontend;
        const [, change] = automerge_1.Frontend.change(v2Frontend, (doc) => {
            doc.title = 'hello';
        });
        const cambriaChange = {
            schema: 'project-rename',
            lenses: [],
            change,
        };
        const [, patch2] = Cambria.applyChanges(cambria, [cambriaChange]);
        assert_1.default.deepEqual(patch2.diffs, [
            {
                action: 'set',
                key: 'title',
                obj: '00000000-0000-0000-0000-000000000000',
                path: [],
                type: 'map',
                value: '',
            },
            {
                action: 'set',
                key: 'summary',
                obj: '00000000-0000-0000-0000-000000000000',
                path: [],
                type: 'map',
                value: '',
            },
            {
                action: 'set',
                key: 'title',
                obj: '00000000-0000-0000-0000-000000000000',
                path: [],
                type: 'map',
                value: 'hello',
            },
        ]);
    });
    it('converts a doc from v1 to v2', () => {
        const [, change] = automerge_1.Frontend.change(v1Frontend, (doc) => {
            doc.name = 'hello';
        });
        const cambriaChange = {
            schema: 'project-v1',
            lenses: [],
            change,
        };
        const [cambria] = Cambria.applyChanges(Cambria.init({ schema: LAST_SCHEMA, lenses: [...AllLensChanges, RenameLensChange] }), []);
        const [finalDoc] = Cambria.applyChanges(cambria, [cambriaChange]);
        const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(finalDoc));
        assert_1.default.deepEqual(frontend, {
            title: 'hello',
            summary: '',
            details: {
                author: '',
                created_at: '',
                updated_at: '',
            },
        });
    });
    it.skip('can handle writes from v1 and v2', () => {
        const state1 = Cambria.init({
            schema: 'project-v1',
            lenses: [InitialLensChange, FillOutProjectLensChange],
        });
        const [, nameChange] = automerge_1.Frontend.change(v1Frontend, (doc) => {
            doc.name = 'hello';
        });
        const [, filloutChange] = automerge_1.Frontend.change(v1Frontend, (doc) => {
            doc.details = {};
            doc.details.author = 'Peter';
        });
        const [finalDoc] = Cambria.applyChanges(state1, [
            { schema: InitialLensChange.to, change: nameChange, lenses: [] },
            {
                schema: FillOutProjectLensChange.to,
                change: filloutChange,
                lenses: [],
            },
        ]);
        const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(finalDoc));
        assert_1.default.deepEqual(frontend, {
            name: 'actor 2 says hi',
            summary: '',
        });
    });
    it('can handle writes from v1 and v2 when lenses are in memory, not in doc', () => {
        const state1 = Cambria.init({
            schema: 'project-v5',
            lenses: AllLensChanges,
        });
        const [frontEnd, nameChange] = automerge_1.Frontend.change(v1Frontend, (doc) => {
            doc.name = 'hello';
        });
        const [, filloutChange] = automerge_1.Frontend.change(frontEnd, (doc) => {
            doc.details = {};
            doc.details.author = 'Peter';
        });
        const [finalDoc] = Cambria.applyChanges(state1, [
            { schema: InitialLensChange.to, change: nameChange, lenses: [] },
            {
                schema: AllLensChanges.slice(-1)[0].to,
                change: filloutChange,
                lenses: [],
            },
        ]);
        const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(finalDoc));
        assert_1.default.deepEqual(frontend, {
            title: 'hello',
            summary: '',
            details: { author: 'Peter' },
        });
    });
    it.skip('can convert data when necessary lens comes after the write', () => {
        const state1 = Cambria.init({
            schema: 'project-filled-out',
            lenses: [InitialLensChange, FillOutProjectLensChange],
        });
        const [, nameChange] = automerge_1.Frontend.change(v1Frontend, (doc) => {
            doc.name = 'hello';
        });
        const [, filloutChange] = automerge_1.Frontend.change(v1Frontend, (doc) => {
            doc.details = {};
            doc.details.author = 'Peter';
        });
        const [finalDoc] = Cambria.applyChanges(state1, [
            { schema: InitialLensChange.to, change: nameChange, lenses: [] },
            {
                schema: FillOutProjectLensChange.to,
                lenses: [FillOutProjectLensChange],
                change: filloutChange,
            },
        ]);
        const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(finalDoc));
        assert_1.default.deepEqual(frontend, {
            name: 'actor 2 says hi',
            summary: '',
        });
    });
    describe('removeProperty lens', () => {
        const RemoveLens = [helpers_1.removeProperty({ name: 'name', type: 'string' })];
        const RemoveLensChange = {
            from: 'project-v1',
            to: 'project-remove',
            lens: RemoveLens,
        };
        it('can convert with a removeProperty lens', () => {
            const removeCambria = Cambria.init({
                schema: RemoveLensChange.to,
                lenses: [InitialLensChange, RemoveLensChange],
            });
            // V1 writes to the title property, which should become a no-op
            const [, nameChange] = automerge_1.Frontend.change(v1Frontend, (doc) => {
                doc.name = 'hello';
            });
            const [finalDoc] = Cambria.applyChanges(removeCambria, [
                { schema: InitialLensChange.to, change: nameChange, lenses: [] },
            ]);
            const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(finalDoc));
            assert_1.default.deepEqual(frontend, {
                summary: '',
            });
        });
    });
    describe('nested objects', () => {
        it('can accept a single schema and fill out default values', () => {
            const [, initialPatch] = Cambria.applyChanges(Cambria.init({ schema: LAST_SCHEMA, lenses: AllLensChanges }), []);
            const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(ACTOR_ID_1), initialPatch);
            assert_1.default.deepEqual(frontend, {
                summary: '',
                title: '',
                details: {
                    author: '',
                    created_at: '',
                    updated_at: '',
                },
            });
        });
        it.skip('can accept a real change', () => {
            const [cambria] = Cambria.applyChanges(Cambria.init({ schema: LAST_SCHEMA, lenses: AllLensChanges }), []);
            const [, filledOutInitialPatch] = Cambria.applyChanges(Cambria.init({ schema: 'project-v2', lenses: AllLensChanges }), []);
            const filledOutFrontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(ACTOR_ID_1), filledOutInitialPatch);
            const [, change] = automerge_1.Frontend.change(filledOutFrontend, (doc) => {
                doc.details.author = 'Klaus';
            });
            // wrap that change in Cambria details
            const [finalDoc] = Cambria.applyChanges(cambria, [
                {
                    schema: 'project-v2',
                    change,
                    lenses: [],
                },
            ]);
            // confirm the resulting patch is correct!
            const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(finalDoc));
            assert_1.default.deepEqual(frontend, {
                details: {
                    author: 'Klaus',
                    created_at: '',
                    updated_at: '',
                },
                summary: '',
                title: '',
            });
        });
        it('can apply a change from another V2', () => {
            // Create an old v2 format patch
            const [, v2InitialPatch] = Cambria.applyChanges(Cambria.init({ schema: 'project-v2', lenses: AllLensChanges }), []);
            const v2Frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(ACTOR_ID_1), v2InitialPatch);
            // Apply a V2 change to a full-fledged backend and read it successfully
            const [, change] = automerge_1.Frontend.change(v2Frontend, (doc) => {
                doc.details.author = 'R. van Winkel';
            });
            // make a new modern Cambria and apply the patch
            const [cambria] = Cambria.applyChanges(Cambria.init({ schema: LAST_SCHEMA, lenses: AllLensChanges }), []);
            const [finalDoc] = Cambria.applyChanges(cambria, [
                {
                    schema: 'project-v2',
                    change,
                    lenses: [],
                },
            ]);
            const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(finalDoc));
            assert_1.default.deepEqual(frontend, {
                title: '',
                summary: '',
                details: {
                    author: 'R. van Winkel',
                    created_at: '',
                    updated_at: '',
                },
            });
        });
        it('can convert a rename inside an object', () => {
            const [cambria] = Cambria.applyChanges(Cambria.init({ schema: LAST_SCHEMA, lenses: AllLensChanges }), []);
            const [, v2InitialPatch] = Cambria.applyChanges(Cambria.init({ schema: 'project-v2', lenses: AllLensChanges }), []);
            const v2Frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(ACTOR_ID_2), v2InitialPatch);
            // Apply a V2 change to a full-fledged backend and read it successfully
            const [, change] = automerge_1.Frontend.change(v2Frontend, (doc) => {
                doc.details.date = 'long long ago';
            });
            const [finalDoc] = Cambria.applyChanges(cambria, [
                {
                    schema: 'project-v2',
                    change,
                    lenses: [],
                },
            ]);
            const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(finalDoc));
            assert_1.default.deepEqual(frontend, {
                title: '',
                summary: '',
                details: {
                    author: '',
                    updated_at: 'long long ago',
                    created_at: '',
                },
            });
        });
        it('can plunge a property', () => {
            const PlungeLensChange = {
                from: 'project-filled-out',
                to: 'project-plunged',
                lens: PlungeIntoDetailsLens,
            };
            const LensChanges = [InitialLensChange, FillOutProjectLensChange, PlungeLensChange];
            const [cambria] = Cambria.applyChanges(Cambria.init({ schema: 'project-plunged', lenses: LensChanges }), []);
            const [, v2InitialPatch] = Cambria.applyChanges(Cambria.init({ schema: 'project-filled-out', lenses: LensChanges }), []);
            const v2Frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(ACTOR_ID_1), v2InitialPatch);
            // Apply a V2 change to a full-fledged backend and read it successfully
            const [, change] = automerge_1.Frontend.change(v2Frontend, (doc) => {
                doc.created_at = 'recently';
            });
            const [finalDoc] = Cambria.applyChanges(cambria, [
                {
                    schema: 'project-filled-out',
                    change,
                    lenses: [],
                },
            ]);
            const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(finalDoc));
            assert_1.default.deepEqual(frontend, {
                name: '',
                summary: '',
                details: {
                    author: '',
                    date: '',
                    created_at: 'recently',
                },
            });
        });
        it('can hoist a property', () => {
            const HoistLens = [helpers_1.hoistProperty('details', 'author')];
            const HoistLensChange = {
                from: 'project-filled-out',
                to: 'project-hoisted',
                lens: HoistLens,
            };
            const LensChanges = [InitialLensChange, FillOutProjectLensChange, HoistLensChange];
            const [cambria] = Cambria.applyChanges(Cambria.init({ schema: 'project-hoisted', lenses: LensChanges }), []);
            const [, v2InitialPatch] = Cambria.applyChanges(Cambria.init({ schema: 'project-filled-out', lenses: LensChanges }), []);
            const v2Frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(ACTOR_ID_1), v2InitialPatch);
            // Apply a V2 change to a full-fledged backend and read it successfully
            const [, change] = automerge_1.Frontend.change(v2Frontend, (doc) => {
                doc.details.author = 'Steven King';
            });
            const [finalCambria] = Cambria.applyChanges(cambria, [
                {
                    schema: 'project-filled-out',
                    change,
                    lenses: [],
                },
            ]);
            const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(finalCambria));
            assert_1.default.deepEqual(frontend, {
                name: '',
                summary: '',
                author: 'Steven King',
                created_at: '',
                details: {
                    date: '',
                },
            });
        });
        it('can hoist a property from 2 levels deep', () => {
            const deepNestingLensChange = {
                from: 'mu',
                to: 'nested-v1',
                lens: [
                    cloudina_1.addProperty({ name: 'branch1', type: 'object' }),
                    helpers_1.inside('branch1', [
                        cloudina_1.addProperty({ name: 'branch2', type: 'object' }),
                        helpers_1.inside('branch2', [
                            cloudina_1.addProperty({ name: 'leaf1', type: 'string' }),
                            cloudina_1.addProperty({ name: 'leaf2', type: 'string' }),
                        ]),
                    ]),
                ],
            };
            const hoistLensChange = {
                from: 'nested-v1',
                to: 'nested-v2',
                lens: [helpers_1.inside('branch1', [helpers_1.hoistProperty('branch2', 'leaf1')])],
            };
            const cambria = Cambria.init({
                schema: 'nested-v2',
                lenses: [deepNestingLensChange, hoistLensChange],
            });
            // fill in default values by applying an empty change
            // (todo: reconsider this workflow)
            const [, patch2] = Cambria.applyChanges(cambria, []);
            // get the generated obj ID for the branch2 map from the default values,
            // to use in the change below
            const branch2ObjId = patch2.diffs.find((d) => {
                var _a;
                return d.action === 'set' &&
                    ((_a = d.path) === null || _a === void 0 ? void 0 : _a.length) === 1 &&
                    d.path[0] === 'branch1' &&
                    d.key === 'branch2' &&
                    d.link;
            });
            if (!branch2ObjId)
                throw new Error('expected to find objID for branch2 map');
            const [finalDoc] = Cambria.applyChanges(cambria, [
                {
                    schema: 'nested-v1',
                    lenses: [],
                    change: {
                        message: '',
                        actor: ACTOR_ID_1,
                        seq: 1,
                        deps: { '0000000000': 1 },
                        ops: [
                            {
                                action: 'set',
                                obj: branch2ObjId.obj,
                                key: 'leaf1',
                                value: 'hello',
                            },
                        ],
                    },
                },
            ]);
            const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(finalDoc));
            assert_1.default.deepEqual(frontend, {
                branch1: {
                    leaf1: 'hello',
                    branch2: {
                        leaf2: '',
                    },
                },
            });
        });
        // todo: test other ops inside changes, besides just set
        // use makeMap and link to create a new object in the change
        // todo: when we remove an obj property, make sure to swallow makemap + link ops
    });
    describe('arrays', () => {
        const ARRAY_V1_LENS_CHANGE = {
            from: 'mu',
            to: 'array-v1',
            lens: [cloudina_1.addProperty({ name: 'tags', type: 'array', arrayItemType: 'string' })],
        };
        const ARRAY_V2_LENS_CHANGE = {
            from: 'array-v1',
            to: 'array-v2',
            lens: [cloudina_1.addProperty({ name: 'other', type: 'string' })],
        };
        const ARRAY_V3_LENS_CHANGE = {
            kind: 'lens',
            from: 'array-v2',
            to: 'array-v3',
            lens: [cloudina_1.renameProperty('tags', 'newtags')],
        };
        it('can accept a single schema and fill out default values', () => {
            const cambria = Cambria.init({
                schema: 'array-v1',
                lenses: [ARRAY_V1_LENS_CHANGE],
            });
            const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(cambria));
            assert_1.default.deepEqual(frontend, {
                tags: [],
            });
        });
        it('can write and read to an array via push (no lens conversion)', () => {
            const cambria = Cambria.init({
                schema: 'array-v1',
                lenses: [ARRAY_V1_LENS_CHANGE],
            });
            const changeMaker = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(cambria));
            const [, change] = automerge_1.Frontend.change(changeMaker, (doc) => {
                doc.tags.push('fun');
                doc.tags.push('relaxing');
                doc.tags.push('lovecraftian');
            });
            const [cambria2] = Cambria.applyChanges(cambria, [{ schema: 'array-v1', change, lenses: [] }]);
            const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(cambria2));
            assert_1.default.deepEqual(frontend, {
                tags: ['fun', 'relaxing', 'lovecraftian'],
            });
        });
        it('can write and read to an array via assignment (no lens conversion)', () => {
            const cambria = Cambria.init({
                schema: 'array-v1',
                lenses: [ARRAY_V1_LENS_CHANGE],
            });
            const changeMaker = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(cambria));
            const [, change] = automerge_1.Frontend.change(changeMaker, (doc) => {
                doc.tags = ['maddening', 'infuriating', 'adorable'];
            });
            const [cambria2] = Cambria.applyChanges(cambria, [{ schema: 'array-v1', change, lenses: [] }]);
            const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(cambria2));
            assert_1.default.deepEqual(frontend, {
                tags: ['maddening', 'infuriating', 'adorable'],
            });
        });
        it('can insert/replace array elements w/ an unrelated lens conversion', () => {
            const cambria = Cambria.init({
                schema: 'array-v1',
                lenses: [ARRAY_V1_LENS_CHANGE, ARRAY_V2_LENS_CHANGE],
            });
            const changeMaker = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(cambria));
            const [initialDoc, change] = automerge_1.Frontend.change(changeMaker, (doc) => {
                doc.tags.push('maddening');
                doc.tags.push('infuriating');
                doc.tags.push('adorable');
            });
            console.log('first change from frontend', deepInspect(change));
            const [, overwriteChange] = automerge_1.Frontend.change(initialDoc, (doc) => {
                doc.tags[1] = 'excruciating';
            });
            console.log('second change from frontend', deepInspect(overwriteChange));
            // this is all wrong now!!! isn't lensing
            const [cambria2, , block2] = Cambria.applyLocalChange(cambria, change);
            const [cambria3, , block3] = Cambria.applyLocalChange(cambria2, overwriteChange);
            const v2state1 = Cambria.init({
                schema: 'array-v2',
                lenses: [ARRAY_V1_LENS_CHANGE, ARRAY_V2_LENS_CHANGE],
            });
            // this fails becuase we don't carry our incremental op instances across blocks
            const [v2state2] = Cambria.applyChanges(v2state1, [block2, block3]);
            const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(v2state2));
            assert_1.default.deepEqual(frontend, {
                other: '',
                tags: ['maddening', 'excruciating', 'adorable'],
            });
        });
        it('can insert/replace array elements in a single change', () => {
            const doc1 = Cambria.init({
                schema: 'array-v2',
                lenses: [ARRAY_V1_LENS_CHANGE, ARRAY_V2_LENS_CHANGE],
            });
            // fill in default values by applying an empty change
            const [, initialPatch] = Cambria.applyChanges(doc1, []);
            // fill in default values by applying a patch full of defaults
            const changeMaker = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), initialPatch);
            const [, change] = automerge_1.Frontend.change(changeMaker, (doc) => {
                doc.tags.push('el0');
                doc.tags.push('el1');
                doc.tags.push('el2');
                doc.tags[1] = 'new1';
            });
            console.log('change from frontend', deepInspect(change));
            const [, arrayPatch] = Cambria.applyChanges(doc1, [
                { schema: 'array-v1', change, lenses: [] },
            ]);
            let doc = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), initialPatch);
            doc = automerge_1.Frontend.applyPatch(doc, arrayPatch);
            assert_1.default.deepEqual(doc, {
                other: '',
                tags: ['el0', 'new1', 'el2'],
            });
        });
        it('can write to an array via assignment with an unrelated lens conversion', () => {
            const doc1 = Cambria.init({
                schema: 'array-v2',
                lenses: [ARRAY_V1_LENS_CHANGE, ARRAY_V2_LENS_CHANGE],
            });
            // fill in default values by applying an empty change
            const [, initialPatch] = Cambria.applyChanges(doc1, []);
            // fill in default values by applying a patch full of defaults
            const changeMaker = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), initialPatch);
            const [, change] = automerge_1.Frontend.change(changeMaker, (doc) => {
                doc.tags = ['maddening', 'infuriating', 'adorable'];
            });
            const [, arrayPatch] = Cambria.applyChanges(doc1, [
                { schema: 'array-v1', change, lenses: [] },
            ]);
            let doc = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), initialPatch);
            doc = automerge_1.Frontend.applyPatch(doc, arrayPatch);
            assert_1.default.deepEqual(doc, {
                tags: ['maddening', 'infuriating', 'adorable'],
            });
        });
        it('can handle array deletes', () => {
            // this lens has nothing to do with arrays but still pushes the patch thru cloudina
            const cambria = Cambria.init({
                schema: 'array-v2',
                lenses: [ARRAY_V1_LENS_CHANGE, ARRAY_V2_LENS_CHANGE],
            });
            const changeMaker = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(cambria));
            const [docWithArrays, change] = automerge_1.Frontend.change(changeMaker, (doc) => {
                doc.tags.push('maddening');
                doc.tags.push('infuriating');
                doc.tags.push('adorable');
            });
            const [, delChange] = automerge_1.Frontend.change(docWithArrays, (doc) => {
                delete doc.tags[1];
            });
            const [cambria2] = Cambria.applyLocalChange(cambria, change);
            const [cambria3] = Cambria.applyLocalChange(cambria2, delChange);
            const frontend = automerge_1.Frontend.applyPatch(automerge_1.Frontend.init(), Cambria.getPatch(cambria3));
            assert_1.default.deepEqual(frontend, {
                other: '',
                tags: ['maddening', 'adorable'],
            });
        });
        // it('reads a renamed property containing an array', () => {
        //   // this lens has nothing to do with arrays but still pushes the patch thru cloudina
        //   const doc1 = Cambria.init({
        //     schema: 'array-v3',
        //     lenses: [ARRAY_V1_LENS_CHANGE, ARRAY_V2_LENS_CHANGE, ARRAY_V3_LENS_CHANGE],
        //   })
        //   // fill in default values by applying an empty change
        //   const [, initialPatch] = Cambria.applyChanges(doc1, [])
        //   // fill in default values by applying a patch full of defaults
        //   const changeMaker = Frontend.applyPatch(Frontend.init(), initialPatch)
        //   const [, change] = Frontend.change<unknown, ArrayTestDoc>(changeMaker, (doc) => {
        //     doc.tags = ['maddening', 'infuriating', 'adorable']
        //   })
        //   const [, arrayPatch] = Cambria.applyChanges(doc1, [
        //     { kind: 'change' as const, schema: 'array-v1', change },
        //   ])
        //   let doc = Frontend.applyPatch(Frontend.init(), initialPatch)
        //   doc = Frontend.applyPatch(doc, arrayPatch)
        //   assert.deepEqual(doc, {
        //     newtags: ['maddening', 'adorable'],
        //   })
        // })
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
//# sourceMappingURL=cambriamerge.js.map