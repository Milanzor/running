const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_W = 640;
const CHART_H = 220;
const PAD = { top: 12, right: 16, bottom: 24, left: 40 };

function el(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function niceMax(value) {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const residual = value / magnitude;
  let step;
  if (residual <= 1) step = 1;
  else if (residual <= 2) step = 2;
  else if (residual <= 5) step = 5;
  else step = 10;
  return step * magnitude;
}

function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function fmtSecsAsClock(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function tooltipFor(wrap) {
  let tip = wrap.querySelector(".chart-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "chart-tooltip";
    wrap.appendChild(tip);
  }
  return tip;
}

function showTooltip(wrap, svgX, svgY, html) {
  const tip = tooltipFor(wrap);
  const svg = wrap.querySelector("svg");
  const rect = svg.getBoundingClientRect();
  const scale = rect.width / CHART_W;
  tip.style.left = `${svgX * scale}px`;
  tip.style.top = `${svgY * scale}px`;
  tip.innerHTML = html;
  tip.classList.add("visible");
}
function hideTooltip(wrap) {
  const tip = wrap.querySelector(".chart-tooltip");
  if (tip) tip.classList.remove("visible");
}

function drawFrame(svg, yMax, yFormat) {
  svg.setAttribute("viewBox", `0 0 ${CHART_W} ${CHART_H}`);
  svg.innerHTML = "";
  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (yMax / ticks) * i;
    const y = PAD.top + plotH - (v / yMax) * plotH;
    el("line", {
      x1: PAD.left, x2: CHART_W - PAD.right, y1: y, y2: y,
      class: i === 0 ? "baseline" : "gridline",
    }, svg);
    el("text", {
      x: PAD.left - 8, y: y + 3, class: "tick-label", "text-anchor": "end",
    }, svg).textContent = yFormat(v);
  }
  return { plotW, plotH, x0: PAD.left, y0: PAD.top };
}

function xPos(i, n, plotW, x0) {
  if (n <= 1) return x0 + plotW / 2;
  return x0 + (i / (n - 1)) * plotW;
}

function yPos(v, yMax, plotH, y0) {
  return y0 + plotH - (v / yMax) * plotH;
}

// --- Weekly volume: bars + rolling average line ---
function renderVolumeChart(weeklyVolume) {
  const svg = document.getElementById("chart-volume");
  const wrap = svg.closest(".chart-wrap");
  const legend = document.getElementById("legend-volume");
  if (!weeklyVolume.length) { svg.parentElement.innerHTML = '<p class="no-data">No activity data yet.</p>'; return; }

  const n = weeklyVolume.length;
  const values = weeklyVolume.map((w) => w.km);
  const rolling = values.map((_, i) => {
    const window = values.slice(Math.max(0, i - 3), i + 1);
    return window.reduce((a, b) => a + b, 0) / window.length;
  });
  const yMax = niceMax(Math.max(...values, ...rolling) * 1.15);
  const { plotW, plotH, x0, y0 } = drawFrame(svg, yMax, (v) => Math.round(v));

  const bandW = (plotW / n) * 0.6;
  weeklyVolume.forEach((w, i) => {
    const cx = xPos(i, n, plotW, x0);
    const barTop = yPos(w.km, yMax, plotH, y0);
    const bar = el("rect", {
      x: cx - bandW / 2, y: barTop, width: bandW, height: (y0 + plotH) - barTop,
      rx: 3, fill: "var(--series-1)", opacity: 0.85,
    }, svg);
    bar.addEventListener("mouseenter", () => {
      showTooltip(wrap, cx, barTop, `<span class="tooltip-label">Week of ${fmtDate(w.week_start)}</span> ${w.km} km`);
    });
    bar.addEventListener("mouseleave", () => hideTooltip(wrap));

    if (i === 0 || i === n - 1 || i % 3 === 0) {
      el("text", {
        x: cx, y: CHART_H - 6, class: "tick-label", "text-anchor": "middle",
      }, svg).textContent = fmtDate(w.week_start);
    }
  });

  const points = rolling.map((v, i) => [xPos(i, n, plotW, x0), yPos(v, yMax, plotH, y0)]);
  const path = "M" + points.map((p) => p.join(",")).join(" L");
  el("path", { d: path, fill: "none", stroke: "var(--series-2)", "stroke-width": 2, "stroke-linecap": "round" }, svg);
  points.forEach(([px, py], i) => {
    const dot = el("circle", { cx: px, cy: py, r: 3, fill: "var(--series-2)" }, svg);
    dot.addEventListener("mouseenter", () => {
      showTooltip(wrap, px, py, `<span class="tooltip-label">4-wk avg</span> ${rolling[i].toFixed(1)} km`);
    });
    dot.addEventListener("mouseleave", () => hideTooltip(wrap));
  });

  legend.innerHTML = `
    <span class="legend-item"><span class="legend-swatch" style="background:var(--series-1)"></span>Weekly km</span>
    <span class="legend-item"><span class="legend-line" style="background:var(--series-2)"></span>4-week rolling avg</span>
  `;
}

// --- Generic line chart with optional reference line / band ---
function renderLineChart(svgId, points, { yFormat, color, refLine, band, unitLabel, yMin: yMinOverride }) {
  const svg = document.getElementById(svgId);
  const wrap = svg.closest(".chart-wrap");
  if (!points.length) { svg.parentElement.innerHTML = '<p class="no-data">No data yet.</p>'; return; }

  const n = points.length;
  const values = points.map((p) => p.y);
  const maxVal = Math.max(...values, refLine ? refLine.y : 0, band ? band.yMax : 0);
  const yMax = niceMax(maxVal * 1.1);
  const { plotW, plotH, x0, y0 } = drawFrame(svg, yMax, yFormat);

  if (band) {
    const yTop = yPos(band.yMax, yMax, plotH, y0);
    const yBottom = yPos(band.yMin, yMax, plotH, y0);
    el("rect", {
      x: x0, y: yTop, width: plotW, height: yBottom - yTop,
      fill: "var(--good)", opacity: 0.08,
    }, svg);
    el("text", { x: CHART_W - PAD.right, y: yTop - 4, class: "tick-label", "text-anchor": "end" }, svg).textContent = band.label;
  }

  if (refLine) {
    const ry = yPos(refLine.y, yMax, plotH, y0);
    el("line", { x1: x0, x2: CHART_W - PAD.right, y1: ry, y2: ry, stroke: "var(--text-muted)", "stroke-width": 1, "stroke-dasharray": "3,3" }, svg);
    el("text", { x: CHART_W - PAD.right, y: ry - 4, class: "tick-label", "text-anchor": "end" }, svg).textContent = refLine.label;
  }

  const coords = points.map((p, i) => [xPos(i, n, plotW, x0), yPos(p.y, yMax, plotH, y0)]);

  const gradId = `grad-${svgId}`;
  const defs = el("defs", {}, svg);
  const grad = el("linearGradient", { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el("stop", { offset: "0%", "stop-color": color, "stop-opacity": 0.22 }, grad);
  el("stop", { offset: "100%", "stop-color": color, "stop-opacity": 0 }, grad);
  const baseline = y0 + plotH;
  const areaPath = "M" + coords.map((c) => c.join(",")).join(" L") +
    ` L${coords[coords.length - 1][0]},${baseline} L${coords[0][0]},${baseline} Z`;
  el("path", { d: areaPath, fill: `url(#${gradId})`, stroke: "none" }, svg);

  const path = "M" + coords.map((c) => c.join(",")).join(" L");
  el("path", { d: path, fill: "none", stroke: color, "stroke-width": 2, "stroke-linecap": "round" }, svg);

  coords.forEach(([px, py], i) => {
    const dot = el("circle", { cx: px, cy: py, r: i === n - 1 ? 4 : 3, fill: color }, svg);
    dot.addEventListener("mouseenter", () => {
      showTooltip(wrap, px, py, `<span class="tooltip-label">${fmtDate(points[i].x)}</span> ${points[i].display ?? points[i].y}${unitLabel || ""}`);
    });
    dot.addEventListener("mouseleave", () => hideTooltip(wrap));
  });

  const tickEvery = Math.max(1, Math.floor(n / 5));
  points.forEach((p, i) => {
    if (i % tickEvery === 0 || i === n - 1) {
      el("text", { x: xPos(i, n, plotW, x0), y: CHART_H - 6, class: "tick-label", "text-anchor": "middle" }, svg).textContent = fmtDate(p.x);
    }
  });
}

// --- Long run progression: bars ---
function renderLongRunChart(longRun) {
  const svg = document.getElementById("chart-longrun");
  const wrap = svg.closest(".chart-wrap");
  if (!longRun.length) { svg.parentElement.innerHTML = '<p class="no-data">No long runs logged yet.</p>'; return; }

  const n = longRun.length;
  const values = longRun.map((w) => w.km);
  const yMax = niceMax(Math.max(...values, 34) * 1.1);
  const { plotW, plotH, x0, y0 } = drawFrame(svg, yMax, (v) => Math.round(v));

  const goalY = yPos(32, yMax, plotH, y0);
  el("line", { x1: x0, x2: CHART_W - PAD.right, y1: goalY, y2: goalY, stroke: "var(--good)", "stroke-width": 1, "stroke-dasharray": "3,3" }, svg);
  el("text", { x: CHART_W - PAD.right, y: goalY - 4, class: "tick-label", "text-anchor": "end" }, svg).textContent = "peak target";

  const bandW = (plotW / n) * 0.6;
  longRun.forEach((w, i) => {
    const cx = xPos(i, n, plotW, x0);
    const barTop = yPos(w.km, yMax, plotH, y0);
    const bar = el("rect", {
      x: cx - bandW / 2, y: barTop, width: bandW, height: (y0 + plotH) - barTop,
      rx: 3, fill: "var(--series-3)", opacity: 0.85,
    }, svg);
    bar.addEventListener("mouseenter", () => {
      showTooltip(wrap, cx, barTop, `<span class="tooltip-label">${fmtDate(w.date)}</span> ${w.km} km`);
    });
    bar.addEventListener("mouseleave", () => hideTooltip(wrap));

    if (i === 0 || i === n - 1 || i % 3 === 0) {
      el("text", { x: cx, y: CHART_H - 6, class: "tick-label", "text-anchor": "middle" }, svg).textContent = fmtDate(w.week_start);
    }
  });
}

// --- Zone-time distribution: stacked bars (aerobic + anaerobic) ---
function renderZoneChart(zoneDistribution) {
  const svg = document.getElementById("chart-zones");
  const wrap = svg.closest(".chart-wrap");
  const legend = document.getElementById("legend-zones");
  if (!zoneDistribution.length) { svg.parentElement.innerHTML = '<p class="no-data">No zone data yet.</p>'; return; }

  const n = zoneDistribution.length;
  const totals = zoneDistribution.map((w) => w.aerobic_min + w.anaerobic_min);
  const yMax = niceMax(Math.max(...totals) * 1.15);
  const { plotW, plotH, x0, y0 } = drawFrame(svg, yMax, (v) => Math.round(v));
  const GAP = 2;

  const bandW = (plotW / n) * 0.6;
  zoneDistribution.forEach((w, i) => {
    const cx = xPos(i, n, plotW, x0);
    const aerobicTop = yPos(w.aerobic_min, yMax, plotH, y0);
    const aerobicH = (y0 + plotH) - aerobicTop;
    const bar1 = el("rect", {
      x: cx - bandW / 2, y: aerobicTop, width: bandW, height: Math.max(0, aerobicH - GAP / 2),
      rx: 3, fill: "var(--series-1)", opacity: 0.85,
    }, svg);
    bar1.addEventListener("mouseenter", () => {
      showTooltip(wrap, cx, aerobicTop, `<span class="tooltip-label">Aerobic</span> ${Math.round(w.aerobic_min)} min`);
    });
    bar1.addEventListener("mouseleave", () => hideTooltip(wrap));

    const anaerobicTop = yPos(w.aerobic_min + w.anaerobic_min, yMax, plotH, y0);
    const anaerobicH = aerobicTop - anaerobicTop;
    if (anaerobicH > 0) {
      const bar2 = el("rect", {
        x: cx - bandW / 2, y: anaerobicTop, width: bandW, height: Math.max(0, anaerobicH - GAP / 2),
        rx: 3, fill: "var(--series-2)", opacity: 0.85,
      }, svg);
      bar2.addEventListener("mouseenter", () => {
        showTooltip(wrap, cx, anaerobicTop, `<span class="tooltip-label">Anaerobic</span> ${Math.round(w.anaerobic_min)} min`);
      });
      bar2.addEventListener("mouseleave", () => hideTooltip(wrap));
    }

    if (i === 0 || i === n - 1 || i % 3 === 0) {
      el("text", { x: cx, y: CHART_H - 6, class: "tick-label", "text-anchor": "middle" }, svg).textContent = fmtDate(w.week_start);
    }
  });

  legend.innerHTML = `
    <span class="legend-item"><span class="legend-swatch" style="background:var(--series-1)"></span>Aerobic (Z1–Z3)</span>
    <span class="legend-item"><span class="legend-swatch" style="background:var(--series-2)"></span>Anaerobic (Z4–Z5)</span>
  `;
}

// --- Pace by effort: scatter, inverted y-axis (faster = up) ---
function renderPaceChart(paceByEffort) {
  const svg = document.getElementById("chart-pace");
  const wrap = svg.closest(".chart-wrap");
  const legend = document.getElementById("legend-pace");
  if (!paceByEffort.length) { svg.parentElement.innerHTML = '<p class="no-data">No pace data yet.</p>'; return; }

  const buckets = [
    { key: "Easy", color: "var(--series-1)" },
    { key: "Steady/Threshold", color: "var(--series-2)" },
    { key: "Hard", color: "var(--series-3)" },
  ].filter((b) => paceByEffort.some((p) => p.bucket === b.key));

  const dates = [...new Set(paceByEffort.map((p) => p.date))].sort();
  const n = dates.length;
  const dateIndex = Object.fromEntries(dates.map((d, i) => [d, i]));

  const paces = paceByEffort.map((p) => p.pace_min_per_km);
  const yMin = Math.floor(Math.min(...paces) * 2) / 2 - 0.25;
  const yMax = Math.ceil(Math.max(...paces) * 2) / 2 + 0.25;
  const range = yMax - yMin;

  svg.setAttribute("viewBox", `0 0 ${CHART_W} ${CHART_H}`);
  svg.innerHTML = "";
  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const x0 = PAD.left, y0 = PAD.top;

  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = yMax - (range / ticks) * i; // inverted: top = fastest
    const y = y0 + (plotH / ticks) * i;
    el("line", { x1: x0, x2: CHART_W - PAD.right, y1: y, y2: y, class: i === ticks ? "baseline" : "gridline" }, svg);
    el("text", { x: x0 - 8, y: y + 3, class: "tick-label", "text-anchor": "end" }, svg).textContent = `${v.toFixed(1)}`;
  }

  const invY = (pace) => y0 + ((pace - yMin) / range) * plotH; // faster (low pace) -> smaller y (top)

  buckets.forEach((b) => {
    const pts = paceByEffort.filter((p) => p.bucket === b.key);
    pts.forEach((p) => {
      const cx = xPos(dateIndex[p.date], n, plotW, x0);
      const cy = invY(p.pace_min_per_km);
      const dot = el("circle", { cx, cy, r: 4, fill: b.color, opacity: 0.85 }, svg);
      dot.addEventListener("mouseenter", () => {
        const mins = Math.floor(p.pace_min_per_km);
        const secs = Math.round((p.pace_min_per_km - mins) * 60);
        showTooltip(wrap, cx, cy, `<span class="tooltip-label">${fmtDate(p.date)} · ${b.key}</span> ${mins}:${String(secs).padStart(2, "0")}/km`);
      });
      dot.addEventListener("mouseleave", () => hideTooltip(wrap));
    });
  });

  const tickEvery = Math.max(1, Math.floor(n / 6));
  dates.forEach((d, i) => {
    if (i % tickEvery === 0 || i === n - 1) {
      el("text", { x: xPos(i, n, plotW, x0), y: CHART_H - 6, class: "tick-label", "text-anchor": "middle" }, svg).textContent = fmtDate(d);
    }
  });

  legend.innerHTML = buckets.map((b) =>
    `<span class="legend-item"><span class="legend-swatch" style="background:${b.color}"></span>${b.key}</span>`
  ).join("");
}

// --- Run calendar heatmap ---
function renderHeatmap(runDays, dateRange) {
  const svg = document.getElementById("chart-heatmap");
  const start = new Date(dateRange.start + "T00:00:00");
  const end = new Date(dateRange.end + "T00:00:00");
  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay() + (gridStart.getDay() === 0 ? -6 : 1)); // back to Monday

  const days = [];
  for (let d = new Date(gridStart); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }
  const weeks = Math.ceil(days.length / 7);
  const cell = 13, gap = 3;
  const width = weeks * (cell + gap) + PAD.left;
  const height = 7 * (cell + gap) + 10;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.height = `${height}px`;
  svg.innerHTML = "";

  const values = Object.values(runDays);
  const maxKm = values.length ? Math.max(...values) : 1;
  const steps = ["#e1e0d9", "#cde2fb", "#86b6ef", "#3987e5", "#184f95"];
  function colorFor(km) {
    if (!km) return steps[0];
    const frac = km / maxKm;
    if (frac < 0.15) return steps[1];
    if (frac < 0.4) return steps[2];
    if (frac < 0.7) return steps[3];
    return steps[4];
  }

  let lastMonth = null;
  days.forEach((d, i) => {
    const week = Math.floor(i / 7);
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    const iso = d.toISOString().slice(0, 10);
    const km = runDays[iso] || 0;
    const x = PAD.left + week * (cell + gap);
    const y = dow * (cell + gap);

    if (dow === 0 && d.getMonth() !== lastMonth && d >= start) {
      lastMonth = d.getMonth();
      el("text", { x, y: height - 2, class: "heatmap-label" }, svg).textContent = d.toLocaleDateString("en-GB", { month: "short" });
    }

    const rect = el("rect", {
      x, y, width: cell, height: cell, rx: 3,
      fill: d < start || d > end ? "transparent" : colorFor(km),
      class: "heatmap-cell",
    }, svg);
    if (d >= start && d <= end) {
      rect.addEventListener("mouseenter", () => {
        showTooltip(svg.closest(".chart-wrap"), x + cell / 2, y, `<span class="tooltip-label">${fmtDate(iso)}</span> ${km ? km.toFixed(1) + " km" : "rest"}`);
      });
      rect.addEventListener("mouseleave", () => hideTooltip(svg.closest(".chart-wrap")));
    }
  });
}

function renderHero(data) {
  const raceDate = new Date(data.athlete.race_date + "T00:00:00");
  const today = new Date();
  const days = Math.round((raceDate - today) / 86400000);
  const countdownTile = document.getElementById("tile-countdown");
  countdownTile.querySelector(".stat-value").textContent = days > 0 ? `${days}d` : "Race day";
  countdownTile.querySelector(".stat-sub").textContent = raceDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const vo2Tile = document.getElementById("tile-vo2max");
  vo2Tile.querySelector(".stat-value").textContent = data.current.vo2max ? data.current.vo2max.toFixed(1) : "—";
  vo2Tile.querySelector(".stat-sub").textContent = "running VO2max";

  const predTile = document.getElementById("tile-predicted");
  predTile.querySelector(".stat-value").textContent = data.current.predictions.marathon || "—";
  predTile.querySelector(".stat-sub").textContent = "Garmin race predictor";

  const goalTile = document.getElementById("tile-goal");
  goalTile.querySelector(".stat-value").textContent = data.athlete.goal_a_time;
  goalTile.querySelector(".stat-sub").textContent = `${data.athlete.goal_a_pace} pace`;

  document.getElementById("split-5k").textContent = data.current.predictions["5k"] || "—";
  document.getElementById("split-10k").textContent = data.current.predictions["10k"] || "—";
  document.getElementById("split-half").textContent = data.current.predictions.half || "—";
  document.getElementById("split-marathon").textContent = data.current.predictions.marathon || "—";
}

function renderMap(latestRun) {
  const sub = document.getElementById("latest-run-sub");
  if (!latestRun || !latestRun.route || !latestRun.route.length) {
    sub.textContent = "No route data available for the latest run.";
    document.getElementById("map").style.display = "none";
    return;
  }
  sub.textContent = `${latestRun.name} — ${fmtDate(latestRun.date)} — ${latestRun.distance_km} km / ${latestRun.duration_min} min`;

  const map = L.map("map", { scrollWheelZoom: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
  }).addTo(map);

  const style = getComputedStyle(document.documentElement);
  const routeColor = style.getPropertyValue("--series-1").trim() || "#2a78d6";
  const startColor = style.getPropertyValue("--good").trim() || "#0ca30c";

  const line = L.polyline(latestRun.route, { color: routeColor, weight: 3 }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [16, 16] });
  L.circleMarker(latestRun.route[0], { radius: 5, color: startColor, fillColor: startColor, fillOpacity: 1 }).addTo(map);
}

async function main() {
  const res = await fetch("data.json", { cache: "no-store" });
  const data = await res.json();

  renderHero(data);

  renderVolumeChart(data.weekly_volume);

  renderLineChart(
    "chart-vo2max",
    data.vo2max_history.map((h) => ({ x: h.date, y: h.vo2max })),
    { yFormat: (v) => v.toFixed(0), color: "var(--series-2)", unitLabel: "" }
  );

  const goalSecs = 3600 * 3.5; // sub-3:30
  renderLineChart(
    "chart-predictor",
    data.predictor_history.map((h) => ({
      x: h.date,
      y: h.pred_marathon_secs / 60,
      display: fmtSecsAsClock(h.pred_marathon_secs),
    })),
    {
      yFormat: (v) => `${Math.round(v)}m`,
      color: "var(--series-1)",
      refLine: { y: goalSecs / 60, label: "A-goal 3:30" },
    }
  );

  renderLongRunChart(data.long_run_progression);

  renderLineChart(
    "chart-acwr",
    data.acwr_history.map((h) => ({ x: h.date, y: h.acwr, display: `${h.acwr} (${h.status})` })),
    { yFormat: (v) => v.toFixed(1), color: "var(--series-1)", band: { yMin: 0.8, yMax: 1.3, label: "optimal" } }
  );

  renderLineChart(
    "chart-hrv",
    data.hrv_history.map((h) => ({ x: h.date, y: h.hrv, display: `${h.hrv} ms (${h.status})` })),
    { yFormat: (v) => v.toFixed(0), color: "var(--series-3)" }
  );

  renderLineChart(
    "chart-rhr",
    data.rhr_history.map((h) => ({ x: h.date, y: h.rhr })),
    { yFormat: (v) => v.toFixed(0), color: "var(--series-2)", unitLabel: " bpm" }
  );

  renderLineChart(
    "chart-sleep",
    data.sleep_history.map((h) => ({ x: h.date, y: h.score, display: `${h.score} (${h.qualifier})` })),
    { yFormat: (v) => v.toFixed(0), color: "var(--series-1)" }
  );

  renderZoneChart(data.zone_distribution);
  renderPaceChart(data.pace_by_effort);
  renderHeatmap(data.run_days, data.date_range);

  renderMap(data.latest_run);

  const rangeStart = new Date(data.date_range.start + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const rangeEnd = new Date(data.date_range.end + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  document.getElementById("data-range").textContent = `Data covers ${rangeStart} – ${rangeEnd}`;
  document.getElementById("generated-at").textContent = `Data as of ${new Date(data.generated_at).toLocaleString("en-GB")}`;

  setUpRevealAnimation();
}

function setUpRevealAnimation() {
  const targets = document.querySelectorAll(".panel, .stat-tile");
  if (!("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
  );

  targets.forEach((el, i) => {
    el.classList.add("reveal");
    el.style.transitionDelay = `${Math.min(i % 4, 3) * 60}ms`;
    observer.observe(el);
  });
}

main().catch((err) => {
  console.error(err);
  document.querySelector(".page").insertAdjacentHTML("beforeend", `<p class="no-data">Failed to load data.json: ${err.message}</p>`);
});
