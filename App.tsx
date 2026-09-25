import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { api } from "./src/api";
import { WebConnectionStatus, WebInstallCard } from "./src/WebAppInfo";
import {
  Answer,
  Cafe,
  Inspection,
  Photo,
  Question,
  Section,
  Summary,
  User,
} from "./src/types";
import checklist from "./shared/checklist.json";

const C = {
  green: "#183F35",
  lime: "#D9EBAC",
  paper: "#F5F5EE",
  white: "#FFFFFF",
  ink: "#203B33",
  muted: "#758078",
  line: "#DEE4DA",
  red: "#A83D32",
  redBg: "#FCECE7",
};
const Busy = createContext(false);
const date = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const all = (r: Inspection) => r.snapshot.sections.flatMap((s) => s.questions);
const complete = (q: Question, r: Inspection) => {
  const a = r.answers[q.id];
  return (
    !!a &&
    ["yes", "no"].includes(a.value) &&
    (a.value !== "no" || !!a.comment.trim()) &&
    (!q.photoRequired ||
      r.photos.some((p) => p.id === a.photoId && p.questionId === q.id))
  );
};
function Button({
  children,
  onPress,
  kind = "primary",
  disabled = false,
  small = false,
}: {
  children: React.ReactNode;
  onPress: () => void;
  kind?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  small?: boolean;
}) {
  const busy = useContext(Busy);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        small && s.smallButton,
        kind === "primary"
          ? s.primary
          : kind === "danger"
            ? s.danger
            : kind === "secondary"
              ? s.secondary
              : s.ghost,
        (disabled || busy) && { opacity: 0.4 },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text
        style={[
          s.buttonText,
          (kind === "primary" || kind === "danger") && { color: C.white },
          kind === "ghost" && { color: C.muted },
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}
function Tag({
  children,
  alert = false,
}: {
  children: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <View style={[s.tag, alert && { backgroundColor: C.redBg }]}>
      <Text style={[s.tagText, alert && { color: C.red }]}>{children}</Text>
    </View>
  );
}
function Progress({ value }: { value: number }) {
  return (
    <View style={s.track}>
      <View style={[s.fill, { width: `${Math.min(100, value * 100)}%` }]} />
    </View>
  );
}
async function compactPhotoBase64(base64: string): Promise<string> {
  if (Platform.OS !== "web" || typeof document === "undefined") return base64;
  const source = `data:image/jpeg;base64,${base64}`;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = document.createElement("img");
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось подготовить фото."));
    img.src = source;
  });
  const render = (maxEdge: number, quality: number) => {
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Не удалось подготовить фото.");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality).split(",")[1] || base64;
  };
  const compact = render(900, 0.5);
  return compact.length > 260_000 ? render(720, 0.38) : compact;
}
function PhotoView({ id }: { id: string }) {
  const [uri, setUri] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setUri("");
    setError(false);
    api
      .call(`/photos/${id}?format=data`)
      .then((d) => {
        if (active) setUri(d.uri);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [id]);
  return uri ? (
    <Image
      accessibilityLabel="Фото контрольной точки"
      source={{ uri }}
      style={s.photo}
      resizeMode="contain"
    />
  ) : (
    <Text style={s.muted}>
      {error
        ? "Не удалось загрузить фото. Откройте отчёт повторно."
        : "Загрузка фото…"}
    </Text>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Garden />
    </SafeAreaProvider>
  );
}
function Garden() {
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const [user, setUser] = useState<User | null>(null),
    [cafes, setCafes] = useState<Cafe[]>([]),
    [runs, setRuns] = useState<Summary[]>([]);
  const [page, setPage] = useState<
    "home" | "sections" | "question" | "review" | "results" | "report"
  >("home");
  const [run, setRun] = useState<Inspection | null>(null),
    [questionId, setQuestionId] = useState(""),
    [selectedCafe, setSelectedCafe] = useState(""),
    [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [boot, setBoot] = useState(true);
  const [login, setLogin] = useState(""),
    [password, setPassword] = useState("");
  const scroll = useRef<ScrollView>(null);
  async function refresh() {
    const [c, r] = await Promise.all([
      api.call<Cafe[]>("/cafes"),
      api.call<Summary[]>("/inspections"),
    ]);
    setCafes(c);
    setRuns(r);
    setSelectedCafe((old) =>
      c.some((point) => point.id === old) ? old : c[0]?.id || "",
    );
  }
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось выполнить действие",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    (async () => {
      try {
        await api.restore();
        if (api.token) {
          setUser(await api.call<User>("/me"));
          await refresh();
        }
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Не удалось восстановить вход",
        );
        await api.clear();
        setUser(null);
      } finally {
        setBoot(false);
      }
    })();
  }, []);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [page, questionId]);  useEffect(() => {
    if (Platform.OS !== "web" || user) return;
    setLogin("");
    setPassword("");
    const disableLoginAutofill = () => {
      document.querySelectorAll("input").forEach((input) => {
        const label = input.getAttribute("aria-label");
        if (label !== "Логин" && label !== "Пароль") return;
        input.setAttribute("autocomplete", "new-password");
        input.setAttribute("autocapitalize", "none");
        input.setAttribute("autocorrect", "off");
        input.setAttribute("spellcheck", "false");
        input.setAttribute(
          "name",
          label === "Логин" ? "garden-login-entry" : "garden-password-entry",
        );
        input.setAttribute(
          "id",
          label === "Логин" ? "garden-login-entry" : "garden-password-entry",
        );
      });
    };
    disableLoginAutofill();
    const timer = window.setTimeout(disableLoginAutofill, 250);
    return () => window.clearTimeout(timer);
  }, [user]);
  async function signIn() {
    const session = await api.call<{ token: string; user: User }>(
      "/login",
      "POST",
      { login, password },
    );
    api.token = session.token;
    await api.persist();
    await refresh();
    setUser(session.user);
    setPage(session.user.role === "admin" ? "results" : "home");
  }
  async function openRun(id: string) {
    const r = await api.call<Inspection>(`/inspections/${id}`);
    setRun(r);
    setPage(
      r.status === "submitted" || user?.role === "admin"
        ? "report"
        : "sections",
    );
  }
  async function start() {
    const r = await api.call<Inspection>("/inspections", "POST", {
      cafeId: selectedCafe,
    });
    setRun(r);
    setPage("sections");
    await refresh();
  }
  function goQuestion(q: Question) {
    setQuestionId(q.id);
    setPage("question");
  }
  async function saveAnswer(q: Question, answer: Answer) {
    if (!run) return;
    const r = await api.call<Inspection>(
      `/inspections/${run.id}/answers`,
      "PUT",
      { revision: run.revision, questionId: q.id, ...answer },
    );
    setRun(r);
    const list = all(r),
      idx = list.findIndex((v) => v.id === q.id);
    const next = list[idx + 1];
    if (next) {
      setQuestionId(next.id);
    } else setPage("review");
  }
  async function submit() {
    if (!run) return;
    const r = await api.call<Inspection>(
      `/inspections/${run.id}/submit`,
      "POST",
      { revision: run.revision },
    );
    setRun(r);
    setPage("report");
    setNotice("Обход завершён и сохранён на этом устройстве.");
    await refresh();
  }
  const cafeName = (id: string) => cafes.find((c) => c.id === id)?.name || id;
  const completed = run ? all(run).filter((q) => complete(q, run)).length : 0;
  const active = runs.find(
    (r) => r.status === "draft" && r.cafeId === selectedCafe,
  );
  const totalForCafe = checklist.sections.flatMap((s) => s.questions).length;
  if (boot)
    return (
      <View style={s.loading}>
        <ActivityIndicator color={C.green} />
        <Text style={s.muted}>Открываем Garden…</Text>
      </View>
    );
  return (
    <Busy.Provider value={busy}>
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={s.topbar}>
            <View style={s.topinner}>
              <Text style={s.logo}>
                garden<Text style={{ color: "#8CA75C" }}>®</Text>
              </Text>
              <View style={s.row}>
                {wide && <Text style={s.topLabel}>ОБХОДЫ КОФЕЕН</Text>}
                <Tag>ПРОТОТИП</Tag>
                {user && (
                  <Button
                    kind="ghost"
                    small
                    onPress={() =>
                      act(async () => {
                        try {
                          await api.call("/logout", "POST");
                        } finally {
                          await api.clear();
                          setUser(null);
                          setRun(null);
                          setRuns([]);
                          setPage("home");
                        }
                      })
                    }
                  >
                    Выйти
                  </Button>
                )}
              </View>
            </View>
          </View>
          <View style={[s.layout, wide && user && { flexDirection: "row" }]}>
            {wide && user && (
              <View style={s.sidebar}>
                <Text style={s.eyebrow}>РАБОЧЕЕ ПРОСТРАНСТВО</Text>
                <Button
                  kind={page === "home" ? "primary" : "ghost"}
                  onPress={() => {
                    setPage("home");
                    setError("");
                  }}
                >
                  Обход кофейни
                </Button>
                <Button
                  kind={page === "results" ? "primary" : "ghost"}
                  onPress={() =>
                    act(async () => {
                      await refresh();
                      setPage("results");
                    })
                  }
                >
                  Результаты
                </Button>
                <View style={{ flex: 1 }} />
                <View style={s.profile}>
                  <View style={s.avatar}>
                    <Text style={s.avatarText}>
                      {user.role === "admin" ? "Р" : "У"}
                    </Text>
                  </View>
                  <Text style={s.body}>{user.name}</Text>
                  <Text style={s.muted}>
                    {user.role === "admin"
                      ? "Руководитель сети"
                      : "Управляющий"}
                  </Text>
                </View>
                <Text style={s.footnote}>Garden Operations / 0.1</Text>
              </View>
            )}
            <ScrollView
              ref={scroll}
              style={{ flex: 1 }}
              contentContainerStyle={[
                s.content,
                !user && wide && { paddingTop: 64 },
              ]}
              keyboardShouldPersistTaps="handled"
            >
              <WebConnectionStatus />
              {error !== "" && (
                <View accessibilityRole="alert" style={s.error}>
                  <Text style={{ color: C.red, flex: 1 }}>{error}</Text>
                  <Button kind="ghost" small onPress={() => setError("")}>
                    Закрыть
                  </Button>
                </View>
              )}
              {notice !== "" && (
                <View style={s.notice}>
                  <Text style={s.body}>{notice}</Text>
                </View>
              )}
              {busy && (
                <View style={s.busy}>
                  <ActivityIndicator size="small" color={C.green} />
                  <Text style={s.muted}>Сохраняем данные…</Text>
                </View>
              )}
              {!user ? (
                <View style={[s.loginLayout, wide && { flexDirection: "row" }]}>
                  <View
                    style={[s.hero, wide && { flex: 1.15, minHeight: 530 }]}
                  >
                    <View style={s.heroTop}>
                      <Text style={s.heroEyebrow}>
                        GARDEN / КАЧЕСТВО КАЖДЫЙ ДЕНЬ
                      </Text>
                      <Text style={s.heroSymbol}>✳</Text>
                    </View>
                    <Text style={s.heroTitle}>
                      Забота о каждой{wide ? "\n" : " "}детали.
                    </Text>
                    <Text style={s.heroDescription}>
                      Один обход — полная картина состояния кофейни. Всё важное
                      остаётся на виду.
                    </Text>
                    <View style={s.heroBottom}>
                      <Text style={s.heroNumber}>12</Text>
                      <Text style={s.heroMetric}>
                        разделов{`\n`}внимательного обхода
                      </Text>
                      <View style={s.heroDivider} />
                      <Text style={s.heroNumber}>10</Text>
                      <Text style={s.heroMetric}>фото{`\n`}ключевых точек</Text>
                    </View>
                  </View>
                  <View style={[s.loginCard, wide && { flex: 1 }]}>
                    <Text style={s.eyebrow}>РАБОЧЕЕ ПРИЛОЖЕНИЕ</Text>
                    <Text style={s.title}>Добро пожаловать</Text>
                    <Text style={s.subtitle}>
                      Войдите, чтобы начать обход или посмотреть результаты
                      сети.
                    </Text>
                    <Text style={s.label}>Логин</Text>
                    <TextInput
                      accessibilityLabel="Логин"
                      nativeID="garden-login"
                      style={s.input}
                      value={login}
                      onChangeText={setLogin}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      textContentType="none"
                      importantForAutofill="no"
                    />
                    <Text style={s.label}>Пароль</Text>
                    <TextInput
                      accessibilityLabel="Пароль"
                      nativeID="garden-password"
                      style={s.input}
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                      autoComplete="off"
                      textContentType="none"
                      importantForAutofill="no"
                    />
                    <Button onPress={() => act(signIn)}>
                      Войти в Garden →
                    </Button>
                    <Text style={s.footnote}>
                      У каждого управляющего свой логин и привязанные кофейни.
                      Результаты сохраняются в памяти этого телефона.
                    </Text>
                  </View>
                </View>
              ) : (
                <>
                  {page === "home" && (
                    <>
                      <View style={s.heading}>
                        <View>
                          <Text style={s.eyebrow}>
                            {new Date()
                              .toLocaleDateString("ru-RU", {
                                day: "numeric",
                                month: "long",
                                weekday: "long",
                              })
                              .toUpperCase()}
                          </Text>
                          <Text style={s.title}>Внимание к деталям.</Text>
                          <Text style={s.subtitle}>
                            Состояние кофейни начинается с вашего обхода.
                          </Text>
                        </View>
                        <Tag>
                          {user.role === "admin"
                            ? "Руководитель сети"
                            : "Управляющий"}
                        </Tag>
                      </View>
                      {user.role === "manager" ? (
                        <>
                          <Text style={s.label}>Ваша кофейня</Text>
                          <View style={s.wrap}>
                            {cafes.map((c) => (
                              <Button
                                key={c.id}
                                kind={
                                  selectedCafe === c.id
                                    ? "primary"
                                    : "secondary"
                                }
                                onPress={() => setSelectedCafe(c.id)}
                              >
                                {c.name}
                              </Button>
                            ))}
                          </View>
                          <View style={s.startCard}>
                            <View style={{ flex: 1, gap: 12 }}>
                              <Text style={s.heroEyebrow}>
                                ПЕРИОДИЧЕСКИЙ УПРАВЛЕНЧЕСКИЙ ОБХОД
                              </Text>
                              <Text style={s.startTitle}>
                                {active
                                  ? "Продолжим с сохранённого шага"
                                  : "Свежий взгляд на кофейню"}
                              </Text>
                              <Text style={s.heroDescription}>
                                {active
                                  ? `Сохранено ${active.completed} из ${active.questionCount} пунктов. Начало: ${date(active.startedAt)}.`
                                  : `${totalForCafe} вопросов · 12 разделов · 10 фотографий`}
                              </Text>
                              <Text style={s.heroDescription}>
                                При ответе «Нет» опишите проблему. Фото нужны
                                только в отмеченных вопросах.
                              </Text>
                            </View>
                            <Pressable
                              accessibilityRole="button"
                              disabled={busy || !selectedCafe}
                              onPress={() => act(start)}
                              style={s.startButton}
                            >
                              <Text style={s.startButtonText}>
                                {active ? "Продолжить обход" : "Начать обход"} ↗
                              </Text>
                            </Pressable>
                          </View>
                          <View style={s.infoRow}>
                            <Text style={s.muted}>
                              ◷ Дата, время и автор фиксируются автоматически
                            </Text>
                            <Text style={s.muted}>
                              ✓ Сохранение после каждого завершённого шага
                            </Text>
                          </View>
                          <Text style={s.sectionTitle}>Маршрут обхода</Text>
                          <View style={s.sectionGrid}>
                            {checklist.sections.map((sec) => (
                              <View
                                key={sec.id}
                                style={[s.routeCard, wide && { width: "48%" }]}
                              >
                                <Text style={s.routeNumber}>
                                  {sec.id.padStart(2, "0")}
                                </Text>
                                <View style={{ flex: 1 }}>
                                  <Text style={s.cardTitle}>{sec.title}</Text>
                                  <Text style={s.muted}>
                                    {`${sec.questions.length} вопросов`}
                                  </Text>
                                </View>
                                <Text style={s.muted}>↗</Text>
                              </View>
                            ))}
                          </View>
                        </>
                      ) : (
                        <View style={s.card}>
                          <Text style={s.sectionTitle}>
                            Результаты ваших кофеен
                          </Text>
                          <Text style={s.subtitle}>
                            Смотрите завершённые обходы, нарушения и фотографии.
                          </Text>
                          <Button
                            onPress={() =>
                              act(async () => {
                                await refresh();
                                setPage("results");
                              })
                            }
                          >
                            Открыть результаты
                          </Button>
                        </View>
                      )}
                    </>
                  )}
                  {run && page === "sections" && (
                    <>
                      <Button
                        kind="ghost"
                        small
                        onPress={() =>
                          act(async () => {
                            await refresh();
                            setPage("home");
                          })
                        }
                      >
                        ← На главную
                      </Button>
                      <Text style={s.eyebrow}>{cafeName(run.cafeId)}</Text>
                      <Text style={s.title}>Маршрут обхода</Text>
                      <Text style={s.subtitle}>
                        Начало {date(run.startedAt)} · {run.user.name}
                      </Text>
                      <View style={s.progressCard}>
                        <View style={s.between}>
                          <Text style={s.cardTitle}>Общий прогресс</Text>
                          <Text style={s.cardTitle}>
                            {completed} / {all(run).length}
                          </Text>
                        </View>
                        <Progress value={completed / all(run).length} />
                        <Text style={s.muted}>
                          Сохранённые ответы доступны при повторном входе.
                        </Text>
                      </View>
                      <View style={s.sectionGrid}>
                        {run.snapshot.sections.map((sec) => {
                          const n = sec.questions.filter((q) =>
                            complete(q, run),
                          ).length;
                          return (
                            <Pressable
                              key={sec.id}
                              accessibilityRole="button"
                              disabled={busy}
                              style={[s.sectionCard, wide && { width: "48%" }]}
                              onPress={() =>
                                goQuestion(
                                  sec.questions.find(
                                    (q) => !complete(q, run),
                                  ) || sec.questions[0],
                                )
                              }
                            >
                              <View style={s.between}>
                                <Text style={s.routeNumber}>
                                  {sec.id.padStart(2, "0")}
                                </Text>
                                <Tag>
                                  {n === sec.questions.length
                                    ? "✓ Готово"
                                    : `${n} / ${sec.questions.length}`}
                                </Tag>
                              </View>
                              <Text style={s.cardTitle}>{sec.title}</Text>
                              <Progress value={n / sec.questions.length} />
                            </Pressable>
                          );
                        })}
                      </View>
                      <Button onPress={() => setPage("review")}>
                        Проверить перед отправкой →
                      </Button>
                    </>
                  )}
                  {run && page === "question" && (
                    <QuestionScreen
                      key={`${run.id}-${questionId}`}
                      run={run}
                      questionId={questionId}
                      act={act}
                      onSave={saveAnswer}
                      onBack={() => setPage("sections")}
                      onPhoto={(p) =>
                        setRun((r) =>
                          r ? { ...r, photos: [...r.photos, p] } : r,
                        )
                      }
                    />
                  )}
                  {run && (page === "review" || page === "report") && (
                    <>
                      <Button
                        kind="ghost"
                        small
                        onPress={() =>
                          page === "review"
                            ? setPage("sections")
                            : act(async () => {
                                await refresh();
                                setPage("results");
                              })
                        }
                      >
                        ← {page === "review" ? "К разделам" : "К результатам"}
                      </Button>
                      <Text style={s.eyebrow}>{cafeName(run.cafeId)}</Text>
                      <View style={s.heading}>
                        <Text style={s.title}>
                          {page === "review"
                            ? "Проверим перед отправкой"
                            : "Результат обхода"}
                        </Text>
                        <Tag>
                          {run.status === "submitted"
                            ? "✓ Отправлен · защищён"
                            : "Черновик"}
                        </Tag>
                      </View>
                      <Text style={s.subtitle}>
                        {run.user.name} · {date(run.startedAt)}
                        {run.finishedAt ? ` → ${date(run.finishedAt)}` : ""}
                      </Text>
                      <View style={s.stats}>
                        <Stat
                          value={`${completed}/${all(run).length}`}
                          label="проверено"
                        />
                        <Stat
                          value={String(
                            Object.values(run.answers).filter(
                              (a) => a.value === "no",
                            ).length,
                          )}
                          label="нарушений"
                        />
                        <Stat
                          value={`${all(run).filter((q) => q.photoRequired && run.photos.some((p) => p.id === run.answers[q.id]?.photoId && p.questionId === q.id)).length}/10`}
                          label="обязательных фото"
                        />
                      </View>
                      {page === "review" && completed < all(run).length && (
                        <View style={s.error}>
                          <View style={{ flex: 1, gap: 8 }}>
                            <Text style={s.cardTitle}>
                              Осталось заполнить {all(run).length - completed}{" "}
                              пунктов
                            </Text>
                            <Text style={s.body}>
                              Без ответов, комментариев и обязательных фото
                              отправка недоступна.
                            </Text>
                            <Button
                              kind="secondary"
                              onPress={() =>
                                goQuestion(
                                  all(run).find((q) => !complete(q, run))!,
                                )
                              }
                            >
                              Продолжить заполнение
                            </Button>
                          </View>
                        </View>
                      )}
                      <Text style={s.sectionTitle}>Выявленные нарушения</Text>
                      <Text style={s.subtitle}>
                        Здесь только ответы «Нет» и комментарии к ним.
                      </Text>
                      {all(run)
                        .filter((q) => run.answers[q.id]?.value === "no")
                        .map((q) => (
                          <View key={q.id} style={s.issueCard}>
                            <Tag alert>НЕТ · {q.id}</Tag>
                            <Text style={s.cardTitle}>{q.text}</Text>
                            <Text style={s.body}>
                              {run.answers[q.id].comment}
                            </Text>
                            {page === "review" && (
                              <Button
                                kind="ghost"
                                small
                                onPress={() => goQuestion(q)}
                              >
                                Изменить ответ
                              </Button>
                            )}
                          </View>
                        ))}
                      {!Object.values(run.answers).some(
                        (a) => a.value === "no",
                      ) && (
                        <View style={s.card}>
                          <Text style={s.cardTitle}>
                            {completed === all(run).length
                              ? "Нарушений не выявлено"
                              : "Пока нет ответов «Нет»"}
                          </Text>
                          <Text style={s.muted}>
                            {completed === all(run).length
                              ? "Все проверенные пункты соответствуют стандарту."
                              : "Итог будет сформирован после заполнения обхода."}
                          </Text>
                        </View>
                      )}
                      <Text style={s.sectionTitle}>Фото контрольных точек</Text>
                      {run.snapshot.sections.flatMap((sec) =>
                        sec.questions
                          .filter((q) => q.photoRequired)
                          .map((q) => {
                            const id = run.answers[q.id]?.photoId;
                            const present =
                              !!id &&
                              run.photos.some(
                                (p) => p.id === id && p.questionId === q.id,
                              );
                            return (
                              <View key={q.id} style={s.card}>
                                <View style={s.between}>
                                  <Text style={[s.cardTitle, { flex: 1 }]}>
                                    {sec.title}
                                  </Text>
                                  <Tag alert={!present}>
                                    {present ? "✓ Фото есть" : "Нет фото"}
                                  </Tag>
                                </View>
                                {page === "report" && present && (
                                  <PhotoView id={id!} />
                                )}
                                {page === "review" && !present && (
                                  <Button
                                    kind="ghost"
                                    small
                                    onPress={() => goQuestion(q)}
                                  >
                                    Перейти к вопросу {q.id}
                                  </Button>
                                )}
                              </View>
                            );
                          }),
                      )}
                      {page === "review" ? (
                        <View style={s.card}>
                          <Text style={s.cardTitle}>Готово к отправке?</Text>
                          <Text style={s.body}>
                            После отправки ответы, комментарии и фотографии
                            блокируются. Время завершения сохранится в отчёте.
                          </Text>
                          <Button
                            disabled={completed !== all(run).length}
                            onPress={() => act(submit)}
                          >
                            Завершить и отправить обход
                          </Button>
                        </View>
                      ) : (
                        <View style={s.seal}>
                          <Text style={s.cardTitle}>
                            {run.status === "submitted"
                              ? "✓ Результат зафиксирован"
                              : "Обход ещё выполняется"}
                          </Text>
                          <Text style={s.body}>
                            {run.status === "submitted"
                              ? `Завершение: ${date(run.finishedAt)}. Изменение завершённого обхода заблокировано.`
                              : "Это черновик. Управляющий продолжает заполнение; итог появится после отправки."}
                          </Text>
                          <Text selectable style={s.footnote}>
                            № {run.id}
                            {"\n"}Версия: {run.snapshot.version}
                            {run.checksum &&
                              `\nКонтрольная сумма: ${run.checksum}`}
                          </Text>
                        </View>
                      )}
                    </>
                  )}
                  {page === "results" && (
                    <>
                      <View style={s.heading}>
                        <View>
                          <Text style={s.eyebrow}>
                            GARDEN /{" "}
                            {user.role === "admin" ? "ВСЯ СЕТЬ" : "МОИ ОБХОДЫ"}
                          </Text>
                          <Text style={s.title}>Результаты обходов</Text>
                          <Text style={s.subtitle}>
                            От общего состояния — к конкретной детали.
                          </Text>
                        </View>
                        <Button
                          kind="secondary"
                          small
                          onPress={() => act(refresh)}
                        >
                          Обновить ↻
                        </Button>
                      </View>
                      <View style={s.wrap}>
                        <Button
                          small
                          kind={filter === "" ? "primary" : "secondary"}
                          onPress={() => setFilter("")}
                        >
                          Все кофейни
                        </Button>
                        {cafes.map((c) => (
                          <Button
                            key={c.id}
                            small
                            kind={filter === c.id ? "primary" : "secondary"}
                            onPress={() => setFilter(c.id)}
                          >
                            {c.name}
                          </Button>
                        ))}
                      </View>
                      <View style={s.stats}>
                        <Stat
                          value={String(
                            runs.filter(
                              (r) =>
                                (!filter || r.cafeId === filter) &&
                                r.status === "submitted",
                            ).length,
                          )}
                          label="завершено"
                        />
                        <Stat
                          value={String(
                            runs.filter(
                              (r) =>
                                (!filter || r.cafeId === filter) &&
                                r.status === "draft",
                            ).length,
                          )}
                          label="в процессе"
                        />
                        <Stat
                          value={String(
                            runs
                              .filter(
                                (r) =>
                                  (!filter || r.cafeId === filter) &&
                                  r.status === "submitted",
                              )
                              .reduce((n, r) => n + r.issues, 0),
                          )}
                          label="нарушений"
                        />
                      </View>
                      <View style={s.sectionGrid}>
                        {cafes
                          .filter((c) => !filter || c.id === filter)
                          .map((c) => {
                            const recent = runs.find(
                              (r) =>
                                r.cafeId === c.id && r.status === "submitted",
                            );
                            return (
                              <View
                                key={c.id}
                                style={[
                                  s.sectionCard,
                                  wide && { width: "48%" },
                                ]}
                              >
                                <Text style={s.cardTitle}>{c.name}</Text>
                                <Text style={s.muted}>
                                  {recent
                                    ? `Последний обход: ${date(recent.finishedAt)}`
                                    : "Завершённых обходов пока нет"}
                                </Text>
                                {recent && (
                                  <Tag alert={recent.issues > 0}>
                                    {recent.issues} нарушений в последнем обходе
                                  </Tag>
                                )}
                              </View>
                            );
                          })}
                      </View>
                      <Text style={s.sectionTitle}>История</Text>
                      {runs
                        .filter((r) => !filter || r.cafeId === filter)
                        .map((r) => (
                          <Pressable
                            key={r.id}
                            accessibilityRole="button"
                            disabled={busy}
                            onPress={() => act(() => openRun(r.id))}
                            style={s.historyCard}
                          >
                            <View style={s.between}>
                              <Text style={[s.cardTitle, { flex: 1 }]}>
                                {cafeName(r.cafeId)}
                              </Text>
                              <Tag>
                                {r.status === "submitted"
                                  ? "Отправлен"
                                  : "В процессе"}
                              </Tag>
                            </View>
                            <Text style={s.muted}>
                              {r.user.name} · {date(r.startedAt)}
                            </Text>
                            <View style={s.between}>
                              <Text style={s.body}>
                                {r.status === "submitted"
                                  ? `${r.issues} нарушений`
                                  : `${r.completed} / ${r.questionCount} пунктов`}
                              </Text>
                              <Text style={s.cardTitle}>Открыть →</Text>
                            </View>
                          </Pressable>
                        ))}
                      {!runs.some((r) => !filter || r.cafeId === filter) && (
                        <View style={s.empty}>
                          <Text style={s.emptySymbol}>◎</Text>
                          <Text style={s.sectionTitle}>
                            Первый обход — впереди
                          </Text>
                          <Text style={s.subtitle}>
                            После запуска здесь появится прогресс, а после
                            отправки — результат с нарушениями и фото.
                          </Text>
                          {user.role === "manager" && (
                            <Button onPress={() => setPage("home")}>
                              Перейти к обходу
                            </Button>
                          )}
                        </View>
                      )}
                    </>
                  )}
                </>
              )}
              {(!user || page === "home") && <WebInstallCard />}
              <Text style={s.bottomNote}>
                GARDEN · ВНИМАНИЕ К КАЖДОЙ ДЕТАЛИ
              </Text>
            </ScrollView>
          </View>
          {user && !wide && (
            <View style={s.bottomnav}>
              <Button
                small
                kind={page === "home" ? "primary" : "ghost"}
                onPress={() =>
                  act(async () => {
                    await refresh();
                    setPage("home");
                  })
                }
              >
                Обход
              </Button>
              <Button
                small
                kind={page === "results" ? "primary" : "ghost"}
                onPress={() =>
                  act(async () => {
                    await refresh();
                    setPage("results");
                  })
                }
              >
                Результаты
              </Button>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Busy.Provider>
  );
}
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function QuestionScreen({
  run,
  questionId,
  onSave,
  onBack,
  onPhoto,
  act,
}: {
  run: Inspection;
  questionId: string;
  onSave: (q: Question, a: Answer) => Promise<void>;
  onBack: () => void;
  onPhoto: (p: Photo) => void;
  act: (fn: () => Promise<void>) => Promise<void>;
}) {
  const section = run.snapshot.sections.find((sec) =>
    sec.questions.some((q) => q.id === questionId),
  )!;
  const q = section.questions.find((q) => q.id === questionId)!;
  const existing = run.answers[q.id];
  const [value, setValue] = useState<"yes" | "no" | undefined>(existing?.value),
    [comment, setComment] = useState(existing?.comment || ""),
    [photoId, setPhotoId] = useState<string | null>(existing?.photoId || null);
  const [cameraOpen, setCameraOpen] = useState(false),
    [ready, setReady] = useState(false),
    [cameraError, setCameraError] = useState("");
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const busy = useContext(Busy);
  const index = section.questions.findIndex((v) => v.id === q.id);
  const valid =
    !!value &&
    (value !== "no" || !!comment.trim()) &&
    (!q.photoRequired || !!photoId);
  async function openCamera() {
    if (Platform.OS === "web" && !window.isSecureContext)
      throw new Error(
        "Для камеры на телефоне откройте Garden по защищённой ссылке HTTPS.",
      );
    setCameraError("");
    setReady(false);
    const p = permission?.granted ? permission : await requestPermission();
    if (!p.granted)
      throw new Error(
        "Разрешите доступ к камере в настройках приложения или браузера. Без фото контрольной точки отправить обход нельзя.",
      );
    setCameraOpen(true);
  }
  async function capture() {
    if (!camera.current || !ready) return;
    const picture = await camera.current.takePictureAsync({
      quality: 0.25,
      base64: true,
    });
    if (!picture?.base64)
      throw new Error("Не удалось получить фотографию. Попробуйте снова.");
    const photoBase64 = await compactPhotoBase64(picture.base64);
    const photo = await api.call<Photo>(
      `/inspections/${run.id}/photos`,
      "POST",
      { questionId: q.id, base64: photoBase64 },
    );
    setPhotoId(photo.id);
    onPhoto(photo);
    setCameraOpen(false);
  }
  return (
    <View style={s.questionContainer}>
      <Button kind="ghost" small onPress={onBack}>
        ← К разделам · текущий шаг сохраняется кнопкой ниже
      </Button>
      <View style={s.between}>
        <Text style={s.eyebrow}>РАЗДЕЛ {section.id} / 12</Text>
        <Tag>
          {index + 1} / {section.questions.length}
        </Tag>
      </View>
      <Text style={s.sectionTitle}>{section.title}</Text>
      <Progress
        value={
          section.questions.filter((v) => complete(v, run)).length /
          section.questions.length
        }
      />
      <View style={s.questionCard}>
        <Text style={s.eyebrow}>ПУНКТ {q.id}</Text>
        <Text style={s.questionText}>{q.text}</Text>
        {section.id === "8" && (
          <Text style={s.footnote}>
            Не проверяем сроки годности, маркировки, стоп-лист и работу текущей
            смены.
          </Text>
        )}
        {q.id === "11.1" && (
          <Text style={s.footnote}>
            Брендированная футболка + фартук либо брендированная футболка +
            рубашка; бейдж обязателен; длинные волосы собраны.
          </Text>
        )}
        <View style={s.answers}>
          {(["yes", "no"] as const).map((v) => (
            <Pressable
              key={v}
              accessibilityRole="radio"
              accessibilityState={{ checked: value === v }}
              disabled={busy}
              onPress={() => setValue(v)}
              style={[
                s.answer,
                value === v && (v === "yes" ? s.answerYes : s.answerNo),
              ]}
            >
              <Text style={[s.answerText, value === v && { color: C.white }]}>
                {v === "yes" ? "✓  Да" : "×  Нет"}
              </Text>
            </Pressable>
          ))}
        </View>
        {value === "no" && (
          <View style={s.commentBox}>
            <Text style={s.label}>Что необходимо исправить? *</Text>
            <TextInput
              accessibilityLabel="Комментарий к нарушению"
              value={comment}
              onChangeText={setComment}
              editable={!busy}
              multiline
              maxLength={2000}
              placeholder="Опишите проблему и место, где её заметили"
              placeholderTextColor={C.muted}
              style={[s.input, s.textarea]}
            />
            <Text style={s.footnote}>
              Комментарий обязателен · {comment.length}/2000
            </Text>
          </View>
        )}
        {q.photoRequired && (
          <View style={s.cameraBox}>
            <View style={s.between}>
              <Text style={s.cardTitle}>Фото контрольной точки</Text>
              <Tag>{photoId ? "✓ Загружено" : "Обязательно"}</Tag>
            </View>
            <Text style={s.muted}>Снимите общий вид камерой в приложении.</Text>
            {photoId && <PhotoView id={photoId} />}
            <Button kind="secondary" onPress={() => act(openCamera)}>
              {photoId ? "Переснять фото" : "◎  Открыть камеру"}
            </Button>
          </View>
        )}
        <Button
          disabled={!valid}
          onPress={() =>
            act(() => onSave(q, { value: value!, comment, photoId }))
          }
        >
          Сохранить и дальше →
        </Button>
        <Text style={s.footnote}>
          {!value
            ? "Выберите Да или Нет."
            : value === "no" && !comment.trim()
              ? "Добавьте комментарий, чтобы продолжить."
              : q.photoRequired && !photoId
                ? "Сделайте обязательное фото, чтобы продолжить."
                : "Ответ сохранится после нажатия кнопки."}
        </Text>
      </View>
      <Modal
        visible={cameraOpen}
        animationType="slide"
        onRequestClose={() => {
          if (!busy) setCameraOpen(false);
        }}
      >
        <SafeAreaView style={s.cameraModal}>
          <View style={s.cameraHeader}>
            <Text style={{ color: C.white, fontSize: 18, flex: 1 }}>
              Контрольная точка {q.id}
            </Text>
            <Button kind="secondary" small onPress={() => setCameraOpen(false)}>
              Закрыть
            </Button>
          </View>
          {cameraOpen && (
            <CameraView
              ref={camera}
              style={{ flex: 1 }}
              facing="back"
              onCameraReady={() => setReady(true)}
              onMountError={(e) => setCameraError(e.message)}
            />
          )}
          {cameraError !== "" && (
            <Text style={s.cameraError}>{cameraError}</Text>
          )}
          <View style={s.cameraControls}>
            <Text style={{ color: C.white, textAlign: "center" }}>
              Общий вид · фото относится к текущему вопросу
            </Text>
            <Button
              disabled={!ready || busy}
              onPress={() =>
                act(async () => {
                  try {
                    await capture();
                  } catch (e) {
                    setCameraError(
                      e instanceof Error ? e.message : "Ошибка съёмки",
                    );
                  }
                })
              }
            >
              {busy ? "Загружаем фото…" : "●  Сделать фото"}
            </Button>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    backgroundColor: C.paper,
  },
  topbar: {
    backgroundColor: C.white,
    borderBottomWidth: 1,
    borderColor: C.line,
  },
  topinner: {
    width: "100%",
    maxWidth: 1440,
    alignSelf: "center",
    minHeight: 84,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  logo: { fontSize: 36, fontWeight: "700", letterSpacing: -2, color: C.green },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  topLabel: {
    fontSize: 10,
    letterSpacing: 2,
    color: C.muted,
    display: Platform.OS === "web" ? "flex" : "none",
  },
  layout: { flex: 1, width: "100%", maxWidth: 1440, alignSelf: "center" },
  sidebar: {
    width: 245,
    padding: 24,
    borderRightWidth: 1,
    borderColor: C.line,
    gap: 18,
  },
  profile: { gap: 8, paddingBottom: 24 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.lime,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 18, fontWeight: "700", color: C.green },
  content: {
    padding: 24,
    gap: 18,
    maxWidth: 1200,
    width: "100%",
    alignSelf: "center",
    paddingBottom: 48,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: C.muted,
    lineHeight: 17,
  },
  title: {
    fontSize: 32,
    fontWeight: "600",
    color: C.ink,
    letterSpacing: -1,
    lineHeight: 39,
  },
  subtitle: { fontSize: 15, color: C.muted, lineHeight: 23 },
  body: { fontSize: 14, color: C.ink, lineHeight: 22 },
  muted: { fontSize: 12, color: C.muted, lineHeight: 19 },
  footnote: { fontSize: 11, color: C.muted, lineHeight: 17 },
  label: { fontSize: 13, fontWeight: "600", color: C.ink, marginBottom: 2 },
  button: {
    minHeight: 51,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  smallButton: {
    minHeight: 38,
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 9,
  },
  primary: { backgroundColor: C.green },
  secondary: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line },
  ghost: { backgroundColor: "transparent" },
  danger: { backgroundColor: C.red },
  buttonText: {
    fontSize: 14,
    fontWeight: "600",
    color: C.green,
    textAlign: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    padding: 14,
    minHeight: 50,
    fontSize: 16,
    color: C.ink,
    backgroundColor: "#FAFBF7",
  },
  textarea: { minHeight: 115, textAlignVertical: "top" },
  tag: {
    alignSelf: "flex-start",
    backgroundColor: "#EAF0E3",
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  tagText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
    color: C.green,
  },
  heading: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 6,
  },
  between: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  loginLayout: { gap: 22 },
  hero: {
    backgroundColor: C.green,
    borderRadius: 22,
    padding: 30,
    gap: 28,
    overflow: "hidden",
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  heroEyebrow: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1.4,
    color: C.lime,
    lineHeight: 18,
  },
  heroSymbol: { fontSize: 45, color: C.lime },
  heroTitle: {
    fontSize: 45,
    fontWeight: "500",
    lineHeight: 51,
    letterSpacing: -1.8,
    color: C.white,
    marginTop: 15,
  },
  heroDescription: {
    fontSize: 14,
    lineHeight: 23,
    color: "#CEDDD3",
    maxWidth: 400,
  },
  heroBottom: {
    marginTop: "auto",
    paddingTop: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderColor: "#3C5C4E",
    flexWrap: "wrap",
  },
  heroNumber: { fontSize: 31, color: C.lime },
  heroMetric: { fontSize: 10, lineHeight: 16, color: "#CEDDD3" },
  heroDivider: {
    width: 1,
    height: 36,
    backgroundColor: "#3C5C4E",
    marginHorizontal: 5,
  },
  loginCard: {
    backgroundColor: C.white,
    borderRadius: 22,
    padding: 28,
    gap: 15,
    borderWidth: 1,
    borderColor: C.line,
  },
  demoBox: {
    padding: 16,
    backgroundColor: C.paper,
    borderRadius: 12,
    gap: 10,
    marginTop: 8,
  },
  startCard: {
    backgroundColor: C.green,
    borderRadius: 18,
    padding: 28,
    gap: 26,
    marginVertical: 4,
  },
  startTitle: {
    fontSize: 29,
    lineHeight: 36,
    fontWeight: "500",
    color: C.white,
    letterSpacing: -0.7,
  },
  startButton: {
    padding: 17,
    backgroundColor: C.lime,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  startButtonText: { color: C.green, fontWeight: "700", fontSize: 15 },
  infoRow: { gap: 6 },
  sectionTitle: {
    fontSize: 21,
    fontWeight: "600",
    color: C.ink,
    letterSpacing: -0.4,
    marginTop: 8,
  },
  sectionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  routeCard: {
    width: "100%",
    backgroundColor: C.white,
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  routeNumber: { fontSize: 17, color: "#839B80", fontWeight: "500" },
  cardTitle: { fontSize: 15, fontWeight: "600", color: C.ink, lineHeight: 22 },
  card: {
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.white,
    gap: 12,
  },
  sectionCard: {
    width: "100%",
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.white,
    gap: 16,
  },
  progressCard: {
    padding: 20,
    borderRadius: 14,
    backgroundColor: "#E9EFDF",
    gap: 14,
  },
  track: {
    height: 5,
    borderRadius: 4,
    backgroundColor: "#E1E6DB",
    overflow: "hidden",
  },
  fill: { height: 5, backgroundColor: "#769647", borderRadius: 4 },
  questionContainer: {
    width: "100%",
    maxWidth: 750,
    alignSelf: "center",
    gap: 20,
  },
  questionCard: {
    padding: 25,
    borderRadius: 18,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    gap: 22,
  },
  questionText: {
    fontSize: 25,
    lineHeight: 35,
    fontWeight: "500",
    color: C.ink,
    letterSpacing: -0.4,
  },
  answers: { flexDirection: "row", gap: 12 },
  answer: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.line,
    padding: 21,
    borderRadius: 12,
    backgroundColor: "#F8FAF4",
    alignItems: "center",
  },
  answerYes: { backgroundColor: C.green, borderColor: C.green },
  answerNo: { backgroundColor: C.red, borderColor: C.red },
  answerText: { fontSize: 21, fontWeight: "600", color: C.green },
  commentBox: { gap: 8 },
  cameraBox: {
    backgroundColor: C.paper,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  photo: {
    width: "100%",
    height: 220,
    borderRadius: 10,
    backgroundColor: "#E6EADF",
  },
  cameraModal: { flex: 1, backgroundColor: "#12291F" },
  cameraHeader: {
    padding: 20,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  cameraControls: { padding: 24, gap: 15 },
  cameraError: { padding: 16, backgroundColor: C.redBg, color: C.red },
  stats: { flexDirection: "row", gap: 10, marginVertical: 6 },
  stat: {
    flex: 1,
    padding: 16,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    gap: 6,
  },
  statValue: {
    fontSize: 26,
    fontWeight: "500",
    color: C.green,
    letterSpacing: -1,
  },
  statLabel: { fontSize: 11, color: C.muted },
  issueCard: {
    padding: 20,
    borderRadius: 14,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: "#EDD5CE",
    borderLeftWidth: 3,
    borderLeftColor: C.red,
    gap: 14,
  },
  seal: { padding: 22, borderRadius: 14, backgroundColor: "#E9EFDF", gap: 12 },
  historyCard: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    padding: 20,
    gap: 12,
  },
  empty: {
    alignItems: "center",
    padding: 35,
    gap: 12,
    borderWidth: 1,
    borderColor: C.line,
    borderStyle: "dashed",
    borderRadius: 18,
  },
  emptySymbol: { fontSize: 42, color: "#90A875" },
  error: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: C.redBg,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  notice: { padding: 18, borderRadius: 12, backgroundColor: C.lime },
  busy: { flexDirection: "row", gap: 10, alignItems: "center" },
  bottomnav: {
    flexDirection: "row",
    justifyContent: "space-around",
    padding: 10,
    borderTopWidth: 1,
    borderColor: C.line,
    backgroundColor: C.white,
  },
  bottomNote: {
    fontSize: 9,
    letterSpacing: 2,
    color: "#96A28E",
    textAlign: "center",
    marginTop: 30,
  },
});








