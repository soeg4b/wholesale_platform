// Entry point so that `node --test tests/` works on Node >= 21, where a directory argument is resolved
// as a module (-> tests/index.js) instead of being scanned. It loads every *.test.mjs in one process, in a
// fixed order (unit first, integration alphabetically, ledger check last), so suites never race each other
// for shared demo data such as the buyer's per-link open-ticket cap.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const list = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.test.mjs'))
        .sort()
        .map((f) => path.join(dir, f))
    : [];

const files = [...list(path.join(__dirname, 'unit')), ...list(path.join(__dirname, 'integration'))];

(async () => {
  for (const f of files) await import(pathToFileURL(f).href);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
