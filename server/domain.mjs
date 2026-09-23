import { createHash } from "node:crypto";
export function questionsFor(checklist) {
  // One standard for every cafe. Each new inspection keeps its own snapshot.
  return structuredClone(checklist);
}
export const flatten = (snapshot) =>
  snapshot.sections.flatMap((s) => s.questions);
export function errorsFor(snapshot, answers, photos = []) {
  return flatten(snapshot).flatMap((q) => {
    const a = answers[q.id];
    const errors = [];
    if (!a || !["yes", "no"].includes(a.value))
      errors.push("Нужен ответ Да или Нет");
    if (a?.value === "no" && !a.comment?.trim())
      errors.push("Добавьте комментарий");
    if (
      q.photoRequired &&
      !photos.some((p) => p.id === a?.photoId && p.questionId === q.id)
    )
      errors.push("Сделайте обязательное фото");
    return errors.length ? [{ questionId: q.id, errors }] : [];
  });
}
export function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
