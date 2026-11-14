import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { characterKey, validateImport } from "./import-schema.js";
import { identityRuleset, playerName } from "../client/identity.js";
import { repairCounterRebounds } from "./counter-repair.js";

function fillEquipmentMetadata(equipment, otherEquipment) {
  return equipment.map((item, index) => {
    const other = otherEquipment[index];
    const icon = item.icon ?? other?.icon;
    const quality = item.quality ?? other?.quality;
    const tooltip = item.tooltip ?? other?.tooltip;
    const transmogItemId = item.transmogItemId ?? other?.transmogItemId;
    const enchantId = item.enchantId ?? other?.enchantId;
    const fullLink = other?.link?.match(/\|Hitem:(\d+):[^|]*\|h([^|]+)\|h/u);
    // A fixed collector can restore hyperlink data lost during an older copy.
    // Only enrich an identical label for the same actual item; two complete
    // links that disagree must still be rejected as a changed observation.
    const link = fullLink && Number(fullLink[1]) === item.itemId && item.link === fullLink[2]
      ? other.link : item.link;
    return {
      ...item,
      link,
      ...(icon == null ? {} : { icon }),
      ...(quality == null ? {} : { quality }),
      ...(tooltip == null ? {} : { tooltip }),
      ...(transmogItemId == null ? {} : { transmogItemId }),
      ...(enchantId == null ? {} : { enchantId }),
    };
  });
}

function fillSnapshotMetadata(item, other) {
  return {
    ...item,
    equipment: fillEquipmentMetadata(item.equipment, other.equipment),
    ...(item.guildKnown == null && other.guildKnown != null ? { guildKnown: other.guildKnown } : {}),
    ...(item.playedSeconds == null && other.playedSeconds != null
      ? { playedSeconds: other.playedSeconds, playedAt: other.playedAt } : {}),
  };
}

function reconcileObservation(previous, candidate, kind) {
  const comparable = { ...previous, build: candidate.build, addonVersion: candidate.addonVersion };
  if (previous.counterReboundAmount != null && candidate.counterReboundAmount == null) {
    comparable.amount = previous.counterReboundAmount;
    delete comparable.counterReboundAmount;
  }
  // Lua/JSON versions can differ in the last decimal places of normalized map
  // coordinates. Compare within 1e-10, retaining the original stored reading.
  // Map, zone, position timestamp and every non-coordinate field remain exact.
  if (previous.location && candidate.location) {
    comparable.location = { ...previous.location };
    for (const axis of ["x", "y"]) {
      const before = previous.location[axis], after = candidate.location[axis];
      if (Number.isFinite(before) && Number.isFinite(after) && Math.abs(before - after) <= 1e-10)
        comparable.location[axis] = after;
    }
  }
  if (isDeepStrictEqual(comparable, candidate)) return previous;
  if (kind === "snapshots") {
    const enriched = fillSnapshotMetadata(comparable, candidate);
    const incoming = fillSnapshotMetadata(candidate, previous);
    if (isDeepStrictEqual(enriched, incoming)) {
      return { ...previous, equipment: enriched.equipment,
        ...(enriched.guildKnown == null ? {} : { guildKnown: enriched.guildKnown }),
        ...(enriched.playedSeconds == null ? {} : { playedSeconds: enriched.playedSeconds, playedAt: enriched.playedAt }) };
    }
  }
  throw new Error(`Conflit : ${kind === "snapshots" ? "le relevé" : "l’événement"} ${candidate.id} déjà importé a été modifié.`);
}

const observationOrder = (a, b) => a.at - b.at || a.sourceKey.localeCompare(b.sourceKey);

function migrateCharacters(characters) {
  const merged = new Map();
  for (const original of characters) {
    const candidate = { ...original, ruleset: identityRuleset(original), name: playerName(original) };
    candidate.key = characterKey(candidate);
    const previous = merged.get(candidate.key);
    if (!previous) { merged.set(candidate.key, candidate); continue; }
    const newest = candidate.metadataAt > previous.metadataAt ? candidate : previous;
    const result = { ...newest, key: candidate.key,
      lastImportedAt: Math.max(previous.lastImportedAt ?? 0, candidate.lastImportedAt ?? 0) };
    const appearance = [previous.appearance, candidate.appearance].filter(Boolean).sort((a, b) => b.at - a.at)[0];
    if (appearance) result.appearance = appearance;
    const professions = [previous.professions, candidate.professions].filter(Boolean).sort((a, b) => b.at - a.at)[0];
    if (professions) result.professions = professions;
    const talents = [previous.talents, candidate.talents].filter(Boolean).sort((a, b) => b.at - a.at)[0];
    if (talents) result.talents = talents;
    for (const kind of ["snapshots", "events"]) {
      const observations = new Map(previous[kind].map((item) => [item.sourceKey, item]));
      for (const item of candidate[kind]) {
        const existing = observations.get(item.sourceKey);
        observations.set(item.sourceKey, existing ? reconcileObservation(existing, item, kind) : item);
      }
      result[kind] = [...observations.values()].sort(observationOrder);
    }
    merged.set(candidate.key, result);
  }
  return [...merged.values()];
}

export function createTrackerStore({ dataDir, now = Date.now }) {
  const file = join(dataDir, "tracker.json");
  let state;
  let isStopped = false;
  try {
    state = JSON.parse(readFileSync(file, "utf8"));
    if (state.version !== 1 || !Array.isArray(state.characters))
      throw new Error("Invalid tracker database");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = { version: 1, characters: [] };
  }
  // Existing imports become one profile immediately. The source file remains
  // untouched until the next successful atomic import saves the merged state.
  state.characters = migrateCharacters(state.characters);
  for (const character of state.characters) repairCounterRebounds(character);
  const assertOpen = () => {
    if (isStopped) throw new Error("Tracker stopped");
  };
  function importBatch(input) {
    assertOpen();
    const batch = validateImport(input);
    const { appearance, ...metadata } = batch.character;
    const next = structuredClone(state);
    const key = characterKey(batch.character);
    let character = next.characters.find((item) => item.key === key);
    if (!character) {
      character = {
        key,
        ...metadata,
        metadataAt: 0,
        snapshots: [],
        events: [],
      };
      next.characters.push(character);
    }
    // Export time is not observation time: an old file must not replace newer metadata.
    const latestAt = Math.max(0, ...batch.snapshots.map((item) => item.at));
    if (latestAt >= character.metadataAt) {
      Object.assign(character, metadata, { metadataAt: latestAt });
    }
    if (appearance && (!character.appearance || appearance.at > character.appearance.at)) {
      character.appearance = appearance;
    }
    if (batch.professions && (!character.professions || batch.professions.at > character.professions.at)) {
      character.professions = batch.professions;
    }
    if (batch.talents && (!character.talents || batch.talents.at > character.talents.at)) {
      character.talents = batch.talents;
    }
    let added = 0;
    for (const kind of ["snapshots", "events"]) {
      const ids = new Map(
        character[kind].map((item) => [item.sourceKey, item]),
      );
      for (const item of batch[kind]) {
        const sourceKey = JSON.stringify([batch.sourceId, item.id]);
        const candidate = {
          ...item,
          sourceKey,
          sourceId: batch.sourceId,
          build: batch.build,
          addonVersion: batch.addonVersion,
        };
        const previous = ids.get(sourceKey);
        if (previous) {
          Object.assign(previous, reconcileObservation(previous, candidate, kind));
          continue;
        }
        character[kind].push(candidate);
        ids.set(sourceKey, candidate);
        added++;
      }
      character[kind].sort(observationOrder);
    }
    repairCounterRebounds(character);
    if (
      next.characters.reduce(
        (sum, item) => sum + item.events.length + item.snapshots.length,
        0,
      ) > 100000
    ) {
      throw new Error(
        "Limite du prototype atteinte (100 000 relevés et événements).",
      );
    }
    character.lastImportedAt = Math.floor(now() / 1000);
    mkdirSync(dataDir, { recursive: true });
    const temporary = join(dataDir, `tracker-${randomUUID()}.tmp`);
    writeFileSync(temporary, JSON.stringify(next), {
      encoding: "utf8",
      flag: "wx",
    });
    renameSync(temporary, file);
    state = next;
    return { added, character: character.name };
  }
  return {
    importBatch,
    read() {
      assertOpen();
      return structuredClone(state);
    },
    stop() {
      isStopped = true;
    },
    status() {
      return { isStopped, characters: state.characters.length };
    },
  };
}
