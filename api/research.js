import {
  finite,
  round,
  mean,
  ensembleScore,
  evaluatePath
} from "../lib/core.js";


import {
  dbEnabled,
  loadResolvedStates,
  memoryCount
} from "../lib/db.js";


function metrics(
  trades
) {

  if (
    !trades.length
  ) {

    return {
      trades:
        0,

      winRate:
        null,

      expectancyR:
        null,

      profitFactor:
        null,

      totalR:
        0,

      maxDrawdownR:
        0
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


  let equity = 0;
  let peak = 0;
  let drawdown = 0;


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
        : null,

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


function simulate(
  rows,
  threshold
) {

  const trades = [];


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


    const score =
      ensembleScore(
        components,
        row.regime,
        {}
      );


    if (
      Math.abs(score) <
      threshold
    ) {
      continue;
    }


    const direction =
      score >= 0
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


function groupedMetrics(
  trades,
  key
) {

  const out = {};


  for (
    const name of
    [
      ...new Set(
        trades.map(
          x =>
            x[key]
        )
      )
    ]
  ) {

    if (!name) {
      continue;
    }


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

        available:
          false,

        error:
          "DATABASE_URL is not configured."
      });

  }


  try {

    let rows =
      await loadResolvedStates({
        limit:
          5000
      });


    rows =
      rows.sort(
        (a, b) =>
          new Date(
            a.candle_time
          ) -
          new Date(
            b.candle_time
          )
      );


    if (
      rows.length <
      100
    ) {

      return res
        .status(200)
        .json({
          success:
            true,

          available:
            false,

          resolvedStates:
            rows.length,

          error:
            "Need at least 100 resolved market states."
        });

    }


    const split =
      Math.floor(
        rows.length *
        0.7
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
          x.metrics.trades >=
          20
      );


    const best =
      (
        viable.length
          ? viable
          : candidates
      )
      .sort(
        (a, b) =>
          (
            b.metrics
              .expectancyR ??
            -99
          ) -
          (
            a.metrics
              .expectancyR ??
            -99
          )
      )[0];


    const testTrades =
      simulate(
        test,
        best.threshold
      );


    return res
      .status(200)
      .json({
        success:
          true,

        available:
          true,

        memory:
          await memoryCount(),

        method:
          "70/30 chronological walk-forward holdout",

        trainRows:
          training.length,

        testRows:
          test.length,

        selectedThreshold:
          best.threshold,

        training:
          best.metrics,

        test:
          metrics(
            testTrades
          ),

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

        candidates
      });

  }
  catch (error) {

    return res
      .status(500)
      .json({
        success:
          false,

        error:
          error?.message ||
          "Research failed."
      });

  }
}