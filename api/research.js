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


  return Array.isArray(
    value
  )
    ? value[0]
    : value;
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

      trades:0,

      winRate:null,

      expectancyR:null,

      profitFactor:null,

      totalR:0,

      maxDrawdownR:0

    };

  }


  const wins =
    trades.filter(
      x =>
        x.r >
        0
    ).length;


  const grossWin =
    trades
      .filter(
        x =>
          x.r >
          0
      )
      .reduce(
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
      trades
        .filter(
          x =>
            x.r <
            0
        )
        .reduce(
          (
            sum,
            x
          ) =>
            sum +
            x.r,
          0
        )
    );


  let equity =
    0;


  let peak =
    0;


  let drawdown =
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

  }


  return {

    trades:
      trades.length,

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
          trades.map(
            x =>
              x.r
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
        drawdown,
        2
      )

  };
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


    const score =
      ensembleScore(
        components,
        row.regime,
        {}
      );


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


    const outcome =
      evaluatePath(
        row.future_path,
        direction,
        1,
        1.2
      );


    if (!outcome) {
      continue;
    }


    trades.push({

      symbol:
        row.symbol,

      time:
        row.candle_time,

      r:
        outcome.resultR,

      direction,

      score,

      regime:
        row.regime,

      session:
        row.session

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
        success:false,
        error:"Use GET."
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

        available:false,

        error:
          "DATABASE_URL is not configured."

      });

  }


  try {

    /*
      THIS IS THE IMPORTANT FIX.

      BTC research only loads BTC rows.
      Gold research only loads Gold rows.
    */

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
            row.symbol ===
            symbol
        )
        .sort(
          (a,b) =>
            new Date(
              a.candle_time
            ) -
            new Date(
              b.candle_time
            )
        );


    const count =
      await memoryCount(
        symbol
      );


    if (
      rows.length <
      100
    ) {

      return res
        .status(200)
        .json({

          success:true,

          symbol,

          available:false,

          memory:
            count,

          resolvedStates:
            rows.length,

          requiredStates:
            100,

          error:
            `Need at least 100 resolved ${symbol} market states. Backfill ${symbol} memory first.`

        });

    }


    /*
      Chronological split.

      The earlier 70% is used for selecting
      the score threshold.

      The later 30% is untouched holdout data.
    */

    const split =
      Math.floor(
        rows.length *
        0.70
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


    const thresholds = [
      20,
      30,
      40,
      50,
      60,
      70
    ];


    const candidates =
      thresholds.map(
        threshold => ({

          threshold,

          metrics:
            metrics(
              simulate(
                training,
                threshold
              )
            )

        })
      );


    const viable =
      candidates.filter(
        x =>
          x.metrics
            .trades >=
          20
      );


    const pool =
      viable.length
        ? viable
        : candidates;


    const ranked =
      [...pool]
        .sort(
          (a,b) => {

            const expA =
              finite(
                a.metrics
                  .expectancyR
              ) ??
              -999;


            const expB =
              finite(
                b.metrics
                  .expectancyR
              ) ??
              -999;


            /*
              Primary selection:
              higher training expectancy.

              Secondary selection:
              larger sample size.
            */

            if (
              expB !==
              expA
            ) {

              return expB -
                expA;

            }


            return (
              b.metrics
                .trades -
              a.metrics
                .trades
            );

          }
        );


    const best =
      ranked[0];


    if (!best) {

      return res
        .status(200)
        .json({

          success:true,

          symbol,

          available:false,

          memory:
            count,

          error:
            `Could not create a ${symbol} research candidate.`

        });

    }


    const testTrades =
      simulate(
        test,
        best.threshold
      );


    const testMetrics =
      metrics(
        testTrades
      );


    return res
      .status(200)
      .json({

        success:true,

        symbol,

        available:true,

        memory:
          count,

        method:
          "70/30 chronological training/holdout",

        trainRows:
          training.length,

        testRows:
          test.length,

        selectedThreshold:
          best.threshold,

        training:
          best.metrics,

        test:
          testMetrics,

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

        candidates,

        note:
          "Research results are historical estimates and do not guarantee future performance."

      });

  }
  catch(error) {

    console.error(
      `RESEARCH ${symbol}:`,
      error
    );


    return res
      .status(500)
      .json({

        success:false,

        symbol,

        error:
          error?.message ||
          `${symbol} research failed.`

      });

  }

}