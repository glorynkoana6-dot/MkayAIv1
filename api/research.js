import {
  finite,
  round,
  mean,
  evaluatePath
} from "./core.js";


import {
  dbEnabled,
  loadResolvedStates,
  memoryCount
} from "./db.js";


/* =========================================================
   MKAYFX SIMPLE STRATEGY RESEARCH V14

   IMPORTANT
   ---------
   No ensemble threshold optimization.
   No similarity matching.
   No choosing settings from the holdout.

   The research engine tests the exact
   TREND_PULLBACK_V14 signals stored by memory.js.

========================================================= */

const VERSION =
  "14.0";


const MAX_STATES =
  5000;


const MIN_STATES =
  100;


const TRAINING_RATIO =
  0.70;


const STOP_ATR =
  1;


const TARGET_R =
  2;


/* =========================================================
   SYMBOL
========================================================= */

function normalizeSymbol(value) {

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


function queryValue(
  req,
  key
) {

  const value =
    req.query?.[key];


  return Array.isArray(value)
    ? value[0]
    : value;
}


function safeNumber(
  value,
  fallback = 0
) {

  const n =
    finite(
      value
    );


  return n === null
    ? fallback
    : n;
}


/* =========================================================
   VALID V14 ROW
========================================================= */

function validRow(
  row,
  symbol
) {

  if (!row) {
    return false;
  }


  if (
    row.symbol !==
    symbol
  ) {
    return false;
  }


  if (
    !row.candle_time
  ) {
    return false;
  }


  if (
    !Number.isFinite(
      Date.parse(
        row.candle_time
      )
    )
  ) {
    return false;
  }


  if (
    row.features
      ?.strategyName !==
    "TREND_PULLBACK_V14"
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


  return true;
}


/* =========================================================
   METRICS
========================================================= */

function metrics(trades) {

  if (
    !Array.isArray(trades) ||
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


  const winners =
    trades.filter(
      trade =>
        safeNumber(
          trade.r
        ) >
        0
    );


  const losers =
    trades.filter(
      trade =>
        safeNumber(
          trade.r
        ) <
        0
    );


  const grossWin =
    winners.reduce(
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
      losers.reduce(
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


  return {

    trades:
      trades.length,

    wins:
      winners.length,

    losses:
      losers.length,

    winRate:
      round(
        winners.length /
        trades.length *
        100,
        1
      ),

    expectancyR:
      round(
        mean(
          trades.map(
            trade =>
              safeNumber(
                trade.r
              )
          )
        ),
        3
      ),

    profitFactor:
      grossLoss >
      0
        ? round(
            grossWin /
            grossLoss,
            2
          )
        : grossWin >
          0
          ? null
          : 0,

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
      winners.length
        ? round(
            mean(
              winners.map(
                trade =>
                  safeNumber(
                    trade.r
                  )
              )
            ),
            3
          )
        : null,

    averageLossR:
      losers.length
        ? round(
            mean(
              losers.map(
                trade =>
                  safeNumber(
                    trade.r
                  )
              )
            ),
            3
          )
        : null

  };
}


/* =========================================================
   SIMULATE
========================================================= */

function simulate(rows) {

  const trades =
    [];


  for (
    const row of
    rows
  ) {

    const signal =
      row.features
        ?.strategySignal;


    const qualified =
      row.features
        ?.strategyQualified ===
      true;


    if (
      !qualified ||
      ![
        "BUY",
        "SELL"
      ].includes(
        signal
      )
    ) {

      continue;

    }


    const outcome =
      evaluatePath(
        row.future_path,
        signal,
        STOP_ATR,
        TARGET_R
      );


    if (!outcome) {
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

      direction:
        signal,

      r:
        resultR,

      outcome:
        outcome.outcome,

      regime:
        row.regime ||
        "UNKNOWN",

      session:
        row.session ||
        "UNKNOWN",

      score:
        row.features
          ?.strategyScore ??
        null

    });

  }


  return trades;
}


/* =========================================================
   GROUPING
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
      rows
    ] of
    Object.entries(
      groups
    )
  ) {

    output[name] =
      metrics(
        rows
      );

  }


  return output;
}


/* =========================================================
   DATE RANGE
========================================================= */

function dateRange(rows) {

  if (!rows.length) {

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
      rows.at(-1)
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
          VERSION,

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


  if (!symbol) {

    return res
      .status(400)
      .json({

        success:false,

        version:
          VERSION,

        error:
          "Unsupported symbol.",

        supportedSymbols:[
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

        success:true,

        version:
          VERSION,

        symbol,

        available:false,

        error:
          "DATABASE_URL is not configured."

      });

  }


  try {

    let rows =
      await loadResolvedStates({

        symbol,

        limit:
          MAX_STATES

      });


    if (
      !Array.isArray(rows)
    ) {

      rows =
        [];

    }


    /*
      IMPORTANT:

      Old V12/V13 memory is ignored.

      Only rows generated by TREND_PULLBACK_V14
      are accepted.
    */

    rows =
      rows
        .filter(
          row =>
            validRow(
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


    if (
      rows.length <
      MIN_STATES
    ) {

      return res
        .status(200)
        .json({

          success:true,

          version:
            VERSION,

          engineVersion:
            VERSION,

          symbol,

          available:false,

          memory:
            count,

          resolvedStates:
            rows.length,

          requiredStates:
            MIN_STATES,

          error:
            `Need V14 ${symbol} memory. Run BACKFILL MEMORY after deploying the new core.js and memory.js.`

        });

    }


    /* =====================================================
       CHRONOLOGICAL SPLIT

       We are NOT optimizing anything.

       The split remains useful because it lets us see
       whether performance persists into later unseen data.
    ===================================================== */

    const split =
      Math.floor(
        rows.length *
        TRAINING_RATIO
      );


    const training =
      rows.slice(
        0,
        split
      );


    const test =
      rows.slice(
        split
      );


    const trainingTrades =
      simulate(
        training
      );


    const testTrades =
      simulate(
        test
      );


    const trainingMetrics =
      metrics(
        trainingTrades
      );


    const testMetrics =
      metrics(
        testTrades
      );


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


    const byDirection =
      groupedMetrics(
        testTrades,
        "direction"
      );


    return res
      .status(200)
      .json({

        success:true,

        version:
          VERSION,

        engineVersion:
          VERSION,

        symbol,

        available:true,

        strategy:
          "TREND_PULLBACK_V14",

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

          optimization:
            "NONE",

          holdoutUsedForSelection:
            false,

          stopAtr:
            STOP_ATR,

          targetR:
            TARGET_R,

          strategy:
            "H1 EMA200 trend + M15 EMA200 confirmation + M5 EMA20 pullback/continuation + RSI"

        },

        method:
          "70/30 chronological fixed-strategy test",

        dateRange:
          dateRange(
            rows
          ),

        trainingRange:
          dateRange(
            training
          ),

        testRange:
          dateRange(
            test
          ),

        trainRows:
          training.length,

        testRows:
          test.length,

        /*
          Keep selectedThreshold so your current
          frontend does not break.

          V14 does NOT use a threshold.
        */

        selectedThreshold:
          "FIXED",

        viableCandidates:
          1,

        training:
          trainingMetrics,

        test:
          testMetrics,

        byRegime,

        bySession,

        byDirection,

        candidates:[
          {
            strategy:
              "TREND_PULLBACK_V14",

            stopAtr:
              STOP_ATR,

            targetR:
              TARGET_R,

            metrics:
              trainingMetrics
          }
        ],

        note:
          "V14 uses fixed strategy rules. No threshold was optimized against the holdout. Historical results do not guarantee future performance."

      });

  }
  catch(error) {

    console.error(
      `RESEARCH V14 ${symbol}:`,
      error
    );


    return res
      .status(500)
      .json({

        success:false,

        version:
          VERSION,

        engineVersion:
          VERSION,

        symbol,

        error:
          error?.message ||
          `${symbol} V14 research failed.`

      });

  }
}