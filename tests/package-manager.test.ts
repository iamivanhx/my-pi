import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("uses pnpm through sfw for project and Pi package installation", async () => {
  const [manifest, settings] = await Promise.all([
    readFile("package.json", "utf8").then((contents) => JSON.parse(contents) as { packageManager?: string }),
    readFile(".pi/settings.json", "utf8").then((contents) => JSON.parse(contents) as { npmCommand?: string[] }),
  ]);

  assert.equal(manifest.packageManager, "pnpm@10.33.1");
  assert.equal(settings.npmCommand?.[0], "node");
  assert.equal(settings.npmCommand?.[1], "-e");
  assert.match(settings.npmCommand?.[2] ?? "", /spawnSync\('sfw', \['pnpm'/);
  assert.match(settings.npmCommand?.[2] ?? "", /--config\.autoInstallPeers=false/);
  assert.equal(settings.npmCommand?.[3], "sfw-pnpm");
});

test("translates Pi's npm-only flags before invoking sfw pnpm", async () => {
  const [settings, directory] = await Promise.all([
    readFile(".pi/settings.json", "utf8").then((contents) => JSON.parse(contents) as { npmCommand: string[] }),
    mkdtemp(join(tmpdir(), "my-pi-sfw-")),
  ]);
  const sfw = join(directory, "sfw");
  const argsPath = join(directory, "args.txt");

  try {
    await writeFile(sfw, "#!/usr/bin/env sh\nprintf '%s\\n' \"$@\" > \"$SFW_ARGS_FILE\"\n");
    await chmod(sfw, 0o755);
    const result = spawnSync(
      settings.npmCommand[0],
      [...settings.npmCommand.slice(1), "install", "example-package", "--legacy-peer-deps", "--omit=dev"],
      {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, SFW_ARGS_FILE: argsPath },
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual((await readFile(argsPath, "utf8")).trim().split("\n"), [
      "pnpm",
      "install",
      "example-package",
      "--strict-peer-dependencies=false",
      "--config.autoInstallPeers=false",
      "--prod",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
