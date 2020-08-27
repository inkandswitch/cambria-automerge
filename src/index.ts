import {
  init,
  applyChanges,
  applyLocalChange,
  getChanges,
  getPatch,
  getChangesForActor,
  getMissingChanges,
  getMissingDeps,
  merge,
} from './cambriamerge'

export { init, applyChanges, applyLocalChange, getChanges, getPatch } from './cambriamerge'
export {
  RegisteredLens,
  CambriaBlock as Change,
  CambriaBackend as BackendState,
} from './cambriamerge'
export {
  Frontend,
  Doc,
  ChangeFn,
  Proxy,
  Clock,
  Change as Request,
  Patch,
  Text,
  change,
} from 'automerge'
export { inside, addProperty, plungeProperty, removeProperty, hoistProperty } from 'cambria'

export const Backend = {
  init,
  applyChanges,
  applyLocalChange,
  getChanges,
  getPatch,
  getChangesForActor,
  getMissingChanges,
  getMissingDeps,
  merge,
}
