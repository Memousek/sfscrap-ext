const STORAGE_KEY = "sf_scrapbook_state_v1";

function missingIds(saved) {
  const ownedIds = new Set(Array.isArray(saved.ownedIds) ? saved.ownedIds.map((n) => Number(n)) : []);
  const players = Array.isArray(saved.players) ? saved.players : [];
  const byId = new Map(players.map((p) => [String(p.playerId), p]));
  const preferredId = saved.selectedPlayerId || saved.lastPlayerId;
  const player = preferredId ? byId.get(String(preferredId)) : players[players.length - 1];
  if (!player || !Array.isArray(player.itemIds)) {
    return [];
  }
  return player.itemIds
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0 && !ownedIds.has(n));
}

function selectedPlayer(saved) {
  const players = Array.isArray(saved.players) ? saved.players : [];
  const byId = new Map(players.map((p) => [String(p.playerId), p]));
  const preferredId = saved.selectedPlayerId || saved.lastPlayerId;
  return preferredId ? byId.get(String(preferredId)) || null : null;
}

async function render() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const saved = data[STORAGE_KEY] || {};

  const owned = Array.isArray(saved.ownedIds) ? saved.ownedIds.length : 0;
  const players = Array.isArray(saved.players) ? saved.players.length : 0;

  const ownedNode = document.getElementById("owned");
  const playersNode = document.getElementById("players");
  const statusNode = document.getElementById("status");
  const debugPlayerNode = document.getElementById("debug-player");
  const debugOwnedNode = document.getElementById("debug-owned");
  const debugPlayerItemsNode = document.getElementById("debug-player-items");
  const debugMissingNode = document.getElementById("debug-missing");

  if (ownedNode) {
    ownedNode.textContent = String(owned);
  }
  if (playersNode) {
    playersNode.textContent = String(players);
  }
  if (statusNode) {
    statusNode.textContent =
      owned > 0
        ? "Data načtena. Otevři Síň slávy a skenuj hráče."
        : "Ještě nemám scrapbook data. Otevři scrapbook ve hře.";
  }

  const ownedIds = Array.isArray(saved.ownedIds)
    ? saved.ownedIds.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  const player = selectedPlayer(saved);
  const playerIds =
    player && Array.isArray(player.itemIds)
      ? player.itemIds.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
      : [];
  const missing = missingIds(saved);
  const playerName = player?.playerName || saved.selectedPlayerName || "-";

  if (debugPlayerNode) {
    debugPlayerNode.textContent = String(playerName);
  }
  if (debugOwnedNode) {
    debugOwnedNode.value = ownedIds.length ? ownedIds.join(", ") : "-";
  }
  if (debugPlayerItemsNode) {
    debugPlayerItemsNode.value = playerIds.length ? playerIds.join(", ") : "-";
  }
  if (debugMissingNode) {
    debugMissingNode.value = missing.length ? missing.join(", ") : "-";
  }
}

function setupTabs() {
  const overviewTab = document.getElementById("tab-overview");
  const toolsTab = document.getElementById("tab-tools");
  const debugTab = document.getElementById("tab-debug");
  const overviewPanel = document.getElementById("panel-overview");
  const toolsPanel = document.getElementById("panel-tools");
  const debugPanel = document.getElementById("panel-debug");

  function activate(which) {
    const isOverview = which === "overview";
    const isTools = which === "tools";
    const isDebug = which === "debug";
    overviewTab?.classList.toggle("is-active", isOverview);
    toolsTab?.classList.toggle("is-active", isTools);
    debugTab?.classList.toggle("is-active", isDebug);
    overviewPanel?.classList.toggle("is-active", isOverview);
    toolsPanel?.classList.toggle("is-active", isTools);
    debugPanel?.classList.toggle("is-active", isDebug);
  }

  overviewTab?.addEventListener("click", () => activate("overview"));
  toolsTab?.addEventListener("click", () => activate("tools"));
  debugTab?.addEventListener("click", () => activate("debug"));
}

document.getElementById("copy-missing")?.addEventListener("click", async () => {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const saved = data[STORAGE_KEY] || {};
  const missing = missingIds(saved);
  if (!missing.length) {
    return;
  }
  await navigator.clipboard.writeText(missing.join(", "));
});

document.getElementById("reset")?.addEventListener("click", async () => {
  await chrome.storage.local.remove(STORAGE_KEY);
  await render();
});

setupTabs();
render();
