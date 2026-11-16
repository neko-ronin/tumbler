// Observe fixed-step flight. The tuck exercise supplies a local air pulse to the solver.
import { rotateFlightVector } from './rotational-flight.js';

const TAU = 2 * Math.PI;
const FORWARD = [1, 0, 0];
const UP = [0, 0, 1];
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const centred = input => Math.abs(input.turn ?? 0) < .12 && Math.abs(input.brake ?? 0) < .12 &&
  (input.brakeLeft ?? 0) < .12 && (input.brakeRight ?? 0) < .12;

const initialPhase = {
  stall: 'pull', spiral: 'clearance', loop: 'dive',
  'tuck-left': 'wait-gust', 'tuck-right': 'wait-gust', abort: 'short-dive', clearance: 'close-turn',
};
export const parakiteLessonIds = Object.freeze(Object.keys(initialPhase));

export function startParakiteLesson(id) {
  if (!parakiteLessonIds.includes(id)) throw new RangeError('Unknown parakite lesson');
  return { id, phase: initialPhase[id], held: 0, stable: 0 };
}

/** A down-gust across one half-span in the practice flight's moving direction. */
export function parakiteLessonLift(lesson, state) {
  const gust = lesson?.gust;
  if (!gust || !state.rotation) return undefined;
  const phase = (state.rotation.timeS - gust.start) / .3;
  if (phase < 0 || phase >= 1) return undefined;
  const strength = 8 * Math.sin(Math.PI * phase) ** 2;
  return ([x, y]) => {
    const across = (x - gust.x) * gust.left[0] + (y - gust.y) * gust.left[1];
    return -strength * Math.max(0, Math.min(1, (across * gust.side - .2) / 1.1));
  };
}

function stableExit(lesson, state, input, dt, hasFinished, bothOpen) {
  const upright = rotateFlightVector(state.rotation.wing.orientation, UP)[2] > .9 &&
    rotateFlightVector(state.rotation.pilot.orientation, UP)[2] > .8;
  const recovered = hasFinished && bothOpen && upright && centred(input) &&
    state.load > .35 && state.speed > 16 && Math.abs(state.bank) < .2 && Math.abs(state.vario) < 5;
  lesson.stable = recovered ? lesson.stable + dt : 0;
  if (lesson.stable >= .35) lesson.phase = 'passed';
}

function stall(lesson, state, input, dt, bothOpen) {
  const pressure = state.rotation.pressure;
  if (lesson.phase === 'pull' && input.brake > .65 && state.speed < 10.5) lesson.phase = 'ease';
  if ((lesson.phase === 'pull' || lesson.phase === 'ease') && Math.max(...pressure) < .29) lesson.phase = 'raise';
  else if (lesson.phase === 'ease' && centred(input) && bothOpen && state.speed > 16) lesson.phase = 'pull';
  if (lesson.phase === 'raise') {
    if (input.brake < -.6) lesson.held += dt;
    else if (centred(input) && lesson.held >= .3) lesson.phase = 'centre';
    else lesson.held = 0;
    if (lesson.held >= 1.9) lesson.phase = 'centre';
  }
  if (lesson.phase === 'centre' && centred(input)) { lesson.phase = 'settle'; lesson.held = 0; }
  if (lesson.phase === 'settle') {
    stableExit(lesson, state, input, dt, true, bothOpen);
    // After another deep stall the same advice is available again.
    if (Math.max(...pressure) < .15 && state.vario < -8 && state.groundSpeed < 10) {
      lesson.held += dt;
      if (lesson.held >= 2.2) { lesson.phase = 'raise'; lesson.held = 0; }
    } else lesson.held = 0;
  }
}

function spiral(lesson, before, state, input, dt, height, bothOpen) {
  if (lesson.phase === 'clearance' && state.z - height(state.x, state.y) >= 340) {
    lesson.phase = 'turn';
    lesson.travel = 0;
    lesson.descended = false;
  }
  if (lesson.phase === 'turn') {
    if (input.turn < -.3) {
      lesson.travel += angleDelta(before.heading, state.heading);
      lesson.descended ||= state.vario < -10;
    } else if (Math.abs(state.bank) < .15) {
      lesson.travel = 0;
      lesson.descended = false;
    }
    if (lesson.travel >= TAU && lesson.descended) lesson.phase = 'exit';
  }
  if (lesson.phase === 'exit') stableExit(lesson, state, input, dt, true, bothOpen);
}

function pitchAngles(rotation, heading) {
  const angle = ([x, y, z]) => Math.atan2(z, Math.cos(heading) * x + Math.sin(heading) * y);
  const { pilot, wing } = rotation;
  return [pilot.velocity, wing.velocity, rotateFlightVector(pilot.orientation, FORWARD),
    rotateFlightVector(wing.orientation, FORWARD)].map(angle);
}

function loop(lesson, before, state, input, dt, bothOpen) {
  if ((lesson.phase === 'dive' || lesson.phase === 'pull') && state.pressure < .6) lesson.phase = 'lost-load';
  if (lesson.phase === 'dive' && state.speed >= 40) lesson.phase = 'pull';
  if (lesson.phase === 'pull' && input.brake > .65 && before.rotation) {
    lesson.phase = 'rotate';
    lesson.heading = before.heading;
    lesson.travel = [0, 0, 0, 0];
    lesson.inverted = false;
  }
  if (lesson.phase === 'rotate' || lesson.phase === 'exit') {
    const { rotation } = state;
    if (Math.min(...rotation.pressure) < .75 || rotation.sections.some(side => side.load < .25)) {
      lesson.phase = 'lost-load';
      return;
    }
    const old = pitchAngles(before.rotation, lesson.heading);
    const now = pitchAngles(rotation, lesson.heading);
    lesson.travel = lesson.travel.map((value, i) => value + angleDelta(old[i], now[i]));
    lesson.inverted ||= rotateFlightVector(rotation.wing.orientation, UP)[2] < -.85;
    if (lesson.inverted && lesson.travel.every(angle => angle > 5.7)) lesson.phase = 'exit';
    stableExit(lesson, state, input, dt, lesson.inverted && lesson.travel.every(angle => angle >= TAU), bothOpen);
  }
}

function tuck(lesson, state, input, dt, height, bothOpen) {
  if (lesson.phase === 'wait-gust' && centred(input) && bothOpen && Math.abs(state.bank) < .12 &&
      state.z - height(state.x, state.y) > 160) {
    const [x, y] = state.rotation.pilot.position;
    const {heading} = state;
    lesson.gust = {x, y, heading, left: [-Math.sin(heading), Math.cos(heading)],
      side: lesson.id === 'tuck-left' ? 1 : -1, start: state.rotation.timeS};
    lesson.phase = 'gust';
    lesson.peakDrift = 0;
  }
  if (!['gust', 'counter', 'tuck-centre'].includes(lesson.phase)) return;
  const gust = lesson.gust;
  const folded = gust.side > 0 ? 1 : 0;
  const pressure = state.rotation.pressure;
  lesson.peakDrift = Math.max(lesson.peakDrift, Math.abs(angleDelta(gust.heading, state.heading)));
  if (lesson.phase === 'gust') {
    if (pressure[folded] < .52 && pressure[1 - folded] > .78) lesson.phase = 'counter';
    else if (state.rotation.timeS - gust.start > 1.5) lesson.phase = 'missed-gust';
  }
  if (lesson.phase === 'counter') {
    lesson.held += Math.max(0, (input.turn ?? 0) * gust.side) * dt;
    if (lesson.held >= .16) lesson.phase = 'tuck-centre';
    else if (bothOpen) lesson.phase = 'missed-correction';
  }
  if (lesson.peakDrift > .85) lesson.phase = 'wide-turn';
  if (lesson.phase === 'tuck-centre') stableExit(lesson, state, input, dt, true, bothOpen);
}

function abort(lesson, state, input, dt, bothOpen) {
  if (lesson.phase === 'short-dive') {
    lesson.held = input.brake < -.6 ? lesson.held + dt : 0;
    if (lesson.held + 1e-9 >= 2) lesson.phase = 'short-pull';
  }
  if (lesson.phase === 'short-pull' && input.brake > .65 && state.vario > 1 && state.load > 1.4) {
    lesson.phase = 'abort-pull';
  }
  if (lesson.phase === 'abort-pull' && centred(input)) lesson.phase = 'abort-glide';
  if (lesson.phase === 'abort-glide') stableExit(lesson, state, input, dt, true, bothOpen);
  if (lesson.phase !== 'passed' && state.pressure < .6) lesson.phase = 'lost-load';
}

function clearance(lesson, state, input, dt, height, bothOpen) {
  // A short tangent projection warns about the rising slope during the turn.
  if (lesson.phase === 'close-turn' && input.turn > .5 && state.bank > .6 && state.vario < -6) {
    const ahead = height(state.x + 3 * state.vx, state.y + 3 * state.vy);
    if (state.z + 3 * state.vario - ahead < 225) lesson.phase = 'clear-turn';
  }
  if (lesson.phase === 'clear-turn') {
    stableExit(lesson, state, input, dt, state.z - height(state.x, state.y) > 35, bothOpen);
  }
}

export function stepParakiteLesson(lesson, before, state, input, dt, height) {
  if (lesson.phase === 'passed' || lesson.phase === 'contact') return lesson;
  if (state.grounded || state.collapsed || state.impact) { lesson.phase = 'contact'; return lesson; }
  if (!state.rotation) return lesson;
  const bothOpen = state.rotation.pressure.every(pressure => pressure >= .95);
  if (lesson.id === 'stall') stall(lesson, state, input, dt, bothOpen);
  if (lesson.id === 'spiral') spiral(lesson, before, state, input, dt, height, bothOpen);
  if (lesson.id === 'loop') loop(lesson, before, state, input, dt, bothOpen);
  if (lesson.id === 'tuck-left' || lesson.id === 'tuck-right') tuck(lesson, state, input, dt, height, bothOpen);
  if (lesson.id === 'abort') abort(lesson, state, input, dt, bothOpen);
  if (lesson.id === 'clearance') clearance(lesson, state, input, dt, height, bothOpen);
  return lesson;
}
