import {
  TRACKED_CHANGE_FIELDS,
  stableProductKey,
  type HistoryEvent,
  type NormalizedProduct,
  type TrackedChangeField,
} from "./types";

export type SnapshotDiff = {
  newProducts: NormalizedProduct[];
  changed: Array<{ previous: NormalizedProduct; current: NormalizedProduct; changedFields: TrackedChangeField[] }>;
  removed: NormalizedProduct[];
};

function valuesEqual(a: unknown, b: unknown): boolean {
  return a === b;
}

export function changedTrackedFields(
  previous: NormalizedProduct,
  current: NormalizedProduct,
): TrackedChangeField[] {
  return TRACKED_CHANGE_FIELDS.filter((field) => !valuesEqual(previous[field], current[field]));
}

export function isSnapshotPlausible(
  previousCount: number,
  currentCount: number,
  minRatio: number,
  previousCountFloor = 100,
): boolean {
  if (previousCount >= previousCountFloor && currentCount < previousCount * minRatio) {
    return false;
  }
  return true;
}

export function diffSnapshots(previous: NormalizedProduct[], current: NormalizedProduct[]): SnapshotDiff {
  const previousByKey = new Map(previous.map((product) => [stableProductKey(product), product]));
  const currentKeys = new Set<string>();
  const newProducts: SnapshotDiff["newProducts"] = [];
  const changed: SnapshotDiff["changed"] = [];

  for (const product of current) {
    const key = stableProductKey(product);
    currentKeys.add(key);
    const prior = previousByKey.get(key);
    if (!prior) {
      newProducts.push(product);
      continue;
    }
    if (prior.content_hash === product.content_hash) {
      continue;
    }
    const fields = changedTrackedFields(prior, product);
    if (fields.length > 0) {
      changed.push({ previous: prior, current: product, changedFields: fields });
    }
  }

  const removed = previous.filter((product) => !currentKeys.has(stableProductKey(product)));

  return { newProducts, changed, removed };
}

export function toHistoryEvents(options: {
  diff: SnapshotDiff;
  runId: string;
  capturedAt: string;
  includeRemoved: boolean;
  uuid: () => string;
}): HistoryEvent[] {
  const events: HistoryEvent[] = [];

  for (const product of options.diff.newProducts) {
    events.push({
      event_id: options.uuid(),
      captured_at: options.capturedAt,
      run_id: options.runId,
      event_type: "new",
      source: product.source,
      store_context: product.store_context,
      category_id: product.category_id,
      product_id: product.product_id,
      sku: product.sku,
      product_name: product.product_name,
      changed_fields: "",
      old_price_php: null,
      new_price_php: product.price_php,
      old_regular_price_php: null,
      new_regular_price_php: product.regular_price_php,
      old_special_price: null,
      new_special_price: product.special_price,
      old_max_qty: null,
      new_max_qty: product.max_qty,
      old_content_hash: "",
      new_content_hash: product.content_hash,
    });
  }

  for (const item of options.diff.changed) {
    events.push({
      event_id: options.uuid(),
      captured_at: options.capturedAt,
      run_id: options.runId,
      event_type: "changed",
      source: item.current.source,
      store_context: item.current.store_context,
      category_id: item.current.category_id,
      product_id: item.current.product_id,
      sku: item.current.sku,
      product_name: item.current.product_name,
      changed_fields: item.changedFields.join(","),
      old_price_php: item.previous.price_php,
      new_price_php: item.current.price_php,
      old_regular_price_php: item.previous.regular_price_php,
      new_regular_price_php: item.current.regular_price_php,
      old_special_price: item.previous.special_price,
      new_special_price: item.current.special_price,
      old_max_qty: item.previous.max_qty,
      new_max_qty: item.current.max_qty,
      old_content_hash: item.previous.content_hash,
      new_content_hash: item.current.content_hash,
    });
  }

  if (options.includeRemoved) {
    for (const product of options.diff.removed) {
      events.push({
        event_id: options.uuid(),
        captured_at: options.capturedAt,
        run_id: options.runId,
        event_type: "removed",
        source: product.source,
        store_context: product.store_context,
        category_id: product.category_id,
        product_id: product.product_id,
        sku: product.sku,
        product_name: product.product_name,
        changed_fields: "",
        old_price_php: product.price_php,
        new_price_php: null,
        old_regular_price_php: product.regular_price_php,
        new_regular_price_php: null,
        old_special_price: product.special_price,
        new_special_price: null,
        old_max_qty: product.max_qty,
        new_max_qty: null,
        old_content_hash: product.content_hash,
        new_content_hash: "",
      });
    }
  }

  return events;
}

export function filterSnapshotContext(
  products: NormalizedProduct[],
  context: Pick<NormalizedProduct, "source" | "store_context" | "category_id">,
): NormalizedProduct[] {
  return products.filter(
    (product) =>
      product.source === context.source &&
      product.store_context === context.store_context &&
      product.category_id === context.category_id,
  );
}
