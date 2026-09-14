from labels.hygiene import parse_failures, verdict


def test_parse_failures_reads_the_list_shaped_validation_result():
    report = {"report": {"jobs": [{"validationResult": [{"details": {"ruleSummaries": [
        {"clause": "7.1", "testNumber": 3, "status": "failed", "failedChecks": 12},
        {"clause": "7.18.1", "testNumber": 2, "status": "failed", "failedChecks": 37},
        {"clause": "7.4.2", "testNumber": 1, "status": "passed", "failedChecks": 0},
    ]}}]}]}}
    assert parse_failures(report) == {"7.1-3", "7.18.1-2"}


def test_parse_failures_flags_a_job_with_a_task_exception_and_no_validation_result():
    report = {"report": {"jobs": [{"taskException": {"message": "boom"}}]}}
    assert parse_failures(report) == {"checker-failed"}


def test_parse_failures_flags_a_report_with_no_jobs():
    report = {"report": {"jobs": []}}
    assert parse_failures(report) == {"checker-failed"}


def test_verdict_reasons():
    assert verdict(set(), 0.1, 40) == (True, [])
    assert verdict({"7.1-3"}, 0.0, 40) == (False, ["untagged-content (7.1-3)"])
    assert verdict({"7.4.2-1", "7.4.4-2"}, None, 40)[1] == ["level-skip (7.4.2)", "mixed-structure (7.4.4)"]
    assert verdict({"7.18.1-2"}, 0.31, 40) == (False, ["prose-headings (>=0.30)"])
    assert verdict(set(), None, 0) == (False, ["no-blocks"])
    assert verdict({"checker-failed"}, None, 40) == (False, ["checker-failed"])
