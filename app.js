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

// --- Generic line chart with optional reference line ---
function renderLineChart(svgId, points, { yFormat, color, refLine, unitLabel }) {
  const svg = document.getElementById(svgId);
  const wrap = svg.closest(".chart-wrap");
  if (!points.length) { svg.parentElement.innerHTML = '<p class="no-data">No data yet.</p>'; return; }

  const n = points.length;
  const values = points.map((p) => p.y);
  const maxVal = Math.max(...values, refLine ? refLine.y : 0);
  const yMax = niceMax(maxVal * 1.1);
  const { plotW, plotH, x0, y0 } = drawFrame(svg, yMax, yFormat);

  if (refLine) {
    const ry = yPos(refLine.y, yMax, plotH, y0);
    el("line", { x1: x0, x2: CHART_W - PAD.right, y1: ry, y2: ry, stroke: "var(--text-muted)", "stroke-width": 1, "stroke-dasharray": "3,3" }, svg);
    el("text", { x: CHART_W - PAD.right, y: ry - 4, class: "tick-label", "text-anchor": "end" }, svg).textContent = refLine.label;
  }

  const coords = points.map((p, i) => [xPos(i, n, plotW, x0), yPos(p.y, yMax, plotH, y0)]);
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
  renderMap(data.latest_run);

  document.getElementById("generated-at").textContent = `Data as of ${new Date(data.generated_at).toLocaleString("en-GB")}`;
}

main().catch((err) => {
  console.error(err);
  document.querySelector(".page").insertAdjacentHTML("beforeend", `<p class="no-data">Failed to load data.json: ${err.message}</p>`);
});
