# VZFS

This is a hierarchical filesystem emulation javascript library that uses IndexedDB in web browsers. It has a simple, minimalistic set of essential features to empower your application. In addition to file and folder CRUD operations, it supports multiple named filesystems within your same origin, with the ability to import and export backup copies of individual filesystems as JSON!

Currently built with XState, I prefer to think of it as a subsystem suitable for use as a subordinate actor within a larger system.

It persists a tree structure, the hierarchy of files and folders, into a single IndexedDB table which holds polymorphic records with references to one another.

Several strategies are used to improve performance:

- File content is stored in a separate table to improve performance. This is a form of linking I suppose although linking features are not a major focus of this library at this time.

- "Materialized path" strategy is used whereby the full path is stored at each node. It's a classic kind of denormalization strategy to add redundant data to a database schema in order to speed up read queries, in this case to enable storage of a tree in a table while preserving the ability to quickly select sub-trees.

- Though XState is used as a general strategy to avoid errors in coordinating asynchronous behaviors, some of the coordination is done inside of invoked promises (instead of in XState itself). 

At a cost of some extra time and space, care is taken to ensure the integrity of the tree stored in IndexedDB table:

- A separate lock table which is periodically pruned of expired locks to prohibit it from burgeoning.

- IndexedDB does have some transactional locking features, but there are some operations that require portions of tree be locked while multiple transactions' worth of operations take place. For those, we need a broader locking facility that can reach across browser tabs.

- It's an optimistic locking strategy I think you'd say because it doesn't technically prevent you from intentionally disturbing your tree's integrity if you really want.

There are two levels to this library. The higher level is an interpreted state machine, and the lower level is just a library of promise returning functions. The locking is enforced at the higher level by tools from the lower level.

## Future Goals

* convert current working directory (cwd) aspects of the library to an an IndexedDB-resident session system to make cwd more resilient; right now relative paths and cwd are interesting curiosities of the library, but for the greatest level of predictability absolute paths should be used.
* rework schema so that unique path key is preserved but another constant-length UUID key is also added to the entity table.
* eliminate XState dependency. I adore XState and what it taught me about state machine design patterns. But in the future I'd like to try doing state machines and the actor model with just pure, native JS and async generators or something along those lines.
* add more filesystem methods

## Documentation

You should limit yourself to the `storageHierarchy` machine unless you really know what you're doing. Spawn the machine as a child within another XState machine. 

An example test machine that consumes this `storageHierarchy` is provided on [this page](/vzfs/test). It's not a fanastic state machine, but it gives a verbose list of usage examples. The lengthy source code of the machine is listed at top of page, and the output produced by it is listed after.

It's out of the scope of this documentation to teach the XState framework from first principles unfortunately, so there will be some assumptions about your ability to understand the framework. 

### Spawning the Filesystem Actor

```js
// within an XState assign action after importing the machine
assign(
  () => ({
    fs: spawn(
      storageHierarchy,
      "fsActor" // or name it something else
    )
  })
)
```

### After Spawning but Before Initializing

The actor supports several operations after you spawn it and before instantiating or "mounting" a specific filesystem.

### List Filesystems

*You should note that the underlying IndexedDB method which `listFilesystems` relies on is not implemented in some browsers, so your mileage with this command may vary. If it's essential you be able to maintain a dynamic list of of multiple filesystems in your origin, then consider creating an "admin" filesystem (being careful to give it a unique name) which maintains a record of the other filesystems your application uses.*

```js
{ // in some state
  entry: [
    sendTo(
      "fsActor",
      { 
        type: "listFilesystems",
      }
    )
  ],
  on: {
    listFilesystemsSuccess: {
      actions: log(
        (_, evt) => JSON.stringify(
          evt.filesystems
        )
      )
    },
    listFilesystemsFailure: {
      actions: log(
        "Failed to enumerate filesystems"
      )
    }
  }
}
```

### Drop or Delete a Specific Filesystem

```js
{ // in some state
  entry: [
    sendTo(
      "fsActor",
      { 
        type: "dropFilesystem",
        fsName: "user_fs_42"
      }
    )
  ],
  on: {
    dropFilesystemSuccess: {
      actions: log(
        "Deleted filesystem successfully."
      )
    },
    dropFilesystemFailure: {
      actions: log(
        "Failed to delete filesystem."
      )
    }
  }
}
```

### Restore a Filesystem from JSON

The intention of this feature is to create a new filesystem with a new, unused name and seed it with records which were exported via this library's export as JSON feature (more on that later). Basically it is the option to restore a filesystem from a backup taken earlier.

```js
{ // in some state
  entry: [
    sendTo(
      "fsActor",
      ctx => ({
        type: "restoreFilesystemFromJSON",
        fsName: "restoredFs",
        version: 1,
        backup: ctx.backupJSON
      })
    )
  ],
  on: {
    restoreFilesystemFromJSONSuccess: {
      actions: log(
        "Restored filesystem successfully."
      )
    },
    restoreFilesystemFromJSONFailure: {
      actions: log(
        "Failed to restore filesystem."
      )
    }
  }
}
```

### Initializing

The `init` event is sent to the filesystem actor along with the version and name of the filesystem you wish to mount. During initialization, the root directory of the filesystem will be seeded if it does not already exist. Thereafter, commands sent to the filesystem actor will target that specific filesystem you mounted, until you issue a command to unmount it (more on that later), after which you'll once again be able to issue the commands discussed above for enumerating, deleting, and restoring filesystems.

```js
{
  entry: [
    sendTo(
      "fsActor",
      {
        type: "init",
        filesystemName: "vzfs_test",
        version: 1
      }
    )
  ], 
  on: {
    vzfsAwaitingCommand: {
      actions: [
        log(
          "vzfsAwaitingCommand signal received."
        )
      ]
    }
  }
}
```

### `changeDirectory`

This is how you change what the current working directory or "cwd" of the filesystem actor is. If your application/origin spawns multiple filesystem actors at the same time, each will have its own current working directory. The value of cwd influences the resolution of relative paths you pass to the filesystem later in some of the other commands (i.e., paths that have `.` or `..` in them). Note that the value of `newDirectoryPath` must be given within the `data` object in the event, and since `cwd` must always be a directory (and not a file) the string value passed must end in a terminal `/`. 

The relative path resolution features of this library are for convenience and not fully locked/controlled. In certain circumstances if you are not disciplined, it will be possible for you to have an invalid `cwd`, which can in turn cause other commands to fail. If this concerns you, just always use absolute paths in your application.

```js
{
  entry: [
    sendTo(
      "fsActor",
      {
        type: "changeDirectory",
        data: {
          newDirectoryPath: "/testDir/"
        }
      }
    )
  ], 
  on: {
    changeDirectorySuccess: {
      actions: log(
        "Directory successfully changed."
      )
    },
    changeDirectoryFailure: {
      actions: log(
        "Failed to change directory."
      )
    }
  }
}
```

### `createFile`

Use this method to create a new file somewhere in your filesystem tree. This is a simplistic example obviously; usually you'd want to populate the content from an event of some sort (e.g., after a user presses a save button). Also note how once again for this command, it's required to pass the file metadata key/value pairs inside of the `data` object in your event you send to the filesystem actor. The filesystem entities created by this command, files, have an `isLeaf` flag set to true to differentiate them from directory entries.

```js
{
  entry: [
    sendTo(
      "fsActor",
      {
        type: "createFile",
        data: {
          name: "test.txt",
          content: "test content",
          parentPath: "/"
        }
      }
    )
  ], 
  on: {
    createFileSuccess: {
      actions: log(
        (_, evt) => `File created! New file path: ${
          evt.newFilePath
        }`
      )
    },
    createFileFailure: {
      actions: log(
        (_, evt) => `Failed to create file: ${
          evt.msg
        }`
      )
    }
  }
}
```

### `readFile`

```js
{
  entry: [
    sendTo(
      "fsActor",
      (_, evt) => ({
        type: "readFile",
        data: {
          path: evt.filePath
        }
      })
    )
  ], 
  on: {
    readFileSuccess: {
      actions: log(
        `read file successfully: ${
          JSON.stringify(
            evt
          )
        }`
      )
    },
    readFileFailure: {
      actions: log(
        `read file failure: ${
          evt.msg
        }`
      )
    }
  }
}
```

### `updateFileTimestamp`

This updates the `updatedAt` timestamp of a file without touching the content. Timestamps are stored in unix epoch time format for so they can be indexed and searched easier.

```js
{
  entry: [
    sendTo(
      "fsActor",
      ctx => ({
        type: "updateFileTimestamp",
        data: {
          path: ctx.currentFilePath
        }
      })
    )
  ], 
  on: {
    updateFileTimestampSuccess: {
      actions: log(
        "file timestamp updated successfully"
      )
    },
    updateFileTimestampFailure: {
      actions: log(
        "failed to update file timestamp"
      )
    }
  }
}
```

### `updateFileContent`

This command updates the file's `updatedAt` timestamp as well as the file content.

```js
{
  entry: [
    sendTo(
      "fsActor",
      ctx => ({
        type: "updateFileContent",
        data: {
          path: ctx.testFilePath,
          content: "hello warld"
        }
      })
    )
  ],
  on: {
    updateFileSuccess: {
      actions: log(
        "File updated successfully."
      )
    },
    updateFileFailure: {
      actions: log(
        "Oops, failed to update the file."
      )
    }
  }
}
```

### `deleteFile`

This is for deleting a file.

```js
{
  entry: [
    sendTo(
      "fsActor",
      ctx => ({
        type: "deleteFile",
        data: {
          path: ctx.testTwoFilePath
        }
      })
    )
  ],
  on: {
    deleteFileSuccess: log(
      "Successfully deleted the file."
    ),
    deleteFileFailure: log(
      "Couldn't delete the file."
    )
  }
}
```

### `createDirectory`

When you create a directory, the `name` ought to be given without a trailing forward slash. Example: `mydir`.

When you later reference the path to your newly created directory, it must include the trailing slash to identify it as a directory. Example: `/mydir/`

Paths are case sensitive in VZFS.

```js
{
  entry: [
    sendTo(
      "fsActor",
      () => ({
        type: "createDirectory",
        data: {
          name: "testDir",
          parentPath: "/"
        }
      })
    )
  ],
  on: {
    createDirectorySuccess: {
      actions: log(
        "directory created successfully! Access it at this path: /testDir/"
      )
    },
    createDirectoryFailure: {
      "failed to create directory. Don't bother looking for it here: /testDir/"
    }
  }
}
```

### `getDirectoryRecord`

This gives you an object which includes the directory itself and a list of the keys of its children. If you want to know more about the children you'll need to use another command to retrieve them.

```js
{
  entry: [
    sendTo(
      "fsActor",
      () => ({
        type: "getDirectoryRecord",
        data: {
          path: "/"
        }
      })
    )
  ],
  on: {
    getDirectoryRecordSuccess: {
      actions: log(
        `got directory record: ${
          JSON.stringify(
            evt
          )
        }`
      )
    },
    getDirectoryRecordFailure: {
      actions: log(
        "failed to retrieve directory record. sorry about that"
      )
    }
  }
}
```

### `emptyDirectory`

This command takes a path to a given directory as an argument and deletes all of its ancestors. That means not just its children, but also nested files and folders. 

```js
{
  entry: [
    sendTo(
      "fsActor",
      () => ({
        type: "emptyDirectory",
        data: {
          path: "/testDir/"
        }
      })
    )
  ],
  on: {
    emptyDirectorySuccess: {
      actions: log(
        "Hey we deleted a bunch of stuff!"
      )
    },
    emptyDirectoryFailure: {
      "Dang, didn't manage to delete stuff I guess."
    }
  }
}
```

### `deleteDirectoryIfEmpty`

This command takes a directory as an argument and deletes it -- but only if it is an empty directory. 

```js
{
  entry: [
    sendTo(
      "fsActor",
      () => ({
        type: "deleteDirectoryIfEmpty",
        data: {
          path: "/testDir/"
        }
      })
    )
  ],
  on: {
    deleteDirectoryIfEmptySuccess: {
      actions: log(
        "Deleted an empty file, big whoop."
      )
    },
    deleteDirectoryIfEmptyFailure: {
      actions: log(
        "Couldn't even delete an empty folder :("
      )
    }
  }
}
```

### `ripFilesystemToJSON`

This method is the counterpart method to the `restoreFilesystemFromJSON` method discussed earlier. This one will read all records from all tables in the specified filesystem database into a single JSON string. 

```js
{
  entry: [
    sendTo(
      "fsActor",
      {
        type: "ripFilesystemToJSON",
      }
    )
  ],
  on: {
    ripFilesystemToJSONSuccess: {
      actions: log(
        `successfully ripped the filesystem to JSON! Here it is: ${
          evt.backup
        }`
      )
    },
    ripFilesystemToJSONFailure: {
      actions: log(
        "Oof, couldn't rip the filesystem to JSON. Maybe we need to manually extract the files..."
      )
    }
  }
}
```







