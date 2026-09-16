import { describe, expect, it } from "vitest";
import {
  changedTrackedFields,
  diffSnapshots,
  isSnapshotPlausible,
  toHistoryEvents,
} from "../src/products/diff";
import { makeProduct } from "./helpers";

describe("diffSnapshots", () => {
  it("marks a product as new when it is absent from the previous snapshot", () => {
    const current = makeProduct({ product_id: "200" });
    const diff = diffSnapshots([], [current]);
    expect(diff.newProducts).toEqual([current]);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("produces no event for an unchanged product", () => {
    const previous = makeProduct();
    const current = makeProduct();
    const diff = diffSnapshots([previous], [current]);
    expect(diff.newProducts).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("records a price-only change with old and new prices", () => {
    const previous = makeProduct({ price_php: 80 });
    const current = makeProduct({ price_php: 70 });
    const diff = diffSnapshots([previous], [current]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]?.changedFields).toEqual(["price_php"]);
    const events = toHistoryEvents({
      diff,
      runId: "run-1",
      capturedAt: "2026-09-16T05:00:31.000Z",
      includeRemoved: true,
      uuid: () => "event-1",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: "changed",
      changed_fields: "price_php",
      old_price_php: 80,
      new_price_php: 70,
    });
  });

  it("does not emit a history event when only untracked hash fields change", () => {
    const previous = makeProduct({ special_from_date: "2026-01-01" });
    const current = makeProduct({ special_from_date: "2026-02-01" });
    expect(previous.content_hash).not.toBe(current.content_hash);
    const diff = diffSnapshots([previous], [current]);
    expect(changedTrackedFields(previous, current)).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it("marks products as removed when they disappear from a full snapshot", () => {
    const previous = makeProduct({ product_id: "gone" });
    const diff = diffSnapshots([previous], []);
    expect(diff.removed).toEqual([previous]);
  });
});

describe("toHistoryEvents", () => {
  it("omits removals when the run is partial", () => {
    const previous = makeProduct({ product_id: "gone" });
    const diff = diffSnapshots([previous], []);
    const events = toHistoryEvents({
      diff,
      runId: "run-1",
      capturedAt: "2026-09-16T05:00:31.000Z",
      includeRemoved: false,
      uuid: () => "event-1",
    });
    expect(events).toEqual([]);
  });
});

describe("isSnapshotPlausible", () => {
  it("rejects a drop below the ratio when the previous count is at least 100", () => {
    expect(isSnapshotPlausible(200, 99, 0.5)).toBe(false);
    expect(isSnapshotPlausible(200, 100, 0.5)).toBe(true);
    expect(isSnapshotPlausible(99, 1, 0.5)).toBe(true);
  });
});
