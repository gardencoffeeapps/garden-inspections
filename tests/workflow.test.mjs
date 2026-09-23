import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jpegCodec from "../server/vendor/jpeg-js/index.js";
import { createGardenServer } from "../server/index.mjs";
import { flatten, questionsFor } from "../server/domain.mjs";
const checklist = JSON.parse(
  readFileSync(new URL("../shared/checklist.json", import.meta.url)),
);
const cafes = JSON.parse(
  readFileSync(new URL("../shared/cafes.json", import.meta.url)),
);
// Real encoded test image. It is never exposed in the application's database.
const jpeg = jpegCodec
  .encode(
    { width: 320, height: 240, data: Buffer.alloc(320 * 240 * 4, 128) },
    50,
  )
  .data.toString("base64");
const corruptJpeg = Buffer.concat([
  Buffer.from([255, 216, 255]),
  Buffer.alloc(128),
  Buffer.from([255, 217]),
]).toString("base64");
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
test("All cafes receive the same complete 136-question checklist", () => {
  for (const cafe of [...cafes, { id: "new-cafe", equipment: [] }]) {
    const point = questionsFor(checklist, cafe);
    assert.equal(flatten(point).length, 136);
    assert.deepEqual(point, checklist);
    assert.notEqual(point, checklist);
  }
});
test("Server enforces the complete inspection lifecycle", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "garden-test-"));
  const dbPath = join(dir, "test.sqlite");
  let app = createGardenServer({ dbPath });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  let base = `http://127.0.0.1:${app.server.address().port}/api`;
  async function call(path, method = "GET", body, token = "") {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  }
  const login = async (name) =>
    (
      await call("/login", "POST", {
        login: name,
        password: "Garden-demo-2026!",
      })
    ).data.token;
  const manager = await login("manager"),
    other = await login("manager2"),
    admin = await login("admin"),
    andrey = await login("andrey");
  let run;
  try {
    await t.test(
      "Authentication, assigned cafes and role boundaries",
      async () => {
        const points = (await call("/cafes", "GET", undefined, andrey)).data;
        assert.deepEqual(points.map(c=>c.id), ["sverdlova"]);
        assert.equal(points[0].name, "Garden · Свердлова");
        const pilot = await call("/inspections", "POST", {cafeId:"sverdlova"}, andrey);
        assert.equal(pilot.status, 201);
        assert.equal(pilot.data.user.name, "Андрей");
        assert.equal(flatten(pilot.data.snapshot).length, 136);
        assert.equal((await call("/cafes")).status, 401);
        assert.equal(
          (
            await call("/login", "POST", {
              login: "manager",
              password: "wrong",
            })
          ).status,
          401,
        );
        assert.equal(
          (await call("/cafes", "GET", undefined, other)).data.length,
          1,
        );
        assert.equal(
          (await call("/inspections", "POST", { cafeId: "demo-1" }, other))
            .status,
          403,
        );
        assert.equal(
          (await call("/inspections", "POST", { cafeId: "demo-1" }, admin))
            .status,
          403,
        );
      },
    );
    await t.test(
      "Creation records server time and identity; resume is idempotent",
      async () => {
        const r = await call(
          "/inspections",
          "POST",
          { cafeId: "demo-1", userId: "admin", startedAt: "1900-01-01" },
          manager,
        );
        assert.equal(r.status, 201);
        run = r.data;
        assert.equal(run.user.id, "manager-1");
        assert(Date.now() - Date.parse(run.startedAt) < 5000);
        assert.equal(
          (await call("/inspections", "POST", { cafeId: "demo-1" }, manager))
            .data.id,
          run.id,
        );
        assert.equal(
          (await call(`/inspections/${run.id}`, "GET", undefined, other))
            .status,
          403,
        );
        assert.equal(
          (await call(`/inspections/${run.id}`, "GET", undefined, admin))
            .status,
          200,
        );
      },
    );
    await t.test(
      "Submission with unanswered questions is rejected",
      async () => {
        const r = await call(
          `/inspections/${run.id}/submit`,
          "POST",
          { revision: 0 },
          manager,
        );
        assert.equal(r.status, 422);
        assert.equal(r.data.details.length, 136);
      },
    );
    await t.test(
      "Whitespace comments, unexpected questions and stale revisions are rejected",
      async () => {
        const route = `/inspections/${run.id}/answers`;
        assert.equal(
          (
            await call(
              route,
              "PUT",
              { revision: 0, questionId: "1.2", value: "no", comment: "  " },
              manager,
            )
          ).status,
          422,
        );
        assert.equal(
          (
            await call(
              route,
              "PUT",
              { revision: 0, questionId: "unknown", value: "yes" },
              manager,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              route,
              "PUT",
              { revision: 99, questionId: "1.2", value: "yes" },
              manager,
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      "Photos require a critical question and belong to that question and run",
      async () => {
        const route = `/inspections/${run.id}/photos`;
        assert.equal(
          (
            await call(
              route,
              "POST",
              { questionId: "1.2", base64: jpeg },
              manager,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              route,
              "POST",
              { questionId: "1.1", base64: "no" },
              manager,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              route,
              "POST",
              { questionId: "1.1", base64: corruptJpeg },
              manager,
            )
          ).status,
          400,
        );
        const tooSmall = jpegCodec
          .encode({ width: 1, height: 1, data: Buffer.alloc(4) }, 50)
          .data.toString("base64");
        assert.equal(
          (
            await call(
              route,
              "POST",
              { questionId: "1.1", base64: tooSmall },
              manager,
            )
          ).status,
          400,
        );
        const photo = (
          await call(
            route,
            "POST",
            { questionId: "1.1", base64: jpeg },
            manager,
          )
        ).data;
        assert.equal(
          (await call(`/api/photos/${photo.id}`, "GET", undefined, other))
            .status,
          404,
        );
        assert.equal(
          (
            await call(
              `/photos/${photo.id}?format=data`,
              "GET",
              undefined,
              other,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call(
              `/photos/${photo.id}?format=data`,
              "GET",
              undefined,
              admin,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await call(
              `/inspections/${run.id}/answers`,
              "PUT",
              {
                revision: 0,
                questionId: "2.1",
                value: "yes",
                photoId: photo.id,
              },
              manager,
            )
          ).status,
          400,
        );
        const second = (
          await call("/inspections", "POST", { cafeId: "demo-2" }, manager)
        ).data;
        assert.equal(
          (
            await call(
              `/inspections/${second.id}/answers`,
              "PUT",
              {
                revision: 0,
                questionId: "1.1",
                value: "yes",
                photoId: photo.id,
              },
              manager,
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      "All answers alone are insufficient without the ten mandatory photos",
      async () => {
        for (const q of flatten(run.snapshot)) {
          const r = await call(
            `/inspections/${run.id}/answers`,
            "PUT",
            {
              revision: run.revision,
              questionId: q.id,
              value: q.id === "1.4" ? "no" : "yes",
              comment: q.id === "1.4" ? "Повреждена урна справа" : "",
            },
            manager,
          );
          assert.equal(r.status, 200);
          run = r.data;
        }
        const missing = await call(
          `/inspections/${run.id}/submit`,
          "POST",
          { revision: run.revision },
          manager,
        );
        assert.equal(missing.status, 422);
        assert.equal(missing.data.details.length, 10);
      },
    );
    await t.test(
      "Photo-complete inspection submits exactly once with frozen content and audit",
      async () => {
        for (const q of flatten(run.snapshot).filter((q) => q.photoRequired)) {
          const p = await call(
            `/inspections/${run.id}/photos`,
            "POST",
            { questionId: q.id, base64: jpeg },
            manager,
          );
          assert.equal(p.status, 201);
          const r = await call(
            `/inspections/${run.id}/answers`,
            "PUT",
            {
              revision: run.revision,
              questionId: q.id,
              value: "yes",
              photoId: p.data.id,
            },
            manager,
          );
          assert.equal(r.status, 200);
          run = r.data;
        }
        const submitted = await call(
          `/inspections/${run.id}/submit`,
          "POST",
          { revision: run.revision },
          manager,
        );
        assert.equal(submitted.status, 200);
        run = submitted.data;
        assert.equal(run.status, "submitted");
        assert.equal(run.checksum.length, 64);
        assert(Date.parse(run.finishedAt) >= Date.parse(run.startedAt));
        const retry = await call(
          `/inspections/${run.id}/submit`,
          "POST",
          { revision: 0 },
          manager,
        );
        assert.deepEqual(retry.data, run);
        const audit = (
          await call(`/inspections/${run.id}/audit`, "GET", undefined, admin)
        ).data;
        assert.deepEqual(
          audit.map((e) => e.action),
          ["started", "submitted"],
        );
        assert.equal(JSON.parse(audit[1].detail).checksum, run.checksum);
      },
    );
    await t.test(
      "Post-submit API and database mutations are blocked, including admin writes",
      async () => {
        assert.equal(
          (
            await call(
              `/inspections/${run.id}/answers`,
              "PUT",
              { revision: run.revision, questionId: "1.4", value: "yes" },
              manager,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await call(
              `/inspections/${run.id}/photos`,
              "POST",
              { questionId: "1.1", base64: jpeg },
              manager,
            )
          ).status,
          409,
        );
        assert.equal(
          (await call(`/inspections/${run.id}/answers`, "PUT", {}, admin))
            .status,
          403,
        );
        assert.throws(
          () =>
            app.db
              .prepare("UPDATE inspections SET answers='{}' WHERE id=?")
              .run(run.id),
          /immutable/,
        );
        assert.throws(
          () =>
            app.db.prepare("DELETE FROM inspections WHERE id=?").run(run.id),
          /immutable/,
        );
        assert.throws(
          () =>
            app.db
              .prepare("UPDATE photos SET bytes=? WHERE inspection_id=?")
              .run(Buffer.alloc(1), run.id),
          /immutable/,
        );
        assert.throws(
          () =>
            app.db
              .prepare("DELETE FROM audit WHERE inspection_id=?")
              .run(run.id),
          /append only/,
        );
      },
    );
    await t.test(
      "Management summaries expose cafe totals; manager sees only own records",
      async () => {
        const summaries = (
          await call("/inspections?cafeId=demo-1", "GET", undefined, admin)
        ).data;
        assert.equal(summaries.length, 1);
        assert.equal(summaries[0].issues, 1);
        assert.equal(summaries[0].completed, 136);
        assert.equal(
          (await call("/inspections", "GET", undefined, other)).data.length,
          0,
        );
      },
    );
    await t.test(
      "Results, sessions and protections survive server restart",
      async () => {
        await app.close();
        app = createGardenServer({ dbPath });
        await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
        base = `http://127.0.0.1:${app.server.address().port}/api`;
        const restored = await call(
          `/inspections/${run.id}`,
          "GET",
          undefined,
          manager,
        );
        assert.deepEqual(restored.data, run);
        assert.equal(
          (await call(`/inspections/${run.id}/answers`, "PUT", {}, manager))
            .status,
          409,
        );
      },
    );
  } finally {
    await app.close();
  }
});
