import { Set } from 'immutable';
import { LensGraph, Patch as CloudinaPatch, LensSource } from 'cloudina';
import { Op, Clock, Change, Patch as AutomergePatch, BackendState } from 'automerge';
export declare const CAMBRIA_MAGIC_ACTOR = "0000000000";
export interface LensState {
    inDoc: Set<string>;
    graph: LensGraph;
}
export interface Instance {
    clock: Clock;
    schema: string;
    deps: Clock;
    elem: {
        [actor: string]: number;
    };
    bootstrapped: boolean;
    state: BackendState;
}
declare type ElemCache = {
    [key: string]: Op;
};
export interface RegisteredLens {
    to: string;
    from: string;
    lens: LensSource;
}
export interface CambriaBlock {
    schema: string;
    lenses: RegisteredLens[];
    change: Change;
    actor: string;
    seq: number;
}
export interface MiniBlock {
    schema: string;
    lenses?: RegisteredLens[];
    change: Change;
}
export declare function mkBlock(mini: MiniBlock): CambriaBlock;
export declare type InitOptions = {
    schema: string;
    lenses: RegisteredLens[];
};
export declare function init(options: InitOptions): CambriaBackend;
export declare function applyChanges(doc: CambriaBackend, changes: CambriaBlock[]): [CambriaBackend, AutomergePatch];
export declare function applyLocalChange(doc: CambriaBackend, request: Change): [CambriaBackend, AutomergePatch, CambriaBlock];
export declare function getPatch(doc: CambriaBackend): AutomergePatch;
export declare function getChanges(oldState: CambriaBackend, newState: CambriaBackend): CambriaBlock[];
export declare function getMissingChanges(doc: CambriaBackend, haveDeps: Clock): CambriaBlock[];
export declare function getChangesForActor(doc: CambriaBackend, actor: string, after?: number): CambriaBlock[];
export declare function getMissignDeps(doc: CambriaBackend): Clock;
export declare function merge(local: CambriaBackend, remote: CambriaBackend): [CambriaBackend, AutomergePatch];
export declare class CambriaBackend {
    schema: string;
    history: CambriaBlock[];
    lenses: RegisteredLens[];
    lensState: LensState;
    private instances;
    constructor({ schema, lenses }: InitOptions);
    primaryInstance(): Instance;
    applyLocalChange(request: Change): [AutomergePatch, CambriaBlock];
    getPatch(): AutomergePatch;
    applyChanges(blocks: CambriaBlock[]): AutomergePatch;
    getMissingChanges(haveDeps: Clock): CambriaBlock[];
    private getInstance;
}
export declare function buildPath(op: Op, instance: Instance, elemCache: ElemCache): string;
export declare function opToPatch(op: Op, instance: Instance, elemCache: ElemCache): CloudinaPatch;
export {};
