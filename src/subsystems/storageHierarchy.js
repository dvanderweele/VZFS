/*

All subsystems free to consume adapaters in any way they please so long as subsystems of a given type, such as storage, always export the same API. subsystems should be actors.

File
----
- id
- name
- content
- parentDirId
- createdAt
- updatedAt

Directory
---------
- id
- name
- parentDirId
- createdAt
- updatedAt

Alternate Schema:
* One table with polymorphic entities to make locking easier. 
* One more table for expiring locks. these can be path aware, and will be optimistic.
* need to ensure all mutating methods do not violate self-referential foreign key constraint. let's nix the adapter and do idb stuff in here so we can do proper table locking
* we will utilize materialized path strategy

Entity
------
- id
- name
- path
- isLeaf
- parentId
- createdAt
- updatedAt

Lock
----
- id
- expiry
- pathPrefix
- createdAt

Operations
----------
* below operations must all follow this order:
1. resolve path
2. try once to acquire (an) expiring lock(s) with prefix(es) being resolved path(s). quit if not acquired
3. perform operations on Entity table.
4. delete the acquired lock(s).
createFile: 
readFile: {},
writeFile: {},
createDir: {},
readDir: {},
deleteDir: {},
reparentDir: {},
reparentFile: {},
currentDir: {},
changeDir: {},

Lock Management
---------------
* pathPrefix column has unique index
* if lock creation/insertion fails due to this index, one search should be made for the extant lock record to check its expiry. if it is expired, it may be deleted and an automatic retry may happen.

*/
import { createMachine, actions, send, raise, sendParent } from "xstate"
import { normalize, absPathToPieces } from "../utils/path.js"
import {
  lockPath,
  removeLock,
  getLock,
  entityExists,
  joinContentToLeaf,
  getEntity,
  getEntitiesByPrefix,
  getImmediateChildKeysOfDirectory,
  insertContentRecord,
  updateContentRecord,
  deleteContentRecord,
  rejectIfConflictingLockPathPrefixes,
  addFileEntity,
  addDirectoryEntity,
  deleteEntity,
  deleteLeafEntity,
  deleteDirectoryIfEmpty,
  emptyDirectory,
  updateFile,
  updateFileTimestamp,
  renameFile,
  reparentLeaf,
  transplantAncestors,
  pruneExpiredLocks
} from "../promises/IDB.js"

const { assign, log } = actions

const storageHierarchy = createMachine({
  predictableActionArguments: true,
  initial: "uninitialized",
  context: {
    cwd: "/",
    fsName: null
  },
  states: {
    uninitialized: {
      initial: "idle",
      states: {
        idle: {
          on: {
            init: {
              target: "initializing",
              cond: (_, evt) => typeof evt.filesystemName === "string" && typeof evt.version === "number",
              actions: assign((ctx, evt) => ({
                ...ctx,
                fsName: evt.filesystemName,
                version: evt.version
              }))
            },
            listFilesystems: {
              target: "listingFilesystems"
            },
            dropFilesystem: {
              target: "droppingFilesystem"
            },
            restoreFilesystemFromJSON: {
              target: "restoringFilesystemFromJSON"
            }
          }
        },
        listingFilesystems: {
          invoke: {
            src: () => {
              return indexedDB.databases()
            },
            onDone: {
              target: "idle",
              actions: [
                sendParent(
                  (_, evt) => {
                    return {
                      type: "listFilesystemsSuccess",
                      filesystems: evt.data
                    }
                  }
                )
              ]
            },
            onError: {
              target: "idle",
              actions: [
                sendParent(
                  (_, evt) => ({
                    type: "listFilesystemsFailure",
                    error: evt.data
                  })
                )
              ]
            }
          }
        },
        droppingFilesystem: {
          invoke: {
            src: (_, evt) => {
              return new Promise(
                (res, rej) => {
                  const rq = indexedDB.deleteDatabase(
                    evt.fsName
                  )
                  rq.onsuccess = () => {
                    res()
                  }
                  rq.onerror = () => {
                    rej(rq.error)
                  }
                }
              )
            },
            onDone: {
              target: "idle",
              actions: [
                sendParent(
                  () => ({
                    type: "dropFilesystemSuccess"
                  })
                )
              ]
            },
            onError: {
              target: "idle",
              actions: [
                sendParent(
                  (_, evt) => ({
                    type: "dropFilesystemFailure",
                    error: evt.data
                  })
                )
              ]
            }
          }
        },
        restoringFilesystemFromJSON: {
          invoke: {
            src: (_, evt) => Promise.resolve(
              typeof indexedDB.databases !== "undefined" ? indexedDB.databases() : []
            ).then(
              databaseNames => new Promise(
                (res, rej) => {
                  if(
                    typeof indexedDB.databases !== "undefined" && databaseNames.includes(
                      evt.fsName
                    )
                  ) {
                    rej(
                      "Filesystem with provided name already exists"
                    )
                  }
                  const req = window.indexedDB.open(
                    evt.fsName, 
                    evt.version
                  )
                  req.onsuccess = (evt) => {
                    db = evt.target.result
                    res(db)
                  }
                  req.onerror = () => {
                    rej()
                  }
                  req.onupgradeneeded = e => {
                    const db = e.target.result
                    const entity = db.createObjectStore(
                      "entity", 
                      {
                        keyPath: "path"
                      }
                    )
                    entity.createIndex(
                      "name", 
                      "name"
                    )
                    entity.createIndex(
                      "parentPath", 
                      "parentPath"
                    )
                    entity.createIndex(
                      "createdAt", 
                      "createdAt"
                    )
                    entity.createIndex(
                      "updatedAt", 
                      "updatedAt"
                    )
                    entity.createIndex(
                      "uniqueParentChild", [
                      "parentPath",
                      "name"
                    ], {
                      unique: true
                    }
                    )
                    const lock = db.createObjectStore(
                      "lock", {
                      keyPath: "pathPrefix"
                    }
                    )
                    lock.createIndex(
                      "expiry", 
                      "expiry"
                    )
                    lock.createIndex(
                      "createdAt", 
                      "createdAt"
                    )
                    const content = db.createObjectStore(
                      "content", 
                      {
                        keyPath: "leafPath"
                      }
                    )
                  }
                }
              )
            ).then(
              newDB => {
                const { entity, lock, content } = JSON.parse(
                  evt.backup
                )
                return Promise.all(
                  [
                    Promise.all(
                      entity.map(e => new Promise(
                        (res, rej) => {
                          const tab = newDB
                            .transaction(
                              "entity", 
                              "readwrite"
                            ).objectStore(
                              "entity"
                            )
                          const req = tab.put(
                            e
                          )
                          req.onsuccess = res
                          req.onerror = rej
                        }
                      ))
                    ),
                    Promise.all(
                      content.map(e => new Promise(
                        (res, rej) => {
                          const tab = newDB
                            .transaction(
                              "content", 
                              "readwrite"
                            ).objectStore(
                              "content"
                            )
                          const req = tab.put(
                            e
                          )
                          req.onsuccess = res
                          req.onerror = rej
                        }
                      ))
                    ),
                    Promise.all(
                      lock.map(e => new Promise(
                        (res, rej) => {
                          const tab = newDB
                            .transaction(
                              "lock", 
                              "readwrite"
                            ).objectStore(
                              "lock"
                            )
                          const req = tab.put(
                            e
                          )
                          req.onsuccess = res
                          req.onerror = rej
                        }
                      ))
                    )
                  ]
                )
              }
            ),
            onDone: {
              target: "idle",
              actions: [
                sendParent(
                  "restoreFilesystemFromJSONSuccess"
                )
              ]
            },
            onError: {
              target: "idle",
              actions: [
                sendParent(
                  "restoreFilesystemFromJSONFailure"
                )
              ]
            }
          }
        },
        initializing: {
          invoke: {
            src: ctx => new Promise(
              (res, rej) => {
                const req = window.indexedDB.open(
                  ctx.fsName, 
                  ctx.version
                )
                req.onsuccess = (evt) => {
                  db = evt.target.result
                  res(db)
                }
                req.onerror = () => {
                  rej()
                }
                req.onupgradeneeded = e => {
                  const db = e.target.result
                  const entity = db.createObjectStore(
                    "entity", 
                    {
                      keyPath: "path"
                    }
                  )
                  entity.createIndex(
                    "name", 
                    "name"
                  )
                  entity.createIndex(
                    "parentPath", 
                    "parentPath"
                  )
                  entity.createIndex(
                    "createdAt", 
                    "createdAt"
                  )
                  entity.createIndex(
                    "updatedAt", 
                    "updatedAt"
                  )
                  entity.createIndex(
                    "uniqueParentChild", [
                    "parentPath",
                    "name"
                  ], {
                    unique: true
                  }
                  )
                  const lock = db.createObjectStore(
                    "lock", {
                    keyPath: "pathPrefix"
                  }
                  )
                  lock.createIndex(
                    "expiry", 
                    "expiry"
                  )
                  lock.createIndex(
                    "createdAt", 
                    "createdAt"
                  )
                  const content = db.createObjectStore(
                    "content", 
                    {
                      keyPath: "leafPath"
                    }
                  )
                }
              }
            ),
            onDone: {
              target: "seeding",
              actions: [
                assign((ctx, evt) => ({
                  ...ctx,
                  db: evt.data
                }))
              ]
            },
            onError: {
              target: "idle",
              actions: [
                log(
                  "Failed to initialize filesystem."
                ),
                log(
                  (_, e) => e.toString()
                )
              ]
            }
          }
        },
        seeding: {
          invoke: {
            src: ctx => new Promise(
              (res, rej) => {
                const { db } = ctx
                const table = db.transaction(
                  ["entity"],
                  "readwrite"
                ).objectStore("entity")
                const t = Date.now()
                const rq = table.add({
                  name: "",
                  path: "/",
                  isLeaf: false,
                  parentPath: null,
                  createdAt: t,
                  updatedAt: t
                })
                rq.onsuccess = () => {
                  res()
                }
                rq.onerror = e => {
                  const name = e.target.error.name
                  if (name === "ConstraintError") {
                    res()
                  } else {
                    rej(name)
                  }
                }
              }
            ),
            onDone: {
              target: "done",
              actions: []
            },
            onError: {
              target: "idle",
              actions: [
                log(
                  "Attempt to conditionally seed root directory / failed and it was not a unique constraint violation."
                ),
                log(
                  (_, e) => e.toString()
                )
              ]
            }
          }
        },
        done: {
          type: "final"
        }
      },
      onDone: "initialized"
    },
    initialized: {
      type: "parallel",
      states: {
        lockTablePruner: {
          initial: "idle",
          states: {
            idle: {
              on: {
                pruneExpiredLocks: "pruning"
              }
            },
            pruning: {
              invoke: {
                src: (
                  {
                    db
                  }
                ) => pruneExpiredLocks(
                  db
                ),
                onDone: "idle",
                onError: "idle"
              }
            },
            done: {
              type: "final"
            }
          },
          on: {
            stopLockPruningService: ".done"
          }
        },
        operator: {
          initial: "awaitingCommand",
          states: {
            awaitingCommand: {
              entry: [
                raise(
                  "pruneExpiredLocks"
                ),
                sendParent(
                  "vzfsAwaitingCommand"
                ),
              ],
              on: {
                close: "close",
                changeDirectory: "changeDirectory",
                createFile: "createFile",
                readFile: "readFile",
                updateFileTimestamp: "updateFileTimestamp",
                updateFileContent: "updateFileContent",
                deleteFile: "deleteFile",
                createDirectory: "createDirectory",
                getDirectoryRecord: "getDirectoryRecord",
                emptyDirectory: "emptyDirectory",
                deleteDirectoryIfEmpty: "deleteDirectoryIfEmpty",
                ripFilesystemToJSON: "ripFilesystemToJSON",
              }
            },
            changeDirectory: {
              invoke: {
                src: (ctx, evt) => {
                  const {
                    db,
                    cwd
                  } = ctx
                  const {
                    newDirectoryPath
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        try {
                          const entity = await getEntity(
                            db,
                            cwd,
                            newDirectoryPath
                          )
                          if (entity.isLeaf) rej(
                            `Cannot change directory to a leaf.`
                          );
                          res(
                            entity.path
                          )
                        } catch (e) {
                          rej(
                            e
                          )
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: [
                    assign((ctx, evt) => ({
                      ...ctx,
                      cwd: evt.data
                    })),
                    sendParent({
                      type: "changeDirectorySuccess",
                      cwd: ctx=> ctx.cwd
                    })
                  ]
                },
                onError: {
                  target: "awaitingCommand",
                  actions: [
                    sendParent((_, evt) => ({
                      type: "changeDirectoryFailure",
                      msg: evt.data
                    }))
                  ]
                }
              }
            },
            createFile: {
              invoke: {
                src: (ctx, evt) => {
                  const {
                    db,
                    cwd
                  } = ctx
                  const {
                    name,
                    parentPath,
                    content
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockPath, parent
                        try {
                          parent = await getEntity(
                            db,
                            cwd,
                            parentPath
                          )
                          newLockPath = await lockPath(
                            db,
                            cwd,
                            parent.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            cwd,
                            [newLockPath]
                          )
                        } catch (e) {
                          rej(e)
                        }
                        try {
                          const newFilePath = await addFileEntity(
                            db,
                            cwd,
                            name,
                            parent.path,
                            content
                          )
                          res(newFilePath)
                        } catch (e) {
                          rej(e)
                        } finally {
                          try {
                            await removeLock(
                              db,
                              newLockPath
                            )
                          } catch (e) {
                            
                          }
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: [
                    raise("pruneExpiredLocks"),
                    sendParent((_, evt) => ({
                      type: "createFileSuccess",
                      newFilePath: evt.data.leafPath
                    }))
                  ]
                },
                onError: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "createFileFailure",
                    msg: evt.data
                  }))
                }
              }
            },
            readFile: {
              invoke: {
                src: (ctx, evt) => {
                  const {
                    db,
                    cwd
                  } = ctx
                  const {
                    path
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockPath
                        try {
                          const entity = await getEntity(
                            db,
                            cwd,
                            path
                          )
                          newLockPath = await lockPath(
                            db,
                            cwd,
                            entity.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            cwd,
                            [newLockPath]
                          )
                          if (entity.isLeaf) {
                            const fullFile = await joinContentToLeaf(
                              db,
                              entity
                            )
                            res(fullFile)
                          } else {
                            rej(
                              `Cannot read a directory. Path: ${
                                entity.path
                              }`
                            )
                          }
                        } catch (e) {
                          rej(e)
                        } finally {
                          try {
                            if (newLockPath) await removeLock(
                              db,
                              newLockPath
                            );
                          } catch (e) { }
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "readFileSuccess",
                    file: evt.data
                  }))
                },
                onError: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "readFileFailure",
                    msg: evt.data
                  }))
                }
              }
            },
            updateFileTimestamp: {
              invoke: {
                src: (ctx, evt) => {
                  const {
                    db,
                    cwd
                  } = ctx
                  const {
                    path
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockPath
                        try {
                          const e = await getEntity(
                            db,
                            cwd,
                            path
                          )
                          newLockPath = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            cwd,
                            [newLockPath]
                          )
                          res(await updateFileTimestamp(
                            db,
                            cwd,
                            e.path
                          ))
                        } catch (e) {
                          rej(e)
                        } finally {
                          try {
                            await removeLock(
                              db,
                              newLockPath
                            )
                          } catch (e) { }
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: [
                    sendParent((_, evt) => ({
                      type: "updateFileTimestampSuccess",
                      filesTouched: evt.data
                    }))
                  ]
                },
                onError: {
                  target: "awaitingCommand",
                  actions: [
                    sendParent((_, evt) => ({
                      type: "updateFileTimestampFailure",
                      msg: evt.data
                    }))
                  ]
                }
              }
            },
            updateFileContent: {
              invoke: {
                src: (ctx, evt) => {
                  const {
                    db,
                    cwd
                  } = ctx
                  const {
                    path,
                    content
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockPath
                        try {
                          const e = await getEntity(
                            db,
                            cwd,
                            path
                          )
                          newLockPath = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            cwd,
                            [newLockPath]
                          )
                          const u = await updateFile(
                            db,
                            cwd,
                            e.path,
                            content
                          )
                          console.log(
                            `u: ${
                              JSON.stringify(u)
                            }`
                          )
                          res(u)
                        } catch (e) {
                          console.log(e)
                          rej(e)
                        } finally {
                          try {
                            await removeLock(
                              db,
                              newLockPath
                            )
                          } catch (e) { }
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "updateFileSuccess",
                    filesTouched: evt.data
                  }))
                },
                onError: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "updateFileFailure",
                    msg: evt.data
                  }))
                }
              }
            },
            deleteFile: {
              invoke: {
                src: (ctx, evt) => {
                  const {
                    db,
                    cwd
                  } = ctx
                  const {
                    path
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockPath
                        try {
                          const e = await getEntity(
                            db,
                            cwd,
                            path
                          )
                          newLockPath = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            cwd,
                            [newLockPath]
                          )
                          res(await deleteLeafEntity(
                            db,
                            cwd,
                            e.path
                          ))
                        } catch (e) {
                          rej(e)
                        } finally {
                          try {
                            await removeLock(
                              db,
                              newLockPath
                            )
                          } catch (e) { }
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "deleteFileSuccess"
                  })),
                },
                onError: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "deleteFileFailure",
                    msg: evt.data
                  }))
                }
              }
            },
            createDirectory: {
              invoke: {
                src: (ctx, evt) => {
                  const {
                    db,
                    cwd
                  } = ctx
                  const {
                    name,
                    parentPath
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockPath
                        try {
                          const e = await getEntity(
                            db,
                            cwd,
                            parentPath
                          )
                          console.log(`e ${
                            JSON.stringify(
                              e
                            )
                          }`)
                          newLockPath = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            cwd,
                            [newLockPath]
                          )
                          res(await addDirectoryEntity(
                            db,
                            cwd,
                            name,
                            e.path
                          ))
                        } catch (e) {
                          console.log(e)
                          rej(e)
                        } finally {
                          try {
                            await removeLock(
                              db,
                              newLockPath
                            )
                          } catch (e) { }
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: [
                    sendParent((_, evt) => ({
                      type: "createDirectorySuccess"
                    }))
                  ],
                },
                onError: {
                  target: "awaitingCommand",
                  actions: [
                    sendParent((_, evt) => ({
                      type: "createDirectoryFailure",
                      msg: evt.data
                    }))
                  ]
                }
              }
            },
            getDirectoryRecord: {
              invoke: {
                src: (ctx, evt) => {
                  const {
                    db,
                    cwd
                  } = ctx
                  if(
                    typeof evt.data === "undefined"
                  ){
                    return new Promise(
                      r => r(
                        {
                          childKeys: [],
                          cwd: cwd
                        }
                      )
                    )
                  }
                  const {
                    path
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockPath
                        try {
                          const entity = await getEntity(
                            db,
                            cwd,
                            path
                          )
                          newLockPath = await lockPath(
                            db,
                            cwd,
                            entity.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            cwd,
                            [newLockPath]
                          )
                          if (entity.isLeaf) {
                            rej(
                              `Cannot get directory record for leaf entity: ${
                                entity.path
                              }`
                            )
                          } else {
                            const childKeys = await getImmediateChildKeysOfDirectory(
                              db,
                              cwd,
                              entity.path
                            ) // throws
                            res(
                              {
                                entity,
                                childKeys
                              }
                            )
                          }
                        } catch (e) {
                          console.log(e.toString())
                          rej(e)
                        } finally {
                          try {
                            if (newLockPath) await removeLock(
                              db,
                              newLockPath
                            );
                          } catch (e) { }
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "getDirectoryRecordSuccess",
                    data: evt.data
                  })),
                },
                onError: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "getDirectoryRecordFailure",
                    msg: evt.data
                  }))
                }
              }
            },
            emptyDirectory: {
              invoke: {
                src: (ctx, evt) => {
                  const {
                    db,
                    cwd
                  } = ctx
                  const {
                    path
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockPath
                        try {
                          const entity = await getEntity(
                            db,
                            cwd,
                            path
                          )
                          newLockPath = await lockPath(
                            db,
                            cwd,
                            entity.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            cwd,
                            [newLockPath]
                          )
                          if (entity.isLeaf) {
                            rej(
                              `Cannot call empty directory for leaf entity: ${
                                entity.path
                              }`
                            )
                          } else {
                            await emptyDirectory(
                              db,
                              cwd,
                              entity.path
                            )
                            res()
                          }
                        } catch (e) {
                          rej(e)
                        } finally {
                          try {
                            if (newLockPath) await removeLock(
                              db,
                              newLockPath
                            );
                          } catch (e) { }
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "emptyDirectorySuccess"
                  })),
                },
                onError: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "emptyDirectoryFailure",
                    msg: evt.data
                  }))
                }
              }
            },
            deleteDirectoryIfEmpty: {
              invoke: {
                src: (ctx, evt) => {
                  const {
                    db,
                    cwd
                  } = ctx
                  const {
                    path
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockPath
                        try {
                          const e = await getEntity(
                            db,
                            cwd,
                            path
                          )
                          newLockPath = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            cwd,
                            [newLockPath]
                          )
                          res(await deleteDirectoryIfEmpty(
                            db,
                            cwd,
                            e.path
                          ))
                        } catch (e) {
                          rej(e)
                        } finally {
                          try {
                            await removeLock(
                              db,
                              cwd,
                              newLockPath
                            )
                          } catch (e) { }
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "deleteDirectoryIfEmptySuccess"
                  })),
                },
                onError: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "deleteDirectoryIfEmptyFailure",
                    msg: evt.data
                  }))
                }
              }
            },
            ripFilesystemToJSON: {
              invoke: {
                src: (ctx, evt) => Promise.all(
                  [
                    new Promise(
                      (res, rej) => {
                        const {
                          db
                        } = ctx
                        const entityTable = db
                          .transaction(
                            "entity",
                            "readonly"
                          ).objectStore(
                            "entity"
                          )
                        const rq = entityTable
                          .getAll()
                        rq.onsuccess = () => {
                          res(rq.result)
                        }
                        rq.onerror = () => {
                          rej(
                            "Could not getAll entity records"
                          )
                        }
                      }
                    ),
                    new Promise(
                      (res, rej) => {
                        const {
                          db
                        } = ctx
                        const entityTable = db
                          .transaction(
                            "content",
                            "readonly"
                          ).objectStore(
                            "content"
                          )
                        const rq = entityTable
                          .getAll()
                        rq.onsuccess = () => {
                          res(rq.result)
                        }
                        rq.onerror = () => {
                          rej(
                            "Could not getAll content records"
                          )
                        }
                      }
                    ),
                    new Promise(
                      (res, rej) => {
                        const {
                          db
                        } = ctx
                        const entityTable = db
                          .transaction(
                            "lock",
                            "readonly"
                          ).objectStore(
                            "lock"
                          )
                        const rq = entityTable
                          .getAll()
                        rq.onsuccess = () => {
                          res(rq.result)
                        }
                        rq.onerror = () => {
                          rej(
                            "Could not getAll lock records"
                          )
                        }
                      }
                    )
                  ]
                ),
                onDone: {
                  target: "awaitingCommand",
                  actions: [
                    log((_, evt) => evt),
                    sendParent((_, evt) => ({
                      type: "ripFilesystemToJSONSuccess",
                      backup: JSON.stringify({
                        entity: evt.data[0],
                        content: evt.data[1],
                        lock: evt.data[2]
                      })
                    }))
                  ],
                },
                onError: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "ripFilesystemToJSONFailure",
                    msg: evt.data
                  }))
                }
              }
            },
            close: {
              type: "final",
              entry: [
                raise(
                  "stopLockPruningService"
                ),
                assign(ctx => {
                  ctx.db.close()
                  return {
                    ...ctx,
                    db: null
                  }
                })
              ]
            },
          }
        },
      },
      onDone: {
        target: "uninitialized",
        actions: assign(ctx => ({
          ...ctx,
          fsName: null
        }))
      }
    }
  }
})

export default storageHierarchy