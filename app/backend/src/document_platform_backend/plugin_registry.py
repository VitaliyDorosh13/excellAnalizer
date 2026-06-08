from __future__ import annotations

import json
from json import JSONDecodeError
from pathlib import Path

from .models import PluginListResponse, PluginLoadIssue, PluginSummary


REQUIRED_MANIFEST_FIELDS = ("id", "name", "version", "apiVersion", "capabilities", "entryPoint")


def discover_plugins(plugin_root: Path) -> PluginListResponse:
    plugins: list[PluginSummary] = []
    issues: list[PluginLoadIssue] = []

    if not plugin_root.exists():
        return PluginListResponse(
            plugin_root=str(plugin_root),
            issues=[
                PluginLoadIssue(
                    manifest_path=str(plugin_root),
                    severity="warning",
                    message="Plugin root directory does not exist.",
                )
            ],
        )

    for manifest_path in sorted(plugin_root.glob("*/manifest.json")):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, JSONDecodeError) as exc:
            issues.append(
                PluginLoadIssue(
                    manifest_path=str(manifest_path),
                    severity="error",
                    message=f"Unable to read plugin manifest: {exc}",
                )
            )
            continue

        if not isinstance(manifest, dict):
            issues.append(
                PluginLoadIssue(
                    manifest_path=str(manifest_path),
                    severity="error",
                    message="Plugin manifest root must be a JSON object.",
                )
            )
            continue

        plugin_id = str(manifest.get("id") or manifest_path.parent.name)
        missing_fields = [field for field in REQUIRED_MANIFEST_FIELDS if field not in manifest]
        if missing_fields:
            issues.append(
                PluginLoadIssue(
                    plugin_id=plugin_id,
                    manifest_path=str(manifest_path),
                    severity="error",
                    message=f"Plugin manifest is missing required fields: {', '.join(missing_fields)}.",
                )
            )
            continue

        entry_point = str(manifest["entryPoint"])
        entry_path = manifest_path.parent / entry_point
        if not entry_path.exists():
            issues.append(
                PluginLoadIssue(
                    plugin_id=plugin_id,
                    manifest_path=str(manifest_path),
                    severity="warning",
                    message=f"Plugin entry point does not exist: {entry_point}.",
                )
            )

        plugins.append(
            PluginSummary(
                plugin_id=plugin_id,
                name=str(manifest["name"]),
                version=str(manifest["version"]),
                api_version=str(manifest["apiVersion"]),
                enabled=manifest.get("enabled", True),
                capabilities=_string_list(manifest.get("capabilities")),
                permissions=_string_list(manifest.get("permissions")),
                supported_formats=_string_list(manifest.get("supportedFormats")),
                entry_point=entry_point,
                manifest_path=str(manifest_path),
            )
        )

    return PluginListResponse(plugin_root=str(plugin_root), items=plugins, issues=issues)


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []

    return [str(item) for item in value]
