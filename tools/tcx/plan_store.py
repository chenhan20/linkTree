"""Date-keyed monthly prescriptions, with legacy plan compatibility."""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PLAN = ROOT / 'data/plan.json'
MONTHS = ROOT / 'data/plans'


def monthly_files():
    return sorted(MONTHS.glob('????-??.json'))


def load_plan(path=None):
    if path is not None:
        file = Path(path).resolve()
        plan = json.loads(file.read_text(encoding='utf-8'))
        if file != DEFAULT_PLAN:
            source = str(file.relative_to(ROOT)) if file.is_relative_to(ROOT) else str(file)
            for day in plan.get('days', {}).values():
                day['_plan_source'] = source
        return plan
    plan = json.loads(DEFAULT_PLAN.read_text(encoding='utf-8'))
    for file in monthly_files():
        month = json.loads(file.read_text(encoding='utf-8'))
        for date, value in month.get('days', {}).items():
            if date in plan['days']:
                raise ValueError(f'Duplicate prescription: {date} in {file}')
            day = copy.deepcopy(value)
            day['_baseline'] = copy.deepcopy(month['baseline'])
            day['_plan_source'] = str(file.relative_to(ROOT))
            plan['days'][date] = day
        plan.setdefault('blocks', []).extend(month.get('blocks', []))
    return plan


def resolve_day(plan, date, variant=None):
    day = copy.deepcopy(plan.get('days', {}).get(date))
    if day is None:
        return None
    selected = variant or day.get('selected_variant', 'outdoor')
    variants = day.get('variants', {})
    if variants:
        if selected not in variants:
            raise ValueError(f'{date}: unknown variant {selected}')
        day.update(copy.deepcopy(variants[selected]))
        day['selected_variant'] = selected
    elif variant is not None:
        raise ValueError(f'{date}: this legacy day has no variants')
    return day


def baseline_for(plan, day):
    # A monthly FTP is isolated from historical prescriptions.
    return copy.deepcopy(day.get('_baseline') or plan.get('baseline') or {})
