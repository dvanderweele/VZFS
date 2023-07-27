import storageHierarchy from '../src/subsystems/storageHierarchy.js';
import { interpret }from "xstate"

function storageHierarchyTest(){
  const s = interpret(storageHierarchy)
  s.start()
  s.onTransition(
    state => {
      console.log(state.event)
    }
  )
  s.send({ type: "init", filesystemName: "test" })
}

export default storageHierarchyTest