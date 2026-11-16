import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {launchFlight, stepFlight} from '../../../shared/activities/flight.js';
import {parakiteLessonLift, startParakiteLesson, stepParakiteLesson} from '../../../shared/activities/parakite-lesson.js';

const config = JSON.parse(readFileSync(new URL('../../../shared/activities/flight.json', import.meta.url)));
config.experimentalParakite = true;
config.wind = {speed_mps: 0, gust_mps: 0};
config.thermals = [];
config.weather.still = {wind_scale: 0, gust_scale: 0, thermal_scale: 0, turbulence_mps: 0};
const dt = 1 / 120;
const height = () => 0;
const site = {xy_m: [0, 0], heading_deg: 0, clearance_m: 1200};

function run(id, inputs, duration) {
  const lesson = startParakiteLesson(id);
  const phases = new Set();
  let state = launchFlight(config, 'parakite', site, height, 'still');
  for (let tick = 0; tick < duration / dt; tick++) {
    const input = inputs(tick * dt, lesson, state);
    const lift = parakiteLessonLift(lesson, state);
    const next = stepFlight(state, input, dt, tick * dt, config, 0, height, null, height, height, lift);
    stepParakiteLesson(lesson, state, next, input, dt, height);
    phases.add(lesson.phase);
    state = next;
  }
  return {lesson, phases, state};
}

test('stall practice requires active recovery after both halves fold', () => {
  const pull = t => t >= .55 && t < 3.05;
  const waiting = run('stall', t => ({brake: pull(t) ? 1 : 0}), 19);
  const recovered = run('stall', t => ({brake: pull(t) ? 1 : t >= 3.65 && t < 5 ? -1 : 0}), 19);
  assert.equal(waiting.lesson.phase, 'raise');
  assert.deepEqual([...recovered.phases], ['pull', 'ease', 'raise', 'settle', 'passed']);
  assert.equal(run('stall', () => ({}), 10).lesson.phase, 'pull');
});

test('the stall prompts lead back to glide at different reaction times', () => {
  for (const delay of [.12, .22, .32]) {
    const lesson = startParakiteLesson('stall');
    const input = {brake: 0};
    const brakeFor = {pull: 1, raise: -1};
    let state = launchFlight(config, 'parakite', site, height, 'still');
    let changedAt = 0;
    for (let tick = 0; tick < 28 / dt && lesson.phase !== 'passed'; tick++) {
      const time = tick * dt;
      if (time > .55 && time - changedAt >= delay) input.brake = brakeFor[lesson.phase] ?? 0;
      const next = stepFlight(state, input, dt, time, config, 0, height);
      const phase = lesson.phase;
      stepParakiteLesson(lesson, state, next, input, dt, height);
      if (phase !== lesson.phase) changedAt = time;
      state = next;
    }
    assert.equal(lesson.phase, 'passed', `reaction time ${delay}s`);
  }
});

test('spiral practice waits for a whole descending circle and centred exit', () => {
  const short = run('spiral', t => ({turn: t < 6 ? -1 : 0}), 30);
  const full = run('spiral', t => ({turn: t < 15 ? -1 : 0}), 34);
  assert.equal(short.lesson.phase, 'turn');
  assert.equal(full.lesson.phase, 'passed');
});

test('loop practice credits both physical attitudes and paths, with a stable exit', () => {
  const loopInput = t => ({brake: t < 8.5 ? -1 : t >= 8.7 && t < 14.05 ? 1 : 0});
  const full = run('loop', loopInput, 22);
  const aborted = run('loop', t => t < 10 ? loopInput(t) : ({}), 22);
  assert.equal(full.lesson.phase, 'passed');
  assert.ok(full.lesson.travel.every(angle => angle >= 2 * Math.PI));
  assert.notEqual(aborted.lesson.phase, 'passed');
});

test('ground impact takes precedence over a pending passing score', () => {
  const lesson = startParakiteLesson('stall');
  lesson.phase = 'settle';
  lesson.stable = .34;
  stepParakiteLesson(lesson, {}, {grounded: true}, {}, dt, height);
  assert.equal(lesson.phase, 'contact');
  assert.equal(startParakiteLesson('stall').phase, 'pull');
});

test('mirrored gusts fold one side and a brief correction beats neutral or sustained input', () => {
  for (const side of ['left', 'right']) {
    const direction = side === 'left' ? 1 : -1;
    const folded = side === 'left' ? 1 : 0;
    const pressure = [1, 1];
    let slack = false;
    const corrected = run('tuck-' + side, (_time, lesson, state) => {
      if (state.rotation) {
        pressure[0] = Math.min(pressure[0], state.rotation.pressure[0]);
        pressure[1] = Math.min(pressure[1], state.rotation.pressure[1]);
        slack ||= state.rotation.sections[folded].load < .001;
      }
      return {turn: lesson.phase === 'counter' ? direction * .45 : 0};
    }, 12);
    const neutral = run('tuck-' + side, () => ({}), 12);
    const over = run('tuck-' + side, (_time, lesson) => ({turn: lesson.gust ? direction : 0}), 12);
    assert.ok(pressure[folded] < .4 && pressure[1 - folded] > .8 && slack);
    assert.equal(corrected.lesson.phase, 'passed');
    assert.equal(neutral.lesson.phase, 'missed-correction');
    assert.notEqual(over.lesson.phase, 'passed');
    const finalDrift = result => Math.abs(result.state.heading - result.lesson.gust.heading);
    assert.ok(finalDrift(corrected) < finalDrift(neutral));
  }
});

test('a shallow loop entry passes only after the player aborts the pull and regains glide', () => {
  const input = (time, lesson) => ({brake: time < 2 ? -1 : time < 2.55 ? 0 :
    lesson.phase === 'short-pull' ? 1 : 0});
  const recovered = run('abort', input, 20);
  assert.equal(recovered.lesson.phase, 'passed');
  const continued = run('abort', time => ({brake: time < 2 ? -1 : time < 2.55 ? 0 : 1}), 18);
  assert.equal(continued.lesson.phase, 'lost-load');
});
