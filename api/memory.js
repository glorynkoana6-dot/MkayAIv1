import {
  SYMBOL,
  envNumber,
  completed,
  fetchSeries,
  detectRegime,
  basicComponentScores,
  buildFeatureState,
  buildFuturePath
} from "../lib/core.js";


import {
  dbEnabled,
  bulkUpsertStates,
  memoryCount
} from "../lib/db.js";


const FORWARD_BARS =
  Math.round(
    envNumber(
      "HISTORICAL_FORWARD_BARS",
      12,
      6,
      36
    )
  );


function authorized(
  req,
  backfill
) {

  const supplied =
    req.headers
      .authorization;


  if (backfill) {

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


export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store"
  );


  if (
    !dbEnabled()
  ) {

    return res
      .status(200)
      .json({
        success:
          true,

        memoryEnabled:
          false,

        error:
          "DATABASE_URL is not set."
      });

  }


  const backfill =
    req.query?.mode ===
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
        success:
          false,

        error:
          "Unauthorized."
      });

  }


  try {

    const requested =
      backfill
        ? Math.round(
            Math.max(
              300,
              Math.min(
                4500,
                Number(
                  req.query
                    ?.bars ||
                  1800
                )
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
        SYMBOL,
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
        "Not enough M5 data."
      );

    }


    const start =
      Math.max(
        70,
        candles.length -
          requested -
          FORWARD_BARS
      );


    const states = [];


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
        symbol:
          SYMBOL,

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

        features:
          state.features,

        futurePath
      });

    }


    let processed = 0;


    for (
      let i = 0;
      i <
        states.length;
      i +=
        250
    ) {

      processed +=
        await bulkUpsertStates(
          states.slice(
            i,
            i +
              250
          )
        );

    }


    const count =
      await memoryCount();


    return res
      .status(200)
      .json({
        success:
          true,

        memoryEnabled:
          true,

        mode:
          backfill
            ? "BACKFILL"
            : "UPDATE",

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
      "MEMORY:",
      error
    );


    return res
      .status(500)
      .json({
        success:
          false,

        error:
          error?.message ||
          "Memory update failed."
      });

  }
}