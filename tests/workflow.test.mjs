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

test("Pilot cafe list contains only Sverdlova and uses the standard checklist", () => {
  assert.deepEqual(cafes, [
    {
      name: "Garden · Свердлова",
      id: "sverdlova",
      address: "",
    },
  ]);
  assert.equal(flatten(checklist).length, 136);
});

test("Interface copy describes the serverless web pilot", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(app, /Сохраняем данные/);
  assert.match(app, /Обход завершён и сохранён на этом устройстве/);
  assert.doesNotMatch(app, /адрес сервера|API-сервер|Server URL/i);
  assert.match(api, /localStorage/);
  assert.match(api, /andrey/);
});
