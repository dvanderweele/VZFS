/*

Adapters of a given type, such as storage, may export different APIs, though it may make their consumption within subsystems simpler if they are more similar. 

It is preferred that adapters export a Map of Functions. Adapters may still be stateful by making use of closure.

*/

function init(){
  var db = null;
  const m = new Map([
    ['openDb', async (dbName, version, onUpgradeNeededHandler) => {
      return await new Promise((resolve) => {
        const req = indexedDB.open(dbName, version)
        req.onsuccess = (evt) => {
          db = evt.target.result
          resolve(0)
        }
        req.onerror = () => {
          resolve(1)
        }
        req.onupgradeneeded = onUpgradeNeededHandler
      })
    }],
    ['closeDb', () => {
      if(db){
        db.close()
        db = null
        return 0
      } else {
        return 1
      }
    }],
    ["deleteDb", async (dbName) => {
      return await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(dbName)
        req.onsuccess = (evt) => {
          db = evt.target.result
          resolve(0)
        }
        req.onerror = () => {
          resolve(1)
        }
        req.onupgradeneeded = onUpgradeNeededHandler
      })
    }],
    ['addRecord', async (store, record) => {
      if(!db) return ({
        success: false,
        error: 'No db has been opened.'
      })
      try {
        return {
          key: await new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite')
            tx.oncomplete = evt => {
              resolve(evt.target.result)
            }
            tx.onerror = e => {
              reject(e)
            }
            const store = tx.objectStore(store)
            store.add(record)
          }),
          success: true
        }
      } catch(e) {
        return {
          success: false,
          error: e
        }
      }
    }],
    ['putRecord', async (store, record) => {
      if(!db) return ({
        success: false,
        error: 'No db has been opened.'
      })
      try {
        return {
          key: await new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite')
            tx.oncomplete = evt => {
              resolve(evt.target.result)
            }
            tx.onerror = e => {
              reject(e)
            }
            const store = tx.objectStore(store)
            store.put(record)
          }),
          success: true
        }
      } catch(e) {
        return {
          success: false,
          error: e
        }
      }
    }],
    ['deleteRecord', async (store, key) => {
      if(!db) return ({
        success: false,
        error: 'No db has been opened.'
      })
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(store, 'readwrite')
          tx.oncomplete = () => {
            resolve()
          }
          tx.onerror = e => {
            reject(e)
          }
          const store = tx.objectStore(store)
          store.delete(key)
        })
        return {
          success: true
        }
      } catch(e) {
        return {
          success: false,
          error: e
        }
      }
    }],
    ['getRecord', async (store, key) => {
      if(!db) return ({
        success: false,
        error: 'No db has been opened.'
      })
      try {
        const result = await new Promise((resolve, reject) => {
          const tx = db.transaction(store, 'readonly')
          tx.oncomplete = (evt) => {
            resolve(evt.target.result)
          }
          tx.onerror = e => {
            reject(e)
          }
          const store = tx.objectStore(store)
          store.get(key)
        })
        return {
          success: true,
          result
        }
      } catch(e) {
        return {
          success: false,
          error: e
        }
      }
    }],
    ['clearStore', async (store) => {
      if(!db) return ({
        success: false,
        error: 'No db has been opened.'
      })
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(store, 'readwrite')
          tx.oncomplete = () => {
            resolve()
          }
          tx.onerror = e => {
            reject(e)
          }
          const store = tx.objectStore(store)
          store.clear()
        })
        return {
          success: true
        }
      } catch(e) {
        return {
          success: false,
          error: e
        }
      }
    }],
    ['countRecords', async (store) => {
      if(!db) return ({
        success: false,
        error: 'No db has been opened.'
      })
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(store, 'readonly')
          tx.oncomplete = () => {
            resolve()
          }
          tx.onerror = e => {
            reject(e)
          }
          const store = tx.objectStore(store)
          store.clear()
        })
        return {
          success: true
        }
      } catch(e) {
        return {
          success: false,
          error: e
        } 
      }
    }],
    ['getAllRecords', async (store) => {
      if(!db) return ({
        success: false,
        error: 'No db has been opened.'
      })
      try {
        const result = await new Promise((resolve, reject) => {
          const tx = db.transaction(store, 'readonly')
          tx.oncomplete = () => {
            resolve()
          }
          tx.onerror = e => {
            reject(e)
          }
          const store = tx.objectStore(store)
          store.getAll()
        })
        return {
          success: true,
          result
        }
      } catch(e) {
        return {
          success: false,
          error: e
        }
      }
    }],
    ['getAllKeys', async (store) => {
      if(!db) return ({
        success: false,
        error: 'No db has been opened.'
      })
      try {
        const result = await new Promise((resolve, reject) => {
          const tx = db.transaction(store, 'readonly')
          tx.oncomplete = () => {
            resolve()
          }
          tx.onerror = e => {
            reject(e)
          }
          const store = tx.objectStore(store)
          store.getAllKeys()
        })
        return {
          success: true,
          result
        }
      } catch(e) {
        return {
          success: false,
          error: e
        }
      }
    }],
    ["getFirstRecordByIndex", async (store, index, key) => {
      if(!db) return ({
        success: false,
        error: 'No db has been opened.'
      })
      try {
        const result = await new Promise((resolve, reject) => {
          const tx = db.transaction(store, 'readonly')
          tx.oncomplete = (evt) => {
            resolve(evt.target.result)
          }
          tx.onerror = e => {
            reject(e)
          }
          const store = tx.objectStore(store)
          const idx = store.index(index)
          idx.get(key)
        })
        return {
          success: true,
          result
        }
      } catch(e) {
        return {
          success: false,
          error: e
        }
      }
    }],
    ["getAllRecordsByIndex", async (store, index, key) => {
      if(!db) return ({
        success: false,
        error: 'No db has been opened.'
      })
      try {
        const result = await new Promise((resolve, reject) => {
          const tx = db.transaction(store, 'readonly')
          tx.oncomplete = (evt) => {
            resolve(evt.target.result)
          }
          tx.onerror = e => {
            reject(e)
          }
          const store = tx.objectStore(store)
          const idx = store.index(index)
          idx.getAll(key)
        })
        return {
          success: true,
          result
        }
      } catch(e) {
        return {
          success: false,
          error: e
        }
      }
    }],
    ["getFirstKeyByIndex", async (store, index, key) => {
      if(!db) return ({
        success: false,
        error: 'No db has been opened.'
      })
      try {
        const result = await new Promise((resolve, reject) => {
          const tx = db.transaction(store, 'readonly')
          tx.oncomplete = (evt) => {
            resolve(evt.target.result)
          }
          tx.onerror = e => {
            reject(e)
          }
          const store = tx.objectStore(store)
          const idx = store.index(index)
          idx.getKey(key)
        })
        return {
          success: true,
          result
        }
      } catch(e) {
        return {
          success: false,
          error: e
        }
      }
    }],
    ["getAllKeysByIndex", async (store, index, key) => {
      if(!db) return ({
        success: false,
        error: 'No db has been opened.'
      })
      try {
        const result = await new Promise((resolve, reject) => {
          const tx = db.transaction(store, 'readonly')
          tx.oncomplete = (evt) => {
            resolve(evt.target.result)
          }
          tx.onerror = e => {
            reject(e)
          }
          const store = tx.objectStore(store)
          const idx = store.index(index)
          idx.getAllKeys(key)
        })
        return {
          success: true,
          result
        }
      } catch(e) {
        return {
          success: false,
          error: e
        }
      }
    }],
    ["countWithKeyByIndex", async (store, index, key) => {
      if(!db) return ({
        success: false,
        error: 'No db has been opened.'
      })
      try {
        const result = await new Promise((resolve, reject) => {
          const tx = db.transaction(store, 'readonly')
          tx.oncomplete = (evt) => {
            resolve(evt.target.result)
          }
          tx.onerror = e => {
            reject(e)
          }
          const store = tx.objectStore(store)
          const idx = store.index(index)
          idx.count(key)
        })
        return {
          success: true,
          result
        }
      } catch(e) {
        return {
          success: false,
          error: e
        }
      }
    }]
  ]);
  return m
}

const IDBAdapter = init()

export default IDBAdapter; 






