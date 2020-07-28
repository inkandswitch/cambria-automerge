
import assert from 'assert'
import { inspect } from 'util'
import { addProperty, renameProperty, LensSource } from 'cloudina'
import * as Backend from '../src/index'

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
  return inspect(object, false, null, true)
}

describe('Has basic schema tools', () => {
  it('can accept a single schema and fill out default values', () => {

      const ProjectV1 : LensSource = [
        addProperty({ name: 'title', type: 'string' }),
        addProperty({ name: 'summary', type: 'string' }),
      ]

      const doc1 = Backend.init({ schema: "projectv1" })

      const [doc2, patch2] = Backend.applyChanges(doc1, [{ 
        kind: "lens",
        from: "mu",
        to: "projectv1",
        lens: ProjectV1
      }])

      assert.deepEqual(patch2.diffs, {
        objectId: "00000000-0000-0000-0000-000000000000",
        type: "map",
        props: {
          summary: {
            "2@0000000000": {
              value: ""
           }
         },
         title: {
           "1@0000000000": {
             value: ""
           }
         }
       }
      })
  })
})

