const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');

const TOKEN = process.env.GH_TOKEN;
const USERNAME = process.env.GITHUB_USERNAME || 'rajehdidntwakeup';

function escXml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function graphql(query) {
  const body = JSON.stringify({ query });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Authorization': `bearer ${TOKEN}`,
        'User-Agent': 'node',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors) reject(new Error(JSON.stringify(parsed.errors)));
          else resolve(parsed.data);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchContributionData() {
  const query = `query { viewer { login contributionsCollection { totalCommitContributions totalPullRequestContributions totalIssueContributions totalPullRequestReviewContributions totalRepositoryContributions contributionCalendar { totalContributions weeks { contributionDays { contributionCount date color } } } } } }`;
  return graphql(query);
}

async function fetchLanguages() {
  return new Promise((resolve, reject) => {
    https.get(`https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=updated`, {
      headers: { 'User-Agent': 'node', 'Authorization': `token ${TOKEN}` }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ===== STATS SVG =====
function generateStatsSVG(viewer) {
  const coll = viewer.contributionsCollection;
  const stats = [
    { label: 'Total Contributions', value: coll.contributionCalendar.totalContributions.toLocaleString() },
    { label: 'Commits', value: coll.totalCommitContributions.toLocaleString() },
    { label: 'Pull Requests', value: coll.totalPullRequestContributions.toLocaleString() },
    { label: 'Issues', value: coll.totalIssueContributions.toLocaleString() },
    { label: 'Code Reviews', value: coll.totalPullRequestReviewContributions.toLocaleString() },
    { label: 'Repositories', value: coll.totalRepositoryContributions.toLocaleString() },
  ];

  const w = 450, rowH = 30, pad = 16, headerH = 40;
  const h = pad + headerH + stats.length * rowH + pad;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}</style>
  <rect width="${w}" height="${h}" rx="12" fill="#0d1117"/>
  <rect width="${w}" height="4" rx="12" fill="#58a6ff"/>
  <rect y="4" width="${w}" height="4" fill="#0d1117"/>
  <text x="${pad}" y="${pad + 24}" fill="#c9d1d9" font-size="15" font-weight="700">${escXml(viewer.login)}'s GitHub Stats</text>`;

  stats.forEach((s, i) => {
    const y = pad + headerH + i * rowH;
    const textY = y + 19;
    svg += `
  <text x="${pad + 10}" y="${textY}" fill="#8b949e" font-size="12.5">${escXml(s.label)}</text>
  <text x="${w - pad}" y="${textY}" fill="#58a6ff" font-size="12.5" font-weight="700" text-anchor="end">${escXml(s.value)}</text>`;
    if (i < stats.length - 1) {
      svg += `\n  <line x1="${pad}" y1="${y + rowH - 2}" x2="${w - pad}" y2="${y + rowH - 2}" stroke="#21262d" stroke-width="1"/>`;
    }
  });

  svg += `\n</svg>`;
  return svg;
}

// ===== STREAK SVG =====
function generateStreakSVG(viewer) {
  const weeks = viewer.contributionsCollection.contributionCalendar.weeks;
  const allDays = weeks.flatMap(w => w.contributionDays);

  let currentStreak = 0, longestStreak = 0, streak = 0;

  for (let i = allDays.length - 1; i >= 0; i--) {
    if (allDays[i].contributionCount > 0) {
      streak++;
      longestStreak = Math.max(longestStreak, streak);
    } else {
      streak = 0;
    }
  }

  streak = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (let i = allDays.length - 1; i >= 0; i--) {
    if (allDays[i].contributionCount > 0) streak++;
    else if (allDays[i].date === today) continue;
    else break;
  }
  currentStreak = streak;

  const totalContribs = viewer.contributionsCollection.contributionCalendar.totalContributions;

  const w = 450, pad = 16, headerH = 40;
  const items = [
    { label: 'Current Streak', value: `${currentStreak} days`, accent: '#ff6b6b' },
    { label: 'Longest Streak', value: `${longestStreak} days`, accent: '#58a6ff' },
    { label: 'This Year', value: `${totalContribs.toLocaleString()} contributions`, accent: '#c9d1d9' },
  ];
  const h = pad + headerH + items.length * 32 + pad;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}</style>
  <rect width="${w}" height="${h}" rx="12" fill="#0d1117"/>
  <rect width="${w}" height="4" rx="12" fill="#ff6b6b"/>
  <rect y="4" width="${w}" height="4" fill="#0d1117"/>
  <text x="${pad}" y="${pad + 24}" fill="#c9d1d9" font-size="15" font-weight="700">🔥 Streak Stats</text>`;

  items.forEach((item, i) => {
    const y = pad + headerH + i * 32;
    const textY = y + 19;
    svg += `
  <text x="${pad}" y="${textY}" fill="${item.accent}" font-size="13" font-weight="600">${escXml(item.label)}</text>
  <text x="${w - pad}" y="${textY}" fill="#c9d1d9" font-size="13" text-anchor="end" font-weight="500">${escXml(item.value)}</text>`;
    if (i < items.length - 1) {
      svg += `\n  <line x1="${pad}" y1="${y + 30}" x2="${w - pad}" y2="${y + 30}" stroke="#21262d" stroke-width="1"/>`;
    }
  });

  svg += `\n</svg>`;
  return svg;
}

// ===== TOP LANGUAGES SVG =====
function generateTopLangsSVG(repos) {
  const langColors = {
    'Java': '#b07219', 'Python': '#3572A5', 'JavaScript': '#f1e05a', 'TypeScript': '#3178c6',
    'CSS': '#563d7c', 'HTML': '#e34c26', 'Shell': '#89e051', 'Dockerfile': '#384d54',
    'SQL': '#e38c00', 'Rust': '#dea584', 'Go': '#00ADD8', 'Kotlin': '#A97BFF',
    'Ruby': '#701516', 'C++': '#f34b7d', 'C': '#555555', 'PHP': '#4F5D95',
    'Swift': '#F05138', 'Dart': '#00B4AB', 'Scala': '#c22d40', 'Vue': '#41b883'
  };

  const langBytes = {};
  repos.forEach(r => { if (r.language && r.size) langBytes[r.language] = (langBytes[r.language] || 0) + r.size; });
  const sorted = Object.entries(langBytes).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;

  const w = 450, pad = 16, headerH = 40, barH = 10;
  const rowH = 28;
  const h = pad + headerH + sorted.length * rowH + barH + 20 + pad;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}</style>
  <rect width="${w}" height="${h}" rx="12" fill="#0d1117"/>
  <rect width="${w}" height="4" rx="12" fill="#58a6ff"/>
  <rect y="4" width="${w}" height="4" fill="#0d1117"/>
  <text x="${pad}" y="${pad + 24}" fill="#c9d1d9" font-size="15" font-weight="700">Most Used Languages</text>`;

  sorted.forEach(([lang, bytes], i) => {
    const y = pad + headerH + i * rowH;
    const pct = ((bytes / total) * 100).toFixed(1);
    const c = langColors[lang] || '#8b949e';
    svg += `
  <circle cx="${pad + 6}" cy="${y + 9}" r="5" fill="${c}"/>
  <text x="${pad + 18}" y="${y + 13}" fill="#c9d1d9" font-size="12">${escXml(lang)}</text>
  <text x="${w - pad}" y="${y + 13}" fill="#8b949e" font-size="12" text-anchor="end">${pct}%</text>`;
  });

  // Progress bar
  const barY = pad + headerH + sorted.length * rowH + 10;
  let barX = pad;
  const barWidth = w - pad * 2;
  sorted.forEach(([lang, bytes]) => {
    const pct = bytes / total;
    const segW = Math.max(2, barWidth * pct);
    const c = langColors[lang] || '#8b949e';
    svg += `\n  <rect x="${barX.toFixed(1)}" y="${barY}" width="${segW.toFixed(1)}" height="${barH}" rx="5" fill="${c}"/>`;
    barX += segW;
  });

  svg += `\n</svg>`;
  return svg;
}

// ===== ACTIVITY GRAPH SVG =====
function generateActivityGraphSVG(viewer) {
  const weeks = viewer.contributionsCollection.contributionCalendar.weeks;
  const lastN = Math.min(weeks.length, 20);
  const recentWeeks = weeks.slice(-lastN);
  const totalContribs = viewer.contributionsCollection.contributionCalendar.totalContributions;

  const cellSize = 11, gap = 3;
  const pad = 16, headerH = 40;
  const offsetY = pad + headerH;
  const gridW = lastN * (cellSize + gap);
  const gridH = 7 * (cellSize + gap);
  const w = Math.max(gridW + pad * 2 + 30, 450);
  const h = offsetY + gridH + 30;

  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}</style>
  <rect width="${w}" height="${h}" rx="12" fill="#0d1117"/>
  <text x="${pad}" y="${pad + 20}" fill="#c9d1d9" font-size="15" font-weight="700">${totalContribs.toLocaleString()} contributions in the last year</text>`;

  dayLabels.forEach((label, i) => {
    if (label) {
      const y = offsetY + i * (cellSize + gap) + cellSize;
      svg += `\n  <text x="${pad}" y="${y}" fill="#8b949e" font-size="9" text-anchor="end">${label}</text>`;
    }
  });

  recentWeeks.forEach((week, wk) => {
    week.contributionDays.forEach((day, dy) => {
      const x = pad + 30 + wk * (cellSize + gap);
      const y = offsetY + dy * (cellSize + gap);
      svg += `\n  <rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${day.color}"/>`;
    });
  });

  // Legend
  const legendY = offsetY + gridH + 18;
  const legendX = w - pad - 120;
  svg += `\n  <text x="${legendX}" y="${legendY}" fill="#8b949e" font-size="10">Less</text>`;
  ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'].forEach((c, i) => {
    svg += `\n  <rect x="${legendX + 28 + i * 15}" y="${legendY - 9}" width="11" height="11" rx="2" fill="${c}"/>`;
  });
  svg += `\n  <text x="${legendX + 28 + 5 * 15 + 4}" y="${legendY}" fill="#8b949e" font-size="10">More</text>`;

  svg += `\n</svg>`;
  return svg;
}

// ===== MAIN =====
async function main() {
  console.log('Fetching contribution data via GraphQL...');
  const data = await fetchContributionData();
  const viewer = data.viewer;
  console.log(`User: ${viewer.login}, Total: ${viewer.contributionsCollection.contributionCalendar.totalContributions}`);

  console.log('Fetching repos for languages...');
  const repos = await fetchLanguages();
  console.log(`Found ${repos.length} repos`);

  console.log('\nGenerating SVGs...');

  fs.writeFileSync('stats.svg', generateStatsSVG(viewer));
  console.log('✓ stats.svg');

  fs.writeFileSync('streak.svg', generateStreakSVG(viewer));
  console.log('✓ streak.svg');

  fs.writeFileSync('top-langs.svg', generateTopLangsSVG(repos));
  console.log('✓ top-langs.svg');

  fs.writeFileSync('activity-graph.svg', generateActivityGraphSVG(viewer));
  console.log('✓ activity-graph.svg');

  console.log('\nAll SVGs generated successfully!');
}

main().catch(e => { console.error(e); process.exit(1); });