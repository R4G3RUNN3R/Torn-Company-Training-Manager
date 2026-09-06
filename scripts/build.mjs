import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const header = await readFile(resolve(root, "src/userscript-header.txt"), "utf8");
const outfile = resolve(root, "dist/Torn Company Training Manager.user.js");
await mkdir(dirname(outfile), { recursive: true });

let output;
try {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: [resolve(root, "src/main.js")],
    bundle: true,
    format: "iife",
    target: "es2022",
    write: false,
    sourcemap: false,
    legalComments: "none"
  });
  output = result.outputFiles[0].text;
} catch (error) {
  // Dependency-free fallback used in restricted build environments.
  // It supports the static named imports/exports used by this project.
  const modules = new Map();
  const entry = resolve(root, "src/main.js");
  const importRe = /^\s*import\s+\{([^}]+)\}\s+from\s+["'](.+?)["'];?\s*$/gm;

  async function collect(file) {
    if (modules.has(file)) return;
    const source = await readFile(file, "utf8");
    modules.set(file, source);
    const base = dirname(file);
    for (const match of source.matchAll(importRe)) {
      await collect(resolve(base, match[2]));
    }
  }

  await collect(entry);
  const ids = new Map([...modules.keys()].map((file, i) => [file, `m${i}`]));

  function transform(file, source) {
    const base = dirname(file);
    const exports = [];
    let code = source.replace(importRe, (_m, names, spec) => {
      const dep = resolve(base, spec);
      return `const { ${names.trim()} } = __require(${JSON.stringify(ids.get(dep))});`;
    });
    code = code.replace(/\bexport\s+(async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g, (_m, kind, name) => {
      exports.push(name);
      return `${kind} ${name}`;
    });
    code = code.replace(/\bexport\s*\{([^}]+)\};?/g, (_m, list) => {
      for (const part of list.split(",")) {
        const [local, exported] = part.trim().split(/\s+as\s+/);
        exports.push({ local, exported: exported || local });
      }
      return "";
    });
    const exportLines = exports.map((item) => {
      if (typeof item === "string") return `exports.${item} = ${item};`;
      return `exports.${item.exported} = ${item.local};`;
    }).join("\n");
    return `${code}\n${exportLines}`;
  }

  const defs = [...modules.entries()].map(([file, source]) => {
    return `${JSON.stringify(ids.get(file))}: function(module, exports, __require) {\n${transform(file, source)}\n}`;
  }).join(",\n");
  output = `(function(){\n"use strict";\nconst __mods={${defs}};\nconst __cache={};\nfunction __require(id){if(__cache[id])return __cache[id].exports;const module={exports:{}};__cache[id]=module;__mods[id](module,module.exports,__require);return module.exports;}\n__require(${JSON.stringify(ids.get(entry))});\n})();\n`;
}

await writeFile(outfile, `${header.trimEnd()}\n\n${output.trimStart()}`, "utf8");
console.log(`Built ${outfile}`);
