/* Swim Coach — Dashboard renderer */

const Dashboard = {
  async init() {
    await App.load();
    this.render();
  },

  render() {
    this.renderReadiness();
    this.renderNudge();
    this.renderLastSwim();
    this.renderStreaks();
    this.renderAnnualGoal();
    this.renderThisWeek();
    this.renderRecentSwims();
    this.renderYearComparison();
    this.renderPaceChart();
    this.renderVolumeChart();
    this.renderCorrelations();
  },

  // --- Section: Today's Readiness ---
  renderReadiness() {
    const el = document.getElementById('readiness');
    const today = App.today();
    const yesterday = App.daysAgo(1);
    // Use yesterday's health data (recovery is measured overnight)
    const h = App.healthOn(yesterday) || App.healthOn(today);

    if (!h) {
      el.innerHTML = '<div class="card"><p style="color:var(--text-dim)">No recovery data available</p></div>';
      return;
    }

    const hrvClass = h.hrv_ms >= 50 ? 'green' : h.hrv_ms >= 35 ? 'accent' : 'orange';
    const rhrClass = h.resting_hr <= 55 ? 'green' : h.resting_hr <= 62 ? 'accent' : 'orange';
    const sleepClass = h.sleep_hrs ? (h.sleep_hrs >= 7 ? 'green' : h.sleep_hrs >= 6 ? 'accent' : 'orange') : 'neutral';

    el.innerHTML = `
      <div class="card-row">
        <div class="card stat">
          <div class="stat-value ${hrvClass}">${h.hrv_ms ? Math.round(h.hrv_ms) : '--'}</div>
          <div class="stat-label">HRV</div>
          <div class="stat-sub">ms</div>
        </div>
        <div class="card stat">
          <div class="stat-value ${rhrClass}">${h.resting_hr ? Math.round(h.resting_hr) : '--'}</div>
          <div class="stat-label">Resting HR</div>
          <div class="stat-sub">bpm</div>
        </div>
        <div class="card stat">
          <div class="stat-value ${sleepClass}">${h.sleep_hrs ? h.sleep_hrs.toFixed(1) : '--'}</div>
          <div class="stat-label">Sleep</div>
          <div class="stat-sub">hrs</div>
        </div>
      </div>
    `;
  },

  // --- Section: Coach Card (3 blocks: last swim · week · tip) ---
  renderNudge() {
    const el = document.getElementById('nudge');
    const today = App.today();
    const swims = App.data.swims;

    // ── Shared helpers ────────────────────────────────────────────────────────
    const fmtPaceShort = (p) => {
      if (!p) return '--';
      const mins = Math.floor(p); const secs = Math.round((p - mins) * 60);
      return `${mins}:${secs.toString().padStart(2,'0')}`;
    };
    const median = (arr) => {
      if (!arr.length) return null;
      const s = [...arr].sort((a,b)=>a-b); const m = Math.floor(s.length/2);
      return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
    };
    const medianPaceYd = median(swims.filter(s=>s.pace_per_100m).slice(-60).map(s=>App.paceYd(s.pace_per_100m)));

    // HRV baseline (90-day median)
    const recentHealth = App.data.health.filter(x => x.hrv_ms && x.date <= today).slice(-90);
    const hrvMedian = median(recentHealth.map(x => x.hrv_ms));

    // HRV → pace signal
    let hrvPaceSignal = null;
    const swimsWithHrv = swims.filter(s => s.pace_per_100m && App.healthOn(s.date)?.hrv_ms);
    if (swimsWithHrv.length >= 30 && hrvMedian) {
      const hiHrv = swimsWithHrv.filter(s => App.healthOn(s.date).hrv_ms >= hrvMedian * 1.15);
      const loHrv = swimsWithHrv.filter(s => App.healthOn(s.date).hrv_ms < hrvMedian * 0.85);
      if (hiHrv.length >= 10 && loHrv.length >= 10) {
        const hiMed = median(hiHrv.map(s=>App.paceYd(s.pace_per_100m)));
        const loMed = median(loHrv.map(s=>App.paceYd(s.pace_per_100m)));
        hrvPaceSignal = Math.round((loMed - hiMed) * 60);
      }
    }

    // AM vs PM pace split
    const amMed = median(swims.filter(s=>s.hour>=5&&s.hour<12&&s.pace_per_100m).map(s=>App.paceYd(s.pace_per_100m)));
    const pmMed = median(swims.filter(s=>s.hour>=14&&s.pace_per_100m).map(s=>App.paceYd(s.pace_per_100m)));
    const amPmDiffSec = amMed && pmMed ? Math.round((pmMed - amMed) * 60) : null;

    // ── BLOCK 1: Last swim ────────────────────────────────────────────────────
    const last = swims[swims.length - 1];
    let block1 = '';
    if (last) {
      const paceYd = last.pace_per_100m ? App.paceYd(last.pace_per_100m) : null;
      const diffSec = paceYd && medianPaceYd ? Math.round((paceYd - medianPaceYd) * 60) : null;
      const paceTag = diffSec !== null
        ? (diffSec < -2 ? ` <span class="ci-good">${Math.abs(diffSec)}s faster than median ↑</span>`
          : diffSec > 2  ? ` <span class="ci-warn">${diffSec}s slower than median ↓</span>`
          : ` <span class="ci-neutral">at median</span>`) : '';

      const distYd = Math.round(App.toYards(last.distance_m)).toLocaleString();
      block1 = `<div class="coach-label">Last swim</div>`;
      block1 += `<strong>${App.relativeDate(last.date)}</strong> · ${distYd}yd · ${fmtPaceShort(paceYd)}/100yd${paceTag}`;

      // HR efficiency vs swims at same pace
      if (last.avg_hr && paceYd) {
        const similar = swims.filter(s => s.avg_hr && s.pace_per_100m && Math.abs(App.paceYd(s.pace_per_100m) - paceYd) < 5/60);
        if (similar.length >= 5) {
          const hrMed = median(similar.map(s=>s.avg_hr));
          const hrDiff = Math.round(last.avg_hr - hrMed);
          block1 += hrDiff < -3
            ? `<br><span class="ci-good">HR ${Math.round(last.avg_hr)}bpm — ${Math.abs(hrDiff)}bpm below avg for this pace (efficient)</span>`
            : hrDiff > 3
            ? `<br><span class="ci-warn">HR ${Math.round(last.avg_hr)}bpm — ${hrDiff}bpm above avg for this pace (working harder)</span>`
            : `<br><span class="ci-neutral">HR ${Math.round(last.avg_hr)}bpm — typical for this pace</span>`;
        } else {
          block1 += `<br><span class="ci-neutral">HR ${Math.round(last.avg_hr)}bpm</span>`;
        }
      }

      // Recovery that day
      const swimH = App.healthOn(last.date);
      if (swimH?.hrv_ms && hrvMedian) {
        const hrvDiff = Math.round(swimH.hrv_ms - hrvMedian);
        const s = hrvDiff >= 0 ? '+' : '';
        block1 += `<br><span class="ci-neutral">HRV ${Math.round(swimH.hrv_ms)}ms (${s}${hrvDiff} vs baseline)`;
        if (hrvPaceSignal && Math.abs(hrvPaceSignal) >= 2) {
          block1 += ` · high-HRV days run ${Math.abs(hrvPaceSignal)}s faster for you`;
        }
        block1 += `</span>`;
      }
    } else {
      block1 = 'No swim data yet.';
    }

    // ── BLOCK 2: This week ────────────────────────────────────────────────────
    const now = new Date();
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - (now.getDay() + 6) % 7);
    const weekSwims = App.swimsBetween(startOfWeek.toISOString().slice(0,10), today);
    const weekYd    = Math.round(weekSwims.reduce((s,sw)=>s+App.toYards(sw.distance_m),0));
    const weekPaces = weekSwims.filter(s=>s.pace_per_100m).map(s=>App.paceYd(s.pace_per_100m));
    const weekPaceMed = median(weekPaces);

    // Same week last year
    const lyStart = new Date(startOfWeek); lyStart.setFullYear(lyStart.getFullYear()-1);
    const lyEnd   = new Date(now);         lyEnd.setFullYear(lyEnd.getFullYear()-1);
    const lySwims = App.swimsBetween(lyStart.toISOString().slice(0,10), lyEnd.toISOString().slice(0,10));
    const lyYd    = Math.round(lySwims.reduce((s,sw)=>s+App.toYards(sw.distance_m),0));
    const lyDiff  = lyYd > 0 ? Math.round(weekYd - lyYd) : null;
    const lyTag   = lyDiff !== null
      ? (lyDiff >= 0 ? ` <span class="ci-good">+${lyDiff.toLocaleString()}yd vs same week LY ↑</span>`
        : ` <span class="ci-warn">${lyDiff.toLocaleString()}yd vs same week LY ↓</span>`) : '';

    const dailyStreak  = App.calcDailyStreak();
    const weeklyStreak = App.calcWeeklyStreak();
    const streakStr = dailyStreak >= 2
      ? `<span class="ci-good">${dailyStreak}-day streak</span>`
      : `<span class="ci-neutral">${weeklyStreak}-week streak</span>`;

    // Pace trend this week vs last 4 weeks
    const fourWeeksAgo = new Date(now); fourWeeksAgo.setDate(now.getDate() - 28);
    const priorSwims = App.swimsBetween(fourWeeksAgo.toISOString().slice(0,10), startOfWeek.toISOString().slice(0,10));
    const priorMed   = median(priorSwims.filter(s=>s.pace_per_100m).map(s=>App.paceYd(s.pace_per_100m)));
    const weekTrend  = weekPaceMed && priorMed ? Math.round((weekPaceMed - priorMed) * 60) : null;
    const weekTrendTag = weekTrend !== null && Math.abs(weekTrend) >= 2
      ? (weekTrend < 0
        ? ` · <span class="ci-good">pace ${Math.abs(weekTrend)}s faster vs prior 4 weeks</span>`
        : ` · <span class="ci-warn">pace ${weekTrend}s slower vs prior 4 weeks</span>`)
      : (weekTrend !== null ? ' · <span class="ci-neutral">pace on par with prior 4 weeks</span>' : '');

    // Goal pace
    const yearSwims  = App.swimsThisYear();
    const totalYd    = yearSwims.reduce((s,sw)=>s+App.toYards(sw.distance_m),0);
    const dayOfYear  = Math.floor((now - new Date(now.getFullYear(),0,1))/86400000)+1;
    const goalDelta  = Math.round(totalYd - (App.ANNUAL_GOAL_YD/365)*dayOfYear);
    const goalTag    = goalDelta >= 0
      ? `<span class="ci-good">+${goalDelta.toLocaleString()}yd ahead of 365K pace</span>`
      : `<span class="ci-warn">${Math.abs(goalDelta).toLocaleString()}yd behind 365K pace</span>`;

    let block2 = `<div class="coach-label">This week</div>`;
    block2 += `${weekSwims.length} swim${weekSwims.length!==1?'s':''} · ${weekYd.toLocaleString()}yd${lyTag}`;
    if (weekPaceMed) block2 += ` · ${fmtPaceShort(weekPaceMed)}/100yd${weekTrendTag}`;
    block2 += `<br>${streakStr} · ${goalTag}`;

    // ── BLOCK 3: Data-driven tip ──────────────────────────────────────────────
    // Pick the strongest signal from the data and surface it
    const tips = [];

    // AM/PM split
    if (amPmDiffSec !== null && Math.abs(amPmDiffSec) >= 3) {
      const fasterSlot = amPmDiffSec > 0 ? 'morning' : 'evening';
      const diff = Math.abs(amPmDiffSec);
      const amN = swims.filter(s=>s.hour>=5&&s.hour<12).length;
      const pmN = swims.filter(s=>s.hour>=14).length;
      tips.push({
        strength: diff,
        text: `You swim <strong>${diff}s/100yd faster in the ${fasterSlot}</strong> (${amN} AM vs ${pmN} PM sessions across 8 years). ${fasterSlot === 'morning' ? 'Morning slots pay off.' : 'Evening sessions suit you better.'}`,
      });
    }

    // HRV signal
    if (hrvPaceSignal && Math.abs(hrvPaceSignal) >= 3) {
      const h = App.healthOn(App.daysAgo(1)) || App.healthOn(today);
      const todayHrv = h?.hrv_ms;
      let todayCtx = '';
      if (todayHrv && hrvMedian) {
        todayCtx = todayHrv >= hrvMedian * 1.1
          ? ` Today's HRV is elevated — conditions look good.`
          : todayHrv < hrvMedian * 0.85
          ? ` Today's HRV is suppressed — manage effort accordingly.`
          : '';
      }
      tips.push({
        strength: Math.abs(hrvPaceSignal),
        text: `High-HRV days (15%+ above your baseline) run <strong>${Math.abs(hrvPaceSignal)}s/100yd faster</strong> for you — one of your stronger recovery signals.${todayCtx}`,
      });
    }

    // Day-of-week best day
    const byDay = [0,1,2,3,4,5,6].map(d => {
      const v = swims.filter(s=>s.pace_per_100m && new Date(s.date).getDay()===d).map(s=>App.paceYd(s.pace_per_100m));
      return { day: d, med: median(v), n: v.length };
    }).filter(x=>x.n>=10 && x.med);
    if (byDay.length >= 5) {
      const best = byDay.reduce((a,b)=>a.med<b.med?a:b);
      const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const worst = byDay.reduce((a,b)=>a.med>b.med?a:b);
      const spread = Math.round((worst.med - best.med)*60);
      if (spread >= 4) {
        tips.push({
          strength: spread,
          text: `<strong>${dayNames[best.day]}s are your fastest day</strong> — ${spread}s/100yd quicker than your slowest day (${dayNames[worst.day]}).`,
        });
      }
    }

    // Session length sweet spot
    const longSwims  = swims.filter(s=>s.pace_per_100m&&s.distance_m>=2500);
    const shortSwims = swims.filter(s=>s.pace_per_100m&&s.distance_m<1500&&s.distance_m>0);
    if (longSwims.length>=10 && shortSwims.length>=10) {
      const longMed  = median(longSwims.map(s=>App.paceYd(s.pace_per_100m)));
      const shortMed = median(shortSwims.map(s=>App.paceYd(s.pace_per_100m)));
      const diff = Math.round((shortMed - longMed)*60);
      if (diff >= 4) {
        tips.push({
          strength: diff,
          text: `Sessions over 2,500yd run <strong>${diff}s/100yd faster</strong> than short ones — you warm up into your pace. Cutting sessions short costs you.`,
        });
      }
    }

    // Pick strongest tip, rotate daily so it doesn't always show the same one
    let block3 = '';
    if (tips.length) {
      tips.sort((a,b)=>b.strength-a.strength);
      const tipIdx = Math.floor(new Date().getDate() / 3) % tips.length; // changes every 3 days
      const tip = tips[tipIdx];
      block3 = `<div class="coach-label">Insight</div>${tip.text}`;
    }

    // ── Render ────────────────────────────────────────────────────────────────
    const blocks = [
      `<div class="coach-block">${block1}</div>`,
      `<div class="coach-block">${block2}</div>`,
      block3 ? `<div class="coach-block">${block3}</div>` : '',
    ].join('');
    el.innerHTML = `<div class="coach-card">${blocks}</div>`;
  },

  // --- Section: Last Swim ---
  renderLastSwim() {
    const el = document.getElementById('last-swim');
    const swims = App.data.swims;
    if (!swims.length) return;

    const last = swims[swims.length - 1];
    const yards = Math.round(App.toYards(last.distance_m));
    const health = App.healthOn(last.date) || App.healthOn(App.daysAgo(1));

    // Compare to 30-swim rolling average pace (in yards)
    const recentSwims = swims.slice(-30).filter(s => s.pace_per_100m);
    const avgPaceYd = recentSwims.reduce((s, sw) => s + App.paceYd(sw.pace_per_100m), 0) / recentSwims.length;
    const lastPaceYd = App.paceYd(last.pace_per_100m);
    // Diff in seconds per 100yd — negative means faster
    const paceDiffSec = lastPaceYd && avgPaceYd ? Math.round((lastPaceYd - avgPaceYd) * 60) : null;
    const paceDir = paceDiffSec !== null ? (paceDiffSec < 0 ? 'up' : paceDiffSec > 0 ? 'down' : 'neutral') : 'neutral';
    const paceDeltaText = paceDiffSec !== null
      ? `${paceDiffSec < 0 ? '' : '+'}${paceDiffSec}s vs avg`
      : '';

    // Time of day label
    const hour = last.hour;
    const timeLabel = hour < 6 ? 'Early morning' : hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';

    let contextTags = '';
    if (health) {
      const tags = [];
      if (health.hrv_ms) {
        const cls = health.hrv_ms >= 50 ? 'good' : health.hrv_ms >= 35 ? 'neutral' : 'bad';
        tags.push(`<span class="tag ${cls}">HRV <span class="tag-value">${Math.round(health.hrv_ms)}</span></span>`);
      }
      if (health.resting_hr) {
        const cls = health.resting_hr <= 55 ? 'good' : health.resting_hr <= 62 ? 'neutral' : 'bad';
        tags.push(`<span class="tag ${cls}">RHR <span class="tag-value">${Math.round(health.resting_hr)}</span></span>`);
      }
      if (health.sleep_hrs) {
        const cls = health.sleep_hrs >= 7 ? 'good' : health.sleep_hrs >= 6 ? 'neutral' : 'bad';
        tags.push(`<span class="tag ${cls}">Sleep <span class="tag-value">${health.sleep_hrs.toFixed(1)}h</span></span>`);
      }
      tags.push(`<span class="tag neutral">${timeLabel} <span class="tag-value">${last.hour}:00</span></span>`);
      contextTags = `<div class="recovery-tags">${tags.join('')}</div>`;
    }

    el.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
          <span class="swim-date">${App.relativeDate(last.date)} &middot; ${last.weekday}</span>
          <span class="swim-dot${last.is_open_water ? ' open-water' : ''}" style="display:inline-block"></span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <div>
            <span style="font-size:1.5rem;font-weight:700;font-family:var(--mono)">${yards.toLocaleString()}</span>
            <span style="font-size:0.8rem;color:var(--text-muted)"> yd</span>
          </div>
          <div style="text-align:right">
            <span style="font-size:1.25rem;font-weight:600;font-family:var(--mono)">${App.fmtPace(last.pace_per_100m)}</span>
            <span style="font-size:0.7rem;color:var(--text-muted)"> /100yd</span>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px">
          <span style="font-size:0.8rem;color:var(--text-muted)">${App.fmtDuration(last.duration_min)}${last.laps ? ` &middot; ${last.laps} laps` : ''}${last.avg_hr ? ` &middot; <span style="color:var(--orange)">&#9829; ${Math.round(last.avg_hr)} bpm</span>` : ''}</span>
          ${paceDeltaText ? `<span class="delta ${paceDir}">${paceDeltaText}</span>` : ''}
        </div>
        ${contextTags}
      </div>
    `;
  },

  // --- Section: Streaks ---
  renderStreaks() {
    const el = document.getElementById('streaks');
    const daily = App.calcDailyStreak();
    const weekly = App.calcWeeklyStreak();

    el.innerHTML = `
      <div class="streak-row">
        <div class="streak-card">
          <div class="streak-number" style="color:${daily >= 3 ? 'var(--accent)' : 'var(--text)'}">${daily}</div>
          <div class="streak-label">Day streak</div>
        </div>
        <div class="streak-card">
          <div class="streak-number" style="color:${weekly >= 4 ? 'var(--green)' : 'var(--text)'}">${weekly}</div>
          <div class="streak-label">Week streak</div>
        </div>
      </div>
    `;
  },

  // --- Section: Annual Goal ---
  renderAnnualGoal() {
    const el = document.getElementById('annual-goal');
    const year = new Date().getFullYear();
    const yearSwims = App.swimsThisYear();
    const totalM = yearSwims.reduce((sum, s) => sum + s.distance_m, 0);
    const totalYd = App.toYards(totalM);
    const pct = Math.min((totalYd / App.ANNUAL_GOAL_YD) * 100, 100);

    // Where we should be today
    const dayOfYear = Math.floor((new Date() - new Date(year, 0, 1)) / 86400000) + 1;
    const expectedPct = (dayOfYear / 365) * 100;
    const expectedYd = (App.ANNUAL_GOAL_YD / 365) * dayOfYear;
    const delta = totalYd - expectedYd;
    const deltaSign = delta >= 0 ? '+' : '';
    const deltaClass = delta >= 0 ? 'green' : 'orange';

    // Projected year-end
    const dailyRate = totalYd / dayOfYear;
    const projected = Math.round(dailyRate * 365);

    el.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
          <div>
            <span style="font-size:1.5rem;font-weight:700;font-family:var(--mono)">${Math.round(totalYd).toLocaleString()}</span>
            <span style="font-size:0.8rem;color:var(--text-muted)"> / 365,000 yd</span>
          </div>
          <span style="font-size:1.1rem;font-weight:600;font-family:var(--mono);color:var(--accent)">${pct.toFixed(1)}%</span>
        </div>
        <div class="progress-container">
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width:${pct}%"></div>
            <div class="progress-bar-target" style="left:${expectedPct}%" title="Expected pace"></div>
          </div>
          <div class="progress-labels">
            <span>${yearSwims.length} swims</span>
            <span>Day ${dayOfYear}/365</span>
          </div>
        </div>
        <div class="progress-pace" style="display:flex;justify-content:space-between;margin-top:10px">
          <span>vs pace: <span style="color:var(--${deltaClass});font-weight:600">${deltaSign}${Math.round(Math.abs(delta)).toLocaleString()} yd</span></span>
          <span>Projected: <span style="font-weight:600;color:var(--text)">${projected.toLocaleString()} yd</span></span>
        </div>
      </div>
    `;
  },

  // --- Section: This Week ---
  renderThisWeek() {
    const el = document.getElementById('this-week');
    const today = new Date();
    const dayOfWeek = (today.getDay() + 6) % 7; // 0=Mon, 6=Sun
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek);
    const startStr = startOfWeek.toISOString().slice(0, 10);
    const endStr = App.today();

    const weekSwims = App.swimsBetween(startStr, endStr);
    const totalM = weekSwims.reduce((s, sw) => s + sw.distance_m, 0);
    const pacedSwims = weekSwims.filter(sw => sw.pace_per_100m);
    const avgPace = pacedSwims.length
      ? pacedSwims.reduce((s, sw) => s + sw.pace_per_100m, 0) / pacedSwims.length
      : 0;
    const totalDuration = weekSwims.reduce((s, sw) => s + sw.duration_min, 0);

    // Same week last year
    const lyStart = new Date(startOfWeek);
    lyStart.setFullYear(lyStart.getFullYear() - 1);
    const lyEnd = new Date(today);
    lyEnd.setFullYear(lyEnd.getFullYear() - 1);
    const lySwims = App.swimsBetween(lyStart.toISOString().slice(0, 10), lyEnd.toISOString().slice(0, 10));
    const lyTotalM = lySwims.reduce((s, sw) => s + sw.distance_m, 0);

    const volDelta = lyTotalM > 0 ? App.deltaPercent(totalM, lyTotalM) : null;

    el.innerHTML = `
      <div class="card-row">
        <div class="card stat">
          <div class="stat-value accent">${weekSwims.length}</div>
          <div class="stat-label">Swims</div>
        </div>
        <div class="card stat">
          <div class="stat-value">${App.fmtYards(totalM)}</div>
          <div class="stat-label">Yards</div>
          ${volDelta ? `<div class="stat-sub"><span class="delta ${volDelta.direction}">${volDelta.text} vs LY</span></div>` : ''}
        </div>
        <div class="card stat">
          <div class="stat-value">${avgPace ? App.fmtPace(avgPace) : '--'}</div>
          <div class="stat-label">Avg Pace</div>
          <div class="stat-sub">/100yd</div>
        </div>
        <div class="card stat">
          <div class="stat-value">${App.fmtDuration(totalDuration)}</div>
          <div class="stat-label">Time</div>
        </div>
      </div>
    `;
  },

  // --- Section: Recent Swims ---
  renderRecentSwims() {
    const el = document.getElementById('recent-swims');
    const recent = App.data.swims.slice(-7).reverse();

    el.innerHTML = recent.map(s => `
      <div class="swim-item">
        <div class="swim-dot${s.is_open_water ? ' open-water' : ''}"></div>
        <div class="swim-info">
          <div class="swim-date">${App.relativeDate(s.date)} &middot; ${s.weekday}</div>
          <div class="swim-stats">${Math.round(App.toYards(s.distance_m)).toLocaleString()} yd &middot; ${App.fmtDuration(s.duration_min)}</div>
        </div>
        <div class="swim-pace">${App.fmtPace(s.pace_per_100m)}</div>
      </div>
    `).join('');
  },

  // --- Section: Year-over-Year Comparison ---
  renderYearComparison() {
    const el = document.getElementById('year-comparison');
    const currentYear = new Date().getFullYear();
    const dayOfYear = Math.floor((new Date() - new Date(currentYear, 0, 1)) / 86400000) + 1;

    const years = [];
    for (let y = currentYear; y >= currentYear - 4; y--) {
      const yearSwims = App.swimsForYear(y);
      if (!yearSwims.length) continue;

      // For past years, show full year. For current year, show to-date.
      const throughDate = y === currentYear
        ? App.today()
        : `${y}-12-31`;

      // For fair comparison, also calc past years through same day-of-year
      const compDate = `${y}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
      const swimsToDate = yearSwims.filter(s => s.date <= compDate);

      const totalM = swimsToDate.reduce((s, sw) => s + sw.distance_m, 0);
      const avgPace = swimsToDate.length
        ? swimsToDate.reduce((s, sw) => s + sw.pace_per_100m, 0) / swimsToDate.length
        : 0;

      years.push({
        year: y,
        swims: swimsToDate.length,
        yards: Math.round(App.toYards(totalM)),
        pace: avgPace,
        isCurrent: y === currentYear,
      });
    }

    const rows = years.map(y => `
      <tr class="${y.isCurrent ? 'current-year' : ''}">
        <td>${y.year}${y.isCurrent ? ' *' : ''}</td>
        <td>${y.swims}</td>
        <td>${y.yards.toLocaleString()}</td>
        <td>${App.fmtPace(y.pace)}</td>
      </tr>
    `).join('');

    el.innerHTML = `
      <div class="card">
        <table class="comparison-table">
          <thead>
            <tr>
              <th>Year</th>
              <th>Swims</th>
              <th>Yards</th>
              <th>Pace</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:8px;font-size:0.7rem;color:var(--text-dim)">* Through day ${dayOfYear} for fair comparison</div>
      </div>
    `;
  },

  // --- Section: Pace Trend Chart ---
  renderPaceChart() {
    const ctx = document.getElementById('pace-chart');
    if (!ctx) return;

    // Monthly average pace for last 24 months
    const now = new Date();
    const months = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7); // "2024-04"
      const monthSwims = App.data.swims.filter(s => s.date.startsWith(key) && s.pace_per_100m);
      if (monthSwims.length >= 2) {
        const sorted = monthSwims.map(sw => App.paceYd(sw.pace_per_100m)).sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        months.push({
          label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
          pace: median,
        });
      }
    }

    new Chart(ctx, {
      type: 'line',
      data: {
        labels: months.map(m => m.label),
        datasets: [{
          data: months.map(m => m.pace),
          borderColor: '#00d4ff',
          backgroundColor: 'rgba(0,212,255,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 2,
          pointHoverRadius: 5,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.y;
                const mins = Math.floor(v);
                const secs = Math.round((v - mins) * 60);
                return `${mins}:${secs.toString().padStart(2, '0')} /100yd`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#555', maxRotation: 45, font: { size: 10 } },
            grid: { color: '#1a1a1a' },
          },
          y: {
            reverse: true, // Lower pace = faster = higher on chart
            ticks: {
              color: '#555',
              font: { size: 10 },
              callback: (v) => {
                const mins = Math.floor(v);
                const secs = Math.round((v - mins) * 60);
                return `${mins}:${secs.toString().padStart(2, '0')}`;
              }
            },
            grid: { color: '#1a1a1a' },
          },
        },
      },
    });
  },

  // --- Section: Volume Chart ---
  renderVolumeChart() {
    const ctx = document.getElementById('volume-chart');
    if (!ctx) return;

    // Weekly volume for last 12 weeks
    const weeks = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const weekEnd = new Date(now);
      weekEnd.setDate(now.getDate() - (i * 7));
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekEnd.getDate() - 6);

      const startStr = weekStart.toISOString().slice(0, 10);
      const endStr = weekEnd.toISOString().slice(0, 10);
      const weekSwims = App.swimsBetween(startStr, endStr);
      const totalYd = weekSwims.reduce((s, sw) => s + App.toYards(sw.distance_m), 0);

      weeks.push({
        label: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        yards: Math.round(totalYd),
      });
    }

    // Daily target line: 1000yd * 7 = 7000yd/week
    const weeklyTarget = 7000;

    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: weeks.map(w => w.label),
        datasets: [{
          data: weeks.map(w => w.yards),
          backgroundColor: weeks.map(w => w.yards >= weeklyTarget ? 'rgba(52,211,153,0.7)' : 'rgba(0,212,255,0.5)'),
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.parsed.y.toLocaleString()} yd`
            }
          },
          annotation: undefined,
        },
        scales: {
          x: {
            ticks: { color: '#555', maxRotation: 45, font: { size: 10 } },
            grid: { display: false },
          },
          y: {
            ticks: {
              color: '#555',
              font: { size: 10 },
              callback: (v) => `${(v / 1000).toFixed(0)}k`,
            },
            grid: { color: '#1a1a1a' },
          },
        },
      },
    });
  },

  // --- Section: Recovery Correlations ---
  renderCorrelations() {
    const el = document.getElementById('correlations');

    // Calculate real correlations from the data
    const swimsWithHealth = [];
    for (const s of App.data.swims) {
      const h = App.healthOn(s.date);
      if (h && s.pace_per_100m) {
        swimsWithHealth.push({ ...s, health: h });
      }
    }

    const correlations = [];

    // HRV impact
    const highHRV = swimsWithHealth.filter(s => s.health.hrv_ms >= 50);
    const lowHRV = swimsWithHealth.filter(s => s.health.hrv_ms && s.health.hrv_ms < 35);
    if (highHRV.length >= 10 && lowHRV.length >= 10) {
      const highAvg = highHRV.reduce((s, sw) => s + App.paceYd(sw.pace_per_100m), 0) / highHRV.length;
      const lowAvg = lowHRV.reduce((s, sw) => s + App.paceYd(sw.pace_per_100m), 0) / lowHRV.length;
      const diff = lowAvg - highAvg;
      const secs = Math.round(diff * 60);
      correlations.push({
        label: 'High HRV (50+) vs Low (<35)',
        effect: secs > 0 ? `${secs}s faster` : `${Math.abs(secs)}s slower`,
        cls: secs > 0 ? 'green' : 'orange',
      });
    }

    // RHR impact
    const lowRHR = swimsWithHealth.filter(s => s.health.resting_hr && s.health.resting_hr <= 55);
    const highRHR = swimsWithHealth.filter(s => s.health.resting_hr && s.health.resting_hr > 62);
    if (lowRHR.length >= 10 && highRHR.length >= 10) {
      const lowAvg = lowRHR.reduce((s, sw) => s + App.paceYd(sw.pace_per_100m), 0) / lowRHR.length;
      const highAvg = highRHR.reduce((s, sw) => s + App.paceYd(sw.pace_per_100m), 0) / highRHR.length;
      const diff = highAvg - lowAvg;
      const secs = Math.round(diff * 60);
      correlations.push({
        label: 'Low RHR (≤55) vs High (62+)',
        effect: secs > 0 ? `${secs}s faster` : `${Math.abs(secs)}s slower`,
        cls: secs > 0 ? 'green' : 'orange',
      });
    }

    // Sleep impact
    const goodSleep = swimsWithHealth.filter(s => s.health.sleep_hrs && s.health.sleep_hrs >= 7);
    const badSleep = swimsWithHealth.filter(s => s.health.sleep_hrs && s.health.sleep_hrs < 6);
    if (goodSleep.length >= 5 && badSleep.length >= 5) {
      const goodAvg = goodSleep.reduce((s, sw) => s + App.paceYd(sw.pace_per_100m), 0) / goodSleep.length;
      const badAvg = badSleep.reduce((s, sw) => s + App.paceYd(sw.pace_per_100m), 0) / badSleep.length;
      const diff = badAvg - goodAvg;
      const secs = Math.round(diff * 60);
      correlations.push({
        label: 'Sleep 7h+ vs <6h',
        effect: secs > 0 ? `${secs}s faster` : `${Math.abs(secs)}s slower`,
        cls: secs > 0 ? 'green' : 'orange',
      });
    }

    // Morning vs evening
    const morning = App.data.swims.filter(s => s.hour >= 6 && s.hour < 12 && s.pace_per_100m);
    const evening = App.data.swims.filter(s => s.hour >= 15 && s.hour < 21 && s.pace_per_100m);
    if (morning.length >= 10 && evening.length >= 10) {
      const mAvg = morning.reduce((s, sw) => s + App.paceYd(sw.pace_per_100m), 0) / morning.length;
      const eAvg = evening.reduce((s, sw) => s + App.paceYd(sw.pace_per_100m), 0) / evening.length;
      const diff = eAvg - mAvg;
      const secs = Math.round(diff * 60);
      correlations.push({
        label: 'Morning vs Evening',
        effect: secs > 0 ? `${secs}s faster AM` : `${Math.abs(secs)}s faster PM`,
        cls: 'accent',
      });
    }

    el.innerHTML = correlations.map(c => `
      <div class="correlation-card">
        <span class="correlation-label">${c.label}</span>
        <span class="correlation-effect" style="color:var(--${c.cls})">${c.effect}</span>
      </div>
    `).join('');
  },
};

// Boot
document.addEventListener('DOMContentLoaded', () => Dashboard.init());
