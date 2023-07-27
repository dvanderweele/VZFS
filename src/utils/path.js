

function normalize(path, cwdArr){
  if(!/^[a-zA-Z0-9_/.-]*$/.test(path)) throw "Invalid character(s) in path."
  if(path === "/..") throw "Invalid path";
  if (path === "/.") path = "/";
  if (/\/\.\.$/.test(path)) path = `${path}/`;
  path = path
    .split("/")
    .reduce((acc, curr) => {
      if (acc.length === 0 || curr !== acc[acc.length - 1]) {
        acc.push(curr);
      }
      return acc;
    }, [])
    .filter((v, i, a) => !(i > 0 && i < a.length - 1 && v === ""))
  if (path.length === 1) {
    return `/${path
      .reduce((acc, curr) => {
        if (curr === ".") return acc;
        if (curr === "..") return acc.slice(0, -1);
        return [...acc, curr];
      }, [])
      .join("/")}`
  } else if (path[0] === "") {
    const res = `${path
      .reduce((acc, curr) => {
        if (curr === ".") return acc;
        if (curr === "..") return acc.slice(0, -1);
        return [...acc, curr];
      }, [])
      .join("/")}`
    if(res === "") throw "Invalid path";
    return res
  } else {
    const joinableCandidates = [...cwdArr, ...path];
    const res = `${joinableCandidates
      .reduce((acc, curr) => {
        if (curr === ".") return acc;
        if (curr === "..") return acc.slice(0, -1);
        return [...acc, curr];
      }, [])
      .join("/")}`
    if(res === "") throw "Invalid path";
    return res
  }
}

function absPathToPieces(path) {
  return path.split("/")
    .reduce((acc, curr) => {
      if (acc.length === 0 || curr !== acc[acc.length - 1]) {
        acc.push(curr);
      }
      return acc;
    }, [])
    .filter((v, i, a) => !(i > 0 && i < a.length - 1 && v === ""))
}

export { normalize, absPathToPieces }





