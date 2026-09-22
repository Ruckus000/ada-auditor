"""Strategy A wild-look abstention (labels.abstain_probe)."""
import json
import tempfile
from pathlib import Path

from labels.abstain_probe import apply_abstention, firing


_TMPS = []


def _jsonl(rows, name="probe.jsonl"):
    d = tempfile.TemporaryDirectory()
    _TMPS.append(d)
    p = Path(d.name) / name
    with open(p, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    return p


def test_firing_maps_above_tau_model_decided():
    p = _jsonl([
        {"id": "a:1mh", "p_H": 0.9},
        {"id": "a:2mh", "p_H": 0.1},          # below tau
        {"id": "a:3mh", "p_H": None},          # rule-decided: never fires
    ])
    assert firing(p, 0.5) == {"a:1": 0.9}


def test_firing_refuses_non_probe_id():
    p = _jsonl([{"id": "a:1", "p_H": 0.9}])
    try:
        firing(p, 0.5)
        assert False, "expected SystemExit"
    except SystemExit:
        pass


def test_apply_abstains_firing_rows_only():
    with tempfile.TemporaryDirectory() as d:
        preds = Path(d) / "preds.jsonl"
        with open(preds, "w") as f:
            f.write(json.dumps({"id": "a:1", "score": 0.7, "rule": None}) + "\n")
            f.write(json.dumps({"id": "a:2", "score": 0.8, "rule": None}) + "\n")
        probe = _jsonl([
            {"id": "a:1mh", "p_H": 0.9},
            {"id": "a:2mh", "p_H": 0.1},
        ])
        out = Path(d) / "out.jsonl"
        apply_abstention(preds, probe, 0.5, out)
        rows = [json.loads(line) for line in open(out)]
        assert rows[0]["score"] is None
        assert rows[0]["abstained"] == "merged-probe"
        assert rows[0]["probe_p_H"] == 0.9
        assert rows[0]["rule"] is None
        assert rows[1] == {"id": "a:2", "score": 0.8, "rule": None}
        try:
            apply_abstention(preds, probe, 0.5, out)
            assert False, "expected SystemExit"
        except SystemExit:
            pass
