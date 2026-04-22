/* ============================================
   Valorant Tracker — search + render
   Hits the Railway backend (/val/*), which proxies Henrik's API.
   Defensive against minor shape changes in Henrik's responses.
   ============================================ */

(function () {
  'use strict';

  // ---- config ---------------------------------------------------------
  const SERVER = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:8787'
    : 'https://ev-production.up.railway.app';

  const AGENT_CDN = (uuid) =>
    uuid ? `https://media.valorant-api.com/agents/${uuid}/displayicon.png` : '';
  const CARD_CDN = (uuid) =>
    uuid ? `https://media.valorant-api.com/playercards/${uuid}/wideart.png` : '';
  // Current competitive tiers table on valorant-api.com — tier id 0..27 maps to a rank icon.
  // Episode 5 table; update if Riot rotates to Episode 6+ (check https://valorant-api.com/v1/competitivetiers).
  const TIER_TABLE = '03621f52-342b-cf4e-4f86-9350a49c6d04';
  const TIER_CDN = (tierId) =>
    (tierId == null) ? '' : `https://media.valorant-api.com/competitivetiers/${TIER_TABLE}/${tierId}/largeicon.png`;

  const STORAGE_REGION = 'evz-val-region';
  const STORAGE_LAST = 'evz-val-last';

  // ---- DOM refs -------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const form = $('val-search');
  const nameInput = $('val-name');
  const tagInput = $('val-tag');
  const regionSelect = $('val-region');
  const searchBtn = $('val-search-btn');
  const statusEl = $('val-status');
  const statusDot = statusEl.querySelector('.val-status-dot');
  const statusText = statusEl.querySelector('.val-status-text');
  const dashboard = $('val-dashboard');

  const profileBg = $('val-profile-bg');
  const nameDisplay = $('val-name-display');
  const tagDisplay = $('val-tag-display');
  const levelEl = $('val-level');
  const regionDisplay = $('val-region-display');
  const rankIcon = $('val-rank-icon');
  const rankTier = $('val-rank-tier');
  const rankRr = $('val-rank-rr');
  const peakIcon = $('val-peak-icon');
  const peakTier = $('val-peak-tier');
  const peakMeta = $('val-peak-meta');
  const statsGrid = $('val-stats');
  const statsRange = $('val-stats-range');
  const topAgents = $('val-top-agents');
  const topMaps = $('val-top-maps');
  const matchesEl = $('val-matches');
  const matchesCount = $('val-matches-count');

  // Year marker in footer
  const yearEl = document.querySelector('[data-year]');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // ---- utils ----------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function setStatus(kind, text) {
    statusDot.className = 'val-status-dot ' + kind;
    statusText.textContent = text;
  }

  function disableForm(disabled) {
    searchBtn.disabled = disabled;
    nameInput.disabled = disabled;
    tagInput.disabled = disabled;
    regionSelect.disabled = disabled;
  }

  function timeAgo(isoOrMs) {
    const t = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
    if (!t || Number.isNaN(t)) return '—';
    const diff = (Date.now() - t) / 1000;
    if (diff < 60)       return `${Math.floor(diff)}s ago`;
    if (diff < 3600)     return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86_400)   return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604_800)  return `${Math.floor(diff / 86_400)}d ago`;
    if (diff < 2_592_000)return `${Math.floor(diff / 604_800)}w ago`;
    return `${Math.floor(diff / 2_592_000)}mo ago`;
  }

  function fmtPct(n, digits = 0) {
    if (!Number.isFinite(n)) return '—';
    return `${(n * 100).toFixed(digits)}%`;
  }
  function fmtNum(n, digits = 0) {
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(digits);
  }

  // ---- URL + storage state -------------------------------------------
  function readInitialState() {
    const params = new URLSearchParams(location.search);
    const riot = params.get('riot');
    const regionParam = params.get('region');
    const savedRegion = localStorage.getItem(STORAGE_REGION);
    const savedLast = localStorage.getItem(STORAGE_LAST);

    let name = '', tag = '';
    if (riot && riot.includes('#')) {
      [name, tag] = riot.split('#').map((s) => s.trim());
    } else if (savedLast && savedLast.includes('#')) {
      [name, tag] = savedLast.split('#').map((s) => s.trim());
    }
    nameInput.value = name || '';
    tagInput.value = tag || '';

    const region = (regionParam || savedRegion || 'ap').toLowerCase();
    if ([...regionSelect.options].some((o) => o.value === region)) {
      regionSelect.value = region;
    }
  }

  function writeUrlState(name, tag, region) {
    const url = new URL(location.href);
    url.searchParams.set('riot', `${name}#${tag}`);
    url.searchParams.set('region', region);
    history.replaceState(null, '', url.pathname + '?' + url.searchParams.toString());
  }

  // ---- fetch ----------------------------------------------------------
  async function proxy(path, params) {
    const qs = new URLSearchParams(params);
    let res;
    try {
      res = await fetch(`${SERVER}${path}?${qs}`);
    } catch (netErr) {
      // Fetch threw before getting a response — server unreachable, CORS, DNS, etc.
      const err = new Error('Cannot reach tracker backend');
      err.status = 0;
      err.cause = netErr;
      throw err;
    }
    let body;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      const msg = (body && (body.error || (body.errors && body.errors[0] && body.errors[0].message))) || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  // ---- aggregate from matches ----------------------------------------
  function findSelf(match, puuid) {
    const players = match.players && (match.players.all_players || match.players);
    if (!Array.isArray(players)) return null;
    return players.find((p) => p && p.puuid === puuid) || null;
  }

  function matchResult(match, self) {
    if (!self) return 'unknown';
    const teams = match.teams;
    if (!teams) return 'unknown';

    // v4 is an array with team_id; older can be object keyed by colour.
    let myTeam;
    if (Array.isArray(teams)) {
      myTeam = teams.find((t) => String(t.team_id || t.team || '').toLowerCase() === String(self.team_id || self.team || '').toLowerCase());
    } else {
      const key = String(self.team || self.team_id || '').toLowerCase();
      myTeam = teams[key] || teams[key.charAt(0).toUpperCase() + key.slice(1)];
    }
    if (!myTeam) return 'unknown';

    if (typeof myTeam.won === 'boolean') return myTeam.won ? 'win' : 'loss';

    const wonRounds = (myTeam.rounds && (myTeam.rounds.won ?? myTeam.rounds_won)) ?? myTeam.rounds_won;
    const lostRounds = (myTeam.rounds && (myTeam.rounds.lost ?? myTeam.rounds_lost)) ?? myTeam.rounds_lost;
    if (wonRounds == null || lostRounds == null) return 'unknown';
    if (wonRounds > lostRounds) return 'win';
    if (wonRounds < lostRounds) return 'loss';
    return 'draw';
  }

  function matchScore(match, self) {
    if (!self || !match.teams) return '';
    const teams = Array.isArray(match.teams) ? match.teams : Object.values(match.teams);
    const mine = teams.find((t) => String(t.team_id || t.team || '').toLowerCase() === String(self.team_id || self.team || '').toLowerCase());
    const other = teams.find((t) => t !== mine);
    const myR = (mine && (mine.rounds?.won ?? mine.rounds_won)) ?? 0;
    const theirR = (other && (other.rounds?.won ?? other.rounds_won)) ?? 0;
    return `${myR} – ${theirR}`;
  }

  function roundCount(match) {
    const teams = match.teams;
    if (!teams) return 0;
    const list = Array.isArray(teams) ? teams : Object.values(teams);
    let total = 0;
    for (const t of list) {
      total += (t.rounds?.won ?? t.rounds_won) || 0;
      total += (t.rounds?.lost ?? t.rounds_lost) || 0;
    }
    return total || (match.rounds && match.rounds.length) || 0;
  }

  function aggregateStats(matches, puuid) {
    let wins = 0, losses = 0, draws = 0;
    let k = 0, d = 0, a = 0;
    let hs = 0, bs = 0, ls = 0;
    let score = 0;           // sum of per-match "score" (ACS proxy when divided by rounds)
    let damageDealt = 0;
    let rounds = 0;
    let kills = 0;
    const agentMap = new Map();   // agent -> { games, wins, k, d, a }
    const mapMap = new Map();     // map -> { games, wins }

    for (const m of matches) {
      const self = findSelf(m, puuid);
      if (!self) continue;
      const r = matchResult(m, self);
      if (r === 'win')  wins++;
      else if (r === 'loss') losses++;
      else if (r === 'draw') draws++;

      const s = self.stats || {};
      k += s.kills || 0;
      d += s.deaths || 0;
      a += s.assists || 0;
      hs += s.headshots || 0;
      bs += s.bodyshots || 0;
      ls += s.legshots || 0;
      score += s.score || 0;
      damageDealt += (s.damage && (s.damage.dealt ?? s.damage.made)) ?? s.damage_made ?? 0;
      kills += s.kills || 0;
      rounds += roundCount(m);

      const agentName = (self.agent && self.agent.name) || self.character || 'Unknown';
      const agentId   = (self.agent && self.agent.id)   || self.character_id || '';
      const aRec = agentMap.get(agentName) || { name: agentName, id: agentId, games: 0, wins: 0, k: 0, d: 0, a: 0 };
      aRec.games++;
      if (r === 'win') aRec.wins++;
      aRec.k += s.kills || 0;
      aRec.d += s.deaths || 0;
      aRec.a += s.assists || 0;
      agentMap.set(agentName, aRec);

      const mapName = (m.metadata && (m.metadata.map?.name || m.metadata.map)) || 'Unknown';
      const mRec = mapMap.get(mapName) || { name: mapName, games: 0, wins: 0 };
      mRec.games++;
      if (r === 'win') mRec.wins++;
      mapMap.set(mapName, mRec);
    }

    const played = wins + losses + draws;
    const shots = hs + bs + ls;

    return {
      played,
      wins, losses, draws,
      winrate: played ? wins / (wins + losses || played) : NaN,
      kda: d ? (k + a) / d : NaN,
      k, d, a,
      hsPct: shots ? hs / shots : NaN,
      acs: rounds ? score / rounds : NaN,
      dpr: rounds ? damageDealt / rounds : NaN,
      kills,
      rounds,
      topAgents: [...agentMap.values()].sort((x, y) => y.games - x.games).slice(0, 3),
      topMaps:   [...mapMap.values()].sort((x, y) => y.games - x.games).slice(0, 3),
    };
  }

  // ---- render ---------------------------------------------------------
  function renderProfile(account, mmr) {
    // Card background — Henrik returns `card` as a UUID string. Build the CDN URL ourselves.
    // Fall back to the old object shape just in case they roll it back later.
    const cardUuid = typeof account?.card === 'string'
      ? account.card
      : (account?.card?.id || '');
    const cardWide = cardUuid ? CARD_CDN(cardUuid)
      : (account?.card?.wide || account?.card?.large || account?.card?.small || '');
    profileBg.style.backgroundImage = cardWide ? `url("${cardWide}")` : 'none';

    nameDisplay.textContent = account?.name || '—';
    tagDisplay.textContent  = account?.tag ? `#${account.tag}` : '';
    levelEl.textContent     = `Level ${account?.account_level ?? '—'}`;
    regionDisplay.textContent = `Region ${(account?.region || '—').toUpperCase()}`;

    // current rank
    const cur = mmr?.current;
    if (cur) {
      const tierName = cur.tier?.name || cur.currenttierpatched || 'Unranked';
      // Henrik v3 uses `rr` — older v2 used `ranking_in_tier`.
      const rr = cur.rr ?? cur.ranking_in_tier ?? cur.ranking_in_tier_number ?? null;
      const last = cur.last_change ?? cur.mmr_change_to_last_game ?? null;
      rankTier.textContent = tierName;
      rankRr.textContent = rr != null
        ? `${rr} RR${last != null ? `  ·  ${last >= 0 ? '+' : ''}${last}` : ''}`
        : '—';
      // No images in v3 — build icon URL from the numeric tier id.
      const icon = cur.images?.large || cur.images?.small || TIER_CDN(cur.tier?.id);
      if (icon) rankIcon.src = icon; else rankIcon.removeAttribute('src');
    } else {
      rankTier.textContent = 'Unranked';
      rankRr.textContent = '—';
      rankIcon.removeAttribute('src');
    }

    // peak rank
    const peak = mmr?.peak;
    if (peak) {
      const tierName = peak.tier?.name || peak.tier || '—';
      const season = peak.season?.short || peak.season_short || peak.season?.id || '';
      const peakRr = peak.rr ?? peak.ranking_in_tier ?? null;
      peakTier.textContent = tierName;
      const parts = [];
      if (season) parts.push(String(season).toUpperCase());
      if (peakRr != null) parts.push(`${peakRr} RR`);
      peakMeta.textContent = parts.length ? parts.join('  ·  ') : '—';
      const icon = peak.images?.large || peak.images?.small || TIER_CDN(peak.tier?.id);
      if (icon) peakIcon.src = icon; else peakIcon.removeAttribute('src');
    } else {
      peakTier.textContent = '—';
      peakMeta.textContent = '—';
      peakIcon.removeAttribute('src');
    }
  }

  function renderStats(agg) {
    statsRange.textContent = `/ last ${agg.played} match${agg.played === 1 ? '' : 'es'}`;

    const set = (key, html) => {
      const el = statsGrid.querySelector(`[data-stat="${key}"]`);
      if (el) el.innerHTML = html;
    };
    set('winrate', Number.isFinite(agg.winrate)
      ? `${fmtPct(agg.winrate)}<span class="val-stat-unit">${agg.wins}W ${agg.losses}L</span>`
      : '—');
    set('kda', Number.isFinite(agg.kda)
      ? `${fmtNum(agg.kda, 2)}<span class="val-stat-unit">${agg.k}/${agg.d}/${agg.a}</span>`
      : '—');
    set('hs', Number.isFinite(agg.hsPct) ? fmtPct(agg.hsPct, 1) : '—');
    set('acs', Number.isFinite(agg.acs) ? fmtNum(agg.acs, 0) : '—');
    set('dpr', Number.isFinite(agg.dpr) ? fmtNum(agg.dpr, 0) : '—');
    set('kills', fmtNum(agg.kills, 0));
  }

  function renderBreakdown(listEl, rows, { withIcon } = {}) {
    if (!rows.length) {
      listEl.innerHTML = '<div class="val-breakdown-empty">No match data.</div>';
      return;
    }
    listEl.innerHTML = rows.map((r) => {
      const wr = r.wins / r.games;
      const wrClass = wr >= 0.55 ? 'pos' : wr <= 0.45 ? 'neg' : '';
      const icon = withIcon && r.id
        ? `<img src="${esc(AGENT_CDN(r.id))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>`
        : `<div style="width:32px;height:32px;background:var(--bg-0);border-radius:var(--radius-sm);"></div>`;
      return `
        <div class="val-breakdown-row">
          ${icon}
          <div class="val-breakdown-name">${esc(r.name)}</div>
          <div class="val-breakdown-wr ${wrClass}">${fmtPct(wr)}</div>
          <div class="val-breakdown-games">${r.games}G</div>
        </div>
      `;
    }).join('');
  }

  function renderMatches(matches, puuid) {
    if (!matches.length) {
      matchesEl.innerHTML = '<div class="val-matches-empty">No matches found for this player.</div>';
      matchesCount.textContent = '0';
      return;
    }
    matchesCount.textContent = String(matches.length);

    const rows = matches.map((m) => {
      const self = findSelf(m, puuid);
      if (!self) return '';
      const s = self.stats || {};
      const r = matchResult(m, self);
      const score = matchScore(m, self);
      const mapName = (m.metadata && (m.metadata.map?.name || m.metadata.map)) || 'Unknown';
      const mode    = (m.metadata && (m.metadata.queue?.name || m.metadata.queue || m.metadata.mode)) || '—';
      const started = m.metadata && (m.metadata.started_at || m.metadata.game_start_patched || m.metadata.game_start);
      const agentName = (self.agent && self.agent.name) || self.character || 'Agent';
      const agentId   = (self.agent && self.agent.id)   || self.character_id || '';
      const rnd = roundCount(m);
      const acs = rnd && s.score ? Math.round(s.score / rnd) : null;

      return `
        <div class="val-match" data-result="${r}">
          <span aria-hidden="true"></span>
          <div>
            <div class="val-match-result">${r}</div>
            <div class="val-match-score">${esc(score)}</div>
          </div>
          <div class="val-match-map">
            <div class="val-match-map-name">${esc(mapName)}</div>
            <div class="val-match-mode">${esc(mode)}</div>
          </div>
          <div class="val-match-agent">
            ${agentId ? `<img src="${esc(AGENT_CDN(agentId))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>` : '<div style="width:34px;height:34px;background:var(--bg-0);border-radius:var(--radius-sm);"></div>'}
            <div class="val-match-agent-name">${esc(agentName)}</div>
          </div>
          <div class="val-match-kda">
            ${s.kills ?? 0}<span class="sep">/</span>${s.deaths ?? 0}<span class="sep">/</span>${s.assists ?? 0}
          </div>
          <div class="val-match-acs">${acs != null ? acs + ' ACS' : '—'}</div>
          <div class="val-match-time">${timeAgo(started)}</div>
        </div>
      `;
    }).join('');

    matchesEl.innerHTML = rows || '<div class="val-matches-empty">No matches found for this player.</div>';
  }

  // ---- main flow ------------------------------------------------------
  let inFlight = 0;

  async function runSearch(name, tag, region) {
    const token = ++inFlight;
    setStatus('loading', 'Fetching…');
    disableForm(true);

    try {
      const accountRes = await proxy('/val/account', { name, tag });
      if (token !== inFlight) return;
      const account = accountRes?.data;
      if (!account || !account.puuid) throw new Error('Player not found');

      // Account data can tell us the authoritative region — prefer it over the form.
      const resolvedRegion = (account.region || region).toLowerCase();

      // Parallel: MMR + matches (competitive only for cleaner stats)
      const [mmrRes, matchesRes] = await Promise.all([
        proxy('/val/mmr', { region: resolvedRegion, platform: 'pc', name, tag }).catch((e) => ({ __err: e })),
        proxy('/val/matches', { region: resolvedRegion, platform: 'pc', name, tag, size: 20, mode: 'competitive' }).catch((e) => ({ __err: e })),
      ]);
      if (token !== inFlight) return;

      const mmr = mmrRes && !mmrRes.__err ? mmrRes.data : null;
      const matches = (matchesRes && !matchesRes.__err && Array.isArray(matchesRes.data)) ? matchesRes.data : [];

      renderProfile(account, mmr);

      if (matches.length) {
        const agg = aggregateStats(matches, account.puuid);
        renderStats(agg);
        renderBreakdown(topAgents, agg.topAgents, { withIcon: true });
        renderBreakdown(topMaps, agg.topMaps);
        renderMatches(matches, account.puuid);
      } else {
        // Wipe to empty state so a previous search doesn't linger.
        renderStats({ played: 0, wins: 0, losses: 0, winrate: NaN, kda: NaN, k:0, d:0, a:0, hsPct: NaN, acs: NaN, dpr: NaN, kills: 0, rounds: 0 });
        renderBreakdown(topAgents, []);
        renderBreakdown(topMaps, []);
        renderMatches([], account.puuid);
      }

      dashboard.classList.remove('hidden');
      // Restart the rise animation so re-searches look alive.
      // eslint-disable-next-line no-unused-expressions
      dashboard.offsetWidth;

      setStatus('ok', `Loaded ${account.name}#${account.tag}`);
      writeUrlState(account.name, account.tag, resolvedRegion);
      localStorage.setItem(STORAGE_LAST, `${account.name}#${account.tag}`);
      localStorage.setItem(STORAGE_REGION, resolvedRegion);
    } catch (err) {
      if (token !== inFlight) return;
      const msg = err.status === 0
        ? 'Cannot reach tracker backend — is the server awake?'
        : err.status === 404
          ? (err.body?.errors?.[0]?.message || 'Player not found — check spelling, tag, and region')
          : err.status === 503
            ? 'Tracker not configured — API key missing on server'
            : err.status === 429
              ? 'Rate limited — try again in a moment'
              : (err.message || 'Something went wrong');
      setStatus('error', msg);
      console.error('[val] search failed', err);
    } finally {
      if (token === inFlight) disableForm(false);
    }
  }

  // ---- event wiring ---------------------------------------------------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const tag = tagInput.value.trim();
    const region = regionSelect.value;
    if (name.length < 3 || tag.length < 3) {
      setStatus('error', 'Enter a valid Riot ID (name#tag)');
      return;
    }
    runSearch(name, tag, region);
  });

  regionSelect.addEventListener('change', () => {
    localStorage.setItem(STORAGE_REGION, regionSelect.value);
  });

  // Submit on Enter in either text input
  [nameInput, tagInput].forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); }
    });
  });

  // ---- bootstrap ------------------------------------------------------
  readInitialState();

  // Auto-search if URL carries a riot param.
  const initialRiot = new URLSearchParams(location.search).get('riot');
  if (initialRiot && initialRiot.includes('#')) {
    const [n, t] = initialRiot.split('#').map((s) => s.trim());
    if (n && t) {
      // Small delay so the page curtain animation finishes cleanly.
      setTimeout(() => runSearch(n, t, regionSelect.value), 400);
    }
  } else {
    setStatus('idle', 'Ready');
  }
})();
