import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { tests } from "./harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(here).filter((f) => f.endsWith(".test.js")).sort();

async function main() {
  for (const f of files) {
    await import(pathToFileURL(path.join(here, f)).href);
  }
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`ok   ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${t.name}\n     ${(e && e.stack) || e}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (node ${process.version})`);
  process.exit(failed ? 1 : 0);
}

main();
