#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "scikit-learn>=1.4",
#   "pandas>=2.0",
# ]
# ///
"""Materialize the input artifact `sklearn_pipeline` expects.

The example takes an external table, not a call to a bundled sample-data
loader — that is the point of it: the same diagram runs on a real study dataset
by changing one `uri`. So the data has to come from somewhere before the run,
and this is that step, kept deliberately outside the diagram.

The table is scikit-learn's copy of the UCI hand-written digits set (1797
samples, 8x8 pixels, ten classes): 64 numeric feature columns and a `target`
column, exactly the shape the diagram's input element declares.

    uv run make_inputs.py            # writes inputs/digits.csv
"""

from __future__ import annotations

import argparse
from pathlib import Path

from sklearn.datasets import load_digits


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=Path("inputs/digits.csv"))
    args = parser.parse_args()

    frame = load_digits(as_frame=True).frame
    args.out.parent.mkdir(parents=True, exist_ok=True)
    # Row numbers are not data: the 64 pixel columns and `target` are.
    frame.to_csv(args.out, index=False)

    print(f"{args.out}: {len(frame)} rows x {len(frame.columns)} columns")
    print(f"  target column: {'target' in frame.columns}")
    print(f"  classes: {sorted(frame['target'].unique())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
