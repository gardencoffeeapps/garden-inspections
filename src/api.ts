import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import checklist from "../shared/checklist.json";
import cafeList from "../shared/cafes.json";
import {
  Answer,
  Cafe,
  Inspection,
  Photo,
  Summary,
  User,
} from "./types";

type LocalPhoto = Photo & { uri?: string };
type PhotoPayload = string | Blob;
type LocalStore = {
  inspections: Inspection[];
  photos: LocalPhoto[];
};
type Session = { token: string };

const storageKey = "garden-local-audits-v1";
const sessionKey = "garden-session";
const users: Array<User & { login: string; password: string }> = [
  {
    id: "pankova-anastasia",
    login: "pankova_anastasia",
    password: "Garden-demo-2026!",
    name: "Панкова Анастасия",
    role: "manager",
    cafeIds: ["kalinka"],
  },
  {
    id: "sekachev-aleksey",
    login: "sekachev_aleksey",
    password: "Garden-demo-2026!",
    name: "Секачев Алексей",
    role: "manager",
    cafeIds: ["sovetskaya"],
  },
  {
    id: "chemyakin-stas",
    login: "chemyakin_stas",
    password: "Garden-demo-2026!",
    name: "Чемякин Стас",
    role: "manager",
    cafeIds: ["okean"],
  },
  {
    id: "romicheva-nadya",
    login: "romicheva_nadya",
    password: "Garden-demo-2026!",
    name: "Ромичева Надя",
    role: "manager",
    cafeIds: ["parus"],
  },
  {
    id: "kalchakov-denis",
    login: "kalchakov_denis",
    password: "Garden-demo-2026!",
    name: "Калчаков Денис",
    role: "manager",
    cafeIds: ["evropeyskiy"],
  },
  {
    id: "geynbikhner-katya",
    login: "geynbikhner_katya",
    password: "Garden-demo-2026!",
    name: "Гейнбихнер Катя",
    role: "manager",
    cafeIds: ["novin"],
  },
  {
    id: "zabaluev-ivan",
    login: "zabaluev_ivan",
    password: "Garden-demo-2026!",
    name: "Забалуев Иван",
    role: "manager",
    cafeIds: ["panorama"],
  },
  {
    id: "baranyuk-kolya",
    login: "baranyuk_kolya",
    password: "Garden-demo-2026!",
    name: "Баранюк Коля",
    role: "manager",
    cafeIds: ["gazprom", "dramteatr"],
  },
  {
    id: "vorobev-denis",
    login: "vorobev_denis",
    password: "Garden-demo-2026!",
    name: "Воробьев Денис",
    role: "manager",
    cafeIds: ["preobrazhenskiy"],
  },
  {
    id: "nikovskaya-anya",
    login: "nikovskaya_anya",
    password: "Garden-demo-2026!",
    name: "Никовская Аня",
    role: "manager",
    cafeIds: ["arsib"],
  },
  {
    id: "radaev-andrey",
    login: "radaev_andrey",
    password: "Garden-demo-2026!",
    name: "Радаев Андрей",
    role: "manager",
    cafeIds: ["sverdlova"],
  },
  {
    id: "muhamedzyanova-irina",
    login: "muhamedzyanova_irina",
    password: "Garden-demo-2026!",
    name: "Мухамедзянова Ирина",
    role: "manager",
    cafeIds: ["vidnyy"],
  },
  {
    id: "ignatov-stas",
    login: "ignatov_stas",
    password: "Garden-demo-2026!",
    name: "Игнатов Стас",
    role: "manager",
    cafeIds: ["gagarina"],
  },
  {
    id: "kiseleva-ekaterina",
    login: "kiseleva_ekaterina",
    password: "Garden-demo-2026!",
    name: "Киселева Екатерина",
    role: "manager",
    cafeIds: ["world-class"],
  },
  {
    id: "kalinovskaya-adelina",
    login: "kalinovskaya_adelina",
    password: "Garden-demo-2026!",
    name: "Калиновская Аделина",
    role: "manager",
    cafeIds: ["domashniy"],
  },
  {
    id: "admin",
    login: "admin",
    password: "Garden-demo-2026!",
    name: "Руководитель",
    role: "admin",
    cafeIds: cafeList.map((c) => c.id),
  }
];

const cafes = cafeList as Cafe[];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function now() {
  return new Date().toISOString();
}

function getBrowserStorage() {
  if (Platform.OS !== "web" || typeof localStorage === "undefined")
    throw new Error(
      "Эта версия Garden рассчитана на веб-ссылку в браузере телефона.",
    );
  return localStorage;
}

const photoDbName = "garden-photo-store-v2";
const photoStoreName = "photos";

function supportsPhotoDb() {
  return Platform.OS === "web" && typeof indexedDB !== "undefined";
}

function openPhotoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!supportsPhotoDb())
      return reject(new Error("Хранилище фото недоступно в этом браузере."));
    const request = indexedDB.open(photoDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(photoStoreName))
        db.createObjectStore(photoStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Не удалось открыть хранилище фото."));
  });
}

async function withPhotoStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(photoStoreName, mode);
    const request = action(tx.objectStore(photoStoreName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Не удалось сохранить фото."));
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("Не удалось сохранить фото."));
    };
  });
}

async function putPhotoPayload(id: string, payload: PhotoPayload) {
  if (!supportsPhotoDb()) return false;
  try {
    await withPhotoStore("readwrite", (store) => store.put(payload, id));
    return true;
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
    )
      throw new Error(
        "Память телефона для фото заполнена. Очистите старые данные сайта Garden в браузере и откройте ссылку заново.",
      );
    throw error;
  }
}

async function getPhotoPayload(id: string) {
  if (!supportsPhotoDb()) return undefined;
  return withPhotoStore<PhotoPayload | undefined>("readonly", (store) =>
    store.get(id),
  );
}

function photoPayloadToUri(payload: PhotoPayload) {
  if (typeof payload === "string") return payload;
  return URL.createObjectURL(payload);
}

async function deletePhotoUris(ids: string[]) {
  if (!supportsPhotoDb() || ids.length === 0) return;
  await Promise.all(
    ids.map((id) =>
      withPhotoStore("readwrite", (store) => store.delete(id)).catch(() => undefined),
    ),
  );
}

async function migratePhotoPayloads(store: LocalStore) {
  if (!supportsPhotoDb()) return;
  let changed = false;
  for (const photo of store.photos) {
    if (!photo.uri) continue;
    await putPhotoPayload(photo.id, dataUriToBlob(photo.uri));
    delete photo.uri;
    changed = true;
  }
  if (changed) saveStore(store);
}

function loadStore(): LocalStore {
  const raw = getBrowserStorage().getItem(storageKey);
  if (!raw) return { inspections: [], photos: [] };
  try {
    const parsed = JSON.parse(raw) as LocalStore;
    return {
      inspections: Array.isArray(parsed.inspections) ? parsed.inspections : [],
      photos: Array.isArray(parsed.photos) ? parsed.photos : [],
    };
  } catch {
    return { inspections: [], photos: [] };
  }
}

function pruneUnusedPhotos(store: LocalStore) {
  const used = new Set(
    store.inspections.flatMap((run) => run.photos.map((photo) => photo.id)),
  );
  store.photos = store.photos.filter((photo) => used.has(photo.id));
}

function saveStore(store: LocalStore) {
  pruneUnusedPhotos(store);
  try {
    getBrowserStorage().setItem(storageKey, JSON.stringify(store));
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
    )
      throw new Error(
        "Память телефона для фото заполнена. Фото теперь сохраняются отдельно; откройте новую ссылку Garden и продолжите обход. Если ошибка повторится, очистите старые данные сайта Garden в браузере.",
      );
    throw error;
  }
}

function publicUser(user: (typeof users)[number]): User {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    cafeIds: user.cafeIds,
  };
}

function currentUser(token: string): User {
  const user = users.find((item) => item.id === token);
  if (!user) throw new Error("Войдите в Garden заново.");
  return publicUser(user);
}

function allowedCafeIds(user: User) {
  return user.role === "admin" ? cafes.map((c) => c.id) : user.cafeIds;
}

function questions(run: Inspection) {
  return run.snapshot.sections.flatMap((section) => section.questions);
}

function completeCount(run: Inspection) {
  return questions(run).filter((question) => {
    const answer = run.answers[question.id];
    return (
      !!answer &&
      ["yes", "no"].includes(answer.value) &&
      (answer.value !== "no" || !!answer.comment.trim()) &&
      (!question.photoRequired ||
        run.photos.some(
          (photo) =>
            photo.id === answer.photoId && photo.questionId === question.id,
        ))
    );
  }).length;
}

function toSummary(run: Inspection): Summary {
  return {
    id: run.id,
    cafeId: run.cafeId,
    user: run.user,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    revision: run.revision,
    checksum: run.checksum,
    questionCount: questions(run).length,
    completed: completeCount(run),
    issues: Object.values(run.answers).filter((answer) => answer.value === "no")
      .length,
  };
}

function checksum(run: Inspection) {
  const source = JSON.stringify({
    cafeId: run.cafeId,
    userId: run.user.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    answers: run.answers,
    photos: run.photos.map((photo) => ({
      id: photo.id,
      questionId: photo.questionId,
      createdAt: photo.createdAt,
    })),
  });
  let hash = 0;
  for (let i = 0; i < source.length; i += 1)
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  return `LOCAL-${hash.toString(16).padStart(8, "0").toUpperCase()}`;
}

function requireRun(store: LocalStore, id: string, user: User) {
  const run = store.inspections.find((item) => item.id === id);
  if (!run) throw new Error("Обход не найден на этом устройстве.");
  if (!allowedCafeIds(user).includes(run.cafeId))
    throw new Error("У вас нет доступа к этой кофейне.");
  return run;
}

const supabaseUrl = "https://dftacohhdvkfnsyqfbgf.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmdGFjb2hoZHZrZm5zeXFmYmdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1ODQyMTcsImV4cCI6MjEwNjE2MDIxN30.M-CPC7c15zRTOaQJ-OCz9O24cnUDnWWb1vxvloX3TzI";
const photoBucket = "inspection-photos";
const remoteAvailable =
  Platform.OS === "web" &&
  typeof fetch !== "undefined" &&
  supabaseUrl.startsWith("https://") &&
  supabaseKey.length > 80;

type RemoteInspectionRow = {
  id: string;
  cafe_id: string;
  user_id: string;
  user_name: string;
  status: "draft" | "submitted";
  started_at: string;
  finished_at: string | null;
  revision: number;
  checksum: string | null;
  question_count: number;
  completed: number;
  issues: number;
  payload: Inspection;
};

type RemotePhotoRow = {
  photo_id: string;
  inspection_id: string;
  question_id: string;
  storage_path: string;
  public_url: string;
};

function remoteHeaders(extra?: Record<string, string>) {
  return {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    ...extra,
  };
}

async function remoteFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!remoteAvailable) throw new Error("Supabase не настроен.");
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      ...remoteHeaders(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Не удалось связаться с общей базой Garden (${response.status}). ${details}`.trim(),
    );
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function remoteInspectionFromRow(row: RemoteInspectionRow): Inspection {
  return row.payload;
}

function canSeeRun(run: Inspection, user: User) {
  return (
    allowedCafeIds(user).includes(run.cafeId) &&
    (user.role === "admin" || run.user.id === user.id)
  );
}

async function listRemoteInspections(user: User) {
  if (!remoteAvailable) return [] as Inspection[];
  try {
    const rows = await remoteFetch<RemoteInspectionRow[]>(
      "/rest/v1/garden_inspections?select=*&order=started_at.desc",
    );
    return rows.map(remoteInspectionFromRow).filter((run) => canSeeRun(run, user));
  } catch {
    return [] as Inspection[];
  }
}

async function getRemoteInspection(id: string, user: User) {
  if (!remoteAvailable) return null;
  try {
    const rows = await remoteFetch<RemoteInspectionRow[]>(
      `/rest/v1/garden_inspections?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    const run = rows[0] ? remoteInspectionFromRow(rows[0]) : null;
    return run && canSeeRun(run, user) ? run : null;
  } catch {
    return null;
  }
}

function dataUriToBlob(uri: string) {
  const match = uri.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error("Не удалось подготовить фото для отправки.");
  const mime = match[1] || "image/jpeg";
  const isBase64 = !!match[2];
  const payload = match[3] || "";
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function uploadPhotoToRemote(run: Inspection, photo: Photo) {
  const storedPhoto = loadStore().photos.find((item) => item.id === photo.id);
  const payload = storedPhoto?.uri || (await getPhotoPayload(photo.id));
  if (!payload)
    throw new Error("Не удалось отправить фото в общую базу Garden: фото не найдено на этом устройстве.");
  const storagePath = `${run.cafeId}/${run.id}/${photo.id}.jpg`;
  const blob = typeof payload === "string" ? dataUriToBlob(payload) : payload;
  const upload = await fetch(
    `${supabaseUrl}/storage/v1/object/${photoBucket}/${storagePath}`,
    {
      method: "PUT",
      headers: remoteHeaders({
        "Content-Type": blob.type || "image/jpeg",
        "x-upsert": "true",
      }),
      body: blob,
    },
  );
  if (!upload.ok) {
    const details = await upload.text().catch(() => "");
    throw new Error(
      `Не удалось отправить фото в общую базу Garden (${upload.status}). ${details}`.trim(),
    );
  }
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${photoBucket}/${storagePath}`;
  await remoteFetch(`/rest/v1/garden_photos?on_conflict=photo_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      photo_id: photo.id,
      inspection_id: run.id,
      question_id: photo.questionId,
      storage_path: storagePath,
      public_url: publicUrl,
    } satisfies RemotePhotoRow),
  });
}

async function upsertRemoteInspection(run: Inspection) {
  const summary = toSummary(run);
  await remoteFetch(`/rest/v1/garden_inspections?on_conflict=id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: run.id,
      cafe_id: run.cafeId,
      user_id: run.user.id,
      user_name: run.user.name,
      status: run.status,
      started_at: run.startedAt,
      finished_at: run.finishedAt,
      revision: run.revision,
      checksum: run.checksum,
      question_count: summary.questionCount,
      completed: summary.completed,
      issues: summary.issues,
      payload: run,
    }),
  });
}

async function syncPhotosToRemote(run: Inspection) {
  for (const photo of run.photos) {
    try {
      await uploadPhotoToRemote(run, photo);
    } catch (error) {
      console.warn("Garden photo sync failed", error);
    }
  }
}

async function syncInspectionToRemote(run: Inspection) {
  if (!remoteAvailable || run.status !== "submitted") return;
  await upsertRemoteInspection(run);
  void syncPhotosToRemote(run);
}

async function getRemotePhotoUri(id: string) {
  if (!remoteAvailable) return undefined;
  try {
    const rows = await remoteFetch<Array<Pick<RemotePhotoRow, "public_url">>>(
      `/rest/v1/garden_photos?select=public_url&photo_id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    return rows[0]?.public_url;
  } catch {
    return undefined;
  }
}

async function syncLocalSubmittedRuns(store: LocalStore, user: User) {
  if (!remoteAvailable) return;
  const submittedRuns = store.inspections.filter(
    (run) => run.status === "submitted" && canSeeRun(run, user),
  );
  for (const run of submittedRuns) {
    try {
      await syncInspectionToRemote(run);
    } catch (error) {
      console.warn("Garden inspection sync failed", error);
    }
  }
}

export const api = {
  base: "local",
  token: "",
  async call<T = any>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    if (path === "/login" && method === "POST") {
      const request = body as { login?: string; password?: string };
      const user = users.find(
        (item) =>
          item.login === request.login && item.password === request.password,
      );
      if (!user) throw new Error("Неверный логин или пароль.");
      this.token = user.id;
      return { token: user.id, user: publicUser(user) } as T;
    }

    if (path === "/logout" && method === "POST") {
      this.token = "";
      return { ok: true } as T;
    }

    const user = currentUser(this.token);
    const store = loadStore();
    await migratePhotoPayloads(store);

    if (path === "/me") return user as T;

    if (path === "/cafes")
      return cafes
        .filter((cafe) => allowedCafeIds(user).includes(cafe.id))
        .map(clone) as T;

    if (path === "/inspections" && method === "GET") {
      await syncLocalSubmittedRuns(store, user);
      const localRuns = store.inspections
        .filter((run) => allowedCafeIds(user).includes(run.cafeId))
        .filter((run) => user.role === "admin" || run.user.id === user.id);
      const remoteRuns = await listRemoteInspections(user);
      const byId = new Map<string, Inspection>();
      for (const run of localRuns) byId.set(run.id, run);
      for (const run of remoteRuns) byId.set(run.id, run);
      return Array.from(byId.values())
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map(toSummary) as T;
    }

    if (path === "/inspections" && method === "POST") {
      const request = body as { cafeId?: string };
      if (!request.cafeId || !allowedCafeIds(user).includes(request.cafeId))
        throw new Error("Выберите доступную кофейню.");
      const draft = store.inspections.find(
        (run) =>
          run.status === "draft" &&
          run.cafeId === request.cafeId &&
          run.user.id === user.id,
      );
      if (draft) return clone(draft) as T;
      const run: Inspection = {
        id: `audit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        cafeId: request.cafeId,
        user,
        status: "draft",
        startedAt: now(),
        finishedAt: null,
        revision: 1,
        snapshot: clone(checklist),
        answers: {},
        photos: [],
        checksum: null,
      };
      store.inspections.push(run);
      saveStore(store);
      return clone(run) as T;
    }

    const runMatch = path.match(/^\/inspections\/([^/]+)$/);
    if (runMatch && method === "GET") {
      const localRun = store.inspections.find((item) => item.id === runMatch[1]);
      if (localRun) {
        if (!allowedCafeIds(user).includes(localRun.cafeId))
          throw new Error("У вас нет доступа к этой кофейне.");
        return clone(localRun) as T;
      }
      const remoteRun = await getRemoteInspection(runMatch[1], user);
      if (remoteRun) return clone(remoteRun) as T;
      throw new Error("Обход не найден.");
    }

    const answerMatch = path.match(/^\/inspections\/([^/]+)\/answers$/);
    if (answerMatch && method === "PUT") {
      const run = requireRun(store, answerMatch[1], user);
      if (run.status === "submitted")
        throw new Error("Отправленный обход нельзя изменить.");
      if (run.user.id !== user.id)
        throw new Error("Черновик может менять только его автор.");
      const request = body as Answer & { questionId?: string };
      const question = questions(run).find((item) => item.id === request.questionId);
      if (!question) throw new Error("Вопрос не найден.");
      if (!request.value) throw new Error("Выберите Да или Нет.");
      if (request.value === "no" && !request.comment.trim())
        throw new Error("Комментарий обязателен при ответе Нет.");
      if (
        question.photoRequired &&
        !run.photos.some(
          (photo) =>
            photo.id === request.photoId && photo.questionId === question.id,
        )
      )
        throw new Error("Сделайте обязательное фото.");
      run.answers[question.id] = {
        value: request.value,
        comment: request.comment,
        photoId: request.photoId,
      };
      run.revision += 1;
      saveStore(store);
      return clone(run) as T;
    }

    const submitMatch = path.match(/^\/inspections\/([^/]+)\/submit$/);
    if (submitMatch && method === "POST") {
      const run = requireRun(store, submitMatch[1], user);
      if (run.user.id !== user.id)
        throw new Error("Отправить обход может только его автор.");
      if (completeCount(run) !== questions(run).length)
        throw new Error("Заполните все пункты и обязательные фото.");
      if (run.status !== "submitted") {
        run.status = "submitted";
        run.finishedAt = now();
        run.revision += 1;
        run.checksum = checksum(run);
        saveStore(store);
      }
      await syncInspectionToRemote(run);
      return clone(run) as T;
    }

    const photoUploadMatch = path.match(/^\/inspections\/([^/]+)\/photos$/);
    if (photoUploadMatch && method === "POST") {
      const run = requireRun(store, photoUploadMatch[1], user);
      if (run.status === "submitted")
        throw new Error("В отправленном обходе нельзя заменить фото.");
      if (run.user.id !== user.id)
        throw new Error("Фото может добавить только автор черновика.");
      const request = body as { questionId?: string; base64?: string; dataUri?: string };
      const uri = request.dataUri || (request.base64 ? `data:image/jpeg;base64,${request.base64}` : "");
      if (!request.questionId || !uri)
        throw new Error("Не удалось сохранить фото.");
      const question = questions(run).find((item) => item.id === request.questionId);
      if (!question) throw new Error("Вопрос не найден.");
      const photo: LocalPhoto = {
        id: `photo-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        questionId: question.id,
        createdAt: now(),
      };
      const replacedIds = run.photos
        .filter((item) => item.questionId === question.id)
        .map((item) => item.id);
      const savedOutsideStore = await putPhotoPayload(photo.id, dataUriToBlob(uri));
      if (!savedOutsideStore) photo.uri = uri;
      run.photos = run.photos.filter((item) => item.questionId !== question.id);
      const usedBeforeSave = new Set(
        store.inspections.flatMap((inspection) =>
          inspection.photos.map((item) => item.id),
        ),
      );
      store.photos = store.photos.filter((item) => usedBeforeSave.has(item.id));
      store.photos.push(photo);
      run.photos.push({
        id: photo.id,
        questionId: photo.questionId,
        createdAt: photo.createdAt,
      });
      run.revision += 1;
      saveStore(store);
      await deletePhotoUris(replacedIds);
      return { id: photo.id, questionId: photo.questionId, createdAt: photo.createdAt } as T;
    }

    const photoReadMatch = path.match(/^\/photos\/([^?]+)\?format=data$/);
    if (photoReadMatch && method === "GET") {
      const photo = store.photos.find((item) => item.id === photoReadMatch[1]);
      if (photo) {
        const payload = photo.uri || (await getPhotoPayload(photo.id));
        if (payload) return { uri: photoPayloadToUri(payload) } as T;
      }
      const remoteUri = await getRemotePhotoUri(photoReadMatch[1]);
      if (remoteUri) return { uri: remoteUri } as T;
      throw new Error("Фото не найдено.");
    }

    throw new Error("Действие не поддерживается локальной версией Garden.");
  },
  async persist() {
    const value = JSON.stringify({ token: this.token } satisfies Session);
    if (Platform.OS === "web") sessionStorage.setItem(sessionKey, value);
    else await SecureStore.setItemAsync(sessionKey, value);
  },
  async restore() {
    const value =
      Platform.OS === "web"
        ? sessionStorage.getItem(sessionKey)
        : await SecureStore.getItemAsync(sessionKey);
    if (value) this.token = (JSON.parse(value) as Session).token;
  },
  async clear() {
    this.token = "";
    if (Platform.OS === "web") sessionStorage.removeItem(sessionKey);
    else await SecureStore.deleteItemAsync(sessionKey);
  },
};











