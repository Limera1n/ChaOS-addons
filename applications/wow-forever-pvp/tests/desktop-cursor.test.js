import { test } from "node:test";
import assert from "node:assert/strict";
import { forwardDesktopPointer, installDesktopCursor } from "../client/desktop-cursor.js";

function embedded(parent, rect, size, border = 0) {
  const received = [];
  const frame = {
    offsetWidth: size, offsetHeight: size,
    clientLeft: border, clientTop: border,
    getBoundingClientRect: () => rect,
    dispatchEvent: (event) => received.push(event),
  };
  return { source: { parent, frameElement: frame }, received };
}
class Pointer {
  constructor(type, init) { this.type = type; Object.assign(this, init); }
}

test("desktop pointer uses the embedding frame position, border and scale", () => {
  const { source, received } = embedded({ PointerEvent: Pointer },
    { left: 100, top: 200, width: 400, height: 400 }, 200, 2);
  forwardDesktopPointer(source, {
    type: "pointermove", clientX: 30, clientY: 40,
    pointerType: "mouse", pointerId: 7, isPrimary: true, buttons: 1,
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].clientX, 164);
  assert.equal(received[0].clientY, 284);
  assert.equal(received[0].pointerId, 7);
  assert.equal(received[0].buttons, 1);
  assert.equal(received[0].bubbles, true);
});

test("nested armory pointer reaches desktop coordinates through both frames", () => {
  const outer = embedded({ PointerEvent: Pointer },
    { left: 100, top: 60, width: 800, height: 800 }, 800);
  const inner = embedded({ PointerEvent: Pointer },
    { left: 50, top: 90, width: 200, height: 200 }, 200);
  forwardDesktopPointer(inner.source, { type: "pointerup", clientX: 20, clientY: 30 });
  forwardDesktopPointer(outer.source, inner.received[0]);
  assert.equal(outer.received[0].clientX, 170);
  assert.equal(outer.received[0].clientY, 180);
});

test("standalone and cross-origin frames do not break the application", () => {
  assert.doesNotThrow(() => forwardDesktopPointer({ frameElement: null }, {}));
  const foreign = { get frameElement() { throw new Error("SecurityError"); } };
  assert.doesNotThrow(() => forwardDesktopPointer(foreign, {}));
  assert.doesNotThrow(() => installDesktopCursor({ get document() { throw new Error("SecurityError"); } }));
});
