/**
 * Interactive data story: gender pay gap by occupation (U.S. CPS).
 * Core design: diverging scale anchored at 0% pay gap (vertical equality baseline).
 */

const DATA_URL = "data/all_occupations_yearly.csv";
const DISTRIBUTION_URL = "data/all_occupations_wage_distribution.csv";
const MAX_REASONABLE_HOURLY_WAGE = 300;
const MIN_SEX_SAMPLE_COUNT = 5;

const state = {
  data: [],
  distributionData: [],
  years: [],
  yearIndex: 0,
  filter: "all",
  search: "",
  selectedOccupation: null,
  lockedOccupation: null,
  timer: null,
  previousPositions: null,
  animateYearChange: false,
  zoomTransform: d3.zoomIdentity,
  zoomBehavior: null,
  zoomSelection: null,
};

const formatPct = d3.format(".1f");
const formatMoney = d3.format("$.2f");
const formatPop = d3.format(".2s");

function parseHourlyWage(value) {
  const wage = +value;
  return wage > 0 && wage < MAX_REASONABLE_HOURLY_WAGE ? wage : NaN;
}

function stripOccupationCode(occupation) {
  return occupation.replace(/\s*\(\d+\)$/g, "");
}

const els = {
  bubbleChart: d3.select("#bubbleChart"),
  distributionChart: d3.select("#distributionChart"),
  tooltip: d3.select("#tooltip"),
  yearSlider: document.querySelector("#yearSlider"),
  yearLabel: document.querySelector("#yearLabel"),
  playButton: document.querySelector("#playButton"),
  search: document.querySelector("#occupationSearch"),
  occupationOptions: document.querySelector("#occupationOptions"),
  detailTitle: document.querySelector("#detailTitle"),
  detailSummary: document.querySelector("#detailSummary"),
  metricGap: document.querySelector("#metricGap"),
  metricShare: document.querySelector("#metricShare"),
  metricMale: document.querySelector("#metricMale"),
  metricFemale: document.querySelector("#metricFemale"),
  zoomIn: document.querySelector("#zoomInButton"),
  zoomOut: document.querySelector("#zoomOutButton"),
  resetZoom: document.querySelector("#resetZoomButton"),
  howToUseButton: document.querySelector("#howToUseButton"),
  howToUseModal: document.querySelector("#howToUseModal"),
  howToUseClose: document.querySelector("#howToUseClose"),
};

init();

async function init() {
  try {
    const [raw, distributionRaw] = await Promise.all([
      d3.csv(DATA_URL, row => ({
        year: +row.year,
        occupation: stripOccupationCode(row.occupation_all),
        maleSampleCount: +row.male_sample_count,
        femaleSampleCount: +row.female_sample_count,
        malePopulation: +row.male_weighted_population,
        femalePopulation: +row.female_weighted_population,
        maleWage: parseHourlyWage(row.male_weighted_mean_real_hourly_wage),
        femaleWage: parseHourlyWage(row.female_weighted_mean_real_hourly_wage),
      })),
      d3.csv(DISTRIBUTION_URL, row => ({
        year: +row.year,
        occupation: stripOccupationCode(row.occupation_all),
        sex: row.sex,
        wage: +row.wage_midpoint_real_hourly,
        density: +row.density,
      })),
    ]);

    state.years = Array.from(new Set(raw.map(d => d.year))).sort((a, b) => a - b);
    state.data = enrichData(raw);
    state.distributionData = distributionRaw.filter(
      d => Number.isFinite(d.year) && Number.isFinite(d.wage) && Number.isFinite(d.density),
    );
    state.yearIndex = state.years.length - 1;
    state.selectedOccupation = getCurrentData()[0]?.occupation ?? null;

    els.yearSlider.min = 0;
    els.yearSlider.max = state.years.length - 1;
    els.yearSlider.value = state.yearIndex;

    populateOccupationOptions();
    bindEvents();
    renderAll();
  } catch (error) {
    showLoadError(error);
  }
}

function enrichData(raw) {
  const rowsByOccupation = d3.group(raw, d => d.occupation);
  const reliableOccupations = new Set(
    Array.from(rowsByOccupation, ([occupation, rows]) => {
      const rowsByYear = new Map(rows.map(d => [d.year, d]));
      const isReliable = state.years.every(year => {
        const row = rowsByYear.get(year);
        return (
          row &&
          row.maleSampleCount >= MIN_SEX_SAMPLE_COUNT &&
          row.femaleSampleCount >= MIN_SEX_SAMPLE_COUNT
        );
      });
      return isReliable ? occupation : null;
    }).filter(Boolean),
  );
  const reliableRows = raw.filter(d => reliableOccupations.has(d.occupation));

  const yearlyTotals = d3.rollup(
    raw,
    values => d3.sum(values, d => d.malePopulation + d.femalePopulation),
    d => d.year,
  );

  const baseByOccupation = new Map();
  reliableRows.filter(d => d.year === 1981).forEach(d => {
    const totalPopulation = d.malePopulation + d.femalePopulation;
    const totalShare = (totalPopulation / yearlyTotals.get(d.year)) * 100;
    const payGap = calculatePayGap(d);
    baseByOccupation.set(d.occupation, { totalShare, payGap });
  });

  const enriched = reliableRows
    .map(d => {
      const totalPopulation = d.malePopulation + d.femalePopulation;
      const totalShare = (totalPopulation / yearlyTotals.get(d.year)) * 100;
      const payGap = calculatePayGap(d);
      const base = baseByOccupation.get(d.occupation) ?? { totalShare, payGap };

      return {
        ...d,
        totalPopulation,
        totalShare,
        payGap,
        absGap: Math.abs(payGap),
        overallWage: weightedMean(d),
        shareChange: totalShare - base.totalShare,
        payGapChange: payGap - base.payGap,
      };
    })
    .filter(d => Number.isFinite(d.payGap) && Number.isFinite(d.totalShare));

  state.years.forEach(year => {
    const rows = enriched.filter(d => d.year === year);
    rows.sort((a, b) => d3.descending(a.totalShare, b.totalShare)).forEach((d, index) => {
      d.rankByShare = index + 1;
    });
    rows.sort((a, b) => d3.descending(a.payGap, b.payGap)).forEach((d, index) => {
      d.rankByGap = index + 1;
    });
    rows.sort((a, b) => d3.descending(a.absGap, b.absGap)).forEach((d, index) => {
      d.rankByAbsGap = index + 1;
    });
    rows.sort((a, b) => d3.ascending(a.absGap, b.absGap)).forEach((d, index) => {
      d.rankByEquality = index + 1;
    });
  });

  return enriched;
}

function calculatePayGap(d) {
  if (!d.maleWage || !d.femaleWage) return NaN;
  return (1 - d.femaleWage / d.maleWage) * 100;
}

function weightedMean(d) {
  const total = d.malePopulation + d.femalePopulation;
  if (!total) return NaN;
  return (d.maleWage * d.malePopulation + d.femaleWage * d.femalePopulation) / total;
}

function populateOccupationOptions() {
  const occupations = Array.from(new Set(state.data.map(d => d.occupation))).sort(d3.ascending);
  els.occupationOptions.innerHTML = occupations
    .map(occupation => `<option value="${escapeHtml(occupation)}"></option>`)
    .join("");
}

function bindEvents() {
  els.yearSlider.addEventListener("input", event => {
    setYearIndex(+event.target.value, true);
  });

  els.playButton.addEventListener("click", togglePlayback);

  document.querySelectorAll(".filter-button").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter-button").forEach(d => d.classList.remove("active"));
      button.classList.add("active");
      state.filter = button.dataset.filter;
      renderBubbleChart();
    });
  });

  els.search.addEventListener("input", event => {
    const value = event.target.value.trim();
    state.search = value.toLowerCase();
    const exactMatch = state.data.find(d => d.occupation.toLowerCase() === state.search);
    if (exactMatch) {
      state.selectedOccupation = exactMatch.occupation;
    }
    renderBubbleChart();
    renderDetail();
  });

  els.zoomIn?.addEventListener("click", () => {
    state.zoomSelection?.transition().duration(220).call(state.zoomBehavior.scaleBy, 1.45);
  });

  els.zoomOut?.addEventListener("click", () => {
    state.zoomSelection?.transition().duration(220).call(state.zoomBehavior.scaleBy, 1 / 1.45);
  });

  els.resetZoom?.addEventListener("click", () => {
    state.zoomSelection?.transition().duration(260).call(state.zoomBehavior.transform, d3.zoomIdentity);
  });

  els.howToUseButton?.addEventListener("click", openHowToUse);
  els.howToUseClose?.addEventListener("click", closeHowToUse);
  els.howToUseModal?.addEventListener("click", event => {
    if (event.target.matches("[data-close-how-to]")) {
      closeHowToUse();
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && els.howToUseModal?.classList.contains("is-open")) {
      closeHowToUse();
    }
  });

  window.addEventListener("resize", debounce(renderAll, 180));
}

function openHowToUse() {
  els.howToUseModal?.classList.add("is-open");
  els.howToUseModal?.setAttribute("aria-hidden", "false");
  els.howToUseClose?.focus();
}

function closeHowToUse() {
  els.howToUseModal?.classList.remove("is-open");
  els.howToUseModal?.setAttribute("aria-hidden", "true");
  els.howToUseButton?.focus();
}

function renderAll() {
  const year = getYear();
  els.yearLabel.textContent = year;
  els.yearSlider.value = state.yearIndex;

  renderBubbleChart();
  renderDetail();
}

function setYearIndex(nextIndex, animate = false) {
  if (nextIndex === state.yearIndex) return;

  state.previousPositions = new Map(
    getCurrentData().map(d => [
      d.occupation,
      {
        payGap: d.payGap,
        totalShare: d.totalShare,
      },
    ]),
  );
  state.yearIndex = nextIndex;
  state.animateYearChange = animate;
  renderAll();
  state.animateYearChange = false;
  state.previousPositions = null;
}

function getYear() {
  return state.years[state.yearIndex];
}

function getCurrentData() {
  return state.data
    .filter(d => d.year === getYear())
    .sort((a, b) => d3.descending(a.totalPopulation, b.totalPopulation));
}

function getSelectedDatum() {
  const current = getCurrentData();
  return current.find(d => d.occupation === state.selectedOccupation) ?? current[0];
}

function getFilteredData() {
  const current = getCurrentData();
  const searched = state.search
    ? current.filter(d => d.occupation.toLowerCase().includes(state.search))
    : current;

  if (state.filter === "largest-gap") {
    return searched.filter(d => d.rankByAbsGap <= 25);
  }

  if (state.filter === "closest") {
    return searched.filter(d => d.rankByEquality <= 25);
  }

  return searched;
}

function averageGapLabelPosition(gapX, innerWidth) {
  const anchor = gapX > innerWidth * 0.62 ? "end" : "start";
  const xPos = anchor === "end" ? Math.min(gapX + 8, innerWidth - 8) : Math.max(gapX + 8, 8);
  return { xPos, anchor };
}

function getChartDimensions(container) {
  const chartCard = container.closest(".chart-card");
  const measureNode = chartCard ?? container.parentElement ?? container;
  const styles = window.getComputedStyle(measureNode);
  const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  const paddingY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
  const width = Math.max(0, Math.floor(measureNode.clientWidth - paddingX));
  const availableHeight = container.clientHeight;
  const height = Math.max(560, availableHeight || Math.min(940, width * 0.76));

  return { width, height };
}

function renderBubbleChart() {
  const container = els.bubbleChart.node();
  const { width, height } = getChartDimensions(container);
  const margin = { top: 26, right: 28, bottom: 64, left: 74 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const current = getCurrentData();
  const visible = getFilteredData();
  const visibleKeys = new Set(visible.map(d => d.occupation));
  const averageGap = d3.mean(visible, d => d.payGap);
  const hasAverageGap = Number.isFinite(averageGap);
  const selected = getSelectedDatum();
  const lockedOccupation = state.lockedOccupation;
  const lockedHistory = lockedOccupation
    ? state.data
        .filter(d => d.occupation === lockedOccupation)
        .sort((a, b) => d3.ascending(a.year, b.year))
    : [];
  const previousPositions = state.previousPositions;
  const shouldAnimate = state.animateYearChange && previousPositions instanceof Map;

  function positionValue(d, field, usePrevious) {
    if (usePrevious && previousPositions instanceof Map) {
      const prev = previousPositions.get(d.occupation);
      const value = prev?.[field];
      if (Number.isFinite(value)) return value;
    }
    return d[field];
  }

  els.bubbleChart.selectAll("*").remove();

  if (!width || !current.length) return;

  const svg = els.bubbleChart
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("role", "img")
    .attr("aria-label", "Interactive bubble chart of detailed occupation gender pay gaps");

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const clipId = "all-occupations-plot-clip";

  svg
    .append("defs")
    .append("clipPath")
    .attr("id", clipId)
    .append("rect")
    .attr("width", innerWidth)
    .attr("height", innerHeight);

  const xTickValues = [-100, -50, -25, 0, 25, 50, 100];
  const x = d3
    .scaleSymlog()
    .constant(12)
    .domain([-130, 130])
    .clamp(true)
    .range([0, innerWidth]);

  const yMax = Math.max(24, d3.max(state.data, d => d.totalShare) ?? 24);
  const yTickValues = [0, 0.5, 1, 2, 5, 10, 15, 20, yMax];
  const y = d3
    .scaleSymlog()
    .constant(0.8)
    .domain([0, yMax])
    .clamp(true)
    .range([innerHeight, 0]);

  const radius = d3
    .scaleSqrt()
    .domain(d3.extent(state.data, d => d.totalPopulation))
    .range([5, 31]);

  const colour = d => (d.shareChange >= 0 ? "var(--green)" : "var(--red)");

  const gridX = g
    .append("g")
    .attr("class", "grid")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).tickValues(xTickValues).tickSize(-innerHeight).tickFormat(""))
    .call(g => g.selectAll("line").attr("opacity", 0.5));

  const gridY = g
    .append("g")
    .attr("class", "grid")
    .call(d3.axisLeft(y).tickValues(yTickValues).tickSize(-innerWidth).tickFormat(""))
    .call(g => g.selectAll("line").attr("opacity", 0.5));

  const medianShare = d3.median(current, d => d.totalShare);

  const equalityLine = g
    .append("line")
    .attr("class", "equality-line")
    .attr("x1", x(0))
    .attr("x2", x(0))
    .attr("y1", 0)
    .attr("y2", innerHeight);

  const averageGapLine = g
    .append("line")
    .attr("class", "average-gap-line")
    .attr("x1", hasAverageGap ? x(averageGap) : x(0))
    .attr("x2", hasAverageGap ? x(averageGap) : x(0))
    .attr("y1", 0)
    .attr("y2", innerHeight)
    .attr("display", hasAverageGap ? null : "none");

  const medianShareLine = g
    .append("line")
    .attr("class", "reference-line")
    .attr("x1", 0)
    .attr("x2", innerWidth)
    .attr("y1", y(medianShare))
    .attr("y2", y(medianShare));

  const medianShareLabel = g
    .append("text")
    .attr("class", "reference-label")
    .attr("x", innerWidth - 8)
    .attr("y", y(medianShare) - 8)
    .attr("text-anchor", "end")
    .text(`Median workforce share: ${formatPct(medianShare)}%`);

  g.append("text")
    .attr("class", "equality-label")
    .attr("x", x(0) + 8)
    .attr("y", 18)
    .text("wage equality");

  const averageGapLabelText = hasAverageGap
    ? `Mean displayed occupation gap: ${formatPct(averageGap)}%`
    : "";
  const initialGapLabel = hasAverageGap
    ? averageGapLabelPosition(x(averageGap), innerWidth)
    : { xPos: x(0), anchor: "start" };
  const averageGapLabel = g
    .append("text")
    .attr("class", "average-gap-label")
    .attr("x", initialGapLabel.xPos)
    .attr("y", 38)
    .attr("text-anchor", initialGapLabel.anchor)
    .attr("display", hasAverageGap ? null : "none")
    .text(averageGapLabelText);

  const xAxisGroup = g
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).tickValues(xTickValues).tickFormat(d => `${d}%`));

  const yAxisGroup = g
    .append("g")
    .attr("class", "axis")
    .call(d3.axisLeft(y).tickValues(yTickValues).tickFormat(d => `${d}%`));

  g.append("text")
    .attr("class", "year-watermark")
    .attr("x", innerWidth - 10)
    .attr("y", innerHeight - 18)
    .attr("text-anchor", "end")
    .text(getYear());

  g.append("text")
    .attr("class", "axis-label")
    .attr("x", innerWidth / 2)
    .attr("y", innerHeight + 48)
    .attr("text-anchor", "middle")
    .text("Gender pay gap (%) ");

  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerHeight / 2)
    .attr("y", -52)
    .attr("text-anchor", "middle")
    .text("Workforce share (%) - expanded scale");

  const plotLayer = g.append("g").attr("clip-path", `url(#${clipId})`);

  const trailLine = d3
    .line()
    .x(d => x(d.payGap))
    .y(d => y(d.totalShare))
    .curve(d3.curveCatmullRom.alpha(0.45));

  const lockedTrail = plotLayer.append("g").attr("class", "locked-trail");

  lockedTrail
    .append("path")
    .datum(lockedHistory)
    .attr("class", "locked-trail-line")
    .attr("d", lockedHistory.length > 1 ? trailLine : null)
    .attr("display", lockedHistory.length > 1 ? null : "none");

  lockedTrail
    .selectAll(".locked-trail-point")
    .data(lockedHistory, d => d.year)
    .join("circle")
    .attr("class", d => (d.year === getYear() ? "locked-trail-point is-current" : "locked-trail-point"))
    .attr("cx", d => x(d.payGap))
    .attr("cy", d => y(d.totalShare))
    .attr("r", d => (d.year === getYear() ? 5 : 3.5));

  lockedTrail
    .selectAll(".locked-trail-label")
    .data(lockedHistory, d => d.year)
    .join("text")
    .attr("class", d => (d.year === getYear() ? "locked-trail-label is-current" : "locked-trail-label"))
    .attr("x", d => x(d.payGap) + 7)
    .attr("y", d => y(d.totalShare) - 7)
    .text(d => d.year);

  const bubbles = plotLayer
    .selectAll(".bubble")
    .data(current, d => d.occupation)
    .join("circle")
    .attr("class", d => {
      const classes = ["bubble"];
      if (lockedOccupation && d.occupation !== lockedOccupation) classes.push("is-locked-muted");
      if (!visibleKeys.has(d.occupation) && d.occupation !== lockedOccupation) classes.push("is-muted");
      if (selected?.occupation === d.occupation) classes.push("is-selected");
      return classes.join(" ");
    })
    .attr("cx", d => x(positionValue(d, "payGap", shouldAnimate)))
    .attr("cy", d => y(positionValue(d, "totalShare", shouldAnimate)))
    .attr("r", d => radius(d.totalPopulation))
    .attr("fill", colour)
    .attr("opacity", d => bubbleOpacity(d, visibleKeys, lockedOccupation));

  bubbles
    .on("mouseenter", (event, d) => {
      if (!lockedOccupation) {
        bubbles.classed("is-neighbor-muted", other => other.occupation !== d.occupation);
      }
      d3.select(event.currentTarget).raise().classed("is-hovered", true);
      showTooltip(event, d);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", event => {
      bubbles.classed("is-neighbor-muted", false);
      d3.select(event.currentTarget).classed("is-hovered", false);
      hideTooltip();
    })
    .on("click", (_, d) => {
      state.selectedOccupation = d.occupation;
      state.lockedOccupation = state.lockedOccupation === d.occupation ? null : d.occupation;
      renderAll();
    });

  bubbles.append("title").text(d => `${d.occupation}: ${formatPct(d.payGap)}% pay gap`);

  if (!shouldAnimate) {
    bubbles.transition().duration(420).attr("opacity", d => bubbleOpacity(d, visibleKeys, lockedOccupation));
  }

  const labelData = [];

  const labels = plotLayer
    .selectAll(".bubble-label")
    .data(labelData, d => d.occupation)
    .join("text")
    .attr("class", d =>
      selected?.occupation === d.occupation ? "bubble-label is-selected-label" : "bubble-label",
    )
    .attr("x", d => x(d.payGap) + radius(d.totalPopulation) + 5)
    .attr("y", d => y(d.totalShare) + 4)
    .attr("fill", "var(--ink)")
    .attr("font-size", 11)
    .attr("font-weight", 800)
    .text(d => shortenOccupation(d.occupation));

  let animationPending = shouldAnimate;

  const zoom = d3
    .zoom()
    .scaleExtent([1, 10])
    .extent([
      [margin.left, margin.top],
      [margin.left + innerWidth, margin.top + innerHeight],
    ])
    .translateExtent([
      [margin.left, margin.top],
      [margin.left + innerWidth, margin.top + innerHeight],
    ])
    .filter(event => !event.ctrlKey || event.type === "wheel")
    .on("zoom", event => {
      state.zoomTransform = event.transform;
      applyZoom(event.transform);
    });

  state.zoomBehavior = zoom;
  state.zoomSelection = svg;
  svg.call(zoom).call(zoom.transform, state.zoomTransform);
  if (shouldAnimate) {
    animateYearTransition(state.zoomTransform);
  }

  function applyZoom(transform) {
    const zx = transform.rescaleX(x);
    const zy = transform.rescaleY(y);
    const radiusMultiplier = Math.min(Math.sqrt(transform.k), 2.6);

    xAxisGroup.call(d3.axisBottom(zx).tickValues(xTickValues).tickFormat(d => `${d}%`));
    yAxisGroup.call(d3.axisLeft(zy).tickValues(yTickValues).tickFormat(d => `${d}%`));

    gridX
      .call(d3.axisBottom(zx).tickValues(xTickValues).tickSize(-innerHeight).tickFormat(""))
      .call(g => g.selectAll("line").attr("opacity", 0.5));
    gridY
      .call(d3.axisLeft(zy).tickValues(yTickValues).tickSize(-innerWidth).tickFormat(""))
      .call(g => g.selectAll("line").attr("opacity", 0.5));

    equalityLine.attr("x1", zx(0)).attr("x2", zx(0));
    if (hasAverageGap) {
      const gapLabel = averageGapLabelPosition(zx(averageGap), innerWidth);
      averageGapLine.attr("x1", zx(averageGap)).attr("x2", zx(averageGap));
      averageGapLabel.attr("x", gapLabel.xPos).attr("text-anchor", gapLabel.anchor);
    }
    medianShareLine.attr("y1", zy(medianShare)).attr("y2", zy(medianShare));
    medianShareLabel.attr("y", zy(medianShare) - 8);

    lockedTrail.select(".locked-trail-line").attr(
      "d",
      lockedHistory.length > 1
        ? d3
            .line()
            .x(d => zx(d.payGap))
            .y(d => zy(d.totalShare))
            .curve(d3.curveCatmullRom.alpha(0.45))(lockedHistory)
        : null,
    );

    lockedTrail
      .selectAll(".locked-trail-point")
      .attr("cx", d => zx(d.payGap))
      .attr("cy", d => zy(d.totalShare));

    lockedTrail
      .selectAll(".locked-trail-label")
      .attr("x", d => zx(d.payGap) + 7)
      .attr("y", d => zy(d.totalShare) - 7);

    bubbles
      .attr("cx", d => zx(positionValue(d, "payGap", animationPending)))
      .attr("cy", d => zy(positionValue(d, "totalShare", animationPending)))
      .attr("r", d => Math.min(radius(d.totalPopulation) * radiusMultiplier, 64));

    labels
      .attr(
        "x",
        d =>
          zx(positionValue(d, "payGap", animationPending)) +
          Math.min(radius(d.totalPopulation) * radiusMultiplier, 64) +
          5,
      )
      .attr("y", d => zy(positionValue(d, "totalShare", animationPending)) + 4);

  }

  function animateYearTransition(transform) {
    animationPending = false;
    const zx = transform.rescaleX(x);
    const zy = transform.rescaleY(y);
    const radiusMultiplier = Math.min(Math.sqrt(transform.k), 2.6);

    bubbles
      .transition()
      .duration(850)
      .ease(d3.easeCubicInOut)
      .attr("cx", d => zx(d.payGap))
      .attr("cy", d => zy(d.totalShare))
      .attr("r", d => Math.min(radius(d.totalPopulation) * radiusMultiplier, 64))
      .attr("opacity", d => bubbleOpacity(d, visibleKeys, lockedOccupation));

    labels
      .transition()
      .duration(850)
      .ease(d3.easeCubicInOut)
      .attr("x", d => zx(d.payGap) + Math.min(radius(d.totalPopulation) * radiusMultiplier, 64) + 5)
      .attr("y", d => zy(d.totalShare) + 4);

  }
}

function bubbleOpacity(d, visibleKeys, lockedOccupation) {
  if (lockedOccupation) {
    if (d.occupation === lockedOccupation) return 0.96;
    return visibleKeys.has(d.occupation) ? 0.14 : 0.04;
  }
  return visibleKeys.has(d.occupation) ? 0.72 : 0.08;
}

function formatDetailSummary(selected) {
  const absGap = Math.abs(selected.payGap);
  const absChange = Math.abs(selected.payGapChange);

  let currentSentence;
  if (absGap < 0.05) {
    currentSentence = `In ${selected.year}, average hourly wages for men and women in this occupation were nearly equal.`;
  } else if (selected.payGap > 0) {
    currentSentence = `In ${selected.year}, women in this occupation earned ${formatPct(absGap)}% less than men on average.`;
  } else {
    currentSentence = `In ${selected.year}, women in this occupation earned ${formatPct(absGap)}% more than men on average.`;
  }

  let changeSentence;
  if (absChange < 0.05) {
    changeSentence = "Compared with 1981, the pay gap has changed very little.";
  } else if (selected.payGapChange < 0) {
    changeSentence = `Compared with 1981, the gap has narrowed by ${formatPct(absChange)} percentage points.`;
  } else {
    changeSentence = `Compared with 1981, the gap has widened by ${formatPct(absChange)} percentage points.`;
  }

  return `${currentSentence} ${changeSentence}`;
}

function renderDetail() {
  const selected = getSelectedDatum();
  if (!selected) return;

  state.selectedOccupation = selected.occupation;

  els.detailTitle.textContent = selected.occupation;
  els.detailSummary.textContent = formatDetailSummary(selected);
  els.metricGap.textContent = `${formatPct(selected.payGap)}%`;
  els.metricShare.textContent = `${formatPct(selected.totalShare)}%`;
  els.metricMale.textContent = formatMoney(selected.maleWage);
  els.metricFemale.textContent = formatMoney(selected.femaleWage);

  renderDistribution(selected);
}

function renderDistribution(selected) {
  const container = els.distributionChart.node();
  const width = container.clientWidth;
  const height = 190;
  const margin = { top: 24, right: 18, bottom: 34, left: 44 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const distribution = state.distributionData.filter(
    d => d.year === selected.year && d.occupation === selected.occupation,
  );
  const male = distribution.filter(d => d.sex === "male").sort((a, b) => d3.ascending(a.wage, b.wage));
  const female = distribution
    .filter(d => d.sex === "female")
    .sort((a, b) => d3.ascending(a.wage, b.wage));

  els.distributionChart.selectAll("*").remove();
  if (!width || !distribution.length) {
    els.distributionChart.html('<p class="chart-empty">No distribution data available.</p>');
    return;
  }

  const svg = els.distributionChart.append("svg").attr("viewBox", `0 0 ${width} ${height}`);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain([0, 100]).range([0, innerWidth]);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(distribution, d => d.density) ?? 0])
    .nice()
    .range([innerHeight, 0]);

  g.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d => `$${d}`));

  g.append("g")
    .attr("class", "axis")
    .call(d3.axisLeft(y).ticks(3).tickFormat(""));

  const area = d3
    .area()
    .x(d => x(d.wage))
    .y0(innerHeight)
    .y1(d => y(d.density))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(male)
    .attr("class", "distribution-area")
    .attr("fill", "var(--blue)")
    .attr("d", area);

  g.append("path")
    .datum(female)
    .attr("class", "distribution-area")
    .attr("fill", "var(--orange)")
    .attr("d", area);

  g.append("line")
    .attr("class", "distribution-mean male")
    .attr("x1", x(Math.min(selected.maleWage, 100)))
    .attr("x2", x(Math.min(selected.maleWage, 100)))
    .attr("y1", 0)
    .attr("y2", innerHeight);

  g.append("line")
    .attr("class", "distribution-mean female")
    .attr("x1", x(Math.min(selected.femaleWage, 100)))
    .attr("x2", x(Math.min(selected.femaleWage, 100)))
    .attr("y1", 0)
    .attr("y2", innerHeight);

  const legend = g.append("g").attr("class", "distribution-legend").attr("transform", "translate(0,-8)");

  legend
    .append("text")
    .attr("x", 0)
    .attr("y", 0)
    .attr("fill", "var(--blue)")
    .text("Male");

  legend
    .append("text")
    .attr("x", 48)
    .attr("y", 0)
    .attr("fill", "var(--orange)")
    .text("Female");
}

function showTooltip(event, d) {
  els.tooltip
    .style("opacity", 1)
    .html(
      `<strong>${d.occupation}</strong>
       <span>Year: ${d.year}</span>
       <span>Male wage: ${formatMoney(d.maleWage)}</span>
       <span>Female wage: ${formatMoney(d.femaleWage)}</span>
       <span>Pay gap: ${formatPct(d.payGap)}%</span>
       <span>Population: ${formatPop(d.totalPopulation)}</span>`,
    );
  moveTooltip(event);
}

function moveTooltip(event) {
  els.tooltip.style("left", `${event.clientX}px`).style("top", `${event.clientY}px`);
}

function hideTooltip() {
  els.tooltip.style("opacity", 0);
}

function togglePlayback() {
  if (state.timer) {
    stopPlayback();
    return;
  }

  els.playButton.classList.add("is-playing");
  els.playButton.textContent = "Pause";
  state.timer = window.setInterval(() => {
    setYearIndex((state.yearIndex + 1) % state.years.length, true);
  }, 1300);
}

function stopPlayback() {
  window.clearInterval(state.timer);
  state.timer = null;
  els.playButton.classList.remove("is-playing");
  els.playButton.textContent = "Play timeline";
}

function showLoadError(error) {
  console.error(error);
  els.bubbleChart.html(`
    <div class="load-error">
      <h2>Data could not be loaded</h2>
      <p>
        Start a local server from the workspace root and open
        <code>/A3-interactive/occupation-paygap-explorer/all-occupations.html</code>.
      </p>
    </div>
  `);
}

function shortenOccupation(occupation) {
  return occupation
    .replace(/\s*\(\d+\)/g, "")
    .replace(/\s*\(n\.e\.c\.\)/gi, "")
    .replace(", except private household", "")
    .slice(0, 28);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function debounce(fn, wait) {
  let timeout;
  return (...args) => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => fn(...args), wait);
  };
}
