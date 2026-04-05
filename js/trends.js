/* Swim Coach — Trends page renderer */

const Trends = {
  async init() {
    await App.load();
    this.render();
  },

  render() {
    this.renderVolumeHistory();
    this.renderPaceTrend();
    this.renderHeatmap();
    this.renderYearsSummary();
    this.renderPaceByDistance();
  },

  // ── 52-week volume bar chart ─────────────────────────────────────────────
  renderVolumeHistory() {
    const ctx = document.getElementById('volume-history-chart');
    if (!ctx) return;

    const weeks = [];
    const now = new Date();
    for (let i = 51; i >= 0; i--) {
      const weekEnd = new Date(now);
      weekEnd.setDate(now.getDate() - (i * 7));
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekEnd.getDate() - 6);

      const startStr = weekStart.toISOString().slice(0, 10);
      const endStr   = weekEnd.toISOString().slice(0, 10);
      const swims    = App.swimsBetween(startStr, endStr);
      const totalYd  = swims.reduce((s, sw) => s + App.toYards(sw.distance_m), 0);
      const isCurrent = i === 0;

      weeks.push({
        label: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        yards: Math.round(totalYd),
        swims: swims.length,
        isCurrent,
      });
    }

    const weeklyTarget = 7000;
    const colors = weeks.map(w =>
      w.isCurrent ? 'rgba(0,212,255,0.9)'
        : w.yards >= weeklyTarget ? 'rgba(52,211,153,0.65)'
        : w.yards > 0 ? 'rgba(0,212,255,0.4)'
        : 'rgba(255,255,255,0.05)'
    );

    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: weeks.map(w => w.label),
        datasets: [{
          data: weeks.map(w => w.yards),
          backgroundColor: colors,
          borderRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => `Week of ${items[0].label}`,
              label: (item) => {
                const w = weeks[item.dataIndex];
                return [`${item.parsed.y.toLocaleString()} yd`, `${w.swims} swim${w.swims !== 1 ? 's' : ''}`];
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#444',
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8,
              font: { size: 9 },
            },
            grid: { display: false },
          },
          y: {
            ticks: {
              color: '#555',
              font: { size: 9 },
              callback: v => `${(v / 1000).toFixed(0)}k`,
            },
            grid: { color: '#1a1a1a' },
          },
        },
      },
    });
  },

  // ── Monthly pace trend (3 years) ─────────────────────────────────────────
  renderPaceTrend() {
    const ctx = document.getElementById('pace-trend-chart');
    if (!ctx) return;

    const now = new Date();
    const NUM_MONTHS = 36;
    const labels = [];
    const paces  = [];
    const counts = [];

    for (let i = NUM_MONTHS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7);
      const monthSwims = App.data.swims.filter(s => s.date.startsWith(key) && s.pace_per_100m);

      labels.push(d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
      if (monthSwims.length >= 2) {
        const sorted = monthSwims.map(sw => App.paceYd(sw.pace_per_100m)).sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        paces.push(+median.toFixed(4));
        counts.push(monthSwims.length);
      } else {
        paces.push(null);
        counts.push(0);
      }
    }

    // 3-month rolling average
    const rolling = paces.map((_, i) => {
      const window = paces.slice(Math.max(0, i - 2), i + 1).filter(v => v !== null);
      return window.length ? window.reduce((a, b) => a + b, 0) / window.length : null;
    });

    new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Monthly median',
            data: paces,
            borderColor: 'rgba(0,212,255,0.35)',
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.2,
            pointRadius: 2,
            pointHoverRadius: 4,
            borderWidth: 1.5,
            spanGaps: true,
          },
          {
            label: '3-mo rolling',
            data: rolling,
            borderColor: '#00d4ff',
            backgroundColor: 'rgba(0,212,255,0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 5,
            borderWidth: 2.5,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            labels: {
              color: '#555',
              font: { size: 10 },
              boxWidth: 12,
              padding: 12,
            },
          },
          tooltip: {
            callbacks: {
              label: (item) => {
                const v = item.parsed.y;
                if (v === null) return null;
                const mins = Math.floor(v);
                const secs = Math.round((v - mins) * 60);
                const n = counts[item.dataIndex];
                return item.datasetIndex === 0
                  ? `${mins}:${secs.toString().padStart(2, '0')} /100yd median (${n} swims)`
                  : `${mins}:${secs.toString().padStart(2, '0')} 3-mo rolling median`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#555',
              maxRotation: 45,
              autoSkip: true,
              maxTicksLimit: 10,
              font: { size: 9 },
            },
            grid: { color: '#1a1a1a' },
          },
          y: {
            reverse: true,
            ticks: {
              color: '#555',
              font: { size: 9 },
              callback: (v) => {
                const mins = Math.floor(v);
                const secs = Math.round((v - mins) * 60);
                return `${mins}:${secs.toString().padStart(2, '0')}`;
              },
            },
            grid: { color: '#1a1a1a' },
          },
        },
      },
    });
  },

  // ── Time-of-Day × Weekday heatmap ─────────────────────────────────────────
  renderHeatmap() {
    const el = document.getElementById('heatmap-container');

    const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    // Day-of-week: JS getDay() 0=Sun; we want Mon=0
    const jsDayToIdx = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };

    // Hour buckets: 5am–10pm
    const HOUR_START = 5;
    const HOUR_END   = 22;
    const HOURS      = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);

    // Build grid: [hour][day] = { count, totalPace }
    const grid = {};
    for (const h of HOURS) {
      grid[h] = {};
      for (let d = 0; d < 7; d++) grid[h][d] = { count: 0, totalPace: 0 };
    }

    for (const s of App.data.swims) {
      const dt = new Date(s.datetime);
      const hour = dt.getHours();
      const dayIdx = jsDayToIdx[dt.getDay()];
      if (hour >= HOUR_START && hour <= HOUR_END) {
        grid[hour][dayIdx].count++;
        if (s.pace_per_100m) grid[hour][dayIdx].totalPace += App.paceYd(s.pace_per_100m);
      }
    }

    // Max count for color scaling
    let maxCount = 1;
    for (const h of HOURS) {
      for (let d = 0; d < 7; d++) {
        if (grid[h][d].count > maxCount) maxCount = grid[h][d].count;
      }
    }

    const cellColor = (count) => {
      if (!count) return 'var(--bg-card)';
      const intensity = count / maxCount;
      if (intensity > 0.75) return 'rgba(0,212,255,0.85)';
      if (intensity > 0.50) return 'rgba(0,212,255,0.55)';
      if (intensity > 0.25) return 'rgba(0,212,255,0.30)';
      return 'rgba(0,212,255,0.12)';
    };

    const fmtHour = h => {
      if (h === 0)  return '12am';
      if (h === 12) return '12pm';
      return h < 12 ? `${h}am` : `${h - 12}pm`;
    };

    let html = `<div class="heatmap-wrap"><table class="heatmap">`;
    html += `<thead><tr><th></th>${DAYS.map(d => `<th>${d}</th>`).join('')}</tr></thead><tbody>`;

    for (const h of HOURS) {
      html += `<tr><th class="row-label">${fmtHour(h)}</th>`;
      for (let d = 0; d < 7; d++) {
        const cell = grid[h][d];
        const bg = cellColor(cell.count);
        const avgPace = cell.count ? (cell.totalPace / cell.count) : 0;
        const paceStr = avgPace ? (() => {
          const mins = Math.floor(avgPace);
          const secs = Math.round((avgPace - mins) * 60);
          return `${mins}:${secs.toString().padStart(2,'0')}`;
        })() : '';
        const title = cell.count
          ? `${cell.count} swim${cell.count > 1 ? 's' : ''}${paceStr ? ` · avg ${paceStr}/100yd` : ''}`
          : '';
        html += `<td class="${cell.count ? '' : 'empty'}" style="background:${bg}" title="${title}">`;
        html += cell.count ? cell.count : '';
        html += `</td>`;
      }
      html += `</tr>`;
    }

    html += `</tbody></table></div>`;
    html += `<div class="pace-legend">
      <div class="pace-legend-item"><div class="pace-legend-swatch" style="background:rgba(0,212,255,0.85)"></div> High</div>
      <div class="pace-legend-item"><div class="pace-legend-swatch" style="background:rgba(0,212,255,0.55)"></div> Med-high</div>
      <div class="pace-legend-item"><div class="pace-legend-swatch" style="background:rgba(0,212,255,0.30)"></div> Medium</div>
      <div class="pace-legend-item"><div class="pace-legend-swatch" style="background:rgba(0,212,255,0.12)"></div> Low</div>
      <div class="pace-legend-item"><div class="pace-legend-swatch" style="background:var(--bg-card)"></div> None</div>
    </div>
    <div style="margin-top:6px;font-size:0.7rem;color:var(--text-dim)">Hover cells for pace. Numbers = swim count.</div>`;

    el.innerHTML = html;
  },

  // ── All-years summary table ───────────────────────────────────────────────
  renderYearsSummary() {
    const el = document.getElementById('years-summary');

    const years = [];
    const allYears = [...new Set(App.data.swims.map(s => s.year))].sort();

    // Best pace year (excluding current partial year? no, include all)
    let bestPace = Infinity;
    const yearData = {};
    for (const y of allYears) {
      const swims = App.swimsForYear(y).filter(s => s.distance_m > 0);
      const totalM = swims.reduce((s, sw) => s + sw.distance_m, 0);
      const pacedSwims = swims.filter(s => s.pace_per_100m);
      const avgPace = pacedSwims.length
        ? pacedSwims.reduce((s, sw) => s + App.paceYd(sw.pace_per_100m), 0) / pacedSwims.length
        : null;
      const avgDist = swims.length ? totalM / swims.length : 0;
      yearData[y] = { swims: swims.length, totalM, avgPace, avgDist };
      if (avgPace && avgPace < bestPace) bestPace = avgPace;
    }

    const maxYd = Math.max(...Object.values(yearData).map(d => App.toYards(d.totalM)));
    const currentYear = new Date().getFullYear();

    const rows = allYears.reverse().map(y => {
      const d = yearData[y];
      const yd = Math.round(App.toYards(d.totalM));
      const barW = Math.round((yd / maxYd) * 60);
      const paceStr = d.avgPace ? (() => {
        const mins = Math.floor(d.avgPace);
        const secs = Math.round((d.avgPace - mins) * 60);
        return `${mins}:${secs.toString().padStart(2,'0')}`;
      })() : '--';
      const isBestPace = d.avgPace && Math.abs(d.avgPace - bestPace) < 0.001;
      const isCurrent = y === currentYear;

      return `<tr>
        <td class="${isCurrent ? 'highlight' : ''}">${y}${isCurrent ? ' ·' : ''}</td>
        <td>${d.swims}</td>
        <td>${yd.toLocaleString()}<span class="yr-bar" style="width:${barW}px"></span></td>
        <td class="${isBestPace ? 'best' : ''}">${paceStr}${isBestPace ? ' ↑' : ''}</td>
        <td>${Math.round(App.toYards(d.avgDist)).toLocaleString()}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div class="card">
        <table class="years-table">
          <thead>
            <tr>
              <th>Year</th>
              <th>Swims</th>
              <th>Total yd</th>
              <th>Avg pace</th>
              <th>Avg session</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  },

  // ── Pace by session distance bucket ──────────────────────────────────────
  renderPaceByDistance() {
    const el = document.getElementById('pace-by-distance');

    const buckets = [
      { label: '<1,000 yd',   min: 0,    max: 914  },
      { label: '1–1.5k yd',  min: 914,  max: 1372 },
      { label: '1.5–2k yd',  min: 1372, max: 1829 },
      { label: '2–2.5k yd',  min: 1829, max: 2286 },
      { label: '2.5–3k yd',  min: 2286, max: 2743 },
      { label: '3k+ yd',     min: 2743, max: Infinity },
    ];

    const swims = App.data.swims.filter(s => s.distance_m > 0 && s.pace_per_100m);

    const cards = buckets.map(b => {
      const group = swims.filter(s => s.distance_m >= b.min && s.distance_m < b.max);
      if (!group.length) return null;
      const avgPace = group.reduce((s, sw) => s + App.paceYd(sw.pace_per_100m), 0) / group.length;
      const mins = Math.floor(avgPace);
      const secs = Math.round((avgPace - mins) * 60);
      return `
        <div class="correlation-card">
          <span class="correlation-label">${b.label} <span style="color:var(--text-dim);font-size:0.75rem">(${group.length})</span></span>
          <span class="correlation-effect" style="color:var(--accent)">${mins}:${secs.toString().padStart(2,'0')}</span>
        </div>`;
    }).filter(Boolean).join('');

    el.innerHTML = cards +
      `<div style="margin-top:6px;font-size:0.7rem;color:var(--text-dim)">Longer sessions → faster pace. Distances in yards.</div>`;
  },
};

document.addEventListener('DOMContentLoaded', () => Trends.init());
