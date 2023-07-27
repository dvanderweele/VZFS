import { normalize, absPathToPieces } from "../src/utils/path.js"

const paths = [
  "/home/user/file.js",
  "/absolute/path/to/file.js",
  "relative/path/to/file.js",
  "../relative/path/to/file.js",
  "./relative/path/to/file.js",
  "/root/directory/../file.js",
  "file.js",
  "../../../file.js",
  "/home/user/../file.js",
  "../file.js",
  "./file.js",
  "/root/directory/./file.js",
  // Edge cases
  "",
  "/",
  "../",
  "./",
  ".../",
  "/..",
  "/.",
  "/../",
  "../../../",
  "/../../..",
  "../../../..",
  "/../../../../",
  ".",
  "..",
  "//",
  "////",
  ".//file.js",
  "..//file.js",
  "directory/",
  "directory/..",
  "../directory/",
  "./directory/",
];

function pathTest(){
  const cwd = ["", "abc", "123"]
  paths.forEach(p => {
    try {
      console.log(`original: ${p}`)
      console.log(`normalized: ${normalize(p, cwd)}`)
      console.log(`pieces: ${JSON.stringify(absPathToPieces(normalize(p, cwd)))}`)
      console.log(
        `renormalized: ${
          normalize(
            absPathToPieces(
              normalize(p, cwd)
            ).join(
              "/"
            ), cwd
          )
        }`
      )
      console.log("--------")
    } catch(e){
      console.log(e)
    }
  })
}

export default pathTest


