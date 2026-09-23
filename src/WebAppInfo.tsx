import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
type InstallWindow = Window & { gardenInstallPrompt?: InstallPrompt | null };
export function WebConnectionStatus() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <View accessibilityRole="alert" style={styles.offline}>
      <Text style={styles.title}>Нет подключения к сети</Text>
      <Text style={styles.text}>
        Для сохранения ответов, загрузки фото и отправки обхода нужен интернет.
        Ранее сохранённые шаги остаются на сервере.
      </Text>
    </View>
  );
}
export function WebInstallCard() {
  const [installed, setInstalled] = useState(false),
    [available, setAvailable] = useState(false),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const mode = window.matchMedia("(display-mode: standalone)");
    const update = () => {
      setInstalled(
        mode.matches ||
          !!(navigator as Navigator & { standalone?: boolean }).standalone,
      );
      setAvailable(!!(window as InstallWindow).gardenInstallPrompt);
    };
    const done = () => {
      setInstalled(true);
      setAvailable(false);
    };
    update();
    window.addEventListener("garden-install-ready", update);
    window.addEventListener("garden-installed", done);
    mode.addEventListener("change", update);
    return () => {
      window.removeEventListener("garden-install-ready", update);
      window.removeEventListener("garden-installed", done);
      mode.removeEventListener("change", update);
    };
  }, []);
  if (Platform.OS !== "web" || installed) return null;
  async function install() {
    const prompt = (window as InstallWindow).gardenInstallPrompt;
    if (!prompt) return;
    setPending(true);
    try {
      await prompt.prompt();
      const result = await prompt.userChoice;
      setMessage(
        result.outcome === "accepted"
          ? "Установка запрошена. Дождитесь подтверждения браузера."
          : "Можно добавить Garden позже через меню браузера.",
      );
    } catch {
      setMessage("Добавьте Garden через меню браузера по инструкции ниже.");
    } finally {
      (window as InstallWindow).gardenInstallPrompt = null;
      setAvailable(false);
      setPending(false);
    }
  }
  return (
    <View style={styles.card}>
      <Text style={styles.label}>ВЕБ-ПРИЛОЖЕНИЕ</Text>
      <Text style={styles.title}>Garden на главном экране</Text>
      <Text style={styles.text}>
        Открывайте обходы как обычное приложение — без магазинов приложений.
      </Text>
      {available && (
        <Pressable
          accessibilityRole="button"
          disabled={pending}
          onPress={install}
          style={styles.button}
        >
          <Text style={styles.buttonText}>
            {pending ? "Открываем установку…" : "Добавить Garden на устройство"}
          </Text>
        </Pressable>
      )}
      <Text style={styles.text}>
        <Text style={styles.bold}>iPhone:</Text> откройте ссылку в Safari →
        «Поделиться» → «На экран Домой».
      </Text>
      <Text style={styles.text}>
        <Text style={styles.bold}>Android:</Text> откройте ссылку в Chrome →
        меню ⋮ → «Установить приложение» или «Добавить на главный экран».
      </Text>
      {message !== "" && <Text style={styles.text}>{message}</Text>}
      <Text style={styles.note}>
        Для обхода нужен интернет. На телефоне камера доступна через защищённую
        ссылку HTTPS.
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 22,
    gap: 12,
    backgroundColor: "#E9EFDF",
    borderWidth: 1,
    borderColor: "#DEE4DA",
  },
  offline: {
    padding: 16,
    gap: 8,
    borderRadius: 12,
    backgroundColor: "#FFF0D4",
  },
  title: { fontSize: 19, fontWeight: "600", color: "#183F35" },
  text: { fontSize: 14, lineHeight: 22, color: "#203B33" },
  bold: { fontWeight: "700" },
  label: {
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: "700",
    color: "#647753",
  },
  note: { fontSize: 12, lineHeight: 18, color: "#68766A" },
  button: {
    backgroundColor: "#183F35",
    padding: 16,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: { color: "white", fontSize: 14, fontWeight: "600" },
});
