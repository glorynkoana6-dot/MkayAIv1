import {
  finite,
  round,
  mean,
  ensembleScore,
  evaluatePath
} from "./core.js";


import {
  dbEnabled,
  loadResolvedStates,
  memoryCount
} from "./db.js";


/* =========================================================
   MKAYFX WALK-FORWARD RESEARCH V13

   PURPOSE
   -------
   - XAU/USD + BTC/USD
   - chronological train / validation / test
   - threshold sweep
   - regime-aware BTC filtering
   - trading-cost adjustment
   - BUY / SELL statistics
   - regime statistics
   - session statistics
   - sample-size protection
   - drawdown-aware selection
   - profit-factor-aware selection
   - untouched final holdout

   IMPORTANT
   ---------
   This is a research engine.

   It does NOT guarantee that a configuration that worked
   historically will work in the future.
========================================================= */


/* =========================================================
   SETTINGS
========================================================= */

const THRESHOLDS = [
  20,
  25,
  30,
  35,
  40,
  45,
  50,
  55,
  60,
  65,
  70,
  75,
  80
];


const STOP_ATR =
  1;


const TARGET_R =
  1.2;


/*
  Approximate cost expressed in ATR.

  This mirrors the cost assumption used by analysis.js.
*/

const ESTIMATED_COST_ATR =
  0.03;


const ESTIMATED_COST_R =
  ESTIMATED_COST_ATR /
  STOP_ATR;


/*
  Minimum number of trades needed before we place much
  confidence in a candidate.
*/

const MIN_TRAIN_TRADES =
  25;


const MIN_VALIDATION_TRADES =
  10;


/*
  Extremely large historical drawdown should reduce
  candidate quality even when expectancy is positive.
*/

const MAX_REASONABLE_DD_R =
  20;


/* =========================================================
   SYMBOL
========================================================= */

function normalizeSymbol(
  value
) {

  const raw =
    String(
      value ||
      "XAU/USD"
    )
      .trim()
      .toUpperCase()
      .replace(
        /\s+/g,
        ""
      );


  if (
    raw ===
      "XAU/USD" ||
    raw ===
      "XAUUSD" ||
    raw ===
      "GOLD"
  ) {

    return "XAU/USD";

  }


  if (
    raw ===
      "BTC/USD" ||
    raw ===
      "BTCUSD" ||
    raw ===
      "BTC" ||
    raw ===
      "BITCOIN"
  ) {

    return "BTC/USD";

  }


  return null;
}


function rowSymbol(
  row
) {

  return normalizeSymbol(
    row?.symbol ||
    row?.market_symbol ||
    row?.features?.symbol ||
    null
  );

}


function queryValue(
  req,
  key
) {

  const value =
    req.query?.[key];


  return Array.isArray(
    value
  )
    ? value[0]
    : value;
}


/* =========================================================
   SAFE HELPERS
========================================================= */

function safeNumber(
  value,
  fallback = 0
) {

  const n =
    finite(
      value
    );


  return n ===
    null
      ? fallback
      : n;
}


function safeDate(
  value
) {

  const time =
    Date.parse(
      value
    );


  return Number.isFinite(
    time
  )
    ? time
    : 0;
}


/* =========================================================
   BTC REGIME POLICY

   IMPORTANT:
   These rules are deliberately simple.

   We are NOT hard-coding the exact historical expectancy
   numbers from one test.

   Instead we use the research result to determine which
   market environments require stronger evidence.
========================================================= */

function regimeAllowed(
  symbol,
  regime,
  score
) {

  const strength =
    Math.abs(
      score
    );


  if (
    symbol !==
    "BTC/USD"
  ) {

    /*
      Gold:
      remove obvious quiet chop from research candidates.
    */

    if (
      regime ===
      "QUIET_CHOP"
    ) {

      return false;

    }


    return true;

  }


  /*
    BTC QUIET CHOP

    Completely excluded.
  */

  if (
    regime ===
    "QUIET_CHOP"
  ) {

    return false;

  }


  /*
    BTC RANGE

    Only exceptionally strong raw signals survive.
  */

  if (
    regime ===
    "RANGE"
  ) {

    return strength >=
      70;

  }


  /*
    BTC expansion regimes are volatile.

    Require stronger signal strength.
  */

  if (
    String(
      regime
    ).includes(
      "EXPANSION"
    )
  ) {

    return strength >=
      60;

  }


  /*
    BTC trends.
  */

  if (
    String(
      regime
    ).includes(
      "TREND"
    )
  ) {

    return strength >=
      45;

  }


  /*
    MIXED stays available because this environment
    has shown useful behaviour in the current research,
    but we still rely on the selected threshold.
  */

  return true;
}


/* =========================================================
   DIRECTION / REGIME ALIGNMENT
========================================================= */

function directionAllowed(
  symbol,
  regime,
  direction
) {

  const raw =
    String(
      regime ||
      ""
    ).toUpperCase();


  /*
    For Gold we leave both directions available.
  */

  if (
    symbol !==
    "BTC/USD"
  ) {

    return true;

  }


  /*
    For strong directional BTC regimes, do not take
    the opposite side.

    MIXED and RANGE can still use either direction.
  */

  if (
    raw.startsWith(
      "BULLISH"
    )
  ) {

    return direction ===
      "BUY";

  }


  if (
    raw.startsWith(
      "BEARISH"
    )
  ) {

    return direction ===
      "SELL";

  }


  return true;
}


/* =========================================================
   METRICS
========================================================= */

function metrics(
  trades
) {

  if (
    !trades.length
  ) {

    return {

      trades:
        0,

      wins:
        0,

      losses:
        0,

      breakeven:
        0,

      winRate:
        null,

      expectancyR:
        null,

      grossExpectancyR:
        null,

      profitFactor:
        null,

      totalR:
        0,

      grossTotalR:
        0,

      maxDrawdownR:
        0,

      averageWinR:
        null,

      averageLossR:
        null,

      payoffRatio:
        null,

      recoveryFactor:
        null,

      longestWinStreak:
        0,

      longestLossStreak:
        0

    };

  }


  const wins =
    trades.filter(
      x =>
        x.r >
        0
    );


  const losses =
    trades.filter(
      x =>
        x.r <
        0
    );


  const breakeven =
    trades.filter(
      x =>
        x.r ===
        0
    );


  const grossWin =
    wins.reduce(
      (
        sum,
        x
      ) =>
        sum +
        x.r,
      0
    );


  const grossLoss =
    Math.abs(
      losses.reduce(
        (
          sum,
          x
        ) =>
          sum +
          x.r,
        0
      )
    );


  const grossTotalR =
    trades.reduce(
      (
        sum,
        x
      ) =>
        sum +
        safeNumber(
          x.grossR
        ),
      0
    );


  let equity =
    0;


  let peak =
    0;


  let drawdown =
    0;


  let winStreak =
    0;


  let lossStreak =
    0;


  let longestWinStreak =
    0;


  let longestLossStreak =
    0;


  for (
    const trade of
    trades
  ) {

    equity +=
      trade.r;


    peak =
      Math.max(
        peak,
        equity
      );


    drawdown =
      Math.max(
        drawdown,
        peak -
        equity
      );


    if (
      trade.r >
      0
    ) {

      winStreak +=
        1;


      lossStreak =
        0;


      longestWinStreak =
        Math.max(
          longestWinStreak,
          winStreak
        );

    }
    else if (
      trade.r <
      0
    ) {

      lossStreak +=
        1;


      winStreak =
        0;


      longestLossStreak =
        Math.max(
          longestLossStreak,
          lossStreak
        );

    }
    else {

      winStreak =
        0;


      lossStreak =
        0;

    }

  }


  const averageWin =
    wins.length
      ? mean(
          wins.map(
            x =>
              x.r
          )
        )
      : null;


  const averageLoss =
    losses.length
      ? Math.abs(
          mean(
            losses.map(
              x =>
                x.r
            )
          )
        )
      : null;


  const payoffRatio =
    averageWin !==
      null &&
    averageLoss !==
      null &&
    averageLoss >
      0

      ? averageWin /
        averageLoss

      : null;


  const profitFactor =
    grossLoss >
      0

      ? grossWin /
        grossLoss

      : grossWin >
        0
        ? null
        : 0;


  const recoveryFactor =
    drawdown >
      0

      ? equity /
        drawdown

      : equity >
        0
        ? null
        : 0;


  return {

    trades:
      trades.length,

    wins:
      wins.length,

    losses:
      losses.length,

    breakeven:
      breakeven.length,

    winRate:
      round(
        wins.length /
        trades.length *
        100,
        1
      ),

    expectancyR:
      round(
        mean(
          trades.map(
            x =>
              x.r
          )
        ),
        3
      ),

    grossExpectancyR:
      round(
        mean(
          trades.map(
            x =>
              safeNumber(
                x.grossR
              )
          )
        ),
        3
      ),

    profitFactor:
      profitFactor ===
        null
        ? null
        : round(
            profitFactor,
            2
          ),

    totalR:
      round(
        equity,
        2
      ),

    grossTotalR:
      round(
        grossTotalR,
        2
      ),

    maxDrawdownR:
      round(
        drawdown,
        2
      ),

    averageWinR:
      averageWin ===
        null
        ? null
        : round(
            averageWin,
            3
          ),

    averageLossR:
      averageLoss ===
        null
        ? null
        : round(
            averageLoss,
            3
          ),

    payoffRatio:
      payoffRatio ===
        null
        ? null
        : round(
            payoffRatio,
            2
          ),

    recoveryFactor:
      recoveryFactor ===
        null
        ? null
        : round(
            recoveryFactor,
            2
          ),

    longestWinStreak,

    longestLossStreak

  };
}


/* =========================================================
   SIMULATION
========================================================= */

function simulate(
  rows,
  threshold,
  symbol
) {

  const trades =
    [];


  for (
    const row of
    rows
  ) {

    const components =
      row.features
        ?.componentScores ||
      {};


    if (
      !Object.keys(
        components
      ).length
    ) {

      continue;

    }


    if (
      !Array.isArray(
        row.future_path
      ) ||
      !row.future_path.length
    ) {

      continue;

    }


    const regime =
      row.regime ||
      "UNKNOWN";


    const score =
      ensembleScore(
        components,
        regime,
        {}
      );


    if (
      !Number.isFinite(
        score
      )
    ) {

      continue;

    }


    const strength =
      Math.abs(
        score
      );


    /*
      Main threshold.
    */

    if (
      strength <
      threshold
    ) {

      continue;

    }


    /*
      Regime filter.
    */

    if (
      !regimeAllowed(
        symbol,
        regime,
        score
      )
    ) {

      continue;

    }


    const direction =
      score >=
        0
        ? "BUY"
        : "SELL";


    /*
      BTC directional regime alignment.
    */

    if (
      !directionAllowed(
        symbol,
        regime,
        direction
      )
    ) {

      continue;

    }


    const outcome =
      evaluatePath(
        row.future_path,
        direction,
        STOP_ATR,
        TARGET_R
      );


    if (
      !outcome
    ) {

      continue;

    }


    const grossR =
      safeNumber(
        outcome.resultR
      );


    /*
      Cost applied to every executed trade.
    */

    const netR =
      grossR -
      ESTIMATED_COST_R;


    trades.push({

      symbol,

      time:
        row.candle_time,

      grossR:
        round(
          grossR,
          4
        ),

      costR:
        round(
          ESTIMATED_COST_R,
          4
        ),

      r:
        round(
          netR,
          4
        ),

      direction,

      score:
        round(
          score,
          2
        ),

      strength:
        round(
          strength,
          2
        ),

      regime,

      session:
        row.session ||
        "UNKNOWN"

    });

  }


  /*
    Always preserve chronological order for DD/streak stats.
  */

  return trades.sort(
    (
      a,
      b
    ) =>
      safeDate(
        a.time
      ) -
      safeDate(
        b.time
      )
  );
}


/* =========================================================
   GROUPED METRICS
========================================================= */

function groupedMetrics(
  trades,
  key
) {

  const out =
    {};


  const names =
    [
      ...new Set(
        trades
          .map(
            x =>
              x[key]
          )
          .filter(
            Boolean
          )
      )
    ];


  for (
    const name of
    names
  ) {

    out[name] =
      metrics(
        trades.filter(
          x =>
            x[key] ===
            name
        )
      );

  }


  return out;
}


/* =========================================================
   CANDIDATE QUALITY
========================================================= */

function candidateQuality(
  result,
  phase
) {

  const m =
    result.metrics;


  if (
    !m ||
    !m.trades
  ) {

    return -9999;

  }


  const expectancy =
    safeNumber(
      m.expectancyR,
      -1
    );


  const pf =
    m.profitFactor ===
      null
      ? 3
      : safeNumber(
          m.profitFactor
        );


  const dd =
    safeNumber(
      m.maxDrawdownR
    );


  const total =
    safeNumber(
      m.totalR
    );


  /*
    Sample confidence saturates.

    50+ trades = full sample credit.
  */

  const sampleQuality =
    Math.min(
      m.trades /
        50,
      1
    );


  /*
    Penalize candidates with very small samples.
  */

  let samplePenalty =
    0;


  if (
    phase ===
      "TRAIN" &&
    m.trades <
      MIN_TRAIN_TRADES
  ) {

    samplePenalty +=
      (
        MIN_TRAIN_TRADES -
        m.trades
      ) *
      0.15;

  }


  if (
    phase ===
      "VALIDATION" &&
    m.trades <
      MIN_VALIDATION_TRADES
  ) {

    samplePenalty +=
      (
        MIN_VALIDATION_TRADES -
        m.trades
      ) *
      0.25;

  }


  /*
    Extra penalty once DD becomes excessive.
  */

  const excessDrawdown =
    Math.max(
      0,
      dd -
      MAX_REASONABLE_DD_R
    );


  return (

    expectancy *
      10 +

    Math.min(
      pf,
      3
    ) *
      1.5 +

    sampleQuality *
      2 +

    Math.max(
      Math.min(
        total,
        20
      ),
      -20
    ) *
      0.08 -

    dd *
      0.10 -

    excessDrawdown *
      0.20 -

    samplePenalty

  );
}


/* =========================================================
   THRESHOLD SWEEP
========================================================= */

function evaluateThresholds(
  rows,
  symbol,
  phase
) {

  return THRESHOLDS.map(
    threshold => {

      const trades =
        simulate(
          rows,
          threshold,
          symbol
        );


      const result = {

        threshold,

        metrics:
          metrics(
            trades
          )

      };


      result.qualityScore =
        round(
          candidateQuality(
            result,
            phase
          ),
          3
        );


      return result;

    }
  );

}


/* =========================================================
   CHOOSE TRAINING CANDIDATES
========================================================= */

function chooseTrainingCandidates(
  candidates
) {

  const viable =
    candidates.filter(
      x =>
        x.metrics.trades >=
          MIN_TRAIN_TRADES &&
        safeNumber(
          x.metrics
            .expectancyR,
          -999
        ) >
          0 &&
        (
          x.metrics
            .profitFactor ===
            null ||
          safeNumber(
            x.metrics
              .profitFactor
          ) >
            1
        )
    );


  /*
    If nothing is profitable in training, do NOT pretend
    that a positive edge exists.

    We still return candidates for diagnostics, but the
    caller can mark the research as no viable edge.
  */

  const pool =
    viable.length
      ? viable
      : candidates;


  return [...pool]
    .sort(
      (
        a,
        b
      ) =>
        b.qualityScore -
        a.qualityScore
    );
}


/* =========================================================
   VALIDATE TRAINING SHORTLIST
========================================================= */

function validateCandidates(
  trainingRanked,
  validationRows,
  symbol
) {

  /*
    Only validate the strongest few training thresholds.

    This reduces repeatedly searching the validation set.
  */

  const shortlist =
    trainingRanked.slice(
      0,
      4
    );


  return shortlist.map(
    trainingCandidate => {

      const trades =
        simulate(
          validationRows,
          trainingCandidate.threshold,
          symbol
        );


      const validationMetrics =
        metrics(
          trades
        );


      const validationResult = {

        threshold:
          trainingCandidate.threshold,

        metrics:
          validationMetrics

      };


      const validationQuality =
        candidateQuality(
          validationResult,
          "VALIDATION"
        );


      /*
        Training matters, but validation receives
        greater weight.
      */

      const combinedScore =
        trainingCandidate
          .qualityScore *
          0.35 +
        validationQuality *
          0.65;


      return {

        threshold:
          trainingCandidate.threshold,

        training:
          trainingCandidate.metrics,

        trainingQuality:
          trainingCandidate
            .qualityScore,

        validation:
          validationMetrics,

        validationQuality:
          round(
            validationQuality,
            3
          ),

        combinedScore:
          round(
            combinedScore,
            3
          )

      };

    }
  )
    .sort(
      (
        a,
        b
      ) =>
        b.combinedScore -
        a.combinedScore
    );
}


/* =========================================================
   ROBUSTNESS CHECK
========================================================= */

function robustness(
  selectedThreshold,
  trainingCandidates,
  validationRows,
  symbol
) {

  const nearby =
    THRESHOLDS.filter(
      x =>
        Math.abs(
          x -
          selectedThreshold
        ) <=
        10
    );


  const results =
    nearby.map(
      threshold => {

        const training =
          trainingCandidates.find(
            x =>
              x.threshold ===
              threshold
          );


        const validationTrades =
          simulate(
            validationRows,
            threshold,
            symbol
          );


        return {

          threshold,

          training:
            training
              ?.metrics ??
            null,

          validation:
            metrics(
              validationTrades
            )

        };

      }
    );


  const positiveValidation =
    results.filter(
      x =>
        safeNumber(
          x.validation
            ?.expectancyR,
          -999
        ) >
          0
    ).length;


  return {

    nearbyThresholds:
      results,

    positiveValidationThresholds:
      positiveValidation,

    testedThresholds:
      results.length,

    stable:
      results.length >
        0 &&
      positiveValidation >=
        Math.ceil(
          results.length /
          2
        )

  };
}


/* =========================================================
   MAIN
========================================================= */

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store"
  );


  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );


  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );


  if (
    req.method ===
    "OPTIONS"
  ) {

    return res
      .status(204)
      .end();

  }


  if (
    req.method !==
    "GET"
  ) {

    return res
      .status(405)
      .json({

        success:
          false,

        error:
          "Use GET."

      });

  }


  const symbol =
    normalizeSymbol(
      queryValue(
        req,
        "symbol"
      ) ||
      "XAU/USD"
    );


  if (
    !symbol
  ) {

    return res
      .status(400)
      .json({

        success:
          false,

        error:
          "Unsupported symbol.",

        supportedSymbols: [
          "XAU/USD",
          "BTC/USD"
        ]

      });

  }


  if (
    !dbEnabled()
  ) {

    return res
      .status(200)
      .json({

        success:
          true,

        symbol,

        available:
          false,

        error:
          "DATABASE_URL is not configured."

      });

  }


  try {

    /* =====================================================
       LOAD ONLY THE REQUESTED ASSET
    ===================================================== */

    let rows =
      await loadResolvedStates({

        symbol,

        limit:
          5000

      });


    rows =
      rows
        .filter(
          row =>
            rowSymbol(
              row
            ) ===
            symbol
        )
        .filter(
          row =>
            Array.isArray(
              row.future_path
            ) &&
            row.future_path.length
        )
        .sort(
          (
            a,
            b
          ) =>
            safeDate(
              a.candle_time
            ) -
            safeDate(
              b.candle_time
            )
        );


    const count =
      await memoryCount(
        symbol
      );


    /* =====================================================
       MINIMUM MEMORY
    ===================================================== */

    if (
      rows.length <
      150
    ) {

      return res
        .status(200)
        .json({

          success:
            true,

          symbol,

          available:
            false,

          memory:
            count,

          resolvedStates:
            rows.length,

          requiredStates:
            150,

          error:
            `Need at least 150 resolved ${symbol} market states. Backfill ${symbol} memory first.`

        });

    }


    /* =====================================================
       CHRONOLOGICAL 60 / 20 / 20 SPLIT

       TRAIN:
       discover reasonable thresholds.

       VALIDATION:
       choose between training candidates.

       TEST:
       untouched final holdout.
    ===================================================== */

    const trainEnd =
      Math.floor(
        rows.length *
        0.60
      );


    const validationEnd =
      Math.floor(
        rows.length *
        0.80
      );


    const trainingRows =
      rows.slice(
        0,
        trainEnd
      );


    const validationRows =
      rows.slice(
        trainEnd,
        validationEnd
      );


    const testRows =
      rows.slice(
        validationEnd
      );


    /* =====================================================
       TRAINING SWEEP
    ===================================================== */

    const trainingCandidates =
      evaluateThresholds(
        trainingRows,
        symbol,
        "TRAIN"
      );


    const rankedTraining =
      chooseTrainingCandidates(
        trainingCandidates
      );


    const profitableTrainingCandidates =
      trainingCandidates.filter(
        x =>
          x.metrics.trades >=
            MIN_TRAIN_TRADES &&
          safeNumber(
            x.metrics
              .expectancyR,
            -999
          ) >
            0 &&
          (
            x.metrics
              .profitFactor ===
              null ||
            safeNumber(
              x.metrics
                .profitFactor
            ) >
              1
          )
      );


    /* =====================================================
       VALIDATION
    ===================================================== */

    const validationCandidates =
      validateCandidates(
        rankedTraining,
        validationRows,
        symbol
      );


    const selected =
      validationCandidates[0];


    if (
      !selected
    ) {

      return res
        .status(200)
        .json({

          success:
            true,

          symbol,

          available:
            false,

          memory:
            count,

          error:
            `Could not create a ${symbol} research candidate.`

        });

    }


    /* =====================================================
       FINAL HOLDOUT TEST
    ===================================================== */

    const testTrades =
      simulate(
        testRows,
        selected.threshold,
        symbol
      );


    const testMetrics =
      metrics(
        testTrades
      );


    /* =====================================================
       ROBUSTNESS
    ===================================================== */

    const robustnessCheck =
      robustness(
        selected.threshold,
        trainingCandidates,
        validationRows,
        symbol
      );


    /* =====================================================
       EDGE STATUS

       This is descriptive only.

       It prevents a negative holdout from being displayed
       as though the system discovered a profitable edge.
    ===================================================== */

    const validationPositive =
      safeNumber(
        selected
          .validation
          .expectancyR,
        -999
      ) >
        0;


    const testPositive =
      safeNumber(
        testMetrics
          .expectancyR,
        -999
      ) >
        0;


    const testPFPositive =
      testMetrics
        .profitFactor ===
        null
        ? testMetrics.totalR >
          0
        : safeNumber(
            testMetrics
              .profitFactor
          ) >
          1;


    const sufficientTestSample =
      testMetrics.trades >=
      10;


    let researchStatus =
      "NO_CONFIRMED_EDGE";


    if (
      profitableTrainingCandidates.length &&
      validationPositive &&
      testPositive &&
      testPFPositive &&
      sufficientTestSample &&
      robustnessCheck.stable
    ) {

      researchStatus =
        "POSITIVE_HOLDOUT_RESULT";

    }
    else if (
      testPositive &&
      testPFPositive
    ) {

      researchStatus =
        "PROMISING_SMALL_OR_UNSTABLE_SAMPLE";

    }


    /* =====================================================
       RESPONSE
    ===================================================== */

    return res
      .status(200)
      .json({

        success:
          true,

        symbol,

        available:
          true,

        model:
          "MKAYFX WALK-FORWARD RESEARCH V13",

        researchVersion:
          13,

        memory:
          count,

        resolvedStates:
          rows.length,

        method:
          "60/20/20 chronological train-validation-holdout",

        costModel: {

          stopAtr:
            STOP_ATR,

          targetR:
            TARGET_R,

          estimatedCostAtr:
            ESTIMATED_COST_ATR,

          estimatedCostR:
            round(
              ESTIMATED_COST_R,
              4
            )

        },

        filters: {

          regimeAware:
            true,

          directionAware:
            symbol ===
            "BTC/USD",

          btcQuietChopBlocked:
            symbol ===
            "BTC/USD",

          minimumTrainingTrades:
            MIN_TRAIN_TRADES,

          minimumValidationTrades:
            MIN_VALIDATION_TRADES

        },

        trainRows:
          trainingRows.length,

        validationRows:
          validationRows.length,

        testRows:
          testRows.length,

        selectedThreshold:
          selected.threshold,

        researchStatus,


        /* -------------------------------------------------
           SELECTED CONFIGURATION
        ------------------------------------------------- */

        selected: {

          threshold:
            selected.threshold,

          combinedScore:
            selected.combinedScore,

          trainingQuality:
            selected.trainingQuality,

          validationQuality:
            selected.validationQuality

        },


        /* -------------------------------------------------
           TRAIN
        ------------------------------------------------- */

        training:
          selected.training,


        /* -------------------------------------------------
           VALIDATION
        ------------------------------------------------- */

        validation:
          selected.validation,


        /* -------------------------------------------------
           FINAL UNTOUCHED HOLDOUT

           Keep "test" because your existing frontend
           already reads this field.
        ------------------------------------------------- */

        test:
          testMetrics,


        /* -------------------------------------------------
           EXISTING UI COMPATIBILITY
        ------------------------------------------------- */

        byRegime:
          groupedMetrics(
            testTrades,
            "regime"
          ),

        bySession:
          groupedMetrics(
            testTrades,
            "session"
          ),


        /* -------------------------------------------------
           NEW BREAKDOWNS
        ------------------------------------------------- */

        byDirection:
          groupedMetrics(
            testTrades,
            "direction"
          ),


        /* -------------------------------------------------
           THRESHOLD RESEARCH
        ------------------------------------------------- */

        candidates:
          trainingCandidates,

        validationCandidates,


        /* -------------------------------------------------
           ROBUSTNESS
        ------------------------------------------------- */

        robustness:
          robustnessCheck,


        /* -------------------------------------------------
           TEST TRADE SAMPLE

           Useful for debugging without sending thousands
           of trades to the browser.
        ------------------------------------------------- */

        testTradeSample:
          testTrades
            .slice(
              -50
            ),


        note:
          "Research results are historical estimates. Threshold selection uses training and validation data; the final test segment is kept as a chronological holdout and is not used to select the threshold."

      });

  }
  catch(
    error
  ) {

    console.error(
      `RESEARCH V13 ${symbol}:`,
      error
    );


    return res
      .status(500)
      .json({

        success:
          false,

        symbol,

        model:
          "MKAYFX WALK-FORWARD RESEARCH V13",

        error:
          error?.message ||
          `${symbol} research failed.`

      });

  }

}