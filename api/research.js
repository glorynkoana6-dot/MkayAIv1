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
   MKAYFX RESEARCH ENGINE V13.1

   PURPOSE
   -------
   - XAU/USD research uses only XAU/USD memory
   - BTC/USD research uses only BTC/USD memory
   - Chronological train / holdout split
   - Threshold selected ONLY from training data
   - Final metrics calculated ONLY on untouched holdout
   - No random split
   - No holdout leakage
   - Includes version information for deployment debugging

========================================================= */

const RESEARCH_VERSION =
  "13.1";


const MIN_RESOLVED_STATES =
  100;


const MAX_RESOLVED_STATES =
  5000;


const TRAINING_RATIO =
  0.70;


const MIN_TRAINING_TRADES =
  20;


/*
  Thresholds that the training period
  is allowed to test.

  IMPORTANT:
  The holdout period does NOT choose
  the threshold.
*/

const THRESHOLDS = [
  20,
  30,
  40,
  50,
  60,
  70
];


/*
  Fixed research exit model.

  Stop = 1R
  Target = 1.2R

  Keep these fixed during the threshold
  experiment so thresholds are compared
  on the same basis.
*/

const RESEARCH_STOP_R =
  1;


const RESEARCH_TARGET_R =
  1.2;


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
    raw === "XAU/USD" ||
    raw === "XAUUSD" ||
    raw === "GOLD"
  ) {

    return "XAU/USD";

  }


  if (
    raw === "BTC/USD" ||
    raw === "BTCUSD" ||
    raw === "BTC" ||
    raw === "BITCOIN"
  ) {

    return "BTC/USD";

  }


  return null;
}


/* =========================================================
   QUERY HELPER
========================================================= */

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
   SAFE NUMBER
========================================================= */

function safeNumber(
  value,
  fallback = 0
) {

  const number =
    finite(
      value
    );


  return number === null ||
    number === undefined
      ? fallback
      : number;
}


/* =========================================================
   METRICS
========================================================= */

function metrics(
  trades
) {

  if (
    !Array.isArray(
      trades
    ) ||
    !trades.length
  ) {

    return {

      trades:0,

      wins:0,

      losses:0,

      winRate:null,

      expectancyR:null,

      profitFactor:null,

      totalR:0,

      maxDrawdownR:0,

      averageWinR:null,

      averageLossR:null

    };

  }


  const winningTrades =
    trades.filter(
      trade =>
        safeNumber(
          trade.r
        ) >
        0
    );


  const losingTrades =
    trades.filter(
      trade =>
        safeNumber(
          trade.r
        ) <
        0
    );


  const wins =
    winningTrades.length;


  const losses =
    losingTrades.length;


  const grossWin =
    winningTrades.reduce(
      (
        total,
        trade
      ) =>
        total +
        safeNumber(
          trade.r
        ),
      0
    );


  const grossLoss =
    Math.abs(
      losingTrades.reduce(
        (
          total,
          trade
        ) =>
          total +
          safeNumber(
            trade.r
          ),
        0
      )
    );


  const values =
    trades.map(
      trade =>
        safeNumber(
          trade.r
        )
    );


  /*
    Equity curve in R.

    Max drawdown is measured from the
    highest historical equity point.
  */

  let equity =
    0;


  let peak =
    0;


  let maxDrawdown =
    0;


  for (
    const trade of
    trades
  ) {

    equity +=
      safeNumber(
        trade.r
      );


    peak =
      Math.max(
        peak,
        equity
      );


    maxDrawdown =
      Math.max(
        maxDrawdown,
        peak -
        equity
      );

  }


  const averageWin =
    winningTrades.length
      ? mean(
          winningTrades.map(
            trade =>
              safeNumber(
                trade.r
              )
          )
        )
      : null;


  const averageLoss =
    losingTrades.length
      ? mean(
          losingTrades.map(
            trade =>
              safeNumber(
                trade.r
              )
          )
        )
      : null;


  let profitFactor =
    null;


  if (
    grossLoss >
    0
  ) {

    profitFactor =
      grossWin /
      grossLoss;

  }
  else if (
    grossWin ===
    0
  ) {

    profitFactor =
      0;

  }


  return {

    trades:
      trades.length,

    wins,

    losses,

    winRate:
      round(
        wins /
        trades.length *
        100,
        1
      ),

    expectancyR:
      round(
        mean(
          values
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

    maxDrawdownR:
      round(
        maxDrawdown,
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
          )

  };
}


/* =========================================================
   VALID ROW
========================================================= */

function validResearchRow(
  row,
  symbol
) {

  if (
    !row
  ) {

    return false;

  }


  if (
    row.symbol !==
    symbol
  ) {

    return false;

  }


  const components =
    row.features
      ?.componentScores;


  if (
    !components ||
    typeof components !==
    "object" ||
    !Object.keys(
      components
    ).length
  ) {

    return false;

  }


  if (
    !Array.isArray(
      row.future_path
    ) ||
    !row.future_path.length
  ) {

    return false;

  }


  if (
    !row.candle_time
  ) {

    return false;

  }


  const time =
    Date.parse(
      row.candle_time
    );


  if (
    !Number.isFinite(
      time
    )
  ) {

    return false;

  }


  return true;
}


/* =========================================================
   SIMULATION
========================================================= */

function simulate(
  rows,
  threshold
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


    let score;


    try {

      score =
        ensembleScore(
          components,
          row.regime,
          {}
        );

    }
    catch {

      continue;

    }


    score =
      finite(
        score
      );


    if (
      score === null
    ) {

      continue;

    }


    if (
      Math.abs(
        score
      ) <
      threshold
    ) {

      continue;

    }


    const direction =
      score >=
      0
        ? "BUY"
        : "SELL";


    let outcome;


    try {

      outcome =
        evaluatePath(
          row.future_path,
          direction,
          RESEARCH_STOP_R,
          RESEARCH_TARGET_R
        );

    }
    catch {

      continue;

    }


    if (
      !outcome
    ) {

      continue;

    }


    const resultR =
      finite(
        outcome.resultR
      );


    if (
      resultR ===
      null
    ) {

      continue;

    }


    trades.push({

      symbol:
        row.symbol,

      time:
        row.candle_time,

      r:
        resultR,

      direction,

      score,

      regime:
        row.regime ||
        "UNKNOWN",

      session:
        row.session ||
        "UNKNOWN"

    });

  }


  return trades;
}


/* =========================================================
   GROUPED METRICS
========================================================= */

function groupedMetrics(
  trades,
  key
) {

  const groups =
    {};


  for (
    const trade of
    trades
  ) {

    const name =
      trade[key] ||
      "UNKNOWN";


    groups[name] ??=
      [];


    groups[name].push(
      trade
    );

  }


  const output =
    {};


  for (
    const [
      name,
      groupTrades
    ] of
    Object.entries(
      groups
    )
  ) {

    output[name] =
      metrics(
        groupTrades
      );

  }


  return output;
}


/* =========================================================
   THRESHOLD RESEARCH
========================================================= */

function testThresholds(
  trainingRows
) {

  return THRESHOLDS.map(
    threshold => {

      const trades =
        simulate(
          trainingRows,
          threshold
        );


      return {

        threshold,

        metrics:
          metrics(
            trades
          )

      };

    }
  );

}


/* =========================================================
   SELECT THRESHOLD
========================================================= */

function selectThreshold(
  candidates
) {

  /*
    First preference:

    Threshold must have at least
    MIN_TRAINING_TRADES.

    This prevents tiny samples from
    dominating threshold selection.
  */

  const viable =
    candidates.filter(
      candidate =>
        candidate.metrics
          .trades >=
        MIN_TRAINING_TRADES
    );


  const pool =
    viable.length
      ? viable
      : candidates;


  /*
    IMPORTANT:

    Selection uses TRAINING ONLY.

    Holdout/test results are never used
    here.

    Ranking:
    1. Higher expectancy
    2. Higher profit factor
    3. Lower drawdown
    4. Larger sample
    5. Higher threshold
  */

  const ranked =
    [...pool]
      .sort(
        (
          a,
          b
        ) => {

          const expectancyA =
            finite(
              a.metrics
                .expectancyR
            ) ??
            -999;


          const expectancyB =
            finite(
              b.metrics
                .expectancyR
            ) ??
            -999;


          if (
            expectancyA !==
            expectancyB
          ) {

            return (
              expectancyB -
              expectancyA
            );

          }


          const pfA =
            finite(
              a.metrics
                .profitFactor
            ) ??
            -999;


          const pfB =
            finite(
              b.metrics
                .profitFactor
            ) ??
            -999;


          if (
            pfA !==
            pfB
          ) {

            return (
              pfB -
              pfA
            );

          }


          const ddA =
            finite(
              a.metrics
                .maxDrawdownR
            ) ??
            999999;


          const ddB =
            finite(
              b.metrics
                .maxDrawdownR
            ) ??
            999999;


          if (
            ddA !==
            ddB
          ) {

            return (
              ddA -
              ddB
            );

          }


          if (
            a.metrics
              .trades !==
            b.metrics
              .trades
          ) {

            return (
              b.metrics
                .trades -
              a.metrics
                .trades
            );

          }


          return (
            b.threshold -
            a.threshold
          );

        }
      );


  return {

    best:
      ranked[0] ||
      null,

    viableCandidates:
      viable.length,

    ranked

  };
}


/* =========================================================
   DATE RANGE
========================================================= */

function dateRange(
  rows
) {

  if (
    !rows.length
  ) {

    return {

      from:null,

      to:null

    };

  }


  return {

    from:
      rows[0]
        ?.candle_time ||
      null,

    to:
      rows[
        rows.length -
        1
      ]
        ?.candle_time ||
      null

  };
}


/* =========================================================
   MAIN
========================================================= */

export default async function handler(
  req,
  res
) {

  /*
    Disable caching so an old Vercel/API
    research response cannot remain on
    the phone.
  */

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );


  res.setHeader(
    "Pragma",
    "no-cache"
  );


  res.setHeader(
    "Expires",
    "0"
  );


  res.setHeader(
    "Surrogate-Control",
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


  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
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

        success:false,

        version:
          RESEARCH_VERSION,

        error:
          "Use GET."

      });

  }


  /* =======================================================
     SYMBOL
  ======================================================= */

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

        success:false,

        version:
          RESEARCH_VERSION,

        error:
          "Unsupported symbol.",

        supportedSymbols:[
          "XAU/USD",
          "BTC/USD"
        ]

      });

  }


  /* =======================================================
     DATABASE
  ======================================================= */

  if (
    !dbEnabled()
  ) {

    return res
      .status(200)
      .json({

        success:true,

        version:
          RESEARCH_VERSION,

        symbol,

        available:false,

        error:
          "DATABASE_URL is not configured."

      });

  }


  try {

    /* =====================================================
       LOAD SYMBOL-SPECIFIC MEMORY
    ===================================================== */

    let rows =
      await loadResolvedStates({

        symbol,

        limit:
          MAX_RESOLVED_STATES

      });


    if (
      !Array.isArray(
        rows
      )
    ) {

      rows =
        [];

    }


    /*
      IMPORTANT SAFETY CHECK:

      Even though loadResolvedStates()
      receives the requested symbol,
      filter again here.

      This guarantees BTC research cannot
      accidentally process Gold rows and
      Gold research cannot process BTC.
    */

    rows =
      rows
        .filter(
          row =>
            validResearchRow(
              row,
              symbol
            )
        )
        .sort(
          (
            a,
            b
          ) =>
            Date.parse(
              a.candle_time
            ) -
            Date.parse(
              b.candle_time
            )
        );


    const count =
      await memoryCount(
        symbol
      );


    /* =====================================================
       MINIMUM SAMPLE
    ===================================================== */

    if (
      rows.length <
      MIN_RESOLVED_STATES
    ) {

      return res
        .status(200)
        .json({

          success:true,

          version:
            RESEARCH_VERSION,

          engineVersion:
            RESEARCH_VERSION,

          symbol,

          available:false,

          memory:
            count,

          resolvedStates:
            rows.length,

          requiredStates:
            MIN_RESOLVED_STATES,

          error:
            `Need at least ${MIN_RESOLVED_STATES} resolved ${symbol} market states. Backfill ${symbol} memory first.`

        });

    }


    /* =====================================================
       CHRONOLOGICAL SPLIT
    ===================================================== */

    const split =
      Math.floor(
        rows.length *
        TRAINING_RATIO
      );


    if (
      split <=
      0 ||
      split >=
      rows.length
    ) {

      throw new Error(
        "Could not create chronological training/test split."
      );

    }


    const training =
      rows.slice(
        0,
        split
      );


    const test =
      rows.slice(
        split
      );


    /* =====================================================
       TRAINING THRESHOLD SEARCH
    ===================================================== */

    const candidates =
      testThresholds(
        training
      );


    const selection =
      selectThreshold(
        candidates
      );


    const best =
      selection.best;


    if (
      !best
    ) {

      return res
        .status(200)
        .json({

          success:true,

          version:
            RESEARCH_VERSION,

          engineVersion:
            RESEARCH_VERSION,

          symbol,

          available:false,

          memory:
            count,

          resolvedStates:
            rows.length,

          error:
            `Could not create a ${symbol} research candidate.`

        });

    }


    /* =====================================================
       UNTOUCHED HOLDOUT
    ===================================================== */

    /*
      Only NOW do we run the selected
      threshold against the holdout.

      Nothing from this test result was
      used to choose the threshold.
    */

    const testTrades =
      simulate(
        test,
        best.threshold
      );


    const testMetrics =
      metrics(
        testTrades
      );


    /* =====================================================
       GROUP ANALYSIS
    ===================================================== */

    const byRegime =
      groupedMetrics(
        testTrades,
        "regime"
      );


    const bySession =
      groupedMetrics(
        testTrades,
        "session"
      );


    /* =====================================================
       DATE INFORMATION
    ===================================================== */

    const fullRange =
      dateRange(
        rows
      );


    const trainingRange =
      dateRange(
        training
      );


    const testRange =
      dateRange(
        test
      );


    /* =====================================================
       RESPONSE
    ===================================================== */

    return res
      .status(200)
      .json({

        success:true,

        /*
          Your frontend will display:

          V13.1 · THRESHOLD XX
        */

        version:
          RESEARCH_VERSION,

        engineVersion:
          RESEARCH_VERSION,

        symbol,

        available:true,

        memory:
          count,

        resolvedStates:
          rows.length,

        methodology:{

          split:
            "chronological",

          trainingPercent:
            70,

          holdoutPercent:
            30,

          thresholdSelection:
            "training-only",

          holdoutUsedForSelection:
            false,

          stopR:
            RESEARCH_STOP_R,

          targetR:
            RESEARCH_TARGET_R,

          minimumTrainingTrades:
            MIN_TRAINING_TRADES

        },

        method:
          "70/30 chronological training/untouched holdout",

        dateRange:
          fullRange,

        trainingRange,

        testRange,

        trainRows:
          training.length,

        testRows:
          test.length,

        selectedThreshold:
          best.threshold,

        viableCandidates:
          selection.viableCandidates,

        training:
          best.metrics,

        test:
          testMetrics,

        byRegime,

        bySession,

        /*
          All threshold candidates are
          TRAINING results.

          This is useful for debugging
          why a threshold was selected.
        */

        candidates,

        note:
          "Threshold selection uses training data only. Holdout results are reported after selection and are not used to optimize the threshold. Historical results do not guarantee future performance."

      });

  }
  catch(
    error
  ) {

    console.error(
      `RESEARCH ${symbol} V${RESEARCH_VERSION}:`,
      error
    );


    return res
      .status(500)
      .json({

        success:false,

        version:
          RESEARCH_VERSION,

        engineVersion:
          RESEARCH_VERSION,

        symbol,

        error:
          error?.message ||
          `${symbol} research failed.`

      });

  }

}