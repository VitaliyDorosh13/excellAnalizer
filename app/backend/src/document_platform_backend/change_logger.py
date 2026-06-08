from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from .models import ChangeLogRecord


def append_change_log(log_path: Path, changes: Iterable[ChangeLogRecord]) -> int:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    written_count = 0

    with log_path.open("a", encoding="utf-8") as log_file:
        for change in changes:
            log_file.write(json.dumps(change.model_dump(by_alias=True, mode="json"), ensure_ascii=True))
            log_file.write("\n")
            written_count += 1

    return written_count
