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

type LocalPhoto = Photo & { uri: string };
type LocalStore = {
  inspections: Inspection[];
  photos: LocalPhoto[];
};
type Session = { token: string };

const storageKey = "garden-local-audits-v1";
const sessionKey = "garden-session";
const users: Array<User & { login: string; password: string }> = [
  {
    id: "andrey-sverdlova",
    login: "andrey",
    password: "Garden-demo-2026!",
    name: "Андрей",
    role: "manager",
    cafeIds: ["sverdlova"],
  },
  {
    id: "admin",
    login: "admin",
    password: "Garden-demo-2026!",
    name: "Руководитель",
    role: "admin",
    cafeIds: cafeList.map((c) => c.id),
  },
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

function saveStore(store: LocalStore) {
  getBrowserStorage().setItem(storageKey, JSON.stringify(store));
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

    if (path === "/me") return user as T;

    if (path === "/cafes")
      return cafes
        .filter((cafe) => allowedCafeIds(user).includes(cafe.id))
        .map(clone) as T;

    if (path === "/inspections" && method === "GET") {
      return store.inspections
        .filter((run) => allowedCafeIds(user).includes(run.cafeId))
        .filter((run) => user.role === "admin" || run.user.id === user.id)
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
    if (runMatch && method === "GET")
      return clone(requireRun(store, runMatch[1], user)) as T;

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
      return clone(run) as T;
    }

    const photoUploadMatch = path.match(/^\/inspections\/([^/]+)\/photos$/);
    if (photoUploadMatch && method === "POST") {
      const run = requireRun(store, photoUploadMatch[1], user);
      if (run.status === "submitted")
        throw new Error("В отправленном обходе нельзя заменить фото.");
      if (run.user.id !== user.id)
        throw new Error("Фото может добавить только автор черновика.");
      const request = body as { questionId?: string; base64?: string };
      if (!request.questionId || !request.base64)
        throw new Error("Не удалось сохранить фото.");
      const question = questions(run).find((item) => item.id === request.questionId);
      if (!question) throw new Error("Вопрос не найден.");
      const photo: LocalPhoto = {
        id: `photo-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        questionId: question.id,
        createdAt: now(),
        uri: `data:image/jpeg;base64,${request.base64}`,
      };
      store.photos.push(photo);
      run.photos = run.photos.filter((item) => item.questionId !== question.id);
      run.photos.push({
        id: photo.id,
        questionId: photo.questionId,
        createdAt: photo.createdAt,
      });
      run.revision += 1;
      saveStore(store);
      return { id: photo.id, questionId: photo.questionId, createdAt: photo.createdAt } as T;
    }

    const photoReadMatch = path.match(/^\/photos\/([^?]+)\?format=data$/);
    if (photoReadMatch && method === "GET") {
      const photo = store.photos.find((item) => item.id === photoReadMatch[1]);
      if (!photo) throw new Error("Фото не найдено на этом устройстве.");
      return { uri: photo.uri } as T;
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
