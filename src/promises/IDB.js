import { normalize, absPathToPieces } from  "../utils/path.js"

/*
Legend:
- indexed field
- <unindexed field>

Entity
------
- id
- name
- path
- isLeaf
- parentId
- createdAt
- updatedAt

Content
-------
- id
- leafId
- <body>

Lock
----
- id
- expiry
- pathPrefix
- createdAt
*/

function lockPath(
  db, 
  cwd, 
  path, 
  durationMs 
){
  const n = normalize(
    path, 
    absPathToPieces(
      cwd
    )
  )
  return new Promise(
    (res, rej) => {
      const table = db
        .transaction(
          "lock",
          "readwrite"
        ).objectStore(
          "lock"
        )
      const time = Date.now()
      const rq = table.add({
        pathPrefix: n,
        expiry: time + durationMs,
        createdAt: time
      })
      rq.onsuccess = e => {
        res(
          e.target.result
        )
      }
      rq.onerror = () => {
        rej(
          `Could not acquire lock for path prefix ${
            n
          }`
        )
      }
    }
  )
}

function removeLockById(
  db, 
  id
){
  return new Promise(
    ir => {
      const lockTable = db
        .transaction(
          "lock",
          "readwrite"
        ).objectStore(
          "lock"
        )
      const rq = lockTable
        .delete(
          id
        )
      rq.onsuccess = () => {
        ir(1)
      }
      rq.onerror = () => {
        ir(0)
      }
    }
  )
}

function getLockById(
  db,
  id
){
  return new Promise(
    (res, rej) => {
      const lockTable = db
        .transaction(
          "lock",
          "readonly"
        ).objectStore("lock")
      const rq = lockTable
        .get(
          id
        )
      rq.onsuccess = e => {
        if(e.target.result) res(
          e.target.result
        );
        else rej(
          `Could not find lock with id ${
            id
          }`
        )
      }
      rq.onerror = () => {
        rej(
          `Could not get lock with id ${id}.`
        )
      }
    }
  )
}

function entityWithIdExists(
  db,
  id
){
  return new Promise(
    (res, rej) => {
      const entityTable = db
        .transaction(
          "entity",
          "readonly"
        ).objectStore(
          "entity"
        )
      const rq = entityTable
        .count(
          id
        )
      rq.onsuccess = e => {
        res(rq.result > 0)
      }
      rq.onerror = () => {
        rej(
          `Could not count entities with id ${id}.`
        )
      }
    }
  )
}

function entityWithPathExists(
  db,
  cwd,
  path
){
  const n = normalize(
    path,
    absPathToPieces(
      cwd
    )
  )
  return new Promise(
    (res, rej) => {
      const entityTable = db
        .transaction(
          "entity",
          "readonly"
        ).objectStore(
          "entity"
        )
      const pathIndex = entityTable
        .index(
          "path"
        )
      const rq = pathIndex
        .count(
          IDBKeyRange.only(n)
        )
      rq.onsuccess = e => {
        res(rq.result > 0)
      }
      rq.onerror = () => {
        rej(
          `Could not count entities with path ${
            n
          }`
        )
      }
    }
  )
}

function joinContentToLeaf(
  db,
  leaf
){
  return new Promise(
    (res, rej) => {
      const contentTable = db
        .transaction(
          "content",
          "readonly"
        ).objectStore(
          "content"
        )
      const leafIdIndex = contentTable
        .index(
          "leafId"
        )
      const rq = leafIdIndex
        .get(
          IDBKKeyRange.only(
            leaf.id
          )
        )
      rq.onsuccess = e => {
        res({
          ...leaf,
          content: e.target.result.body || null
        })
      }
      rq.onerror = () => {
        res({
          ...leaf,
          content: null
        })
      }
    }
  )
}

function getEntityById(
  db, 
  id 
){
  return new Promise(
    (res, rej) => {
      const entityTable = db
        .transaction(
          "entity",
          "readonly"
        ).objectStore("entity")
      const rq = entityTable
        .get(
          id
        );
      rq.onsuccess = e => {
        if(e.target.result) res(
          e.target.result
        );
        else rej(
          `Could not find entity with id ${
            id
          }`
        );
      }
      rq.onerror = () => {
        rej(
          `Could not get entity with id ${id}.`
        )
      }
    }
  )
}

function getEntityByPath(
  db, 
  cwd, 
  path 
){
  const n = normalize(path, absPathToPieces(cwd))
  return new Promise(
    (res, rej) => {
      const entityTable = db
        .transaction(
          "entity",
          "readonly"
        ).objectStore("entity")
      const pathIndex = entityTable
        .index("path")
      const rq = pathIndex
        .get(
          n
        )
      rq.onsuccess = e => {
        if(e.target.result) res(
          e.target.result
        );
        else rej(
          `Could not find entity with path ${
            n
          }`
        )
      }
      rq.onerror = () => {
        rej(
          `Could not get entity with path ${
            n
          }.`
        )
      }
    }
  )
}

function getEntitiesByPathPrefix(
  db, 
  cwd, 
  pathPrefix 
){
  const n = normalize(
    pathPrefix, 
    absPathToPieces(
      cwd
    )
  )
  return new Promise(
    (res, rej) => {
      const entityTable = db.transaction(
        "entity", 
        "readonly"
      ).objectStore(
        "entity"
      )
      const pathIndex = entityTable.index(
        "path"
      )
      const range = IDBKeyRange.bound(
        n, 
        n + '\uffff', 
        false, 
        false
      )
      const rq = pathIndex.getAll(
        range
      )
      rq.onsuccess = e => {
        const records = e
          .target
          .result
        if(records && records.length) res(
          records
        );
        else rej(
          `Could not find entities with path prefix ${
            n
          }`
        )
      }
      rq.onerror = e => {
        rej(
          e.target.error
        )
      }
    }
  )
}

/*function getImmediateChildrenOfDirectory(
  db, 
  cwd, 
  id
){
  return getEntityById(
    db,
    id
  ).then(
    directory => {
      if(directory.isLeaf) throw "Not a directory"
      return new Promise(
        (res, rej) => {
          const entityTable = db
            .transaction(
              "entity",
              "readonly"
            ).objectStore(
              "entity"
            )
          const parentIdIndex = entityTable
            .index(
              "parentId"
            )
          const rq = parentIdIndex
            .getAll(
              IDBKeyRange.only(
                directory.id
              )
            )
          rq.onsuccess = e => {
            res(
              e.target.result
            )
          }
          rq.onerror = () => {
            rej(
              `Could not get children of directory with id ${
                id
              }.`
            )
          }
        }
      )
    }
  )
}*/

function getImmediateChildKeysOfDirectory(
  db,
  cwd,
  id
){
  return getEntityById(
    db,
    id
  ).then(
    directory => {
      if(directory.isLeaf) throw "Not a directory"
      return new Promise(
        (res, rej) => {
          const entityTable = db
            .transaction(
              "entity",
              "readonly"
            ).objectStore(
              "entity"
            )
          const parentIdIndex = entityTable
            .index(
              "parentId"
            )
          const rq = parentIdIndex
            .getAllKeys(
              IDBKeyRange.only(
                directory.id
              )
            )
          rq.onsuccess = e => {
            res(
              e.target.result
            )
          }
          rq.onerror = () => {
            rej(
              `Could not get child keys of directory with id ${
                id
              }.`
            )
          }
        }
      )
    }
  )
}

/*
function countEntityByPathPrefix(db, cwd, pathPrefix){
  const n = normalize(pathPrefix, absPathToPieces(cwd))
  return new Promise(
    (res, rej) => {
      
    }
  )
}
*/

function insertContentRecord(
  db,
  leafId,
  content
){
  return new Promise(
    (res, rej) => {
      const contentTable = db
        .transaction(
          "content",
          "readwrite"
        ).objectStore(
          "content"
        )
      const rq = contentTable
        .put(
          content,
          leafId
        )
      rq.onsuccess = e => {
        res({
          contentId: e.target.result
        })
      }
      rq.onerror = () => {
        rej(
          `Could not insert content record for leaf with id ${
            leafId
          }.`
        )
      }
    }
  )
}

function updateContentRecordByLeafId(
  db,
  leafId,
  newContent
){
  return new Promise(
    (res, rej) => {
      const contentTable = db
        .transaction(
          "content",
          "readwrite"
        ).objectStore(
          "content"
        )
      const leafIdIndex = contentTable
        .index(
          "leafId"
        )
      const rq = leafIdIndex
        .openCursor(
          IDBKeyRange.only(
            leafId
          )
        )
      let contentUpdates = 0
      rq.onsuccess = e => {
        const cursor = e.target.result
        if(cursor) {
          contentUpdates += 1
          cursor.update(
            newContent
          )
          cursor.continue()
        } else {
          res({
            contentUpdates
          })
        }
      }
      rq.onerror = () => {
        rej(
          `Could not update content record for leaf with id ${
            leafId
          }.`
        )
      }
    }
  )
}

function deleteContentRecordByLeafId(
  db,
  leafId
){
  return new Promise(
    (res, rej) => {
      const contentTable = db
        .transaction(
          "content",
          "readwrite"
        ).objectStore(
          "content"
        )
      const leafIdIndex = contentTable
        .index(
          "leafId"
        )
      const rq = leafIdIndex
        .openCursor(
          IDBKeyRange.only(
            leafId
          )
        )
      let contentDeletes = 0
      rq.onsuccess = e => {
        const cursor = e.target.result
        if(cursor) {
          contentDeletes += 1
          cursor.delete()
          cursor.continue()
        } else {
          res({
            contentDeletes
          })
        }
      }
      rq.onerror = () => {
        rej(
          `Could not delete content record for leaf with id ${
            leafId
          }.`
        )
      }
    }
  )
}

function rejectIfConflictingLockPathPrefixes(
  db, 
  referenceLockIds, 
  unexpiredLocksOnly = true
){
  return Promise.all(
    referenceLockIds.map(
      l => getLockById(
        db,
        l
      )
    )
  ).then(
    results => new Promise(
      (res, rej) => {
        const ids = new Set(
          results.map(
            v => v.id
          )
        )
        const pathPrefixes = results
          .map(
            v => v.pathPrefix
          )
        const lockTable = db
          .transaction(
            "lock",
            "readonly"
          ).objectStore("lock")
        const expiryIndex = lockTable
          .index(
            "expiry"
          )
        const rq = unexpiredLocksOnly ? (
          expiryIndex
            .getAll(
              IDBKeyRange.lowerBound(
                Date.now()
              )
            )
        ) : (
          expiryIndex
            .getAll()
        )
        rq.onsuccess = e => {
          const locks = e
            .target
            .result
            .filter(
              l => !ids.has(l.id)
            )
          const conflicts = locks
            .reduce(
              (acc, cur) => {
                if(
                  pathPrefixes
                    .reduce(
                      (a, c) => {
                        if(
                          c.startsWith(
                            curr.pathPrefix
                          )
                        ){
                          return acc + 1
                        }
                        return acc
                      }, 0
                    )
                ){
                  return acc + 1
                }
                return acc
              }, 0
            )
          if(conflicts){
            rej(
              `Just acquired locks conflict with prefixes of ${
                conflicts
              } other locks. Considering only unexpired locks: ${
                unexpiredLocksOnly + ""
              }.`
            )
          } else {
            res(
              `No conflicting locks found. Considering only unexpired locks: ${
                unexpiredLocksOnly + ""
              }.`
            )
          }
        }
        rq.onerror = () => {
          rej(
            `Could not get comparison locks for conflict detection.`
          )
        }
      }
    )
  )
}

function addFileEntity(
  db, 
  cwd, 
  name, 
  parentId, 
  content // content dereferencing refactor
){
  return getEntityById(
    db,
    parentId
  ).then(
    parent => new Promise(
      (res, rej) => {
        if(parent.isLeaf) rej(
          `Cannot designate leaf entity as parent of another leaf entity.`
        );
        if(
          !/^[a-zA-Z0-9_.-]+$/.test(
            name
          )
        ) rej(
          `Invalid file name: ${
            name
          }. File names must be alphanumeric, dashes, dots, and underscores.`
        );
        const n = normalize(
          parent.path + name,
          absPathToPieces(
            cwd
          )
        );
        const time = Date.now()
        const entityTable = db
          .transaction(
            "entity",
            "readwrite"
          ).objectStore(
            "entity"
          );
        const rq = entityTable
          .add({
            path: n,
            isLeaf: true,
            parentId: parent.id,
            createdAt: time,
            updatedAt: time,
            name
          })
        rq.onsuccess = e => {
          res(
            e.target.result
          )
        }
        rq.onerror = () => {
          rej(
            `Could not add file entity with name ${
              name
            } to parent ${
              parent.path
            }.`
          )
        }
      }
    )
  ).then(
    leafId => insertContentRecord(
      db,
      leafId,
      content
    )
  )
}

function addDirectoryEntity(
  db, 
  cwd, 
  name, 
  parentId
){
  return getEntityById(
    db,
    parentId
  ).then(
    parent => new Promise(
      (res, rej) => {
        const n = normalize(
          parent.path + name,
          absPathToPieces(
            cwd
          )
        );
        const time = Date.now()
        const entityTable = db
          .transaction(
            "entity",
            "readwrite"
          ).objectStore(
            "entity"
          )
        const rq = entityTable
          .add({
            path: n,
            isLeaf: false,
            parentId: parent.id,
            createdAt: time,
            updatedAt: time,
            name
          })
        rq.onsuccess = e => {
          res(
            e.target.result
          )
        }
        rq.onerror = () => {
          rej(
            `Could not add directory entity with name ${
              name
            } to parent ${
              parent.path
            }.`
          )
        }
      }
    )
  )
}

function deleteEntityById(
  db, 
  id // content dereferencing refactor
){
  return new Promise(
    (res, rej) => {
      const entityTable = db
        .transaction(
          "entity",
          "readonly"
        ).objectStore("entity")
      const rq = entityTable
        .delete(
          id
        )
      rq.onsuccess = () => {
        res(
          id
        )
      }
      rq.onerror = () => {
        rej(
          `Could not delete entity with id ${id}; it may have already been deleted.`
        )
      }
    }
  )
}

function deleteLeafEntity(
  db, 
  id // content dereferencing refactor
){
  return getEntityById(
    db,
    id
  ).then(
    file => {
      if(!file.isLeaf) throw `Cannot delete non-leaf entity with id ${
        id
      }.`
      return deleteEntityById(
        db,
        id
      )
    }
  ).then(
    leafId => deleteContentRecordByLeafId(
      db,
      leafId
    )
  )
}

function deleteDirectoryIfEmpty(
  db, 
  id 
){
  return getEntityById(
    db,
    id
  ).then( 
    directory => new Promise(
      (res, rej) => {
        if(
          directory.isLeaf
        ) rej(
          `Cannot delete directory with id ${
            id
          } because it is a leaf.`
        );
        const entityTable = db
          .transaction(
            "entity",
            "readwrite"
          ).objectStore(
            "entity"
          )
        const parentIdIndex = entityTable
          .index(
            "parentId"
          )
        const rq = parentIdIndex
          .count(
            IDBKeyRange.only(
              id
            )
          )
        rq.onsuccess = () => {
          if(rq.result !== 0) rej(
            `Cannot delete directory with id ${
              id
            } because it is not empty.`
          );
          res(id);
        }
        rq.onerror = () => {
          rej(
            `Could not count number of children for directory with id ${
              id
            }.`
          )
        }
      }
    )
  ).then(
    id => deleteEntityById(
      db,
      id
    )
  )
}

function emptyDirectory(
  db, 
  id // content dereferencing refactor
){
  return getEntityById(
    db,
    id
  ).then(
    directory => new Promise(
      (res, rej) => {
        if(
          directory.isLeaf
        ) rej(
          `Cannot empty directory with id ${
            id
          } because it is a leaf.`
        );
        const entityTable = db
          .transaction(
            "entity",
            "readwrite"
          ).objectStore(
            "entity"
          )
        const parentIdIndex = entityTable
          .index(
            "parentId"
          )
        const rq = parentIdIndex
          .count(
            IDBKeyRange.only(
              id
            )
          )
        rq.onsuccess = () => {
          if(rq.result === 0) rej(
            `Cannot empty directory with id ${
              id
            } because it is already empty.`
          );
          res(directory.path);
        }
        rq.onerror = () => {
          rej(
            `Could not count number of children for directory with id ${
              id
            }.`
          )
        }
      }
    )
  ).then(
    pathPrefix => new Promise(
      (res, rej) => {
        const entityTable = db
          .transaction(
            "entity",
            "readwrite"
          ).objectStore(
            "entity"
          )
        const pathIndex = entityTable
          .index(
            "path"
          )
        const rq = pathIndex
          .openCursor(
            IDBKKeyRange.bound(
              pathPrefix,
              pathPrefix + '\uffff',
              true,
              false
            )
          )
        const deletedIds = []
        var deletions = 0
        rq.onsuccess = e => {
          const cursor = e.target.result
          if(cursor) {
            if(cursor.value.isLeaf) deletedIds.push(cursor.value.id)
            cursor.delete()
            deletions++
            cursor.continue() 
          } else {
            res(
              deletedIds
            )
          }
        }
        rq.onerror = () => {
          rej(
            `Could not empty directory with id ${
              id
            } and path ${
              pathPrefix
            }.`
          )
        }
      }
    )
  ).then(
    deletedIds => Promise.allSettled(
      deletedIds.map(
        v => deleteContentRecordByLeafId(
          db,
          v
        )
      )
    )
  )
}

function updateFileEntity(
  db, 
  id, 
  content // content dereferencing refactor
){
  return getEntityById(
    db,
    id
  ).then(
    file => new Promise(
      (res, rej) => {
        if(!file.isLeaf) rej(
          `Entity with id ${
            id
          } is not a leaf entity.`
        )
        const time = Date.now()
        const entityTable = db
          .transaction(
            "entity",
            "readwrite"
          ).objectStore(
            "entity"
          )
        const rq = entityTable
          .openCursor(
            IDBKeyRange.only(
              id
            )
          )
        const contentUpdateMapping = {}
        var updates = 0
        rq.onsuccess = e => {
          const cursor = e.target.result
          if(cursor) {
            const u = cursor.value
            u.updatedAt = time
            contentUpdateMapping[u.id] = content
            cursor.update(
              u
            )
            ++updates
            cursor.continue()
          } else {
            res(
              contentUpdateMapping
            )
          }
        }
        rq.onerror = () => {
          rej(
            `Could not update file entity with id ${
              id
            }.`
          )
        }
      }
    )
  ).then(
    contentUpdates => Promise.allSettled(
      Object.entries(contentUpdates).map(
        v => updateContentRecordByLeafId(
          db,
          v[0],
          v[1]
        )
      )
    )
  )
}

function updateFileEntityTimestamp(
  db, 
  id
){
  return getEntityById(
    db,
    id
  ).then(
    file => new Promise(
      (res, rej) => {
        if(!file.isLeaf) rej(
          `Entity with id ${
            id
          } is not a leaf entity.`
        )
        const time = Date.now()
        const entityTable = db
          .transaction(
            "entity",
            "readwrite"
          ).objectStore(
            "entity"
          )
        const rq = entityTable
          .openCursor(
            IDBKeyRange.only(
              id
            )
          )
        var updates = 0
        rq.onsuccess = e => {
          const cursor = e.target.result
          if(cursor) {
            const u = cursor.value
            u.updatedAt = time
            cursor.update(
              u
            )
            ++updates
            cursor.continue()
          } else {
            res(
              updates
            )
          }
        }
        rq.onerror = () => {
          rej(
            `Could not update file entity with id ${
              id
            }.`
          )
        }
      }
    )
  )
}

function renameFileEntity(
  db, 
  cwd,
  id, 
  newName
){
  let file, parent
  return getEntityById(
    db,
    id
  ).then(
    result => {
      file = result
      return getEntityById(
        db,
        file.parentId
      )
    }
  ).then(
    result => {
      parent = result
      new Promise(
        (res, rej) => {
          if(!file.isLeaf) rej(
            `Entity with id ${
              id
            } is not a leaf entity.`
          )
          if(
              !/^[a-zA-Z0-9_.-]+$/.test(
                newName
              )
            ) rej(
              `Invalid file name: ${
                newName
              }. File names must be alphanumeric, dashes, dots, and underscores.`)
          const n = normalize(
            parent.path + newName,
            absPathToPieces(
              cwd
            )
          )
          const entityTable = db
            .transaction(
              "entity",
              "readwrite"
            ).objectStore(
              "entity"
            )
          const rq = entityTable
            .openCursor(
              IDBKeyRange.only(id)
            )
          let renamings = 0
          rq.onsuccess = e => {
            const cursor = e.target.result
            if(cursor){
              const u = cursor.value
              u.name = newName
              u.path = n
              cursor.update(u)
              renamings++
              cursor.continue()
            } else {
              res(renamings)
            }
          }
          rq.onerror = () => {
            rej(
              `Could not rename file entity with id ${
                id
              } to ${
                newName
              }.`)
          }
        }
      )
    }
  )
}

function reparentLeafEntity(
  db,
  cwd,
  id,
  newParentId
){
  return Promise.all(
    [
      getEntityById(
        db,
        id
      ),
      getEntityById(
        db,
        newParentId
      )
    ]
  ).then(
    (
      [
        leaf,
        newParent
      ]
    ) => new Promise(
      (res, rej) => {
        const newPath = normalize(
          newParent.path + leaf.name,
          absPathToPieces(
            cwd
          )
        )
        if(newParent.isLeaf) rej(
          "New parent cannot be a leaf entity."
        )
        if(!leaf.isLeaf) rej(
          `Entity with id ${
            id
          } is not a leaf entity.`
        )
        const entityTable = db
          .transaction(
            "entity",
            "readwrite"
          ).objectStore(
            "entity"
          )
        const rq = entityTable
          .openCursor(
            IDBKeyRange.only(id)
          )
        var reparentings = 0
        rq.onsuccess = e => {
          const cursor = e.target.result
          if(cursor){
            const u = cursor.value
            u.parentId = newParent.id
            u.path = newPath
            cursor.update(u)
            reparentings++
            cursor.continue()
          } else {
            res(reparentings)
          }
        }
        rq.onerror = () => {
          rej(
            `Could not reparent leaf entity with id ${
              id
            } to new parent ${
              newParent.path
            }.`
          )
        }
      }
    )
  )
}

function transplantAncestors(
  db, 
  oldParentId,
  newParentId
){
  return Promise.all(
    [
      getEntityById(
        db,
        oldParentId
      ),
      getEntityById(
        db,
        newParentId
      )
    ]
  ).then(
    (
      [ 
        oldParent, 
        newParent
      ]
    ) => new Promise(
      (res, rej) => {
        if(newParent.isLeaf) rej(
          "New parent cannot be a leaf entity."
        );
        const entityTable = db
          .transaction(
            "entity",
            "readwrite"
          ).objectStore(
            "entity"
          )
        const pathIndex = entityTable
          .index(
            "path"
          )
        const rq = pathIndex
          .openCursor(
            IDBKeyRange.bound(
              oldParent.path,
              oldParent.path + "\uffff",
              true,
              false
            )
          )
        var transplants = 0
        rq.onsuccess = e => {
          const cursor = e.target.result
          if (cursor) {
            const u = cursor.value
            if(u.id === newParent.id) cursor.continue()
            if(
              u.parentId === oldParent.id
            ){
              u.parentId = newParent.id
            } 
            u
              .path = normalize(
                u.path.replace(
                  new RegExp(`^${
                    oldParent.path
                  }`),
                  newParent.path
                ),
                absPathToPieces(
                  cwd
                )
              )
            u.updatedAt = Date.now()
            cursor.update(u)
            transplants++
            cursor.continue()
          } else {
            res(
              `Ancestors transplanted: ${
                transplants
              }.`
            )
          }
        }
        rq.onerror = () => {
          rej(
            `Error reading entities where prefix is ${
              oldParent.path
            } and suffix is non-empty.`
          )
        }
      }
    )
  )
}

function pruneExpiredLocks(
  db
){
  return new Promise(
    (r, j) => {
      const lockTable = db
        .transaction(
          "lock",
          "readonly"
        )
        .objectStore("lock")
        .index("expiry")
      const rq = lockTable.getAllKeys(
        IDBKeyRange.upperBound(
          Date.now()
        )
      )
      rq.onsuccess = (e) => {
        r(e.target.result)
      }
      rq.onerror = () => {
        j("Error reading expired locks.")
      }
    }
  ).then(
    results => Promise.allSettled(
      results.map(id => {
        return new Promise(
          (r, j) => {
            const lockTable = db
              .transaction(
                "lock",
                "readwrite"
              ).objectStore("lock")
            const rq = lockTable
              .delete(id)
            rq.onsuccess = () => {
              r(
                "Expired lock pruned succesfully."
              )
            }
            rq.onerror = () => {
              j(
                "Error deleting expired lock by id; it may have already been deleted."
              )
            }
          }
        )
      })
    )
  )
}

export {
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
}