# UI Invariants (Scan Loop)

The scan loop must fit 360×640 without scrolling; only a successful scan result disappears on its own, the other three scan states wait for the operator; undo subtracts the last scanned qty from the line (`addOrIncrementLine` merges repeated scans, so `removeLine` would delete too much); progress bars are `SegmentedProgress` — the old `Progress` component is gone from `src/ui/primitives.tsx` and from its tests.
