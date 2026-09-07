"""Integration checks for monthly prescriptions; no historical data writes."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/tcx'))
import plan_store
import score


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


cycle = module('cycle', 'scripts/training-cycle.py')
reports = module('reports', 'scripts/build-ride-reports.py')


class MonthlyPlans(unittest.TestCase):
    def setUp(self):
        self.month = json.loads((ROOT / 'data/plans/2026-10.json').read_text())

    def test_legacy_days_unchanged_and_ftp_isolated(self):
        legacy = json.loads((ROOT / 'data/plan.json').read_text())
        merged = plan_store.load_plan()
        for date, day in legacy['days'].items():
            self.assertEqual(merged['days'][date], day)
        self.assertEqual(plan_store.baseline_for(merged, merged['days']['2026-09-03'])['ftp_w'], 238)
        self.assertEqual(plan_store.baseline_for(merged, merged['days']['2026-10-06'])['ftp_w'], 234)

    def test_all_days_variants_and_time_budgets(self):
        self.assertTrue(cycle.validate(self.month))
        self.assertEqual(len(self.month['days']), 32)

    def test_rain_preserves_work_but_shortens_total(self):
        for date in ['2026-10-06', '2026-10-13', '2026-10-20']:
            outdoor = plan_store.resolve_day(self.month, date, 'outdoor')
            rain = plan_store.resolve_day(self.month, date, 'rain')
            work = lambda d: [(s['minutes'], s['target_w']) for s in d['segments'] if s['role'] == 'work']
            self.assertEqual(work(outdoor), work(rain))
            self.assertLess(sum(s['minutes'] for s in rain['segments']), sum(s['minutes'] for s in outdoor['segments']))
        self.assertEqual(self.month['days']['2026-10-13']['selected_variant'], 'outdoor')

    def test_double_test_and_invalid_variant_rejected(self):
        self.month['days']['2026-10-29']['selected_variant'] = 'reserve_test'
        with self.assertRaises(ValueError):
            cycle.validate(self.month)
        self.month['days']['2026-10-27']['selected_variant'] = 'rain'
        self.assertTrue(cycle.validate(self.month))
        with self.assertRaises(ValueError):
            plan_store.resolve_day(self.month, '2026-10-06', 'typo')

    def test_low_tss_plan_day_report_and_no_running_override(self):
        args = type('Args', (), {'force': False, 'min_tss': 100})()
        summary = {'meta': {'sport': 'Cycling'}, 'power': {'has_power': True, 'tss': 30}}
        self.assertTrue(reports.qualifies(summary, '2026-10-08', args, set())[0])
        self.assertFalse(reports.qualifies(summary, '2026-10-02', args, set())[0])
        summary['meta']['sport'] = 'Running'
        self.assertFalse(reports.qualifies(summary, '2026-10-08', args, set())[0])

    def test_all_rain_zwo_are_free_ride_and_match_durations(self):
        files = list((ROOT / 'athlete/workouts/2026-10-rain').glob('*.zwo'))
        self.assertEqual(len(files), 9)
        for file in files:
            workout = ET.parse(file).getroot().find('workout')
            self.assertTrue(all(node.tag == 'FreeRide' for node in workout))
            day = plan_store.resolve_day(self.month, file.name[:10], 'rain')
            self.assertEqual(sum(int(node.attrib['Duration']) for node in workout),
                             sum(s['minutes'] * 60 for s in day['segments']))

    def test_projection_preserves_actual_and_selected_rain(self):
        before = {'sessions': [{'date': '2026-10-06', 'actual': {'note': 'user feedback', 'tss': 60}}]}
        self.month['days']['2026-10-06']['selected_variant'] = 'rain'
        block = cycle.block_view(self.month, before)
        session = next(s for s in block['sessions'] if s['date'] == '2026-10-06')
        self.assertEqual(session['actual'], before['sessions'][0]['actual'])
        self.assertEqual(session['minutes'], 75)

    def test_activation_archives_legacy_and_does_not_activate_early(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'data/plans').mkdir(parents=True)
            source = root / 'data/plans/2026-10.json'
            source.write_text(json.dumps(self.month))
            active = root / 'data/training-block.json'
            old = {'id': 'legacy-september', 'sessions': [{'date': '2026-09-03', 'actual': {'tss': 95}}]}
            active.write_text(json.dumps(old))
            with patch.object(cycle, 'ROOT', root), patch.object(plan_store, 'MONTHS', source.parent):
                cycle.sync('2026-09-28')
                self.assertEqual(json.loads(active.read_text()), old)
                cycle.sync('2026-10-01')
                self.assertEqual(json.loads(active.read_text())['id'], 'zhongshe-2026-10')
                archive = root / 'data/training-history/legacy-september.json'
                self.assertEqual(json.loads(archive.read_text()), old)
                current = json.loads(active.read_text())
                current['sessions'][0]['actual'] = {'note': 'keep me'}
                active.write_text(json.dumps(current))
                cycle.sync('2026-10-02')
                self.assertEqual(json.loads(active.read_text())['sessions'][0]['actual'], {'note': 'keep me'})


if __name__ == '__main__':
    unittest.main()
