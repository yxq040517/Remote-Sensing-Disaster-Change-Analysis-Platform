import type { Case, Task, Status, Review } from "./types";
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, init);
  if (!response.ok) {
    const detail = await response
      .json()
      .catch(() => ({ detail: "服务暂时不可用" }));
    throw new Error(
      typeof detail.detail === "string" ? detail.detail : "请求参数不正确",
    );
  }
  return response.json();
}
export const api = {
  status: () => request<Status>("/status"),
  cases: () => request<Case[]>("/cases"),
  tasks: () => request<Task[]>("/tasks"),
  task: (id: string) => request<Task>(`/tasks/${id}`),
  analyze: (id: string) =>
    request<Task>("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ case_id: id }),
    }),
  upload: (body: FormData) =>
    request<Task>("/upload", { method: "POST", body }),
  save: (id: string, review: Review) =>
    request<Review>(`/tasks/${id}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(review),
    }),
  undo: (id: string, review: string) =>
    request(`/tasks/${id}/reviews/${review}`, { method: "DELETE" }),
  pick: (id: string, x: number, y: number) =>
    request<{ region_id: number }>(`/tasks/${id}/pick?x=${x}&y=${y}`),
  retry: (id: string, device = "auto") =>
    request<Task>(`/tasks/${id}/retry?device=${device}`, { method: "POST" }),
  evaluate: () => request("/evaluate", { method: "POST" }),
};
export const file = (id: string, name: string, revision?: string | number) =>
  `/api/tasks/${id}/files/${name}${revision === undefined ? "" : `?v=${encodeURIComponent(revision)}`}`;
export const caseFile = (id: string, name = "after") =>
  `/api/cases/${id}/${name}`;
export const reviewRevision = (reviews: Review[]) =>
  reviews.map((r) => r.id || "").join("-");
