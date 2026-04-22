(() => {
  const SOURCE = "sf-scrapbook-helper";
  const STORAGE_KEY = "sf_scrapbook_state_v1";
  const KEYS_OWNED_HINT = [
    "scrapbook",
    "album",
    "owned",
    "collected",
    "collecteditems"
  ];
  const KEYS_PLAYER_HINT = [
    "equipment",
    "items",
    "inventory",
    "gear",
    "playeritems"
  ];

  // S&F API: each item slot = 19 integers; 10 slots = 190 integers total
  const SF_ITEM_PARSE_LEN = 19;
  // EquipmentSlot enum order (sf-api: Hat, BreastPlate, Gloves, FootWear, Amulet, Belt, Ring, Talisman, Weapon, Shield)
  const SF_SLOT_ORDER = ["Hat", "BreastPlate", "Gloves", "FootWear", "Amulet", "Belt", "Ring", "Talisman", "Weapon", "Shield"];
  // Scrapbook range table from sf-api/src/gamestate/unlockables.rs
  // Format: [rangeStart, rangeEnd, slotName, classId (0=none,1=W,2=M,3=S), isEpic, ignoredAbsolutePositions]
  const SF_SCRAPBOOK_RANGES = [
    [801, 1011, "Amulet", 0, false, []],
    [1011, 1051, "Amulet", 0, true, []],
    [1051, 1211, "Ring", 0, false, []],
    [1211, 1251, "Ring", 0, true, []],
    [1251, 1325, "Talisman", 0, false, []],
    [1325, 1365, "Talisman", 0, true, []],
    [1365, 1665, "Weapon", 1, false, []],
    [1665, 1705, "Weapon", 1, true, []],
    [1705, 1805, "Shield", 1, false, []],
    [1805, 1845, "Shield", 1, true, []],
    [1845, 1945, "BreastPlate", 1, false, []],
    [1945, 1985, "BreastPlate", 1, true, [1954, 1955]],
    [1985, 2085, "FootWear", 1, false, []],
    [2085, 2125, "FootWear", 1, true, [2094, 2095]],
    [2125, 2225, "Gloves", 1, false, []],
    [2225, 2265, "Gloves", 1, true, [2234, 2235]],
    [2265, 2365, "Hat", 1, false, []],
    [2365, 2405, "Hat", 1, true, [2374, 2375]],
    [2405, 2505, "Belt", 1, false, []],
    [2505, 2545, "Belt", 1, true, [2514, 2515]],
    [2545, 2645, "Weapon", 2, false, []],
    [2645, 2685, "Weapon", 2, true, []],
    [2685, 2785, "BreastPlate", 2, false, []],
    [2785, 2825, "BreastPlate", 2, true, [2794, 2795]],
    [2825, 2925, "FootWear", 2, false, []],
    [2925, 2965, "FootWear", 2, true, [2934, 2935]],
    [2965, 3065, "Gloves", 2, false, []],
    [3065, 3105, "Gloves", 2, true, [3074, 3075]],
    [3105, 3205, "Hat", 2, false, []],
    [3205, 3245, "Hat", 2, true, [3214, 3215]],
    [3245, 3345, "Belt", 2, false, []],
    [3345, 3385, "Belt", 2, true, [3354, 3355]],
    [3385, 3485, "Weapon", 3, false, []],
    [3485, 3525, "Weapon", 3, true, []],
    [3525, 3625, "BreastPlate", 3, false, []],
    [3625, 3665, "BreastPlate", 3, true, [3634, 3635]],
    [3665, 3765, "FootWear", 3, false, []],
    [3765, 3805, "FootWear", 3, true, [3774, 3775]],
    [3805, 3905, "Gloves", 3, false, []],
    [3905, 3945, "Gloves", 3, true, [3914, 3915]],
    [3945, 4045, "Hat", 3, false, []],
    [4045, 4085, "Hat", 3, true, [4054, 4055]],
    [4085, 4185, "Belt", 3, false, []],
    [4185, 4225, "Belt", 3, true, [4194, 4195]],
  ];

  const state = {
    ownedIds: new Set(),
    pendingOwnedIds: new Set(),
    scrapbookReady: false,
    players: new Map(),
    lastPlayerId: null,
    selectedPlayerId: null,
    selectedPlayerName: null,
    overlayPosition: null,
    overlayHidden: false,
    lastSid: null,
    lastScrapbookRefreshAt: 0,
    responsesSeen: 0,
    textResponsesSeen: 0,
    lastPayloadType: "-",
    lastUrl: "-"
  };

  function toNumberSet(values) {
    const output = new Set();
    for (const item of values) {
      const n = Number(item);
      if (Number.isInteger(n) && n > 0) {
        output.add(n);
      }
    }
    return output;
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function looksLikeItemArray(arr) {
    if (!Array.isArray(arr) || arr.length < 3) {
      return false;
    }
    const sample = arr.slice(0, 10);
    const score = sample.filter((x) => Number.isInteger(Number(x)) && Number(x) > 0).length;
    return score >= Math.max(3, Math.floor(sample.length * 0.7));
  }

  function looksLikeOwnedArray(arr) {
    return looksLikeItemArray(arr) && arr.length >= 10 && arr.length <= 2500;
  }

  function looksLikePlayerArray(arr) {
    return looksLikeItemArray(arr) && arr.length >= 5 && arr.length <= 40;
  }

  function numbersFromText(text) {
    if (typeof text !== "string" || text.length < 10) {
      return [];
    }
    const matches = text.match(/\b\d{1,6}\b/g) || [];
    return matches
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0 && value < 1000000);
  }

  function parseBinaryOwnedIds(text) {
    if (typeof text !== "string") {
      return null;
    }
    const compact = text.replace(/[^01]/g, "");
    const density = compact.length / Math.max(text.length, 1);
    if (density < 0.7) {
      return null;
    }
    if (compact.length < 128) {
      return null;
    }
    const ids = [];
    for (let i = 0; i < compact.length; i += 1) {
      if (compact[i] === "1") {
        ids.push(i + 1);
      }
    }
    if (ids.length < 10 || ids.length > 3000) {
      return null;
    }
    return toNumberSet(ids);
  }

  function parseHexOwnedIds(text) {
    if (typeof text !== "string") {
      return null;
    }
    const compact = text.toLowerCase().replace(/[^0-9a-f]/g, "");
    const density = compact.length / Math.max(text.length, 1);
    if (density < 0.7) {
      return null;
    }
    if (compact.length < 64) {
      return null;
    }
    const ids = [];
    let bitIndex = 1;
    for (const ch of compact) {
      const nibble = Number.parseInt(ch, 16);
      if (!Number.isInteger(nibble)) {
        return null;
      }
      for (let i = 0; i < 4; i += 1) {
        if (nibble & (1 << i)) {
          ids.push(bitIndex);
        }
        bitIndex += 1;
      }
    }
    if (ids.length < 10 || ids.length > 3000) {
      return null;
    }
    return toNumberSet(ids);
  }

  function extractBracketNumberArrays(text) {
    if (typeof text !== "string") {
      return [];
    }
    const blocks = text.match(/\[(?:\s*\d+\s*,?){5,}\s*\]/g) || [];
    return blocks
      .map((block) => {
        const nums = (block.match(/\d+/g) || []).map((value) => Number(value));
        return nums.filter((n) => Number.isInteger(n) && n > 0);
      })
      .filter((arr) => arr.length >= 5);
  }

  function parsePlayerIdFromUrl(url) {
    const text = String(url || "");
    const patterns = [
      /(?:playerid|player_id|target)=([0-9]{1,12})/i,
      /[?&]id=([1-9][0-9]{0,11})(?:[&#]|$)/i,
      /\/player\/([0-9]{1,12})/i,
      /\/characters\/([0-9]{1,12})/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        const normalized = String(Number(match[1]));
        if (normalized !== "0" && normalized !== "NaN") {
          return normalized;
        }
      }
    }
    return null;
  }

  function inferNameFromElement(element) {
    const text = (element?.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || text.length < 3) {
      return null;
    }
    if (/^\d+$/.test(text)) {
      return null;
    }
    return text.slice(0, 32);
  }

  function inferNameFromProfileDom() {
    const blockedNames = new Set([
      "Vybraný hráč",
      "Scanned player",

      "Player",
      "Scrapbook načten"
    ]);

    function sanitizeName(raw) {
      const compact = (raw || "").replace(/\s+/g, " ").trim();
      if (!compact) {
        return null;
      }
      const withoutGuild = compact.includes("[") ? compact.split("[")[0].trim() : compact;
      if (withoutGuild.length < 2 || withoutGuild.length > 28) {
        return null;
      }
      if (blockedNames.has(withoutGuild)) {
        return null;
      }
      if (/^\d+$/.test(withoutGuild)) {
        return null;
      }
      return withoutGuild;
    }

    const selectors = [
      // S&F-specific selectors (common in sfgame DOM)
      "#cname",
      ".othercname",
      ".cname",
      "#charname",
      ".charname",
      ".othername",
      // Generic fallbacks
      ".playername",
      ".character-name",
      "[data-player-name]"
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node && node.closest("#sfh-overlay")) {
        continue;
      }
      const name = sanitizeName(node?.textContent || "");
      if (name) {
        return name;
      }
    }

    return null;
  }

  function normalizePlayerLabel(raw) {
    const value = String(raw || "").replace(/\s+/g, " ").trim();
    if (!value) {
      return null;
    }
    const blocked = new Set([
      "Scanned player",
      "Vybraný hráč",
      "Player",
      "Scrapbook načten",
      "-"
    ]);
    if (blocked.has(value)) {
      return null;
    }
    const withoutGuild = value.includes("[") ? value.split("[")[0].trim() : value;
    if (!withoutGuild || withoutGuild.length < 2 || withoutGuild.length > 28) {
      return null;
    }
    if (/^\d+$/.test(withoutGuild)) {
      return null;
    }
    return withoutGuild;
  }

  function inferNameFromHallRow(target) {
    const row = target.closest("tr");
    if (!row || row.closest("#sfh-overlay")) {
      return null;
    }
    const cells = [...row.querySelectorAll("td")];
    if (!cells.length) {
      return null;
    }

    // Hall of Fame usually has player name in 2nd column.
    const preferred = cells[1] || cells[0];
    const direct = normalizePlayerLabel(preferred?.textContent || "");
    if (direct) {
      return direct;
    }

    for (const cell of cells) {
      const text = normalizePlayerLabel(cell.textContent || "");
      if (text) {
        return text;
      }
    }
    return null;
  }

  function looksLikeRelevantTextUrl(url) {
    const lower = String(url || "").toLowerCase();
    return (
      lower.includes("scrap") ||
      lower.includes("album") ||
      lower.includes("hall") ||
      lower.includes("player") ||
      lower.includes("character") ||
      lower.includes("req=")
    );
  }

  function getReqParam(url) {
    const raw = String(url || "");
    const match = raw.match(/[?&]req=([^&]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]).toLowerCase() : "";
  }

  function getSidParam(url) {
    const raw = String(url || "");
    const match = raw.match(/[?&]sid=([^&]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }

  function looksLikeScrapbookUrl(url) {
    const lower = String(url || "").toLowerCase();
    return lower.includes("scrap") || lower.includes("album") || lower.includes("playerpollscrapbook");
  }

  function looksLikeGameApiUrl(url) {
    const lower = String(url || "").toLowerCase();
    return lower.includes("/cmd.php") || lower.includes("req=");
  }

  function looksLikePlayerApiUrl(url) {
    if (!looksLikeGameApiUrl(url)) {
      return false;
    }
    const req = getReqParam(url);
    if (!req) {
      return false;
    }
    if (req.includes("playerpollscrapbook") || req.includes("deeds") || req === "poll") {
      return false;
    }
    return (
      req.includes("player") ||
      req.includes("hall") ||
      req.includes("look") ||
      req.includes("inspect") ||
      req.includes("fight")
    );
  }

  function decodeBase64Url(value) {
    if (typeof value !== "string" || !value.length) {
      return null;
    }
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    try {
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch {
      return null;
    }
  }

  function parseOwnedFromScrapbookRecord(text) {
    if (typeof text !== "string") {
      return null;
    }

    const match = text.match(/scrapbook\.r:([A-Za-z0-9_-]+)/);
    if (!match?.[1]) {
      return null;
    }

    const bytes = decodeBase64Url(match[1]);
    if (!bytes || !bytes.length) {
      return null;
    }

    const ids = [];
    let bitIndex = 1;
    for (const byte of bytes) {
      for (let bit = 0; bit < 8; bit += 1) {
        if (byte & (1 << bit)) {
          ids.push(bitIndex);
        }
        bitIndex += 1;
      }
    }

    if (ids.length < 10 || ids.length > 3000) {
      return null;
    }
    return toNumberSet(ids);
  }

  function extractOwnedIdsFromText(text) {
    const lower = text.toLowerCase();
    const scrapbookRecord = parseOwnedFromScrapbookRecord(text);
    if (scrapbookRecord) {
      return scrapbookRecord;
    }

    if (!KEYS_OWNED_HINT.some((hint) => lower.includes(hint))) {
      const binary = parseBinaryOwnedIds(text);
      if (binary) {
        return binary;
      }
      const hex = parseHexOwnedIds(text);
      if (hex) {
        return hex;
      }
      return null;
    }
    const arrays = extractBracketNumberArrays(text)
      .filter((arr) => looksLikeOwnedArray(arr))
      .sort((a, b) => b.length - a.length);
    if (arrays.length) {
      return toNumberSet(arrays[0]);
    }

    const nums = numbersFromText(text);
    if (nums.length >= 10 && nums.length <= 2500) {
      return toNumberSet(nums);
    }

    const binary = parseBinaryOwnedIds(text);
    if (binary) {
      return binary;
    }
    const hex = parseHexOwnedIds(text);
    if (hex) {
      return hex;
    }
    return null;
  }

  function extractDelimitedNumberArrays(text) {
    if (typeof text !== "string") {
      return [];
    }
    const matches = text.match(/(?:\d{1,6}[\/,:;|]){4,}\d{1,6}/g) || [];
    return matches
      .map((chunk) =>
        chunk
          .split(/[\/,:;|]/)
          .map((value) => Number(value))
          .filter((n) => Number.isInteger(n) && n >= 0 && n <= 1000000)
      )
      .filter((arr) => arr.length >= 5);
  }

  function extractBracketNumberArraysWithZero(text) {
    if (typeof text !== "string") {
      return [];
    }
    const blocks = text.match(/\[(?:\s*\d+\s*,?){5,}\s*\]/g) || [];
    return blocks
      .map((block) => {
        const nums = (block.match(/\d+/g) || []).map((value) => Number(value));
        return nums.filter((n) => Number.isInteger(n) && n >= 0 && n <= 1000000);
      })
      .filter((arr) => arr.length >= 5);
  }

  function extractNamedItemSegments(text) {
    if (typeof text !== "string") {
      return [];
    }
    const patterns = [
      /(items?|equipment|inventory|gear|playeritems?|loadout)\w*[:=]([0-9\/,;|:-]{10,})/gi,
      /(?:^|[&\s])(it|eq|inv)[:=]([0-9\/,;|:-]{10,})/gi
    ];
    const out = [];
    for (const pattern of patterns) {
      let match = pattern.exec(text);
      while (match) {
        const raw = match[2] || "";
        const values = raw
          .split(/[\/,:;| -]/)
          .map((v) => Number(v))
          .filter((n) => Number.isInteger(n) && n >= 0 && n <= 1000000);
        if (values.length >= 5) {
          out.push(values);
        }
        match = pattern.exec(text);
      }
      pattern.lastIndex = 0;
    }
    return out;
  }

  function extractPlayerNameFromText(text) {
    if (typeof text !== "string") {
      return null;
    }
    const patterns = [
      // S&F API: / is field separator, so key may be preceded by / & \t \n
      /(?:^|[&\t\n\r/])(?:otherplayersavename|savename|othername|othercname|cname)[:=]([^&\t\n\r/]{2,32})/i,
      /(?:^|[&\t\n\r/])(?:name|playername|nick|nickname|charactername)[:=]([^&\t\n\r/]{2,32})/i,
      /"name"\s*:\s*"([^"]{2,40})"/i,
      /"playerName"\s*:\s*"([^"]{2,40})"/i,
      /"nick"\s*:\s*"([^"]{2,40})"/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const candidate = match?.[2] || match?.[1];
      const normalized = normalizePlayerLabel(candidate || "");
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  function scoreEquipLikeArray(arr) {
    if (!Array.isArray(arr) || arr.length < 6 || arr.length > 40) {
      return -1;
    }
    const nonZero = arr.filter((n) => n > 0 && n <= 20000);
    const uniqueNonZero = [...new Set(nonZero)];
    if (!uniqueNonZero.length || uniqueNonZero.length > 14) {
      return -1;
    }
    const zeroCount = arr.filter((n) => n === 0).length;
    const lengthPenalty = Math.abs(arr.length - 12) * 2;
    const zeroBonus = Math.min(zeroCount, 8);
    return 100 - lengthPenalty + zeroBonus - uniqueNonZero.length;
  }

  function isPlausibleItemId(id) {
    if (!Number.isInteger(id) || id <= 0) {
      return false;
    }
    // Keep range wide enough for newer IDs, but block obvious technical markers.
    if (id > 9000) {
      return false;
    }
    // Known false-positive seen in compact payload parsing.
    if (id === 10437) {
      return false;
    }
    return true;
  }

  function looksLikeRealItemIds(ids) {
    if (!Array.isArray(ids) || !ids.length) {
      return false;
    }
    const unique = [...new Set(ids.filter((n) => isPlausibleItemId(n)))];
    if (!unique.length) {
      return false;
    }
    // Reject technical marker-like values.
    if (unique.length === 1 && unique[0] < 30) {
      return false;
    }
    return true;
  }

  // Returns all plausible scrapbook bit-position candidates for one equipment slot.
  // We don't know for certain whether values[3]%1000 is the raw relPos (formula A)
  // or just the base model_id with color encoded separately in values[17] (formula B).
  // Returning ALL valid candidates and checking any-match removes the ambiguity.
  function sfEquipItemBitPosCandidates(slotName, classId, apiModelId, quality) {
    if (!apiModelId || apiModelId <= 0) {
      return [];
    }

    const candidates = new Set();

    function tryAdd(start, end, relPos, ignored) {
      if (relPos < 1 || relPos > end - start) return;
      const bitPos = start + relPos - 1;
      if (!ignored.includes(bitPos)) candidates.add(bitPos);
    }

    for (const [start, end, slot, cls, epic, ignored] of SF_SCRAPBOOK_RANGES) {
      if (slot !== slotName || cls !== classId) continue;

      if (!epic) {
        // Formula A: apiModelId is the direct relative position
        tryAdd(start, end, apiModelId, ignored);
        // Formula B: apiModelId is the base model, quality (1-5) is the color
        const color = quality >= 1 && quality <= 5 ? quality : 1;
        tryAdd(start, end, (apiModelId - 1) * 5 + color, ignored);
      } else {
        // Epic: relPos = apiModelId - 49  (same under both interpretations)
        tryAdd(start, end, apiModelId - 49, ignored);
      }
    }

    return [...candidates];
  }

  // Parse otherplayersaveequipment from S&F API text.
  // Returns an array of candidate-groups: one inner array per occupied slot,
  // each inner array contains all plausible scrapbook bit positions for that item.
  function parseSfEquipmentCandidates(text) {
    const match = text.match(/otherplayersaveequipment[:/]([\d/\-]+)/i);
    if (!match?.[1]) return null;

    const values = match[1].split("/").map(Number);
    if (values.length < SF_ITEM_PARSE_LEN * SF_SLOT_ORDER.length) return null;

    const groups = [];
    for (let s = 0; s < SF_SLOT_ORDER.length; s++) {
      const base = s * SF_ITEM_PARSE_LEN;
      const itemTypeId = values[base];
      if (!itemTypeId || itemTypeId <= 0) continue;
      const classAndModel = values[base + 3];
      if (!classAndModel || classAndModel < 0) continue;
      const classId = Math.floor(classAndModel / 1000);
      const modelId = classAndModel % 1000;
      if (modelId <= 0) continue;
      const quality = values[base + 17] || 0;
      const candidates = sfEquipItemBitPosCandidates(SF_SLOT_ORDER[s], classId, modelId, quality);
      if (candidates.length > 0) groups.push(candidates);
    }

    return groups.length > 0 ? groups : null;
  }

  function extractPlayerFromText(text, url) {
    if (!looksLikeRelevantTextUrl(url)) {
      return null;
    }

    // Try the exact S&F key first.
    // itemCandidates: one inner array per slot, each inner array holds all plausible
    // scrapbook bit positions for that item (both formula variants).
    const sfCandidates = parseSfEquipmentCandidates(text);
    if (sfCandidates) {
      const parsedPlayerId = parsePlayerIdFromUrl(url);
      const payloadName = extractPlayerNameFromText(text);
      const domName = inferNameFromProfileDom();
      return {
        playerId: String(parsedPlayerId || url || `player_${Date.now()}`),
        playerName: payloadName || domName || (parsedPlayerId ? `Player ${parsedPlayerId}` : "Scanned player"),
        itemCandidates: sfCandidates,
        itemIds: sfCandidates.map((g) => g[0]) // first candidate kept for compat
      };
    }

    // If the S&F equipment key is present but parsing failed (e.g. unexpected format),
    // don't run the heuristic – it would misidentify the player ID or other numbers as items.
    if (/otherplayersaveequipment/i.test(text)) {
      return null;
    }

    // Heuristic fallback for unknown formats
    const lower = text.toLowerCase();
    const fromHintArrays = [
      ...extractNamedItemSegments(text),
      ...extractBracketNumberArraysWithZero(text),
      ...extractDelimitedNumberArrays(text)
    ]
      .filter((arr) => arr.length >= 6 && arr.length <= 40)
      .sort((a, b) => scoreEquipLikeArray(b) - scoreEquipLikeArray(a));
    const hasHints = KEYS_PLAYER_HINT.some((hint) => lower.includes(hint));
    const isLikelyPlayerApi = looksLikePlayerApiUrl(url);

    const best = fromHintArrays[0] || [];
    if (!(hasHints || isLikelyPlayerApi) || !best.length || scoreEquipLikeArray(best) < 0) {
      return null;
    }

    const itemIds = [...toNumberSet(best.filter((n) => isPlausibleItemId(n)))];
    if (itemIds.length < 1 || itemIds.length > 14) {
      return null;
    }
    if (!looksLikeRealItemIds(itemIds)) {
      return null;
    }
    const parsedPlayerId = parsePlayerIdFromUrl(url);
    const payloadName = extractPlayerNameFromText(text);
    const domName = inferNameFromProfileDom();
    return {
      playerId: String(parsedPlayerId || url || `player_${Date.now()}`),
      playerName: payloadName || domName || (parsedPlayerId ? `Player ${parsedPlayerId}` : "Scanned player"),
      itemIds
    };
  }

  function walk(obj, visitor, path = []) {
    if (Array.isArray(obj)) {
      visitor(obj, path);
      for (let i = 0; i < obj.length; i += 1) {
        walk(obj[i], visitor, [...path, String(i)]);
      }
      return;
    }
    if (!isObject(obj)) {
      return;
    }
    visitor(obj, path);
    for (const [key, value] of Object.entries(obj)) {
      walk(value, visitor, [...path, key]);
    }
  }

  function extractOwnedIds(payload) {
    const candidates = [];

    walk(payload, (value, path) => {
      if (Array.isArray(value) && looksLikeItemArray(value)) {
        const pathText = path.join(".").toLowerCase();
        const hasHint = KEYS_OWNED_HINT.some((hint) => pathText.includes(hint));
        if (hasHint && looksLikeOwnedArray(value)) {
          candidates.push(value);
        }
      }
    });

    if (!candidates.length) {
      return null;
    }

    candidates.sort((a, b) => b.length - a.length);
    return toNumberSet(candidates[0]);
  }

  function extractOwnedIdsLoose(payload) {
    const candidates = [];
    walk(payload, (value) => {
      if (!Array.isArray(value)) {
        return;
      }
      if (!looksLikeOwnedArray(value)) {
        return;
      }
      candidates.push(value);
    });

    if (!candidates.length) {
      return null;
    }

    candidates.sort((a, b) => b.length - a.length);
    return toNumberSet(candidates[0]);
  }

  function extractPlayerRecords(payload) {
    const records = [];

    walk(payload, (value, path) => {
      if (!isObject(value)) {
        return;
      }

      const valueKeys = Object.keys(value).map((k) => k.toLowerCase());
      const hasItemField = valueKeys.some((k) => KEYS_PLAYER_HINT.some((hint) => k.includes(hint)));
      if (!hasItemField) {
        return;
      }

      let itemIds = null;
      for (const [key, candidate] of Object.entries(value)) {
        if (!Array.isArray(candidate)) {
          continue;
        }
        if (!looksLikePlayerArray(candidate)) {
          continue;
        }
        const keyLower = key.toLowerCase();
        if (KEYS_PLAYER_HINT.some((hint) => keyLower.includes(hint))) {
          itemIds = candidate;
          break;
        }
      }

      if (!itemIds) {
        return;
      }

      const playerId = value.id || value.playerId || value.uid || value.identifier || path.join(":");
      const playerName = value.name || value.playerName || value.nick || String(playerId);

      const normalizedItemIds = [...toNumberSet(itemIds)];
      if (!looksLikeRealItemIds(normalizedItemIds)) {
        return;
      }

      records.push({
        playerId: String(playerId),
        playerName: String(playerName),
        itemIds: normalizedItemIds
      });
    });

    return records;
  }

  // Returns the missing item groups for a player.
  // If itemCandidates is available (array of candidate arrays per item), an item counts
  // as missing only when NONE of its candidate bit positions are in the owned set.
  // Falls back to the flat itemIds array for backward compatibility.
  function missingIdsFor(player) {
    const candidates = player?.itemCandidates;
    if (Array.isArray(candidates)) {
      return candidates.filter((group) =>
        group.every((bitPos) => !state.ownedIds.has(bitPos))
      );
    }
    // Legacy flat array path
    const ids = player?.itemIds ?? (Array.isArray(player) ? player : []);
    return ids.filter((id) => !state.ownedIds.has(id));
  }

  function saveState() {
    const payload = {
      ownedIds: [...state.ownedIds],
      pendingOwnedIds: [...state.pendingOwnedIds],
      scrapbookReady: state.scrapbookReady,
      players: [...state.players.values()],
      lastPlayerId: state.lastPlayerId,
      selectedPlayerId: state.selectedPlayerId,
      selectedPlayerName: state.selectedPlayerName,
      overlayPosition: state.overlayPosition,
      overlayHidden: state.overlayHidden,
      lastSid: state.lastSid,
      lastScrapbookRefreshAt: state.lastScrapbookRefreshAt,
      responsesSeen: state.responsesSeen,
      textResponsesSeen: state.textResponsesSeen,
      lastPayloadType: state.lastPayloadType,
      lastUrl: state.lastUrl
    };
    chrome.storage.local.set({ [STORAGE_KEY]: payload });
  }

  async function loadState() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const saved = data[STORAGE_KEY];
    if (!saved) {
      return;
    }

    state.ownedIds = toNumberSet(saved.ownedIds || []);
    state.pendingOwnedIds = toNumberSet(saved.pendingOwnedIds || []);
    state.scrapbookReady = Boolean(saved.scrapbookReady);
    state.players = new Map();
    for (const player of saved.players || []) {
      state.players.set(player.playerId, player);
    }
    state.lastPlayerId = saved.lastPlayerId || null;
    state.selectedPlayerId = saved.selectedPlayerId || null;
    state.selectedPlayerName = saved.selectedPlayerName || null;
    state.overlayPosition = saved.overlayPosition || null;
    state.overlayHidden = Boolean(saved.overlayHidden);
    state.lastSid = saved.lastSid || null;
    state.lastScrapbookRefreshAt = Number(saved.lastScrapbookRefreshAt) || 0;
    state.responsesSeen = Number(saved.responsesSeen) || 0;
    state.textResponsesSeen = Number(saved.textResponsesSeen) || 0;
    state.lastPayloadType = saved.lastPayloadType || "-";
    state.lastUrl = saved.lastUrl || "-";
  }

  function clamp(num, min, max) {
    return Math.min(Math.max(num, min), max);
  }

  function applyOverlayPosition(root) {
    const width = root.offsetWidth || 280;
    const maxLeft = Math.max(window.innerWidth - width - 8, 8);
    const maxTop = Math.max(window.innerHeight - 60, 8);
    const pos = state.overlayPosition || { left: maxLeft, top: 12 };

    const left = clamp(Number(pos.left) || maxLeft, 8, maxLeft);
    const top = clamp(Number(pos.top) || 12, 8, maxTop);
    state.overlayPosition = { left, top };

    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.right = "auto";
  }

  function makeOverlayDraggable(root) {
    const handle = root.querySelector(".sfh-title");
    if (!handle) {
      return;
    }
    let drag = null;

    handle.addEventListener("mousedown", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      drag = {
        startX: event.clientX,
        startY: event.clientY,
        startLeft: state.overlayPosition?.left ?? root.offsetLeft,
        startTop: state.overlayPosition?.top ?? root.offsetTop
      };
      root.classList.add("sfh-dragging");
      event.preventDefault();
    });

    window.addEventListener("mousemove", (event) => {
      if (!drag) {
        return;
      }
      const nextLeft = drag.startLeft + (event.clientX - drag.startX);
      const nextTop = drag.startTop + (event.clientY - drag.startY);
      const width = root.offsetWidth || 280;
      const maxLeft = Math.max(window.innerWidth - width - 8, 8);
      const maxTop = Math.max(window.innerHeight - 60, 8);
      state.overlayPosition = {
        left: clamp(nextLeft, 8, maxLeft),
        top: clamp(nextTop, 8, maxTop)
      };
      applyOverlayPosition(root);
    });

    window.addEventListener("mouseup", () => {
      if (!drag) {
        return;
      }
      drag = null;
      root.classList.remove("sfh-dragging");
      saveState();
    });
  }

  function buildOverlay() {
    const root = document.createElement("div");
    root.id = "sfh-overlay";
    root.innerHTML = `
      <div class="sfh-header">
        <div class="sfh-title">Chybějící itemy scrapbooku</div>
        <button id="sfh-toggle" type="button" class="sfh-toggle" title="Skrýt/zobrazit panel">—</button>
      </div>
      <div id="sfh-content">
        <div class="sfh-row"><span>Známé itemy v scrapbooku</span><strong id="sfh-owned">0</strong></div>
        <div class="sfh-row"><span>Vybraný hráč</span><strong id="sfh-selected-player">-</strong></div>
        <div class="sfh-row"><span>Chybějící itemy</span><strong id="sfh-missing">-</strong></div>
        <div class="sfh-row"><span>Lze zlepšit scrapbook</span><strong id="sfh-can-improve">-</strong></div>
        <div class="sfh-player" id="sfh-player">Čekám na data ze hry…</div>

        <button id="sfh-confirm" type="button">Potvrdit načtený scrapbook</button>
        <button id="sfh-refresh" type="button">↻ Aktualizovat scrapbook</button>
      </div>
    `;

    document.documentElement.appendChild(root);
    applyOverlayPosition(root);
    makeOverlayDraggable(root);

    root.querySelector("#sfh-toggle")?.addEventListener("click", (event) => {
      event.stopPropagation();
      state.overlayHidden = !state.overlayHidden;
      updateOverlay();
      saveState();
    });

    root.querySelector("#sfh-confirm")?.addEventListener("click", () => {
      if (state.pendingOwnedIds.size < 10 && state.ownedIds.size < 10) {
        return;
      }
      if (state.pendingOwnedIds.size >= state.ownedIds.size) {
        state.ownedIds = new Set(state.pendingOwnedIds);
      }
      state.scrapbookReady = true;
      updateOverlay();
      saveState();
    });

    root.querySelector("#sfh-refresh")?.addEventListener("click", async () => {
      const btn = root.querySelector("#sfh-refresh");
      if (btn) btn.disabled = true;
      state.lastScrapbookRefreshAt = 0;
      await refreshOwnedFromApiIfPossible();
      if (btn) btn.disabled = false;
    });

  }

  function updateOverlay() {
    const root = document.getElementById("sfh-overlay");
    if (!root) {
      return;
    }

    const ownedNode = root.querySelector("#sfh-owned");
    const contentNode = root.querySelector("#sfh-content");
    const toggleNode = root.querySelector("#sfh-toggle");
    const selectedPlayerNode = root.querySelector("#sfh-selected-player");
    const missingNode = root.querySelector("#sfh-missing");
    const canImproveNode = root.querySelector("#sfh-can-improve");
    const playerNode = root.querySelector("#sfh-player");
    const confirmButton = root.querySelector("#sfh-confirm");

    if (contentNode) {
      contentNode.style.display = state.overlayHidden ? "none" : "block";
    }
    if (toggleNode) {
      toggleNode.textContent = state.overlayHidden ? "+" : "—";
      toggleNode.setAttribute("aria-label", state.overlayHidden ? "Zobrazit panel" : "Skrýt panel");
    }

    if (ownedNode) {
      ownedNode.textContent = String(state.ownedIds.size);
    }
    if (confirmButton) {
      const canConfirm = state.pendingOwnedIds.size >= 10 || state.ownedIds.size >= 10;
      confirmButton.disabled = !canConfirm || state.scrapbookReady;
      confirmButton.textContent = state.scrapbookReady
        ? "Scrapbook načten"
        : "Potvrdit načtený scrapbook";
    }

    const preferredId = state.selectedPlayerId || state.lastPlayerId;
    const player = preferredId ? state.players.get(preferredId) : null;
    if (!state.scrapbookReady) {
      if (selectedPlayerNode) {
        selectedPlayerNode.textContent = "-";
      }
      if (missingNode) {
        missingNode.textContent = "-";
      }
      if (canImproveNode) {
        canImproveNode.textContent = "NE";
      }
      if (playerNode) {
        const found = state.pendingOwnedIds.size || state.ownedIds.size;
        playerNode.textContent =
          found >= 10
            ? `Nalezeno ${found} scrapbook itemů. Klikni na "Potvrdit načtený scrapbook".`
            : "Nejdřív otevři vlastní scrapbook, aby se načetly tvoje itemy.";
      }
      return;
    }

    if (!player) {
      if (selectedPlayerNode) {
        selectedPlayerNode.textContent = "-";
      }
      if (missingNode) {
        missingNode.textContent = "-";
      }
      if (canImproveNode) {
        canImproveNode.textContent = "-";
      }
      if (playerNode) {
        playerNode.textContent = "Teď otevři profily hráčů v Hall of Fame.";
      }
      return;
    }

    const missing = missingIdsFor(player);
    const domLabel = normalizePlayerLabel(inferNameFromProfileDom());
    const rememberedLabel = normalizePlayerLabel(state.selectedPlayerName);
    const payloadLabel = normalizePlayerLabel(player.playerName);
    const label = domLabel || rememberedLabel || payloadLabel || "-";
    if (label && label !== "-") {
      state.selectedPlayerName = label;
    }
    if (selectedPlayerNode) {
      selectedPlayerNode.textContent = label;
    }
    if (missingNode) {
      missingNode.textContent = String(missing.length);
    }
    if (canImproveNode) {
      canImproveNode.textContent = missing.length > 0 ? "ANO" : "NE";
    }
    if (playerNode) {
      const lead = label === "-" ? "Vybraný hráč" : label;
      playerNode.textContent = `${lead}: u hráče můžeš doplnit až ${missing.length} itemů`;
    }
  }

  async function refreshOwnedFromApiIfPossible() {
    if (!state.scrapbookReady) {
      return;
    }
    const now = Date.now();
    if (now - state.lastScrapbookRefreshAt < 9000) {
      return;
    }
    if (!state.lastSid) {
      return;
    }

    state.lastScrapbookRefreshAt = now;
    const url = `${window.location.origin}/cmd.php?req=PlayerPollScrapbook&params=&sid=${encodeURIComponent(state.lastSid)}`;
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        return;
      }
      const text = await res.text();
      const owned = extractOwnedIdsFromText(text);
      if (!owned || owned.size < 10) {
        return;
      }
      state.pendingOwnedIds = owned;
      state.ownedIds = new Set(owned);
      updateOverlay();
      saveState();
    } catch {
      // Ignore failed background refresh attempts.
    }
  }

  function processPayload(url, payload, payloadType) {
    state.responsesSeen += 1;
    state.lastPayloadType = payloadType || "-";
    state.lastUrl = String(url || "-");
    const sid = getSidParam(url);
    if (sid) {
      state.lastSid = sid;
    }

    if (payloadType === "text") {
      state.textResponsesSeen += 1;
      const shouldTryOwned = looksLikeScrapbookUrl(url) && looksLikeGameApiUrl(url);
      const ownedFromText = shouldTryOwned ? extractOwnedIdsFromText(payload) : null;
      // Fight/player API responses include scrapbook.r: with the updated bitmap – parse it directly.
      const ownedFromPattern = !ownedFromText && looksLikeGameApiUrl(url)
        ? parseOwnedFromScrapbookRecord(payload)
        : null;
      const looseArrays = extractBracketNumberArrays(payload)
        .filter((arr) => arr.length >= 100 && arr.length <= 2500 && shouldTryOwned)
        .sort((a, b) => b.length - a.length);
      const looseOwnedFromText = looseArrays.length ? toNumberSet(looseArrays[0]) : null;
      const bestOwnedFromText =
        (ownedFromText && ownedFromText.size >= 10 ? ownedFromText : null) ||
        (ownedFromPattern && ownedFromPattern.size >= 10 ? ownedFromPattern : null) ||
        (looseOwnedFromText && looseOwnedFromText.size >= 100 ? looseOwnedFromText : null);
      if (bestOwnedFromText && bestOwnedFromText.size >= 10) {
        state.pendingOwnedIds = bestOwnedFromText;
        // Update ownedIds when from a scrapbook URL, when on the scrapbook page,
        // or when scrapbook.r: was found in any game API response (e.g. fight result).
        if (looksLikeScrapbookUrl(url) || looksLikeScrapbookUrl(window.location.href) || ownedFromPattern) {
          state.ownedIds = new Set(bestOwnedFromText);
          state.scrapbookReady = true;
        }
      }

      const playerFromText = looksLikePlayerApiUrl(url) ? extractPlayerFromText(payload, url) : null;
      if (playerFromText) {
        state.players.set(playerFromText.playerId, playerFromText);
        state.lastPlayerId = playerFromText.playerId;
        if (state.selectedPlayerId && state.players.has(state.selectedPlayerId)) {
          state.lastPlayerId = state.selectedPlayerId;
        }
      }

      if (bestOwnedFromText || playerFromText) {
        updateOverlay();
        saveState();
        if (playerFromText) {
          void refreshOwnedFromApiIfPossible();
        }
      }
      // Always poll the scrapbook after any fight to pick up newly gained items,
      // even if the fight response itself didn't contain scrapbook.r: data.
      if (looksLikeGameApiUrl(url) && getReqParam(url).includes("fight") && state.scrapbookReady) {
        state.lastScrapbookRefreshAt = 0;
        void refreshOwnedFromApiIfPossible();
      }
      return;
    }

    const owned = extractOwnedIds(payload);
    const ownedLoose = extractOwnedIdsLoose(payload);
    const bestOwned =
      (owned && owned.size >= 10 ? owned : null) ||
      (ownedLoose && ownedLoose.size >= 100 ? ownedLoose : null);

    if (bestOwned && bestOwned.size >= 10) {
      state.pendingOwnedIds = bestOwned;
      if (looksLikeScrapbookUrl(url) || looksLikeScrapbookUrl(window.location.href)) {
        state.ownedIds = new Set(bestOwned);
        state.scrapbookReady = true;
      }
    }

    const playerRecords = extractPlayerRecords(payload);
    for (const player of playerRecords) {
      const inferredId = parsePlayerIdFromUrl(url) || player.playerId;
      const normalized = { ...player, playerId: String(inferredId) };
      if (!normalized.playerName && state.selectedPlayerId === normalized.playerId && state.selectedPlayerName) {
        normalized.playerName = state.selectedPlayerName;
      }
      state.players.set(normalized.playerId, normalized);
      state.lastPlayerId = normalized.playerId;
      if (state.selectedPlayerId && state.players.has(state.selectedPlayerId)) {
        state.lastPlayerId = state.selectedPlayerId;
      }
    }

    if (bestOwned || playerRecords.length) {
      updateOverlay();
      saveState();
      if (playerRecords.length) {
        void refreshOwnedFromApiIfPossible();
      }
      chrome.runtime.sendMessage({
        type: "state_update",
        payload: {
          ownedCount: state.ownedIds.size,
          playersCount: state.players.size,
          lastPlayerId: state.lastPlayerId,
          lastUrl: url,
          responsesSeen: state.responsesSeen,
          textResponsesSeen: state.textResponsesSeen,
          lastPayloadType: state.lastPayloadType
        }
      });
    }
  }

  function injectHooks() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("injected.js");
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }
    const data = event.data;
    if (!data || data.source !== SOURCE || data.type !== "network_payload") {
      return;
    }
    processPayload(data.url, data.payload, data.payloadType);
  });

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const candidate = target.closest("[data-player-id], a, button, [href]");
      if (!candidate) {
        return;
      }
      const raw =
        candidate.getAttribute("data-player-id") ||
        candidate.getAttribute("href") ||
        candidate.getAttribute("data-href") ||
        "";
      const playerId = parsePlayerIdFromUrl(raw);
      if (!playerId) {
        const hallName = inferNameFromHallRow(target);
        if (hallName) {
          state.selectedPlayerName = hallName;
          updateOverlay();
          saveState();
        }
        return;
      }
      state.selectedPlayerId = String(playerId);
      // Prefer name from the HoF table row (avoids rank/level noise in link text)
      const hallName = inferNameFromHallRow(target);
      state.selectedPlayerName =
        hallName ||
        normalizePlayerLabel(inferNameFromElement(candidate)) ||
        state.selectedPlayerName;
      if (state.players.has(state.selectedPlayerId)) {
        const existing = state.players.get(state.selectedPlayerId);
        if (existing && state.selectedPlayerName) {
          existing.playerName = state.selectedPlayerName;
          state.players.set(state.selectedPlayerId, existing);
        }
        state.lastPlayerId = state.selectedPlayerId;
      }
      updateOverlay();
      saveState();
    },
    true
  );

  loadState().then(() => {
    buildOverlay();
    updateOverlay();
    injectHooks();
    window.addEventListener("resize", () => {
      const root = document.getElementById("sfh-overlay");
      if (!root) {
        return;
      }
      applyOverlayPosition(root);
      saveState();
    });
  });
})();
