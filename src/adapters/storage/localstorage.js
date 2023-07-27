/*

Adapters of a given type, such as storage, may export different APIs, though it may make their consumption within subsystems simpler if they are more similar. 

It is preferred that adapters export a Map of Functions. Adapters may still be stateful by making use of closure.

*/

const LocalStorageAdapter = new Map([
  ['getItem', key => {
    return localStorage.getItem(key)
  }],
  ['setItem', (key, val) => {
    try {
      localStorage.setItem(key, val)
      return 0
    } catch (e) {
      return 1
    }
  }],
  ['removeItem', (key) => {
    localStorage.removeItem(key)
  }],
  ['clear', () => {
    localStorage.clear()
  }]
]);

export default LocalStorageAdapter;