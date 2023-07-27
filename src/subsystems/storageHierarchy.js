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
import { createMachine, actions, send, sendParent } from "xstate"
import { normalize, absPathToPieces } from  "../utils/path.js"
import {
  lockPath,
  removeLockById,
  getLockById,
  entityWithIdExists,
  entityWithPathExists,
  joinContentToLeaf,
  insertContentRecord,
  updateContentRecordByLeafId,
  deleteContentRecordByLeafId,
  getEntityById,
  getEntityByPath,
  getEntitiesByPathPrefix,
  getImmediateChildKeysOfDirectory,
  rejectIfConflictingLockPathPrefixes,
  addFileEntity,
  addDirectoryEntity,
  deleteEntityById,
  deleteLeafEntity,
  deleteDirectoryIfEmpty,
  emptyDirectory,
  updateFileEntity,
  updateFileEntityTimestamp,
  renameFileEntity,
  reparentLeafEntity,
  transplantAncestors,
  pruneExpiredLocks
} from "../promises/IDB.js"

const { assign, log } = actions

const storageHierarchy = createMachine({
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
          entry: log(),
          on: {
            init: {
              target: "initializing",
              cond: (_, evt) => typeof evt.filesystemName === "string",
              actions: assign((ctx, evt) => ({
                ...ctx,
                fsName: evt.filesystemName
              }))
            }
          }
        },
        // other states in between here for, e.g., listing or dropping filesystems?
        initializing: {
          invoke: {
            src: ctx => new Promise(
              (res, rej) => {
                const req = indexedDB.open(ctx.fsName, version)
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
                    "entity", { 
                      autoIncrement: true 
                    }
                  )
                  entity.createIndex("name", "name")
                  entity.createIndex("parentId", "parentId")
                  entity.createIndex("createdAt", "createdAt")
                  entity.createIndex("updatedAt", "updatedAt")
                  entity.createIndex(
                    "path", 
                    "path", {
                      unique: true
                    }
                  )
                  entity.createIndex(
                    "uniqueParentChild", [
                      "parentId", 
                      "name"
                    ], {
                      unique: true
                    }
                  )
                  const lock = db.createObjectStore(
                    "lock", {
                      autoIncrement: true
                    }
                  )
                  lock.createIndex(
                    "pathPrefix", 
                    "pathPrefix", {
                      unique: true
                    }
                  )
                  lock.createIndex("expiry", "expiry")
                  lock.createIndex("createdAt", "createdAt")
                  const content = db.createObjectStore(
                    "content", {
                      autoIncrement: true
                    }
                  )
                  content.createIndex(
                    "leafId", 
                    "leafId", {
                      unique: true
                    }
                  )
                }
              }
            ),
            onDone: {
              target: "seeding",
              actions: assign((ctx, evt) => ({
                ...ctx,
                db: evt.data
              }))
            },
            onError: {
              target: "idle",
              actions: log(
                "Failed to initialize filesystem."
              )
            }
          }
        },
        seeding: {
          invoke: {
            src: ctx => new Promise(
              (res, rej) => {
                const { db } = ctx
                const table = db.transaction(
                  "entity",
                  "readwrite"
                ).objectStore("entity")
                const t = Date.now()
                const rq = table.add({
                  name: "",
                  path: "/",
                  isLeaf: false,
                  parentId: null,
                  createdAt: t,
                  updatedAt: t
                })
                rq.onsuccess = () => {
                  res()
                }
                rq.onerror = ({ name }) => {
                  if(name === "ConstraintError") {
                    res()
                  } else {
                    rej()
                  }
                }
              }
            ),
            onDone: {
              target: "done"
            },
            onError: {
              target: "idle",
              actions: log(
                "Attempt to conditionally seed root directory / failed and it was not a unique constraint violation."
              )
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
              on: {
                close: "close",
                createFile: "createFile",
                readFileById: "readFileById",
                readFileByPath: "readFileByPath",
                renameFileById: "renameFileById",
                renameFileByPath: "renameFileByPath",
                // TODO - add rest of these 
              }
            },
            changeDirectoryById: {
              invoke: {
                src: (ctx, evt) => {
                  const { 
                    db,
                    cwd
                  } = ctx
                  const {
                    newDirectoryId
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        try {
                          const entity = await getEntityById(
                            db,
                            newDirectoryId
                          )
                          if(entity.isLeaf) rej(
                            `Cannot change directory to a leaf.`
                          );
                          res(entity.path)
                        } catch(e) {
                          rej(e)
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
                    sendParent(
                      "changeDirectorySuccess"
                    )
                  ]
                },
                onError: {
                  target: "awaitingCommand",
                  actions: [
                    sendParent(
                      "changeDirectoryFailure"
                    )
                  ]
                }
              }
            },
            changeDirectoryByPath: {
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
                          const entity = await getEntityByPath(
                            db,
                            newDirectoryPath
                          )
                          if(entity.isLeaf) rej(
                            `Cannot change directory to a leaf.`
                          );
                          res(entity.path)
                        } catch(e) {
                          rej(e)
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
                    sendParent(
                      "changeDirectorySuccess"
                    )
                  ]
                },
                onError: {
                  target: "awaitingCommand",
                  actions: [
                    sendParent(
                      "changeDirectoryFailure"
                    )
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
                    parentId,
                    content
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockId
                        try {
                          const parent = await getEntityById(
                            db,
                            parentId
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            parent.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                        } catch(e) {
                          rej(e)
                        }
                        try {
                          const newFileId = await addFileEntity(
                            db,
                            cwd,
                            name,
                            parent.id,
                            content
                          )
                          res(newFileId)
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "createFileSuccess",
                    newFileId: evt.data
                  }))
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
            readFileById: {
              invoke: {
                src: (ctx, evt) => {
                  const { 
                    db,
                    cwd
                  } = ctx
                  const {
                    id
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockId
                        try {
                          const entity = await getEntityById(
                            db,
                            id
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            entity.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          if(entity.isLeaf){
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
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            if(newLockId) await removeLockById(
                              db,
                              newLockId
                            );
                          } catch(e) {}
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
            readFileByPath: {
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
                        let newLockId
                        try {
                          const entity = await getEntityByPath(
                            db,
                            cwd,
                            path
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            entity.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          if(entity.isLeaf){
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
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            if(newLockId) await removeLockById(
                              db,
                              newLockId
                            );
                          } catch(e) {}
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
            renameFileById: {
              invoke: {
                src: (ctx, evt) => {
                  const { 
                    db,
                    cwd
                  } = ctx
                  const {
                    id,
                    newName
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockId
                        try {
                          const e = await getEntityById(
                            db,
                            id
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          res(await renameFileEntity(
                            db,
                            cwd,
                            e.id,
                            newName
                          ))
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: [
                    sendParent((_, evt) => ({
                      type: "renameFileSuccess",
                      filesRenamed: evt.data
                    }))
                  ]
                },
                onError: {
                  target: "awaitingCommand",
                  actions: [
                    sendParent((_, evt) => ({
                      type: "renameFileFailure",
                      msg: evt.data
                    }))
                  ]
                }
              }
            },
            renameFileByPath: {
              invoke: {
                src: (ctx, evt) => {
                  const { 
                    db,
                    cwd
                  } = ctx
                  const {
                    path,
                    newName
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockId
                        try {
                          const e = await getEntityByPath(
                            db,
                            cwd,
                            path
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          res(await renameFileEntity(
                            db,
                            cwd,
                            e.id,
                            newName
                          ))
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: [
                    sendParent((_, evt) => ({
                      type: "renameFileSuccess",
                      filesRenamed: evt.data
                    }))
                  ]
                },
                onError: {
                  target: "awaitingCommand",
                  actions: [
                    sendParent((_, evt) => ({
                      type: "renameFileFailure",
                      msg: evt.data
                    }))
                  ]
                }
              }
            },
            updateFileTimestampById: {
              invoke: {
                src: (ctx, evt) => {
                  const { 
                    db,
                    cwd
                  } = ctx
                  const {
                    id
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockId
                        try {
                          const e = await getEntityById(
                            db,
                            id
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          res(await updateFileEntityTimestamp(
                            db,
                            e.id
                          ))
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
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
            updateFileTimestampByPath: {
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
                        let newLockId
                        try {
                          const e = await getEntityByPath(
                            db,
                            cwd,
                            path
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          res(await updateFileEntityTimestamp(
                            db,
                            e.id
                          ))
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
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
            updateFileContentById: {
              invoke: {
                src: (ctx, evt) => {
                  const { 
                    db,
                    cwd
                  } = ctx
                  const {
                    id,
                    content
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockId
                        try {
                          const e = await getEntityById(
                            db,
                            id
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          res(await updateFileEntity(
                            db,
                            e.id,
                            content
                          ))
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
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
            updateFileContentByPath: {
              invoke: {
                src: (ctx, evt) => {
                  const { 
                    db,
                    cwd
                  } = ctx
                  const {
                    id,
                    path,
                    content
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockId
                        try {
                          const e = await getEntityByPath(
                            db,
                            cwd,
                            path
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          res(await updateFileEntity(
                            db,
                            e.id,
                            content
                          ))
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
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
            reparentFileById: {
              invoke: {
                src: (ctx, evt) => {
                  const { 
                    db,
                    cwd
                  } = ctx
                  const {
                    id,
                    newParentId
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockId
                        try {
                          const e = await getEntityById(
                            db,
                            id
                          )
                          // also get target patho
                          const t = await getEntityById(
                            db,
                            newParentId
                          )
                          // calculate greatest common prefix of old and new path
                          const prefixChars = []
                          for(var i = 0; i < Math.min(e.path.length, t.path.length); i++){
                            if(e.path[i] !== t.path[i]){
                              break
                            }
                            prefixChars.push(e.path[i])
                          }
                          const gcp = prefixChars.join("")
                          newLockId = await lockPath(
                            db,
                            cwd,
                            gcp,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          res(await updateFileEntity(
                            db,
                            e.id,
                            content
                          ))
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
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
            reparentFileByPath: {
              invoke: {
                src: (ctx, evt) => {
                  const { 
                    db,
                    cwd
                  } = ctx
                  const {
                    path,
                    newParentPath
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockId
                        try {
                          const e = await getEntityByPath(
                            db,
                            cwd,
                            path
                          )
                          // also get target patho
                          const t = await getEntityByPath(
                            db,
                            newParentPath
                          )
                          // calculate greatest common prefix of old and new path
                          const prefixChars = []
                          for(var i = 0; i < Math.min(e.path.length, t.path.length); i++){
                            if(e.path[i] !== t.path[i]){
                              break
                            }
                            prefixChars.push(e.path[i])
                          }
                          const gcp = prefixChars.join("")
                          newLockId = await lockPath(
                            db,
                            cwd,
                            gcp,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          res(await updateFileEntity(
                            db,
                            e.id,
                            content
                          ))
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
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
            deleteFileById: {
              invoke: {
                src: (ctx, evt) => {
                  const { 
                    db,
                    cwd
                  } = ctx
                  const {
                    id
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockId
                        try {
                          const e = await getEntityById(
                            db,
                            id
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          res(await deleteLeafEntity(
                            db,
                            e.id
                          ))
                        } catch(e){
                          rej(e)
                        } finally{
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
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
            deleteFileByPath: {
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
                        let newLockId
                        try {
                          const e = await getEntityByPath(
                            db,
                            cwd,
                            path
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          res(await deleteLeafEntity(
                            db,
                            e.id
                          ))
                        } catch(e){
                          rej(e)
                        } finally{
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
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
            createDirectoryUnderId: {
              invoke: {
                src: (ctx, evt) => {
                  const { 
                    db,
                    cwd
                  } = ctx
                  const {
                    name,
                    parentId
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockId
                        try {
                          const e = await getEntityById(
                            db,
                            parentId
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          res(await addDirectoryEntity(
                            db,
                            cwd,
                            name,
                            e.id
                          ))
                        } catch(e){
                          rej(e)
                        } finally{
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "createDirectorySuccess"
                  })),
                },
                onError: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "createDirectoryFailure",
                    msg: evt.data
                  }))
                }
              }
            },
            createDirectoryUnderPath: {
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
                        let newLockId
                        try {
                          const e = await getEntityByPath(
                            db,
                            cwd,
                            parentPath
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          res(await addDirectoryEntity(
                            db,
                            cwd,
                            name,
                            e.id
                          ))
                        } catch(e){
                          rej(e)
                        } finally{
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "createDirectorySuccess"
                  })),
                },
                onError: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "createDirectoryFailure",
                    msg: evt.data
                  }))
                }
              }
            },
            getDirectoryRecordById: {
              invoke: {
                src: (ctx, evt) => {
                  const { 
                    db,
                    cwd
                  } = ctx
                  const {
                    id
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockId
                        try {
                          const entity = await getEntityById(
                            db,
                            id
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            entity.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          if(entity.isLeaf){
                            rej(
                              `Cannot get directory record for leaf entity: ${
                                entity.path
                              }`
                            )
                          } else {
                            const childKeys = await getImmediateChildKeysOfDirectory(
                              db,
                              cwd,
                              id
                            )
                            res(
                              {
                                entity,
                                childKeys
                              }
                            )
                          }
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            if(newLockId) await removeLockById(
                              db,
                              newLockId
                            );
                          } catch(e) {}
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "readDirectoryRecordSuccess",
                    data: evt.data
                  })),
                },
                onError: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "readDirectoryRecordFailure",
                    msg: evt.data
                  }))
                }
              }
            },
            getDirectoryRecordByPath: {
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
                        let newLockId
                        try {
                          const entity = await getEntityByPath(
                            db,
                            cwd,
                            path
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            entity.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          if(entity.isLeaf){
                            rej(
                              `Cannot get directory record for leaf entity: ${
                                entity.path
                              }`
                            )
                          } else {
                            const childKeys = await getImmediateChildKeysOfDirectory(
                              db,
                              cwd,
                              id
                            )
                            res(
                              {
                                entity,
                                childKeys
                              }
                            )
                          }
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            if(newLockId) await removeLockById(
                              db,
                              newLockId
                            );
                          } catch(e) {}
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "readDirectoryRecordSuccess",
                    data: evt.data
                  })),
                },
                onError: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "readDirectoryRecordFailure",
                    msg: evt.data
                  }))
                }
              }
            },
            emptyDirectoryById: {
              invoke: {
                src: (ctx, evt) => {
                  const { 
                    db,
                    cwd
                  } = ctx
                  const {
                    id
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockId
                        try {
                          const entity = await getEntityById(
                            db,
                            id
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            entity.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          if(entity.isLeaf){
                            rej(
                              `Cannot call empty directory for leaf entity: ${
                                entity.path
                              }`
                            )
                          } else {
                            await emptyDirectory(
                              db,
                              id
                            )
                            res()
                          }
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            if(newLockId) await removeLockById(
                              db,
                              newLockId
                            );
                          } catch(e) {}
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
            emptyDirectoryByPath: {
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
                        let newLockId
                        try {
                          const entity = await getEntityByPath(
                            db,
                            cwd,
                            path
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            entity.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          if(entity.isLeaf){
                            rej(
                              `Cannot call empty directory for leaf entity: ${
                                entity.path
                              }`
                            )
                          } else {
                            await emptyDirectory(
                              db,
                              id
                            )
                            res()
                          }
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            if(newLockId) await removeLockById(
                              db,
                              newLockId
                            );
                          } catch(e) {}
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
            deleteDirectoryIfEmptyById: {
              invoke: {
                src: (ctx, evt) => {
                  const { 
                    db,
                    cwd
                  } = ctx
                  const {
                    id
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockId
                        try {
                          const e = await getEntityById(
                            db,
                            id
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          res(await deleteDirectoryIfEmpty(
                            db,
                            e.id
                          ))
                        } catch(e){
                          rej(e)
                        } finally{
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "deleteDirectorySuccess"
                  })),
                },
                onError: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "deleteDirectoryFailure",
                    msg: evt.data
                  }))
                }
              }
            },
            deleteDirectoryIfEmptyByPath: {
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
                        let newLockId
                        try {
                          const e = await getEntityByPath(
                            db,
                            cwd,
                            path
                          )
                          newLockId = await lockPath(
                            db,
                            cwd,
                            e.path,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          res(await deleteDirectoryIfEmpty(
                            db,
                            e.id
                          ))
                        } catch(e){
                          rej(e)
                        } finally{
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
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
            transplantAncestorsById: {
              invoke: {
                src: (ctx, evt) => {
                  const { 
                    db,
                    cwd
                  } = ctx
                  const {
                    oldParentId,
                    newParentId
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockId
                        try {
                          const e = await getEntityById(
                            db,
                            oldParentId
                          )
                          // also get target path
                          const t = await getEntityById(
                            db,
                            newParentId
                          )
                          // calculate greatest common prefix of old and new path
                          const prefixChars = []
                          for(var i = 0; i < Math.min(e.path.length, t.path.length); i++){
                            if(e.path[i] !== t.path[i]){
                              break
                            }
                            prefixChars.push(e.path[i])
                          }
                          const gcp = prefixChars.join("")
                          newLockId = await lockPath(
                            db,
                            cwd,
                            gcp,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          res(await transplantAncestors(
                            db,
                            e.id,
                            t.id
                          ))
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "transplantAncestorsSuccess",
                    msg: evt.data
                  }))
                },
                onError: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "transplantAncestorsFailure",
                    msg: evt.data
                  }))
                }
              }
            },
            transplantAncestorsByPath: {
              invoke: {
                src: (ctx, evt) => {
                  const { 
                    db,
                    cwd
                  } = ctx
                  const {
                    oldParentPath,
                    newParentPath
                  } = evt.data
                  return new Promise(
                    (res, rej) => {
                      (async () => {
                        let newLockId
                        try {
                          const e = await getEntityByPath(
                            db,
                            cwd,
                            oldParentPath
                          )
                          // also get target path
                          const t = await getEntityByPath(
                            db,
                            cwd,
                            newParentPath
                          )
                          // calculate greatest common prefix of old and new path
                          const prefixChars = []
                          for(var i = 0; i < Math.min(e.path.length, t.path.length); i++){
                            if(e.path[i] !== t.path[i]){
                              break
                            }
                            prefixChars.push(e.path[i])
                          }
                          const gcp = prefixChars.join("")
                          newLockId = await lockPath(
                            db,
                            cwd,
                            gcp,
                            typeof evt.durationMs === "number" && evt.durationMs > 0 ? evt.durationMs : 5000
                          )
                          await rejectIfConflictingLockPathPrefixes(
                            db,
                            [newLockId]
                          )
                          res(await transplantAncestors(
                            db,
                            e.id,
                            t.id
                          ))
                        } catch(e) {
                          rej(e)
                        } finally {
                          try {
                            await removeLockById(
                              db,
                              newLockId
                            )
                          } catch(e) {}
                        }
                      })()
                    }
                  )
                },
                onDone: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "transplantAncestorsSuccess",
                    msg: evt.data
                  }))
                },
                onError: {
                  target: "awaitingCommand",
                  actions: sendParent((_, evt) => ({
                    type: "transplantAncestorsFailure",
                    msg: evt.data
                  }))
                }
              }
            },
            close: {
              type: "final",
              entry: [
                send(
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