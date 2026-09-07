(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const DEFAULT_STYLE = {
    stroke: "#172126",
    fill: "#ffffff",
    strokeWidth: 2,
    pattern: "none",
    textColor: "#172126"
  };
  const MIN_DRAW_SIZE = 12;
  const CUSTOM_SYMBOL_STORAGE_KEY = "pfd-tikz-custom-symbols";

  const SHAPES = {
    rectangle: { label: "Rectangle", tag: "U", w: 120, h: 70 },
    circle: { label: "Circle", tag: "V", w: 90, h: 90 },
    trapezoid: { label: "Trapezoid", tag: "SEP", w: 130, h: 80 },
    pump: { label: "Pump", tag: "P", w: 110, h: 120 },
    heatExchanger: { label: "Heat Exchanger", tag: "HX", w: 110, h: 110 },
    distillation: { label: "Column", tag: "T", w: 74, h: 180 },
    tank: { label: "Tank", tag: "V", w: 108, h: 132 },
    reactor: { label: "Reactor", tag: "R", w: 108, h: 132 },
    separator: { label: "Separator", tag: "V", w: 150, h: 80 },
    valve: { label: "Valve", tag: "XV", w: 90, h: 54 },
    compressor: { label: "Compressor", tag: "C", w: 120, h: 78 }
  };

  const state = {
    objects: [],
    selectedIds: [],
    tool: "select",
    grid: 20,
    snap: true,
    showGrid: true,
    scale: 40,
    codeMode: "tikz",
    view: { x: -120, y: -80, w: 1200, h: 760 },
    drag: null,
    clipboard: [],
    counters: { U: 100, V: 100, P: 100, R: 200, HX: 300, T: 100, SEP: 100, XV: 100, C: 100, S: 1 },
    history: [],
    future: [],
    dirty: false,
    lastSnapshot: "",
    lastPointerAt: 0,
    customSymbols: [],
    customBuilder: {
      tool: "line",
      primitives: [],
      drag: null
    }
  };

  const els = {
    svg: document.getElementById("canvas"),
    gridPattern: document.getElementById("gridPattern"),
    gridRect: document.getElementById("gridRect"),
    scene: document.getElementById("sceneLayer"),
    overlay: document.getElementById("overlayLayer"),
    palette: document.getElementById("shapePalette"),
    tikz: document.getElementById("tikzOutput"),
    stats: document.getElementById("sceneStats"),
    toolStatus: document.getElementById("toolStatus"),
    coordStatus: document.getElementById("coordStatus"),
    zoomStatus: document.getElementById("zoomStatus"),
    emptyInspector: document.getElementById("emptyInspector"),
    propertyForm: document.getElementById("propertyForm"),
    copyBtn: document.getElementById("copyBtn"),
    downloadCodeBtn: document.getElementById("downloadCodeBtn"),
    codeTabs: document.querySelectorAll("[data-code-mode]"),
    gridSpacing: document.getElementById("gridSpacing"),
    scaleInput: document.getElementById("scaleInput"),
    snapToggle: document.getElementById("snapToggle"),
    gridToggle: document.getElementById("gridToggle"),
    customDialog: document.getElementById("customBlockDialog"),
    customCanvas: document.getElementById("customBlockCanvas"),
    customLayer: document.getElementById("customBlockLayer"),
    customName: document.getElementById("customBlockName")
  };

  function svgEl(name, attrs = {}) {
    const el = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined && value !== null) el.setAttribute(key, value);
    }
    return el;
  }

  function uid(prefix = "obj") {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadCustomSymbols() {
    try {
      state.customSymbols = JSON.parse(localStorage.getItem(CUSTOM_SYMBOL_STORAGE_KEY) || "[]");
    } catch (_error) {
      state.customSymbols = [];
    }
    registerCustomShapes();
  }

  function saveCustomSymbols() {
    localStorage.setItem(CUSTOM_SYMBOL_STORAGE_KEY, JSON.stringify(state.customSymbols));
  }

  function customType(symbol) {
    return `custom:${symbol.id}`;
  }

  function registerCustomShapes() {
    Object.keys(SHAPES).filter((type) => type.startsWith("custom:")).forEach((type) => delete SHAPES[type]);
    state.customSymbols.forEach((symbol) => {
      SHAPES[customType(symbol)] = {
        label: symbol.name,
        tag: "U",
        w: symbol.width || 120,
        h: symbol.height || 90,
        custom: true,
        symbol
      };
    });
  }

  function isRenderableObject(obj) {
    if (obj.kind === "equipment") return obj.width >= MIN_DRAW_SIZE && obj.height >= MIN_DRAW_SIZE;
    if (obj.kind === "stream") return streamLength(obj) >= MIN_DRAW_SIZE;
    return true;
  }

  function streamLength(obj) {
    if (!obj.points || obj.points.length < 2) return 0;
    return obj.points.slice(1).reduce((sum, point, index) => {
      const prev = obj.points[index];
      return sum + Math.hypot(point.x - prev.x, point.y - prev.y);
    }, 0);
  }

  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll(".tool").forEach((btn) => btn.classList.toggle("active", btn.dataset.tool === tool));
    document.querySelectorAll(".shape-button").forEach((btn) => btn.classList.toggle("active", btn.dataset.tool === tool));
    els.svg.classList.toggle("selecting", tool === "select");
    els.svg.classList.toggle("panning", tool === "pan");
    els.toolStatus.textContent = SHAPES[tool]?.label || tool[0].toUpperCase() + tool.slice(1);
  }

  function currentSnapshot() {
    return JSON.stringify({ objects: state.objects, counters: state.counters, customSymbols: state.customSymbols });
  }

  function pushHistory() {
    const snapshot = currentSnapshot();
    if (snapshot === state.lastSnapshot) return;
    state.history.push(JSON.parse(snapshot));
    if (state.history.length > 80) state.history.shift();
    state.lastSnapshot = snapshot;
    state.future = [];
    state.dirty = false;
  }

  function markDirty() {
    state.dirty = true;
    render();
  }

  function commit() {
    pushHistory();
    render();
  }

  function restore(snapshot) {
    state.objects = clone(snapshot.objects);
    state.counters = clone(snapshot.counters || state.counters);
    state.customSymbols = clone(snapshot.customSymbols || state.customSymbols);
    registerCustomShapes();
    state.selectedIds = state.selectedIds.filter((id) => state.objects.some((obj) => obj.id === id));
    state.lastSnapshot = currentSnapshot();
    state.dirty = false;
    render();
  }

  function undo() {
    if (state.history.length <= 1) return;
    const current = state.history.pop();
    state.future.push(current);
    restore(state.history[state.history.length - 1]);
  }

  function redo() {
    const next = state.future.pop();
    if (!next) return;
    state.history.push(clone(next));
    restore(next);
  }

  function screenToWorld(event) {
    const rect = els.svg.getBoundingClientRect();
    const x = state.view.x + ((event.clientX - rect.left) / rect.width) * state.view.w;
    const y = state.view.y + ((event.clientY - rect.top) / rect.height) * state.view.h;
    return { x, y };
  }

  function isCanvasEvent(event) {
    return event.target === els.svg || els.svg.contains(event.target);
  }

  function worldToScreen(point) {
    const rect = els.svg.getBoundingClientRect();
    return {
      x: rect.left + ((point.x - state.view.x) / state.view.w) * rect.width,
      y: rect.top + ((point.y - state.view.y) / state.view.h) * rect.height
    };
  }

  function snap(value) {
    return state.snap ? Math.round(value / state.grid) * state.grid : value;
  }

  function snapPoint(point) {
    return { x: snap(point.x), y: snap(point.y) };
  }

  function rotatePoint(point, center, degrees) {
    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
  }

  function objectCenter(obj) {
    if (obj.kind === "stream") {
      const pts = obj.points;
      return { x: (pts[0].x + pts[pts.length - 1].x) / 2, y: (pts[0].y + pts[pts.length - 1].y) / 2 };
    }
    return { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 };
  }

  function boundsOf(obj) {
    if (obj.kind === "stream") {
      const xs = obj.points.map((p) => p.x);
      const ys = obj.points.map((p) => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
    if (obj.kind === "label") return { x: obj.x - 40, y: obj.y - 14, width: 80, height: 28 };
    return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
  }

  function styleAttrs(obj, fill = true) {
    return {
      stroke: obj.style?.stroke || DEFAULT_STYLE.stroke,
      fill: fill ? obj.style?.fill || DEFAULT_STYLE.fill : "none",
      "stroke-width": obj.style?.strokeWidth || DEFAULT_STYLE.strokeWidth,
      "vector-effect": "non-scaling-stroke",
      "stroke-linejoin": "round",
      "stroke-linecap": "round"
    };
  }

  function textAttrs(obj) {
    return {
      x: obj.x + obj.width / 2,
      y: obj.y + obj.height / 2 + 4,
      "text-anchor": "middle",
      "font-size": 15,
      "font-weight": 650,
      fill: obj.style?.textColor || DEFAULT_STYLE.textColor,
      "pointer-events": "none"
    };
  }

  function groupForObject(obj) {
    const group = svgEl("g", { "data-id": obj.id, class: obj.kind });
    group.addEventListener("pointerdown", onObjectPointerDown);
    group.addEventListener("dblclick", onObjectDoubleClick);
    if (obj.kind === "equipment") {
      const c = objectCenter(obj);
      group.setAttribute("transform", `rotate(${obj.rotation || 0} ${c.x} ${c.y})`);
      drawEquipment(group, obj);
      if (obj.text) {
        const text = svgEl("text", textAttrs(obj));
        text.textContent = obj.text;
        group.append(text);
      }
    } else if (obj.kind === "stream") {
      const line = svgEl("polyline", {
        points: obj.points.map((p) => `${p.x},${p.y}`).join(" "),
        ...styleAttrs(obj, false),
        fill: "none",
        "marker-end": obj.arrow === "->" || obj.arrow === "<->" ? "url(#arrowEnd)" : null,
        "marker-start": obj.arrow === "<-" || obj.arrow === "<->" ? "url(#arrowStart)" : null
      });
      group.append(line);
      if (obj.text) {
        const mid = streamLabelPoint(obj);
        const text = svgEl("text", {
          x: mid.x,
          y: mid.y - 8,
          "text-anchor": "middle",
          "font-size": 14,
          fill: obj.style?.textColor || DEFAULT_STYLE.textColor
        });
        text.textContent = obj.text;
        group.append(text);
      }
    } else if (obj.kind === "label") {
      const text = svgEl("text", {
        x: obj.x,
        y: obj.y,
        "text-anchor": "middle",
        "font-size": obj.size || 15,
        fill: obj.style?.textColor || DEFAULT_STYLE.textColor
      });
      text.textContent = obj.text || "Label";
      group.append(text);
    }
    return group;
  }

  function customPoint(obj, point) {
    return {
      x: obj.x + (point.x / 200) * obj.width,
      y: obj.y + (point.y / 140) * obj.height
    };
  }

  function drawCustomEquipment(group, obj) {
    const def = SHAPES[obj.type];
    if (!def?.symbol) return;
    group.append(svgEl("rect", { x: obj.x, y: obj.y, width: obj.width, height: obj.height, rx: 4, ...styleAttrs(obj) }));
    def.symbol.primitives.forEach((primitive) => {
      if (primitive.type === "line") {
        const a = customPoint(obj, primitive.a);
        const b = customPoint(obj, primitive.b);
        group.append(svgEl("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...styleAttrs(obj, false) }));
      } else if (primitive.type === "rect") {
        const a = customPoint(obj, primitive.a);
        const b = customPoint(obj, primitive.b);
        group.append(svgEl("rect", {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: Math.abs(b.x - a.x),
          height: Math.abs(b.y - a.y),
          ...styleAttrs(obj, false)
        }));
      } else if (primitive.type === "circle") {
        const a = customPoint(obj, primitive.a);
        const b = customPoint(obj, primitive.b);
        group.append(svgEl("ellipse", {
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
          rx: Math.abs(b.x - a.x) / 2,
          ry: Math.abs(b.y - a.y) / 2,
          ...styleAttrs(obj, false)
        }));
      }
    });
  }

  function drawEquipment(group, obj) {
    const { x, y, width: w, height: h, type } = obj;
    if (SHAPES[type]?.custom) {
      drawCustomEquipment(group, obj);
    } else if (type === "rectangle") {
      group.append(svgEl("rect", { x, y, width: w, height: h, rx: 4, ...styleAttrs(obj) }));
    } else if (type === "circle") {
      group.append(svgEl("ellipse", { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...styleAttrs(obj) }));
    } else if (type === "pump") {
      const r = Math.min(w, h) * 0.36;
      const cx = x + w / 2;
      const cy = y + h * 0.38;
      const bottomY = y + h * 0.92;
      group.append(svgEl("path", {
        d: `M ${x + w * 0.18} ${bottomY} L ${x + w * 0.82} ${bottomY} M ${x + w * 0.18} ${bottomY} L ${cx - r * 0.72} ${cy + r * 0.72} M ${x + w * 0.82} ${bottomY} L ${cx + r * 0.72} ${cy + r * 0.72}`,
        ...styleAttrs(obj, false)
      }));
      group.append(svgEl("circle", { cx, cy, r, ...styleAttrs(obj) }));
    } else if (type === "trapezoid") {
      group.append(svgEl("polygon", { points: `${x},${y} ${x + w},${y} ${x + w * 0.82},${y + h} ${x + w * 0.18},${y + h}`, ...styleAttrs(obj) }));
    } else if (type === "heatExchanger") {
      const r = Math.min(w, h) * 0.42;
      const cx = x + w / 2;
      const cy = y + h / 2;
      group.append(svgEl("circle", { cx, cy, r, ...styleAttrs(obj) }));
      group.append(svgEl("polyline", {
        points: `${x + w * 0.08},${y + h * 0.78} ${x + w * 0.42},${y + h * 0.38} ${x + w * 0.57},${y + h * 0.65} ${x + w * 0.96},${y + h * 0.22}`,
        ...styleAttrs(obj, false),
        "stroke-width": Math.max((obj.style?.strokeWidth || DEFAULT_STYLE.strokeWidth) * 1.4, 2.4),
        "marker-end": "url(#arrowEnd)"
      }));
    } else if (type === "distillation" || type === "tank" || type === "reactor") {
      const topY = y + h * 0.08;
      const bottomY = y + h * 0.92;
      const ry = h * 0.08;
      group.append(svgEl("path", {
        d: `M ${x} ${topY} L ${x} ${bottomY} A ${w / 2} ${ry} 0 0 0 ${x + w} ${bottomY} L ${x + w} ${topY} A ${w / 2} ${ry} 0 0 0 ${x} ${topY} Z`,
        ...styleAttrs(obj)
      }));
      group.append(svgEl("ellipse", { cx: x + w / 2, cy: topY, rx: w / 2, ry, ...styleAttrs(obj, false) }));
      group.append(svgEl("path", { d: `M ${x} ${bottomY} A ${w / 2} ${ry} 0 0 0 ${x + w} ${bottomY}`, ...styleAttrs(obj, false) }));
      if (type === "distillation") {
        for (let i = 1; i < 5; i += 1) {
          const yy = y + h * (0.16 + i * 0.14);
          group.append(svgEl("line", { x1: x + 8, y1: yy, x2: x + w - 8, y2: yy, ...styleAttrs(obj, false) }));
        }
      }
      if (type === "reactor") {
        group.append(svgEl("path", { d: `M ${x + w * 0.25} ${y + h * 0.28} L ${x + w * 0.75} ${y + h * 0.72} M ${x + w * 0.75} ${y + h * 0.28} L ${x + w * 0.25} ${y + h * 0.72}`, ...styleAttrs(obj, false) }));
      }
    } else if (type === "separator") {
      group.append(svgEl("rect", { x, y, width: w, height: h, rx: h / 2, ...styleAttrs(obj) }));
      group.append(svgEl("line", { x1: x + w / 2, y1: y + 10, x2: x + w / 2, y2: y + h - 10, ...styleAttrs(obj, false) }));
    } else if (type === "valve") {
      group.append(svgEl("polygon", { points: `${x},${y + h * 0.2} ${x + w / 2},${y + h / 2} ${x},${y + h * 0.8}`, ...styleAttrs(obj) }));
      group.append(svgEl("polygon", { points: `${x + w},${y + h * 0.2} ${x + w / 2},${y + h / 2} ${x + w},${y + h * 0.8}`, ...styleAttrs(obj) }));
      group.append(svgEl("line", { x1: x + w / 2, y1: y + h / 2, x2: x + w / 2, y2: y, ...styleAttrs(obj, false) }));
    } else if (type === "compressor") {
      group.append(svgEl("polygon", { points: `${x},${y + h * 0.18} ${x + w},${y} ${x + w},${y + h} ${x},${y + h * 0.82}`, ...styleAttrs(obj) }));
    }
  }

  function render() {
    els.svg.setAttribute("viewBox", `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);
    els.gridPattern.setAttribute("width", state.grid);
    els.gridPattern.setAttribute("height", state.grid);
    els.gridPattern.querySelector("path").setAttribute("d", `M ${state.grid} 0 L 0 0 0 ${state.grid}`);
    els.gridRect.style.display = state.showGrid ? "" : "none";
    const renderableObjects = state.objects.filter(isRenderableObject);
    els.scene.replaceChildren(...renderableObjects.map(groupForObject));
    renderOverlay();
    updateCodeOutput();
    updateInspector();
    els.zoomStatus.textContent = `${Math.round(1200 / state.view.w * 100)}%`;
    els.stats.textContent = `${renderableObjects.filter((o) => o.kind === "equipment").length} equipment, ${renderableObjects.filter((o) => o.kind === "stream").length} streams, ${renderableObjects.filter((o) => o.kind === "label").length} labels`;
  }

  function renderOverlay() {
    els.overlay.replaceChildren();
    for (const id of state.selectedIds) {
      const obj = findObj(id);
      if (!obj) continue;
      if (!isRenderableObject(obj)) continue;
      if (obj.kind === "stream") {
        obj.points.forEach((p, index) => {
          const h = svgEl("circle", { cx: p.x, cy: p.y, r: 6, class: "endpoint", "data-id": id, "data-index": index });
          h.addEventListener("pointerdown", onEndpointPointerDown);
          els.overlay.append(h);
        });
        const handlePoint = streamLabelPoint(obj);
        const streamHandle = svgEl("rect", {
          x: handlePoint.x - 5,
          y: handlePoint.y - 5,
          width: 10,
          height: 10,
          class: "handle",
          "data-id": id,
          "data-handle": "stream"
        });
        streamHandle.addEventListener("pointerdown", onStreamHandlePointerDown);
        els.overlay.append(streamHandle);
      } else {
        const b = boundsOf(obj);
        const box = svgEl("rect", { x: b.x, y: b.y, width: b.width, height: b.height, class: "selection-box" });
        els.overlay.append(box);
        [["nw", b.x, b.y], ["ne", b.x + b.width, b.y], ["sw", b.x, b.y + b.height], ["se", b.x + b.width, b.y + b.height]].forEach(([name, x, y]) => {
          const h = svgEl("rect", { x: x - 5, y: y - 5, width: 10, height: 10, class: "handle", "data-id": id, "data-handle": name });
          h.addEventListener("pointerdown", onResizePointerDown);
          els.overlay.append(h);
        });
      }
    }
  }

  function findObj(id) {
    return state.objects.find((obj) => obj.id === id);
  }

  function createDraftEquipment(type, point) {
    const p = snapPoint(point);
    const equipment = {
      id: uid("eq"),
      kind: "equipment",
      type,
      x: p.x,
      y: p.y,
      width: 1,
      height: 1,
      rotation: 0,
      text: "",
      style: clone(DEFAULT_STYLE)
    };
    state.objects.push(equipment);
    state.selectedIds = [equipment.id];
    state.drag = { type: "draw-equipment", id: equipment.id, shape: type, start: p, current: p };
    markDirty();
  }

  function updateDraftEquipment(drag, point) {
    const obj = findObj(drag.id);
    if (!obj) return;
    const a = snapPoint(drag.start);
    const b = snapPoint(point);
    const draggedWidth = Math.abs(b.x - a.x);
    const draggedHeight = Math.abs(b.y - a.y);
    obj.width = Math.max(1, draggedWidth);
    obj.height = Math.max(1, draggedHeight);
    obj.x = Math.min(a.x, b.x);
    obj.y = Math.min(a.y, b.y);
  }

  function createDraftStream(start, mode) {
    const s = snapToConnection(start);
    const points = mode === "pipe" ? orthogonalPoints(s.point, s.point) : [s.point, s.point];
    const stream = {
      id: uid("stream"),
      kind: "stream",
      points,
      arrow: mode === "bidi" ? "<->" : mode === "line" || mode === "pipe" ? "none" : "->",
      text: "",
      label: streamLabelPoint({ points }),
      connections: { start: s.objectId, end: null },
      style: { stroke: "#172126", fill: "#ffffff", strokeWidth: 2, pattern: "none", textColor: "#172126" }
    };
    state.objects.push(stream);
    state.selectedIds = [stream.id];
    state.drag = { type: "draw-stream", id: stream.id, mode, start };
    markDirty();
  }

  function updateDraftStream(drag, end) {
    const obj = findObj(drag.id);
    if (!obj) return;
    const s = snapToConnection(drag.start);
    const e = snapToConnection(end);
    obj.points = drag.mode === "pipe" ? orthogonalPoints(s.point, e.point) : [s.point, e.point];
    obj.connections = { start: s.objectId, end: e.objectId };
    obj.label = streamLabelPoint({ points: obj.points });
  }

  function finishDraft(drag, point) {
    if (drag.type === "draw-equipment") {
      updateDraftEquipment(drag, point);
      const obj = findObj(drag.id);
      if (obj && !isRenderableObject(obj)) {
        state.objects = state.objects.filter((item) => item.id !== obj.id);
        state.selectedIds = [];
      } else if (obj) {
        obj.width = Math.max(24, obj.width);
        obj.height = Math.max(24, obj.height);
      }
      commit();
      return true;
    }
    if (drag.type === "draw-stream") {
      updateDraftStream(drag, point);
      const obj = findObj(drag.id);
      const start = obj?.points[0];
      const end = obj?.points[obj.points.length - 1];
      if (obj && start && end && !isRenderableObject(obj)) {
        state.objects = state.objects.filter((item) => item.id !== obj.id);
        state.selectedIds = [];
      }
      commit();
      return true;
    }
    return false;
  }

  function nextTag(prefix) {
    const value = state.counters[prefix] ?? 100;
    state.counters[prefix] = value + 1;
    if (prefix === "HX") return `${prefix}-${value + 1}`;
    if (prefix === "S") return `S-${value}`;
    return `${prefix}-${value + 1}`;
  }

  function createStream(start, end, mode) {
    const s = snapToConnection(start);
    const e = snapToConnection(end);
    if (Math.hypot(s.point.x - e.point.x, s.point.y - e.point.y) < 1) return;
    const points = mode === "pipe" ? orthogonalPoints(s.point, e.point) : [s.point, e.point];
    const label = streamLabelPoint({ points });
    const stream = {
      id: uid("stream"),
      kind: "stream",
      points,
      arrow: mode === "bidi" ? "<->" : mode === "line" || mode === "pipe" ? "none" : "->",
      text: "",
      label,
      connections: { start: s.objectId, end: e.objectId },
      style: { stroke: "#172126", fill: "#ffffff", strokeWidth: 2, pattern: "none", textColor: "#172126" }
    };
    state.objects.push(stream);
    state.selectedIds = [stream.id];
    commit();
  }

  function orthogonalPoints(a, b) {
    const midX = snap((a.x + b.x) / 2);
    return [{ x: a.x, y: a.y }, { x: midX, y: a.y }, { x: midX, y: b.y }, { x: b.x, y: b.y }];
  }

  function snapToConnection(point) {
    let best = { point: snapPoint(point), objectId: null, d: 16 };
    for (const obj of state.objects.filter((o) => o.kind === "equipment")) {
      for (const port of portsFor(obj)) {
        const d = Math.hypot(point.x - port.x, point.y - port.y);
        if (d < best.d) best = { point: port, objectId: obj.id, d };
      }
    }
    return best;
  }

  function portsFor(obj) {
    const c = objectCenter(obj);
    const ports = [
      { x: obj.x + obj.width / 2, y: obj.y },
      { x: obj.x + obj.width, y: obj.y + obj.height / 2 },
      { x: obj.x + obj.width / 2, y: obj.y + obj.height },
      { x: obj.x, y: obj.y + obj.height / 2 }
    ];
    return ports.map((p) => rotatePoint(p, c, obj.rotation || 0));
  }

  function streamLabelPoint(obj) {
    if (obj.label) return obj.label;
    const pts = obj.points;
    const idx = Math.floor((pts.length - 1) / 2);
    return { x: (pts[idx].x + pts[idx + 1].x) / 2, y: (pts[idx].y + pts[idx + 1].y) / 2 };
  }

  function onObjectPointerDown(event) {
    const id = event.currentTarget.dataset.id;
    const obj = findObj(id);
    if (!obj) return;
    if (state.tool !== "select") return;
    event.stopPropagation();
    if (event.shiftKey) {
      state.selectedIds = state.selectedIds.includes(id) ? state.selectedIds.filter((sid) => sid !== id) : [...state.selectedIds, id];
    } else if (!state.selectedIds.includes(id)) {
      state.selectedIds = [id];
    }
    state.drag = {
      type: "move",
      start: screenToWorld(event),
      originals: new Map(state.selectedIds.map((sid) => [sid, clone(findObj(sid))]))
    };
    capturePointer(event);
    render();
  }

  function onResizePointerDown(event) {
    if (state.tool !== "select") return;
    event.stopPropagation();
    const id = event.currentTarget.dataset.id;
    state.selectedIds = [id];
    state.drag = { type: "resize", id, handle: event.currentTarget.dataset.handle, start: screenToWorld(event), original: clone(findObj(id)) };
    capturePointer(event);
  }

  function onEndpointPointerDown(event) {
    if (state.tool !== "select") return;
    event.stopPropagation();
    const id = event.currentTarget.dataset.id;
    state.selectedIds = [id];
    state.drag = { type: "endpoint", id, index: Number(event.currentTarget.dataset.index) };
    capturePointer(event);
  }

  function onStreamHandlePointerDown(event) {
    if (state.tool !== "select") return;
    event.stopPropagation();
    const id = event.currentTarget.dataset.id;
    const obj = findObj(id);
    if (!obj) return;
    state.selectedIds = [id];
    state.drag = { type: "stream-handle-move", id, start: screenToWorld(event), original: clone(obj) };
    capturePointer(event);
  }

  function onObjectDoubleClick(event) {
    event.stopPropagation();
    const id = event.currentTarget.dataset.id;
    const obj = findObj(id);
    if (obj) editText(obj);
  }

  function onCanvasPointerDown(event) {
    state.lastPointerAt = Date.now();
    beginCanvasInteraction(event);
  }

  function onCanvasMouseDown(event) {
    if (Date.now() - state.lastPointerAt < 750) return;
    beginCanvasInteraction(event);
  }

  function beginCanvasInteraction(event) {
    if (event.button !== undefined && event.button !== 0 && event.button !== 1) return;
    els.svg.focus();
    const point = screenToWorld(event);
    if (state.drag && finishDraft(state.drag, point)) {
      state.drag = null;
      els.svg.classList.remove("dragging");
      render();
      return;
    }
    if (state.tool === "pan" || event.button === 1 || event.altKey) {
      state.drag = { type: "pan", clientX: event.clientX, clientY: event.clientY, view: clone(state.view) };
      els.svg.classList.add("dragging");
    } else if (state.tool === "select") {
      state.selectedIds = [];
      render();
    } else if (state.tool === "text") {
      const p = snapPoint(point);
      const label = { id: uid("label"), kind: "label", x: p.x, y: p.y, text: "Label", size: 15, style: clone(DEFAULT_STYLE) };
      state.objects.push(label);
      state.selectedIds = [label.id];
      commit();
      editText(label);
    } else if (["line", "pipe", "arrow", "bidi"].includes(state.tool)) {
      createDraftStream(point, state.tool);
      els.toolStatus.textContent = `Drawing ${state.tool}`;
    } else if (SHAPES[state.tool]) {
      createDraftEquipment(state.tool, point);
      els.toolStatus.textContent = `Drawing ${SHAPES[state.tool].label}`;
    }
    capturePointer(event);
  }

  function capturePointer(event) {
    try {
      if (event.pointerId !== undefined && els.svg.setPointerCapture) {
        els.svg.setPointerCapture(event.pointerId);
      }
    } catch (_error) {
      // Some browsers are fussy about SVG pointer capture; window listeners below keep dragging reliable.
    }
  }

  function releasePointer(event) {
    try {
      if (event.pointerId !== undefined && els.svg.releasePointerCapture && els.svg.hasPointerCapture?.(event.pointerId)) {
        els.svg.releasePointerCapture(event.pointerId);
      }
    } catch (_error) {
      // Ignore compatibility errors.
    }
  }

  function onCanvasPointerMove(event) {
    state.lastPointerAt = Date.now();
    continueCanvasInteraction(event);
  }

  function onCanvasMouseMove(event) {
    if (!state.drag && Date.now() - state.lastPointerAt < 750) return;
    continueCanvasInteraction(event);
  }

  function continueCanvasInteraction(event) {
    if (!state.drag && !isCanvasEvent(event)) return;
    const point = screenToWorld(event);
    els.coordStatus.textContent = `${Math.round(point.x)}, ${Math.round(point.y)}`;
    if (!state.drag) return;
    if (state.drag.type === "pan") {
      const rect = els.svg.getBoundingClientRect();
      const dx = ((event.clientX - state.drag.clientX) / rect.width) * state.drag.view.w;
      const dy = ((event.clientY - state.drag.clientY) / rect.height) * state.drag.view.h;
      state.view.x = state.drag.view.x - dx;
      state.view.y = state.drag.view.y - dy;
      render();
    } else if (state.drag.type === "move") {
      const dx = snap(point.x - state.drag.start.x);
      const dy = snap(point.y - state.drag.start.y);
      const movedEquipment = [];
      for (const [id, original] of state.drag.originals.entries()) {
        const obj = findObj(id);
        if (!obj) continue;
        if (obj.kind === "stream") {
          obj.points = original.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
          if (original.label) obj.label = { x: original.label.x + dx, y: original.label.y + dy };
        }
        else {
          obj.x = original.x + dx;
          obj.y = original.y + dy;
          if (obj.kind === "equipment") movedEquipment.push(obj.id);
        }
      }
      updateConnectedStreams(movedEquipment);
      markDirty();
    } else if (state.drag.type === "resize") {
      resizeObject(state.drag, point);
      markDirty();
    } else if (state.drag.type === "endpoint") {
      const obj = findObj(state.drag.id);
      const snapped = snapToConnection(point);
      obj.points[state.drag.index] = snapped.point;
      if (state.drag.index === 0) obj.connections.start = snapped.objectId;
      if (state.drag.index === obj.points.length - 1) obj.connections.end = snapped.objectId;
      markDirty();
    } else if (state.drag.type === "stream-handle-move") {
      const obj = findObj(state.drag.id);
      const dx = snap(point.x - state.drag.start.x);
      const dy = snap(point.y - state.drag.start.y);
      obj.points = state.drag.original.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      if (state.drag.original.label) obj.label = { x: state.drag.original.label.x + dx, y: state.drag.original.label.y + dy };
      markDirty();
    } else if (state.drag.type === "draw-stream") {
      updateDraftStream(state.drag, point);
      markDirty();
    } else if (state.drag.type === "draw-equipment") {
      updateDraftEquipment(state.drag, point);
      markDirty();
    }
  }

  function onCanvasPointerUp(event) {
    state.lastPointerAt = Date.now();
    endCanvasInteraction(event);
  }

  function onCanvasMouseUp(event) {
    if (!state.drag && Date.now() - state.lastPointerAt < 750) return;
    endCanvasInteraction(event);
  }

  function endCanvasInteraction(event) {
    if (!state.drag) return;
    const drag = state.drag;
    state.drag = null;
    if (drag.type === "draw-stream" || drag.type === "draw-equipment") {
      finishDraft(drag, screenToWorld(event));
      if (drag.type === "draw-equipment") els.toolStatus.textContent = SHAPES[drag.shape].label;
    } else if (["move", "resize", "endpoint", "stream-handle-move"].includes(drag.type)) {
      commit();
    }
    releasePointer(event);
    els.svg.classList.remove("dragging");
    render();
  }

  function resizeObject(drag, point) {
    const obj = findObj(drag.id);
    const original = drag.original;
    if (!obj || obj.kind !== "equipment") return;
    const p = snapPoint(point);
    let x1 = original.x;
    let y1 = original.y;
    let x2 = original.x + original.width;
    let y2 = original.y + original.height;
    if (drag.handle.includes("w")) x1 = p.x;
    if (drag.handle.includes("e")) x2 = p.x;
    if (drag.handle.includes("n")) y1 = p.y;
    if (drag.handle.includes("s")) y2 = p.y;
    obj.x = Math.min(x1, x2);
    obj.y = Math.min(y1, y2);
    obj.width = Math.max(20, Math.abs(x2 - x1));
    obj.height = Math.max(20, Math.abs(y2 - y1));
    updateConnectedStreams([obj.id]);
  }

  function updateConnectedStreams(equipmentIds) {
    if (!equipmentIds.length) return;
    for (const stream of state.objects.filter((obj) => obj.kind === "stream" && !state.selectedIds.includes(obj.id))) {
      const first = stream.connections?.start;
      const last = stream.connections?.end;
      if (first && equipmentIds.includes(first)) {
        stream.points[0] = nearestPort(findObj(first), stream.points[0]);
      }
      if (last && equipmentIds.includes(last)) {
        stream.points[stream.points.length - 1] = nearestPort(findObj(last), stream.points[stream.points.length - 1]);
      }
      if (stream.points.length === 4) {
        const rerouted = orthogonalPoints(stream.points[0], stream.points[stream.points.length - 1]);
        stream.points = rerouted;
      }
    }
  }

  function nearestPort(obj, point) {
    if (!obj) return point;
    return portsFor(obj).reduce((best, port) => {
      const bestD = Math.hypot(best.x - point.x, best.y - point.y);
      const portD = Math.hypot(port.x - point.x, port.y - point.y);
      return portD < bestD ? port : best;
    });
  }

  function editText(obj) {
    const c = obj.kind === "equipment" ? objectCenter(obj) : obj.kind === "stream" ? streamLabelPoint(obj) : { x: obj.x, y: obj.y };
    const screen = worldToScreen(c);
    const input = document.createElement("input");
    input.className = "editing-input";
    input.value = obj.text || "";
    input.style.left = `${screen.x - 55}px`;
    input.style.top = `${screen.y - 15}px`;
    document.body.append(input);
    input.focus();
    input.select();
    const finish = (save) => {
      if (!input.isConnected) return;
      if (save) {
        obj.text = input.value;
        commit();
      }
      input.remove();
      render();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") finish(true);
      if (event.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }

  function updateInspector() {
    const obj = state.selectedIds.length === 1 ? findObj(state.selectedIds[0]) : null;
    els.emptyInspector.classList.toggle("hidden", !!obj);
    els.propertyForm.classList.toggle("hidden", !obj);
    if (!obj) return;
    const b = boundsOf(obj);
    setValue("propText", obj.text || "");
    const position = obj.kind === "stream" ? streamLabelPoint(obj) : { x: obj.x ?? b.x, y: obj.y ?? b.y };
    setValue("propX", Math.round(position.x));
    setValue("propY", Math.round(position.y));
    setValue("propW", Math.round(obj.width ?? b.width));
    setValue("propH", Math.round(obj.height ?? b.height));
    setValue("propRot", Math.round(obj.rotation || 0));
    setValue("propStrokeWidth", obj.style?.strokeWidth || 2);
    setValue("propStroke", obj.style?.stroke || DEFAULT_STYLE.stroke);
    setValue("propFill", obj.style?.fill || DEFAULT_STYLE.fill);
    setValue("propPattern", obj.style?.pattern || "none");
    setValue("propArrow", obj.arrow || "none");
    ["propW", "propH", "propRot", "propFill", "propPattern"].forEach((id) => {
      document.getElementById(id).disabled = obj.kind !== "equipment";
    });
    document.getElementById("propArrow").disabled = obj.kind !== "stream";
  }

  function setValue(id, value) {
    const el = document.getElementById(id);
    if (document.activeElement !== el) el.value = value;
  }

  function applyProperties() {
    const obj = state.selectedIds.length === 1 ? findObj(state.selectedIds[0]) : null;
    if (!obj) return;
    obj.text = document.getElementById("propText").value;
    if (obj.kind === "stream") {
      obj.label = {
        x: Number(document.getElementById("propX").value),
        y: Number(document.getElementById("propY").value)
      };
    } else {
      obj.x = Number(document.getElementById("propX").value);
      obj.y = Number(document.getElementById("propY").value);
    }
    if (obj.kind === "equipment") {
      obj.width = Math.max(20, Number(document.getElementById("propW").value));
      obj.height = Math.max(20, Number(document.getElementById("propH").value));
      obj.rotation = Number(document.getElementById("propRot").value);
      obj.style.fill = document.getElementById("propFill").value;
      obj.style.pattern = document.getElementById("propPattern").value;
    }
    if (obj.kind === "stream") obj.arrow = document.getElementById("propArrow").value;
    obj.style.stroke = document.getElementById("propStroke").value;
    obj.style.strokeWidth = Number(document.getElementById("propStrokeWidth").value);
    commit();
  }

  function selectedObjects() {
    return state.selectedIds.map(findObj).filter(Boolean);
  }

  function deleteSelected() {
    if (!state.selectedIds.length) return;
    state.objects = state.objects.filter((obj) => !state.selectedIds.includes(obj.id));
    state.selectedIds = [];
    commit();
    setTool("select");
  }

  function duplicateSelected() {
    const items = selectedObjects();
    if (!items.length) return;
    const copies = items.map((obj) => {
      const copy = clone(obj);
      copy.id = uid(obj.kind);
      if (copy.kind === "stream") copy.points = copy.points.map((p) => ({ x: p.x + state.grid, y: p.y + state.grid }));
      else {
        copy.x += state.grid;
        copy.y += state.grid;
      }
      return copy;
    });
    state.objects.push(...copies);
    state.selectedIds = copies.map((obj) => obj.id);
    commit();
  }

  function copySelected() {
    state.clipboard = clone(selectedObjects());
  }

  function pasteSelected() {
    if (!state.clipboard.length) return;
    const copies = state.clipboard.map((obj) => {
      const copy = clone(obj);
      copy.id = uid(obj.kind);
      if (copy.kind === "stream") copy.points = copy.points.map((p) => ({ x: p.x + state.grid * 2, y: p.y + state.grid * 2 }));
      else {
        copy.x += state.grid * 2;
        copy.y += state.grid * 2;
      }
      return copy;
    });
    state.objects.push(...copies);
    state.selectedIds = copies.map((obj) => obj.id);
    commit();
  }

  function layer(delta) {
    const id = state.selectedIds[0];
    const index = state.objects.findIndex((obj) => obj.id === id);
    if (index < 0) return;
    const next = Math.max(0, Math.min(state.objects.length - 1, index + delta));
    const [obj] = state.objects.splice(index, 1);
    state.objects.splice(next, 0, obj);
    commit();
  }

  function align(axis, mode) {
    const items = selectedObjects().filter((obj) => obj.kind === "equipment" || obj.kind === "label");
    if (items.length < 2) return;
    const bounds = items.map(boundsOf);
    const target = mode === "min" ? Math.min(...bounds.map((b) => b[axis])) :
      mode === "max" ? Math.max(...bounds.map((b) => b[axis] + (axis === "x" ? b.width : b.height))) :
      bounds.reduce((sum, b) => sum + b[axis] + (axis === "x" ? b.width : b.height) / 2, 0) / bounds.length;
    items.forEach((obj) => {
      const b = boundsOf(obj);
      if (mode === "min") obj[axis] += target - b[axis];
      else if (mode === "max") obj[axis] += target - (b[axis] + (axis === "x" ? b.width : b.height));
      else obj[axis] += target - (b[axis] + (axis === "x" ? b.width : b.height) / 2);
    });
    commit();
  }

  function distribute(axis) {
    const items = selectedObjects().filter((obj) => obj.kind === "equipment" || obj.kind === "label");
    if (items.length < 3) return;
    items.sort((a, b) => boundsOf(a)[axis] - boundsOf(b)[axis]);
    const first = boundsOf(items[0])[axis];
    const lastB = boundsOf(items[items.length - 1]);
    const last = lastB[axis];
    const step = (last - first) / (items.length - 1);
    items.forEach((obj, index) => {
      obj[axis] += first + step * index - boundsOf(obj)[axis];
    });
    commit();
  }

  function escapeTex(text) {
    const replacements = {
      "\\": "\\textbackslash{}",
      "#": "\\#",
      "$": "\\$",
      "%": "\\%",
      "&": "\\&",
      "_": "\\_",
      "{": "\\{",
      "}": "\\}"
    };
    return String(text || "").replace(/[\\#$%&_{}]/g, (char) => replacements[char]);
  }

  function tikzPoint(point) {
    const x = point.x / state.scale;
    const y = -point.y / state.scale;
    return `(${fmt(x)},${fmt(y)})`;
  }

  function fmt(num) {
    return Number(num.toFixed(3)).toString();
  }

  function rgb(hex) {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `{rgb,255:red,${r};green,${g};blue,${b}}`;
  }

  function tikzOptions(obj, opts = {}) {
    const parts = [];
    const style = obj.style || DEFAULT_STYLE;
    if (opts.arrows) parts.push(opts.arrows);
    if (style.stroke && style.stroke !== "#172126") parts.push(`draw=${rgb(style.stroke)}`);
    if (style.strokeWidth && style.strokeWidth !== 1) parts.push(`line width=${fmt(style.strokeWidth / state.scale)}cm`);
    if (opts.fill !== false && style.fill && style.fill !== "none") parts.push(`fill=${rgb(style.fill)}`);
    if (style.pattern && style.pattern !== "none") parts.push(`pattern=${style.pattern}`);
    if (obj.rotation) parts.push(`rotate around={${fmt(obj.rotation)}:${tikzPoint(objectCenter(obj))}}`);
    return parts.length ? `[${parts.join(", ")}]` : "";
  }

  function equipmentTikz(obj) {
    const x = obj.x;
    const y = obj.y;
    const w = obj.width;
    const h = obj.height;
    const opt = tikzOptions(obj);
    const lines = [];
    if (SHAPES[obj.type]?.custom) {
      lines.push(`\\draw${opt} ${tikzPoint({ x, y })} rectangle ${tikzPoint({ x: x + w, y: y + h })};`);
      SHAPES[obj.type].symbol.primitives.forEach((primitive) => {
        if (primitive.type === "line") {
          lines.push(`\\draw${tikzOptions(obj, { fill: false })} ${tikzPoint(customPoint(obj, primitive.a))} -- ${tikzPoint(customPoint(obj, primitive.b))};`);
        } else if (primitive.type === "rect") {
          const a = customPoint(obj, primitive.a);
          const b = customPoint(obj, primitive.b);
          lines.push(`\\draw${tikzOptions(obj, { fill: false })} ${tikzPoint({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) })} rectangle ${tikzPoint({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) })};`);
        } else if (primitive.type === "circle") {
          const a = customPoint(obj, primitive.a);
          const b = customPoint(obj, primitive.b);
          lines.push(`\\draw${tikzOptions(obj, { fill: false })} ${tikzPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })} ellipse (${fmt(Math.abs(b.x - a.x) / 2 / state.scale)} and ${fmt(Math.abs(b.y - a.y) / 2 / state.scale)});`);
        }
      });
    } else if (obj.type === "rectangle") lines.push(`\\draw${opt} ${tikzPoint({ x, y })} rectangle ${tikzPoint({ x: x + w, y: y + h })};`);
    else if (obj.type === "circle") {
      if (Math.abs(w - h) < 0.001) {
        lines.push(`\\draw${opt} ${tikzPoint(objectCenter(obj))} circle (${fmt(w / 2 / state.scale)});`);
      } else {
        lines.push(`\\draw${opt} ${tikzPoint(objectCenter(obj))} ellipse (${fmt(w / 2 / state.scale)} and ${fmt(h / 2 / state.scale)});`);
      }
    } else if (obj.type === "pump") {
      const r = Math.min(w, h) * 0.36;
      const cx = x + w / 2;
      const cy = y + h * 0.38;
      const bottomY = y + h * 0.92;
      const outlineOpt = tikzOptions(obj, { fill: false });
      lines.push(`\\draw${outlineOpt} ${tikzPoint({ x: x + w * 0.18, y: bottomY })} -- ${tikzPoint({ x: x + w * 0.82, y: bottomY })};`);
      lines.push(`\\draw${outlineOpt} ${tikzPoint({ x: x + w * 0.18, y: bottomY })} -- ${tikzPoint({ x: cx - r * 0.72, y: cy + r * 0.72 })};`);
      lines.push(`\\draw${outlineOpt} ${tikzPoint({ x: x + w * 0.82, y: bottomY })} -- ${tikzPoint({ x: cx + r * 0.72, y: cy + r * 0.72 })};`);
      lines.push(`\\draw${opt} ${tikzPoint({ x: cx, y: cy })} circle (${fmt(r / state.scale)});`);
    } else if (obj.type === "trapezoid") {
      const pts = [{ x, y }, { x: x + w, y }, { x: x + w * 0.82, y: y + h }, { x: x + w * 0.18, y: y + h }];
      lines.push(`\\draw${opt} ${pts.map(tikzPoint).join(" -- ")} -- cycle;`);
    } else if (obj.type === "heatExchanger") {
      const r = Math.min(w, h) * 0.42;
      const arrowColor = obj.style?.stroke && obj.style.stroke !== DEFAULT_STYLE.stroke ? `, draw=${rgb(obj.style.stroke)}` : "";
      lines.push(`\\draw${opt} ${tikzPoint({ x: x + w / 2, y: y + h / 2 })} circle (${fmt(r / state.scale)});`);
      lines.push(`\\draw[->${arrowColor}, line width=${fmt(Math.max((obj.style?.strokeWidth || DEFAULT_STYLE.strokeWidth) * 1.4, 2.4) / state.scale)}cm] ${[
        { x: x + w * 0.08, y: y + h * 0.78 },
        { x: x + w * 0.42, y: y + h * 0.38 },
        { x: x + w * 0.57, y: y + h * 0.65 },
        { x: x + w * 0.96, y: y + h * 0.22 }
      ].map(tikzPoint).join(" -- ")};`);
    } else if (["distillation", "tank", "reactor"].includes(obj.type)) {
      const topY = y + h * 0.08;
      const bottomY = y + h * 0.92;
      const rx = fmt(w / 2 / state.scale);
      const ry = fmt(h * 0.08 / state.scale);
      lines.push(`\\draw${opt} ${tikzPoint({ x, y: topY })} -- ${tikzPoint({ x, y: bottomY })} arc (180:360:${rx} and ${ry}) -- ${tikzPoint({ x: x + w, y: topY })} arc (0:180:${rx} and ${ry}) -- cycle;`);
      lines.push(`\\draw ${tikzPoint({ x: x + w / 2, y: topY })} ellipse (${rx} and ${ry});`);
      lines.push(`\\draw ${tikzPoint({ x, y: bottomY })} arc (180:360:${rx} and ${ry});`);
      if (obj.type === "distillation") for (let i = 1; i < 5; i += 1) lines.push(`\\draw ${tikzPoint({ x: x + 8, y: y + h * (0.16 + i * 0.14) })} -- ${tikzPoint({ x: x + w - 8, y: y + h * (0.16 + i * 0.14) })};`);
      if (obj.type === "reactor") {
        lines.push(`\\draw ${tikzPoint({ x: x + w * 0.25, y: y + h * 0.28 })} -- ${tikzPoint({ x: x + w * 0.75, y: y + h * 0.72 })};`);
        lines.push(`\\draw ${tikzPoint({ x: x + w * 0.75, y: y + h * 0.28 })} -- ${tikzPoint({ x: x + w * 0.25, y: y + h * 0.72 })};`);
      }
    } else if (obj.type === "separator") {
      lines.push(`\\draw${opt} ${tikzPoint({ x, y: y + h / 2 })} ellipse (${fmt(w / 2 / state.scale)} and ${fmt(h / 2 / state.scale)});`);
      lines.push(`\\draw ${tikzPoint({ x: x + w / 2, y: y + 10 })} -- ${tikzPoint({ x: x + w / 2, y: y + h - 10 })};`);
    } else if (obj.type === "valve") {
      lines.push(`\\draw${opt} ${tikzPoint({ x, y: y + h * 0.2 })} -- ${tikzPoint({ x: x + w / 2, y: y + h / 2 })} -- ${tikzPoint({ x, y: y + h * 0.8 })} -- cycle;`);
      lines.push(`\\draw${opt} ${tikzPoint({ x: x + w, y: y + h * 0.2 })} -- ${tikzPoint({ x: x + w / 2, y: y + h / 2 })} -- ${tikzPoint({ x: x + w, y: y + h * 0.8 })} -- cycle;`);
    } else if (obj.type === "compressor") {
      const pts = [{ x, y: y + h * 0.18 }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h * 0.82 }];
      lines.push(`\\draw${opt} ${pts.map(tikzPoint).join(" -- ")} -- cycle;`);
    }
    if (obj.text) lines.push(`\\node at ${tikzPoint(objectCenter(obj))} {${escapeTex(obj.text)}};`);
    return lines;
  }

  function updateTikz() {
    const usesPatterns = state.objects.some((obj) => obj.style?.pattern && obj.style.pattern !== "none");
    const lines = ["\\begin{tikzpicture}[x=1cm,y=1cm]", `    % Generated by PFD Diagram Studio. Scale: ${state.scale}px = 1 TikZ unit.`];
    if (usesPatterns) lines.push("    % Add \\usetikzlibrary{patterns} in your LaTeX preamble for pattern fills.");
    for (const obj of state.objects.filter(isRenderableObject)) {
      if (obj.kind === "equipment") equipmentTikz(obj).forEach((line) => lines.push(`    ${line}`));
      if (obj.kind === "stream") {
        const arrow = obj.arrow === "none" ? "" : obj.arrow;
        const opt = tikzOptions(obj, { arrows: arrow, fill: false });
        lines.push(`    \\draw${opt} ${obj.points.map(tikzPoint).join(" -- ")};`);
        if (obj.text) lines.push(`    \\node[fill=white,inner sep=1pt] at ${tikzPoint(streamLabelPoint(obj))} {${escapeTex(obj.text)}};`);
      }
      if (obj.kind === "label" && obj.text) lines.push(`    \\node at ${tikzPoint(obj)} {${escapeTex(obj.text)}};`);
    }
    lines.push("\\end{tikzpicture}");
    els.tikz.value = lines.join("\n");
  }

  function matplotlibPattern(pattern) {
    return {
      "horizontal lines": "-",
      "vertical lines": "|",
      "north east lines": "/",
      "north west lines": "\\",
      grid: "+",
      crosshatch: "x"
    }[pattern] || null;
  }

  function pythonString(value) {
    return JSON.stringify(String(value ?? ""));
  }

  function pythonPoint(point) {
    return `(${fmt(point.x)}, ${fmt(point.y)})`;
  }

  function matplotlibBounds(objects) {
    if (!objects.length) return { x: -120, y: -80, width: 1200, height: 760 };
    const bounds = objects.map(boundsOf);
    const minX = Math.min(...bounds.map((b) => b.x));
    const minY = Math.min(...bounds.map((b) => b.y));
    const maxX = Math.max(...bounds.map((b) => b.x + b.width));
    const maxY = Math.max(...bounds.map((b) => b.y + b.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  function matplotlibCustomPrimitives(obj) {
    const symbol = SHAPES[obj.type]?.symbol;
    if (!symbol) return "[]";
    const primitives = symbol.primitives.map((primitive) => {
      const a = customPoint(obj, primitive.a);
      const b = customPoint(obj, primitive.b);
      return `(${pythonString(primitive.type)}, ${pythonPoint(a)}, ${pythonPoint(b)})`;
    });
    return `[${primitives.join(", ")}]`;
  }

  function matplotlibEquipmentLine(obj) {
    const style = obj.style || DEFAULT_STYLE;
    const custom = SHAPES[obj.type]?.custom ? `, custom=${matplotlibCustomPrimitives(obj)}` : "";
    const hatch = matplotlibPattern(style.pattern);
    return `draw_equipment(ax, kind=${pythonString(obj.type)}, x=${fmt(obj.x)}, y=${fmt(obj.y)}, width=${fmt(obj.width)}, height=${fmt(obj.height)}, rotation=${fmt(obj.rotation || 0)}, stroke=${pythonString(style.stroke || DEFAULT_STYLE.stroke)}, fill=${pythonString(style.fill || DEFAULT_STYLE.fill)}, linewidth=${fmt(Math.max((style.strokeWidth || DEFAULT_STYLE.strokeWidth) * 0.75, 0.5))}, hatch=${hatch ? pythonString(hatch) : "None"}, text=${pythonString(obj.text || "")}, text_color=${pythonString(style.textColor || DEFAULT_STYLE.textColor)}${custom})`;
  }

  function matplotlibStreamLine(obj) {
    const style = obj.style || DEFAULT_STYLE;
    const label = obj.text ? pythonString(obj.text) : "None";
    return `draw_stream(ax, [${obj.points.map(pythonPoint).join(", ")}], color=${pythonString(style.stroke || DEFAULT_STYLE.stroke)}, linewidth=${fmt(Math.max((style.strokeWidth || DEFAULT_STYLE.strokeWidth) * 0.75, 0.5))}, arrow=${pythonString(obj.arrow || "none")}, label=${label}, label_xy=${pythonPoint(streamLabelPoint(obj))}, text_color=${pythonString(style.textColor || DEFAULT_STYLE.textColor)})`;
  }

  function matplotlibLabelLine(obj) {
    const style = obj.style || DEFAULT_STYLE;
    return `draw_label(ax, x=${fmt(obj.x)}, y=${fmt(obj.y)}, text=${pythonString(obj.text || "")}, color=${pythonString(style.textColor || DEFAULT_STYLE.textColor)}, fontsize=${fmt((obj.size || 15) * 0.75)})`;
  }

  function updateMatplotlib() {
    const objects = state.objects.filter(isRenderableObject);
    const bounds = matplotlibBounds(objects);
    const padding = Math.max(state.grid * 2, 40);
    const minX = bounds.x - padding;
    const maxX = bounds.x + bounds.width + padding;
    const minY = bounds.y - padding;
    const maxY = bounds.y + bounds.height + padding;
    const lines = [
      "# Generated by PFD Diagram Studio.",
      "# Coordinates use the editor's pixel grid and are converted by SCALE.",
      "import matplotlib.pyplot as plt",
      "from matplotlib.patches import Ellipse, PathPatch, Polygon, Rectangle",
      "from matplotlib.path import Path",
      "from matplotlib.transforms import Affine2D",
      "",
      `SCALE = ${fmt(state.scale)}`,
      "",
      "def xy(x, y):",
      "    return x / SCALE, -y / SCALE",
      "",
      "def patch_style(stroke, fill, linewidth, hatch=None):",
      "    return dict(edgecolor=stroke, facecolor=fill, linewidth=linewidth, hatch=hatch)",
      "",
      "def add_patch(ax, patch, center, rotation=0):",
      "    if rotation:",
      "        cx, cy = xy(*center)",
      "        patch.set_transform(Affine2D().rotate_deg_around(cx, cy, rotation) + ax.transData)",
      "    else:",
      "        patch.set_transform(ax.transData)",
      "    ax.add_patch(patch)",
      "",
      "def rotated_xy(x, y, center, rotation):",
      "    point = xy(x, y)",
      "    if not rotation:",
      "        return point",
      "    cx, cy = xy(*center)",
      "    return tuple(Affine2D().rotate_deg_around(cx, cy, rotation).transform_point(point))",
      "",
      "def add_line(ax, points, color, linewidth, rotation=0, center=(0, 0)):",
      "    data_points = [rotated_xy(x, y, center, rotation) for x, y in points]",
      "    line, = ax.plot([p[0] for p in data_points], [p[1] for p in data_points], color=color, linewidth=linewidth, solid_capstyle='round', solid_joinstyle='round')",
      "    return line",
      "",
      "def draw_stream(ax, points, color, linewidth, arrow='none', label=None, label_xy=None, text_color='#172126', rotation=0, center=(0, 0)):",
      "    data_points = [rotated_xy(x, y, center, rotation) for x, y in points]",
      "    ax.plot([p[0] for p in data_points], [p[1] for p in data_points], color=color, linewidth=linewidth, solid_capstyle='round', solid_joinstyle='round')",
      "    arrowprops = dict(arrowstyle='-|>', color=color, lw=linewidth, shrinkA=0, shrinkB=0)",
      "    if arrow in ('->', '<->') and len(data_points) > 1:",
      "        ax.annotate('', xy=data_points[-1], xytext=data_points[-2], arrowprops=arrowprops)",
      "    if arrow in ('<-', '<->') and len(data_points) > 1:",
      "        ax.annotate('', xy=data_points[0], xytext=data_points[1], arrowprops=arrowprops)",
      "    if label and label_xy is not None:",
      "        lx, ly = rotated_xy(label_xy[0], label_xy[1], center, rotation)",
      "        ax.text(lx, ly + 8 / SCALE, label, ha='center', va='bottom', color=text_color, fontsize=10, bbox=dict(facecolor='white', edgecolor='none', pad=1))",
      "",
      "def draw_label(ax, x, y, text, color, fontsize):",
      "    if text:",
      "        ax.text(*xy(x, y), text, ha='center', va='center', color=color, fontsize=fontsize)",
      "",
      "def vessel_path(x, y, width, height, style):",
      "    top = y + height * 0.08",
      "    bottom = y + height * 0.92",
      "    curve = height * 0.08 * 0.5522848",
      "    vertices = [xy(x, top), xy(x, bottom), xy(x, bottom + curve), xy(x + width, bottom + curve), xy(x + width, bottom), xy(x + width, top), xy(x + width, top - curve), xy(x, top - curve), xy(x, top)]",
      "    codes = [Path.MOVETO, Path.LINETO, Path.CURVE4, Path.CURVE4, Path.CURVE4, Path.LINETO, Path.CURVE4, Path.CURVE4, Path.CURVE4]",
      "    return PathPatch(Path(vertices, codes), **style)",
      "",
      "def draw_equipment(ax, kind, x, y, width, height, rotation, stroke, fill, linewidth, hatch, text, text_color, custom=None):",
      "    center = (x + width / 2, y + height / 2)",
      "    style = patch_style(stroke, fill, linewidth, hatch)",
      "    outline = patch_style(stroke, 'none', linewidth)",
      "    if kind == 'custom':",
      "        add_patch(ax, Rectangle(xy(x, y), width / SCALE, height / SCALE, **style), center, rotation)",
      "        for primitive, a, b in custom or []:",
      "            if primitive == 'line':",
      "                add_line(ax, [a, b], stroke, linewidth, rotation, center)",
      "            elif primitive == 'rect':",
      "                px = min(a[0], b[0]); py = min(a[1], b[1])",
      "                add_patch(ax, Rectangle(xy(px, py), abs(b[0] - a[0]) / SCALE, abs(b[1] - a[1]) / SCALE, **outline), center, rotation)",
      "            elif primitive == 'circle':",
      "                add_patch(ax, Ellipse(xy((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), abs(b[0] - a[0]) / SCALE, abs(b[1] - a[1]) / SCALE, **outline), center, rotation)",
      "    elif kind == 'rectangle':",
      "        add_patch(ax, Rectangle(xy(x, y), width / SCALE, height / SCALE, **style), center, rotation)",
      "    elif kind == 'circle':",
      "        add_patch(ax, Ellipse(xy(*center), width / SCALE, height / SCALE, **style), center, rotation)",
      "    elif kind == 'pump':",
      "        radius = min(width, height) * 0.36",
      "        cx, cy = x + width / 2, y + height * 0.38",
      "        bottom = y + height * 0.92",
      "        add_line(ax, [(x + width * 0.18, bottom), (x + width * 0.82, bottom)], stroke, linewidth, rotation, center)",
      "        add_line(ax, [(x + width * 0.18, bottom), (cx - radius * 0.72, cy + radius * 0.72)], stroke, linewidth, rotation, center)",
      "        add_line(ax, [(x + width * 0.82, bottom), (cx + radius * 0.72, cy + radius * 0.72)], stroke, linewidth, rotation, center)",
      "        add_patch(ax, Ellipse(xy(cx, cy), 2 * radius / SCALE, 2 * radius / SCALE, **style), center, rotation)",
      "    elif kind == 'trapezoid':",
      "        points = [(x, y), (x + width, y), (x + width * 0.82, y + height), (x + width * 0.18, y + height)]",
      "        add_patch(ax, Polygon([xy(*point) for point in points], closed=True, **style), center, rotation)",
      "    elif kind == 'heatExchanger':",
      "        radius = min(width, height) * 0.42",
      "        cx, cy = center",
      "        add_patch(ax, Ellipse(xy(cx, cy), 2 * radius / SCALE, 2 * radius / SCALE, **style), center, rotation)",
      "        inner = [(x + width * 0.08, y + height * 0.78), (x + width * 0.42, y + height * 0.38), (x + width * 0.57, y + height * 0.65), (x + width * 0.96, y + height * 0.22)]",
      "        draw_stream(ax, inner, stroke, max(linewidth * 1.4, 1.8), arrow='->', rotation=rotation, center=center)",
      "    elif kind in ('distillation', 'tank', 'reactor'):",
      "        top = y + height * 0.08",
      "        add_patch(ax, vessel_path(x, y, width, height, style), center, rotation)",
      "        add_patch(ax, Ellipse(xy(x + width / 2, top), width / SCALE, height * 0.16 / SCALE, **outline), center, rotation)",
      "        if kind == 'distillation':",
      "            for i in range(1, 5):",
      "                yy = y + height * (0.16 + i * 0.14)",
      "                add_line(ax, [(x + 8, yy), (x + width - 8, yy)], stroke, linewidth, rotation, center)",
      "        if kind == 'reactor':",
      "            add_line(ax, [(x + width * 0.25, y + height * 0.28), (x + width * 0.75, y + height * 0.72)], stroke, linewidth, rotation, center)",
      "            add_line(ax, [(x + width * 0.75, y + height * 0.28), (x + width * 0.25, y + height * 0.72)], stroke, linewidth, rotation, center)",
      "    elif kind == 'separator':",
      "        add_patch(ax, Ellipse(xy(*center), width / SCALE, height / SCALE, **style), center, rotation)",
      "        add_line(ax, [(x + width / 2, y + 10), (x + width / 2, y + height - 10)], stroke, linewidth, rotation, center)",
      "    elif kind == 'valve':",
      "        left = [(x, y + height * 0.2), center, (x, y + height * 0.8)]",
      "        right = [(x + width, y + height * 0.2), center, (x + width, y + height * 0.8)]",
      "        add_patch(ax, Polygon([xy(*point) for point in left], closed=True, **style), center, rotation)",
      "        add_patch(ax, Polygon([xy(*point) for point in right], closed=True, **style), center, rotation)",
      "        add_line(ax, [center, (x + width / 2, y)], stroke, linewidth, rotation, center)",
      "    elif kind == 'compressor':",
      "        points = [(x, y + height * 0.18), (x + width, y), (x + width, y + height), (x, y + height * 0.82)]",
      "        add_patch(ax, Polygon([xy(*point) for point in points], closed=True, **style), center, rotation)",
      "    else:",
      "        add_patch(ax, Rectangle(xy(x, y), width / SCALE, height / SCALE, **style), center, rotation)",
      "    if text:",
      "        ax.text(*xy(*center), text, ha='center', va='center', color=text_color, fontsize=10, rotation=rotation)",
      "",
      "fig, ax = plt.subplots(figsize=(10, 6))",
      "ax.set_aspect('equal', adjustable='box')",
      `ax.set_xlim(${fmt(minX)} / SCALE, ${fmt(maxX)} / SCALE)`,
      `ax.set_ylim((${fmt(-maxY)}) / SCALE, (${fmt(-minY)}) / SCALE)`,
      "ax.axis('off')",
      ""
    ];
    for (const obj of objects) {
      if (obj.kind === "equipment") lines.push(matplotlibEquipmentLine(obj));
      if (obj.kind === "stream") lines.push(matplotlibStreamLine(obj));
      if (obj.kind === "label" && obj.text) lines.push(matplotlibLabelLine(obj));
    }
    lines.push("plt.tight_layout(pad=0)", "plt.show()");
    els.tikz.value = lines.join("\n");
  }

  function updateCodeOutput() {
    if (state.codeMode === "matplotlib") updateMatplotlib();
    else updateTikz();
  }

  function setCodeMode(mode) {
    state.codeMode = mode;
    els.codeTabs.forEach((tab) => {
      const active = tab.dataset.codeMode === mode;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    els.copyBtn.textContent = mode === "matplotlib" ? "Copy Python" : "Copy TikZ";
    els.downloadCodeBtn.textContent = mode === "matplotlib" ? ".py" : ".tex";
    els.downloadCodeBtn.title = mode === "matplotlib" ? "Download .py" : "Download .tex";
    updateCodeOutput();
  }

  function exportJson() {
    return JSON.stringify({
      version: 1,
      grid: state.grid,
      scale: state.scale,
      objects: state.objects.filter(isRenderableObject),
      counters: state.counters,
      customSymbols: state.customSymbols
    }, null, 2);
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function customCanvasPoint(event) {
    const rect = els.customCanvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 200;
    const y = ((event.clientY - rect.top) / rect.height) * 140;
    return { x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10 };
  }

  function renderCustomBuilder() {
    els.customLayer.replaceChildren();
    const primitives = [...state.customBuilder.primitives];
    if (state.customBuilder.drag) {
      primitives.push({
        type: state.customBuilder.tool,
        a: state.customBuilder.drag.start,
        b: state.customBuilder.drag.current
      });
    }
    primitives.forEach((primitive) => {
      if (primitive.type === "line") {
        els.customLayer.append(svgEl("line", {
          x1: primitive.a.x,
          y1: primitive.a.y,
          x2: primitive.b.x,
          y2: primitive.b.y,
          stroke: DEFAULT_STYLE.stroke,
          "stroke-width": 2,
          "stroke-linecap": "round"
        }));
      } else if (primitive.type === "rect") {
        els.customLayer.append(svgEl("rect", {
          x: Math.min(primitive.a.x, primitive.b.x),
          y: Math.min(primitive.a.y, primitive.b.y),
          width: Math.abs(primitive.b.x - primitive.a.x),
          height: Math.abs(primitive.b.y - primitive.a.y),
          fill: "none",
          stroke: DEFAULT_STYLE.stroke,
          "stroke-width": 2
        }));
      } else if (primitive.type === "circle") {
        els.customLayer.append(svgEl("ellipse", {
          cx: (primitive.a.x + primitive.b.x) / 2,
          cy: (primitive.a.y + primitive.b.y) / 2,
          rx: Math.abs(primitive.b.x - primitive.a.x) / 2,
          ry: Math.abs(primitive.b.y - primitive.a.y) / 2,
          fill: "none",
          stroke: DEFAULT_STYLE.stroke,
          "stroke-width": 2
        }));
      }
    });
  }

  function openCustomBuilder() {
    state.customBuilder = { tool: "line", primitives: [], drag: null };
    els.customName.value = "Custom Block";
    document.querySelectorAll("[data-custom-tool]").forEach((btn) => btn.classList.toggle("active", btn.dataset.customTool === "line"));
    renderCustomBuilder();
    els.customDialog.showModal();
  }

  function saveCustomBuilder() {
    const name = els.customName.value.trim() || "Custom Block";
    if (!state.customBuilder.primitives.length) return;
    const symbol = {
      id: uid("symbol"),
      name,
      width: 120,
      height: 90,
      primitives: clone(state.customBuilder.primitives)
    };
    state.customSymbols.push(symbol);
    saveCustomSymbols();
    registerCustomShapes();
    initPalette();
    els.customDialog.close();
  }

  function bindCustomBuilder() {
    document.getElementById("newCustomBlockBtn").addEventListener("click", openCustomBuilder);
    document.getElementById("closeCustomBlockBtn").addEventListener("click", () => els.customDialog.close());
    document.querySelectorAll("[data-custom-tool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.customBuilder.tool = btn.dataset.customTool;
        document.querySelectorAll("[data-custom-tool]").forEach((toolBtn) => toolBtn.classList.toggle("active", toolBtn === btn));
      });
    });
    document.getElementById("undoCustomPrimitiveBtn").addEventListener("click", () => {
      state.customBuilder.primitives.pop();
      renderCustomBuilder();
    });
    document.getElementById("clearCustomPrimitiveBtn").addEventListener("click", () => {
      state.customBuilder.primitives = [];
      renderCustomBuilder();
    });
    document.getElementById("saveCustomBlockBtn").addEventListener("click", saveCustomBuilder);
    els.customCanvas.addEventListener("pointerdown", (event) => {
      const point = customCanvasPoint(event);
      state.customBuilder.drag = { start: point, current: point };
      els.customCanvas.setPointerCapture?.(event.pointerId);
      renderCustomBuilder();
    });
    els.customCanvas.addEventListener("pointermove", (event) => {
      if (!state.customBuilder.drag) return;
      state.customBuilder.drag.current = customCanvasPoint(event);
      renderCustomBuilder();
    });
    els.customCanvas.addEventListener("pointerup", (event) => {
      if (!state.customBuilder.drag) return;
      const primitive = {
        type: state.customBuilder.tool,
        a: state.customBuilder.drag.start,
        b: customCanvasPoint(event)
      };
      state.customBuilder.drag = null;
      if (Math.hypot(primitive.b.x - primitive.a.x, primitive.b.y - primitive.a.y) >= MIN_DRAW_SIZE) {
        state.customBuilder.primitives.push(primitive);
      }
      renderCustomBuilder();
    });
  }

  function initPalette() {
    els.palette.replaceChildren();
    Object.entries(SHAPES).forEach(([type, def]) => {
      const btn = document.createElement("button");
      btn.className = "shape-button";
      btn.dataset.tool = type;
      btn.title = `${def.label}: click, then place on canvas`;
      const icon = svgEl("svg", { viewBox: "0 0 120 80", "aria-hidden": "true" });
      const preview = { id: "preview", kind: "equipment", type, x: 18, y: 14, width: 84, height: 52, rotation: 0, style: DEFAULT_STYLE };
      drawEquipment(icon, preview);
      btn.append(icon, Object.assign(document.createElement("span"), { textContent: def.label }));
      btn.addEventListener("click", () => setTool(type));
      els.palette.append(btn);
    });
  }

  function bindEvents() {
    document.querySelectorAll(".tool").forEach((btn) => btn.addEventListener("click", () => setTool(btn.dataset.tool)));
    els.svg.addEventListener("pointerdown", onCanvasPointerDown);
    els.svg.addEventListener("pointermove", onCanvasPointerMove);
    els.svg.addEventListener("pointerup", onCanvasPointerUp);
    window.addEventListener("pointermove", onCanvasPointerMove);
    window.addEventListener("pointerup", onCanvasPointerUp);
    els.svg.addEventListener("mousedown", onCanvasMouseDown);
    els.svg.addEventListener("mousemove", onCanvasMouseMove);
    els.svg.addEventListener("mouseup", onCanvasMouseUp);
    window.addEventListener("mousemove", onCanvasMouseMove);
    window.addEventListener("mouseup", onCanvasMouseUp);
    els.svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      const before = screenToWorld(event);
      const factor = event.deltaY < 0 ? 0.9 : 1.1;
      state.view.w *= factor;
      state.view.h *= factor;
      const after = screenToWorld(event);
      state.view.x += before.x - after.x;
      state.view.y += before.y - after.y;
      render();
    }, { passive: false });

    els.propertyForm.addEventListener("input", applyProperties);
    els.gridSpacing.addEventListener("change", () => { state.grid = Number(els.gridSpacing.value); render(); });
    els.scaleInput.addEventListener("change", () => { state.scale = Number(els.scaleInput.value); render(); });
    els.snapToggle.addEventListener("change", () => { state.snap = els.snapToggle.checked; });
    els.gridToggle.addEventListener("change", () => { state.showGrid = els.gridToggle.checked; render(); });

    document.getElementById("undoBtn").addEventListener("click", undo);
    document.getElementById("redoBtn").addEventListener("click", redo);
    document.getElementById("copyBtn").addEventListener("click", () => copyText(els.tikz.value));
    document.getElementById("downloadCodeBtn").addEventListener("click", () => {
      const matplotlib = state.codeMode === "matplotlib";
      download(matplotlib ? "pfd-diagram.py" : "pfd-diagram.tex", els.tikz.value, matplotlib ? "text/x-python" : "text/plain");
    });
    els.codeTabs.forEach((tab) => tab.addEventListener("click", () => setCodeMode(tab.dataset.codeMode)));
    document.getElementById("saveJsonBtn").addEventListener("click", () => download("pfd-diagram.json", exportJson(), "application/json"));
    document.getElementById("clearBtn").addEventListener("click", () => {
      if (!state.objects.length || confirm("Clear the current diagram?")) {
        state.objects = [];
        state.selectedIds = [];
        commit();
      }
    });
    document.getElementById("loadJsonInput").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const data = JSON.parse(await file.text());
      state.objects = data.objects || [];
      state.grid = data.grid || state.grid;
      state.scale = data.scale || state.scale;
      state.counters = data.counters || state.counters;
      state.customSymbols = data.customSymbols || state.customSymbols;
      saveCustomSymbols();
      registerCustomShapes();
      initPalette();
      state.selectedIds = [];
      els.gridSpacing.value = state.grid;
      els.scaleInput.value = state.scale;
      commit();
      event.target.value = "";
    });

    document.getElementById("rotateLeftBtn").addEventListener("click", () => rotateSelected(-90));
    document.getElementById("rotateRightBtn").addEventListener("click", () => rotateSelected(90));
    document.getElementById("bringForwardBtn").addEventListener("click", () => layer(1));
    document.getElementById("sendBackwardBtn").addEventListener("click", () => layer(-1));
    document.getElementById("alignLeftBtn").addEventListener("click", () => align("x", "min"));
    document.getElementById("alignCenterBtn").addEventListener("click", () => align("x", "center"));
    document.getElementById("alignTopBtn").addEventListener("click", () => align("y", "min"));
    document.getElementById("alignMiddleBtn").addEventListener("click", () => align("y", "center"));
    document.getElementById("distHBtn").addEventListener("click", () => distribute("x"));
    document.getElementById("distVBtn").addEventListener("click", () => distribute("y"));
    document.querySelectorAll("[data-tag-prefix]").forEach((btn) => btn.addEventListener("click", () => {
      const obj = state.selectedIds.length === 1 ? findObj(state.selectedIds[0]) : null;
      if (obj) {
        obj.text = nextTag(btn.dataset.tagPrefix);
        commit();
      }
    }));

    window.addEventListener("keydown", (event) => {
      const meta = event.metaKey || event.ctrlKey;
      const active = document.activeElement;
      const editingForm = active && (active.classList?.contains("editing-input") || els.propertyForm.contains(active));
      if ((event.key === "Delete" || event.key === "Backspace") && state.selectedIds.length && !editingForm) {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA") return;
      if (meta && event.key.toLowerCase() === "z" && event.shiftKey) { event.preventDefault(); redo(); }
      else if (meta && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
      else if (meta && event.key.toLowerCase() === "c") { event.preventDefault(); copySelected(); }
      else if (meta && event.key.toLowerCase() === "v") { event.preventDefault(); pasteSelected(); }
      else if (meta && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateSelected(); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelected(); }
      else if (event.key.toLowerCase() === "v") setTool("select");
      else if (event.key.toLowerCase() === "h") setTool("pan");
      else if (event.key.toLowerCase() === "l") setTool("line");
      else if (event.key.toLowerCase() === "p") setTool("pipe");
      else if (event.key.toLowerCase() === "a") setTool("arrow");
      else if (event.key.toLowerCase() === "b") setTool("bidi");
      else if (event.key.toLowerCase() === "t") setTool("text");
      else if (event.key.toLowerCase() === "r") rotateSelected(event.shiftKey ? -90 : 90);
      else if (event.key === "Escape") { state.selectedIds = []; setTool("select"); render(); }
    });
  }

  function rotateSelected(delta) {
    selectedObjects().filter((obj) => obj.kind === "equipment").forEach((obj) => {
      obj.rotation = ((obj.rotation || 0) + delta) % 360;
    });
    commit();
  }

  loadCustomSymbols();
  initPalette();
  bindEvents();
  bindCustomBuilder();
  pushHistory();
  setTool("select");
  render();
})();
