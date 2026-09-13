"""One check for stamping a record onto an element; run it with `python3 skills/prov/test_prov.py`."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import prov  # noqa: E402

# A data object with only a `uri` is written self-closing; it is opened to take its record, not skipped.
bare = '<bpmn:process id="S">\n  <bpmn:dataObjectReference id="counts" studyflow:uri="counts.json" />\n</bpmn:process>'
assert prov.insert_extension(bare, "counts", '<prov:activity action="imported" />') == """<bpmn:process id="S">
  <bpmn:dataObjectReference id="counts" studyflow:uri="counts.json">
    <bpmn:extensionElements>
      <prov:activity action="imported" />
    </bpmn:extensionElements>
  </bpmn:dataObjectReference>
</bpmn:process>"""
