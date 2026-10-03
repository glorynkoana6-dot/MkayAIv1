import {
  envNumber,
  completed,
  fetchSeries,
  detectRegime,
  basicComponentScores,
  buildFeatureState,
  buildFuturePath
} from "./core.js";


import {
  dbEnabled,
  bulkUpsertStates,
  memoryCount
} from "./db.js";


/* =========================================================
   SUPPORTED MARKETS
========================================================= */

const SUPPORTED_SYMBOLS =
  new Set([
    "XAU/USD",
    "BTC/USD"
  ]);


/* =========================================================
   SETTINGS
========================================================= */

const FORWARD_BARS =
  Math.round(
    envNumber(
      "HISTORICAL_FORWARD_BARS",
      12,
      6,
      36
    )
  );


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


function queryValue(
  req,
  key
) {

  const value =
    req.query?.[key];


  if (
    Array.isArray(
      value
    )
  ) {

    return value[0];

  }


  return value;
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
    "GET, POST, OPTIONS"
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
        error:"Use GET or POST."
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
    ).toLowerCase() ===
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
              300,
              Math.min(
                4500,
                Number.isFinite(
                  barsRaw
                )
                  ? barsRaw
                  : 1800
              )
            )
          )
        : 420;


    const output =
      Math.min(
        5000,
        requested +
        FORWARD_BARS +
        120
      );


    const raw =
      await fetchSeries(
        symbol,
        "5min",
        output
      );


    const candles =
      completed(
        raw,
        5
      );


    if (
      candles.length <
      100
    ) {

      throw new Error(
        `Not enough completed ${symbol} M5 data.`
      );

    }


    const start =
      Math.max(
        70,
        candles.length -
          requested -
          FORWARD_BARS
      );


    const states =
      [];


    for (
      let i =
        start;

      i <
        candles.length;

      i++
    ) {

      const slice =
        candles.slice(
          Math.max(
            0,
            i -
              240
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


      const futurePath =
        i <=
        candles.length -
          1 -
          FORWARD_BARS

          ? buildFuturePath(
              candles,
              i,
              FORWARD_BARS
            )

          : null;


      states.push({

        symbol,

        timeframe:
          "5min",

        candleTime:
          state.candleTime,

        session:
          state.session,

        regime:
          state.regime,

        vector:
          state.vector,

        features:{
          ...state.features,
          symbol
        },

        futurePath

      });

    }


    let processed =
      0;


    /*
      Smaller batches are safer for
      serverless HTTP database requests.
    */

    for (
      let i = 0;

      i <
      states.length;

      i += 200
    ) {

      processed +=
        await bulkUpsertStates(
          states.slice(
            i,
            i + 200
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

        symbol,

        memoryEnabled:true,

        mode:
          backfill
            ? "BACKFILL"
            : "UPDATE",

        requested,

        processed,

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
      `MEMORY ${symbol}:`,
      error
    );


    return res
      .status(500)
      .json({

        success:false,

        symbol,

        error:
          error?.message ||
          `${symbol} memory update failed.`

      });

  }

}