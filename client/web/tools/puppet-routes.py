#!/usr/bin/env python3
"""Write the dev puppet's routes over each footbridge: the trail's own line from LEAD_M before one tread, the
treads and deck, and LEAD_M on past the other, both ways (client/web/tools/puppet.cjs walks them in the game).

    python3.11 client/web/tools/puppet-routes.py <out-dir>
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LEAD_M, STEP_M = 40.0, 3.0


def densify(points):
    out = [points[0]]
    for a, b in zip(points, points[1:]):
        n = max(1, math.ceil(math.dist(a, b)/STEP_M))
        out += [[round(a[0]+(b[0]-a[0])*k/n, 2), round(a[1]+(b[1]-a[1])*k/n, 2)] for k in range(1, n+1)]
    return out


def lead(line, start, away_from):
    """LEAD_M of the trail's line beyond `start`, heading away from `away_from`."""
    k = min(range(len(line)), key=lambda i: math.dist(line[i], start))
    step = 1 if math.dist(line[min(k+1, len(line)-1)], away_from) > math.dist(line[max(k-1, 0)], away_from) else -1
    out, run = [], 0.
    while run < LEAD_M and 0 <= k+step < len(line):
        k += step
        if math.dist(line[k], away_from) <= math.dist(start, away_from):
            continue
        run += math.dist(line[k], out[-1] if out else start)
        out.append(line[k])
    return out


def main(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    worldmap = json.loads((ROOT/'shared/world/worldmap.json').read_text())
    for b in json.loads((ROOT/'shared/world/out/footbridges.json').read_text())['bridges']:
        line = next(t['polyline'] for t in worldmap['tracks'] if t['id'] == b['track'])
        west, east = ([p[:2] for p in t] for t in b['approach_treads_xyz_m'])
        before = lead(line, west[-1], b['centre_xy_m'])[::-1]
        after = lead(line, east[-1], b['centre_xy_m'])
        yaw = math.radians(b['yaw_deg'])
        direction = [round(math.sin(yaw), 6), round(-math.cos(yaw), 6)]
        head = densify(before+west[::-1])
        tail = densify(east+after)
        for name, points, deck_index in ((f"{b['id']}-east", head+tail, len(head)), (f"{b['id']}-west", (head+tail)[::-1], len(tail))):
            n = len(points)
            route = {'name': name, 'waypoints': points, 'reach_m': 1.0, 'timeout_s': 150,
                     'shots': [max(1, deck_index-8), deck_index, min(n-2, deck_index+6)],
                     'expect': {'max_phase': 'stumble',
                                'above': [{'centre_xy_m': b['centre_xy_m'], 'dir_xy': direction, 'half_m': b['length_m']/2-1,
                                           'across_m': 1.0, 'z_m': b['deck_z_m'], 'slack_m': .3}]}}
            (out_dir/f'{name}.json').write_text(json.dumps(route, indent=1)+'\n')
            print(name, n, 'waypoints')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
