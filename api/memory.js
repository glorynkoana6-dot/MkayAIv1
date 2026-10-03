import {
  envNumber,
  completed,
  fetchSeries,
  resample,
  detectRegime,
  multiAgentStrategy,
  buildFeatureState,
  buildFuturePath
} from "./core.js";

import {
  dbEnabled,
  bulkUpsertStates,
  memoryCount
} from "./db.js";


const VERSION = "15.0";


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


function authorized(
  req,
  backfill
) {
  const supplied =
    req.headers.authorization;

  if (backfill) {
    const secret =
      process.env.ADMIN_SECRET;

    if (!secret) {
      return false;
    }

    return supplied ===
      `Bearer ${secret}`;
  }

  const cronSecret =
    process.env.CRON_SECRET;

  if (!cronSecret) {
    return true;
  }

  return supplied ===
    `Bearer ${cronSecret}`;
}


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
    req.method === "OPTIONS"
  ) {
    return res
      .status(204)
      .end();
  }

  if (
    ![
      "GET",
      "POST"
    ].includes(req.method)
  ) {
    return res
      .status(405)
      .json({
        success: false,
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
        success: false,

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
        version: VERSION,
        symbol,
        memoryEnabled: false,

        error:
          "DATABASE_URL is not set."
      });
  }

  const backfill =
    String(
      queryValue(
        req,
        "mode"
      ) || ""
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
        success: false,
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
              900,
              Math.min(
                4500,
                Number.isFinite(
                  barsRaw
                )
                  ? barsRaw
                  : 3000
              )
            )
          )
        : 900;

    const output =
      Math.min(
        5000,
        requested +
          FORWARD_BARS +
          800
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
      candles.length < 850
    ) {
      throw new Error(
        `Not enough completed ${symbol} M5 data.`
      );
    }

    const start =
      Math.max(
        800,
        candles.length -
          requested -
          FORWARD_BARS
      );

    const states = [];

    for (
      let i = start;
      i < candles.length;
      i++
    ) {
      /*
        We create the exact historical
        information that would have been
        available at candle i.

        No future candle enters strategy().
      */

      const history =
        candles.slice(
          0,
          i + 1
        );

      const m5 =
        history.slice(-2600);

      const m15 =
        resample(
          m5,
          15
        );

      const h1 =
        resample(
          m5,
          60
        );

      if (
        m5.length < 800 ||
        m15.length < 210 ||
        h1.length < 60
      ) {
        continue;
      }

      const strategy =
        multiAgentStrategy({
          symbol,
          m5,
          m15,
          h1
        });

      const regime =
        detectRegime(m5);

      const state =
        buildFeatureState(
          m5,
          strategy,
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

        features: {
          ...state.features,
          symbol,
          engineVersion:
            VERSION
        },

        futurePath
      });
    }

    let processed = 0;

    for (
      let i = 0;
      i < states.length;
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
      await memoryCount(symbol);

    return res
      .status(200)
      .json({
        success: true,

        version:
          VERSION,

        engine:
          "MULTI_AGENT_V15",

        symbol,

        memoryEnabled: true,

        mode:
          backfill
            ? "BACKFILL"
            : "UPDATE",

        requested,

        forwardBars:
          FORWARD_BARS,

        generated:
          states.length,

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
  catch (error) {
    console.error(
      `MEMORY V15 ${symbol}:`,
      error
    );

    return res
      .status(500)
      .json({
        success: false,

        version:
          VERSION,

        symbol,

        error:
          error?.message ||
          `${symbol} memory update failed.`
      });
  }
}