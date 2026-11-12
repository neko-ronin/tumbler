"""Render the Organoid's whisper, Ronin's cat calls and his closing mutter.

Run on macOS with Whisper and the existing ffmpeg tool. Ronin's calls are
shaped from the retained Meow Cat #2 source used by the character charge.
"""
from __future__ import annotations

from array import array
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import wave

HERE = Path(__file__).resolve().parent
RATE = 32000
ROOT = HERE.parents[4]
CAT_SOURCE = HERE.parent / "character/source/meow-cat-2-joseph-sardin-1890.wav"
CAT_SHA256 = "fe182a75fa840790197eb6570748c391efec690c335d804aeaa199842bf40f1d"


@dataclass(frozen=True)
class Call:
    at: float
    source: float
    length: float
    pitch_in: float
    pitch_out: float
    gain: float
    roll_hz: float = 0


CAT_CALLS = {
    "startled": (
        Call(.04, .90, .085, 1.58, 1.86, .64),
        Call(.20, .84, .59, 1.01, .84, .86, 12),
    ),
    "question": (
        Call(.04, .78, .29, 1.04, 1.54, .73, 17),
        Call(.37, .94, .11, 1.51, 1.79, .60),
    ),
    "chatter": (
        Call(.06, .88, .085, 1.62, 1.34, .82, 27),
        Call(.17, .96, .095, 1.37, 1.51, .69, 22),
        Call(.30, 1.02, .077, 1.83, 1.44, .74, 24),
        Call(.39, .91, .12, 1.32, 1.54, .60, 21),
        Call(.57, 1.11, .082, 1.58, 1.24, .48, 20),
    ),
    "dubious": (
        Call(.04, .89, .83, 1.06, .82, .83),
        Call(.94, 1.07, .16, 1.15, 1.41, .42, 13),
    ),
    "understood": (
        Call(.06, .87, .48, 1.11, .91, .73, 21),
        Call(.56, 1.04, .15, 1.14, 1.00, .33, 16),
    ),
}


def decode(path: Path, lowpass: int = 6200) -> array:
    data = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(path), "-af", f"highpass=f=95,lowpass=f={lowpass}",
        "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-",
    ])
    samples = array("f")
    samples.frombytes(data)
    if not samples or max(map(abs, samples)) < 1e-4:
        raise RuntimeError(f"{path.name} did not produce an audible take")
    return samples


def normalized(samples: array, peak: float) -> array:
    scale = peak / max(map(abs, samples))
    return array("f", (value * scale for value in samples))


def whisper(path: Path, text: str) -> array:
    subprocess.run(["say", "-v", "Whisper", "-r", "148", "-o", str(path), text], check=True)
    return normalized(decode(path), .70)


def mutter(path: Path, text: str) -> array:
    subprocess.run(["say", "-v", "Evan (Enhanced)", "-r", "166", "-o", str(path), text], check=True)
    samples = decode(path, lowpass=3600)
    # Trim the synthesizer's trailing pause. The cinematic holds after the take.
    end = next(i for i in range(len(samples) - 1, -1, -1) if abs(samples[i]) > .001)
    return normalized(samples[:end + round(.045 * RATE)], .43)


def sample_at(samples: array, at: float) -> float:
    if at < 0 or at >= len(samples) - 1:
        return 0.0
    lo = int(at)
    return samples[lo] + (samples[lo + 1] - samples[lo]) * (at - lo)


def cat_vocal(samples: array, vocal: str) -> array:
    notes = CAT_CALLS[vocal]
    result = array("f", [0]) * math.ceil((max(n.at + n.length for n in notes) + .045) * RATE)
    for note in notes:
        count = round(note.length * RATE)
        at = note.source * RATE
        start = round(note.at * RATE)
        for i in range(count):
            t = i / RATE
            # Taper both ends of each excerpt. A shallow flutter shapes the
            # rolled syllables without replacing the recorded feline timbre.
            envelope = min(1, t / .016, (note.length - t) / min(.07, note.length * .33))
            flutter = .82 + .18 * math.cos(2 * math.pi * note.roll_hz * t) if note.roll_hz else 1
            result[start + i] += sample_at(samples, at) * envelope * flutter * note.gain
            at += note.pitch_in + (note.pitch_out - note.pitch_in) * i / count
    return normalized(result, .61)


def voice_clip(samples: array, inside: bool) -> array:
    clip = array("h")
    tail = .46 if inside else .20
    for i in range(len(samples) + round(tail * RATE)):
        dry = samples[i] if i < len(samples) else 0.0
        if inside:
            # Keep the intelligible whisper at the centre. Lower copies and
            # different early reflections move around the listener's head.
            ghost = sample_at(samples, (i - .055 * RATE) * .87) * .18
            left = dry * .74 + ghost + .17 * sample_at(samples, i - .043 * RATE)
            right = dry * .74 + ghost + .16 * sample_at(samples, i - .079 * RATE)
        else:
            left = dry * .82 + .06 * sample_at(samples, i - .059 * RATE)
            right = dry * .80 + .08 * sample_at(samples, i - .071 * RATE)
        for value in (left, right):
            clip.append(round(max(-.97, min(.97, value)) * 32767))
    return clip


def main() -> None:
    config = json.loads((ROOT / "shared/npc/organoid.json").read_text())
    if hashlib.sha256(CAT_SOURCE.read_bytes()).hexdigest() != CAT_SHA256:
        raise ValueError("Meow Cat #2 differs from the retained source")
    cat_source = decode(CAT_SOURCE)
    cue_sheet = {}
    track = array("h")
    guard = array("h", [0]) * round(RATE * .12) * 2
    with TemporaryDirectory(prefix="organoid-voice-") as temp:
        work = Path(temp)
        for line in [*config["dialogue"], config["wake"]["opening"]]:
            inside = line["speaker"] == "Organoid"
            take = work / f"{line['id']}.aiff"
            if inside:
                text = {"listen": "Hey… listen.", "wake": "Wake up. Hey… listen."}.get(line["id"], line["text"])
                samples = whisper(take, text)
            elif line.get("voice") == "mutter":
                samples = mutter(take, line["text"])
            else:
                samples = cat_vocal(cat_source, line["vocal"])
            clip = voice_clip(samples, inside)
            cue_sheet[line["id"]] = {
                "offset_s": round(len(track) / (2 * RATE), 6),
                "length_s": round(len(clip) / (2 * RATE), 6),
            }
            track.extend(clip)
            track.extend(guard)
        wav = work / "dialogue.wav"
        with wave.open(str(wav), "wb") as f:
            f.setnchannels(2)
            f.setsampwidth(2)
            f.setframerate(RATE)
            f.writeframes(track.tobytes())
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-codec:a",
                        "libmp3lame", "-q:a", "5", str(HERE / "dialogue.mp3")], check=True)
    (HERE / "cues.json").write_text(json.dumps(cue_sheet, indent=2) + "\n")


if __name__ == "__main__":
    main()
