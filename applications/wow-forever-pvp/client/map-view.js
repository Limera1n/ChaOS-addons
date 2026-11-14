import { AZEROTH, mapRegions } from "./map-regions.js";
import { mapOutlines } from "./map-outlines.js";

const NS = "http://www.w3.org/2000/svg";
const OVERVIEW = new URL("./maps/openmap/overview.webp", import.meta.url).href;
const MIN_WIDTH = 150 / 24;

export function worldRect(id) {
  if (id === AZEROTH) return { x: 0, y: 0, width: 150, height: 100 };
  const region = mapRegions.get(id);
  if (!region?.bounds) return null;
  const parent = worldRect(region.parent);
  if (!parent) return null;
  const [l, t, r, b] = region.bounds;
  return { x: parent.x + l * parent.width, y: parent.y + t * parent.height,
    width: (r-l) * parent.width, height: (b-t) * parent.height };
}

export function zoomView(view, factor, u = .5, v = .5) {
  const width = Math.max(MIN_WIDTH, Math.min(150, view.width * factor));
  const height = width * 2 / 3;
  return constrainView({ x: view.x + (view.width-width) * u,
    y: view.y + (view.height-height) * v, width, height });
}

export function constrainView(view) {
  return { ...view, x: Math.max(0, Math.min(150-view.width, view.x)),
    y: Math.max(0, Math.min(100-view.height, view.y)) };
}

// These straight M…Z polygons are expressed in the parent's canvas. Project
// them once: hover must follow the camera, independently of the activity filter.
const territories = [...mapOutlines].flatMap(([id, path]) => {
  const parent = worldRect(mapRegions.get(id)?.parent);
  if (!parent) return [];
  const polygons = path.match(/M[^M]+/gu).map((part) => {
    const numbers = part.match(/-?\d+(?:\.\d+)?/gu).map(Number);
    return Array.from({ length: numbers.length/2 }, (_, i) => [
      parent.x + numbers[i*2]/150*parent.width,
      parent.y + numbers[i*2+1]/100*parent.height,
    ]);
  });
  const points = polygons.flat();
  return [{ id, polygons, left: Math.min(...points.map(([x]) => x)),
    right: Math.max(...points.map(([x]) => x)), top: Math.min(...points.map(([, y]) => y)),
    bottom: Math.max(...points.map(([, y]) => y)) }];
}).sort((a, b) => (a.right-a.left)*(a.bottom-a.top) - (b.right-b.left)*(b.bottom-b.top));

export function regionAt(x, y) {
  for (const region of territories) {
    if (x < region.left || x > region.right || y < region.top || y > region.bottom) continue;
    let inside = false;
    // Even/odd fill handles multiple islands and holes within an outline.
    for (const polygon of region.polygons) for (let i = 0, j = polygon.length-1; i < polygon.length; j = i++) {
      const [ax, ay] = polygon[i], [bx, by] = polygon[j];
      if ((ay > y) !== (by > y) && x < (bx-ax)*(y-ay)/(by-ay)+ax) inside = !inside;
    }
    if (inside) return region.id;
  }
  return null;
}

export function easeView(view, target, elapsed) {
  const blend = 1 - Math.exp(-Math.min(elapsed, 64) / 55);
  const next = Object.fromEntries(["x", "y", "width", "height"].map((key) => [key,
    view[key] + (target[key]-view[key])*blend]));
  return Math.max(...Object.keys(next).map((key) => Math.abs(next[key]-target[key]))) < .0001
    ? { ...target } : next;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

export function createMapView(root) {
  const overview = svg("image", { href: OVERVIEW, width: 150, height: 100,
    preserveAspectRatio: "none", "aria-hidden": "true", "pointer-events": "none" });
  const content = svg("g");
  root.append(overview, content);
  const label = document.querySelector("#map-target");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let selected = null, localRect = worldRect(AZEROTH), standalone = false;
  let view = worldRect(AZEROTH), target = { ...view }, drag = null, moved = false;
  let frame = 0, lastFrame = 0, cursor = null, pinch = null;
  const pointers = new Map();
  overview.addEventListener("error", () => root.dispatchEvent(new CustomEvent("map-art-error")));

  function showRegion() {
    if (!cursor || drag || pointers.size > 1) { label.hidden = true; return; }
    const x = view.x+cursor.u*view.width, y = view.y+cursor.v*view.height;
    const id = standalone ? selected : regionAt(x, y);
    const region = mapRegions.get(id);
    const rect = standalone ? localRect : worldRect(id);
    label.hidden = !region || !rect;
    if (label.hidden) return;
    const continent = mapRegions.get(region.parent);
    const coordinates = `${((x-rect.x)/rect.width*100).toFixed(1)}, ${((y-rect.y)/rect.height*100).toFixed(1)}`;
    label.textContent = `${region.name}${continent?.parent === AZEROTH ? ` · ${continent.name}` : ""}  ·  ${coordinates}`;
    label.dataset.region = id;
  }
  function update() {
    root.setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
    const markerScale = view.width / localRect.width;
    for (const marker of content.querySelectorAll("[data-map-marker]"))
      marker.setAttribute("transform", `${marker.dataset.mapMarker} scale(${markerScale})`);
    document.querySelector("#map-zoom-out").disabled = target.width >= 150;
    document.querySelector("#map-zoom-in").disabled = target.width <= MIN_WIDTH;
    showRegion();
  }
  function animate(now) {
    frame = 0;
    view = easeView(view, target, lastFrame ? now-lastFrame : 16);
    lastFrame = now;
    update();
    if (Object.keys(view).some((key) => view[key] !== target[key])) frame = requestAnimationFrame(animate);
  }
  function moveTo(next, immediate = false) {
    target = constrainView(next);
    if (immediate || reducedMotion.matches) {
      cancelAnimationFrame(frame); frame = 0; view = { ...target }; update();
    } else if (!frame) { lastFrame = 0; frame = requestAnimationFrame(animate); }
  }
  function point(event) {
    const box = root.getBoundingClientRect();
    return { u: (event.clientX-box.left)/box.width, v: (event.clientY-box.top)/box.height };
  }
  function zoom(factor, u = .5, v = .5) { moveTo(zoomView(target, factor, u, v)); }
  root.addEventListener("wheel", (event) => {
    event.preventDefault();
    const { u, v } = cursor = point(event);
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight : 1);
    zoom(Math.exp(Math.max(-.35, Math.min(.35, pixels * .0015))), u, v);
  }, { passive: false });
  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    moved = false;
    pointers.set(event.pointerId, point(event));
    root.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, view: { ...view } };
    if (pointers.size === 2) {
      moveTo(view, true);
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a.u-b.u, (a.v-b.v)*2/3), view: { ...view },
        u: (a.u+b.u)/2, v: (a.v+b.v)/2 };
    }
    showRegion();
  });
  root.addEventListener("pointermove", (event) => {
    cursor = point(event);
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, cursor);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.u-b.u, (a.v-b.v)*2/3);
      const next = zoomView(pinch.view, pinch.distance/Math.max(.001, distance), pinch.u, pinch.v);
      moveTo({ ...next, x: next.x+(pinch.u-(a.u+b.u)/2)*next.width,
        y: next.y+(pinch.v-(a.v+b.v)/2)*next.height }, true);
      moved = true;
      return;
    }
    if (!drag || event.pointerId !== drag.id) { showRegion(); return; }
    const dx = event.clientX-drag.x, dy = event.clientY-drag.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    if (!moved) {
      moveTo(view, true);
      drag.view = { ...view };
    }
    moved = true;
    root.classList.add("is-dragging");
    const box = root.getBoundingClientRect();
    moveTo({ ...drag.view, x: drag.view.x-dx/box.width*drag.view.width,
      y: drag.view.y-dy/box.height*drag.view.height }, true);
  });
  root.addEventListener("pointerleave", () => { cursor = null; label.hidden = true; });
  const stop = (event) => {
    pointers.delete(event.pointerId);
    pinch = null;
    if (drag?.id === event.pointerId) drag = null;
    root.classList.remove("is-dragging");
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    showRegion();
  };
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) root.addEventListener(event, stop);
  root.addEventListener("click", (event) => {
    if (moved) { event.preventDefault(); event.stopImmediatePropagation(); moved = false; }
  }, true);
  root.addEventListener("dblclick", (event) => {
    event.preventDefault(); const { u, v } = point(event); zoom(event.shiftKey ? 2 : .5, u, v);
  });
  root.addEventListener("keydown", (event) => {
    if (event.target !== root) return;
    if (["+", "=", "-", "Home", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) event.preventDefault();
    if (event.key === "+" || event.key === "=") zoom(.75);
    if (event.key === "-") zoom(1/.75);
    if (event.key === "Home") moveTo(worldRect(AZEROTH));
    const pan = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (pan) moveTo({ ...target, x: target.x+pan[0]*target.width*.15,
      y: target.y+pan[1]*target.height*.15 });
  });
  return {
    content, zoom,
    reset() { moveTo(worldRect(AZEROTH)); },
    prepare(id, fallbackUrl) {
      content.replaceChildren();
      const rect = worldRect(id);
      const changingCanvas = standalone !== !rect;
      standalone = !rect;
      localRect = rect ?? worldRect(AZEROTH);
      if (/^\d+$/u.test(id)) overview.setAttribute("href", standalone ? fallbackUrl : OVERVIEW);
      else overview.removeAttribute("href");
      content.setAttribute("transform", `translate(${localRect.x} ${localRect.y}) scale(${localRect.width/150} ${localRect.height/100})`);
      if (id !== selected) {
        const width = Math.max(MIN_WIDTH, Math.min(150, localRect.width * 1.15));
        moveTo({ x: localRect.x+localRect.width/2-width/2,
          y: localRect.y+localRect.height/2-width/3, width, height: width*2/3 }, selected === null || changingCanvas);
        selected = id;
      }
      update();
      return !!rect;
    },
    update,
  };
}
