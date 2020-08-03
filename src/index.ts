export { init, applyChanges, applyLocalChange, getChanges, getPatch } from "./cambriamerge"
export { RegisteredLens, CambriaBlock as Change, CambriaBackend as BackDoc } from "./cambriamerge"
export { Frontend, Doc, ChangeFn, Proxy, Clock, Change as Request, Patch } from 'automerge'

import { init, applyChanges, applyLocalChange, getChanges, getPatch } from "./cambriamerge"

export const Backend = {
  init,
  applyChanges,
  applyLocalChange,
  getChanges,
  getPatch
}
