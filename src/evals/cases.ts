/**
 * Reference cases for the eval suite.
 *
 * A case is a named window over your real session logs. Because the logs are
 * append-only and the window is fixed by timestamp, a case is reproducible:
 * the same case run today and next month reads the same exchanges.
 *
 * Add a case whenever you build something deliberately as a test fixture — a
 * throwaway app where you know the ground truth beats a work window where you
 * are reconstructing it from memory.
 */

export interface EvalCase {
  /** Stable slug. Used for output directories, so keep it filesystem-safe. */
  id: string
  /** What this case is for, in one line. Appears in the report. */
  description: string
  /** ISO 8601 window start */
  start: string
  /** ISO 8601 window end */
  end: string
  /**
   * Extra CLI flags, e.g. ['--session-headers'].
   * The runner always supplies --start, --end and --output.
   */
  flags?: string[]
  /**
   * Path to an ALREADY-GENERATED run for this case — a directory containing
   * decisions.json and render.json. Set this and `--checks-only` evaluates it
   * without spending an API call, which is how you grade the example runs you
   * already have sitting in the repo.
   *
   * Relative paths resolve from the repo root.
   */
  artifactDir?: string
  /**
   * Ground truth, where you know it. Free-form notes for the human or LLM
   * reviewing the artifact — the runner does not check these mechanically.
   */
  groundTruth?: string[]
  /**
   * Recall check: this case's window contains the windows of the listed cases,
   * so every finding they produce should also appear here. The runner matches
   * on evidence quotes rather than ids, since slugs churn between runs.
   *
   * This is the phase 1 recall measurement — a wide window that loses findings
   * its own sub-windows found is compressing, and nothing downstream can
   * recover them.
   */
  shouldContainFindingsFrom?: string[]
}

export const CASES: EvalCase[] = [
  {
    id: 'timer-part1',
    description:
      'Timer app built from a two-sentence brief. Near-total delegation: ~60 words of engineer input.',
    
    
    // @note I thought this is what the report used
    // start: '2026-09-05T04:51:06.036Z',
    // end: '2026-09-05T04:57:42.036Z',
    // but claude insists this and that I didn't go back early enough when generating
    // the initial report.
    start: '2026-09-05T04:45:00.000Z',
    end: '2026-09-05T04:55:00.000Z',

    artifactDir: 'src/v6/examples-clean/react-timer-part1',
    groundTruth: [
      'Engineer wrote two short prompts and answered one clarifying question.',
      'Every implementation decision was made by Claude with no engineer engagement.',
      'Engineer stated two constraints: "follow best practices" and "I def want it to be TS".',
      'Expected: driver almost entirely claude, engagement almost entirely none.',
      'Known miss: extraction of useTimer into a hook and playAlarm into a utility are',
      'module-boundary decisions that appear only in the shape of the Write calls.',
    ],
  },
  // {
  //   id: 'timer-part2',
  //   description:
  //     'Engineer-requested refactor to useReducer state machine, plus test suite. One directed decision.',
  //   // TODO: replace with the real part 2 window
  //   start: '2026-09-05T05:00:00.000Z',
  //   end: '2026-09-05T05:30:00.000Z',
  //   groundTruth: [
  //     'Engineer asked for the refactor, so at least one decision should be driver: engineer.',
  //     'Expected: an engagement gradient rather than uniform none.',
  //     'Expected finding: the hook public API was unchanged across the refactor.',
  //   ],
  // },
  // {
  //   id: 'timer-combined',
  //   description:
  //     'Both timer tasks in one window. Tests whether phase 1 compresses a multi-task window.',
  //   start: '2026-09-05T04:45:00.000Z',
  //   end: '2026-09-05T05:30:00.000Z',
  //   shouldContainFindingsFrom: ['timer-part1', 'timer-part2'],
  //   groundTruth: [
  //     'Should be a superset of the two narrow cases. Measured at ~64% recall before',
  //     'the volume prompt change; the first task in the window is compressed hardest.',
  //   ],
  // },
]
