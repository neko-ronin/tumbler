import {parakiteLessonIds} from '../../../shared/activities/parakite-lesson.js';

function foldLesson(side) {
  const openSide = side === 'left' ? 'right' : 'left';
  const key = openSide === 'right' ? 'D' : 'A';
  return {
    name: side === 'left' ? 'Left side collapse' : 'Right side collapse',
    brief: 'A gust can unload one side of the wing. Catch the turn while that side refills.',
    cues: {
      'wait-gust': 'Glide straight out over the valley. A practice gust will reach one wingtip.',
      gust: 'Watch the wing and the two pressure readings.',
      counter: `The ${side} side folded. Ease the stick ${openSide} or press ${key} briefly to catch the turn.`,
      'tuck-centre': 'Centre and let the slack lines take load again as the wing refills.',
      'missed-gust': 'The wing stayed open. Retry from the bench.',
      'missed-correction': 'The wing reopened with some drift. Retry and catch the turn sooner.',
      'wide-turn': 'That turn carried too far. Centre, regain glide, and try a shorter correction.',
      passed: 'You corrected the turn and both sides are flying again.',
    },
  };
}

const lessons = {
  stall: {
    name: 'Stall and reopen',
    brief: 'A long pull at glide speed can make both sides fold. Bring the wing back into the airflow.',
    cues: {
      pull: 'Glide for a moment, then pull both handles back. Watch the airspeed fall.',
      ease: 'Let go of the pull. The wing is running out of airflow and can still fold.',
      raise: 'Both sides are folding. Raise both handles to start reopening the wing.',
      centre: 'Release the forward input and centre the controls.',
      settle: 'Stay centred. The wing may refill while you are still diving. Let it return to glide.',
      passed: 'Both sides are full and you are flying again.',
    },
  },
  spiral: {
    name: 'Descending spiral',
    brief: 'A held turn winds into a fast descent. Leave it early and the wing surges ahead: catch the surge with the brakes.',
    cues: {
      clearance: 'Glide straight out over the valley to give the spiral room.',
      entry: 'Roll into a left turn and hold it while the wing dives in.',
      release: 'Let go of the turn now, and pull back briefly as the wing surges ahead.',
      'surge-fold': 'The wing surged ahead and folded a side. Let it refill and level out, then try again: pull back as you let go.',
      'missed-check': 'The wing held this time, but catch the surge with a brief pull as you let go. Level out and try again.',
      turn: 'Now hold left through one full circle. Watch how quickly the ground comes up.',
      unwind: 'Let go of the turn and pull back briefly as the wing surges, then centre and let the dive settle.',
      passed: 'Early exit caught, full circle, and a controlled exit.',
    },
  },
  loop: {
    name: 'Whole-rig loop',
    brief: 'Build speed in a dive, then spend it on a loop. Pulling too early can stall the wing.',
    cues: {
      dive: 'Hold the dive input until you reach about 144 km/h airspeed.',
      pull: 'Switch from dive to pull after a short beat. Hold the pull through the loop.',
      rotate: 'Carry the pull over the top. Release as you come back around.',
      exit: 'Centre the controls and let the dive settle.',
      'lost-load': 'The rig lost its support. Ease the pull. If both sides fold, raise the handles until flow returns, then centre.',
      passed: 'Full loop with the wing supported, then back to glide.',
    },
  },
  'tuck-left': foldLesson('left'),
  'tuck-right': foldLesson('right'),
  abort: {
    name: 'Abort a loop entry',
    brief: 'A short dive leaves too little energy to go over the top. Practise letting go while the lines still carry load.',
    cues: {
      'short-dive': 'Start with a short dive.',
      'short-pull': 'Let the dive input go, then begin the pull after a short beat.',
      'abort-pull': 'The rig is climbing with too little speed for the top. Release the pull now.',
      'abort-glide': 'Stay centred and let the rig trade height back for speed.',
      'lost-load': 'The lines unloaded. If both sides fold, raise the handles and centre once the wing reopens.',
      passed: 'You saved the entry before the wing lost pressure.',
    },
  },
  clearance: {
    name: 'Exit before the slope',
    brief: 'Turning towards rising terrain can use up your room to recover. Feel when to leave the turn.',
    cues: {
      'close-turn': 'Hold right from the bench. Watch the slope ahead as you turn towards it.',
      'clear-turn': 'The slope is closing in. Let go of the turn now and give the rig room to level out.',
      passed: 'You straightened the wing while you still had room to recover.',
    },
  },
};

const controls = {
  pull: 'S / stick back', raise: 'W / stick forward', centre: 'Let go of W / centre the stick',
  turn: 'A / stick left', exit: 'Controls centred', unwind: 'Let go of A, tap S / ease the stick back',
  entry: 'A / stick left', release: 'Let go of A, tap S / ease the stick back',
  'surge-fold': 'Controls centred', 'missed-check': 'Controls centred',
  dive: 'W / stick forward', rotate: 'S / stick back',
  'short-dive': 'W / stick forward', 'short-pull': 'S / stick back',
  'close-turn': 'D / stick right', 'clear-turn': 'Controls centred',
};

export function createParakitePractice({panel, open, navigation, canvas, challenge}) {
  const choice = panel.querySelector('select');
  const label = panel.querySelector('label');
  const title = panel.querySelector('[data-practice-title]');
  const prompt = panel.querySelector('[data-practice-prompt]');
  const readings = panel.querySelector('[data-tutorial-readings]');
  const action = panel.querySelector('[data-practice-action]');
  const leave = panel.querySelector('[data-practice-leave]');
  const next = panel.querySelector('[data-practice-next]');
  let sequence = null;
  let rendered = '';
  choice.replaceChildren(...parakiteLessonIds.map(id => new Option(lessons[id].name, id)));

  function prepare(id) {
    if (!parakiteLessonIds.includes(id) || !navigation.prepareFlightLesson(id, !!sequence)) return false;
    challenge.value = '';
    open.closest('details').open = false;
    canvas.focus();
    return true;
  }

  open.addEventListener('click', () => prepare(choice.value));
  choice.addEventListener('change', () => prepare(choice.value));
  action.addEventListener('click', () => {
    if (navigation.flightLesson?.ready) {
      navigation.beginFlightLesson();
      canvas.focus();
    } else prepare(choice.value);
  });
  leave.addEventListener('click', () => {
    if (sequence) sequence.onLeave();
    else navigation.endFlightLesson();
    canvas.focus();
  });
  function advance({allowIncomplete=false}={}) {
    const attempt=navigation.flightLesson;
    if (!sequence || !attempt || (!allowIncomplete && attempt.progress.phase !== 'passed')) return false;
    sequence.index++;
    if (sequence.index===sequence.ids.length) {
      const done=sequence.onDone;
      stopSequence();
      done();
    } else prepare(sequence.ids[sequence.index]);
    return true;
  }
  next.addEventListener('click',()=>advance({allowIncomplete:true}));
  function startSequence(ids,onDone,onLeave) {
    sequence={ids,index:0,onDone,onLeave};
    return prepare(ids[0]);
  }
  function stopSequence() {
    sequence=null;
    navigation.endFlightLesson();
  }

  function render() {
    const attempt = navigation.flightLesson;
    const key = attempt ? [attempt.progress.id, attempt.progress.phase, attempt.ready, !!sequence].join('/') : '';
    if (rendered === key) return;
    rendered = key;
    panel.hidden = !attempt;
    open.closest('#world').dataset.practisingFlight = String(!!attempt);
    if (!attempt) return;
    const {id, phase} = attempt.progress;
    const {name, brief, cues} = lessons[id];
    choice.value = id;
    panel.dataset.guided=String(!!sequence);
    label.hidden=choice.hidden=!!sequence;
    title.hidden=!sequence;
    if(sequence)title.textContent=`${name} · ${sequence.index+1} of ${sequence.ids.length}`;
    next.hidden=!sequence;
    next.textContent=sequence?.index===sequence?.ids.length-1?'Fly with Juno':'Next';
    action.hidden=!!sequence&&phase==='passed';
    leave.textContent=sequence?'Leave tutorial':'Free flight';
    const cue = attempt.ready ? brief : phase === 'contact' ? 'Contact ended the run. Try again from the bench.' : cues[phase];
    const input = attempt.ready ? 'Space / controller A to start' : controls[phase];
    prompt.textContent = input ? cue + '\n' + input : cue;
    action.textContent = attempt.ready ? 'Start flight' : 'Retry';
  }

  return {prepare, render, startSequence, stopSequence, advance,get statsDock(){return sequence&&!panel.hidden?readings:null;}};
}
