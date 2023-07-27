import * as esbuild from 'esbuild';
import http from "http"
import { readFile } from "fs/promises"

const test = true

if(test){
  await esbuild.build({
    entryPoints: ['./tests/index.js'],
    bundle: true,
    minify: true,
    outfile: './tests/out.js',
  })
  const html = await readFile("./tests/index.html")
  const js = await readFile("./tests/out.js")
  http.createServer((req, res) => {
    if(req.url === "/" || req.url === "/index.html"){
      res.writeHead(200)
      res.end(html)
    } else if(req.url === "/out.js"){
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
}

