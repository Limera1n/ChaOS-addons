import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { characterKey, validateImport } from "./import-schema.js";

function fillEquipmentMetadata(equipment, otherEquipment) {
  return equipment.map((item, index) => {
    const other = otherEquipment[index];
    const icon = item.icon ?? other?.icon;
    const quality = item.quality ?? other?.quality;
    return {
      ...item,
      ...(icon == null ? {} : { icon }),
      ...(quality == null ? {} : { quality }),
    };
  });
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
  const assertOpen = () => {
    if (isStopped) throw new Error("Tracker stopped");
  };
  function importBatch(input) {
    assertOpen();
    const batch = validateImport(input);
    const next = structuredClone(state);
    const key = characterKey(batch.character);
    let character = next.characters.find((item) => item.key === key);
    if (!character) {
      character = {
        key,
        ...batch.character,
        metadataAt: 0,
        snapshots: [],
        events: [],
      };
      next.characters.push(character);
    }
    // Export time is not observation time: an old file must not replace newer metadata.
    const latestAt = Math.max(0, ...batch.snapshots.map((item) => item.at));
    if (latestAt >= character.metadataAt) {
      Object.assign(character, batch.character, { metadataAt: latestAt });
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
          const previousAtCurrentVersion = {
            ...previous,
            build: batch.build,
            addonVersion: batch.addonVersion,
          };
          if (JSON.stringify(previousAtCurrentVersion) === JSON.stringify(candidate)) continue;
          if (kind === "snapshots") {
            // Older importers discarded these optional fields from otherwise identical observations.
            const equipment = fillEquipmentMetadata(previous.equipment, candidate.equipment);
            const incomingEquipment = fillEquipmentMetadata(candidate.equipment, previous.equipment);
            if (isDeepStrictEqual(
              { ...previousAtCurrentVersion, equipment },
              { ...candidate, equipment: incomingEquipment },
            )) {
              previous.equipment = equipment;
              continue;
            }
          }
          throw new Error(
            "Conflit : un événement déjà importé a été modifié.",
          );
        }
        character[kind].push(candidate);
        ids.set(sourceKey, candidate);
        added++;
      }
      character[kind].sort(
        (a, b) => a.at - b.at || a.sourceKey.localeCompare(b.sourceKey),
      );
    }
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
