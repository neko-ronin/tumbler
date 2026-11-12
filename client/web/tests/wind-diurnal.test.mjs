/** The valley's own diurnal breeze, as the shared air field applies it.
 *
 *     node --test client/web/tests/wind-diurnal.test.mjs
 *
 * The claim under test is narrow and worth stating: **the phase of the day is
 * the only new input, and a caller that does not name one gets exactly the air
 * it always got.** That is what lets the diurnal model arrive without moving
 * the wing, the existing tests or any non-browser caller. Everything else here
 * checks that the term does what the world note says it does — up-valley in the
 * afternoon, half of that in the evening, none at night — and that the weather
 * mode's own thermal strength, not its wind strength, scales it.
 *
 * The valley's axis is the prevailing wind's own line, exactly reversed: the
 * westerly comes from 275° and the river runs from 95°. So the breeze never
 * turns the mean flow. It subtracts from it, and that subtraction — measured on
 * `steady`, the mean speed — is the whole of what a rotor or a wing sees change
 * with the hour.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sampleAir } from "../../../shared/activities/flight.js";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const config = read("../../../shared/activities/flight.json");
const worldmap = read("../../../shared/world/worldmap.json");
const wind = worldmap.wind;
const flat = () => 0;
const state = { x: 320, y: -640, z: 900, weather: "soaring" };
const at = (record, s = state) => sampleAir(config, record, s, 12, flat);
/** How much the named phase subtracts from the mean flow, in m/s. */
const drop = (phase, s = state) => at({ ...wind }, s).steady - at({ ...wind, phase }, s).steady;

test("a bare bearing and a record with no phase give exactly the same air", () => {
  // The legacy call, byte for byte: this is what keeps every existing test and
  // caller unchanged while the richer record path exists.
  assert.deepEqual(at(wind.direction_deg), at({ ...wind }));
  assert.deepEqual(at(wind.direction_deg), at({ ...wind, phase: undefined }));
});

test("night has no breeze, because the night flow is shallow and not modelled", () => {
  assert.equal(wind.diurnal.phases.night, 0, "the world note excludes the night reversal");
  assert.deepEqual(at({ ...wind, phase: "night" }), at({ ...wind }));
  assert.deepEqual(at({ ...wind, phase: "night" }), at(wind.direction_deg));
});

test("the afternoon breeze blows up-valley, exactly against the prevailing wind", () => {
  const plain = at({ ...wind }), afternoon = at({ ...wind, phase: "afternoon" });
  // The prevailing air comes from 275°; the valley runs from 95°, exactly the
  // other way. The breeze therefore cannot turn the mean flow — it can only
  // subtract from it, and that subtraction is the whole time-of-day effect.
  assert.ok(Math.abs(afternoon.bearing - plain.bearing) < 1e-9, "the mean flow's direction does not change");
  assert.ok(afternoon.steady < plain.steady, "the up-valley breeze is a headwind to the prevailing flow");
  const expected = wind.diurnal.peak_mps * config.weather.soaring.thermal_scale;
  assert.ok(Math.abs(drop("afternoon") - expected) < 1e-9,
    "the drop is the full afternoon peak, scaled by the weather's thermal strength");
});

test("evening is half the afternoon's breeze, from the same table", () => {
  const afternoon = drop("afternoon"), evening = drop("evening");
  assert.ok(afternoon > 0 && evening > 0);
  assert.ok(Math.abs(evening / afternoon - wind.diurnal.phases.evening / wind.diurnal.phases.afternoon) < 1e-9,
    "evening must be the table's fraction of the afternoon, not a second guess");
});

test("the breeze scales with the weather's thermal strength, not its wind strength", () => {
  const peak = wind.diurnal.peak_mps * wind.diurnal.phases.afternoon;
  const measured = {};
  for (const weather of ["calm", "soaring", "alpine"]) {
    const s = { ...state, weather };
    measured[weather] = drop("afternoon", s);
    assert.ok(Math.abs(measured[weather] - peak * config.weather[weather].thermal_scale) < 1e-9,
      `${weather} must scale the breeze by its thermal_scale, not its wind_scale`);
  }
  // An alpine day is the windiest and has the least of the sun's breeze; a calm
  // one has little of either. Only the thermal column moves the subtraction.
  assert.ok(measured.alpine < measured.soaring && measured.calm < measured.soaring);
});

test("the breeze is a mean flow: it does not hunt with the gust cycle", () => {
  const a = at({ ...wind, phase: "afternoon" }, { ...state, x: state.x + 37 });
  const b = at({ ...wind, phase: "afternoon" }, { ...state, x: state.x + 37 });
  assert.deepEqual(a, b, "the same place and time must give the same air");
  assert.ok(Number.isFinite(a.bearing) && a.bearing >= 0 && a.bearing < 360);
});

test("a record with no diurnal table is the phase-less air", () => {
  const { diurnal, ...bare } = wind;
  assert.ok(diurnal, "this world has one, or the rest of this file proves nothing");
  assert.deepEqual(at({ ...bare, phase: "afternoon" }), at(bare));
});
