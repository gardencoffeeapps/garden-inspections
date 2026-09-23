import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
const defaultBase =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === "web"
    ? window.location.port === "8081"
      ? "http://localhost:8787"
      : window.location.origin
    : "http://localhost:8787");
export const api = {
  base: defaultBase,
  token: "",
  async call<T = any>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(`${this.base}/api${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось выполнить запрос");
      return data;
    } catch (e) {
      if (
        e instanceof Error &&
        (e.name === "AbortError" ||
          e.message === "Failed to fetch" ||
          e.message === "Network request failed")
      )
        throw new Error(
          "Нет связи с сервером. Сохранённые шаги остаются на сервере. Проверьте подключение и повторите.",
        );
      throw e;
    } finally {
      clearTimeout(timer);
    }
  },
  async persist() {
    const value = JSON.stringify({ token: this.token, base: this.base });
    if (Platform.OS === "web") sessionStorage.setItem("garden-session", value);
    else await SecureStore.setItemAsync("garden-session", value);
  },
  async restore() {
    const value =
      Platform.OS === "web"
        ? sessionStorage.getItem("garden-session")
        : await SecureStore.getItemAsync("garden-session");
    if (value) {
      const session = JSON.parse(value);
      this.token = session.token;
      this.base = session.base;
    }
  },
  async clear() {
    this.token = "";
    if (Platform.OS === "web") sessionStorage.removeItem("garden-session");
    else await SecureStore.deleteItemAsync("garden-session");
  },
};
