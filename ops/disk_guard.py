#!/usr/bin/python3
"""Fail-closed ingestion guard. Never resumes the scanner automatically."""
import json
import math
import os
import subprocess
import sys
import time

GIB = 1024 ** 3
MIN_FREE = 4 * GIB
START_FREE = 6 * GIB
MIN_RATIO = 0.15
EMERGENCY_SECONDS = 40  # 10s polling + 20s service stop + 10s margin.
VOLUMES = ('/var/lib/mongodb', '/home/core/ton-notify-current')
STATE_FILE = '/run/ton-notify-protection/disk.json'
SCANNER = 'ton-notify-scanner.service'


def measure():
    volumes = {}
    for path in VOLUMES:
        stat = os.statvfs(path)
        total = stat.f_blocks * stat.f_frsize
        free = stat.f_bavail * stat.f_frsize
        if total <= 0 or free < 0:
            raise ValueError('invalid filesystem measurement')
        volumes[path] = {'free': free, 'total': total}
    return volumes


def reason(volumes, previous, now, starting=False):
    for path, values in volumes.items():
        free, total = values['free'], values['total']
        if free < (START_FREE if starting else MIN_FREE) or free / total < MIN_RATIO:
            return 'insufficient disk reserve on ' + path
        if starting:
            continue
        old = previous.get('volumes', {}).get(path)
        timestamp = previous.get('time', now)
        if not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp):
            raise ValueError('invalid disk history time')
        if old:
            if not isinstance(old['free'], (int, float)) or not math.isfinite(old['free']) or old['free'] < 0:
                raise ValueError('invalid disk history')
            elapsed = now - timestamp
            recent_rate = (old['free'] - free) / elapsed if 0 < elapsed <= 120 else 0
            if recent_rate > 0 and free / recent_rate < EMERGENCY_SECONDS:
                return 'disk exhaustion imminent on ' + path
    return None


def read_state():
    try:
        with open(STATE_FILE) as source:
            state = json.load(source)
            return state if isinstance(state, dict) else {}
    except (OSError, ValueError):
        return {}


def write_state(state):
    # /run is tmpfs on the deployment host. Failure never prevents the stop.
    try:
        with open(STATE_FILE + '.tmp', 'w') as target:
            json.dump(state, target)
        os.replace(STATE_FILE + '.tmp', STATE_FILE)
    except OSError:
        pass


def main(starting=False):
    previous = read_state()
    now = time.monotonic()
    try:
        volumes = measure()
        problem = reason(volumes, previous, now, starting)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        volumes = {}
        problem = 'disk measurement unavailable'
    if problem and not starting:
        # No marker, temporary file or log write precedes the safety action.
        result = subprocess.run(['systemctl', 'stop', SCANNER], timeout=75, check=False)
        if result.returncode:
            print('Disk protection could not stop scanner', file=sys.stderr)
            return 2
    if problem and (starting or previous.get('problem') != problem):
        message = 'Scanner start blocked: ' + problem if starting else 'Scanner held: ' + problem + '; manual restart required after recovery'
        print(message, file=sys.stderr)
        if not starting:
            print(json.dumps({'time': now, 'volumes': volumes, 'previous': previous.get('volumes')}), file=sys.stderr)
    if not starting:
        write_state({'time': now, 'volumes': volumes, 'problem': problem})
    return 1 if problem else 0


if __name__ == '__main__':
    if sys.argv[1:] not in ([], ['--check-start']):
        raise SystemExit('usage: disk_guard.py [--check-start]')
    raise SystemExit(main(starting=bool(sys.argv[1:])))
