"""Rebuild the human-approved compact charge. Existing ffmpeg; no downloads.

The source and recipe are preserved beside this runtime asset. Round-03 study:
start .10 s, duration .68 s, unchanged pitch/speed, 90 Hz high-pass, 7 kHz
low-pass, -10 dB, 12 ms fade in, 120 ms fade out. Runtime plays at gain 0.5.
"""
from pathlib import Path
import hashlib
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
source = HERE / "source/meow-cat-2-joseph-sardin-1890.wav"
if hashlib.sha256(source.read_bytes()).hexdigest() != "fe182a75fa840790197eb6570748c391efec690c335d804aeaa199842bf40f1d":
    raise ValueError("Original Meow Cat #2 differs from the inspected source")
binary = shutil.which("ffmpeg")
if binary is None:
    raise RuntimeError("Rebuilding the audio requires the existing ffmpeg tool")
subprocess.run([
    binary, "-nostdin", "-v", "error", "-y", "-i", str(source),
    "-map_metadata", "-1", "-af",
    "atrim=start=0.1:duration=0.68,asetpts=PTS-STARTPTS,highpass=f=90,lowpass=f=7000,volume=-10dB,afade=t=in:d=0.012,afade=t=out:st=0.56:d=0.12",
    "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", str(HERE / "charge.wav"),
], check=True, timeout=20)
