const BASE_URL = "https://api.twelvedata.com";

const TF_MAP = {
  "1m": "1min",
  "3m": "3min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "2h": "2h",
  "4h": "4h",
  "1D": "1day"
};

const TF_CHAIN = {
  "1m": ["1m", "5m", "15m", "1h"],
  "3m": ["3m", "5m", "15m", "1h"],
  "5m": ["5m", "15m", "1h", "4h"],
  "15m": ["15m", "1h", "4h", "1D"],
  "30m": ["30m", "1h", "4h", "1D"],
  "1h": ["1h", "4h", "1D"],
  "2h": ["2h", "4h", "1D"],
  "4h": ["4h", "1D"],
  "1D": ["1D"]
};

const SETTINGS = {
  atrLen: 14,
  effortLen: 50,
  pivotLen: 4,
  trendLen: 80,
  extremeLen: 30,

  climaxEffortMult: 1.8,
  climaxSpreadMult: 1.5,

  absorptionMinBars: 3,
  absorptionMaxBars: 8,
  absorptionExtremeATR: 0.5,
  absorptionReboundATR: 0.35,

  minARATR: 2.0,
  maxARBars: 30,

  boundaryTolATR: 0.75,

  stMaxEffortRatio: 0.9,
  stMaxSpreadRatio: 0.9,

  minPhaseBBars: 30,
  minPhaseBTests: 2,
  minOppositeTests: 1,
  minTraversals: 2,

  phaseBZoneFrac: 0.25,

  phaseBRangeMinATR: 1.5,
  phaseBRangeMaxATR: 8.0,

  springMinPenATR: 0.15,
  springMaxPenATR: 2.5,
  springCloseMin: 0.55,
  utadCloseMax: 0.45,
  springEffortMax: 1.5,

  testTolATR: 1.25,
  testMaxEffortRatio: 0.8,
  testMaxSpreadRatio: 0.8,

  breakATR: 0.15,

  strengthEffortMult: 1.15,
  strengthSpreadATR: 1.15,

  sosCloseMin: 0.65,
  sowCloseMax: 0.35,

  phaseDDominanceFrac: 0.65,

  lpsBoundaryATR: 1.5,

  confirmBars: 3,

  minConfidence: 60,
  minValidation: 50,

  rr1: 1.5,
  rr2: 2.5,

  outputSize: 500
};


/* =========================================================
   BASIC HELPERS
========================================================= */

function clamp(v, lo, hi) {
  return Math.max(
    lo,
    Math.min(
      hi,
      v
    )
  );
}


function round(v, digits = 2) {

  return Number.isFinite(v)
    ? Number(
        v.toFixed(digits)
      )
    : null;

}


function mean(values) {

  const usable =
    values.filter(
      Number.isFinite
    );

  return usable.length
    ? usable.reduce(
        (sum, value) =>
          sum + value,
        0
      ) / usable.length
    : NaN;

}


function normalizeSymbol(value) {

  const symbol =
    String(
      value ||
      "XAU/USD"
    )
      .trim()
      .toUpperCase();


  const aliases = {

    XAUUSD:
      "XAU/USD",

    BTCUSD:
      "BTC/USD",

    EURUSD:
      "EUR/USD",

    GBPUSD:
      "GBP/USD",

    USDJPY:
      "USD/JPY"

  };


  return (
    aliases[symbol] ||
    symbol
  );

}


function isDailyTf(tf) {

  return (
    tf ===
    "1D"
  );

}


/* =========================================================
   HTTP
========================================================= */

async function fetchJSON(
  url,
  timeoutMs = 18000
) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );


  try {

    const response =
      await fetch(
        url,
        {
          signal:
            controller.signal,

          headers: {
            accept:
              "application/json"
          }
        }
      );


    const text =
      await response.text();


    let data = {};


    try {

      data =
        text
          ? JSON.parse(text)
          : {};

    }

    catch {

      throw new Error(
        `Market-data provider returned invalid JSON (HTTP ${response.status}).`
      );

    }


    if (
      !response.ok ||
      data?.status ===
        "error"
    ) {

      throw new Error(

        data?.message ||
        data?.code ||
        `Twelve Data HTTP ${response.status}`

      );

    }


    return data;

  }

  finally {

    clearTimeout(
      timer
    );

  }

}


/* =========================================================
   MARKET DATA
========================================================= */

async function fetchSeries(
  symbol,
  tf
) {

  const apiKey =
    process.env
      .TWELVE_DATA_API_KEY;


  if (
    !apiKey
  ) {

    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel Environment Variables."
    );

  }


  const interval =
    TF_MAP[tf];


  if (
    !interval
  ) {

    throw new Error(
      `Unsupported timeframe: ${tf}`
    );

  }


  const params =
    new URLSearchParams({
      symbol,
      interval,

      outputsize:
        String(
          SETTINGS.outputSize
        ),

      order:
        "asc",

      format:
        "JSON",

      apikey:
        apiKey
    });


  if (
    !isDailyTf(tf)
  ) {

    params.set(
      "timezone",
      "UTC"
    );

  }


  const url =
    `${BASE_URL}/time_series?${params.toString()}`;


  const data =
    await fetchJSON(
      url
    );


  if (
    !Array.isArray(
      data.values
    )
  ) {

    throw new Error(
      `${tf}: no candle data returned for ${symbol}.`
    );

  }


  const bars =
    data.values

      .map(
        (v) => ({

          time:
            String(
              v.datetime ||
              ""
            ),

          open:
            Number(
              v.open
            ),

          high:
            Number(
              v.high
            ),

          low:
            Number(
              v.low
            ),

          close:
            Number(
              v.close
            ),

          volume:
            Number(
              v.volume ||
              0
            )

        })
      )

      .filter(
        (b) =>
          [
            b.open,
            b.high,
            b.low,
            b.close
          ].every(
            Number.isFinite
          )
      );


  if (
    bars.length <
    80
  ) {

    throw new Error(
      `${tf}: only ${bars.length} usable candles were returned.`
    );

  }


  return bars;

}


/* =========================================================
   ATR / SPREAD / EFFORT
========================================================= */

function trueRange(
  bars,
  i
) {

  if (
    i <= 0
  ) {

    return (
      bars[i].high -
      bars[i].low
    );

  }


  return Math.max(

    bars[i].high -
      bars[i].low,

    Math.abs(
      bars[i].high -
      bars[i - 1].close
    ),

    Math.abs(
      bars[i].low -
      bars[i - 1].close
    )

  );

}


function atrAt(
  bars,
  i,
  len = SETTINGS.atrLen
) {

  if (
    i < len
  ) {

    return NaN;

  }


  const values = [];


  for (
    let k =
      i - len + 1;

    k <= i;

    k++
  ) {

    values.push(
      trueRange(
        bars,
        k
      )
    );

  }


  return mean(
    values
  );

}


function spreadAt(
  bars,
  i
) {

  return Math.max(

    bars[i].high -
      bars[i].low,

    1e-9

  );

}


function hasRealVolume(
  bars
) {

  const sample =
    bars.slice(
      -Math.min(
        100,
        bars.length
      )
    );


  return sample.some(
    (b) =>
      Number.isFinite(
        b.volume
      ) &&
      b.volume > 0
  );

}


function effortAt(
  bars,
  i,
  useVolume
) {

  return useVolume

    ? Math.max(
        Number(
          bars[i].volume
        ) || 0,
        0
      )

    : spreadAt(
        bars,
        i
      );

}


function avgEffortAt(
  bars,
  i,
  useVolume,
  len = SETTINGS.effortLen
) {

  if (
    i <
    len - 1
  ) {

    return NaN;

  }


  const out = [];


  for (
    let k =
      i - len + 1;

    k <= i;

    k++
  ) {

    out.push(
      effortAt(
        bars,
        k,
        useVolume
      )
    );

  }


  return mean(
    out
  );

}


/* =========================================================
   PIVOTS
========================================================= */

function isPivotLow(
  bars,
  i,
  len = SETTINGS.pivotLen
) {

  if (
    i < len ||
    i + len >=
      bars.length
  ) {

    return false;

  }


  const price =
    bars[i].low;


  for (
    let k =
      i - len;

    k <=
      i + len;

    k++
  ) {

    if (
      k !== i &&
      bars[k].low <
        price
    ) {

      return false;

    }

  }


  return true;

}


function isPivotHigh(
  bars,
  i,
  len = SETTINGS.pivotLen
) {

  if (
    i < len ||
    i + len >=
      bars.length
  ) {

    return false;

  }


  const price =
    bars[i].high;


  for (
    let k =
      i - len;

    k <=
      i + len;

    k++
  ) {

    if (
      k !== i &&
      bars[k].high >
        price
    ) {

      return false;

    }

  }


  return true;

}


/* =========================================================
   PRIOR TREND
========================================================= */

function priorTrendScore(
  bars,
  i,
  len = SETTINGS.trendLen
) {

  const start =
    Math.max(
      0,
      i - len
    );


  if (
    i - start <
    20
  ) {

    return 0;

  }


  const first =
    bars[start].close;


  const last =
    bars[i].close;


  const atr =
    atrAt(
      bars,
      i
    ) ||
    spreadAt(
      bars,
      i
    );


  let path = 0;


  for (
    let k =
      start + 1;

    k <= i;

    k++
  ) {

    path +=
      Math.abs(
        bars[k].close -
        bars[k - 1].close
      );

  }


  const net =
    last -
    first;


  const efficiency =
    path > 0
      ?
      Math.abs(net) /
      path
      :
      0;


  const displacement =
    clamp(

      net /

      Math.max(
        atr *
        Math.sqrt(
          i -
          start +
          1
        ),
        1e-9
      ),

      -3,
      3

    ) *
    18;


  const directional =

    (
      net >= 0
        ?
        1
        :
        -1
    )

    *

    efficiency

    *

    35;


  return clamp(

    displacement +
    directional,

    -100,
    100

  );

}


/* =========================================================
   TEXT HELPERS
========================================================= */

function phaseName(p) {

  return ({
    0:
      "None",

    1:
      "A - Stopping action",

    2:
      "B - Building cause",

    3:
      "C - Test",

    4:
      "D - Trend within range",

    5:
      "E - Trend out of range"

  })[p] ||
  "None";

}


function structureName(
  direction,
  continuation
) {

  if (
    direction ===
    "BULL"
  ) {

    return continuation
      ?
      "REACCUMULATION"
      :
      "ACCUMULATION";

  }


  if (
    direction ===
    "BEAR"
  ) {

    return continuation
      ?
      "REDISTRIBUTION"
      :
      "DISTRIBUTION";

  }


  return "SEARCHING";

}


function makeEvent(
  label,
  index,
  price,
  score,
  bars
) {

  return {

    label,

    index,

    time:
      bars[index]?.time ||
      null,

    price:
      round(
        price,
        4
      ),

    score:
      Number.isFinite(
        score
      )
        ?
        score
        :
        null

  };

}


/* =========================================================
   FIND SELLING / BUYING CLIMAXES
========================================================= */

function findClimaxes(
  bars,
  useVolume
) {

  const out = [];


  const start =
    Math.max(

      SETTINGS.effortLen +
      SETTINGS.extremeLen +
      10,

      bars.length -
      420

    );


  for (
    let i =
      start;

    i <
      bars.length -
      SETTINGS.pivotLen;

    i++
  ) {


    const atr =
      atrAt(
        bars,
        i
      );


    const avgEffort =
      avgEffortAt(
        bars,
        i - 1,
        useVolume
      );


    if (
      !Number.isFinite(
        atr
      ) ||
      !Number.isFinite(
        avgEffort
      ) ||
      atr <= 0 ||
      avgEffort <= 0
    ) {

      continue;

    }


    const candle =
      bars[i];


    const spread =
      spreadAt(
        bars,
        i
      );


    const closePos =
      (
        candle.close -
        candle.low
      ) /
      spread;


    const trend =
      priorTrendScore(
        bars,
        i - 1
      );


    const prior =
      bars.slice(

        Math.max(
          0,
          i -
          SETTINGS.extremeLen
        ),

        i

      );


    if (
      !prior.length
    ) {

      continue;

    }


    const priorLow =
      Math.min(
        ...prior.map(
          b => b.low
        )
      );


    const priorHigh =
      Math.max(
        ...prior.map(
          b => b.high
        )
      );


    const effort =
      effortAt(
        bars,
        i,
        useVolume
      );


    const effortHit =
      effort >=
      avgEffort *
      SETTINGS.climaxEffortMult;


    const spreadHit =
      spread >=
      atr *
      SETTINGS.climaxSpreadMult;


    const scScore =

      (
        trend <= -15
          ?
          1
          :
          0
      )

      +

      (
        candle.low <=
        priorLow
          ?
          1
          :
          0
      )

      +

      (
        effortHit
          ?
          1
          :
          0
      )

      +

      (
        spreadHit
          ?
          1
          :
          0
      )

      +

      (
        closePos >= 0.35
          ?
          1
          :
          0
      )

      +

      (
        candle.close >
        candle.open
          ?
          1
          :
          0
      );


    const bcScore =

      (
        trend >= 15
          ?
          1
          :
          0
      )

      +

      (
        candle.high >=
        priorHigh
          ?
          1
          :
          0
      )

      +

      (
        effortHit
          ?
          1
          :
          0
      )

      +

      (
        spreadHit
          ?
          1
          :
          0
      )

      +

      (
        closePos <= 0.65
          ?
          1
          :
          0
      )

      +

      (
        candle.close <
        candle.open
          ?
          1
          :
          0
      );


    if (
      scScore >= 5
    ) {

      out.push({

        side:
          "ACCUM",

        index:
          i,

        score:
          scScore,

        trend,

        atr

      });

    }


    if (
      bcScore >= 5
    ) {

      out.push({

        side:
          "DIST",

        index:
          i,

        score:
          bcScore,

        trend,

        atr

      });

    }

  }


  return out;

}


/* =========================================================
   BUILD WYCKOFF CAMPAIGN
========================================================= */

function buildCampaign(
  bars,
  candidate,
  useVolume
) {

  const S =
    SETTINGS;


  const last =
    bars.length -
    1;


  const bullStop =
    candidate.side ===
    "ACCUM";


  const climax =
    bars[
      candidate.index
    ];


  const climaxPrice =
    bullStop
      ?
      climax.low
      :
      climax.high;


  const climaxEffort =
    effortAt(
      bars,
      candidate.index,
      useVolume
    );


  const climaxSpread =
    spreadAt(
      bars,
      candidate.index
    );


  const events = [

    makeEvent(

      bullStop
        ?
        "SC"
        :
        "BC",

      candidate.index,

      climaxPrice,

      candidate.score,

      bars

    )

  ];


  /* =======================================================
     ABSORPTION
  ======================================================= */

  let absorbed =
    false;


  for (

    let i =
      candidate.index +
      S.absorptionMinBars;

    i <=
      Math.min(
        candidate.index +
        S.absorptionMaxBars,
        last
      );

    i++

  ) {


    const recent =
      bars.slice(

        Math.max(
          candidate.index,
          i - 2
        ),

        i + 1

      );


    const recentLow =
      Math.min(
        ...recent.map(
          b => b.low
        )
      );


    const recentHigh =
      Math.max(
        ...recent.map(
          b => b.high
        )
      );


    if (

      bullStop

      &&

      recentLow >=
      climaxPrice -
      candidate.atr *
      S.absorptionExtremeATR

      &&

      bars[i].close >=
      climaxPrice +
      candidate.atr *
      S.absorptionReboundATR

    ) {

      absorbed =
        true;

      break;

    }


    if (

      !bullStop

      &&

      recentHigh <=
      climaxPrice +
      candidate.atr *
      S.absorptionExtremeATR

      &&

      bars[i].close <=
      climaxPrice -
      candidate.atr *
      S.absorptionReboundATR

    ) {

      absorbed =
        true;

      break;

    }

  }


  /* =======================================================
     AUTOMATIC RALLY / AUTOMATIC REACTION
  ======================================================= */

  let arIndex =
    -1;


  let arPrice =
    bullStop
      ?
      -Infinity
      :
      Infinity;


  const arEnd =
    Math.min(
      candidate.index +
      S.maxARBars,
      last
    );


  for (
    let i =
      candidate.index + 1;

    i <=
      arEnd;

    i++
  ) {


    if (

      bullStop

      &&

      bars[i].high >
      arPrice

    ) {

      arPrice =
        bars[i].high;

      arIndex =
        i;

    }

    else if (

      !bullStop

      &&

      bars[i].low <
      arPrice

    ) {

      arPrice =
        bars[i].low;

      arIndex =
        i;

    }

  }


  const arMoveATR =
    arIndex >= 0

      ?

      Math.abs(
        arPrice -
        climaxPrice
      )

      /

      Math.max(
        candidate.atr,
        1e-9
      )

      :

      0;


  const arOK =
    arMoveATR >=
    S.minARATR;


  let phase =
    1;


  let rangeLow =
    bullStop
      ?
      climaxPrice
      :
      arPrice;


  let rangeHigh =
    bullStop
      ?
      arPrice
      :
      climaxPrice;


  if (

    !Number.isFinite(
      rangeLow
    )

    ||

    !Number.isFinite(
      rangeHigh
    )

  ) {

    return {

      phase:
        1,

      phaseName:
        phaseName(
          1
        ),

      structure:
        bullStop
          ?
          "ACCUMULATION"
          :
          "DISTRIBUTION",

      direction:
        "WAIT",

      confidence:
        10,

      validation:
        0,

      range:
        null,

      trendScore:
        round(
          candidate.trend,
          2
        ),

      climaxSide:
        candidate.side,

      stats: {

        absorbed,

        arMoveATR:
          round(
            arMoveATR,
            2
          ),

        stCount:
          0,

        oppositeTests:
          0,

        traversals:
          0

      },

      events,

      entry:
        null,

      reasons: [
        "Climax found, but a valid automatic rally/reaction has not formed yet."
      ]

    };

  }


  /* =======================================================
     PHASE B / SECONDARY TEST
  ======================================================= */

  let stIndex =
    -1;


  let stPrice =
    NaN;


  let stCount =
    0;


  let oppCount =
    0;


  let traversals =
    0;


  let lastZone =
    0;


  const stEfforts =
    [];


  const stSpreads =
    [];


  if (
    absorbed &&
    arOK &&
    arIndex >= 0
  ) {


    for (

      let i =
        arIndex + 1;

      i <
        last -
        S.pivotLen;

      i++

    ) {


      const atr =
        atrAt(
          bars,
          i
        ) ||
        candidate.atr;


      const height =
        Math.max(
          rangeHigh -
          rangeLow,
          1e-9
        );


      const effort =
        effortAt(
          bars,
          i,
          useVolume
        );


      const spread =
        spreadAt(
          bars,
          i
        );


      if (

        bullStop

        &&

        isPivotLow(
          bars,
          i
        )

      ) {


        const near =

          Math.abs(
            bars[i].low -
            climaxPrice
          ) <=
          atr *
          S.boundaryTolATR

          ||

          bars[i].low <=
          rangeLow +
          height *
          S.phaseBZoneFrac;


        const holds =
          bars[i].low >=
          climaxPrice -
          atr *
          S.boundaryTolATR;


        const lowerEffort =
          effort <=
          climaxEffort *
          S.stMaxEffortRatio;


        const lowerSpread =
          spread <=
          climaxSpread *
          S.stMaxSpreadRatio;


        if (
          near &&
          holds &&
          lowerEffort &&
          lowerSpread
        ) {

          stCount++;

          stIndex =
            i;

          stPrice =
            bars[i].low;

          stEfforts.push(
            effort
          );

          stSpreads.push(
            spread
          );

        }

      }


      if (

        !bullStop

        &&

        isPivotHigh(
          bars,
          i
        )

      ) {


        const near =

          Math.abs(
            bars[i].high -
            climaxPrice
          ) <=
          atr *
          S.boundaryTolATR

          ||

          bars[i].high >=
          rangeHigh -
          height *
          S.phaseBZoneFrac;


        const holds =
          bars[i].high <=
          climaxPrice +
          atr *
          S.boundaryTolATR;


        const lowerEffort =
          effort <=
          climaxEffort *
          S.stMaxEffortRatio;


        const lowerSpread =
          spread <=
          climaxSpread *
          S.stMaxSpreadRatio;


        if (
          near &&
          holds &&
          lowerEffort &&
          lowerSpread
        ) {

          stCount++;

          stIndex =
            i;

          stPrice =
            bars[i].high;

          stEfforts.push(
            effort
          );

          stSpreads.push(
            spread
          );

        }

      }


      if (
        stCount > 0
      ) {


        if (

          bullStop

          &&

          isPivotHigh(
            bars,
            i
          )

          &&

          bars[i].high >=
          rangeHigh -
          atr *
          S.boundaryTolATR

        ) {

          oppCount++;

        }


        if (

          !bullStop

          &&

          isPivotLow(
            bars,
            i
          )

          &&

          bars[i].low <=
          rangeLow +
          atr *
          S.boundaryTolATR

        ) {

          oppCount++;

        }

      }


      let zone =
        0;


      if (

        isPivotLow(
          bars,
          i
        )

        &&

        bars[i].low <=
        rangeLow +
        height *
        S.phaseBZoneFrac

      ) {

        zone =
          -1;

      }


      if (

        isPivotHigh(
          bars,
          i
        )

        &&

        bars[i].high >=
        rangeHigh -
        height *
        S.phaseBZoneFrac

      ) {

        zone =
          1;

      }


      if (
        zone &&
        lastZone &&
        zone !== lastZone
      ) {

        traversals++;

      }


      if (
        zone
      ) {

        lastZone =
          zone;

      }

    }

  }


  if (
    stIndex >= 0
  ) {

    phase =
      2;


    events.push(

      makeEvent(
        "AR",
        arIndex,
        arPrice,
        null,
        bars
      )

    );


    events.push(

      makeEvent(

        "ST",

        stIndex,

        stPrice,

        Math.min(
          6,
          3 +
          stCount
        ),

        bars

      )

    );

  }


  const bAge =
    stIndex >= 0
      ?
      last -
      stIndex
      :
      0;


  const rangeATR =

    (
      rangeHigh -
      rangeLow
    )

    /

    Math.max(
      candidate.atr,
      1e-9
    );


  const matureB =

    phase >= 2

    &&

    stCount >=
    S.minPhaseBTests

    &&

    bAge >=
    S.minPhaseBBars

    &&

    (
      oppCount >=
      S.minOppositeTests

      ||

      traversals >=
      S.minTraversals
    )

    &&

    rangeATR >=
    S.phaseBRangeMinATR *
    0.75

    &&

    rangeATR <=
    S.phaseBRangeMaxATR *
    2;


  /* =======================================================
     PHASE C
  ======================================================= */

  let outcome =
    null;


  let excursion =
    null;


  let test =
    null;


  if (
    matureB
  ) {


    for (

      let i =
        Math.max(
          stIndex + 1,
          candidate.index +
          10
        );

      i <=
        last;

      i++

    ) {


      const atr =
        atrAt(
          bars,
          i
        ) ||
        candidate.atr;


      const spread =
        spreadAt(
          bars,
          i
        );


      const closePos =
        (
          bars[i].close -
          bars[i].low
        ) /
        spread;


      const avgEffort =
        avgEffortAt(
          bars,
          i,
          useVolume
        ) ||
        effortAt(
          bars,
          i,
          useVolume
        );


      const effort =
        effortAt(
          bars,
          i,
          useVolume
        );


      const lowerPen =
        rangeLow -
        bars[i].low;


      const upperPen =
        bars[i].high -
        rangeHigh;


      const spring =

        lowerPen >=
        atr *
        S.springMinPenATR

        &&

        lowerPen <=
        atr *
        S.springMaxPenATR

        &&

        bars[i].close >
        rangeLow

        &&

        closePos >=
        S.springCloseMin

        &&

        effort <=
        avgEffort *
        S.springEffortMax;


      const utad =

        upperPen >=
        atr *
        S.springMinPenATR

        &&

        upperPen <=
        atr *
        S.springMaxPenATR

        &&

        bars[i].close <
        rangeHigh

        &&

        closePos <=
        S.utadCloseMax

        &&

        effort <=
        avgEffort *
        S.springEffortMax;


      if (
        spring
      ) {

        excursion =
          makeEvent(

            "Spring",

            i,

            bars[i].low,

            3,

            bars

          );


        outcome =
          "BULL";


        phase =
          3;


        break;

      }


      if (
        utad
      ) {

        excursion =
          makeEvent(

            "UTAD",

            i,

            bars[i].high,

            3,

            bars

          );


        outcome =
          "BEAR";


        phase =
          3;


        break;

      }

    }

  }


  /* =======================================================
     SPRING / UTAD TEST
  ======================================================= */

  if (
    excursion
  ) {


    events.push(
      excursion
    );


    const excursionEffort =
      effortAt(
        bars,
        excursion.index,
        useVolume
      );


    const excursionSpread =
      spreadAt(
        bars,
        excursion.index
      );


    for (

      let i =
        excursion.index +
        1;

      i <
        last -
        S.pivotLen;

      i++

    ) {


      const atr =
        atrAt(
          bars,
          i
        ) ||
        candidate.atr;


      const spread =
        spreadAt(
          bars,
          i
        );


      const closePos =
        (
          bars[i].close -
          bars[i].low
        ) /
        spread;


      const effort =
        effortAt(
          bars,
          i,
          useVolume
        );


      if (

        outcome ===
        "BULL"

        &&

        isPivotLow(
          bars,
          i
        )

        &&

        bars[i].low <=
        rangeLow +
        atr *
        S.testTolATR

        &&

        bars[i].low >=
        excursion.price -
        atr *
        0.15

        &&

        effort <=
        excursionEffort *
        S.testMaxEffortRatio

        &&

        spread <=
        excursionSpread *
        S.testMaxSpreadRatio

        &&

        closePos >=
        0.5

      ) {

        test =
          makeEvent(

            "Test",

            i,

            bars[i].low,

            3,

            bars

          );


        break;

      }


      if (

        outcome ===
        "BEAR"

        &&

        isPivotHigh(
          bars,
          i
        )

        &&

        bars[i].high >=
        rangeHigh -
        atr *
        S.testTolATR

        &&

        bars[i].high <=
        excursion.price +
        atr *
        0.15

        &&

        effort <=
        excursionEffort *
        S.testMaxEffortRatio

        &&

        spread <=
        excursionSpread *
        S.testMaxSpreadRatio

        &&

        closePos <=
        0.5

      ) {

        test =
          makeEvent(

            "Test",

            i,

            bars[i].high,

            3,

            bars

          );


        break;

      }

    }

  }


  /* =======================================================
     NO-SPRING / NO-UTAD C-TEST
  ======================================================= */

  if (
    matureB &&
    !outcome
  ) {


    const scanFrom =
      Math.max(
        stIndex + 3,
        last - 80
      );


    for (

      let i =
        scanFrom;

      i <
        last -
        S.pivotLen;

      i++

    ) {


      const atr =
        atrAt(
          bars,
          i
        ) ||
        candidate.atr;


      const avgEffort =
        avgEffortAt(
          bars,
          i,
          useVolume
        );


      const effort =
        effortAt(
          bars,
          i,
          useVolume
        );


      if (
        !Number.isFinite(
          avgEffort
        )
      ) {

        continue;

      }


      if (

        isPivotLow(
          bars,
          i
        )

        &&

        bars[i].low <=
        rangeLow +
        atr *
        S.testTolATR

        &&

        bars[i].low >=
        rangeLow -
        atr *
        0.15

        &&

        effort <=
        avgEffort *
        0.9

      ) {

        outcome =
          "BULL";


        test =
          makeEvent(

            "C-Test",

            i,

            bars[i].low,

            2,

            bars

          );


        phase =
          3;


        break;

      }


      if (

        isPivotHigh(
          bars,
          i
        )

        &&

        bars[i].high >=
        rangeHigh -
        atr *
        S.testTolATR

        &&

        bars[i].high <=
        rangeHigh +
        atr *
        0.15

        &&

        effort <=
        avgEffort *
        0.9

      ) {

        outcome =
          "BEAR";


        test =
          makeEvent(

            "C-Test",

            i,

            bars[i].high,

            2,

            bars

          );


        phase =
          3;


        break;

      }

    }

  }


  if (
    test
  ) {

    events.push(
      test
    );

  }


  /* =======================================================
     PHASE D / SOS / SOW
  ======================================================= */

  let strength =
    null;


  if (
    phase >= 3 &&
    outcome
  ) {


    const anchor =
      test?.index ??
      excursion?.index ??
      stIndex;


    const rangeHeight =
      Math.max(
        rangeHigh -
        rangeLow,
        1e-9
      );


    for (

      let i =
        anchor + 1;

      i <=
        last;

      i++

    ) {


      const atr =
        atrAt(
          bars,
          i
        ) ||
        candidate.atr;


      const spread =
        spreadAt(
          bars,
          i
        );


      const closePos =
        (
          bars[i].close -
          bars[i].low
        ) /
        spread;


      const avgEffort =
        avgEffortAt(
          bars,
          i,
          useVolume
        ) ||
        effortAt(
          bars,
          i,
          useVolume
        );


      const effort =
        effortAt(
          bars,
          i,
          useVolume
        );


      const domUp =
        rangeLow +
        rangeHeight *
        S.phaseDDominanceFrac;


      const domDown =
        rangeHigh -
        rangeHeight *
        S.phaseDDominanceFrac;


      const sos =

        outcome ===
        "BULL"

        &&

        (
          bars[i].close >
          rangeHigh +
          atr *
          S.breakATR

          ||

          bars[i].close >=
          domUp
        )

        &&

        effort >=
        avgEffort *
        S.strengthEffortMult

        &&

        spread >=
        atr *
        S.strengthSpreadATR

        &&

        closePos >=
        S.sosCloseMin;


      const sow =

        outcome ===
        "BEAR"

        &&

        (
          bars[i].close <
          rangeLow -
          atr *
          S.breakATR

          ||

          bars[i].close <=
          domDown
        )

        &&

        effort >=
        avgEffort *
        S.strengthEffortMult

        &&

        spread >=
        atr *
        S.strengthSpreadATR

        &&

        closePos <=
        S.sowCloseMax;


      if (
        sos
      ) {

        strength =
          makeEvent(

            "SOS",

            i,

            bars[i].high,

            3,

            bars

          );


        phase =
          4;


        break;

      }


      if (
        sow
      ) {

        strength =
          makeEvent(

            "SOW",

            i,

            bars[i].low,

            3,

            bars

          );


        phase =
          4;


        break;

      }

    }

  }


  if (
    strength
  ) {

    events.push(
      strength
    );

  }


  /* =======================================================
     LPS / LPSY
  ======================================================= */

  let lps =
    null;


  if (
    strength
  ) {


    for (

      let i =
        strength.index +
        1;

      i <
        last -
        S.pivotLen;

      i++

    ) {


      const atr =
        atrAt(
          bars,
          i
        ) ||
        candidate.atr;


      const avgEffort =
        avgEffortAt(
          bars,
          i,
          useVolume
        ) ||
        effortAt(
          bars,
          i,
          useVolume
        );


      const effort =
        effortAt(
          bars,
          i,
          useVolume
        );


      const spread =
        spreadAt(
          bars,
          i
        );


      const closePos =
        (
          bars[i].close -
          bars[i].low
        ) /
        spread;


      if (

        outcome ===
        "BULL"

        &&

        isPivotLow(
          bars,
          i
        )

        &&

        bars[i].low >=
        rangeHigh -
        atr *
        S.lpsBoundaryATR

        &&

        effort <=
        avgEffort

        &&

        spread <=
        atr

        &&

        closePos >=
        0.45

      ) {

        lps =
          makeEvent(

            "LPS",

            i,

            bars[i].low,

            2,

            bars

          );


        break;

      }


      if (

        outcome ===
        "BEAR"

        &&

        isPivotHigh(
          bars,
          i
        )

        &&

        bars[i].high <=
        rangeLow +
        atr *
        S.lpsBoundaryATR

        &&

        effort <=
        avgEffort

        &&

        spread <=
        atr

        &&

        closePos <=
        0.55

      ) {

        lps =
          makeEvent(

            "LPSY",

            i,

            bars[i].high,

            2,

            bars

          );


        break;

      }

    }

  }


  if (
    lps
  ) {

    events.push(
      lps
    );

  }


  /* =======================================================
     PHASE E
  ======================================================= */

  let phaseEIndex =
    -1;


  if (
    phase >= 4 &&
    outcome
  ) {


    let count =
      0;


    const start =
      Math.max(

        strength?.index ??
        0,

        last - 30

      );


    for (
      let i =
        start;

      i <=
        last;

      i++
    ) {


      if (
        outcome ===
        "BULL"
      ) {

        count =
          bars[i].close >
          rangeHigh

            ?

            count + 1

            :

            0;

      }

      else {

        count =
          bars[i].close <
          rangeLow

            ?

            count + 1

            :

            0;

      }


      if (
        count >=
        S.confirmBars
      ) {

        phase =
          5;


        phaseEIndex =
          i;


        break;

      }

    }

  }


  if (
    phaseEIndex >= 0
  ) {

    events.push(

      makeEvent(

        "Phase E",

        phaseEIndex,

        bars[
          phaseEIndex
        ].close,

        null,

        bars

      )

    );

  }


  /* =======================================================
     CONFIDENCE
  ======================================================= */

  let confidence =
    10;


  confidence +=
    absorbed
      ?
      15
      :
      0;


  confidence +=
    arOK
      ?
      10
      :
      0;


  confidence +=
    stIndex >= 0
      ?
      15
      :
      0;


  confidence +=
    phase >= 3
      ?
      15
      :
      0;


  confidence +=
    strength
      ?
      15
      :
      0;


  confidence +=
    lps
      ?
      10
      :
      0;


  confidence +=
    phase >= 5
      ?
      10
      :
      0;


  confidence =
    clamp(
      confidence,
      0,
      100
    );


  /* =======================================================
     VALIDATION
  ======================================================= */

  let validation =
    0;


  const absTrend =
    Math.abs(
      candidate.trend
    );


  validation +=

    absTrend >= 35

      ?

      10

      :

      absTrend >= 15

        ?

        5

        :

        0;


  validation +=
    absorbed
      ?
      15
      :
      0;


  validation +=

    rangeATR >=
      S.phaseBRangeMinATR

    &&

    rangeATR <=
      S.phaseBRangeMaxATR

      ?

      10

      :

      rangeATR >=
        S.phaseBRangeMinATR *
        0.75

      &&

      rangeATR <=
        S.phaseBRangeMaxATR *
        1.5

        ?

        5

        :

        0;


  validation +=

    stCount >= 2

      ?

      15

      :

      stCount >= 1

        ?

        8

        :

        0;


  validation +=

    oppCount >= 1 &&
    traversals >= 2

      ?

      15

      :

      (
        oppCount >= 1 ||
        traversals >= 1
      )

        ?

        8

        :

        0;


  validation +=
    matureB
      ?
      10
      :
      0;


  validation +=
    phase >= 3
      ?
      10
      :
      0;


  validation +=
    strength
      ?
      10
      :
      0;


  validation +=
    lps
      ?
      5
      :
      0;


  validation +=
    phase >= 5
      ?
      10
      :
      0;


  validation =
    clamp(
      validation,
      0,
      100
    );


  /* =======================================================
     STRUCTURE / DIRECTION
  ======================================================= */

  const continuation =
    bullStop
      ?
      candidate.trend >
      15
      :
      candidate.trend <
      -15;


  const structuralDirection =

    outcome

    ||

    (
      bullStop
        ?
        "BULL"
        :
        "BEAR"
    );


  const structure =
    structureName(
      structuralDirection,
      continuation
    );


  let direction =
    "WAIT";


  if (
    outcome ===
    "BULL" &&
    phase >= 3
  ) {

    direction =
      "BUY";

  }


  if (
    outcome ===
    "BEAR" &&
    phase >= 3
  ) {

    direction =
      "SELL";

  }


  /* =======================================================
     TRADE SETUP
  ======================================================= */

  let entry =
    null;


  const trigger =
    lps ||
    test ||
    strength;


  if (

    trigger

    &&

    direction !==
    "WAIT"

    &&

    confidence >=
    S.minConfidence

    &&

    validation >=
    S.minValidation

  ) {


    const current =
      bars[last];


    const atr =
      atrAt(
        bars,
        last
      ) ||
      candidate.atr;


    const entryPrice =
      current.close;


    let stop;


    if (
      direction ===
      "BUY"
    ) {


      const hard =
        Math.min(

          rangeLow,

          excursion?.price ??
          rangeLow

        );


      stop =
        Math.min(

          hard -
          atr *
          0.2,

          entryPrice -
          atr *
          1.15

        );

    }

    else {


      const hard =
        Math.max(

          rangeHigh,

          excursion?.price ??
          rangeHigh

        );


      stop =
        Math.max(

          hard +
          atr *
          0.2,

          entryPrice +
          atr *
          1.15

        );

    }


    const risk =
      Math.max(

        Math.abs(
          entryPrice -
          stop
        ),

        atr *
        0.5

      );


    const sign =
      direction ===
      "BUY"
        ?
        1
        :
        -1;


    entry = {

      side:
        direction,

      trigger:
        trigger.label,

      price:
        round(
          entryPrice,
          4
        ),

      stop:
        round(
          stop,
          4
        ),

      tp1:
        round(

          entryPrice +

          sign *
          risk *
          S.rr1,

          4

        ),

      tp2:
        round(

          entryPrice +

          sign *
          risk *
          S.rr2,

          4

        ),

      risk:
        round(
          risk,
          4
        ),

      rr1:
        S.rr1,

      rr2:
        S.rr2

    };

  }


  /* =======================================================
     REASONING
  ======================================================= */

  const reasons = [];


  reasons.push(

    bullStop

      ?

      "Selling climax candidate detected after bearish pressure."

      :

      "Buying climax candidate detected after bullish pressure."

  );


  reasons.push(

    absorbed

      ?

      "Post-climax absorption confirmed."

      :

      "Post-climax absorption is not fully confirmed."

  );


  if (
    arOK
  ) {

    reasons.push(

      `Automatic ${bullStop ? "rally" : "reaction"} moved ${round(arMoveATR, 2)} ATR.`

    );

  }


  if (
    stCount
  ) {

    reasons.push(

      `${stCount} climax-side secondary test${stCount === 1 ? "" : "s"} detected.`

    );

  }


  if (
    oppCount ||
    traversals
  ) {

    reasons.push(

      `Phase B contains ${oppCount} opposite-edge test${oppCount === 1 ? "" : "s"} and ${traversals} traversal${traversals === 1 ? "" : "s"}.`

    );

  }


  if (
    excursion
  ) {

    reasons.push(

      `${excursion.label} broke the range and reclaimed it.`

    );

  }


  if (
    test
  ) {

    reasons.push(

      `${test.label} confirmed the Phase C route.`

    );

  }


  if (
    strength
  ) {

    reasons.push(

      `${strength.label} confirmed Phase D directional strength.`

    );

  }


  if (
    lps
  ) {

    reasons.push(

      `${lps.label} confirmed a low-effort pullback after strength.`

    );

  }


  if (
    phase >= 5
  ) {

    reasons.push(

      "Price achieved multi-bar acceptance outside the range."

    );

  }


  if (
    !useVolume
  ) {

    reasons.push(

      "This feed has no usable volume, so candle spread is used as the Wyckoff effort proxy."

    );

  }


  return {

    phase,

    phaseName:
      phaseName(
        phase
      ),

    structure,

    direction,

    confidence,

    validation,

    range: {

      low:
        round(
          rangeLow,
          4
        ),

      high:
        round(
          rangeHigh,
          4
        ),

      heightATR:
        round(
          rangeATR,
          2
        )

    },

    trendScore:
      round(
        candidate.trend,
        2
      ),

    climaxSide:
      candidate.side,

    volumeMode:
      useVolume
        ?
        "VOLUME"
        :
        "SPREAD_PROXY",

    stats: {

      absorbed,

      arMoveATR:
        round(
          arMoveATR,
          2
        ),

      stCount,

      oppositeTests:
        oppCount,

      traversals,

      phaseBAge:
        bAge,

      maturePhaseB:
        matureB

    },

    events,

    entry,

    reasons

  };

}


/* =========================================================
   ANALYZE ONE TIMEFRAME
========================================================= */

function analyzeBars(
  bars
) {

  if (

    !Array.isArray(
      bars
    )

    ||

    bars.length <
    120

  ) {

    return {

      phase:
        0,

      phaseName:
        "None",

      structure:
        "SEARCHING",

      direction:
        "WAIT",

      confidence:
        0,

      validation:
        0,

      range:
        null,

      events:
        [],

      entry:
        null,

      reasons: [
        "Not enough candles to build a Wyckoff campaign."
      ]

    };

  }


  const useVolume =
    hasRealVolume(
      bars
    );


  const climaxes =
    findClimaxes(
      bars,
      useVolume
    );


  if (
    !climaxes.length
  ) {

    return {

      phase:
        0,

      phaseName:
        "None",

      structure:
        "SEARCHING",

      direction:
        "WAIT",

      confidence:
        0,

      validation:
        0,

      range:
        null,

      volumeMode:
        useVolume
          ?
          "VOLUME"
          :
          "SPREAD_PROXY",

      events:
        [],

      entry:
        null,

      reasons: [

        "No valid selling or buying climax was detected in the active lookback.",

        ...(
          useVolume

            ?

            []

            :

            [
              "This feed has no usable volume, so candle spread is used as the Wyckoff effort proxy."
            ]
        )

      ]

    };

  }


  let best =
    null;


  for (
    const candidate
    of climaxes.slice(
      -20
    )
  ) {


    const campaign =
      buildCampaign(
        bars,
        candidate,
        useVolume
      );


    const score =

      campaign.phase *
      100

      +

      campaign.validation

      +

      campaign.confidence *
      0.25

      +

      candidate.index *
      0.0001;


    if (
      !best ||
      score >
      best.score
    ) {

      best = {

        score,

        campaign

      };

    }

  }


  return (
    best.campaign
  );

}


/* =========================================================
   MTF UTILITY
========================================================= */

function utility(
  row,
  requestedTf
) {

  const analysis =
    row.analysis;


  let score =

    (
      analysis.validation ||
      0
    )

    +

    (
      analysis.confidence ||
      0
    ) *
    0.25

    +

    (
      analysis.phase ||
      0
    ) *
    8;


  if (
    row.tf ===
    requestedTf
  ) {

    score +=
      5;

  }


  if (
    analysis.phase ===
    5
  ) {

    score -=
      5;

  }


  if (
    analysis.direction ===
    "WAIT"
  ) {

    score -=
      5;

  }


  return score;

}


function chooseEffective(
  rows,
  requestedTf
) {

  let best =
    null;


  for (
    const row
    of rows
  ) {


    const current = {

      ...row,

      utility:
        utility(
          row,
          requestedTf
        )

    };


    if (
      !best
    ) {

      best =
        current;

      continue;

    }


    if (

      current.analysis.phase >
      best.analysis.phase

    ) {

      best =
        current;

    }

    else if (

      current.analysis.phase ===
      best.analysis.phase

      &&

      current.utility >
      best.utility

    ) {

      best =
        current;

    }

  }


  return best;

}


/* =========================================================
   VERCEL ENDPOINT
========================================================= */

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );


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


  if (
    req.method ===
    "OPTIONS"
  ) {

    return res
      .status(204)
      .end();

  }


  try {


    const symbol =
      normalizeSymbol(

        req.query?.symbol ||
        "XAU/USD"

      );


    const requestedTf =

      TF_CHAIN[
        req.query?.tf
      ]

        ?

        req.query.tf

        :

        "5m";


    const chain =
      TF_CHAIN[
        requestedTf
      ];


    const rows =
      await Promise.all(

        chain.map(

          async (
            tf
          ) => {


            const bars =
              await fetchSeries(
                symbol,
                tf
              );


            return {

              tf,

              bars,

              analysis:
                analyzeBars(
                  bars
                )

            };

          }

        )

      );


    const selected =
      chooseEffective(
        rows,
        requestedTf
      );


    if (
      !selected
    ) {

      throw new Error(
        "No timeframe analysis was available."
      );

    }


    const current =
      selected.bars.at(
        -1
      );


    return res
      .status(200)
      .json({

        ok:
          true,

        engine:
          "MKAYFX WYCKOFF V2.1",

        generatedAt:
          new Date()
            .toISOString(),

        symbol,

        requestedTf,

        selectedTf:
          selected.tf,

        mtfActive:
          selected.tf !==
          requestedTf,

        price:
          round(
            current?.close,
            4
          ),

        analysis:
          selected.analysis,

        timeframes:

          rows.map(

            (
              row
            ) => ({

              tf:
                row.tf,

              phase:
                row.analysis.phase,

              phaseName:
                row.analysis.phaseName,

              structure:
                row.analysis.structure,

              direction:
                row.analysis.direction,

              confidence:
                row.analysis.confidence ||
                0,

              validation:
                row.analysis.validation ||
                0,

              volumeMode:
                row.analysis.volumeMode ||
                null

            })

          ),

        candles:

          selected.bars

            .slice(
              -220
            )

            .map(

              (
                bar
              ) => ({

                time:
                  bar.time,

                open:
                  round(
                    bar.open,
                    4
                  ),

                high:
                  round(
                    bar.high,
                    4
                  ),

                low:
                  round(
                    bar.low,
                    4
                  ),

                close:
                  round(
                    bar.close,
                    4
                  ),

                volume:
                  Number.isFinite(
                    bar.volume
                  )

                    ?

                    bar.volume

                    :

                    0

              })

            )

      });

  }

  catch (
    error
  ) {


    console.error(
      "WYCKOFF ERROR",
      error
    );


    return res
      .status(500)
      .json({

        ok:
          false,

        engine:
          "MKAYFX WYCKOFF V2.1",

        error:

          error instanceof Error

            ?

            error.message

            :

            String(
              error
            )

      });

  }

}