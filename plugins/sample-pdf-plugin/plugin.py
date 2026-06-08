from __future__ import annotations


class SamplePdfPlugin:
    plugin_id = "com.alstom.sample-pdf-plugin"

    def register(self) -> dict:
        return {
            "plugin_id": self.plugin_id,
            "capabilities": ["parser", "transform"],
            "supported_formats": [".pdf"],
            "status": "registered"
        }
