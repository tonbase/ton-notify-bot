import importlib.util
import pathlib
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('disk_guard', pathlib.Path(__file__).resolve().parents[1] / 'ops/disk_guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class DiskGuardTests(unittest.TestCase):
    def volumes(self, free):
        return {path: {'free': free * guard.GIB, 'total': 25 * guard.GIB} for path in guard.VOLUMES}

    def test_requires_larger_reserve_to_start(self):
        self.assertIsNone(guard.reason(self.volumes(5), {}, 1))
        self.assertIsNotNone(guard.reason(self.volumes(5), {}, 1, starting=True))
        self.assertIsNone(guard.reason(self.volumes(7), {}, 1, starting=True))

    def test_stops_before_rapid_growth_consumes_reserve(self):
        previous = {'time': 10, 'volumes': self.volumes(9)}
        self.assertIsNotNone(guard.reason(self.volumes(6), previous, 20))
        self.assertIsNone(guard.reason(self.volumes(10), previous, 20))

    def test_short_checkpoint_burst_does_not_predict_a_sustained_trend(self):
        previous = {'time': 0, 'volumes': self.volumes(10)}
        self.assertIsNone(guard.reason(self.volumes(9.5), previous, 10))
        self.assertIsNone(guard.reason(self.volumes(10), previous, 60))

    def test_minute_journal_growth_is_not_assumed_to_continue_indefinitely(self):
        previous = {'time': 10, 'volumes': self.volumes(9)}
        self.assertIsNone(guard.reason(self.volumes(6), previous, 70))

    def test_imminent_exhaustion_stops_without_waiting_for_history(self):
        previous = {'time': 10, 'volumes': self.volumes(10)}
        self.assertIn('imminent', guard.reason(self.volumes(7), previous, 20))

    def test_absolute_floor_applies_during_history_warmup(self):
        self.assertIsNotNone(guard.reason(self.volumes(3.9), {}, 10))

    def test_full_disk_stops_before_attempting_state_write(self):
        actions = []
        with mock.patch.object(guard, 'read_state', return_value={}), \
             mock.patch.object(guard, 'measure', return_value=self.volumes(0)), \
             mock.patch.object(guard.subprocess, 'run', side_effect=lambda *a, **k: actions.append('stop') or mock.Mock(returncode=0)), \
             mock.patch.object(guard, 'write_state', side_effect=lambda state: actions.append('record')), \
             mock.patch('builtins.print'):
            self.assertEqual(guard.main(), 1)
        self.assertEqual(actions, ['stop', 'record'])

    def test_measurement_failure_stops_ingestion(self):
        with mock.patch.object(guard, 'read_state', return_value={}), \
             mock.patch.object(guard, 'measure', side_effect=OSError('unavailable')), \
             mock.patch.object(guard.subprocess, 'run', return_value=mock.Mock(returncode=0)) as run, \
             mock.patch.object(guard, 'write_state'), mock.patch('builtins.print'):
            self.assertEqual(guard.main(), 1)
            self.assertEqual(run.call_args.args[0], ['systemctl', 'stop', guard.SCANNER])

    def test_state_write_failure_does_not_throw(self):
        with mock.patch('builtins.open', side_effect=OSError('ENOSPC')):
            guard.write_state({'problem': 'full'})

    def test_non_object_state_is_ignored(self):
        for value in ('[]', 'null', '"invalid"', '{broken'):
            with mock.patch('builtins.open', mock.mock_open(read_data=value)):
                self.assertEqual(guard.read_state(), {})

    def test_invalid_rate_history_fails_closed(self):
        for previous in ({'volumes': []}, {'volumes': {guard.VOLUMES[0]: {'free': 'invalid'}}, 'time': 1},
                         {'time': float('nan')}, {'time': float('inf')},
                         {'volumes': {guard.VOLUMES[0]: {'free': float('nan')}}, 'time': 1}):
            with mock.patch.object(guard, 'read_state', return_value=previous), \
                 mock.patch.object(guard.time, 'monotonic', return_value=10), \
                 mock.patch.object(guard, 'measure', return_value=self.volumes(8)), \
                 mock.patch.object(guard.subprocess, 'run', return_value=mock.Mock(returncode=0)) as run, \
                 mock.patch.object(guard, 'write_state'), mock.patch('builtins.print'):
                self.assertEqual(guard.main(), 1)
                run.assert_called_once()

    def test_healthy_volume_never_automatically_starts_scanner(self):
        with mock.patch.object(guard, 'read_state', return_value={'problem': 'full'}), \
             mock.patch.object(guard, 'measure', return_value=self.volumes(9)), \
             mock.patch.object(guard.subprocess, 'run') as run, \
             mock.patch.object(guard, 'write_state'):
            self.assertEqual(guard.main(), 0)
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
