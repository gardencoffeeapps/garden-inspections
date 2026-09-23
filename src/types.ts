export type User = {
  id: string;
  name: string;
  role: "manager" | "admin";
  cafeIds: string[];
};
export type Cafe = {
  id: string;
  name: string;
  address: string;
};
export type Question = { id: string; text: string; photoRequired: boolean };
export type Section = { id: string; title: string; questions: Question[] };
export type Answer = {
  value: "yes" | "no";
  comment: string;
  photoId: string | null;
};
export type Photo = { id: string; questionId: string; createdAt: string };
export type Inspection = {
  id: string;
  cafeId: string;
  user: User;
  status: "draft" | "submitted";
  startedAt: string;
  finishedAt: string | null;
  revision: number;
  snapshot: { version: string; sections: Section[] };
  answers: Record<string, Answer>;
  photos: Photo[];
  checksum: string | null;
};
export type Summary = Omit<Inspection, "snapshot" | "answers" | "photos"> & {
  questionCount: number;
  completed: number;
  issues: number;
};
