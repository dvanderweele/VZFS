import * as esbuild from 'esbuild';
import http from "http"
import { readFile } from "fs/promises"

await esbuild.build({
  entryPoints: ['./tests/index.js'],
  bundle: true,
  minify: true,
  outfile: './tests/out.js'
})
const indexHTML = await readFile(
  "./index.html"
)
const vzfsTestHTML = await readFile(
  "./tests/index.html"
)
const js = await readFile(
  "./tests/out.js"
)
const vzfsDocsHTML = await readFile(
  "./vzfs_docs.html"
)
http.createServer((req, res) => {
  if(
    req.url === "/" || 
    req.url === "index.html"
  ){
    res.writeHead(200)
    res.end(indexHTML)
  } else if(
    req.url === "/vzfs" || 
    req.url === "/vzfs/docs"
  ){
    res.writeHead(200)
    res.end(vzfsDocsHTML)
  } else if(
    req.url === "/vzfs/test"
  ){
    res.writeHead(200)
    res.end(vzfsTestHTML)
  }else if(
    req.url === "/out.js"
  ){

    res.writeHead(200)
    res.end(js)
  } else {
    res.writeHead(404)
    res.end()
  }
}).listen(
  443, 
  "0.0.0.0"
)

