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
  // Use largeart (268x640, crisp portrait) rather than wideart (452x128, too low-res
  // to upscale to a banner without blur). We position it on the right and fade the
  // left side for text contrast — see .val-profile-bg in valorant.css.
  const CARD_CDN = (uuid) =>
    uuid ? `https://media.valorant-api.com/playercards/${uuid}/largeart.png` : '';
  // Current competitive tiers table on valorant-api.com — tier id 0..27 maps to a rank icon.
  // Episode 5 table; update if Riot rotates to Episode 6+ (check https://valorant-api.com/v1/competitivetiers).
  const TIER_TABLE = '03621f52-342b-cf4e-4f86-9350a49c6d04';
  const TIER_CDN = (tierId) =>
    (tierId == null) ? '' : `https://media.valorant-api.com/competitivetiers/${TIER_TABLE}/${tierId}/largeicon.png`;

  const STORAGE_REGION = 'evz-val-region';
  const STORAGE_LAST = 'evz-val-last';
  const STORAGE_MAPS = 'evz-val-maps-v1';
  const STORAGE_WEAPONS = 'evz-val-weapons-v1';
  const META_CACHE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

  // Henrik returns map + weapon as display names or UUIDs depending on endpoint
  // version. valorant-api.com has the canonical metadata — fetch once and cache
  // in localStorage so icons render without another network hop on repeat loads.
  const metaCache = { maps: null, weapons: null };

  async function loadMeta(key, url, storageKey) {
    if (metaCache[key]) return metaCache[key];
    try {
      const cached = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (cached && cached.at && (Date.now() - cached.at) < META_CACHE_MS && cached.data) {
        metaCache[key] = cached.data;
        return metaCache[key];
      }
    } catch { /* ignore */ }
    try {
      const res = await fetch(url);
      const j = await res.json();
      const data = j?.data || [];
      metaCache[key] = data;
      try { localStorage.setItem(storageKey, JSON.stringify({ at: Date.now(), data })); } catch { /* quota */ }
      return data;
    } catch (err) {
      console.warn('[val] meta fetch failed', key, err);
      metaCache[key] = [];
      return [];
    }
  }

  function mapSplash(nameOrUuid) {
    const list = metaCache.maps;
    if (!list || !list.length || !nameOrUuid) return '';
    const needle = String(nameOrUuid).toLowerCase();
    const hit = list.find((m) =>
      (m.uuid && m.uuid.toLowerCase() === needle) ||
      (m.displayName && m.displayName.toLowerCase() === needle) ||
      (m.mapUrl && m.mapUrl.toLowerCase().endsWith('/' + needle))
    );
    return hit ? (hit.splash || hit.listViewIcon || '') : '';
  }

  function weaponInfo(uuid) {
    const list = metaCache.weapons;
    if (!list || !list.length || !uuid) return null;
    const needle = String(uuid).toLowerCase();
    return list.find((w) => w.uuid && w.uuid.toLowerCase() === needle) || null;
  }

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
  const recentAgentWrap = $('val-recent-agent');
  const recentAgentImg = $('val-recent-agent-img');
  const recentAgentName = $('val-recent-agent-name');
  const rrChartEl = $('val-rr-chart');
  const statsGrid = $('val-stats');
  const statsRange = $('val-stats-range');
  const topAgents = $('val-top-agents');
  const topMaps = $('val-top-maps');
  const matchesEl = $('val-matches');
  const matchesCount = $('val-matches-count');
  const sessionEl = $('val-session');
  const sessionSub = $('val-session-sub');
  const sessionGames = $('val-session-games');
  const sessionWl = $('val-session-wl');
  const sessionRr = $('val-session-rr');
  const sessionStreak = $('val-session-streak');
  const sessionForm = $('val-session-form');
  const weaponsEl = $('val-weapons');
  const weaponsRange = $('val-weapons-range');
  const shareBtn = $('val-share');
  const shareLabel = $('val-share-label');
  const liveBtn = $('val-live-toggle');
  const liveLabel = $('val-live-label');
  const liveIndicator = $('val-live-indicator');
  const toastEl = $('val-toast');
  const toastText = $('val-toast-text');

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
  function fmtRr(n) {
    if (!Number.isFinite(n)) return '—';
    return `${n >= 0 ? '+' : ''}${n} RR`;
  }

  // Match start time in milliseconds — tolerant of Henrik's shape changes.
  function matchStartMs(m) {
    const md = m && m.metadata || {};
    if (typeof md.game_start === 'number')   return md.game_start * 1000;
    if (typeof md.started_at === 'string')   return Date.parse(md.started_at) || 0;
    if (typeof md.game_start_iso === 'string') return Date.parse(md.game_start_iso) || 0;
    if (typeof md.started_at_ms === 'number')  return md.started_at_ms;
    return 0;
  }

  function matchId(m) {
    const md = m && m.metadata || {};
    return md.matchid || md.match_id || md.game_id || (typeof matchStartMs(m) === 'number' ? String(matchStartMs(m)) : '');
  }

  let toastTimer = null;
  function toast(text, opts = {}) {
    if (!toastEl) return;
    toastText.textContent = text;
    toastEl.hidden = false;
    // Force reflow so the transition fires even on rapid consecutive calls.
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => { if (!toastEl.classList.contains('show')) toastEl.hidden = true; }, 300);
    }, opts.duration || 1800);
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
    const mapMap = new Map();     // map -> { games, wins, id }
    const weaponMap = new Map();  // weapon uuid -> { id, kills, hs, bs, ls }

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
      const aRec = agentMap.get(agentName)
        || { name: agentName, id: agentId, games: 0, wins: 0, k: 0, d: 0, a: 0, score: 0, rounds: 0 };
      aRec.games++;
      if (r === 'win') aRec.wins++;
      aRec.k += s.kills || 0;
      aRec.d += s.deaths || 0;
      aRec.a += s.assists || 0;
      aRec.score  += s.score || 0;
      aRec.rounds += roundCount(m);
      agentMap.set(agentName, aRec);

      // Map — Henrik v4 returns metadata.map as { id, name } object, older as string.
      const md = m.metadata || {};
      const mapName = (md.map?.name || md.map || 'Unknown');
      const mapId   = (md.map?.id   || md.map || '');
      const mKey = String(mapName).toLowerCase() || mapId;
      const mRec = mapMap.get(mKey) || { name: mapName, id: mapId, games: 0, wins: 0 };
      mRec.games++;
      if (r === 'win') mRec.wins++;
      mapMap.set(mKey, mRec);

      // Weapons — walk each round's player_stats kill events. Not all shapes
      // expose this; stay tolerant.
      const rds = Array.isArray(m.rounds) ? m.rounds : [];
      for (const rd of rds) {
        const ps = Array.isArray(rd.player_stats) ? rd.player_stats : [];
        const mine = ps.find((x) => x && x.player_puuid === puuid);
        if (!mine) continue;
        const kills = Array.isArray(mine.kill_events) ? mine.kill_events : [];
        for (const ke of kills) {
          const wid = ke.damage_weapon_id || ke.weapon_id;
          if (!wid) continue;
          const rec = weaponMap.get(wid) || { id: wid, kills: 0, hs: 0, bs: 0, ls: 0 };
          rec.kills++;
          // Sum damage events within this kill to infer bodypart — if present.
          const dmgs = Array.isArray(ke.damage_events) ? ke.damage_events : [];
          for (const de of dmgs) {
            rec.hs += de.headshots || 0;
            rec.bs += de.bodyshots || 0;
            rec.ls += de.legshots || 0;
          }
          weaponMap.set(wid, rec);
        }
      }
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
      topAgents: [...agentMap.values()]
        .map((r) => ({ ...r, acs: r.rounds ? r.score / r.rounds : NaN, kda: r.d ? (r.k + r.a) / r.d : NaN }))
        .sort((x, y) => y.games - x.games),
      topMaps: [...mapMap.values()]
        .sort((x, y) => y.games - x.games),
      topWeapons: [...weaponMap.values()]
        .map((w) => {
          const total = w.hs + w.bs + w.ls;
          return { ...w, hsPct: total ? w.hs / total : NaN };
        })
        .sort((x, y) => y.kills - x.kills)
        .slice(0, 8),
    };
  }

  // ---- render ---------------------------------------------------------
  function renderProfile(account, mmr, matches) {
    // Card background — Henrik returns `card` as a UUID string. Build the CDN URL ourselves.
    // Fall back to the old object shape just in case they roll it back later.
    const cardUuid = typeof account?.card === 'string'
      ? account.card
      : (account?.card?.id || '');
    const cardUrl = cardUuid ? CARD_CDN(cardUuid)
      : (account?.card?.large || account?.card?.wide || account?.card?.small || '');
    profileBg.style.backgroundImage = cardUrl ? `url("${cardUrl}")` : 'none';

    nameDisplay.textContent = account?.name || '—';
    tagDisplay.textContent  = account?.tag ? `#${account.tag}` : '';
    levelEl.textContent     = `Level ${account?.account_level ?? '—'}`;
    regionDisplay.textContent = `Region ${(account?.region || '—').toUpperCase()}`;

    // Recent-agent portrait — use the most recent match the player appears in.
    const recent = Array.isArray(matches)
      ? matches.map((m) => ({ m, self: findSelf(m, account?.puuid) })).find((x) => x.self)
      : null;
    if (recent && recent.self) {
      const rid = (recent.self.agent && recent.self.agent.id) || recent.self.character_id || '';
      const rname = (recent.self.agent && recent.self.agent.name) || recent.self.character || '';
      if (rid) {
        recentAgentImg.src = AGENT_CDN(rid);
        recentAgentName.textContent = rname || '—';
        recentAgentWrap.hidden = false;
      } else {
        recentAgentWrap.hidden = true;
      }
    } else {
      recentAgentWrap.hidden = true;
    }

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

  function renderAgentBreakdown(listEl, rows) {
    if (!rows.length) {
      listEl.innerHTML = '<div class="val-breakdown-empty">No match data.</div>';
      return;
    }
    listEl.innerHTML = rows.slice(0, 6).map((r) => {
      const wr = r.games ? r.wins / r.games : 0;
      const wrClass = wr >= 0.55 ? 'pos' : wr <= 0.45 ? 'neg' : '';
      const fillClass = wr < 0.5 ? 'neg' : '';
      const fillWidth = Math.max(4, Math.min(100, Math.round(wr * 100)));
      const icon = r.id
        ? `<img src="${esc(AGENT_CDN(r.id))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>`
        : `<div style="width:32px;height:32px;background:var(--bg-0);border-radius:var(--radius-sm);"></div>`;
      const acs = Number.isFinite(r.acs) ? fmtNum(r.acs, 0) + ' ACS' : '—';
      const kda = Number.isFinite(r.kda) ? fmtNum(r.kda, 2) : '—';
      return `
        <div class="val-breakdown-row rich">
          ${icon}
          <div class="val-breakdown-name">${esc(r.name)}</div>
          <div class="val-agent-stats">
            <div class="val-agent-kda">${r.k}<span class="sep">/</span>${r.d}<span class="sep">/</span>${r.a}  ·  ${kda}</div>
            <div class="val-agent-acs">${esc(acs)}</div>
          </div>
          <div class="val-wr-bar" title="${fmtPct(wr)} winrate">
            <div class="val-wr-bar-fill ${fillClass}" style="width:${fillWidth}%"></div>
          </div>
          <div class="val-breakdown-wr ${wrClass}">${fmtPct(wr)}<br/><span class="val-breakdown-games" style="min-width:0;">${r.games}G</span></div>
        </div>
      `;
    }).join('');
  }

  function renderMapBreakdown(listEl, rows) {
    if (!rows.length) {
      listEl.innerHTML = '<div class="val-breakdown-empty">No match data.</div>';
      return;
    }
    listEl.innerHTML = rows.slice(0, 6).map((r) => {
      const wr = r.games ? r.wins / r.games : 0;
      const wrClass = wr >= 0.55 ? 'pos' : wr <= 0.45 ? 'neg' : '';
      const fillClass = wr < 0.5 ? 'neg' : '';
      const fillWidth = Math.max(4, Math.min(100, Math.round(wr * 100)));
      const splash = mapSplash(r.name) || mapSplash(r.id);
      const icon = splash
        ? `<img src="${esc(splash)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>`
        : `<div style="width:32px;height:32px;background:var(--bg-0);border-radius:var(--radius-sm);"></div>`;
      return `
        <div class="val-breakdown-row rich">
          ${icon}
          <div class="val-breakdown-name">${esc(r.name)}</div>
          <div class="val-agent-stats">
            <div class="val-agent-kda">${r.wins}<span class="sep">W</span>${r.games - r.wins}<span class="sep">L</span></div>
            <div class="val-agent-acs">${r.games} match${r.games === 1 ? '' : 'es'}</div>
          </div>
          <div class="val-wr-bar" title="${fmtPct(wr)} winrate">
            <div class="val-wr-bar-fill ${fillClass}" style="width:${fillWidth}%"></div>
          </div>
          <div class="val-breakdown-wr ${wrClass}">${fmtPct(wr)}<br/><span class="val-breakdown-games" style="min-width:0;">${r.games}G</span></div>
        </div>
      `;
    }).join('');
  }

  function renderWeapons(weapons) {
    if (!weapons || !weapons.length) {
      weaponsEl.innerHTML = '<div class="val-weapons-empty">Weapon-level data isn\u2019t available for these matches.</div>';
      if (weaponsRange) weaponsRange.textContent = '/ kills + headshot %';
      return;
    }
    const top = weapons.slice(0, 8);
    const totalKills = top.reduce((s, w) => s + w.kills, 0);
    weaponsRange.textContent = `/ ${totalKills} tracked kills`;
    weaponsEl.innerHTML = top.map((w) => {
      const info = weaponInfo(w.id);
      const name = info?.displayName || 'Unknown';
      const killIcon = info?.killStreamIcon || info?.displayIcon || '';
      const hsPct = w.hsPct;
      const hsText = Number.isFinite(hsPct) ? fmtPct(hsPct, 0) + ' HS' : 'HS —';
      const hsClass = !Number.isFinite(hsPct) ? '' : hsPct >= 0.30 ? 'elite' : hsPct >= 0.22 ? 'hot' : '';
      const imgTag = killIcon
        ? `<img class="val-weapon-img" src="${esc(killIcon)}" alt="" loading="lazy" onerror="this.style.display='none'"/>`
        : '';
      return `
        <div class="val-weapon">
          <div class="val-weapon-name" title="${esc(name)}">${esc(name)}</div>
          <div class="val-weapon-row">
            <div class="val-weapon-kills">${w.kills}</div>
            <div class="val-weapon-hs ${hsClass}">${esc(hsText)}</div>
          </div>
          ${imgTag}
        </div>
      `;
    }).join('');
  }

  // All players in a match — normalises v2 (players.all_players) and v4 (players array).
  function allPlayers(match) {
    const p = match && match.players;
    if (!p) return [];
    if (Array.isArray(p)) return p;
    if (Array.isArray(p.all_players)) return p.all_players;
    return [];
  }

  function playerTeamId(p) {
    return String(p.team_id || p.team || '').toLowerCase();
  }

  function playerAcs(p, totalRounds) {
    const score = p.stats?.score;
    if (!Number.isFinite(score) || !totalRounds) return null;
    return Math.round(score / totalRounds);
  }

  function playerHsPct(p) {
    const s = p.stats || {};
    const hs = s.headshots || 0, bs = s.bodyshots || 0, ls = s.legshots || 0;
    const total = hs + bs + ls;
    return total ? hs / total : null;
  }

  function renderScoreboard(match, puuid) {
    const players = allPlayers(match);
    if (!players.length) return '<div class="val-rr-empty">No scoreboard data for this match.</div>';

    const teams = Array.isArray(match.teams) ? match.teams : (match.teams ? Object.values(match.teams) : []);
    const totalRounds = roundCount(match) || 1;

    // Group + sort by ACS desc.
    const groups = new Map(); // team_id -> { players[], team obj, won, rounds }
    for (const p of players) {
      const key = playerTeamId(p) || 'unknown';
      if (!groups.has(key)) groups.set(key, { key, players: [] });
      groups.get(key).players.push(p);
    }
    for (const t of teams) {
      const key = String(t.team_id || t.team || '').toLowerCase();
      const g = groups.get(key);
      if (!g) continue;
      g.team = t;
      g.won = typeof t.won === 'boolean' ? t.won : null;
      g.rounds = (t.rounds?.won ?? t.rounds_won) ?? null;
    }
    const groupList = [...groups.values()];
    // Sort so the self-team appears first.
    const selfTeam = playerTeamId(players.find((p) => p.puuid === puuid) || {});
    groupList.sort((a, b) => {
      if (a.key === selfTeam && b.key !== selfTeam) return -1;
      if (b.key === selfTeam && a.key !== selfTeam) return 1;
      return (b.rounds ?? 0) - (a.rounds ?? 0);
    });

    return groupList.map((g) => {
      g.players.sort((x, y) => (y.stats?.score ?? 0) - (x.stats?.score ?? 0));
      const teamLabel = g.key ? g.key.toUpperCase() : 'TEAM';
      const isWin = g.won === true;
      const isLoss = g.won === false;
      const resultClass = isWin ? 'win' : isLoss ? 'loss' : '';
      const rounds = g.rounds != null ? g.rounds : '';

      const rows = g.players.map((p) => {
        const aid = (p.agent && p.agent.id) || p.character_id || '';
        const aname = (p.agent && p.agent.name) || p.character || '';
        const self = p.puuid === puuid;
        const s = p.stats || {};
        const acs = playerAcs(p, totalRounds);
        const hs = playerHsPct(p);
        return `
          <div class="val-sb-row ${self ? 'self' : ''}">
            ${aid ? `<img class="val-sb-agent" src="${esc(AGENT_CDN(aid))}" alt="${esc(aname)}" loading="lazy" onerror="this.style.visibility='hidden'"/>` : '<div class="val-sb-agent"></div>'}
            <div class="val-sb-name">${esc(p.name || '—')}<span class="sb-tag">#${esc(p.tag || '')}</span></div>
            <div class="val-sb-acs">${acs != null ? acs : '—'}</div>
            <div class="val-sb-kda">${s.kills ?? 0}/${s.deaths ?? 0}/${s.assists ?? 0}</div>
            <div class="val-sb-hs">${hs != null ? fmtPct(hs, 0) : '—'}</div>
          </div>
        `;
      }).join('');

      return `
        <div class="val-team">
          <div class="val-team-head">
            <div class="val-team-name ${resultClass}">${esc(teamLabel)}${isWin ? ' · Win' : isLoss ? ' · Loss' : ''}</div>
            <div class="val-team-score">${rounds}</div>
          </div>
          <div class="val-scoreboard">
            <div class="val-scoreboard-head">
              <span></span><span>Player</span><span>ACS</span><span>K/D/A</span><span>HS%</span>
            </div>
            ${rows}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderMatches(matches, puuid, freshIds = new Set()) {
    if (!matches.length) {
      matchesEl.innerHTML = '<div class="val-matches-empty">No matches found for this player.</div>';
      matchesCount.textContent = '0';
      return;
    }
    matchesCount.textContent = String(matches.length);

    const wraps = matches.map((m, idx) => {
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
      const isFresh = freshIds.has(matchId(m));

      return `
        <div class="val-match-wrap${isFresh ? ' fresh' : ''}" data-match-idx="${idx}">
          <div class="val-match" data-result="${r}" role="button" tabindex="0" aria-expanded="false">
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
            <span class="val-match-toggle" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </span>
          </div>
          <div class="val-match-details">
            <div class="val-match-details-inner">
              <div class="val-match-details-body" data-rendered="0"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    matchesEl.innerHTML = wraps || '<div class="val-matches-empty">No matches found for this player.</div>';

    // Lazy-render scoreboard on first open so we don't chew DOM up-front.
    matchesEl.querySelectorAll('.val-match-wrap').forEach((wrap) => {
      const header = wrap.querySelector('.val-match');
      const body = wrap.querySelector('.val-match-details-body');
      const toggle = () => {
        const willOpen = !wrap.classList.contains('open');
        if (willOpen && body.dataset.rendered !== '1') {
          const idx = Number(wrap.dataset.matchIdx);
          const m = matches[idx];
          body.innerHTML = renderScoreboard(m, puuid);
          body.dataset.rendered = '1';
        }
        wrap.classList.toggle('open', willOpen);
        header.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      };
      header.addEventListener('click', toggle);
      header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
  }

  // ---- Session summary (today's games) ------------------------------
  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function computeSession(matches, history, puuid) {
    const todayStart = startOfToday();
    const todays = matches.filter((m) => matchStartMs(m) >= todayStart);

    let wins = 0, losses = 0, draws = 0;
    const form = []; // oldest→newest
    for (const m of [...todays].reverse()) {
      const self = findSelf(m, puuid);
      const r = matchResult(m, self);
      if (r === 'win') wins++;
      else if (r === 'loss') losses++;
      else if (r === 'draw') draws++;
      form.push(r === 'win' ? 'W' : r === 'loss' ? 'L' : r === 'draw' ? 'D' : '?');
    }

    // Streak — consecutive W's or L's at the most recent end.
    let streakCount = 0, streakKind = '';
    for (let i = todays.length - 1; i >= 0; i--) {
      const self = findSelf(todays[i], puuid);
      const r = matchResult(todays[i], self);
      if (!streakKind) streakKind = r;
      if (r !== streakKind || (r !== 'win' && r !== 'loss')) break;
      streakCount++;
    }

    // Net RR today — sum deltas from history entries with timestamps ≥ todayStart.
    let netRr = 0;
    if (Array.isArray(history)) {
      for (const h of history) {
        const t = (h.date && Date.parse(h.date)) || (typeof h.date_raw === 'number' ? h.date_raw * 1000 : 0);
        if (t && t >= todayStart) {
          const delta = h.mmr_change_to_last_game ?? h.last_mmr_change ?? h.mmr_change ?? 0;
          netRr += Number(delta) || 0;
        }
      }
    }

    return {
      games: todays.length,
      wins, losses, draws,
      netRr,
      streakCount,
      streakKind,
      form,
    };
  }

  function renderSession(sess) {
    if (!sess || !sess.games) {
      sessionEl.hidden = true;
      return;
    }
    sessionEl.hidden = false;
    const fmtDate = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    sessionSub.textContent = fmtDate;
    sessionGames.textContent = String(sess.games);
    sessionGames.className = 'val-session-value';
    sessionWl.textContent = `${sess.wins}\u2013${sess.losses}`;
    sessionWl.className = 'val-session-value ' + (sess.wins > sess.losses ? 'pos' : sess.losses > sess.wins ? 'neg' : '');

    sessionRr.textContent = fmtRr(sess.netRr);
    sessionRr.className = 'val-session-value ' + (sess.netRr > 0 ? 'pos' : sess.netRr < 0 ? 'neg' : '');

    if (sess.streakCount >= 2 && (sess.streakKind === 'win' || sess.streakKind === 'loss')) {
      const prefix = sess.streakKind === 'win' ? 'W' : 'L';
      sessionStreak.textContent = `${sess.streakCount}${prefix}`;
      sessionStreak.className = 'val-session-value ' + (sess.streakKind === 'win' ? 'pos' : 'neg');
    } else {
      sessionStreak.textContent = '—';
      sessionStreak.className = 'val-session-value';
    }

    sessionForm.innerHTML = '';
    const pills = document.createElement('div');
    pills.className = 'val-session-form-pills';
    sess.form.slice(-7).forEach((r) => {
      const pill = document.createElement('span');
      const kind = r === 'W' ? 'win' : r === 'L' ? 'loss' : 'draw';
      pill.className = `val-session-form-pill ${kind}`;
      pill.textContent = r;
      pills.appendChild(pill);
    });
    sessionForm.appendChild(pills);
  }

  // ---- RR history chart ---------------------------------------------
  function renderMmrHistory(history) {
    if (!Array.isArray(history) || history.length < 2) {
      rrChartEl.innerHTML = '<div class="val-rr-empty">Not enough RR history yet — play a few competitive games.</div>';
      return;
    }

    // Henrik returns newest-first; chart left-to-right = oldest-first.
    const data = history.slice(0, 20).slice().reverse();

    const points = data.map((g) => ({
      rr: g.elo ?? (g.ranking_in_tier ?? 0) + (g.currenttier ?? 0) * 100,
      delta: g.mmr_change_to_last_game ?? 0,
      tier: g.currenttierpatched || g.currenttier_patched || '',
    }));

    const minRr = Math.min(...points.map((p) => p.rr));
    const maxRr = Math.max(...points.map((p) => p.rr));
    const span = Math.max(maxRr - minRr, 1);

    const W = 720, H = 160, PL = 12, PR = 12, PT = 18, PB = 18;
    const chartW = W - PL - PR;
    const chartH = H - PT - PB;

    const x = (i) => PL + (points.length === 1 ? chartW / 2 : (i / (points.length - 1)) * chartW);
    const y = (rr) => PT + chartH - ((rr - minRr) / span) * chartH;

    const linePts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.rr).toFixed(1)}`).join(' ');
    const area = `M ${x(0).toFixed(1)},${(PT + chartH).toFixed(1)} L ${linePts.split(' ').join(' L ')} L ${x(points.length - 1).toFixed(1)},${(PT + chartH).toFixed(1)} Z`;

    const dots = points.map((p, i) => {
      const cx = x(i).toFixed(1);
      const cy = y(p.rr).toFixed(1);
      const col = p.delta > 0 ? '#7ed99d' : p.delta < 0 ? '#e38686' : '#a78bfa';
      return `<circle cx="${cx}" cy="${cy}" r="2.8" fill="${col}"><title>${p.tier}  ·  ${p.delta >= 0 ? '+' : ''}${p.delta} RR</title></circle>`;
    }).join('');

    const totalDelta = points.reduce((s, p) => s + (p.delta || 0), 0);
    const last5 = points.slice(-5).reduce((s, p) => s + (p.delta || 0), 0);
    const wins = points.filter((p) => p.delta > 0).length;
    const losses = points.filter((p) => p.delta < 0).length;

    const fmt = (n) => `${n >= 0 ? '+' : ''}${n}`;
    const clsDelta = (n) => n > 0 ? 'pos' : n < 0 ? 'neg' : '';

    rrChartEl.innerHTML = `
      <div class="val-rr-summary">
        <div><strong>Net</strong><span class="${clsDelta(totalDelta)}">${fmt(totalDelta)} RR</span></div>
        <div><strong>Last 5</strong><span class="${clsDelta(last5)}">${fmt(last5)} RR</span></div>
        <div><strong>W–L</strong><span>${wins}–${losses}</span></div>
        <div><strong>Games</strong><span>${points.length}</span></div>
      </div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="rrArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="#a78bfa" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#a78bfa" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <!-- baseline grid -->
        <line x1="${PL}" y1="${PT + chartH}" x2="${W - PR}" y2="${PT + chartH}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
        <line x1="${PL}" y1="${PT}" x2="${W - PR}" y2="${PT}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
        <path d="${area}" fill="url(#rrArea)"/>
        <polyline points="${linePts}" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
      </svg>
    `;
  }

  // ---- main flow ------------------------------------------------------
  let inFlight = 0;
  // Context of the last successful search — used by live-mode polling and
  // new-match detection so we know what to refetch.
  let lastCtx = null; // { name, tag, region, puuid, matchIds: Set<string> }

  async function runSearch(name, tag, region, opts = {}) {
    const { silent = false, fromLive = false } = opts;
    const token = ++inFlight;
    if (!silent) {
      setStatus('loading', 'Fetching…');
      disableForm(true);
    } else {
      liveIndicator.hidden = false;
    }

    try {
      // Kick off meta fetches in the background — they only matter for map /
      // weapon icons, so we render without blocking on them.
      loadMeta('maps', 'https://valorant-api.com/v1/maps', STORAGE_MAPS);
      loadMeta('weapons', 'https://valorant-api.com/v1/weapons', STORAGE_WEAPONS);

      const accountRes = await proxy('/val/account', { name, tag });
      if (token !== inFlight) return;
      const account = accountRes?.data;
      if (!account || !account.puuid) throw new Error('Player not found');

      // Account data can tell us the authoritative region — prefer it over the form.
      const resolvedRegion = (account.region || region).toLowerCase();

      // Parallel: MMR + matches + MMR history (competitive only for cleaner stats).
      // History is best-effort — a missing/rate-limited history shouldn't block the rest.
      const [mmrRes, matchesRes, historyRes] = await Promise.all([
        proxy('/val/mmr', { region: resolvedRegion, platform: 'pc', name, tag }).catch((e) => ({ __err: e })),
        proxy('/val/matches', { region: resolvedRegion, platform: 'pc', name, tag, size: 20, mode: 'competitive' }).catch((e) => ({ __err: e })),
        proxy('/val/mmr-history', { region: resolvedRegion, name, tag }).catch((e) => ({ __err: e })),
      ]);
      if (token !== inFlight) return;

      const mmr = mmrRes && !mmrRes.__err ? mmrRes.data : null;
      const matches = (matchesRes && !matchesRes.__err && Array.isArray(matchesRes.data)) ? matchesRes.data : [];
      const history = (historyRes && !historyRes.__err && Array.isArray(historyRes.data)) ? historyRes.data : [];

      // Wait a tick for meta (maps/weapons) if it's about to land — max ~300ms.
      if (!metaCache.maps || !metaCache.weapons) {
        await Promise.race([
          Promise.all([
            loadMeta('maps', 'https://valorant-api.com/v1/maps', STORAGE_MAPS),
            loadMeta('weapons', 'https://valorant-api.com/v1/weapons', STORAGE_WEAPONS),
          ]),
          new Promise((r) => setTimeout(r, 300)),
        ]);
      }

      // Detect new matches vs previous state so we can pulse them.
      const prevIds = fromLive && lastCtx ? lastCtx.matchIds : null;
      const freshIds = new Set();
      if (prevIds) {
        for (const m of matches) {
          const id = matchId(m);
          if (id && !prevIds.has(id)) freshIds.add(id);
        }
      }

      renderProfile(account, mmr, matches);
      renderMmrHistory(history);

      if (matches.length) {
        const agg = aggregateStats(matches, account.puuid);
        renderStats(agg);
        renderAgentBreakdown(topAgents, agg.topAgents);
        renderMapBreakdown(topMaps, agg.topMaps);
        renderWeapons(agg.topWeapons);
        renderSession(computeSession(matches, history, account.puuid));
        renderMatches(matches, account.puuid, freshIds);
      } else {
        // Wipe to empty state so a previous search doesn't linger.
        renderStats({ played: 0, wins: 0, losses: 0, winrate: NaN, kda: NaN, k:0, d:0, a:0, hsPct: NaN, acs: NaN, dpr: NaN, kills: 0, rounds: 0 });
        renderAgentBreakdown(topAgents, []);
        renderMapBreakdown(topMaps, []);
        renderWeapons([]);
        renderSession(null);
        renderMatches([], account.puuid, new Set());
      }

      dashboard.classList.remove('hidden');
      // Restart the rise animation so re-searches look alive.
      // eslint-disable-next-line no-unused-expressions
      dashboard.offsetWidth;

      // Track context for future polls.
      lastCtx = {
        name: account.name,
        tag: account.tag,
        region: resolvedRegion,
        puuid: account.puuid,
        matchIds: new Set(matches.map(matchId).filter(Boolean)),
      };

      if (fromLive && freshIds.size > 0) {
        toast(`${freshIds.size} new match${freshIds.size === 1 ? '' : 'es'}`);
      }

      if (!silent) {
        setStatus('ok', `Loaded ${account.name}#${account.tag}`);
      }
      writeUrlState(account.name, account.tag, resolvedRegion);
      localStorage.setItem(STORAGE_LAST, `${account.name}#${account.tag}`);
      localStorage.setItem(STORAGE_REGION, resolvedRegion);
    } catch (err) {
      if (token !== inFlight) return;
      if (silent) {
        console.warn('[val] silent refresh failed', err);
      } else {
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
      }
    } finally {
      if (token === inFlight) {
        if (!silent) disableForm(false);
        // Hide the refreshing indicator on the next tick so users see at least
        // a brief pulse even on very fast responses.
        setTimeout(() => { liveIndicator.hidden = !liveMode; }, 400);
      }
    }
  }

  // ---- Live mode: poll matches every 30s while tab is visible --------
  let liveMode = false;
  let livePollTimer = null;
  const LIVE_INTERVAL_MS = 30_000;

  function livePollTick() {
    if (!liveMode || !lastCtx) return;
    if (document.hidden) return; // pause while tab is backgrounded
    runSearch(lastCtx.name, lastCtx.tag, lastCtx.region, { silent: true, fromLive: true });
  }

  function setLiveMode(on) {
    liveMode = !!on;
    clearInterval(livePollTimer);
    if (liveMode) {
      liveBtn.classList.add('active');
      liveLabel.textContent = 'Live';
      liveIndicator.hidden = false;
      livePollTimer = setInterval(livePollTick, LIVE_INTERVAL_MS);
      toast('Live tracking on');
    } else {
      liveBtn.classList.remove('active');
      liveLabel.textContent = 'Go Live';
      liveIndicator.hidden = true;
      toast('Live tracking off');
    }
  }

  document.addEventListener('visibilitychange', () => {
    // Fire an immediate refresh when the user returns to the tab if live.
    if (liveMode && !document.hidden) livePollTick();
  });

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

  shareBtn.addEventListener('click', async () => {
    if (!lastCtx) {
      // No search yet — build URL from current form state.
      const nm = nameInput.value.trim();
      const tg = tagInput.value.trim();
      if (!nm || !tg) {
        toast('Search for a player first');
        return;
      }
      writeUrlState(nm, tg, regionSelect.value);
    }
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.classList.add('copied');
      shareLabel.textContent = 'Copied';
      toast('Link copied');
      setTimeout(() => {
        shareBtn.classList.remove('copied');
        shareLabel.textContent = 'Share';
      }, 1500);
    } catch {
      toast('Copy failed — select the URL manually');
    }
  });

  liveBtn.addEventListener('click', () => {
    if (!lastCtx) {
      toast('Search for a player first');
      return;
    }
    setLiveMode(!liveMode);
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
  // common.js's section-observer only runs on .page (scroll-snap) layouts.
  // The val page uses natural scroll (.val-page), so we manually activate the
  // hero section so its .reveal children animate in consistently with the rest
  // of the site. Dashboard content appears after search — no reveal on it.
  const heroSection = document.querySelector('.val-hero');
  if (heroSection) heroSection.classList.add('is-active');

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
