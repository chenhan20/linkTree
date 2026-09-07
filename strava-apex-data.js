/* Pure data transforms shared by APEX's charts and the Node verification suite.
   Missing values stay missing. Route progress is distance along sampled GPS,
   never elapsed ride time: the source stream has no timestamps. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ApexData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const day = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s));
  const shiftDay = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const taipeiToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  function haversine(a, b) {
    const r = Math.PI / 180;
    const t = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(clamp(t)));
  }
  function routeModel(stream) {
    const valid = (Array.isArray(stream) ? stream : []).filter(p => Array.isArray(p) && finite(p[0]) && finite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
    if (valid.length < 2) return null;
    const lat = valid.reduce((a, p) => a + p[0], 0) / valid.length;
    const lng = valid.reduce((a, p) => a + p[1], 0) / valid.length;
    const elevations = valid.map(p => p[4]).filter(finite);
    const minElev = elevations.length ? Math.min(...elevations) : 0;
    const maxElev = elevations.length ? Math.max(...elevations) : 0;
    let distance = 0;
    const points = valid.map((p, i) => {
      if (i) distance += haversine(valid[i - 1], p);
      return { x: (p[1] - lng) * 111320 * Math.cos(lat * Math.PI / 180), z: (lat - p[0]) * 110540,
        elev: finite(p[4]) ? p[4] : null, speed: finite(p[3]) && p[3] >= 0 ? p[3] : null,
        hr: finite(p[2]) && p[2] > 0 ? p[2] : null, watts: finite(p[5]) && p[5] >= 0 ? p[5] : null,
        distance, index: i };
    });
    const extent = Math.max(50, ...points.map(p => Math.abs(p.x) * 2), ...points.map(p => Math.abs(p.z) * 2));
    const exaggeration = elevations.length ? clamp(extent * .19 / Math.max(1, maxElev - minElev), 1, 22) : 1;
    points.forEach(p => { p.y = p.elev == null ? 0 : (p.elev - minElev) * exaggeration; });
    return { points, extent, exaggeration, minElev, maxElev, distance, lat, lng, hasElev: !!elevations.length };
  }
  function sampleRoute(model, fraction) {
    if (!model?.points?.length) return null;
    if (fraction >= 1) {
      const raw = model.points.at(-1);
      return { x: raw.x, y: raw.y, z: raw.z, distance: model.distance, segmentIndex: model.points.length - 1, raw };
    }
    const target = clamp(fraction) * model.distance, points = model.points;
    let lo = 0, hi = points.length - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (points[mid].distance < target) lo = mid + 1; else hi = mid; }
    const right = points[lo], left = points[Math.max(0, lo - 1)];
    const t = right.distance === left.distance ? 0 : clamp((target - left.distance) / (right.distance - left.distance));
    // Geometry interpolates smoothly; the displayed telemetry is a real sample.
    const raw = t < .5 ? left : right;
    return { x: left.x + (right.x - left.x) * t, y: left.y + (right.y - left.y) * t, z: left.z + (right.z - left.z) * t, distance: target, segmentIndex: Math.max(0, lo - 1), raw };
  }
  function projectPoint(p, camera, ground = false) {
    const { extent, cx, cz, angle, pitch, zoom, width, height, map } = camera;
    const nx = p.x / extent - cx, nz = p.z / extent - cz, ny = ground ? 0 : p.y / extent;
    const a = nx * Math.cos(angle) - nz * Math.sin(angle), b = nx * Math.sin(angle) + nz * Math.cos(angle);
    // pitch=π/2 is north-up from above, not a view along the ground plane.
    const vertical = b * Math.sin(pitch) - ny * Math.cos(pitch), depth = b * Math.cos(pitch) + ny * Math.sin(pitch);
    const perspective = map ? 1 : 1 / Math.max(.55, 1 - depth * .35);
    const scale = Math.min(width * .91, height * 1.23) * zoom;
    return { x: width * .5 + a * scale * perspective, y: height * .54 + vertical * scale * perspective };
  }
  function wellnessRows(wellness, count, end) {
    const dates = Object.keys(wellness || {}).filter(day).sort();
    const until = end || dates.at(-1);
    if (!until) return [];
    return Array.from({ length: count }, (_, i) => {
      const date = shiftDay(until, i - count + 1), w = wellness?.[date];
      const ctl = finite(w?.ctl) ? w.ctl : null, atl = finite(w?.atl) ? w.atl : null;
      return { date, ctl, atl, tsb: ctl != null && atl != null ? ctl - atl : null };
    });
  }
  function dailyActivity(data, count = 14, end = taipeiToday()) {
    const rows = Array.from({ length: count }, (_, i) => ({ date: shiftDay(end, i - count + 1), minutes: 0, count: 0, distance: 0, types: {} }));
    const byDay = new Map(rows.map(r => [r.date, r]));
    for (const [key, type] of [['recent_rides','ride'],['recent_runs','run'],['recent_swims','swim'],['recent_weights','weight']]) {
      for (const a of data?.[key] || []) {
        const row = byDay.get(a.date); if (!row) continue;
        const minutes = finite(a.moving_time_sec) ? a.moving_time_sec / 60 : finite(a.moving_time_hr) ? a.moving_time_hr * 60 : 0;
        row.minutes += Math.max(0, minutes); row.count++;
        row.distance += finite(a.distance_km) ? Math.max(0, a.distance_km) : 0;
        row.types[type] = (row.types[type] || 0) + Math.max(0, minutes);
      }
    }
    return rows;
  }
  function powerRecords(data) {
    return (data?.power_prs || []).filter(p => finite(p.duration_sec) && p.duration_sec > 0 && finite(p.watts) && p.watts > 0).slice().sort((a,b) => a.duration_sec - b.duration_sec);
  }
  function linePath(rows, x, y, key) {
    let pen = false;
    return rows.map((r, i) => {
      if (!finite(r[key])) { pen = false; return ''; }
      const command = pen ? 'L' : 'M'; pen = true;
      return `${command}${x(i, r).toFixed(2)},${y(r[key]).toFixed(2)}`;
    }).join(' ');
  }
  return { finite, clamp, day, shiftDay, taipeiToday, haversine, routeModel, sampleRoute, projectPoint, wellnessRows, dailyActivity, powerRecords, linePath };
});
