import storageHierarchy from '../src/subsystems/storageHierarchy.js';
import { interpret, createMachine, spawn, actions, sendTo } from "xstate"

const { assign, log } = actions

function ts(){
  const t = new Date()
  return `${
    t.toLocaleTimeString(
      undefined, 
      {
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: true,
        fractionalSecondDigits: 3
      }
    )
  } ${
    t.toLocaleDateString(
      undefined, 
      {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }
    )
  }`
}

function out(
  text, 
  level = "INFO"
) {
  let p
  document.querySelector(
    "#app"
  ).append(
    (() => { 
      p = document.createElement("p"); 
      p.innerText = `${
        ts()
      } ${
        level
      } ${
        text
      }`; 
      return p 
    })()
  )
  p.scrollIntoView()
}

function storageHierarchyTest() {
  const tester = interpret(
    createMachine(
      {
        predictableActionArguments: true,
        initial: "cleanupOldTestDBs",
        context: {
          oldFS: []
        },
        states: {
          cleanupOldTestDBs: {
            initial: "deciding",
            entry: [
              assign(() => ({
                fs: spawn(
                  storageHierarchy,
                  "fsActor"
                )
              })),
              () => out(
                "enumerateFilesystems"
              )
            ],
            states: {
              deciding: {
                always: [
                  {
                    target: "enumerateFilesystems",
                    cond: () => typeof window.indexedDB.databases !== "undefined",
                    actions: () => out(
                      "method exists so listing DBs"
                    )
                  },
                  {
                    target: "droppingFilesystems",
                    actions: [
                      () => out(
                        "Skipping filesystem enumeration since indexedDB.databases method is not available in this browser."
                      ),
                      assign(ctx => ({
                        ...ctx,
                        oldFS: [
                          {
                            name: "vzfs_test",
                            version: 1
                          }
                        ]
                      }))
                    ]
                  }
                ]
              },
              enumerateFilesystems: {
                entry: [
                  sendTo(
                    "fsActor",
                    { 
                      type: "listFilesystems",
                    }
                  ),
                ],
                on: {
                  listFilesystemsSuccess: {
                    target: "droppingFilesystems",
                    actions: [
                      assign((ctx, evt) => ({
                        ...ctx,
                        oldFS: evt.filesystems
                      })),
                      ctx => out(
                        `oldFS slated for deletion: ${
                          JSON.stringify(
                            ctx.oldFS
                          )
                        }`,
                        "INFO"
                      )
                    ]
                  },
                  listFilesystemsFailure: {
                    actions: () => out(
                      "listFilesystemsFailure"
                    )
                  }
                }
              },
              droppingFilesystems: {
                initial: "routing",
                states: {
                  routing: {
                    always: [
                      {
                        target: "droppingFilesystem",
                        cond: ctx => ctx.oldFS.length > 0,
                      },
                      {
                        target: "done"
                      }
                    ]
                  },
                  droppingFilesystem: {
                    entry: [
                      ctx => out(
                        `deleting fs called: ${
                          ctx.oldFS[(
                            ctx.oldFS.length - 1
                          )].name
                        }`
                      ),
                      sendTo(
                        "fsActor",
                        ctx => ({
                          type: "dropFilesystem",
                          fsName: typeof ctx.oldFS !== "undefined" ? ctx.oldFS[(
                            ctx.oldFS.length - 1
                          )].name : "vzfs_test"
                        })
                      ),
                    ],
                    on: {
                      dropFilesystemSuccess: {
                        target: "routing",
                        actions: [
                          assign(ctx => ({
                            ...ctx,
                            oldFS: ctx.oldFS.slice(
                              0, 
                              -1
                            )
                          })),
                          () => out(
                            "drop fs success."
                          )
                        ]
                      },
                      dropFilesystemFailure: {
                        target: "routing",
                        actions: [
                          assign(ctx => ({
                            ...ctx,
                            oldFS: ctx.oldFS.slice(
                              0, 
                              -1
                            )
                          })),
                          () => out(
                            "drop fs failure."
                          )
                        ]
                      }
                    }
                  },
                  done: {
                    type: "final",
                  }
                },
                onDone: {
                  target: "fin"
                }
              },
              fin: {
                type: "final"
              }
            },
            onDone: {
              target: "mainTests",
              actions: [
                () => out(
                  "cleanupOldTestDBs success."
                )
              ]
            }
          },
          mainTests: {
            initial: "init",
            states: {
              init: {
                always: [
                  {
                    target: "test",
                    actions: [
                      () => out(
                        "initializing vzfs_test db"
                      ),
                      sendTo(
                        "fsActor",
                        {
                          type: "init",
                          filesystemName: "vzfs_test",
                          version: 1
                        }
                      )
                    ]
                  }
                ]
              },
              test: {
                initial: "waiting",
                states: {
                  waiting: {
                    on: {
                      vzfsAwaitingCommand: {
                        target: "testOne",
                        actions: [
                          () => out(
                            `vzfsAwaitingCommand signal received.`
                          )
                        ]
                      }
                    }
                  },
                  testOne: {
                    entry: [
                      () => out("getting cwd"),
                      sendTo(
                        "fsActor",
                        {
                          type: "getDirectoryRecord"
                        }
                      )
                    ],
                    on: {
                      getDirectoryRecordSuccess: {
                        target: "testTwo",
                        actions: [
                          (_, evt) => out(
                            `cwd: ${
                              evt.data.cwd
                            } - count children: ${
                              evt.data.childKeys.length
                            }`
                          ),
                        ]
                      },
                      getDirectoryRecordFailure: {
                        actions: [
                          (_, evt) => out(
                            `cwd fail: ${
                              evt.msg
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  testTwo: {
                    entry: [
                      () => out("creating file."),
                      sendTo(
                        "fsActor",
                        {
                          type: "createFile",
                          data: {
                            name: "test.txt",
                            content: "test content",
                            parentPath: "."
                          }
                        }
                      )
                    ],
                    on: {
                      createFileSuccess: {
                        target: "testThree",
                        actions: [
                          (_, evt) => out(
                            `created file: ${
                              JSON.stringify(evt)
                            }`
                          ),
                          assign(
                            (ctx, evt) => ({
                              ...ctx,
                              testTwoFilePath: evt.newFilePath
                            })
                          )
                        ]
                      },
                      createFileFailure: {
                        actions: [
                          (_, evt) => out(
                            `create file fail: ${
                              evt.msg
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  testThree: {
                    entry: [
                      (ctx) => out(
                        `reading file: ${
                          ctx.testTwoFilePath
                        }`
                      ),
                      sendTo(
                        "fsActor",
                        ctx => ({
                          type: "readFile",
                          data: {
                            path: ctx.testTwoFilePath
                          }
                        })
                      )
                    ],
                    on: {
                      readFileSuccess: {
                        target: "testFour",
                        actions: [
                          (_, evt) => out(
                            `read file: ${
                              JSON.stringify(evt)
                            }`
                          ),
                        ]
                      },
                      readFileFailure: {
                        actions: [
                          (_, evt) => out(
                            `read file fail: ${
                              evt.msg
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  testFour: {
                    entry: [
                      (ctx) => out(
                        `renaming file: ${
                          ctx.testTwoFilePath
                        }`
                      ),
                      sendTo(
                        "fsActor",
                        ctx => ({
                          type: "updateFileTimestamp",
                          data: {
                            path: ctx.testTwoFilePath
                          }
                        })
                      )
                    ],
                    on: {
                      updateFileTimestampSuccess: {
                        target: "testFive",
                        actions: [
                          () => out("touched file."),
                        ]
                      },
                      updateFileTimestampFailure: {
                        actions: [
                          (_, evt) => out(
                            `touch file fail: ${
                              evt.msg
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  testFive: {
                    entry: [
                      (ctx) => out(
                        `reading file.`
                      ),
                      sendTo(
                        "fsActor",
                        ctx => ({
                          type: "readFile",
                          data: {
                            path: ctx.testTwoFilePath
                          }
                        })
                      )
                    ],
                    on: {
                      readFileSuccess: {
                        target: "testSix",
                        actions: [
                          (_, evt) => out(
                            `read file: ${
                              JSON.stringify(evt)
                            }`
                          ),
                        ]
                      },
                      readFileFailure: {
                        target: "testSix",
                        actions: [
                          (_, evt) => out(
                            `read file fail: ${
                              evt.msg
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  testSix: {
                    entry: [
                      () => out(
                        "updating file content"
                      ),
                      sendTo(
                        "fsActor",
                        ctx => ({
                          type: "updateFileContent",
                          data: {
                            path: ctx.testTwoFilePath,
                            content: "hello warld"
                          }
                        })
                      )
                    ],
                    on: {
                      updateFileSuccess: {
                        target: "testSeven",
                        actions: [
                          (_, evt) => out(
                            "updated file content"
                          )
                        ]
                      },
                      updateFileFailure: {
                        actions: [
                          (_, evt) => out(
                            `update file content fail: ${
                              evt.msg
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  testSeven: {
                    entry: [
                      () => out(
                        `reading file.`
                      ),
                      sendTo(
                        "fsActor",
                        ctx => ({
                          type: "readFile",
                          data: {
                            path: ctx.testTwoFilePath
                          }
                        })
                      )
                    ],
                    on: {
                      readFileSuccess: {
                        target: "testEight",
                        actions: [
                          (_, evt) => out(
                            `read file: ${
                              JSON.stringify(evt)
                            }`
                          ),
                        ]
                      },
                      readFileFailure: {
                        actions: [
                          (_, evt) => out(
                            `read file fail: ${
                              evt.msg
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  testEight: {
                    entry: [
                      () => out(
                        "deleting file"
                      ),
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
                      deleteFileSuccess: {
                        target: "testNine",
                        actions: [
                          (_, evt) => out(
                            `deleted file: ${
                              JSON.stringify(evt)
                            }`
                          ),
                        ]
                      },
                      deleteFileFailure: {
                        actions: [
                          (_, evt) => out(
                            `delete file fail: ${
                              evt.msg
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  testNine: {
                    entry: [
                      () => out(
                        "create directory"
                      ),
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
                        target: "testTen",
                        actions: [
                          (_, evt) => out(
                            `created directory: ${
                              JSON.stringify(evt)
                            }`
                          ),
                        ]
                      },
                      createDirectoryFailure: {
                        actions: [
                          (_, evt) => out(
                            `create directory fail: ${
                              evt.msg
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  testTen: {
                    entry: [
                      () => out(
                        "getting dir record"
                      ),
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
                        target: "test11",
                        actions: [
                          (_, evt) => out(
                            `got directory record: ${
                              JSON.stringify(
                                evt
                              )
                            }`
                          ),
                        ]
                      },
                      getDirectoryRecordFailure: {
                        actions: [
                          (_, evt) => out(
                            `get directory record fail: ${
                              JSON.stringify(
                                evt
                              )
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  test11: {
                    entry: [
                      () => out(
                        "create directory"
                      ),
                      sendTo(
                        "fsActor",
                        () => ({
                          type: "createDirectory",
                          data: {
                            name: "testDir",
                            parentPath: "/testDir/"
                          }
                        })
                      )
                    ],
                    on: {
                      createDirectorySuccess: {
                        target: "test12",
                        actions: [
                          (_, evt) => out(
                            `created directory: ${
                              JSON.stringify(evt)
                            }`
                          ),
                        ]
                      },
                      createDirectoryFailure: {
                        actions: [
                          (_, evt) => out(
                            `create directory fail: ${
                              evt.msg
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  test12: {
                    entry: [
                      () => out("creating file."),
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
                        target: "test13",
                        actions: [
                          (_, evt) => out(
                            `created file: ${
                              JSON.stringify(evt)
                            }`
                          ),
                          assign(
                            (ctx, evt) => ({
                              ...ctx,
                              testTwoFilePath: evt.newFilePath
                            })
                          )
                        ]
                      },
                      createFileFailure: {
                        actions: [
                          (_, evt) => out(
                            `create file fail: ${
                              evt.msg
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  test13: {
                    entry: [
                      () => out(
                        "getting dir record"
                      ),
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
                        target: "test14",
                        actions: [
                          (_, evt) => out(
                            `got directory record: ${
                              JSON.stringify(
                                evt
                              )
                            }`
                          ),
                        ]
                      },
                      getDirectoryRecordFailure: {
                        actions: [
                          (_, evt) => out(
                            `get directory record fail: ${
                              JSON.stringify(
                                evt
                              )
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  test14: {
                    entry: [
                      () => out(
                        "changing dir"
                      ),
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
                        target: "test14_5",
                        actions: [
                          (_, evt) => out(
                            `changed directory: ${
                              JSON.stringify(
                                evt
                              )
                            }`
                          ),
                        ]
                      },
                      changeDirectoryFailure: {
                        actions: [
                          (_, evt) => out(
                            `change directory fail: ${
                              JSON.stringify(
                                evt
                              )
                            }`
                          )
                        ]
                      }
                    }
                  },
                  test14_5: {
                    entry: [
                      () => out(
                        "changing dir"
                      ),
                      sendTo(
                        "fsActor",
                        {
                          type: "changeDirectory",
                          data: {
                            newDirectoryPath: "/"
                          }
                        }
                      )
                    ],
                    on: {
                      changeDirectorySuccess: {
                        target: "test15",
                        actions: [
                          (_, evt) => out(
                            `changed directory: ${
                              JSON.stringify(
                                evt
                              )
                            }`
                          ),
                        ]
                      },
                      changeDirectoryFailure: {
                        actions: [
                          (_, evt) => out(
                            `change directory fail: ${
                              JSON.stringify(
                                evt
                              )
                            }`
                          )
                        ]
                      }
                    }
                  },
                  test15: {
                    entry: [
                      () => out("creating file."),
                      sendTo(
                        "fsActor",
                        {
                          type: "createFile",
                          data: {
                            name: "test2.txt",
                            content: "test content, zing zing zing",
                            parentPath: "/testDir/"
                          }
                        }
                      )
                    ],
                    on: {
                      createFileSuccess: {
                        target: "test16",
                        actions: [
                          (_, evt) => out(
                            `created file: ${
                              JSON.stringify(evt)
                            }`
                          ),
                          assign(
                            (ctx, evt) => ({
                              ...ctx,
                              testThreeFilePath: evt.newFilePath
                            })
                          )
                        ]
                      },
                      createFileFailure: {
                        actions: [
                          (_, evt) => out(
                            `create file fail: ${
                              evt.msg
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  test16: {
                    entry: [
                      () => out(
                        "getting dir record"
                      ),
                      sendTo(
                        "fsActor",
                        () => ({
                          type: "getDirectoryRecord",
                          data: {
                            path: "/testDir/"
                          }
                        })
                      )
                    ],
                    on: {
                      getDirectoryRecordSuccess: {
                        target: "test16_5",
                        actions: [
                          (_, evt) => out(
                            `got directory record: ${
                              JSON.stringify(
                                evt
                              )
                            }`
                          ),
                        ]
                      },
                      getDirectoryRecordFailure: {
                        actions: [
                          (_, evt) => out(
                            `get directory record fail: ${
                              JSON.stringify(
                                evt
                              )
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  test16_5: {
                    entry: [
                      () => out(
                        "ripping fs to json"
                      ),
                      sendTo(
                        "fsActor",
                        {
                          type: "ripFilesystemToJSON",
                        }
                      )
                    ],
                    on: {
                      ripFilesystemToJSONSuccess: {
                        target: "test17",
                        actions: [
                          (_, evt) => out(
                            `got fs json: ${
                              evt.backup
                            }`
                          ),
                          assign((ctx, evt) => ({
                            ...ctx,
                            backupForRestoreTest: evt.backup
                          }))
                        ]
                      },
                      ripFilesystemToJSONFailure: {
                        actions: [
                          (_, evt) => out(
                            `rip fs to json fail: ${
                              JSON.stringify(evt)
                            }`
                          )
                        ]
                      }
                    }
                  },
                  test17: {
                    // empty testDir
                    entry: [
                      () => out(
                        "emptying /testDir/"
                      ),
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
                        target: "test18",
                        actions: [
                          (_, evt) => out(
                            `emptyed directory: ${
                              JSON.stringify(
                                evt
                              )
                            }`
                          ),
                        ]
                      },
                      emptyDirectoryFailure: {
                        actions: [
                          (_, evt) => out(
                            `empty directory fail: ${
                              JSON.stringify(
                                evt
                              )
                            }`
                          )
                        ]
                      }
                    }
                  },
                  test18: {
                    // read testDir
                    entry: [
                      () => out(
                        "getting dir record"
                      ),
                      sendTo(
                        "fsActor",
                        () => ({
                          type: "getDirectoryRecord",
                          data: {
                            path: "/testDir/"
                          }
                        })
                      )
                    ],
                    on: {
                      getDirectoryRecordSuccess: {
                        target: "test19",
                        actions: [
                          (_, evt) => out(
                            `got directory record: ${
                              JSON.stringify(
                                evt
                              )
                            }`
                          ),
                        ]
                      },
                      getDirectoryRecordFailure: {
                        actions: [
                          (_, evt) => out(
                            `get directory record fail: ${
                              JSON.stringify(
                                evt
                              )
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  test19: {
                    // delete testDir
                    entry: [
                      () => out(
                        "deleting /testDir/"
                      ),
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
                        target: "test20",
                        actions: [
                          (_, evt) => out(
                            `deleted directory: ${
                              JSON.stringify(
                                evt
                              )
                            }`
                          ),
                        ]
                      },
                      deleteDirectoryIfEmptyFailure: {
                        actions: [
                          (_, evt) => out(
                            `delete directory fail: ${
                              JSON.stringify(
                                evt
                              )
                            }`
                          )
                        ]
                      }
                    }
                  },
                  test20: {
                    // read /
                    entry: [
                      () => out(
                        "getting dir record"
                      ),
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
                        target: "test21",
                        actions: [
                          (_, evt) => out(
                            `got directory record: ${
                              JSON.stringify(
                                evt
                              )
                            }`
                          ),
                        ]
                      },
                      getDirectoryRecordFailure: {
                        actions: [
                          (_, evt) => out(
                            `get directory record fail: ${
                              JSON.stringify(
                                evt
                              )
                            }`,
                            "ERROR"
                          ),
                        ]
                      }
                    }
                  },
                  test21: {
                    entry: [
                      sendTo(
                        "fsActor",
                        {
                          type: "close"
                        }
                      ),
                      () => out(
                        "restoring fs from backup"
                      ),
                      sendTo(
                        "fsActor",
                        ctx => ({
                          type: "restoreFilesystemFromJSON",
                          fsName: "restoredFs",
                          version: 1,
                          backup: ctx.backupForRestoreTest
                        })
                      )
                    ],
                    on: {
                      restoreFilesystemFromJSONSuccess: {
                        target: "test22",
                        actions: [
                          () => out(
                            "restored filesystem from backup"
                          )
                        ]
                      },
                      restoreFilesystemFromJSONFailure: {
                        actions: [
                          (_, evt) => out(
                            `restore filesystem from backup fail: ${
                              JSON.stringify(
                                evt
                              )
                            }`,
                            "ERROR"
                          )
                        ]
                      }
                    }
                  },
                  test22: {
                    // re-init fs 
                    entry: [
                      () => out(
                        "re-initializing fs"
                      ),
                      sendTo(
                        "fsActor",
                        {
                          type: "init",
                          filesystemName: "restoredFs",
                          version: 1
                        }
                      )
                    ],
                    on: {
                      vzfsAwaitingCommand: {
                        target: "test23",
                        actions: [
                          (_, evt) => out(
                            "vzfs awaiting command"
                          )
                        ]
                      }
                    }
                  },
                  test23: {
                    // to json
                    entry: [
                      () => out(
                        "ripping fs to json"
                      ),
                      sendTo(
                        "fsActor",
                        {
                          type: "ripFilesystemToJSON",
                        }
                      )
                    ],
                    on: {
                      ripFilesystemToJSONSuccess: {
                        actions: [
                          (_, evt) => out(
                            `got fs json: ${
                              evt.backup
                            }`
                          ),
                          assign((ctx, evt) => ({
                            ...ctx,
                            backupForRestoreTest: evt.backup
                          }))
                        ]
                      },
                      ripFilesystemToJSONFailure: {
                        actions: [
                          (_, evt) => out(
                            `rip fs to json fail: ${
                              JSON.stringify(evt)
                            }`
                          )
                        ]
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    )
  );
  tester.start()
}

export default storageHierarchyTest