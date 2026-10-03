import {
  envNumber,
  completed,
  fetchSeries,
  resample,
  detectRegime,
  simpleTrendPullbackStrategy,
  buildFuturePath
} from "./core.js";


import {
  dbEnabled,
  bulkUpsertStates,
  memoryCount
} from "./db.js";


/* =========================================================
   MKAYFX V14 STRATEGY MEMORY
========================================================= */

const VERSION =
  "14.0";


const SUPPORTED_SYMBOLS =
  new Set([
    "XAU/USD",
    "BTC/USD"
  ]);


const FORWARD_BARS =
  Math.round(
    envNumber(
      "HISTORICAL_FORWARD_BARS",
      24,
      12,
      48
    )
  );


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


/* =========================================================
   AUTH
========================================================= */

function authorized(
  req,
  backfill
) {

  const supplied =
    req.headers
      .authorization;


  if (
    backfill
  ) {

    const secret =
      process.env
        .ADMIN_SECRET;


    if (!secret) {
      return false;
    }


    return supplied ===
      `Bearer ${secret}`;

  }


  const cronSecret =
    process.env
      .CRON_SECRET;


  if (!cronSecret) {
    return true;
  }


  return supplied ===
    `Bearer ${cronSecret}`;
}


/* =========================================================
   TIME SLICE
========================================================= */

function candlesUntil(
  candles,
  timestamp
) {

  return candles.filter(
    candle =>
      Date.parse(
        candle.t
      ) <=
      timestamp
  );
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
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
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

    return res
      .status(405)
      .json({

        success:false,

        version:
          VERSION,

        error:
          "Use GET or POST."

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
    !symbol ||
    !SUPPORTED_SYMBOLS.has(
      symbol
    )
  ) {

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

        memoryEnabled:false,

        error:
          "DATABASE_URL is not set."

      });

  }


  const backfill =
    String(
      queryValue(
        req,
        "mode"
      ) ||
      ""
    )
      .toLowerCase() ===
    "backfill";


  if (
    !authorized(
      req,
      backfill
    )
  ) {

    return res
      .status(401)
      .json({

        success:false,

        version:
          VERSION,

        symbol,

        error:
          backfill
            ? "Unauthorized. Check ADMIN_SECRET."
            : "Unauthorized."

      });

  }


  try {

    const barsRaw =
      Number(
        queryValue(
          req,
          "bars"
        )
      );


    const requested =
      backfill
        ? Math.round(
            Math.max(
              1000,
              Math.min(
                4500,
                Number.isFinite(
                  barsRaw
                )
                  ? barsRaw
                  : 3500
              )
            )
          )
        : 2600;


    /*
      Need enough history for:
      H1 EMA200 = roughly 2400 M5 candles.

      Therefore we fetch up to 5000 M5 candles.
    */

    const output =
      Math.min(
        5000,
        Math.max(
          requested +
          FORWARD_BARS +
          100,
          2800
        )
      );


    const raw =
      await fetchSeries(
        symbol,
        "5min",
        output
      );


    const m5 =
      completed(
        raw,
        5
      );


    if (
      m5.length <
      2500
    ) {

      throw new Error(
        `Need at least 2500 completed ${symbol} M5 candles for V14 memory.`
      );

    }


    const m15All =
      resample(
        m5,
        15
      );


    const h1All =
      resample(
        m5,
        60
      );


    const states =
      [];


    /*
      Earliest index must have enough history
      to create 200 H1 candles.

      200 H1 candles ≈ 2400 M5 candles.
    */

    const minimumIndex =
      2400;


    const requestedStart =
      Math.max(
        minimumIndex,
        m5.length -
          requested -
          FORWARD_BARS
      );


    const lastResolvable =
      m5.length -
      1 -
      FORWARD_BARS;


    for (
      let i =
        requestedStart;

      i <=
        lastResolvable;

      i++
    ) {

      const currentTime =
        Date.parse(
          m5[i].t
        );


      if (
        !Number.isFinite(
          currentTime
        )
      ) {
        continue;
      }


      const m5Slice =
        m5.slice(
          0,
          i + 1
        );


      const m15Slice =
        candlesUntil(
          m15All,
          currentTime
        );


      const h1Slice =
        candlesUntil(
          h1All,
          currentTime
        );


      if (
        m15Slice.length <
          210 ||
        h1Slice.length <
          210
      ) {

        continue;

      }


      const strategy =
        simpleTrendPullbackStrategy({

          m5:
            m5Slice,

          m15:
            m15Slice,

          h1:
            h1Slice

        });


      const futurePath =
        buildFuturePath(
          m5,
          i,
          FORWARD_BARS
        );


      if (
        !futurePath
      ) {
        continue;
      }


      const regime =
        detectRegime(
          m5Slice
        );


      states.push({

        symbol,

        timeframe:
          "5min",

        candleTime:
          m5[i].t,

        session:
          null,

        regime:
          regime.type,

        /*
          Keep vector for database compatibility.

          V14 does NOT use similarity matching.
        */

        vector:[
          strategy.signal ===
            "BUY"
            ? 1
            : strategy.signal ===
              "SELL"
              ? -1
              : 0,

          strategy.score ||
          0

        ],

        features:{

          symbol,

          engineVersion:
            VERSION,

          strategyName:
            "TREND_PULLBACK_V14",

          strategySignal:
            strategy.signal,

          strategyDirection:
            strategy.direction,

          strategyQualified:
            strategy.qualified,

          strategyScore:
            strategy.score,

          strategyChecks:
            strategy.checks,

          buyChecks:
            strategy.buyChecks,

          sellChecks:
            strategy.sellChecks,

          indicators:
            strategy.indicators,

          reasons:
            strategy.reasons

        },

        futurePath

      });

    }


    let processed =
      0;


    for (
      let i = 0;
      i <
        states.length;
      i += 150
    ) {

      processed +=
        await bulkUpsertStates(
          states.slice(
            i,
            i + 150
          )
        );

    }


    const count =
      await memoryCount(
        symbol
      );


    return res
      .status(200)
      .json({

        success:true,

        version:
          VERSION,

        engine:
          "TREND_PULLBACK_V14",

        symbol,

        memoryEnabled:true,

        mode:
          backfill
            ? "BACKFILL"
            : "UPDATE",

        requested,

        processed,

        generatedStates:
          states.length,

        qualifiedSetups:
          states.filter(
            state =>
              state.features
                ?.strategyQualified
          ).length,

        buys:
          states.filter(
            state =>
              state.features
                ?.strategySignal ===
              "BUY"
          ).length,

        sells:
          states.filter(
            state =>
              state.features
                ?.strategySignal ===
              "SELL"
          ).length,

        total:
          count.total,

        resolved:
          count.resolved,

        oldest:
          states[0]
            ?.candleTime ||
          null,

        newest:
          states.at(-1)
            ?.candleTime ||
          null

      });

  }
  catch(error) {

    console.error(
      `MEMORY V14 ${symbol}:`,
      error
    );


    return res
      .status(500)
      .json({

        success:false,

        version:
          VERSION,

        symbol,

        error:
          error?.message ||
          `${symbol} V14 memory update failed.`

      });

  }
}