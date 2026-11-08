import { test } from "node:test";
import assert from "node:assert/strict";
import { activityCharacter, dailyActivity, dayBounds, dayKey, filterDay, formatSessionDuration, guildEvents, guildEvidence, probableGroups, selectGroupSessions, sortActivity } from "../client/activity.js";

const noon = new Date(2026, 10, 8, 12).getTime() / 1000;
const event = (at, amount = 1, type = "honor-gain", location = { mapId: 37, zone: "Elwynn", x: .5, y: .5 }) =>
  ({ at, amount: type === "honor-gain" ? amount : 0, type, context: "world", location });
function member(key, offset = 0) {
  return { key, name: key, region: "3", ruleset: "pvp", realm: "CAMWOW EU4 Realm 4 PvP",
    snapshots: [{ at: noon - 100, guild: "Guild" }], events: [event(noon + offset)] };
}

test("day filters use local calendar boundaries and retain membership snapshots", () => {
  const bounds = dayBounds("2026-11-08");
  assert.equal(dayKey(bounds.start), "2026-11-08");
  assert.equal(dayKey(bounds.end), "2026-11-08");
  const events = [event(bounds.start - 1), event(bounds.start), event(bounds.end), event(bounds.end + 1)];
  assert.deepEqual(filterDay(events, "2026-11-08"), events.slice(1, 3));
  assert.equal(filterDay(events).length, 4);
  const character = { ...member("Alice"), events };
  const scoped = activityCharacter(character, "2026-11-08");
  assert.equal(scoped.snapshots, character.snapshots);
  assert.equal(character.events.length, 4);
});

test("calendar-day bounds follow summer and winter time changes", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "Europe/Paris";
    const spring = dayBounds("2026-03-29");
    const autumn = dayBounds("2026-10-25");
    assert.equal(spring.end - spring.start + 1, 23 * 3600);
    assert.equal(autumn.end - autumn.start + 1, 25 * 3600);
  } finally {
    if (previous == null) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("daily breakdown and sorting keep VH, fatal blows and deaths separate", () => {
  const previous = new Date(2026, 10, 7, 12).getTime() / 1000;
  const events = [event(previous, 8), event(noon, 2), event(noon + 1, 0, "player-kill"), event(noon + 2, 0, "death"),
    { ...event(noon + 3, 99), context: "pvp" }, { ...event(noon + 4), type: "honor-points-gain", amount: 100 }];
  const before = structuredClone(events);
  assert.deepEqual(dailyActivity(events), [{ day: "2026-11-08", hk: 2, kills: 1, deaths: 1 }, { day: "2026-11-07", hk: 8, kills: 0, deaths: 0 }]);
  assert.equal(dailyActivity(events, "oldest")[0].day, "2026-11-07");
  assert.equal(dailyActivity(events, "honor")[0].hk, 8);
  assert.equal(sortActivity(events, "oldest")[0].at, previous);
  assert.equal(sortActivity(events, "honor")[0].amount, 99);
  assert.deepEqual(events, before);
});

test("three nearby guildmates produce one probable group without inventing shared victims", () => {
  const characters = [member("Alice"), member("Bob", 25), member("Cara", 60)];
  characters[1].events.push(event(noon + 30, 0, "player-kill"));
  const before = structuredClone(characters);
  const [group] = probableGroups(characters);
  assert.equal(group.members.length, 3);
  assert.equal(group.hk, 3);
  assert.equal(group.kills, 1);
  assert.equal(group.observations, 4);
  assert.equal(group.end - group.start, 60);
  assert.deepEqual(characters, before);
  assert.equal(probableGroups(characters, { day: "2026-11-07" }).length, 0);
  const duo = probableGroups(characters.slice(0, 2));
  assert.equal(duo.length, 1);
  assert.equal(duo[0].members.length, 2);
});

test("group inference requires distinct players, guild at event time, matching map, population and close coordinates", () => {
  const scenarios = [
    (c) => { c[1].key = "Alice"; },
    (c) => { c[1].snapshots[0].guild = "Other"; },
    (c) => { c[1].snapshots[0].at = noon + 90; },
    (c) => { c[1].region = "1"; },
    (c) => { c[1].ruleset = "pve"; },
    (c) => { c[1].events[0].location.mapId = 14; },
    (c) => { c[1].events[0].location.x = .9; },
    (c) => { delete c[1].events[0].location.x; },
    (c) => { c[1].events[0].context = "pvp"; },
    (c) => { c[1].events[0].type = "death"; },
    (c) => { c[1].events[0].at = noon + 121; },
  ];
  for (const change of scenarios) {
    const characters = [member("Alice"), member("Bob", 20)];
    change(characters);
    assert.equal(probableGroups(characters).length, 0);
  }
  const solo = member("Alice");
  solo.events = [event(noon), event(noon + 20), event(noon + 40)];
  assert.equal(probableGroups([solo]).length, 0);
});

test("proximity sequences do not chain across a long session or transfer after leaving a guild", () => {
  const characters = [member("Alice"), member("Bob", 80), member("Cara", 160)];
  const groups = probableGroups(characters);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].members.map((item) => item.name), ["Alice", "Bob"]);
  const player = member("Alice");
  player.events = [event(noon), event(noon + 80)];
  player.snapshots.push({ at: noon + 40, guild: "Other" });
  assert.equal(guildEvents(player, "Guild").length, 1);
  assert.equal(guildEvents(player, "Other").length, 1);
});

test("nearby fragments with two shared players merge as the group grows and moves", () => {
  const a = member("Alice"), b = member("Bob"), c = member("Cara");
  a.events = [event(noon), event(noon + 90, 1, "honor-gain", { mapId: 37, x: .7, y: .7 }), event(noon + 180, 1, "honor-gain", { mapId: 37, x: .2, y: .2 })];
  b.events = structuredClone(a.events).map((item) => ({ ...item, at: item.at + 1 }));
  c.events = structuredClone(a.events.slice(1)).map((item) => ({ ...item, at: item.at + 2 }));
  const groups = probableGroups([a, b, c]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 3);
  assert.equal(groups[0].encounters.length, 3);
  assert.equal(groups[0].observations, 8);
  assert.equal(groups[0].hk, 8);
  assert.equal(groups[0].end, noon + 182);
});

test("a probable session can last hours and span zones while requiring repeated proximity evidence", () => {
  const a = member("Alice"), b = member("Bob");
  a.events = Array.from({ length: 13 }, (_, i) => event(noon + i * 1200, 2, "honor-gain", {
    mapId: i < 6 ? 37 : 14, zone: i < 6 ? "Elwynn" : "Durotar", x: .2 + i * .04, y: .5 }));
  b.events = structuredClone(a.events).map((item) => ({ ...item, at: item.at + 1 }));
  const groups = probableGroups([a, b]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].end - groups[0].start, 4 * 3600 + 1);
  assert.equal(groups[0].encounters.length, 13);
  assert.equal(groups[0].hk, 52);
  assert.equal(groups[0].observations, 26);
  assert.deepEqual(groups[0].zones, ["Elwynn", "Durotar"]);
  const scoped = selectGroupSessions(groups, { includesMap: (id) => id === 14 });
  assert.equal(scoped[0].hk, 28);
  assert.equal(scoped[0].encounters.length, 7);
  assert.deepEqual(scoped[0].zones, ["Durotar"]);
  assert.equal(groups[0].hk, 52, "Filtering must not mutate the original session");
  assert.equal(formatSessionDuration(4 * 3600 + 1), "4 h");
});

test("sessions split after inactivity and do not merge through a single shared guildmate", () => {
  const a = member("Alice"), b = member("Bob"), c = member("Cara");
  a.events = [event(noon), event(noon + 1900)];
  b.events = [event(noon + 1), event(noon + 1901)];
  assert.equal(probableGroups([a, b]).length, 2);
  a.events = [event(noon)];
  b.events = [event(noon + 1), event(noon + 300)];
  c.events = [event(noon + 301)];
  assert.equal(probableGroups([a, b, c]).length, 2);
});

test("sessions can cross midnight but daily filters count only that day's evidence", () => {
  const midnight = dayBounds("2026-11-09").start;
  const a = member("Alice"), b = member("Bob");
  a.events = [event(midnight - 300, 2), event(midnight + 300, 3)];
  b.events = [event(midnight - 299, 2), event(midnight + 301, 3)];
  const groups = probableGroups([a, b]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].hk, 10);
  const first = selectGroupSessions(groups, { day: "2026-11-08" });
  const second = selectGroupSessions(groups, { day: "2026-11-09" });
  assert.equal(first[0].hk, 4);
  assert.equal(second[0].hk, 6);
  assert.equal(second[0].sessionStart, midnight - 300);
  assert.equal(selectGroupSessions(groups, { day: "2026-11-07" }).length, 0);
});

test("legacy missing guild reads can support a probable group using a later same-session observation", () => {
  const a = member("Alice"), b = member("Bob", 1);
  b.snapshots[0].guild = null;
  b.snapshots.push({ at: noon + 300, guild: "Guild" });
  const before = structuredClone(b);
  const [session] = probableGroups([a, b]);
  assert.equal(session.members.length, 2);
  assert.equal(session.inferredGuildMembers, 1);
  assert.equal(session.members.find((item) => item.key === "Bob").guildInferred, true);
  assert.equal(guildEvents(b, "Guild").length, 0, "Inferred guild membership must not rewrite confirmed historical guild totals");
  assert.deepEqual(b, before);
});

test("guild inference never overrides confirmed absence, a session boundary, a source change or a later explicit join", () => {
  const scenarios = [
    (b) => { b.snapshots[0].guildKnown = true; },
    (b) => { b.snapshots[1].guildKnown = true; },
    (b) => { b.events.push({ at: noon + 100, type: "session-end" }); },
    (b) => { b.events.push({ at: noon + 100, type: "session-start" }); },
    (b) => { b.events.push({ at: noon + 300, type: "session-start" }); },
    (b) => { b.events[0].sourceId = "old"; b.snapshots[1].sourceId = "other"; },
    (b) => { b.snapshots.shift(); },
  ];
  for (const change of scenarios) {
    const b = member("Bob", 1);
    b.snapshots = [{ at: noon - 100, guild: null }, { at: noon + 300, guild: "Guild" }];
    change(b);
    assert.equal(guildEvidence(b).has(b.events[0]), false);
  }
});
