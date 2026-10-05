/* =========================================================
   MKAYFX XAU LIQUIDITY SWEEP STRATEGY
   /api/strategy.js

   PURPOSE
   -------
   Converts /api/xau intelligence into a strict,
   rules-based liquidity sweep reversal strategy.

   THIS DOES NOT FORCE TRADES.

   FLOW
   ----
   1. Find high-quality liquidity pool
   2. Wait for price to approach
   3. Wait for sweep
   4. Require rejection / reclaim
   5. Check footprint-style order flow
   6. Check absorption / delta divergence
   7. Check M5 structure
   8. Calculate SL
   9. Find opposing liquidity TP1 / TP2
   10. Require acceptable RR
   11. Return BUY / SELL / WAIT

   OPTIONAL ENVIRONMENT VARIABLES
   ------------------------------
   STRATEGY_MIN_LIQUIDITY_SCORE
   STRATEGY_MIN_RR
   STRATEGY_MIN_CONFIRMATIONS
   STRATEGY_ARM_DISTANCE_ATR
========================================================= */


const SETTINGS = {

  MIN_LIQUIDITY_SCORE:
    envNumber(
      "STRATEGY_MIN_LIQUIDITY_SCORE",
      70,
      50,
      95
    ),

  MIN_RR:
    envNumber(
      "STRATEGY_MIN_RR",
      1.40,
      0.75,
      5
    ),

  MIN_CONFIRMATIONS:
    Math.round(
      envNumber(
        "STRATEGY_MIN_CONFIRMATIONS",
        2,
        1,
        5
      )
    ),

  ARM_DISTANCE_ATR:
    envNumber(
      "STRATEGY_ARM_DISTANCE_ATR",
      0.45,
      0.10,
      2
    ),

  STOP_BUFFER_ATR:
    0.15,

  INVALIDATION_BUFFER_ATR:
    0.08,

  MIN_TARGET_DISTANCE_ATR:
    0.20

};


/* =========================================================
   API
========================================================= */


export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );


  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS"
  );


  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );


  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
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

        ok: false,

        error:
          "GET only"

      });

  }


  try {

    const base =
      getBaseUrl(
        req
      );


    const response =
      await fetch(

        `${base}/api/xau`,

        {

          cache:
            "no-store",

          headers: {

            "User-Agent":
              "MKAYFX-Liquidity-Strategy/1.0"

          }

        }

      );


    if (
      !response.ok
    ) {

      throw new Error(

        `/api/xau HTTP ${response.status}`

      );

    }


    const intelligence =
      await response.json();


    if (
      !intelligence?.ok
    ) {

      throw new Error(

        intelligence?.error
        ||
        "XAU intelligence engine returned an error."

      );

    }


    const strategy =
      buildStrategy(
        intelligence
      );


    return res
      .status(200)
      .json({

        ok: true,

        generatedAt:
          new Date()
            .toISOString(),

        settings:
          SETTINGS,

        strategy,

        intelligence

      });


  } catch (
    error
  ) {

    console.error(
      "Strategy error:",
      error
    );


    return res
      .status(500)
      .json({

        ok: false,

        error:
          error?.message
          ||
          "Unknown strategy error"

      });

  }

}


/* =========================================================
   STRATEGY ENGINE
========================================================= */


function buildStrategy(
  xau
) {

  const price =
    finite(
      xau.price,
      0
    );


  const atr5 =
    finite(
      xau.market?.atr5,
      Math.max(
        price * 0.0005,
        1
      )
    );


  const atr15 =
    finite(
      xau.market?.atr15,
      atr5 * 1.8
    );


  const pools =

    Array.isArray(
      xau.liquidityPools
    )

      ?

      xau.liquidityPools

      :

      [];


  const footprint =
    xau.footprint
    ||
    {};


  const structure =
    xau.structure
    ||
    {};


  const sessions =
    Array.isArray(
      xau.sessions
    )

      ?

      xau.sessions

      :

      [];


  /* =====================================================
     NO POOLS
  ===================================================== */


  if (
    !pools.length
  ) {

    return emptyStrategy(

      "NO_LIQUIDITY",

      "WAIT",

      "No liquidity pools are currently available."

    );

  }


  /* =====================================================
     RANK POOLS BY STRATEGIC RELEVANCE

     Important:
     We do not simply use highest liquidity score.

     A pool that is being swept / rejected NOW receives
     priority over a distant theoretical pool.
  ===================================================== */


  const ranked =
    pools

      .map(
        pool => {

          const zone =
            normalizeZone(
              pool
            );


          const near =
            pool.nearLevelFootprint
            ||
            {};


          const insideZone =
            between(

              price,

              zone.low,

              zone.high

            );


          const nearDistance =

            finite(
              pool.distance,
              Math.abs(
                price -
                pool.level
              )
            )

            /

            Math.max(
              atr15,
              1e-9
            );


          let rank =
            finite(
              pool.likelihoodScore,
              0
            );


          if (
            near.rejection
          ) {

            rank +=
              30;

          }


          if (
            insideZone
          ) {

            rank +=
              20;

          }


          if (
            nearDistance <= 0.35
          ) {

            rank +=
              12;

          }


          if (
            String(
              near.state
              ||
              ""
            )
              .includes(
                "REVERSAL FAVORED"
              )
          ) {

            rank +=
              15;

          }


          if (
            String(
              near.state
              ||
              ""
            )
              .includes(
                "DEEPER RAID"
              )
          ) {

            rank +=
              8;

          }


          return {

            pool,

            rank,

            zone

          };

        }
      )

      .sort(
        (a, b) =>
          b.rank -
          a.rank
      );


  const focusData =
    ranked[0];


  const pool =
    focusData.pool;


  const zone =
    focusData.zone;


  const side =
    pool.side;


  const isHigh =
    side ===
    "HIGH";


  const tradeDirection =
    isHigh
      ? "SELL"
      : "BUY";


  const score =
    finite(
      pool.likelihoodScore,
      0
    );


  const qualityPass =

    score >=
    SETTINGS.MIN_LIQUIDITY_SCORE;


  const nearFlow =
    pool.nearLevelFootprint
    ||
    {};


  /* =====================================================
     SWEEP DETECTION
  ===================================================== */


  const currentlyBeyondLevel =

    isHigh

      ?

      price >=
      pool.level

      :

      price <=
      pool.level;


  const currentlyInsideSweepZone =
    between(

      price,

      zone.low,

      zone.high

    );


  const rejection =
    Boolean(
      nearFlow.rejection
    );


  /*
     Rejection is especially important because current
     price may already be back inside the old liquidity
     level after the sweep.
  */


  const swept =

    currentlyBeyondLevel

    ||

    rejection;


  const acceptedBeyond =

    isHigh

      ?

      (

        price >

        zone.high

        +

        atr5 *
        SETTINGS.INVALIDATION_BUFFER_ATR

      )

      :

      (

        price <

        zone.low

        -

        atr5 *
        SETTINGS.INVALIDATION_BUFFER_ATR

      );


  const flowState =
    String(
      nearFlow.state
      ||
      ""
    );


  const acceptanceFlow =
    flowState.includes(
      "ACCEPTANCE"
    );


  const invalidated =

    acceptedBeyond

    &&

    !rejection;


  /* =====================================================
     FOOTPRINT CONFIRMATIONS
  ===================================================== */


  const delta5 =
    finite(
      footprint.last5?.deltaPct,
      0
    );


  const delta15 =
    finite(
      footprint.last15?.deltaPct,
      0
    );


  const delta30 =
    finite(
      footprint.last30?.deltaPct,
      0
    );


  const divergence =
    String(
      footprint.divergence
      ||
      "NONE"
    );


  const absorption =
    String(
      footprint.absorption
      ||
      "NONE"
    );


  const localReversal =
    flowState.includes(
      "REVERSAL FAVORED"
    );


  const absorptionPass =

    isHigh

      ?

      absorption.includes(
        "BUYING ABSORBED"
      )

      :

      absorption.includes(
        "SELLING ABSORBED"
      );


  const divergencePass =

    isHigh

      ?

      divergence.includes(
        "PRICE UP / DELTA DOWN"
      )

      :

      divergence.includes(
        "PRICE DOWN / DELTA UP"
      );


  /*
     Delta flip:

     High sweep:
     buyers were aggressive,
     then short-term flow goes negative.

     Low sweep:
     sellers were aggressive,
     then short-term flow turns positive.
  */


  const deltaFlipPass =

    isHigh

      ?

      delta5 <= -8

      :

      delta5 >= 8;


  const exhaustionPass =

    isHigh

      ?

      (
        delta15 > 15

        &&

        delta5 <
        delta15 * 0.25
      )

      :

      (
        delta15 < -15

        &&

        delta5 >
        delta15 * 0.25
      );


  /* =====================================================
     STRUCTURE CONFIRMATION
  ===================================================== */


  const m5Bias =
    structure.m5?.bias
    ||
    "NEUTRAL";


  const m15Bias =
    structure.m15?.bias
    ||
    "NEUTRAL";


  const structurePass =

    isHigh

      ?

      (
        m5Bias ===
        "BEARISH"
      )

      :

      (
        m5Bias ===
        "BULLISH"
      );


  const strongStructurePass =

    isHigh

      ?

      (
        m5Bias ===
        "BEARISH"

        &&

        m15Bias !==
        "BULLISH"
      )

      :

      (
        m5Bias ===
        "BULLISH"

        &&

        m15Bias !==
        "BEARISH"
      );


  /* =====================================================
     CONFIRMATION MATRIX
  ===================================================== */


  const confirmations = [

    {

      key:
        "quality",

      label:
        "A-grade liquidity pool",

      pass:
        qualityPass,

      detail:

        `${round(score, 1)} / ` +

        `${SETTINGS.MIN_LIQUIDITY_SCORE} minimum`

    },


    {

      key:
        "sweep",

      label:
        "Liquidity has been swept",

      pass:
        swept,

      detail:

        swept

          ?

          rejection
            ? "Sweep + reclaim/rejection detected"
            : "Price is trading beyond the liquidity level"

          :

          "Waiting for price to trade through the liquidity pool"

    },


    {

      key:
        "rejection",

      label:
        "Sweep rejection / reclaim",

      pass:
        rejection,

      detail:

        rejection

          ?

          "Price traded through the pool and returned"

          :

          "No completed rejection detected yet"

    },


    {

      key:
        "localFlow",

      label:
        "Near-level trapped flow",

      pass:
        localReversal,

      detail:

        localReversal

          ?

          flowState

          :

          flowState
          ||
          "No reversal flow confirmation"

    },


    {

      key:
        "absorption",

      label:
        "Absorption",

      pass:
        absorptionPass,

      detail:
        absorption

    },


    {

      key:
        "divergence",

      label:
        "Delta divergence",

      pass:
        divergencePass,

      detail:
        divergence

    },


    {

      key:
        "deltaFlip",

      label:
        "Short-term delta reversal",

      pass:
        deltaFlipPass,

      detail:
        `5M delta ${round(delta5, 1)}%`

    },


    {

      key:
        "exhaustion",

      label:
        "Aggressive-flow exhaustion",

      pass:
        exhaustionPass,

      detail:

        `5M ${round(delta5, 1)}% · ` +

        `15M ${round(delta15, 1)}%`

    },


    {

      key:
        "structure",

      label:
        "M5 structure shift",

      pass:
        structurePass,

      detail:

        `M5 ${m5Bias} · ` +

        `M15 ${m15Bias}`

    }

  ];


  /*
     Only actual reversal confirmations count here.

     Liquidity score itself and sweep occurrence are
     prerequisites rather than confirmation points.
  */


  const reversalConfirmationKeys = [

    "localFlow",
    "absorption",
    "divergence",
    "deltaFlip",
    "exhaustion",
    "structure"

  ];


  const confirmationCount =
    confirmations.filter(

      item =>

        reversalConfirmationKeys.includes(
          item.key
        )

        &&

        item.pass

    ).length;


  /* =====================================================
     TRADE PLAN
  ===================================================== */


  const plannedEntry =

    swept

      ?

      price

      :

      finite(
        pool.projectedSweep?.likelyEnd,
        pool.level
      );


  const buffer =
    Math.max(

      atr5 *
      SETTINGS.STOP_BUFFER_ATR,

      price *
      0.00008,

      0.20

    );


  const stop =

    isHigh

      ?

      zone.high +
      buffer

      :

      zone.low -
      buffer;


  const targets =
    chooseTargets({

      pools,

      pool,

      entry:
        plannedEntry,

      stop,

      side,

      atr15

    });


  const risk =
    Math.abs(

      plannedEntry -
      stop

    );


  const rr1 =
    risk > 0

      ?

      Math.abs(

        plannedEntry -
        targets.tp1

      )

      /

      risk

      :

      0;


  const rr2 =
    risk > 0

      ?

      Math.abs(

        plannedEntry -
        targets.tp2

      )

      /

      risk

      :

      0;


  const rrPass =

    rr2 >=
    SETTINGS.MIN_RR;


  confirmations.push({

    key:
      "rr",

    label:
      "Risk/reward",

    pass:
      rrPass,

    detail:

      `${round(rr2, 2)}R ` +

      `(${SETTINGS.MIN_RR}R minimum)`

  });


  /* =====================================================
     STRATEGY STATE
  ===================================================== */


  const distanceAtr =
    Math.abs(

      price -
      pool.level

    )

    /

    Math.max(
      atr15,
      1e-9
    );


  let state =
    "APPROACHING";


  let stateLabel =
    "Approaching liquidity";


  if (
    !qualityPass
  ) {

    state =
      "LOW_QUALITY";


    stateLabel =
      "No A-grade setup";

  }


  else if (
    invalidated

    ||

    acceptanceFlow
  ) {

    state =
      "ACCEPTANCE";


    stateLabel =
      "Liquidity accepted — reversal invalid";

  }


  else if (

    rejection

    &&

    confirmationCount >=
    SETTINGS.MIN_CONFIRMATIONS

    &&

    rrPass

  ) {

    state =
      "CONFIRMED";


    stateLabel =
      `${tradeDirection} confirmed`;

  }


  else if (

    rejection

    &&

    confirmationCount >=
    SETTINGS.MIN_CONFIRMATIONS

    &&

    !rrPass

  ) {

    state =
      "POOR_RR";


    stateLabel =
      "Reversal confirmed but RR too low";

  }


  else if (
    rejection
  ) {

    state =
      "REJECTION_WAIT_CONFIRMATION";


    stateLabel =
      "Sweep rejected — waiting for confirmation";

  }


  else if (
    swept
  ) {

    state =
      "SWEPT_WAIT_REJECTION";


    stateLabel =
      "Liquidity swept — waiting for rejection";

  }


  else if (
    currentlyInsideSweepZone
  ) {

    state =
      "IN_SWEEP_ZONE";


    stateLabel =
      "Price inside projected sweep zone";

  }


  else if (

    distanceAtr <=
    SETTINGS.ARM_DISTANCE_ATR

  ) {

    state =
      "ARMED";


    stateLabel =
      "Strategy armed";

  }


  /* =====================================================
     SIGNAL
  ===================================================== */


  const signal =

    state ===
    "CONFIRMED"

      ?

      tradeDirection

      :

      "WAIT";


  /* =====================================================
     CONFIDENCE
  ===================================================== */


  let confidence =

    score *
    0.55

    +

    confirmationCount *
    7;


  if (
    rejection
  ) {

    confidence +=
      8;

  }


  if (
    strongStructurePass
  ) {

    confidence +=
      6;

  }


  if (
    currentlyInsideSweepZone
  ) {

    confidence +=
      4;

  }


  if (
    !rrPass
  ) {

    confidence -=
      10;

  }


  if (
    invalidated
  ) {

    confidence =
      Math.min(
        confidence,
        25
      );

  }


  confidence =
    clamp(
      confidence,
      5,
      95
    );


  /* =====================================================
     SESSION
  ===================================================== */


  const activeSessions =
    sessions.filter(
      s =>
        s.active
    );


  const sessionLabel =

    activeSessions.length

      ?

      activeSessions
        .map(
          s =>
            s.short
        )
        .join(
          " + "
        )

      :

      "NO MAJOR SESSION ACTIVE";


  /* =====================================================
     THESIS
  ===================================================== */


  const thesis =
    createThesis({

      state,

      tradeDirection,

      pool,

      zone,

      price,

      targets,

      rejection,

      confirmationCount,

      rr2

    });


  /* =====================================================
     SIGNAL ID
  ===================================================== */


  const signalHour =

    new Date(
      xau.latestBarTime
      ||
      Date.now()
    )

      .toISOString()

      .slice(
        0,
        13
      );


  const signalId =

    `XAU-` +

    `${tradeDirection}-` +

    `${pool.type}-` +

    `${Math.round(pool.level * 1000)}-` +

    `${signalHour}`;


  return {

    signal,

    state,

    stateLabel,

    signalId,


    confidence:
      round(
        confidence,
        1
      ),


    direction:
      tradeDirection,


    session:
      sessionLabel,


    price:
      round(
        price,
        3
      ),


    focusPool: {

      name:
        pool.name,

      type:
        pool.type,

      side:
        pool.side,

      level:
        round(
          pool.level,
          3
        ),

      likelihood:
        pool.likelihood,

      likelihoodScore:
        round(
          score,
          1
        ),

      raidStyle:
        pool.raidStyle,

      distance:
        round(
          Math.abs(
            pool.level -
            price
          ),
          3
        ),

      distanceAtr:
        round(
          distanceAtr,
          2
        )

    },


    sweep: {

      swept,

      rejection,

      insideZone:
        currentlyInsideSweepZone,

      invalidated,

      acceptance:
        acceptanceFlow,

      zoneLow:
        round(
          zone.low,
          3
        ),

      zoneHigh:
        round(
          zone.high,
          3
        ),

      likelyEnd:
        round(
          finite(
            pool.projectedSweep?.likelyEnd,
            pool.level
          ),
          3
        ),

      overshoot:
        round(
          finite(
            pool.projectedSweep?.overshoot,
            0
          ),
          3
        ),

      footprintState:
        flowState

    },


    trade: {

      plannedEntry:
        round(
          plannedEntry,
          3
        ),

      stopLoss:
        round(
          stop,
          3
        ),

      tp1:
        round(
          targets.tp1,
          3
        ),

      tp1Name:
        targets.tp1Name,

      tp2:
        round(
          targets.tp2,
          3
        ),

      tp2Name:
        targets.tp2Name,

      riskPoints:
        round(
          risk,
          3
        ),

      rr1:
        round(
          rr1,
          2
        ),

      rr2:
        round(
          rr2,
          2
        )

    },


    orderFlow: {

      delta5:
        round(
          delta5,
          1
        ),

      delta15:
        round(
          delta15,
          1
        ),

      delta30:
        round(
          delta30,
          1
        ),

      absorption,

      divergence,

      localFlow:
        flowState

    },


    confirmationCount,

    requiredConfirmations:
      SETTINGS.MIN_CONFIRMATIONS,

    confirmations,

    thesis

  };

}


/* =========================================================
   TARGET SELECTION
========================================================= */


function chooseTargets({

  pools,

  pool,

  entry,

  stop,

  side,

  atr15

}) {

  const isSell =
    side ===
    "HIGH";


  const risk =
    Math.max(

      Math.abs(
        entry -
        stop
      ),

      atr15 *
      0.10

    );


  let oppositePools =
    pools.filter(
      p => {

        if (
          p.side ===
          pool.side
        ) {

          return false;

        }


        if (
          !Number.isFinite(
            Number(
              p.level
            )
          )
        ) {

          return false;

        }


        if (
          isSell
        ) {

          return (

            p.level <

            entry

            -

            atr15 *
            SETTINGS.MIN_TARGET_DISTANCE_ATR

          );

        }


        return (

          p.level >

          entry

          +

          atr15 *
          SETTINGS.MIN_TARGET_DISTANCE_ATR

        );

      }
    );


  oppositePools =
    oppositePools.sort(

      (a, b) => {

        if (
          isSell
        ) {

          return (
            b.level -
            a.level
          );

        }


        return (
          a.level -
          b.level
        );

      }

    );


  const nearest =
    oppositePools[0];


  let tp1 =
    nearest?.level;


  let tp1Name =
    nearest?.name;


  if (
    !Number.isFinite(
      tp1
    )
  ) {

    tp1 =

      isSell

        ?

        entry -
        risk *
        1.50

        :

        entry +
        risk *
        1.50;


    tp1Name =
      "1.5R liquidity fallback";

  }


  const majorTypes = [

    "ASIA_HIGH",
    "ASIA_LOW",

    "SESSION_HIGH",
    "SESSION_LOW",

    "PDH",
    "PDL",

    "PWH",
    "PWL",

    "EQH",
    "EQL"

  ];


  let deeper =
    oppositePools.find(
      p => {

        if (
          p === nearest
        ) {

          return false;

        }


        const farEnough =

          isSell

            ?

            p.level <

            tp1

            -

            atr15 *
            0.30

            :

            p.level >

            tp1

            +

            atr15 *
            0.30;


        return (

          farEnough

          &&

          (
            majorTypes.includes(
              p.type
            )

            ||

            finite(
              p.likelihoodScore,
              0
            ) >= 40
          )

        );

      }
    );


  let tp2 =
    deeper?.level;


  let tp2Name =
    deeper?.name;


  if (
    !Number.isFinite(
      tp2
    )
  ) {

    tp2 =

      isSell

        ?

        entry -
        risk *
        2.50

        :

        entry +
        risk *
        2.50;


    tp2Name =
      "2.5R liquidity fallback";

  }


  return {

    tp1,

    tp1Name,

    tp2,

    tp2Name

  };

}


/* =========================================================
   THESIS
========================================================= */


function createThesis({

  state,

  tradeDirection,

  pool,

  zone,

  price,

  targets,

  rejection,

  confirmationCount,

  rr2

}) {

  const level =
    round(
      pool.level,
      3
    );


  const zoneText =

    `${round(zone.low, 3)} – ` +

    `${round(zone.high, 3)}`;


  if (
    state ===
    "LOW_QUALITY"
  ) {

    return (

      `${pool.name} is currently the strongest nearby pool, ` +

      `but its liquidity score is below the strategy threshold. ` +

      `No trade should be forced.`

    );

  }


  if (
    state ===
    "ACCEPTANCE"
  ) {

    return (

      `Price has accepted beyond the projected ${pool.name} ` +

      `raid zone. The reversal thesis is invalid until a new ` +

      `liquidity structure forms.`

    );

  }


  if (
    state ===
    "CONFIRMED"
  ) {

    return (

      `${pool.name} at ${level} has been swept and rejected. ` +

      `${confirmationCount} reversal confirmations are active. ` +

      `${tradeDirection} is confirmed with TP1 at ` +

      `${round(targets.tp1, 3)} and TP2 at ` +

      `${round(targets.tp2, 3)}. ` +

      `Projected TP2 reward/risk is ${round(rr2, 2)}R.`

    );

  }


  if (
    state ===
    "POOR_RR"
  ) {

    return (

      `The sweep reversal has confirmation, but the remaining ` +

      `distance to opposing liquidity does not provide enough ` +

      `reward relative to the stop. Skip the trade.`

    );

  }


  if (
    state ===
    "REJECTION_WAIT_CONFIRMATION"
  ) {

    return (

      `${pool.name} has been swept and price has rejected the ` +

      `level. Do not enter yet. Wait for additional delta, ` +

      `absorption, divergence or M5 structure confirmation.`

    );

  }


  if (
    state ===
    "SWEPT_WAIT_REJECTION"
  ) {

    return (

      `Price has traded through ${pool.name}, but the market ` +

      `has not confirmed a failed breakout. Wait for price ` +

      `to reclaim the liquidity level before considering ` +

      `a ${tradeDirection}.`

    );

  }


  if (
    state ===
    "IN_SWEEP_ZONE"
  ) {

    return (

      `Price is currently inside the projected ${pool.name} ` +

      `sweep zone ${zoneText}. This is the area where the ` +

      `strategy begins watching for trapped order flow and ` +

      `reversal confirmation.`

    );

  }


  if (
    state ===
    "ARMED"
  ) {

    return (

      `${pool.name} at ${level} is close enough for the ` +

      `strategy to become armed. Expected raid zone: ` +

      `${zoneText}. Wait for the sweep before entering.`

    );

  }


  return (

    `${pool.name} at ${level} is the current focus. ` +

    `Price is ${round(price, 3)}. ` +

    `The strategy is waiting for price to move closer ` +

    `before arming the sweep model.`

  );

}


/* =========================================================
   EMPTY STRATEGY
========================================================= */


function emptyStrategy(
  state,
  signal,
  thesis
) {

  return {

    signal,

    state,

    stateLabel:
      state,

    signalId:
      null,

    confidence:
      0,

    direction:
      null,

    focusPool:
      null,

    sweep:
      null,

    trade:
      null,

    orderFlow:
      null,

    confirmations:
      [],

    confirmationCount:
      0,

    requiredConfirmations:
      SETTINGS.MIN_CONFIRMATIONS,

    thesis

  };

}


/* =========================================================
   HELPERS
========================================================= */


function normalizeZone(
  pool
) {

  const level =
    finite(
      pool.level,
      0
    );


  const a =
    finite(
      pool.projectedSweep?.zoneLow,
      level
    );


  const b =
    finite(
      pool.projectedSweep?.zoneHigh,
      level
    );


  return {

    low:
      Math.min(
        a,
        b
      ),

    high:
      Math.max(
        a,
        b
      )

  };

}


function between(
  value,
  low,
  high
) {

  return (

    value >=
    low

    &&

    value <=
    high

  );

}


function finite(
  value,
  fallback = 0
) {

  const n =
    Number(
      value
    );


  return Number.isFinite(
    n
  )

    ?

    n

    :

    fallback;

}


function round(
  value,
  decimals = 2
) {

  if (
    !Number.isFinite(
      Number(
        value
      )
    )
  ) {

    return null;

  }


  const multiplier =
    10 **
    decimals;


  return (

    Math.round(

      Number(
        value
      )

      *

      multiplier

    )

    /

    multiplier

  );

}


function clamp(
  value,
  min,
  max
) {

  return Math.max(

    min,

    Math.min(
      max,
      value
    )

  );

}


function envNumber(
  name,
  fallback,
  min,
  max
) {

  const value =
    Number(
      process.env[
        name
      ]
    );


  if (
    !Number.isFinite(
      value
    )
  ) {

    return fallback;

  }


  return clamp(
    value,
    min,
    max
  );

}


function getBaseUrl(
  req
) {

  const proto =

    req.headers[
      "x-forwarded-proto"
    ]

    ||

    "https";


  const host =

    req.headers[
      "x-forwarded-host"
    ]

    ||

    req.headers.host;


  if (
    !host
  ) {

    throw new Error(
      "Unable to determine deployment host."
    );

  }


  return (
    `${proto}://${host}`
  );

}