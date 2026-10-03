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


const VERSION = "15.0";

const MIN_RESOLVED_STATES =
  100;

const MAX_RESOLVED_STATES =
  5000;

const HOLDOUT_RATIO =
  0.30;


/* =========================================================
   SYMBOL
========================================================= */

function normalizeSymbol(value) {
  const raw =
    String(
      value || "XAU/USD"
    )
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");

  if (
    [
      "XAU/USD",
      "XAUUSD",
      "GOLD"
    ].includes(raw)
  ) {
    return "XAU/USD";
  }

  if (
    [
      "BTC/USD",
      "BTCUSD",
      "BTC",
      "BITCOIN"
    ].includes(raw)
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


/* =========================================================
   METRICS
========================================================= */

function metrics(trades) {
  if (
    !Array.isArray(trades) ||
    !trades.length
  ) {
    return {
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: null,
      expectancyR: null,
      profitFactor: null,
      totalR: 0,
      maxDrawdownR: 0,
      averageWinR: null,
      averageLossR: null
    };
  }

  const wins =
    trades.filter(
      trade =>
        trade.r > 0
    );

  const losses =
    trades.filter(
      trade =>
        trade.r < 0
    );

  const grossWin =
    wins.reduce(
      (sum, trade) =>
        sum + trade.r,
      0
    );

  const grossLoss =
    Math.abs(
      losses.reduce(
        (sum, trade) =>
          sum + trade.r,
        0
      )
    );

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (
    const trade of trades
  ) {
    equity += trade.r;

    peak =
      Math.max(
        peak,
        equity
      );

    maxDrawdown =
      Math.max(
        maxDrawdown,
        peak - equity
      );
  }

  return {
    trades:
      trades.length,

    wins:
      wins.length,

    losses:
      losses.length,

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
            trade =>
              trade.r
          )
        ),
        3
      ),

    profitFactor:
      grossLoss > 0
        ? round(
            grossWin /
            grossLoss,
            2
          )
        : grossWin > 0
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
      wins.length
        ? round(
            mean(
              wins.map(
                trade =>
                  trade.r
              )
            ),
            3
          )
        : null,

    averageLossR:
      losses.length
        ? round(
            mean(
              losses.map(
                trade =>
                  trade.r
              )
            ),
            3
          )
        : null
  };
}


/* =========================================================
   VALID V15 MEMORY
========================================================= */

function validRow(
  row,
  symbol
) {
  if (!row) {
    return false;
  }

  if (
    row.symbol !== symbol
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
    !Array.isArray(
      row.future_path
    ) ||
    !row.future_path.length
  ) {
    return false;
  }

  const features =
    row.features || {};

  /*
    This intentionally rejects old V13/V14
    rows.

    Otherwise the V15 report could silently
    mix old strategy memory with new strategy
    memory.
  */

  if (
    features.engineVersion !==
    VERSION
  ) {
    return false;
  }

  return true;
}


/* =========================================================
   CREATE TRADE
========================================================= */

function tradeFromRow(row) {
  const features =
    row.features || {};

  if (
    !features.strategyQualified
  ) {
    return null;
  }

  const direction =
    features.strategyDirection;

  if (
    direction !== "BUY" &&
    direction !== "SELL"
  ) {
    return null;
  }

  const stopAtr =
    finite(
      features.stopAtr
    );

  const targetR =
    finite(
      features.targetR
    );

  if (
    stopAtr === null ||
    targetR === null ||
    stopAtr <= 0 ||
    targetR <= 0
  ) {
    return null;
  }

  const outcome =
    evaluatePath(
      row.future_path,
      direction,
      stopAtr,
      targetR
    );

  if (!outcome) {
    return null;
  }

  const resultR =
    finite(
      outcome.resultR
    );

  if (
    resultR === null
  ) {
    return null;
  }

  return {
    symbol:
      row.symbol,

    time:
      row.candle_time,

    direction,

    regime:
      row.regime ||
      "UNKNOWN",

    session:
      row.session ||
      "UNKNOWN",

    score:
      finite(
        features.strategyScore
      ) ?? 0,

    agreement:
      features.agreement ||
      null,

    stopAtr,

    targetR,

    r:
      resultR,

    outcome:
      outcome.outcome
  };
}


/* =========================================================
   SIMULATION
========================================================= */

function simulate(rows) {
  return rows
    .map(tradeFromRow)
    .filter(Boolean);
}


/* =========================================================
   GROUPING
========================================================= */

function groupedMetrics(
  trades,
  key
) {
  const groups = {};

  for (
    const trade of trades
  ) {
    const name =
      trade[key] ||
      "UNKNOWN";

    groups[name] ??= [];

    groups[name].push(
      trade
    );
  }

  const output = {};

  for (
    const [
      name,
      group
    ] of
    Object.entries(groups)
  ) {
    output[name] =
      metrics(group);
  }

  return output;
}


/* =========================================================
   DIRECTION
========================================================= */

function byDirection(trades) {
  return {
    BUY:
      metrics(
        trades.filter(
          trade =>
            trade.direction ===
            "BUY"
        )
      ),

    SELL:
      metrics(
        trades.filter(
          trade =>
            trade.direction ===
            "SELL"
        )
      )
  };
}


/* =========================================================
   DATE RANGE
========================================================= */

function dateRange(rows) {
  if (!rows.length) {
    return {
      from: null,
      to: null
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
    req.method === "OPTIONS"
  ) {
    return res
      .status(204)
      .end();
  }

  if (
    req.method !== "GET"
  ) {
    return res
      .status(405)
      .json({
        success: false,
        version: VERSION,
        error: "Use GET."
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
        success: false,

        version:
          VERSION,

        error:
          "Unsupported symbol.",

        supportedSymbols: [
          "XAU/USD",
          "BTC/USD"
        ]
      });
  }

  if (!dbEnabled()) {
    return res
      .status(200)
      .json({
        success: true,

        version:
          VERSION,

        symbol,

        available: false,

        error:
          "DATABASE_URL is not configured."
      });
  }

  try {
    let rows =
      await loadResolvedStates({
        symbol,

        limit:
          MAX_RESOLVED_STATES
      });

    if (!Array.isArray(rows)) {
      rows = [];
    }

    const allResolvedCount =
      rows.length;

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
          (a, b) =>
            Date.parse(
              a.candle_time
            ) -
            Date.parse(
              b.candle_time
            )
        );

    const count =
      await memoryCount(symbol);

    if (
      rows.length <
      MIN_RESOLVED_STATES
    ) {
      return res
        .status(200)
        .json({
          success: true,

          version:
            VERSION,

          engineVersion:
            VERSION,

          symbol,

          available: false,

          memory:
            count,

          allResolvedStates:
            allResolvedCount,

          v15ResolvedStates:
            rows.length,

          requiredStates:
            MIN_RESOLVED_STATES,

          error:
            `Need at least ${MIN_RESOLVED_STATES} resolved V15 ${symbol} states. Run a new V15 backfill first.`
        });
    }

    /*
      V15 is already a fixed strategy.

      Therefore research does NOT search
      the holdout for a better threshold.

      We simply reserve the newest 30%
      as the untouched report period.
    */

    const split =
      Math.floor(
        rows.length *
        (1 - HOLDOUT_RATIO)
      );

    const development =
      rows.slice(
        0,
        split
      );

    const holdout =
      rows.slice(
        split
      );

    const developmentTrades =
      simulate(development);

    const holdoutTrades =
      simulate(holdout);

    const developmentMetrics =
      metrics(
        developmentTrades
      );

    const holdoutMetrics =
      metrics(
        holdoutTrades
      );

    const byRegime =
      groupedMetrics(
        holdoutTrades,
        "regime"
      );

    const bySession =
      groupedMetrics(
        holdoutTrades,
        "session"
      );

    const directionMetrics =
      byDirection(
        holdoutTrades
      );

    return res
      .status(200)
      .json({
        success: true,

        version:
          VERSION,

        engineVersion:
          VERSION,

        engine:
          "MULTI_AGENT_V15",

        symbol,

        available: true,

        memory:
          count,

        resolvedStates:
          rows.length,

        oldStatesIgnored:
          Math.max(
            0,
            allResolvedCount -
            rows.length
          ),

        methodology: {
          split:
            "chronological",

          developmentPercent:
            70,

          holdoutPercent:
            30,

          strategy:
            "fixed V15 strategy",

          thresholdSelection:
            "none",

          holdoutUsedForSelection:
            false,

          note:
            "Only rows generated by V15 are included."
        },

        method:
          "Fixed V15 strategy / 70% development / 30% untouched holdout",

        dateRange:
          dateRange(rows),

        trainingRange:
          dateRange(
            development
          ),

        testRange:
          dateRange(
            holdout
          ),

        trainRows:
          development.length,

        testRows:
          holdout.length,

        /*
          Kept for your existing frontend.

          Your old frontend expects this
          property.
        */

        selectedThreshold:
          "FIXED",

        training:
          developmentMetrics,

        test:
          holdoutMetrics,

        byRegime,

        bySession,

        byDirection:
          directionMetrics,

        candidates: [],

        note:
          "V15 holdout performance is descriptive, not a guarantee of future results. The holdout is not used to modify the strategy."
      });
  }
  catch (error) {
    console.error(
      `RESEARCH V15 ${symbol}:`,
      error
    );

    return res
      .status(500)
      .json({
        success: false,

        version:
          VERSION,

        engineVersion:
          VERSION,

        symbol,

        error:
          error?.message ||
          `${symbol} V15 research failed.`
      });
  }
}