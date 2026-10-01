import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const checklist = JSON.parse(
  readFileSync(new URL("../shared/checklist.json", import.meta.url)),
);
const cafes = JSON.parse(
  readFileSync(new URL("../shared/cafes.json", import.meta.url)),
);

function flatten(source) {
  return source.sections.flatMap((section) => section.questions);
}

test("Approved checklist is preserved verbatim, including all photo flags", () => {
  const source = readFileSync(
    new URL("../docs/checklist-source.md", import.meta.url),
    "utf8",
  );
  const rows = [...source.matchAll(/^\| (\d+\.\d+) \| (.+?) \| (.+?) \|$/gm)];
  assert.equal(rows.length, 136);
  assert.equal(flatten(checklist).length, 136);
  assert.deepEqual(
    flatten(checklist),
    rows.map((r) => ({
      id: r[1],
      text: r[2],
      photoRequired: r[3].includes("обязательно"),
    })),
  );
  assert.equal(flatten(checklist).filter((q) => q.photoRequired).length, 10);
  assert.equal(checklist.sections.length, 12);
});

test("Cafe list contains Garden cafes and uses the standard checklist", () => {
  assert.equal(cafes.length, 19);
  assert(cafes.some((c) => c.id === "sverdlova" && c.name === "Garden · Свердлова"));
  assert(cafes.some((c) => c.id === "dramteatr" && c.name === "Garden · Драмтеатр"));
  assert.equal(flatten(checklist).length, 136);
});

test("Interface copy describes the web pilot with central Supabase sync", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(app, /Сохраняем данные/);
  assert.match(app, /Обход завершён и отправлен в общую базу Garden/);
  assert.doesNotMatch(app, /адрес сервера|API-сервер|Server URL/i);
  assert.match(api, /localStorage/);
  assert.match(api, /supabaseUrl/);
  assert.match(api, /garden_inspections/);
  assert.match(api, /radaev_andrey/);
  assert.match(api, /baranyuk_kolya/);
});




test("Photo decoder tolerates mobile browser base64 variants", () => {
  const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(api, /function normalizeBase64Payload/);
  assert.match(api, /replace\(\/\\s\/g, ""\)/);
  assert.match(api, /replace\(\/-\/g, "\+"\)/);
  assert.match(api, /replace\(\/_\/g, "\/"\)/);
  assert.match(api, /padEnd/);
  assert.match(api, /Фото не удалось сохранить/);
});

test("Corrupted cached photos cannot blank the app during migration", () => {
  const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(api, /Garden skipped corrupted cached photo/);
  assert.match(api, /catch \(error\) \{\n      console\.warn\("Garden skipped corrupted cached photo"/);
});

test("Camera photo handling avoids nested data URI decode failures", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(app, /function cameraPhotoToUri/);
  assert.match(app, /picture\?\.base64 \|\| picture\?\.uri/);
  assert.match(api, /nestedPayload\.startsWith\("data:"\)/);
});

test("Manager credentials are individual and photo sync status is visible", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  const guide = readFileSync(new URL("../docs/manager-instruction.md", import.meta.url), "utf8");
  assert.doesNotMatch(api, /Garden-demo-2026!/);
  assert.match(api, /Garden-Sverdlova-2468!/);
  assert.match(api, /format=status/);
  assert.match(app, /PhotoSyncStatus/);
  assert.match(app, /Фото есть в общей базе/);
  assert.match(guide, /Если появилась ошибка связи/);
  assert.match(guide, /radaev_andrey/);
});
