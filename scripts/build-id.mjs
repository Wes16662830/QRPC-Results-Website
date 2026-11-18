// Writes the build id shared by the site and the API, so an open page can tell it is out of date.
import { writeFileSync } from "node:fs";
const id = process.env.CF_PAGES_COMMIT_SHA ? process.env.CF_PAGES_COMMIT_SHA.slice(0, 12) : `local-${Date.now().toString(36)}`;
writeFileSync(new URL("../src/generated/build.ts", import.meta.url), `// Generated at build time by scripts/build-id.mjs.\nexport const BUILD_ID = ${JSON.stringify(id)};\n`);
console.log(`build id ${id}`);
