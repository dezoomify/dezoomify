import assert from "node:assert/strict";
import test from "node:test";
import { suggestedNameFor } from "../../shared-ui/src/labels.ts";
import {
  BROWSER_SAVE_COLOR_WARNING,
  canvasToPngBlob,
  createManualSave,
  isCanvasTaintError,
} from "../src/canvas-save.ts";

test("canvasToPngBlob resolves the encoded blob", async () => {
  const encoded = new Blob(["png"], { type: "image/png" });
  const result = await canvasToPngBlob({
    toBlob: (cb, mime) => {
      assert.equal(mime, "image/png");
      cb(encoded);
    },
  });
  assert.equal(result, encoded);
});

test("cancelled encoding settles only after the native callback releases its pixels", async () => {
  let complete;
  const controller = new AbortController();
  const encoding = canvasToPngBlob(
    {
      toBlob: (callback) => {
        complete = callback;
      },
    },
    controller.signal,
  );
  let settled = false;
  const cancelled = assert.rejects(encoding, { name: "AbortError" }).then(() => {
    settled = true;
  });
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  complete(new Blob(["png"], { type: "image/png" }));
  await cancelled;
  assert.equal(settled, true);
});

test("canvasToPngBlob maps null and throws to encode-failed", async () => {
  await assert.rejects(
    () => canvasToPngBlob({ toBlob: (cb) => cb(null) }),
    (e) => {
      assert.equal(e.kind, "encode-failed");
      return true;
    },
  );
  await assert.rejects(
    () =>
      canvasToPngBlob({
        toBlob: () => {
          throw new Error("tainted");
        },
      }),
    (e) => {
      assert.equal(e.kind, "encode-failed");
      return true;
    },
  );
});

test("canvasToPngBlob preserves a taint SecurityError for display-only fallback", async () => {
  const taint = Object.assign(new Error("tainted"), { name: "SecurityError", code: 18 });
  await assert.rejects(
    () =>
      canvasToPngBlob({
        toBlob: () => {
          throw taint;
        },
      }),
    (e) => e === taint,
  );
  assert.equal(isCanvasTaintError(taint), true);
});

test("manual save waits for a click, uses the prepared filename, and releases the file", async (t) => {
  for (const [title, expectedName] of [
    ["An image", "An image.png"],
    [undefined, "dezoomify-800x600.png"],
  ]) {
    const events = [];
    const anchor = {
      href: "",
      download: "",
      click() {
        events.push("click");
      },
      remove() {
        events.push("remove");
      },
    };
    const doc = {
      createElement: (tag) => {
        assert.equal(tag, "a");
        return anchor;
      },
      body: {
        appendChild: (el) => {
          assert.equal(el, anchor);
          events.push("append");
        },
      },
    };
    const manual = createManualSave(doc);
    t.after(manual.dispose);
    const disposition = manual.prepare(
      new Blob(["png"]),
      suggestedNameFor(800, 600, "png", title),
      new AbortController().signal,
    );
    assert.equal(disposition, "browser-save-ready");
    assert.deepEqual(events, []);
    manual.saveOutput();
    assert.equal(await (await fetch(anchor.href)).text(), "png");
    assert.equal(anchor.download, expectedName);
    assert.deepEqual(events, ["append", "click", "remove"]);
    manual.dispose();
    await assert.rejects(fetch(anchor.href), TypeError);
  }
});

test("browser saves warn about the stripped color profile", () => {
  assert.match(BROWSER_SAVE_COLOR_WARNING, /Colors may shift/);
});
