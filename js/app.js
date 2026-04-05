/* Swim Coach — Shared utilities and data loading */

const App = {
  // Conversion: 1 meter = 1.09361 yards
  M_TO_YD: 1.09361,

  // Annual goal in yards
  ANNUAL_GOAL_YD: 365000,

  data: {
    swims: [],
    health: [],
  },

  async load() {
    // Use pre-bundled globals (file:// compatible) or fall back to fetch
    let rawSwims, rawHealth;
    if (window.__SWIMS && window.__HEALTH) {
      rawSwims  = window.__SWIMS;
      rawHealth = window.__HEALTH;
    } else {
      const [swimsRes, healthRes] = await Promise.all([
        fetch('data/swims.json'),
        fetch('data/health.json'),
      ]);
      rawSwims  = await swimsRes.json();
      rawHealth = await healthRes.json();
    }
    // Filter out zero-distance entries (Apple Health artifacts)
    this.data.swims = rawSwims.filter(s => s.distance_m > 0);
    this.data.health = rawHealth;

    // Index health by date for fast lookup
    this.data.healthByDate = {};
    for (const h of this.data.health) {
      this.data.healthByDate[h.date] = h;
    }

    return this.data;
  },

  // Meters to yards
  toYards(meters) {
    return meters * this.M_TO_YD;
  },

  // Format yards with comma separator
  fmtYards(meters, decimals = 0) {
    const yd = this.toYards(meters);
    return Math.round(yd).toLocaleString('en-US');
  },

  // Format pace: min/100m → min:sec per 100yd
  // 100yd = 91.44m, so pace_per_100yd = pace_per_100m * (91.44/100)
  fmtPace(pacePerHundredM) {
    if (!pacePerHundredM) return '--:--';
    const pacePerHundredYd = pacePerHundredM * 0.9144;
    const mins = Math.floor(pacePerHundredYd);
    const secs = Math.round((pacePerHundredYd - mins) * 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  },

  // Raw pace in min per 100yd (for comparisons)
  paceYd(pacePerHundredM) {
    if (!pacePerHundredM) return null;
    return pacePerHundredM * 0.9144;
  },

  // Format duration (minutes → "1h 05m" or "45m")
  fmtDuration(mins) {
    if (!mins) return '--';
    if (mins < 60) return `${Math.round(mins)}m`;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return `${h}h ${m.toString().padStart(2, '0')}m`;
  },

  // Get today's date string
  today() {
    return new Date().toISOString().slice(0, 10);
  },

  // Date helpers
  daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  },

  // Get swims in date range (inclusive)
  swimsBetween(start, end) {
    return this.data.swims.filter(s => s.date >= start && s.date <= end);
  },

  // Get swims for current year
  swimsThisYear() {
    const year = new Date().getFullYear();
    return this.data.swims.filter(s => s.year === year);
  },

  // Get swims for a specific year
  swimsForYear(year) {
    return this.data.swims.filter(s => s.year === year);
  },

  // Get health for a specific date
  healthOn(date) {
    return this.data.healthByDate[date] || null;
  },

  // Calculate daily streak (consecutive days with a swim ending on or before today)
  calcDailyStreak() {
    const swimDates = new Set(this.data.swims.map(s => s.date));
    let streak = 0;
    let d = new Date();

    // If no swim today, start checking from yesterday
    const todayStr = d.toISOString().slice(0, 10);
    if (!swimDates.has(todayStr)) {
      d.setDate(d.getDate() - 1);
    }

    while (true) {
      const dateStr = d.toISOString().slice(0, 10);
      if (swimDates.has(dateStr)) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  },

  // Calculate weekly streak (consecutive weeks with at least one swim)
  calcWeeklyStreak() {
    // Group swims by ISO week
    const swimWeeks = new Set();
    for (const s of this.data.swims) {
      const d = new Date(s.date);
      const week = this.getISOWeek(d);
      swimWeeks.add(week);
    }

    let streak = 0;
    let d = new Date();

    // Check current week first
    let weekKey = this.getISOWeek(d);
    if (!swimWeeks.has(weekKey)) {
      // Check previous week
      d.setDate(d.getDate() - 7);
      weekKey = this.getISOWeek(d);
    }

    while (swimWeeks.has(weekKey)) {
      streak++;
      d.setDate(d.getDate() - 7);
      weekKey = this.getISOWeek(d);
    }

    return streak;
  },

  // ISO week key: "2026-W13"
  getISOWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
    return `${d.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
  },

  // Relative date label: "Today", "Yesterday", "Mon Mar 25"
  relativeDate(dateStr) {
    const today = this.today();
    const yesterday = this.daysAgo(1);
    if (dateStr === today) return 'Today';
    if (dateStr === yesterday) return 'Yesterday';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  },

  // Delta string: "+5%" or "-3%"
  deltaPercent(current, previous) {
    if (!previous || !current) return null;
    const pct = ((current - previous) / previous) * 100;
    const sign = pct > 0 ? '+' : '';
    return { text: `${sign}${pct.toFixed(1)}%`, direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral' };
  },
};
