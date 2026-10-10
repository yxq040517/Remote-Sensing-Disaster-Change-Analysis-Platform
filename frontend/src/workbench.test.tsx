import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
test("review explicitly confirms a selected candidate and persists its category", async () => {
  const { ReviewPanel } = await import("./Panels");
  const save = vi.fn();
  render(
    <ReviewPanel
      region={{
        id: 1,
        class_id: 4,
        pixels: 100,
        bbox: [0, 0, 10, 10],
        confidence: 0.8,
      }}
      reviews={[]}
      onSave={save}
      onUndo={vi.fn()}
      taskId="test"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "确认并保存" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ region_id: 1, class_id: 4, status: "confirmed" }),
  );
});
test("review requires an explicit uncertainty state instead of inventing a category", async () => {
  const { ReviewPanel } = await import("./Panels");
  const save = vi.fn();
  render(
    <ReviewPanel
      region={{
        id: 2,
        class_id: 2,
        pixels: 25,
        bbox: [0, 0, 5, 5],
        confidence: 0.42,
      }}
      reviews={[]}
      onSave={save}
      onUndo={vi.fn()}
      taskId="test"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "标记需复查" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ status: "needs_review" }),
  );
});
test("undoing a different review with the same remaining count invalidates overlay cache", async () => {
  const { reviewRevision } = await import("./api");
  expect(
    reviewRevision([
      { id: "a", kind: "region", class_id: 4, status: "confirmed", note: "" },
    ]),
  ).not.toBe(
    reviewRevision([
      { id: "b", kind: "region", class_id: 3, status: "confirmed", note: "" },
    ]),
  );
});
