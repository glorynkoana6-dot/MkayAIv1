import {
  envNumber,
  finite,
  round,
  clamp,
  mean,
  parseUTC,
  sessionFor,
  fetchSeries,
  fetchSeriesSafe,
  fetchPrice,
  completed,
  resample,
  snapshot,
  goldContext,
  detectRegime,
  scoreTechnical,
  breakoutScore,
  meanReversionScore,
  seriesDirection,
  crossMarketScore,
  basicComponentScores,
  buildFeatureState,
  similarityScore,
  buildFuturePath,
  optimizeRiskReward,
  historicalStats,
  adaptiveReliability,
  ensembleScore,
  inferSetup
} from "./core.js";


import {
  dbEnabled,
  upsertMarketState,
  loadResolvedStates,
  saveSignalRecord,
  memoryCount
} from "./db.js";


/* =========================================================
   MKAYFX MULTI-ASSET QUANT EDGE V12.1

   SUPPORTED
   ---------
   XAU/USD
   BTC/USD

   V12.1 IMPROVEMENTS
   ------------------
   - Separate GOLD / BTC decision policies
   - BTC regime-specific thresholds
   - QUIET_CHOP BTC hard block
   - Strict BTC RANGE filter
   - Cost-adjusted historical expectancy
   - H1 / M15 / M5 timeframe agreement
   - Regime-direction conflict penalty
   - Historical sample normalization
   - Target hit-rate normalization
   - Entry chase protection
   - Adaptive historical requirements
   - Stronger BTC qualification
   - Better diagnostic output
========================================================= */


/* =========================================================
   ASSETS
========================================================= */

const ASSETS = {

  "XAU/USD": {
    symbol: "XAU/USD",
    code: "XAUUSD",
    name: "Gold",
    type: "METAL",
    precision: 2,
    trades247: false,
    crossWeight: 1
  },

  "BTC/USD": {
    symbol: "BTC/USD",
    code: "BTCUSD",
    name: "Bitcoin",
    type: "CRYPTO",
    precision: 2,
    trades247: true,
    crossWeight: 0.55
  }

};


function normalizeSymbol(value) {

  const raw =
    String(
      value ||
      "XAU/USD"
    )
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");


  if (
    raw === "XAUUSD" ||
    raw === "XAU/USD" ||
    raw === "GOLD"
  ) {
    return "XAU/USD";
  }


  if (
    raw === "BTCUSD" ||
    raw === "BTC/USD" ||
    raw === "BTC"
  ) {
    return "BTC/USD";
  }


  return null;
}


/* =========================================================
   GENERAL SETTINGS
========================================================= */

const M1_OUTPUT =
  Math.round(
    envNumber(
      "M1_OUTPUT",
      3000,
      1000,
      5000
    )
  );


const H1_OUTPUT =
  Math.round(
    envNumber(
      "H1_OUTPUT",
      300,
      100,
      1000
    )
  );


const LOCAL_HISTORY_BARS =
  Math.round(
    envNumber(
      "LOCAL_HISTORY_BARS",
      520,
      200,
      900
    )
  );


const STALE_MS =
  envNumber(
    "STALE_MS",
    10 * 60_000,
    60_000,
    60 * 60_000
  );


const DEFAULT_EQUITY =
  envNumber(
    "DEFAULT_EQUITY_ZAR",
    200,
    1
  );


const RISK_PERCENT =
  envNumber(
    "RISK_PER_TRADE_PCT",
    0.25,
    0.01,
    2
  );


const MIN_EDGE =
  envNumber(
    "MIN_EDGE_SCORE",
    68,
    40,
    95
  );


const WATCH_EDGE =
  envNumber(
    "WATCH_EDGE_SCORE",
    55,
    25,
    90
  );


const MIN_TECHNICAL =
  envNumber(
    "MIN_TECHNICAL_SCORE",
    20,
    0,
    100
  );


const MIN_AGREEMENT =
  envNumber(
    "MIN_MODEL_AGREEMENT",
    0.60,
    0.4,
    1
  );


const MIN_MATCHES =
  Math.round(
    envNumber(
      "MIN_HISTORICAL_MATCHES",
      18,
      5,
      200
    )
  );


const MIN_EXPECTANCY =
  envNumber(
    "MIN_EXPECTANCY_R",
    0.05,
    -1,
    3
  );


const TOP_K =
  Math.round(
    envNumber(
      "HISTORICAL_TOP_K",
      80,
      20,
      250
    )
  );


const MIN_SIM =
  envNumber(
    "HISTORICAL_MIN_SIMILARITY",
    50,
    20,
    95
  );


const FORWARD_BARS =
  Math.round(
    envNumber(
      "HISTORICAL_FORWARD_BARS",
      12,
      6,
      36
    )
  );


const FRESH_MINUTES =
  envNumber(
    "SIGNAL_FRESH_MINUTES",
    3,
    1,
    15
  );


const EXPIRE_MINUTES =
  envNumber(
    "SIGNAL_EXPIRE_MINUTES",
    10,
    3,
    60
  );


const MAX_CHASE_ATR =
  envNumber(
    "MAX_CHASE_ATR",
    0.35,
    0.1,
    1.5
  );


const SERIES_CACHE_MS =
  envNumber(
    "SERIES_CACHE_MS",
    45_000,
    5_000,
    300_000
  );


const H1_CACHE_MS =
  envNumber(
    "H1_CACHE_MS",
    180_000,
    30_000,
    600_000
  );


const PRICE_CACHE_MS =
  envNumber(
    "PRICE_CACHE_MS",
    8_000,
    1_000,
    60_000
  );


const CROSS_CACHE_MS =
  envNumber(
    "CROSS_CACHE_MS",
    120_000,
    30_000,
    600_000
  );


const MACRO_CACHE_MS =
  envNumber(
    "MACRO_CACHE_MS",
    60_000,
    10_000,
    600_000
  );


/* =========================================================
   BTC ADAPTIVE SETTINGS
========================================================= */

const BTC_MIN_MATCHES =
  Math.round(
    envNumber(
      "BTC_MIN_HISTORICAL_MATCHES",
      24,
      8,
      200
    )
  );


const BTC_MIN_EXPECTANCY =
  envNumber(
    "BTC_MIN_EXPECTANCY_R",
    0.08,
    -1,
    3
  );


const BTC_RANGE_MIN_EXPECTANCY =
  envNumber(
    "BTC_RANGE_MIN_EXPECTANCY_R",
    0.15,
    -1,
    3
  );


const BTC_TREND_MIN_EDGE =
  envNumber(
    "BTC_TREND_MIN_EDGE",
    68,
    40,
    95
  );


const BTC_MIXED_MIN_EDGE =
  envNumber(
    "BTC_MIXED_MIN_EDGE",
    66,
    40,
    95
  );


const BTC_RANGE_MIN_EDGE =
  envNumber(
    "BTC_RANGE_MIN_EDGE",
    76,
    40,
    95
  );


const BTC_MIN_AGREEMENT =
  envNumber(
    "BTC_MIN_MODEL_AGREEMENT",
    0.64,
    0.4,
    1
  );


const BTC_RANGE_MIN_AGREEMENT =
  envNumber(
    "BTC_RANGE_MIN_MODEL_AGREEMENT",
    0.70,
    0.4,
    1
  );


const BTC_MIN_TF_ALIGNMENT =
  envNumber(
    "BTC_MIN_TIMEFRAME_ALIGNMENT",
    0.60,
    0,
    1
  );


const GOLD_MIN_TF_ALIGNMENT =
  envNumber(
    "GOLD_MIN_TIMEFRAME_ALIGNMENT",
    0.50,
    0,
    1
  );


const ESTIMATED_COST_ATR =
  envNumber(
    "ESTIMATED_COST_ATR",
    0.03,
    0,
    0.5
  );


/* =========================================================
   SERVERLESS CACHE
========================================================= */

const CACHE =
  globalThis.__MKAYFX_V121_CACHE__ ||
  new Map();


globalThis.__MKAYFX_V121_CACHE__ =
  CACHE;


async function cached(
  key,
  ttl,
  loader
) {

  const now =
    Date.now();


  const existing =
    CACHE.get(
      key
    );


  if (
    existing &&
    now -
      existing.time <
      ttl
  ) {

    return existing.value;

  }


  const value =
    await loader();


  CACHE.set(
    key,
    {
      time: now,
      value
    }
  );


  return value;
}


/* =========================================================
   REQUEST HELPERS
========================================================= */

function bodyOf(req) {

  if (!req.body) {
    return {};
  }


  if (
    typeof req.body ===
    "object"
  ) {
    return req.body;
  }


  try {

    return JSON.parse(
      req.body
    );

  }
  catch {

    return {};

  }

}


function queryValue(
  req,
  key
) {

  if (
    req.query &&
    req.query[key] !==
      undefined
  ) {

    const value =
      req.query[key];

    return Array.isArray(
      value
    )
      ? value[0]
      : value;

  }


  try {

    const url =
      new URL(
        req.url,
        "http://localhost"
      );

    return url.searchParams.get(
      key
    );

  }
  catch {

    return null;

  }

}


function send(
  res,
  status,
  body
) {

  return res
    .status(status)
    .json(body);
}


/* =========================================================
   MARKET SCHEDULE
========================================================= */

function marketOpen(
  symbol,
  now = Date.now()
) {

  const asset =
    ASSETS[symbol];


  if (
    asset?.trades247
  ) {

    return {
      open: true,
      reason: "24_7_MARKET"
    };

  }


  const date =
    new Date(
      now
    );


  const day =
    date.getUTCDay();


  const hour =
    date.getUTCHours();


  if (
    day === 6
  ) {

    return {
      open: false,
      reason: "WEEKEND"
    };

  }


  if (
    day === 0 &&
    hour < 22
  ) {

    return {
      open: false,
      reason: "WEEKEND"
    };

  }


  if (
    day === 5 &&
    hour >= 22
  ) {

    return {
      open: false,
      reason: "WEEKEND"
    };

  }


  return {
    open: true,
    reason: "NORMAL_SESSION"
  };
}


/* =========================================================
   SAFE LIVE PRICE
========================================================= */

async function livePriceSafe(
  symbol
) {

  try {

    return await cached(
      `price:${symbol}`,
      PRICE_CACHE_MS,
      () =>
        fetchPrice(
          symbol
        )
    );

  }
  catch {

    return null;

  }
}


/* =========================================================
   CROSS MARKET
========================================================= */

async function crossContext(
  symbol
) {

  return cached(
    `cross:${symbol}`,
    CROSS_CACHE_MS,
    async () => {

      const symbols = {

        dxy:
          process.env
            .DXY_SYMBOL ||
          "DXY",

        us10y:
          process.env
            .US10Y_SYMBOL ||
          "US10Y",

        eurusd:
          "EUR/USD",

        usdjpy:
          "USD/JPY"

      };


      const [
        dxy,
        us10y,
        eurusd,
        usdjpy
      ] =
        await Promise.all([

          fetchSeriesSafe(
            symbols.dxy,
            "5min",
            70
          ),

          fetchSeriesSafe(
            symbols.us10y,
            "5min",
            70
          ),

          fetchSeriesSafe(
            symbols.eurusd,
            "5min",
            70
          ),

          fetchSeriesSafe(
            symbols.usdjpy,
            "5min",
            70
          )

        ]);


      const detail = {

        dxy:
          dxy.length
            ? seriesDirection(
                dxy
              )
            : null,

        us10y:
          us10y.length
            ? seriesDirection(
                us10y
              )
            : null,

        us2y:
          null,

        eurusd:
          eurusd.length
            ? seriesDirection(
                eurusd
              )
            : null,

        usdjpy:
          usdjpy.length
            ? seriesDirection(
                usdjpy
              )
            : null

      };


      return {

        ...crossMarketScore(
          detail
        ),

        detail,

        symbols,

        profile:
          symbol ===
          "BTC/USD"
            ? "CRYPTO_MACRO_CONTEXT"
            : "GOLD_MACRO_CONTEXT"

      };

    }
  );

}


/* =========================================================
   MACRO CALENDAR
========================================================= */

async function macroRisk() {

  return cached(
    "macro:us",
    MACRO_CACHE_MS,
    async () => {

      const key =
        process.env
          .TRADING_ECONOMICS_KEY;


      if (!key) {

        return {

          available:
            false,

          blocked:
            false,

          reason:
            "TRADING_ECONOMICS_KEY_NOT_SET",

          upcoming:
            []

        };

      }


      try {

        const url =
          new URL(
            "https://api.tradingeconomics.com/calendar/country/united%20states"
          );


        url.searchParams.set(
          "c",
          key
        );


        url.searchParams.set(
          "importance",
          "3"
        );


        url.searchParams.set(
          "f",
          "json"
        );


        const controller =
          new AbortController();


        const timeout =
          setTimeout(
            () =>
              controller.abort(),
            8000
          );


        const response =
          await fetch(
            url,
            {
              cache:
                "no-store",

              signal:
                controller.signal
            }
          );


        clearTimeout(
          timeout
        );


        if (
          !response.ok
        ) {

          throw new Error(
            `Macro HTTP ${response.status}`
          );

        }


        const raw =
          await response.json();


        const now =
          Date.now();


        const before =
          envNumber(
            "MACRO_BLOCK_MINUTES_BEFORE",
            15,
            0,
            120
          ) *
          60000;


        const after =
          envNumber(
            "MACRO_BLOCK_MINUTES_AFTER",
            5,
            0,
            120
          ) *
          60000;


        const upcoming =
          (
            Array.isArray(raw)
              ? raw
              : []
          )
            .map(
              x => ({

                event:
                  x.Event ||
                  x.Category ||
                  "US event",

                category:
                  x.Category ||
                  null,

                date:
                  x.Date ||
                  null,

                importance:
                  Number(
                    x.Importance ||
                    0
                  ),

                actual:
                  x.Actual ??
                  null,

                forecast:
                  x.Forecast ??
                  null,

                previous:
                  x.Previous ??
                  null

              })
            )
            .filter(
              x =>
                x.date &&
                Number.isFinite(
                  Date.parse(
                    x.date
                  )
                )
            )
            .filter(
              x =>
                Math.abs(
                  Date.parse(
                    x.date
                  ) -
                  now
                ) <=
                6 *
                60 *
                60 *
                1000
            )
            .sort(
              (a, b) =>
                Date.parse(
                  a.date
                ) -
                Date.parse(
                  b.date
                )
            );


        const blocking =
          upcoming.find(
            event => {

              const difference =
                Date.parse(
                  event.date
                ) -
                now;


              return (
                event.importance >=
                  3 &&
                difference <=
                  before &&
                difference >=
                  -after
              );

            }
          );


        return {

          available:
            true,

          blocked:
            Boolean(
              blocking
            ),

          blockReason:
            blocking
              ? `${blocking.event} high-impact window`
              : null,

          blockingEvent:
            blocking ||
            null,

          upcoming:
            upcoming.slice(
              0,
              8
            )

        };

      }
      catch (error) {

        return {

          available:
            false,

          blocked:
            false,

          reason:
            error?.message ||
            "MACRO_UNAVAILABLE",

          upcoming:
            []

        };

      }

    }
  );

}


/* =========================================================
   LOCAL HISTORICAL SIMILARITY
========================================================= */

function localMatches(
  candles,
  currentState
) {

  const results = [];


  const first =
    Math.max(
      70,
      candles.length -
        LOCAL_HISTORY_BARS
    );


  const last =
    candles.length -
    1 -
    FORWARD_BARS;


  for (
    let i = first;
    i <= last;
    i++
  ) {

    const slice =
      candles.slice(
        Math.max(
          0,
          i - 240
        ),
        i + 1
      );


    if (
      slice.length <
      70
    ) {
      continue;
    }


    const regime =
      detectRegime(
        slice
      );


    const components =
      basicComponentScores(
        slice
      );


    const state =
      buildFeatureState(
        slice,
        components,
        regime
      );


    if (!state) {
      continue;
    }


    const similarity =
      similarityScore(
        currentState.vector,
        state.vector,
        currentState.session,
        state.session
      );


    if (
      similarity <
      MIN_SIM
    ) {
      continue;
    }


    const futurePath =
      buildFuturePath(
        candles,
        i,
        FORWARD_BARS
      );


    if (!futurePath) {
      continue;
    }


    results.push({

      symbol:
        currentState.symbol,

      candle_time:
        state.candleTime,

      session:
        state.session,

      regime:
        state.regime,

      vector:
        state.vector,

      features:
        state.features,

      future_path:
        futurePath,

      similarity,

      source:
        "FETCHED_HISTORY"

    });

  }


  return results
    .sort(
      (a, b) =>
        b.similarity -
        a.similarity
    )
    .slice(
      0,
      TOP_K
    );

}


/* =========================================================
   PERSISTENT MEMORY
========================================================= */

function rowSymbol(
  row
) {

  const raw =
    row?.symbol ||
    row?.market_symbol ||
    row?.features?.symbol ||
    null;


  if (!raw) {
    return "XAU/USD";
  }


  return normalizeSymbol(
    raw
  );

}


function persistentMatches(
  rows,
  currentState
) {

  return rows
    .filter(
      row =>
        rowSymbol(
          row
        ) ===
        currentState.symbol
    )
    .map(
      row => ({

        ...row,

        similarity:
          similarityScore(
            currentState.vector,
            row.vector,
            currentState.session,
            row.session
          ),

        source:
          "PERSISTENT_MEMORY"

      })
    )
    .filter(
      row =>
        row.similarity >=
          MIN_SIM &&
        Array.isArray(
          row.future_path
        )
    )
    .sort(
      (a, b) =>
        b.similarity -
        a.similarity
    )
    .slice(
      0,
      TOP_K
    );

}


/* =========================================================
   MODEL AGREEMENT
========================================================= */

function modelAgreement(
  components,
  direction
) {

  const sign =
    direction ===
      "BUY"
      ? 1
      : -1;


  let total = 0;
  let aligned = 0;


  for (
    const score of
    Object.values(
      components
    )
  ) {

    const n =
      finite(
        score
      ) ??
      0;


    const magnitude =
      Math.abs(
        n
      );


    if (
      magnitude <
      5
    ) {
      continue;
    }


    total +=
      magnitude;


    if (
      Math.sign(
        n
      ) ===
      sign
    ) {

      aligned +=
        magnitude;

    }

  }


  return total >
    0
    ? aligned /
      total
    : 0.5;

}


/* =========================================================
   REGIME ALIGNMENT
========================================================= */

function regimeAlignment(
  regime,
  direction
) {

  if (
    regime ===
    "QUIET_CHOP"
  ) {
    return 15;
  }


  if (
    regime ===
    "RANGE"
  ) {
    return 45;
  }


  if (
    regime ===
    "MIXED"
  ) {
    return 55;
  }


  const bullish =
    String(
      regime
    ).startsWith(
      "BULLISH"
    );


  const bearish =
    String(
      regime
    ).startsWith(
      "BEARISH"
    );


  if (
    !bullish &&
    !bearish
  ) {
    return 50;
  }


  if (
    bullish &&
    direction ===
      "BUY"
  ) {
    return 90;
  }


  if (
    bearish &&
    direction ===
      "SELL"
  ) {
    return 90;
  }


  return 22;
}


/* =========================================================
   NORMALIZATION
========================================================= */

function percentScore(
  value
) {

  const n =
    finite(
      value
    );


  if (
    n === null
  ) {
    return 0;
  }


  /*
    Supports both:
    0.65
    65
  */

  return clamp(
    n <= 1
      ? n * 100
      : n,
    0,
    100
  );

}


/* =========================================================
   TIMEFRAME ALIGNMENT
========================================================= */

function biasDirection(
  value
) {

  const raw =
    String(
      value ||
      ""
    )
      .trim()
      .toUpperCase();


  if (
    raw.includes(
      "BULL"
    ) ||
    raw ===
      "BUY" ||
    raw ===
      "UP"
  ) {

    return "BUY";

  }


  if (
    raw.includes(
      "BEAR"
    ) ||
    raw ===
      "SELL" ||
    raw ===
      "DOWN"
  ) {

    return "SELL";

  }


  return "NEUTRAL";
}


function timeframeAgreement(
  packet,
  direction
) {

  const frames = [

    {
      name:
        "H1",

      weight:
        0.40,

      bias:
        biasDirection(
          packet.H1
            ?.bias
        )
    },

    {
      name:
        "M15",

      weight:
        0.35,

      bias:
        biasDirection(
          packet.M15
            ?.bias
        )
    },

    {
      name:
        "M5",

      weight:
        0.25,

      bias:
        biasDirection(
          packet.M5
            ?.bias
        )
    }

  ];


  let aligned = 0;
  let opposing = 0;
  let neutral = 0;


  for (
    const frame of
    frames
  ) {

    if (
      frame.bias ===
      direction
    ) {

      aligned +=
        frame.weight;

    }
    else if (
      frame.bias ===
      "NEUTRAL"
    ) {

      neutral +=
        frame.weight;

    }
    else {

      opposing +=
        frame.weight;

    }

  }


  const score =
    clamp(
      aligned +
      neutral *
        0.35,
      0,
      1
    );


  return {

    score:
      round(
        score,
        3
      ),

    alignedWeight:
      round(
        aligned,
        3
      ),

    opposingWeight:
      round(
        opposing,
        3
      ),

    neutralWeight:
      round(
        neutral,
        3
      ),

    frames

  };

}


/* =========================================================
   REGIME DIRECTION PENALTY
========================================================= */

function regimeDirectionAdjustment(
  symbol,
  regime,
  direction
) {

  const raw =
    String(
      regime ||
      ""
    )
      .toUpperCase();


  const bullish =
    raw.startsWith(
      "BULLISH"
    );


  const bearish =
    raw.startsWith(
      "BEARISH"
    );


  if (
    !bullish &&
    !bearish
  ) {

    return 0;

  }


  const aligned =
    (
      bullish &&
      direction ===
        "BUY"
    ) ||
    (
      bearish &&
      direction ===
        "SELL"
    );


  if (
    aligned
  ) {

    return 3;

  }


  return symbol ===
    "BTC/USD"
      ? -12
      : -8;
}


/* =========================================================
   ASSET / REGIME POLICY
========================================================= */

function decisionPolicy(
  symbol,
  regimeType
) {

  /*
    GOLD
  */

  if (
    symbol ===
    "XAU/USD"
  ) {

    return {

      profile:
        "GOLD_STANDARD",

      hardBlocked:
        regimeType ===
        "QUIET_CHOP",

      minEdge:
        MIN_EDGE,

      watchEdge:
        WATCH_EDGE,

      minTechnical:
        MIN_TECHNICAL,

      minAgreement:
        MIN_AGREEMENT,

      minMatches:
        MIN_MATCHES,

      minExpectancy:
        MIN_EXPECTANCY,

      minTimeframeAlignment:
        GOLD_MIN_TF_ALIGNMENT,

      regimeScoreAdjustment:
        regimeType ===
          "RANGE"
          ? -3
          : 0

    };

  }


  /*
    BTC QUIET CHOP

    Research currently shows that this environment
    produces poor walk-forward performance.

    We block rather than trying to force trades.
  */

  if (
    regimeType ===
    "QUIET_CHOP"
  ) {

    return {

      profile:
        "BTC_QUIET_CHOP_BLOCK",

      hardBlocked:
        true,

      minEdge:
        100,

      watchEdge:
        BTC_MIXED_MIN_EDGE,

      minTechnical:
        30,

      minAgreement:
        0.80,

      minMatches:
        BTC_MIN_MATCHES,

      minExpectancy:
        BTC_RANGE_MIN_EXPECTANCY,

      minTimeframeAlignment:
        0.70,

      regimeScoreAdjustment:
        -20

    };

  }


  /*
    BTC RANGE

    Requires significantly stronger evidence.
  */

  if (
    regimeType ===
    "RANGE"
  ) {

    return {

      profile:
        "BTC_STRICT_RANGE",

      hardBlocked:
        false,

      minEdge:
        BTC_RANGE_MIN_EDGE,

      watchEdge:
        Math.max(
          WATCH_EDGE,
          62
        ),

      minTechnical:
        Math.max(
          MIN_TECHNICAL,
          28
        ),

      minAgreement:
        BTC_RANGE_MIN_AGREEMENT,

      minMatches:
        Math.max(
          BTC_MIN_MATCHES,
          28
        ),

      minExpectancy:
        BTC_RANGE_MIN_EXPECTANCY,

      minTimeframeAlignment:
        0.65,

      regimeScoreAdjustment:
        -8

    };

  }


  /*
    BTC MIXED

    Still allowed because your walk-forward research
    currently shows this regime can contain useful setups.

    It still requires positive historical expectancy.
  */

  if (
    regimeType ===
    "MIXED"
  ) {

    return {

      profile:
        "BTC_MIXED",

      hardBlocked:
        false,

      minEdge:
        BTC_MIXED_MIN_EDGE,

      watchEdge:
        Math.max(
          WATCH_EDGE,
          54
        ),

      minTechnical:
        Math.max(
          MIN_TECHNICAL,
          22
        ),

      minAgreement:
        BTC_MIN_AGREEMENT,

      minMatches:
        BTC_MIN_MATCHES,

      minExpectancy:
        BTC_MIN_EXPECTANCY,

      minTimeframeAlignment:
        0.50,

      regimeScoreAdjustment:
        2

    };

  }


  /*
    BTC TREND / EXPANSION
  */

  return {

    profile:
      "BTC_DIRECTIONAL",

    hardBlocked:
      false,

    minEdge:
      BTC_TREND_MIN_EDGE,

    watchEdge:
      Math.max(
        WATCH_EDGE,
        56
      ),

    minTechnical:
      Math.max(
        MIN_TECHNICAL,
        23
      ),

    minAgreement:
      BTC_MIN_AGREEMENT,

    minMatches:
      BTC_MIN_MATCHES,

    minExpectancy:
      BTC_MIN_EXPECTANCY,

    minTimeframeAlignment:
      BTC_MIN_TF_ALIGNMENT,

    regimeScoreAdjustment:
      1

  };

}


/* =========================================================
   EDGE DECISION V12.1
========================================================= */

function buildDecision({
  symbol,
  ensemble,
  agreement,
  historical,
  regime,
  cross,
  macro,
  packet
}) {

  const direction =
    ensemble >=
      0
      ? "BUY"
      : "SELL";


  const technical =
    Math.abs(
      ensemble
    );


  const policy =
    decisionPolicy(
      symbol,
      regime.type
    );


  const timeframe =
    timeframeAgreement(
      packet,
      direction
    );


  /* -----------------------------------------------------
     SAMPLE QUALITY
  ----------------------------------------------------- */

  const sampleScore =
    clamp(
      (
        historical.matches /
        Math.max(
          policy.minMatches,
          1
        )
      ) *
        100,
      0,
      100
    );


  /* -----------------------------------------------------
     COST-ADJUSTED EXPECTANCY
  ----------------------------------------------------- */

  const rawExpectancy =
    finite(
      historical
        .expectancyR
    ) ??
    -1;


  const estimatedCostR =
    finite(
      historical
        ?.costModel
        ?.estimatedCostR
    ) ??
    0;


  const netExpectancy =
    rawExpectancy -
    estimatedCostR;


  const expectancyScore =
    clamp(
      50 +
      netExpectancy *
        55,
      0,
      100
    );


  /* -----------------------------------------------------
     NORMALIZED HISTORY
  ----------------------------------------------------- */

  const hitRate =
    percentScore(
      historical
        .targetHitRate
    );


  const averageSimilarity =
    percentScore(
      historical
        .averageSimilarity
    );


  const historicalScore =
    clamp(

      hitRate *
        0.34 +

      averageSimilarity *
        0.22 +

      sampleScore *
        0.20 +

      expectancyScore *
        0.24,

      0,
      100
    );


  /* -----------------------------------------------------
     CROSS MARKET
  ----------------------------------------------------- */

  const crossAlignment =
    !cross.available
      ? 50
      : cross.direction ===
        "NEUTRAL"
        ? 50
        : cross.direction ===
          direction
          ? 85
          : 25;


  /* -----------------------------------------------------
     REGIME
  ----------------------------------------------------- */

  const regimeScore =
    regimeAlignment(
      regime.type,
      direction
    );


  const directionAdjustment =
    regimeDirectionAdjustment(
      symbol,
      regime.type,
      direction
    );


  /*
    BTC:
      less dependence on DXY / yields correlation.

    GOLD:
      cross-market relationships receive slightly
      more weight.
  */

  const weights =
    symbol ===
      "BTC/USD"
      ? {

          technical:
            0.27,

          agreement:
            0.15,

          historical:
            0.27,

          regime:
            0.10,

          cross:
            0.04,

          regimeConfidence:
            0.07,

          timeframe:
            0.10

        }
      : {

          technical:
            0.27,

          agreement:
            0.15,

          historical:
            0.25,

          regime:
            0.10,

          cross:
            0.06,

          regimeConfidence:
            0.07,

          timeframe:
            0.10

        };


  let edgeScore =

    technical *
      weights.technical +

    agreement *
      100 *
      weights.agreement +

    historicalScore *
      weights.historical +

    regimeScore *
      weights.regime +

    crossAlignment *
      weights.cross +

    (
      regime.confidence ??
      50
    ) *
      weights.regimeConfidence +

    timeframe.score *
      100 *
      weights.timeframe;


  edgeScore +=
    policy
      .regimeScoreAdjustment;


  edgeScore +=
    directionAdjustment;


  edgeScore =
    clamp(
      edgeScore,
      0,
      100
    );


  /* -----------------------------------------------------
     QUALIFICATION GATES
  ----------------------------------------------------- */

  const gates = {

    assetRegimeAllowed:
      !policy.hardBlocked,

    technicalStrength:
      technical >=
      policy.minTechnical,

    modelAgreement:
      agreement >=
      policy.minAgreement,

    timeframeAgreement:
      timeframe.score >=
      policy
        .minTimeframeAlignment,

    historicalSample:
      historical.matches >=
      policy.minMatches,

    historicalExpectancy:
      netExpectancy >=
      policy.minExpectancy,

    macroWindowClear:
      !macro.blocked,

    edgeScore:
      edgeScore >=
      policy.minEdge

  };


  const failed =
    Object.entries(
      gates
    )
      .filter(
        ([, passed]) =>
          !passed
      )
      .map(
        ([key]) =>
          key
      );


  const qualified =
    failed.length ===
    0;


  let signal =
    "WAIT";


  if (
    qualified
  ) {

    signal =
      direction;

  }
  else if (
    !policy.hardBlocked &&
    edgeScore >=
      policy.watchEdge
  ) {

    signal =
      "WATCH";

  }


  return {

    signal,

    candidateDirection:
      direction,

    qualified,

    edgeScore:
      round(
        edgeScore,
        1
      ),

    technicalStrength:
      round(
        technical,
        1
      ),

    modelAgreement:
      round(
        agreement,
        3
      ),

    timeframeAgreement:
      timeframe,

    historicalScore:
      round(
        historicalScore,
        1
      ),

    rawHistoricalExpectancyR:
      round(
        rawExpectancy,
        3
      ),

    estimatedCostR:
      round(
        estimatedCostR,
        3
      ),

    netHistoricalExpectancyR:
      round(
        netExpectancy,
        3
      ),

    historicalHitRate:
      round(
        hitRate,
        1
      ),

    historicalAverageSimilarity:
      round(
        averageSimilarity,
        1
      ),

    crossAlignment:
      round(
        crossAlignment,
        1
      ),

    regimeAlignment:
      round(
        regimeScore,
        1
      ),

    regimeDirectionAdjustment:
      directionAdjustment,

    policy,

    weights,

    gates,

    failedGates:
      failed,

    thresholds: {

      minEdgeScore:
        policy.minEdge,

      watchEdgeScore:
        policy.watchEdge,

      minTechnicalScore:
        policy.minTechnical,

      minModelAgreement:
        policy.minAgreement,

      minTimeframeAlignment:
        policy
          .minTimeframeAlignment,

      minHistoricalMatches:
        policy.minMatches,

      minExpectancyR:
        policy.minExpectancy

    }

  };

}


/* =========================================================
   TRADE PLAN
========================================================= */

function createTradePlan(
  direction,
  entry,
  packet,
  m5Atr,
  optimized,
  precision
) {

  const stopAtr =
    finite(
      optimized
        ?.stopAtr
    ) ??
    1;


  const targetR =
    finite(
      optimized
        ?.targetR
    ) ??
    1.2;


  let risk =
    m5Atr *
    stopAtr;


  const swingLow =
    finite(
      packet.M1
        ?.ict
        ?.lastSwingLow
    );


  const swingHigh =
    finite(
      packet.M1
        ?.ict
        ?.lastSwingHigh
    );


  /*
    BUY:
    Prefer recent swing low when it produces
    a reasonable ATR-based stop.
  */

  if (
    direction ===
      "BUY" &&
    swingLow !==
      null &&
    swingLow <
      entry
  ) {

    const swingRisk =
      entry -
      swingLow +
      m5Atr *
        0.08;


    if (
      swingRisk >=
        risk *
        0.55 &&
      swingRisk <=
        risk *
        1.35
    ) {

      risk =
        swingRisk;

    }

  }


  /*
    SELL:
    Prefer recent swing high when appropriate.
  */

  if (
    direction ===
      "SELL" &&
    swingHigh !==
      null &&
    swingHigh >
      entry
  ) {

    const swingRisk =
      swingHigh -
      entry +
      m5Atr *
        0.08;


    if (
      swingRisk >=
        risk *
        0.55 &&
      swingRisk <=
        risk *
        1.35
    ) {

      risk =
        swingRisk;

    }

  }


  risk =
    clamp(
      risk,
      m5Atr *
        0.55,
      m5Atr *
        1.65
    );


  const sign =
    direction ===
      "BUY"
      ? 1
      : -1;


  const tp2R =
    clamp(
      Math.max(
        targetR +
          0.45,
        targetR *
          1.35
      ),
      targetR +
        0.25,
      3.5
    );


  return {

    direction,

    entry:
      round(
        entry,
        precision
      ),

    stopLoss:
      round(
        entry -
        sign *
          risk,
        precision
      ),

    takeProfit:
      round(
        entry +
        sign *
          risk *
          targetR,
        precision
      ),

    takeProfit2:
      round(
        entry +
        sign *
          risk *
          tp2R,
        precision
      ),

    riskDistance:
      round(
        risk,
        precision
      ),

    stopAtr:
      round(
        risk /
        m5Atr,
        2
      ),

    targetR:
      round(
        targetR,
        2
      ),

    targetR2:
      round(
        tp2R,
        2
      ),

    riskReward:
      `1:${round(
        targetR,
        2
      )}`,

    riskReward2:
      `1:${round(
        tp2R,
        2
      )}`

  };

}


/* =========================================================
   MAIN API
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
    "Access-Control-Allow-Headers",
    "Content-Type"
  );


  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
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
    ![
      "GET",
      "POST"
    ].includes(
      req.method
    )
  ) {

    return send(
      res,
      405,
      {
        success:
          false,

        error:
          "Use GET or POST."
      }
    );

  }


  try {

    /* =====================================================
       REQUEST
    ===================================================== */

    const body =
      bodyOf(
        req
      );


    const requested =
      body.symbol ||
      queryValue(
        req,
        "symbol"
      ) ||
      "XAU/USD";


    const symbol =
      normalizeSymbol(
        requested
      );


    if (
      !symbol
    ) {

      return send(
        res,
        400,
        {

          success:
            false,

          error:
            "Unsupported symbol.",

          supportedSymbols: [
            "XAU/USD",
            "BTC/USD"
          ]

        }
      );

    }


    const asset =
      ASSETS[
        symbol
      ];


    /* =====================================================
       ESSENTIAL MARKET DATA
    ===================================================== */

    const [
      rawM1,
      rawH1,
      livePriceResult
    ] =
      await Promise.all([

        cached(
          `series:${symbol}:1min:${M1_OUTPUT}`,
          SERIES_CACHE_MS,
          () =>
            fetchSeries(
              symbol,
              "1min",
              M1_OUTPUT
            )
        ),

        cached(
          `series:${symbol}:1h:${H1_OUTPUT}`,
          H1_CACHE_MS,
          () =>
            fetchSeries(
              symbol,
              "1h",
              H1_OUTPUT
            )
        ),

        livePriceSafe(
          symbol
        )

      ]);


    /* =====================================================
       SECONDARY CONTEXT
    ===================================================== */

    const [
      cross,
      macro
    ] =
      await Promise.all([

        crossContext(
          symbol
        ),

        macroRisk()

      ]);


    /* =====================================================
       COMPLETED CANDLES ONLY
    ===================================================== */

    const m1 =
      completed(
        rawM1,
        1
      );


    const h1 =
      completed(
        rawH1,
        60
      );


    const m5 =
      resample(
        m1,
        5
      );


    const m15 =
      resample(
        m1,
        15
      );


    if (
      m1.length <
        500 ||
      m5.length <
        90 ||
      m15.length <
        45 ||
      h1.length <
        50
    ) {

      throw new Error(
        `Not enough completed ${symbol} market data.`
      );

    }


    /* =====================================================
       DATA FRESHNESS
    ===================================================== */

    const lastM1 =
      m1.at(
        -1
      );


    const lastCandleEnd =
      parseUTC(
        lastM1.t
      ) +
      60000;


    const dataAge =
      Math.max(
        0,
        Date.now() -
          lastCandleEnd
      );


    const schedule =
      marketOpen(
        symbol
      );


    const dataStale =
      dataAge >
      STALE_MS;


    const referencePrice =
      finite(
        livePriceResult
      ) ??
      finite(
        lastM1.c
      );


    if (
      referencePrice ===
      null
    ) {

      throw new Error(
        `${symbol} reference price unavailable.`
      );

    }


    /* =====================================================
       MULTI-TIMEFRAME PACKET
    ===================================================== */

    const packet = {

      lastM1,

      session:
        sessionFor(
          parseUTC(
            lastM1.t
          )
        ),

      M1:
        snapshot(
          m1
        ),

      M5:
        snapshot(
          m5
        ),

      M15:
        snapshot(
          m15
        ),

      H1:
        snapshot(
          h1
        )

    };


    /*
      Existing goldContext() provides session,
      liquidity and day context.

      It is also useful for BTC despite the old
      function name.
    */

    packet.gold =
      goldContext(
        packet,
        m1
      );


    /* =====================================================
       REGIME
    ===================================================== */

    const regime =
      detectRegime(
        m5
      );


    /* =====================================================
       TECHNICAL COMPONENTS
    ===================================================== */

    const technical =
      scoreTechnical(
        packet
      );


    const components = {

      ...technical,

      breakout:
        breakoutScore(
          m5
        ),

      meanReversion:
        meanReversionScore(
          m5
        ),

      cross:
        (
          finite(
            cross.score
          ) ??
          0
        ) *
        asset.crossWeight

    };


    /* =====================================================
       MARKET FINGERPRINT
    ===================================================== */

    const currentState =
      buildFeatureState(
        m5,
        components,
        regime
      );


    if (
      !currentState
    ) {

      throw new Error(
        "Could not create market fingerprint."
      );

    }


    currentState.symbol =
      symbol;


    currentState.assetType =
      asset.type;


    if (
      currentState.features
    ) {

      currentState.features.symbol =
        symbol;


      currentState.features.assetType =
        asset.type;

    }


    /* =====================================================
       STORE CURRENT STATE
    ===================================================== */

    if (
      dbEnabled()
    ) {

      await upsertMarketState(
        currentState
      )
        .catch(
          error =>
            console.error(
              "Memory write:",
              error.message
            )
        );

    }


    /* =====================================================
       HISTORICAL MEMORY
    ===================================================== */

    let matches = [];


    let memorySource =
      "FETCHED_HISTORY";


    if (
      dbEnabled()
    ) {

      const rows =
        await loadResolvedStates({

          regime:
            regime.type,

          limit:
            1200

        })
          .catch(
            () => []
          );


      matches =
        persistentMatches(
          rows,
          currentState
        );


      if (
        matches.length >=
        MIN_MATCHES
      ) {

        memorySource =
          "PERSISTENT_MEMORY";

      }

    }


    /*
      Fall back to fetched historical candles if
      persistent memory is too small.
    */

    if (
      matches.length <
      MIN_MATCHES
    ) {

      matches =
        localMatches(
          m5,
          currentState
        );


      memorySource =
        "FETCHED_HISTORY";

    }


    /* =====================================================
       ADAPTIVE ENSEMBLE
    ===================================================== */

    const reliability =
      adaptiveReliability(
        matches
      );


    const ensemble =
      ensembleScore(
        components,
        regime.type,
        reliability
      );


    const direction =
      ensemble >=
        0
        ? "BUY"
        : "SELL";


    /* =====================================================
       OPTIMIZED SL / TP
    ===================================================== */

    const optimized =
      optimizeRiskReward(
        matches,
        direction
      ) || {

        stopAtr:
          1,

        targetR:
          1.2,

        expectancy:
          null,

        winRate:
          null,

        sample:
          0

      };


    /* =====================================================
       HISTORICAL STATS
    ===================================================== */

    const historical =
      historicalStats(
        matches,
        direction,
        optimized.stopAtr,
        optimized.targetR
      );


    historical.averageSimilarity =
      matches.length
        ? round(
            mean(
              matches.map(
                x =>
                  finite(
                    x.similarity
                  ) ??
                  0
              )
            ),
            1
          )
        : 0;


    historical.source =
      memorySource;


    historical.optimizedRisk =
      optimized;


    historical.costModel = {

      estimatedCostAtr:
        ESTIMATED_COST_ATR,

      estimatedCostR:
        round(
          ESTIMATED_COST_ATR /
          Math.max(
            finite(
              optimized.stopAtr
            ) ??
            1,
            0.01
          ),
          3
        )

    };


    historical.netExpectancyR =
      round(
        (
          finite(
            historical
              .expectancyR
          ) ??
          -1
        ) -
        historical
          .costModel
          .estimatedCostR,
        3
      );


    /* =====================================================
       MODEL AGREEMENT
    ===================================================== */

    const agreement =
      modelAgreement(
        components,
        direction
      );


    /* =====================================================
       EDGE DECISION
    ===================================================== */

    const decision =
      buildDecision({

        symbol,

        ensemble,

        agreement,

        historical,

        regime,

        cross,

        macro,

        packet

      });


    /* =====================================================
       MARKET SAFETY
    ===================================================== */

    decision.gates.marketOpen =
      schedule.open;


    decision.gates.freshMarketData =
      !dataStale;


    if (
      !schedule.open
    ) {

      decision.failedGates =
        [
          ...new Set([
            ...decision.failedGates,
            "marketOpen"
          ])
        ];


      decision.qualified =
        false;


      decision.signal =
        "WAIT";

    }


    if (
      dataStale
    ) {

      decision.failedGates =
        [
          ...new Set([
            ...decision.failedGates,
            "freshMarketData"
          ])
        ];


      decision.qualified =
        false;


      decision.signal =
        "WAIT";

    }


    /* =====================================================
       ATR
    ===================================================== */

    const m5Atr =
      finite(
        packet.M5
          ?.indicators
          ?.atr14
      );


    if (
      m5Atr ===
        null ||
      m5Atr <=
        0
    ) {

      throw new Error(
        "M5 ATR unavailable."
      );

    }


    /* =====================================================
       ENTRY CHASE PROTECTION
    ===================================================== */

    const completedPrice =
      finite(
        lastM1.c
      );


    const chaseDistance =
      completedPrice !==
        null
        ? Math.abs(
            referencePrice -
            completedPrice
          )
        : 0;


    const chaseAtr =
      m5Atr >
        0
        ? chaseDistance /
          m5Atr
        : 0;


    const chasePassed =
      chaseAtr <=
      MAX_CHASE_ATR;


    decision.gates.entryNotChased =
      chasePassed;


    if (
      !chasePassed
    ) {

      decision.failedGates =
        [
          ...new Set([
            ...decision.failedGates,
            "entryNotChased"
          ])
        ];


      decision.qualified =
        false;


      decision.signal =
        "WAIT";

    }


    /* =====================================================
       SETUP TYPE
    ===================================================== */

    const setupType =
      inferSetup(
        packet,
        regime,
        components,
        decision
          .candidateDirection
      );


    /* =====================================================
       TRADE PLAN
    ===================================================== */

    const plan =
      decision.qualified
        ? createTradePlan(
            direction,
            referencePrice,
            packet,
            m5Atr,
            optimized,
            asset.precision
          )
        : null;


    /* =====================================================
       ACCOUNT RISK
    ===================================================== */

    const equity =
      Math.max(
        1,
        finite(
          body.equity
        ) ??
        DEFAULT_EQUITY
      );


    const account = {

      equityZAR:
        round(
          equity,
          2
        ),

      riskPercent:
        RISK_PERCENT,

      maxRiskZAR:
        round(
          equity *
          RISK_PERCENT /
          100,
          2
        )

    };


    /* =====================================================
       SIGNAL ID
    ===================================================== */

    const created =
      Date.now();


    const signalId =
      `MKV121-${asset.code}-${created}-${direction}`;


    /* =====================================================
       MEMORY STATUS
    ===================================================== */

    const memory =
      dbEnabled()
        ? await memoryCount()
            .catch(
              () => ({
                total: 0,
                resolved: 0
              })
            )
        : {

            total:
              0,

            resolved:
              0

          };


    /* =====================================================
       EXECUTION STATE
    ===================================================== */

    let executionState =
      decision.signal;


    if (
      !schedule.open
    ) {

      executionState =
        "MARKET_CLOSED";

    }
    else if (
      dataStale
    ) {

      executionState =
        "STALE_DATA";

    }
    else if (
      !chasePassed
    ) {

      executionState =
        "PRICE_CHASED";

    }
    else if (
      decision.qualified
    ) {

      executionState =
        "QUALIFIED_NOT_ENTERED";

    }


    /* =====================================================
       RESPONSE
    ===================================================== */

    const response = {

      success:
        true,

      model:
        "MKAYFX MULTI-ASSET QUANT EDGE V12.1",

      version:
        12.1,

      supportedSymbols: [
        "XAU/USD",
        "BTC/USD"
      ],

      signalId,

      symbol,

      asset: {

        code:
          asset.code,

        name:
          asset.name,

        type:
          asset.type,

        trades247:
          asset.trades247

      },


      /* ---------------------------------------------------
         SIGNAL
      --------------------------------------------------- */

      signal:
        decision.signal,

      candidateDirection:
        direction,

      tradeQualified:
        decision.qualified,

      locked:
        false,

      setupType,


      /* ---------------------------------------------------
         TIME
      --------------------------------------------------- */

      createdAt:
        new Date(
          created
        ).toISOString(),

      session:
        packet.session,


      /* ---------------------------------------------------
         EDGE
      --------------------------------------------------- */

      edgeScore:
        decision.edgeScore,

      edgeType:
        "EDGE_SCORE_NOT_GUARANTEED_PROBABILITY",


      /* ---------------------------------------------------
         MARKET STATUS
      --------------------------------------------------- */

      marketStatus: {

        open:
          schedule.open,

        reason:
          schedule.reason,

        dataStale,

        lastCompletedCandle:
          lastM1.t,

        dataAgeMinutes:
          round(
            dataAge /
            60000,
            1
          ),

        priceSource:
          livePriceResult !==
            null
            ? "LIVE_PRICE_ENDPOINT"
            : "LAST_COMPLETED_CANDLE"

      },


      /* ---------------------------------------------------
         PRICE
      --------------------------------------------------- */

      currentPrice:
        round(
          referencePrice,
          asset.precision
        ),

      completedCandlePrice:
        round(
          completedPrice,
          asset.precision
        ),


      /* ---------------------------------------------------
         TRADE LEVELS
      --------------------------------------------------- */

      entry:
        plan?.entry ??
        round(
          referencePrice,
          asset.precision
        ),

      stopLoss:
        plan?.stopLoss ??
        null,

      takeProfit:
        plan?.takeProfit ??
        null,

      takeProfit2:
        plan?.takeProfit2 ??
        null,

      riskReward:
        plan?.riskReward ??
        null,

      riskReward2:
        plan?.riskReward2 ??
        null,

      riskDistance:
        plan?.riskDistance ??
        null,


      /* ---------------------------------------------------
         REGIME
      --------------------------------------------------- */

      marketRegime:
        regime,

      regimePolicy:
        decision.policy,


      /* ---------------------------------------------------
         ENSEMBLE
      --------------------------------------------------- */

      ensemble: {

        signedScore:
          round(
            ensemble,
            1
          ),

        direction,

        components,

        adaptiveReliability:
          reliability

      },


      /* ---------------------------------------------------
         EDGE DECISION
      --------------------------------------------------- */

      edgeDecision:
        decision,


      /* ---------------------------------------------------
         HISTORICAL
      --------------------------------------------------- */

      historicalEdge:
        historical,


      /* ---------------------------------------------------
         CROSS MARKET
      --------------------------------------------------- */

      crossMarket:
        cross,


      /* ---------------------------------------------------
         MACRO
      --------------------------------------------------- */

      macroRisk:
        macro,


      /* ---------------------------------------------------
         EXECUTION
      --------------------------------------------------- */

      execution: {

        state:
          executionState,

        referenceAtr:
          round(
            m5Atr,
            5
          ),

        maxChaseAtr:
          MAX_CHASE_ATR,

        currentChaseAtr:
          round(
            chaseAtr,
            3
          ),

        chaseDistance:
          round(
            chaseDistance,
            asset.precision
          ),

        entryChasePassed:
          chasePassed,

        freshUntil:
          new Date(
            created +
            FRESH_MINUTES *
              60000
          ).toISOString(),

        expiresAt:
          new Date(
            created +
            EXPIRE_MINUTES *
              60000
          ).toISOString(),

        rule:
          "Manual execution only."

      },


      /* ---------------------------------------------------
         TIMEFRAME BIAS
      --------------------------------------------------- */

      timeframeBias: {

        M1:
          packet.M1.bias,

        M5:
          packet.M5.bias,

        M15:
          packet.M15.bias,

        H1:
          packet.H1.bias,

        agreement:
          decision
            .timeframeAgreement

      },


      /* ---------------------------------------------------
         STRUCTURE
      --------------------------------------------------- */

      structure: {

        M1:
          packet.M1
            .structure,

        M1_BOS:
          packet.M1
            ?.ict
            ?.bos ??
          null,

        M1_CHOCH:
          packet.M1
            ?.ict
            ?.choch ??
          null,

        M5:
          packet.M5
            .structure,

        M5_BOS:
          packet.M5
            ?.ict
            ?.bos ??
          null,

        M5_CHOCH:
          packet.M5
            ?.ict
            ?.choch ??
          null,

        M15:
          packet.M15
            .structure,

        M15_BOS:
          packet.M15
            ?.ict
            ?.bos ??
          null,

        H1:
          packet.H1
            .structure

      },


      /* ---------------------------------------------------
         CONTEXT
      --------------------------------------------------- */

      marketContext:
        packet.gold,

      goldContext:
        symbol ===
          "XAU/USD"
          ? packet.gold
          : null,


      /* ---------------------------------------------------
         TECHNICAL EXPLANATION
      --------------------------------------------------- */

      technical: {

        componentScores:
          technical,

        allComponents:
          components,

        reasons: [

          `${asset.name} regime ${regime.type} (${regime.confidence ?? 0}% confidence).`,

          `Policy ${decision.policy.profile}.`,

          `Candidate ${direction} with edge ${decision.edgeScore}.`,

          `H1 ${packet.H1.bias}, M15 ${packet.M15.bias}, M5 ${packet.M5.bias}, M1 ${packet.M1.bias}.`,

          `Timeframe agreement ${round(
            decision.timeframeAgreement.score * 100,
            1
          )}%.`,

          `Model agreement ${round(
            decision.modelAgreement * 100,
            1
          )}%.`,

          `M1 structure ${packet.M1.structure}, ${packet.M1?.ict?.bos ?? "NO_BOS"}, ${packet.M1?.ict?.choch ?? "NO_CHOCH"}.`,

          ...(
            Array.isArray(
              packet.gold
                ?.signals
            )
              ? packet.gold.signals
              : []
          ),

          cross.available
            ? `Cross-market ${cross.direction} (${cross.score}).`
            : "Cross-market feeds unavailable.",

          historical.matches
            ? `${historical.matches} similar states, raw expectancy ${historical.expectancyR}R, net expectancy ${historical.netExpectancyR}R.`
            : "Historical sample unavailable.",

          `Historical similarity ${historical.averageSimilarity}%.`,

          `Optimized stop ${round(
            finite(
              optimized.stopAtr
            ) ?? 1,
            2
          )} ATR and target ${round(
            finite(
              optimized.targetR
            ) ?? 1.2,
            2
          )}R.`,

          macro.blocked
            ? `Macro block: ${macro.blockReason}.`
            : "No active high-impact macro block.",

          !schedule.open
            ? `${asset.name} market currently closed.`
            : `${asset.name} market currently open.`,

          dataStale
            ? `Latest completed data is ${round(
                dataAge /
                60000,
                1
              )} minutes old.`
            : "Market data freshness check passed.",

          chasePassed
            ? `Entry chase check passed at ${round(
                chaseAtr,
                3
              )} ATR.`
            : `Trade rejected because live price moved ${round(
                chaseAtr,
                3
              )} ATR from the completed candle.`,

          decision.failedGates.length
            ? `Failed gates: ${decision.failedGates.join(", ")}.`
            : "All trade qualification gates passed."

        ]

      },


      /* ---------------------------------------------------
         ACCOUNT
      --------------------------------------------------- */

      account,


      /* ---------------------------------------------------
         MEMORY
      --------------------------------------------------- */

      memory: {

        enabled:
          dbEnabled(),

        totalStates:
          memory.total,

        resolvedStates:
          memory.resolved,

        sourceUsed:
          memorySource,

        currentMatches:
          matches.length

      },


      /* ---------------------------------------------------
         CHART
      --------------------------------------------------- */

      chart:
        m1
          .slice(
            -180
          )
          .map(
            candle => ({

              t:
                candle.t,

              o:
                round(
                  candle.o,
                  asset.precision
                ),

              h:
                round(
                  candle.h,
                  asset.precision
                ),

              l:
                round(
                  candle.l,
                  asset.precision
                ),

              c:
                round(
                  candle.c,
                  asset.precision
                )

            })
          ),


      /* ---------------------------------------------------
         DATA QUALITY
      --------------------------------------------------- */

      dataQuality: {

        completedM1:
          m1.length,

        completedM5:
          m5.length,

        completedM15:
          m15.length,

        completedH1:
          h1.length,

        staleMilliseconds:
          dataAge,

        staleMinutes:
          round(
            dataAge /
            60000,
            2
          ),

        cacheEnabled:
          true,

        livePriceAvailable:
          livePriceResult !==
            null,

        historicalMatches:
          matches.length

      }

    };


    /* =====================================================
       SAVE SIGNAL
    ===================================================== */

    if (
      dbEnabled()
    ) {

      await saveSignalRecord(
        response
      )
        .catch(
          error =>
            console.error(
              "Save signal:",
              error.message
            )
        );

    }


    return send(
      res,
      200,
      response
    );

  }
  catch (error) {

    console.error(
      "MKAYFX V12.1:",
      error
    );


    return send(
      res,
      500,
      {

        success:
          false,

        model:
          "MKAYFX MULTI-ASSET QUANT EDGE V12.1",

        version:
          12.1,

        error:
          error?.message ||
          "Analysis failed.",

        supportedSymbols: [
          "XAU/USD",
          "BTC/USD"
        ]

      }
    );

  }

}