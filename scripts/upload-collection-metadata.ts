#!/usr/bin/env tsx
/**
 * One-shot helper that uploads the OpenSea collection metadata to IPFS via
 * Lighthouse and prints the resulting `ipfs://<cid>` URI. Pipe the output
 * into the Ignition deploy as the `workspaceNftContractURI` parameter:
 *
 *   export LIGHTHOUSE_API_KEY="<your-key>"
 *   CID=$(npx tsx scripts/upload-collection-metadata.ts)
 *   npx hardhat ignition deploy ignition/modules/Codequill.ts \
 *     --network baseSepolia \
 *     --parameters "{\"CodeQuill\":{\"workspaceNftContractURI\":\"$CID\"}}"
 *
 * The script uploads two files:
 *   1. collection-meta/logo.svg  →  used as the collection image
 *   2. a JSON document derived from collection-meta/collection.json.template
 *      with {{LOGO_CID}} substituted to the logo's IPFS CID
 *
 * The script is idempotent in content: identical inputs produce identical
 * CIDs (IPFS is content-addressed), so re-running it is safe. The Lighthouse
 * API key must be set in env (LIGHTHOUSE_API_KEY). Get one at
 * https://files.lighthouse.storage.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `__dirname` isn't defined under ESM — derive it from `import.meta.url`.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LIGHTHOUSE_UPLOAD_ENDPOINT = "https://upload.lighthouse.storage/api/v0/add";

async function uploadFile(
  filePath: string,
  apiKey: string,
  mime: string,
): Promise<string> {
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes], { type: mime }),
    path.basename(filePath),
  );

  const res = await fetch(LIGHTHOUSE_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(
      `Lighthouse upload failed (${res.status}): ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { Hash?: string };
  if (!body.Hash) {
    throw new Error(`Lighthouse response missing Hash: ${JSON.stringify(body)}`);
  }
  return body.Hash;
}

async function main() {
  const apiKey = process.env.LIGHTHOUSE_API_KEY;
  if (!apiKey) {
    console.error(
      "Set LIGHTHOUSE_API_KEY in env (export LIGHTHOUSE_API_KEY=...).",
    );
    process.exit(1);
  }

  const root = path.join(__dirname, "..", "collection-meta");
  const logoPath = path.join(root, "logo.svg");
  const templatePath = path.join(root, "collection.json.template");

  if (!fs.existsSync(logoPath) || !fs.existsSync(templatePath)) {
    console.error(`Missing assets under ${root}.`);
    process.exit(1);
  }

  process.stderr.write("Uploading collection logo… ");
  const logoCid = await uploadFile(logoPath, apiKey, "image/svg+xml");
  process.stderr.write(`${logoCid}\n`);

  const template = fs.readFileSync(templatePath, "utf8");
  const collectionJson = template.replace("{{LOGO_CID}}", logoCid);

  // Write the materialised JSON to a temp file so we can pass a Blob with a
  // stable filename — Lighthouse uses the filename in pinning metadata.
  const tmpPath = path.join(root, ".collection.json");
  fs.writeFileSync(tmpPath, collectionJson);

  process.stderr.write("Uploading collection.json… ");
  const collectionCid = await uploadFile(tmpPath, apiKey, "application/json");
  fs.unlinkSync(tmpPath);
  process.stderr.write(`${collectionCid}\n`);

  // The clean stdout line is the contractURI you pass into Ignition.
  process.stdout.write(`ipfs://${collectionCid}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
