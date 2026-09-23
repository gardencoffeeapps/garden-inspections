import { createServer } from "node:http";
import jpeg from "./vendor/jpeg-js/index.js";
import { DatabaseSync } from "node:sqlite";
import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { questionsFor, flatten, errorsFor, digest } from "./domain.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checklist = JSON.parse(
  readFileSync(resolve(root, "shared/checklist.json"), "utf8"),
);
const initialCafes = JSON.parse(
  readFileSync(resolve(root, "shared/cafes.json"), "utf8"),
);
const now = () => new Date().toISOString();
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const fail = (status, message, details) => {
  throw Object.assign(new Error(message), { status, details });
};
const userView = (u) => ({
  id: u.id,
  name: u.name,
  role: u.role,
  cafeIds: JSON.parse(u.cafes),
});
export function createGardenServer({
  dbPath = resolve(root, "server/data/garden.sqlite"),
  password = process.env.GARDEN_DEMO_PASSWORD || "Garden-demo-2026!",
  staticDir = resolve(root, "dist"),
} = {}) {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('manager','admin')), cafes TEXT NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cafes(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inspections(id TEXT PRIMARY KEY, cafe_id TEXT NOT NULL REFERENCES cafes(id), user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL CHECK(status IN ('draft','submitted')), started_at TEXT NOT NULL, finished_at TEXT, revision INTEGER NOT NULL DEFAULT 0, snapshot TEXT NOT NULL, answers TEXT NOT NULL DEFAULT '{}', checksum TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS one_draft ON inspections(user_id,cafe_id) WHERE status='draft';
    CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY, inspection_id TEXT NOT NULL REFERENCES inspections(id), question_id TEXT NOT NULL, created_at TEXT NOT NULL, bytes BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, inspection_id TEXT NOT NULL REFERENCES inspections(id), user_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, at TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS frozen_update BEFORE UPDATE ON inspections WHEN OLD.status='submitted' BEGIN SELECT RAISE(ABORT,'Submitted inspections are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS frozen_delete BEFORE DELETE ON inspections WHEN OLD.status='submitted' BEGIN SELECT RAISE(ABORT,'Submitted inspections are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS photo_frozen_insert BEFORE INSERT ON photos WHEN (SELECT status FROM inspections WHERE id=NEW.inspection_id)='submitted' BEGIN SELECT RAISE(ABORT,'Submitted photos are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS photo_no_update BEFORE UPDATE ON photos BEGIN SELECT RAISE(ABORT,'Photos are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS photo_no_delete BEFORE DELETE ON photos WHEN (SELECT status FROM inspections WHERE id=OLD.inspection_id)='submitted' BEGIN SELECT RAISE(ABORT,'Submitted photos are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit is append only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit is append only'); END;
  `);
  for (const c of initialCafes)
    db.prepare("INSERT OR IGNORE INTO cafes VALUES(?,?)").run(
      c.id,
      JSON.stringify(c),
    );
  for (const u of [
    ["andrey-sverdlova", "andrey", "Андрей", "manager", ["sverdlova"]],
    [
      "manager-1",
      "manager",
      "Управляющий · демо",
      "manager",
      ["demo-1", "demo-2"],
    ],
    [
      "manager-2",
      "manager2",
      "Второй управляющий · демо",
      "manager",
      ["demo-2"],
    ],
    ["admin", "admin", "Руководитель · демо", "admin", ["demo-1", "demo-2"]],
  ]) {
    const salt = randomBytes(16).toString("hex");
    db.prepare("INSERT OR IGNORE INTO users VALUES(?,?,?,?,?,?,?)").run(
      ...u.slice(0, 4),
      JSON.stringify(u[4]),
      salt,
      scryptSync(password, salt, 64).toString("hex"),
    );
  }
  const photosFor = (id) =>
    db
      .prepare(
        "SELECT id, question_id AS questionId, created_at AS createdAt FROM photos WHERE inspection_id=?",
      )
      .all(id);
  function full(row) {
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(row.user_id);
    return {
      id: row.id,
      cafeId: row.cafe_id,
      user: userView(user),
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      revision: row.revision,
      snapshot: JSON.parse(row.snapshot),
      answers: JSON.parse(row.answers),
      photos: photosFor(row.id),
      checksum: row.checksum,
    };
  }
  function load(id, u, write = false) {
    const r = db.prepare("SELECT * FROM inspections WHERE id=?").get(id);
    if (!r) fail(404, "Обход не найден");
    if (write ? r.user_id !== u.id : u.role !== "admin" && r.user_id !== u.id)
      fail(403, "Нет доступа к этому обходу");
    if (write && r.status !== "draft")
      fail(409, "Обход уже отправлен и защищён от изменений");
    return r;
  }
  const log = (id, u, action, detail = {}) =>
    db
      .prepare(
        "INSERT INTO audit(inspection_id,user_id,action,at,detail) VALUES(?,?,?,?,?)",
      )
      .run(id, u.id, action, now(), JSON.stringify(detail));
  const attempts = new Map();
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowed = (
      process.env.GARDEN_ALLOWED_ORIGINS ||
      "http://localhost:8081,http://localhost:8787,http://127.0.0.1:8787,http://127.0.0.1:8081"
    ).split(",");
    if (origin && allowed.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    const send = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    try {
      if (origin && !allowed.includes(origin))
        fail(403, "Источник запроса не разрешён");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname;
      let body = {};
      if (["POST", "PUT"].includes(req.method)) {
        let size = 0,
          chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 8 * 1024 * 1024)
            fail(413, "Фото слишком большое. Снимите ещё раз.");
          chunks.push(chunk);
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        } catch {
          fail(400, "Некорректный JSON");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          fail(400, "Некорректный запрос");
      }
      if (path === "/api/health")
        return send(200, {
          ok: true,
          mode: "prototype",
          version: checklist.version,
        });
      if (path === "/api/login" && req.method === "POST") {
        const key = req.socket.remoteAddress;
        const window = attempts.get(key) || {
          count: 0,
          until: Date.now() + 60000,
        };
        if (window.until < Date.now()) {
          window.count = 0;
          window.until = Date.now() + 60000;
        }
        attempts.set(key, window);
        if (++window.count > 15)
          fail(429, "Слишком много попыток. Подождите минуту.");
        if (
          typeof body.login !== "string" ||
          typeof body.password !== "string" ||
          body.password.length > 200
        )
          fail(400, "Введите логин и пароль");
        const u = db
          .prepare("SELECT * FROM users WHERE login=?")
          .get(body.login.trim());
        if (
          !u ||
          !timingSafeEqual(
            scryptSync(body.password, u.salt, 64),
            Buffer.from(u.password, "hex"),
          )
        )
          fail(401, "Неверный логин или пароль");
        const token = randomBytes(32).toString("hex");
        db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
          hashToken(token),
          u.id,
          Date.now() + 12 * 60 * 60 * 1000,
        );
        return send(200, { token, user: userView(u) });
      }
      if (!path.startsWith("/api/")) {
        if (req.method !== "GET") fail(405, "Метод не поддерживается");
        const requested = resolve(staticDir, "." + decodeURIComponent(path));
        if (requested !== staticDir && !requested.startsWith(staticDir + sep))
          fail(403, "Нет доступа");
        const file =
          existsSync(requested) && extname(requested)
            ? requested
            : resolve(staticDir, "index.html");
        if (!existsSync(file))
          fail(404, "Сначала соберите веб-версию: pnpm build:web");
        const mime =
          {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript",
            ".css": "text/css",
            ".png": "image/png",
            ".ico": "image/x-icon",
            ".svg": "image/svg+xml",
            ".ttf": "font/ttf",
            ".json": "application/json",
            ".webmanifest": "application/manifest+json",
          }[extname(file)] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        return res.end(readFileSync(file));
      }
      const token = (req.headers.authorization || "").replace(/^Bearer /, "");
      const u = db
        .prepare(
          "SELECT users.* FROM users JOIN sessions ON sessions.user_id=users.id WHERE sessions.token=? AND sessions.expires>?",
        )
        .get(hashToken(token), Date.now());
      if (!u) fail(401, "Войдите в приложение");
      if (path === "/api/logout" && req.method === "POST") {
        db.prepare("DELETE FROM sessions WHERE token=?").run(hashToken(token));
        return send(200, { ok: true });
      }
      if (path === "/api/me" && req.method === "GET")
        return send(200, userView(u));
      if (path === "/api/cafes" && req.method === "GET")
        return send(
          200,
          db
            .prepare("SELECT data FROM cafes")
            .all()
            .map((r) => JSON.parse(r.data))
            .filter(
              (c) => u.role === "admin" || JSON.parse(u.cafes).includes(c.id),
            ),
        );
      if (path === "/api/inspections" && req.method === "GET") {
        let runs = db
          .prepare("SELECT * FROM inspections ORDER BY started_at DESC")
          .all()
          .filter((r) => u.role === "admin" || r.user_id === u.id);
        if (url.searchParams.get("cafeId"))
          runs = runs.filter(
            (r) => r.cafe_id === url.searchParams.get("cafeId"),
          );
        return send(
          200,
          runs.map((r) => {
            const v = full(r);
            return {
              ...v,
              snapshot: undefined,
              answers: undefined,
              photos: undefined,
              questionCount: flatten(v.snapshot).length,
              completed:
                flatten(v.snapshot).length -
                errorsFor(v.snapshot, v.answers, v.photos).length,
              issues: Object.values(v.answers).filter((a) => a.value === "no")
                .length,
            };
          }),
        );
      }
      if (path === "/api/inspections" && req.method === "POST") {
        if (u.role !== "manager") fail(403, "Обход запускает управляющий");
        if (
          typeof body.cafeId !== "string" ||
          !JSON.parse(u.cafes).includes(body.cafeId)
        )
          fail(403, "Кофейня не назначена этому управляющему");
        const c = db
          .prepare("SELECT data FROM cafes WHERE id=?")
          .get(body.cafeId);
        if (!c) fail(404, "Кофейня не найдена");
        const previous = db
          .prepare(
            "SELECT * FROM inspections WHERE user_id=? AND cafe_id=? AND status='draft'",
          )
          .get(u.id, body.cafeId);
        if (previous) return send(200, full(previous));
        const id = randomUUID();
        const snapshot = questionsFor(checklist, JSON.parse(c.data));
        db.prepare(
          "INSERT INTO inspections(id,cafe_id,user_id,status,started_at,snapshot) VALUES(?,?,?,'draft',?,?)",
        ).run(id, body.cafeId, u.id, now(), JSON.stringify(snapshot));
        log(id, u, "started", { version: snapshot.version });
        return send(201, full(load(id, u)));
      }
      const m = path.match(
        /^\/api\/inspections\/([^/]+)(?:\/(answers|photos|submit|audit))?$/,
      );
      if (m) {
        const [, id, action] = m;
        const mutating = ["PUT", "POST"].includes(req.method);
        const row = load(id, u, mutating && action !== "submit");
        if (!action && req.method === "GET") return send(200, full(row));
        if (action === "audit" && req.method === "GET")
          return send(
            200,
            db
              .prepare(
                "SELECT action,at,detail,user_id AS userId FROM audit WHERE inspection_id=? ORDER BY id",
              )
              .all(id),
          );
        if (action === "photos" && req.method === "POST") {
          if (
            !flatten(JSON.parse(row.snapshot)).some(
              (q) => q.id === body.questionId && q.photoRequired,
            )
          )
            fail(400, "Фото не предусмотрено для этого вопроса");
          if (
            typeof body.base64 !== "string" ||
            !body.base64.match(/^[A-Za-z0-9+/]+={0,2}$/)
          )
            fail(400, "Ожидается фотография JPEG");
          const bytes = Buffer.from(body.base64, "base64");
          if (
            bytes.length < 100 ||
            bytes[0] !== 255 ||
            bytes[1] !== 216 ||
            bytes[2] !== 255 ||
            bytes.at(-2) !== 255 ||
            bytes.at(-1) !== 217
          )
            fail(400, "Некорректный файл JPEG");
          if (bytes.length > 5 * 1024 * 1024)
            fail(413, "Фото должно быть меньше 5 МБ");
          try {
            const image = jpeg.decode(bytes, {
              useTArray: true,
              formatAsRGBA: false,
              tolerantDecoding: false,
              maxResolutionInMP: 50,
              maxMemoryUsageInMB: 384,
            });
            if (image.width < 240 || image.height < 240)
              fail(
                400,
                "Фотография слишком маленькая. Снимите общий вид ещё раз.",
              );
          } catch (e) {
            if (e.status) throw e;
            fail(
              400,
              "Не удалось прочитать фотографию JPEG. Сделайте снимок ещё раз.",
            );
          }
          if (photosFor(id).length >= 100)
            fail(400, "Достигнут лимит фотографий обхода");
          const photo = {
            id: randomUUID(),
            questionId: body.questionId,
            createdAt: now(),
          };
          db.prepare("INSERT INTO photos VALUES(?,?,?,?,?)").run(
            photo.id,
            id,
            photo.questionId,
            photo.createdAt,
            bytes,
          );
          return send(201, photo);
        }
        if (action === "answers" && req.method === "PUT") {
          if (body.revision !== row.revision)
            fail(
              409,
              "Обход изменён на другом устройстве. Откройте его заново.",
            );
          const q = flatten(JSON.parse(row.snapshot)).find(
            (q) => q.id === body.questionId,
          );
          if (!q) fail(400, "Вопрос отсутствует в этом обходе");
          if (!["yes", "no"].includes(body.value))
            fail(400, "Выберите Да или Нет");
          const comment =
            typeof body.comment === "string" ? body.comment.trim() : "";
          if (comment.length > 2000)
            fail(400, "Комментарий длиннее 2000 символов");
          if (body.value === "no" && !comment)
            fail(422, "При ответе Нет нужен комментарий");
          if (
            body.photoId &&
            !photosFor(id).some(
              (p) => p.id === body.photoId && p.questionId === q.id,
            )
          )
            fail(400, "Фотография относится к другому вопросу или обходу");
          const answers = JSON.parse(row.answers);
          answers[q.id] = {
            value: body.value,
            comment: body.value === "no" ? comment : "",
            photoId: body.photoId || null,
          };
          db.prepare(
            "UPDATE inspections SET answers=?,revision=revision+1 WHERE id=?",
          ).run(JSON.stringify(answers), id);
          return send(200, full(load(id, u)));
        }
        if (action === "submit" && req.method === "POST") {
          if (row.user_id !== u.id)
            fail(403, "Отправить обход может только его автор");
          if (row.status === "submitted") return send(200, full(row));
          if (body.revision !== row.revision)
            fail(409, "Обход изменён. Откройте его заново.");
          const v = full(row);
          const errors = errorsFor(v.snapshot, v.answers, v.photos);
          if (errors.length) fail(422, "Обход заполнен не полностью", errors);
          const finishedAt = now();
          const used = v.photos.filter((p) =>
            Object.values(v.answers).some((a) => a.photoId === p.id),
          );
          const photoDigests = used.map((p) => ({
            id: p.id,
            sha256: createHash("sha256")
              .update(
                db.prepare("SELECT bytes FROM photos WHERE id=?").get(p.id)
                  .bytes,
              )
              .digest("hex"),
          }));
          const checksum = digest({
            id,
            cafeId: v.cafeId,
            userId: u.id,
            startedAt: v.startedAt,
            finishedAt,
            snapshot: v.snapshot,
            answers: v.answers,
            photoDigests,
          });
          db.exec("BEGIN IMMEDIATE");
          try {
            db.prepare(
              "UPDATE inspections SET status='submitted',finished_at=?,checksum=?,revision=revision+1 WHERE id=?",
            ).run(finishedAt, checksum, id);
            log(id, u, "submitted", { checksum, photoDigests });
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
          return send(200, full(load(id, u)));
        }
      }
      const photoMatch = path.match(/^\/api\/photos\/([^/]+)$/);
      if (photoMatch && req.method === "GET") {
        const p = db
          .prepare("SELECT * FROM photos WHERE id=?")
          .get(photoMatch[1]);
        if (!p) fail(404, "Фото не найдено");
        load(p.inspection_id, u);
        if (url.searchParams.get("format") === "data")
          return send(200, {
            uri:
              "data:image/jpeg;base64," +
              Buffer.from(p.bytes).toString("base64"),
          });
        res.writeHead(200, { "Content-Type": "image/jpeg" });
        return res.end(p.bytes);
      }
      fail(404, "Неизвестный маршрут");
    } catch (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent)
        send(e.status || 500, {
          error: e.status ? e.message : "Ошибка сервера. Данные не отправлены.",
          details: e.details,
        });
      else res.end();
    }
  });
  return {
    server,
    db,
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          db.close();
          resolve();
        }),
      ),
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = createGardenServer();
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || "127.0.0.1";
  app.server.listen(port, host, () =>
    console.log(`Garden prototype: http://${host}:${port}`),
  );
}
