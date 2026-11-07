// Pointer events do not bubble across iframe documents. Re-emit them on the
// embedding frame so ChaOS can use its existing cursor/window anchors.
export function forwardDesktopPointer(source, event) {
  try {
    const frame = source.frameElement;
    if (!frame || source.parent === source) return;
    const parent = source.parent;
    const rect = frame.getBoundingClientRect();
    if (!frame.offsetWidth || !frame.offsetHeight) return;
    const scaleX = rect.width / frame.offsetWidth;
    const scaleY = rect.height / frame.offsetHeight;
    const EventType = event.type.startsWith("pointer") ? parent.PointerEvent : parent.MouseEvent;
    if (!EventType) return;
    frame.dispatchEvent(new EventType(event.type, {
      bubbles: true,
      composed: true,
      clientX: rect.left + (frame.clientLeft + event.clientX) * scaleX,
      clientY: rect.top + (frame.clientTop + event.clientY) * scaleY,
      button: event.button,
      buttons: event.buttons,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      isPrimary: event.isPrimary,
      pressure: event.pressure,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    }));
  } catch {
    // Standalone pages and foreign/sandboxed parents have no desktop bridge.
  }
}

export function installDesktopCursor(source = window) {
  const documents = new WeakSet();
  function attach(target) {
    try {
      const doc = target.document;
      if (documents.has(doc)) return;
      documents.add(doc);
      const events = "PointerEvent" in target
        ? ["pointermove", "pointerdown", "pointerup", "pointercancel"]
        : ["mousemove", "mousedown", "mouseup"];
      for (const type of events) {
        target.addEventListener(type, (event) => forwardDesktopPointer(target, event), {
          capture: true, passive: true,
        });
      }
      // The armory is itself a same-origin iframe, created after page startup.
      doc.addEventListener("load", (event) => {
        if (event.target?.tagName === "IFRAME") attach(event.target.contentWindow);
      }, true);
      for (const frame of doc.querySelectorAll("iframe")) attach(frame.contentWindow);
    } catch {
      // Never inspect third-party frame documents.
    }
  }
  attach(source);
}
