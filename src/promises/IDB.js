import { normalize, absPathToPieces } from  "../utils/path.js"

/*
Legend:
- indexed field
- <unindexed field>

Entity
------
- name
- path
- isLeaf
- parentId
- createdAt
- updatedAt

Content
-------
- leafPath
- <body>

Lock
----
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
      rq.onerror = e => {
        console.log(`lock acquisition error: ${e.target.error}`)
        rej(
          `Could not acquire lock for path prefix ${
            n
          }`
        )
      }
    }
  )
}

function removeLock( // convert to path
  db, 
  path
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
          path
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

function getLock( // convert to path
  db,
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
      const lockTable = db
        .transaction(
          "lock",
          "readonly"
        ).objectStore("lock")
      const rq = lockTable
        .get(
          n
        )
      rq.onsuccess = e => {
        if(e.target.result) res(
          e.target.result
        );
        else rej(
          `Could not find lock with path prefix ${
            n
          }`
        )
      }
      rq.onerror = () => {
        rej(
          `Could not get lock with path prefix ${
            n
          }.`
        )
      }
    }
  )
}

function entityExists( 
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
      const rq = entityTable
        .count(
          n
        )
      rq.onsuccess = e => {
        res(rq.result > 0)
      }
      rq.onerror = () => {
        rej(
          `Could not count entities with path ${
            n
          }.`
        )
      }
    }
  )
}

/*function entityWithPathExists(// convert to path
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
}*/

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
      const rq = contentTable
        .get(
          IDBKeyRange.only(
            leaf.path
          )
        )
      rq.onsuccess = e => {
        res({
          ...leaf,
          content: e.target.result.content || null
        })
      }
      rq.onerror = (e) => {
        res({
          ...leaf,
          content: null
        })
      }
    }
  )
}

function getEntity(
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
        ).objectStore("entity")
      const rq = entityTable
        .get(
          n
        );
      rq.onsuccess = e => {
        if(e.target.result) res(
          e.target.result
        );
        else rej(
          `Could not find entity with path ${
            n
          }`
        );
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

/*function getEntityByPath(
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
}*/

function getEntitiesByPrefix(
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
      const range = IDBKeyRange.bound(
        n, 
        n + '\uffff', 
        false, 
        false
      )
      const rq = entityTable.getAll(
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

function getImmediateChildKeysOfDirectory( // convert to path
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
  return getEntity(
    db,
    cwd,
    n
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
          const parentPathIndex = entityTable
            .index(
              "parentPath"
            )
          const rq = parentPathIndex
            .getAllKeys(
              IDBKeyRange.only(
                directory.path
              )
            )
          rq.onsuccess = e => {
            res(
              e.target.result
            )
          }
          rq.onerror = () => {
            rej(
              `Could not get child keys of directory with path ${
                n
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

function insertContentRecord(// convert to path
  db,
  cwd,
  leafPath,
  content
){
  const n = normalize(
    leafPath,
    absPathToPieces(
      cwd
    )
  )
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
        .put({
          content: content,
          leafPath: leafPath
        })
      rq.onsuccess = e => {
        res({
          leafPath: e.target.result
        })
      }
      rq.onerror = () => {
        rej(
          `Could not insert content record for leaf with path ${
            leafPath
          }.`
        )
      }
    }
  )
}

function updateContentRecord(// convert to path
  db,
  cwd,
  leafPath,
  newContent
){
  const n = normalize(
    leafPath,
    absPathToPieces(
      cwd
    )
  )
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
        .openCursor(
          IDBKeyRange.only(
            n
          )
        )
      let contentUpdates = 0
      rq.onsuccess = e => {
        const cursor = e.target.result
        if(cursor) {
          const u = cursor.value
          u.content = newContent
          contentUpdates += 1
          cursor.update(
            u
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
          `Could not update content record for leaf with n ${
            n
          }.`
        )
      }
    }
  )
}

function deleteContentRecord(// convert to path
  db,
  cwd,
  leafPath
){
  const n = normalize(
    leafPath,
    absPathToPieces(
      cwd
    )
  )
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
        .openCursor(
          IDBKeyRange.only(
            n
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

function rejectIfConflictingLockPathPrefixes(// convert to path
  db, 
  cwd,
  referenceLockPaths, 
  unexpiredLocksOnly = true
){
  return Promise.all(
    referenceLockPaths.map(
      l => getEntity(
        db,
        cwd,
        l
      )
    )
  ).then(
    results => new Promise(
      (res, rej) => {
        const paths = results.map(
          v => v.path
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
              l => !paths.includes(
                l.pathPrefix
              )
            )
          const conflicts = locks
            .reduce(
              (acc, cur) => {
                if(
                  paths
                    .reduce(
                      (_, c) => {
                        if(
                          c.startsWith(
                            cur.pathPrefix
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

function addFileEntity(// convert to path
  db, 
  cwd, 
  name, 
  parentPath, 
  content // content dereferencing refactor
){
  const n = normalize(
    parentPath,
    absPathToPieces(
      cwd
    )
  )
  return getEntity(
    db,
    cwd,
    n
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
        const n2 = normalize(
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
            path: n2,
            isLeaf: true,
            parentPath: parent.path,
            createdAt: time,
            updatedAt: time,
            name
          })
        rq.onsuccess = e => {
          res(
            e.target.result
          )
        }
        rq.onerror = e => {
          rej(
            `Could not add file entity with name ${
              name
            } to parent ${
              parent.path
            }: ${
              e.target.error.message
            }`
          )
        }
      }
    )
  ).then(
    leafPath => insertContentRecord(
      db,
      cwd,
      leafPath,
      content
    )
  )
}

function addDirectoryEntity(
  db, 
  cwd, 
  name, 
  parentPath
){
  const n = normalize(
    parentPath,
    absPathToPieces(
      cwd
    )
  )
  return getEntity(
    db,
    cwd,
    n
  ).then(
    parent => new Promise(
      (res, rej) => {
        console.log(`parentPath ${parent.path} name ${name}`)
        const n2 = normalize(
          parent.path + name + "/",
          absPathToPieces(
            cwd
          )
        );
        console.log(`n2 ${n2}`)
        const time = Date.now()
        const entityTable = db
          .transaction(
            "entity",
            "readwrite"
          ).objectStore(
            "entity"
          )
        console.log(
          JSON.stringify(
            {
            path: n2,
            isLeaf: false,
            parentPath: parent.path,
            createdAt: time,
            updatedAt: time,
            name
          }
          )
        )
        const rq = entityTable
          .add({
            path: n2,
            isLeaf: false,
            parentPath: parent.path,
            createdAt: time,
            updatedAt: time,
            name
          })
        rq.onsuccess = e => {
          res(
            e.target.result
          )
        }
        rq.onerror = e => {
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

function deleteEntity(
  db, 
  cwd,
  path // content dereferencing refactor
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
          "readwrite"
        ).objectStore("entity")
      const rq = entityTable
        .delete(
          n
        )
      rq.onsuccess = () => {
        res(
          n
        )
      }
      rq.onerror = () => {
        rej(
          `Could not delete entity with path ${
            path
          }; it may have already been deleted.`
        )
      }
    }
  )
}

function deleteLeafEntity(
  db, 
  cwd,
  path// content dereferencing refactor
){
  return getEntity(
    db,
    cwd,
    path
  ).then(
    file => {
      if(!file.isLeaf) throw `Cannot delete non-leaf entity with path ${
        file.path
      }.`
      return deleteEntity(
        db,
        cwd,
        path
      )
    }
  ).then(
    leafPath => deleteContentRecord(
      db,
      cwd,
      leafPath
    )
  )
}

function deleteDirectoryIfEmpty(
  db, 
  cwd,
  path
){
  return getEntity(
    db,
    cwd,
    path
  ).then( 
    directory => new Promise(
      (res, rej) => {
        if(
          directory.isLeaf
        ) rej(
          `Cannot delete entity with path ${
            directory.path
          } because it is a leaf.`
        );
        if(
          directory.path === "/"
        ) rej(
          `Cannot delete entity with path ${
            directory.path
          } because it is the root directory.`
        );
        if(
          cwd.startsWith(
            directory.path
          )
        ) rej(
          `Cannot delete entity with path ${
            directory.path
          } because it is a prefix of the current working directory.`
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
            "parentPath"
          )
        const rq = parentIdIndex
          .count(
            IDBKeyRange.only(
              directory.path
            )
          )
        rq.onsuccess = () => {
          if(rq.result !== 0) rej(
            `Cannot delete directory with path ${
              directory.path
            } because it is not empty.`
          );
          res(directory.path);
        }
        rq.onerror = () => {
          rej(
            `Could not count number of children for directory with path ${
              directory.path
            }.`
          )
        }
      }
    )
  ).then(
    path => deleteEntity(
      db,
      cwd,
      path
    )
  )
}

function emptyDirectory(
  db, 
  cwd,
  path// content dereferencing refactor
){
  return getEntity(
    db,
    cwd,
    path
  ).then(
    directory => new Promise(
      (res, rej) => {
        if(
          directory.isLeaf
        ) rej(
          `Cannot empty entity with path ${
            directory.path
          } because it is a leaf.`
        );
        const entityTable = db
          .transaction(
            "entity",
            "readwrite"
          ).objectStore(
            "entity"
          )
        const parentPathIndex = entityTable
          .index(
            "parentPath"
          )
        const rq = parentPathIndex
          .count(
            IDBKeyRange.only(
              directory.path
            )
          )
        rq.onsuccess = () => {
          if(rq.result === 0) rej(
            `Cannot empty entity with path ${
              directory.path
            } because it is already empty.`
          );
          res(directory.path);
        }
        rq.onerror = () => {
          rej(
            `Could not count number of children for directory with path ${
              directory.path
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
        const rq = entityTable
          .openCursor(
            IDBKeyRange.bound(
              pathPrefix,
              pathPrefix + '\uffff',
              true,
              false
            )
          )
        const deletedPaths = []
        var deletions = 0
        rq.onsuccess = e => {
          const cursor = e.target.result
          if(cursor) {
            if(cursor.value.isLeaf) deletedPaths.push(cursor.value.path)
            cursor.delete()
            deletions++
            cursor.continue() 
          } else {
            res(
              deletedPaths
            )
          }
        }
        rq.onerror = () => {
          rej(
            `Could not empty directory with path ${
              pathPrefix
            }.`
          )
        }
      }
    )
  ).then(
    deletedPaths => Promise.allSettled(
      deletedPaths.map(
        v => deleteContentRecord(
          db,
          cwd,
          v
        )
      )
    )
  )
}

function updateFileTimestamp(
  db, 
  cwd,
  path
){
  return getEntity(
    db,
    cwd,
    path
  ).then(
    file => new Promise(
      (res, rej) => {
        if(!file.isLeaf) rej(
          `Entity with path ${
            file.path
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
              file.path
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
            `Could not update file with path ${
              file.path
            }.`
          )
        }
      }
    )
  )
}

function updateFile(
  db, 
  cwd,
  path, 
  content // content dereferencing refactor
){
  return getEntity(
    db,
    cwd,
    path
  ).then(
    file => Promise.allSettled([
      updateFileTimestamp(
        db,
        cwd,
        path
      ),
      updateContentRecord(
        db,
        cwd,
        path,
        content
      )
    ])
  )
}

function renameFile(
  db, 
  cwd,
  path, 
  newName
){
  let file, parent
  return getEntity( // auto-get the file
    db,
    cwd,
    path
  ).then(
    result => {
      file = result
      return getEntity(
        db,
        cwd,
        file.parentPath
      )
    } // auto-get parent
  ).then(
    result => {
      parent = result
      return new Promise(
        (res, rej) => {
          if(!file.isLeaf) rej(
            `Entity with path ${
              file.path
            } is not a leaf entity.`
          )
          if(
              !/^[a-zA-Z0-9_.-]+$/.test(
                newName
              )
            ) rej(
              `Invalid file name: ${
                newName
              }. File names must be alphanumeric, dashes, dots, and underscores.`
          )
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
            .delete(
              IDBKeyRange.only(
                file.path
              )
            )
          rq.onsuccess = e => {
            res({
              oldFile: file,
              parent: parent,
              newPath: n,
              newName
            })
          }
          rq.onerror = () => {
            rej(
              `Could not rename file with path ${
                file.path
              } to ${
                newName
              }.`
            )
          }
        }
      )
    } // man-delete original
  ).then(
    ({
      oldFile,
      parent,
      newPath,
      newName
    }) => new Promise( // man-get old content
      (res, rej) => {
        const contentTable = db
          .transaction(
            "content",
            "readwrite"
          ).objectStore(
            "content"
          )
        const rq = contentTable
          .get(
            oldFile.path
          )
        rq.onsuccess = e => {
          const content = e.target.result
          if(content) {
            res({
              oldFile: oldFile,
              parent: parent,
              newPath: newPath,
              newName: newName,
              content: content
            })
          } else {
            rej(
              `Could not find content record with path ${
                oldFile.path
              }.`
            )
          }
        }
        rq.onerror = () => {
          rej(
            `Could not find content record with path ${
              oldFile.path
            }.`
          )
        }
      }
    )
  ).then(
    ({
      oldFile,
      parent,
      newPath,
      newName,
      content
    }) => Promise.allSettled([
      new Promise( // man-delete old content
        (res, rej) => {
          const contentTable = db
            .transaction(
              "content",
              "readwrite"
            ).objectStore(
              "content"
            )
          const rq = contentTable
            .delete(
              oldFile.path
            )
          rq.onsuccess = () => {
            res()
          }
          rq.onerror = () => {
            rej(
              `Could not delete content record with path ${
                oldFile.path
              }.`
            )
          }
        }
      ),
      addFileEntity( // auto-recreate fild
        db, 
        cwd, 
        newName, 
        parent.path, 
        content.content
      ) // ->getEntity->insertContentRecord(man-addcontent)
    ])
  )
}

function reparentLeaf(
  db,
  cwd,
  path,
  newParentPath
){
  return Promise.all(
    [
      getEntity(
        db,
        cwd,
        path
      ),
      getEntity(
        db,
        cwd,
        newParentPath
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
          `Entity with path ${
            leaf.path
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
            IDBKeyRange.only(
              leaf.path
            )
          )
        var reparentings = 0
        rq.onsuccess = e => {
          const cursor = e.target.result
          if(cursor){
            const u = cursor.value
            u.parentPath = newParent.path
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
            `Could not reparent leaf with path ${
              leaf.path
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
  oldParentPath,
  newParentPath
){
  return Promise.all(
    [
      getEntity(
        db,
        cwd,
        oldParentPath
      ),
      getEntity(
        db,
        cwd,
        newParentPath
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
        const rq = entityTable
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
            if(u.path === newParent.path) cursor.continue()
            if(
              u.parentPath === oldParent.path
            ){
              u.parentPath = newParent.path
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
        j(
          "Error reading expired locks."
        )
      }
    }
  ).then(
    results => Promise.allSettled(
      results.map(path => {
        return new Promise(
          (r, j) => {
            const lockTable = db
              .transaction(
                "lock",
                "readwrite"
              ).objectStore("lock")
            const rq = lockTable
              .delete(
                path
              )
            rq.onsuccess = () => {
              r(
                "Expired lock pruned succesfully."
              )
            }
            rq.onerror = () => {
              j(
                "Error deleting expired lock by path; it may have already been deleted."
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
}