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
  "1m": ["1m", "5m", "15m"],
  "3m": ["3m", "5m", "15m"],
  "5m": ["5m", "15m", "1h"],
  "15m": ["15m", "1h", "4h"],
  "30m": ["30m", "1h", "4h"],
  "1h": ["1h", "4h", "1D"],
  "2h": ["2h", "4h", "1D"],
  "4h": ["4h", "1D"],
  "1D": ["1D"]
};

const CFG = {
  outputSize: 500,

  atrLen: 14,

  effortLen: 50,

  pivotLen: 4,

  trendLen: 70,

  extremeLen: 30,

  climaxEffortMult: 1.45,

  climaxSpreadMult: 1.20,

  absorptionBars: 8,

  minArAtr: 1.35,

  maxArBars: 32,

  boundaryTolAtr: 0.85,

  phaseBZoneFrac: 0.28,

  minPhaseBBars: 18,

  springMinAtr: 0.10,

  springMaxAtr: 2.60,

  testTolAtr: 1.15,

  strengthEffortMult: 1.05,

  strengthSpreadAtr: 0.85,

  breakAtr: 0.10,

  maxCampaignBars: 260,

  maxEventAgeBars: 90,

  minConfidence: 55,

  minValidation: 45,

  rr1: 1.5,

  rr2: 2.5
};


/* =========================================================
   BASIC HELPERS
========================================================= */

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


function round(
  value,
  digits = 2
) {

  const n =
    Number(
      value
    );


  return Number.isFinite(
    n
  )
    ?
    Number(
      n.toFixed(
        digits
      )
    )
    :
    null;

}


function mean(
  values
) {

  const usable =
    values.filter(
      Number.isFinite
    );


  if (
    !usable.length
  ) {

    return NaN;

  }


  return usable.reduce(
    (
      total,
      value
    ) =>
      total + value,
    0
  ) / usable.length;

}


/* =========================================================
   SAFE ERROR TEXT
========================================================= */

function safeText(
  value
) {

  if (
    value == null
  ) {

    return "";

  }


  if (
    typeof value ===
    "string"
  ) {

    return value;

  }


  if (
    value instanceof Error
  ) {

    return (
      value.message ||
      String(
        value
      )
    );

  }


  if (
    typeof value ===
      "number"

    ||

    typeof value ===
      "boolean"
  ) {

    return String(
      value
    );

  }


  if (
    typeof value ===
    "object"
  ) {


    const nested =

      value.message

      ??

      value.error

      ??

      value.detail

      ??

      value.description;


    if (
      nested !==
      undefined

      &&

      nested !==
      value
    ) {


      const text =
        safeText(
          nested
        );


      if (
        text
      ) {

        return text;

      }

    }


    try {

      return JSON.stringify(
        value
      );

    }

    catch {

      return String(
        value
      );

    }

  }


  return String(
    value
  );

}


/* =========================================================
   SYMBOLS
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
    aliases[
      raw
    ]

    ||

    raw
  );

}


function queryValue(
  value,
  fallback
) {

  if (
    Array.isArray(
      value
    )
  ) {

    return (
      value[0]

      ??

      fallback
    );

  }


  if (
    value ===
    undefined

    ||

    value ===
    null

    ||

    value ===
    ""
  ) {

    return fallback;

  }


  return value;

}


/* =========================================================
   TIME
========================================================= */

function timeMs(
  value
) {

  if (
    !value
  ) {

    return NaN;

  }


  const text =
    String(
      value
    )
      .trim()
      .replace(
        " ",
        "T"
      );


  const normalized =

    /Z$|[+-]\d\d:\d\d$/.test(
      text
    )

      ?

      text

      :

      `${text}Z`;


  return new Date(
    normalized
  ).getTime();

}


/* =========================================================
   HTTP
========================================================= */

async function fetchJson(
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

            Accept:
              "application/json"

          }

        }

      );


    const raw =
      await response.text();


    let data =
      {};


    if (
      raw
    ) {


      try {

        data =
          JSON.parse(
            raw
          );

      }

      catch {

        throw new Error(

          `Provider returned non-JSON HTTP ${response.status}: ${raw.slice(0, 220)}`

        );

      }

    }


    if (

      !response.ok

      ||

      data?.status ===
      "error"

    ) {


      throw new Error(

        safeText(
          data?.message
        )

        ||

        safeText(
          data?.error
        )

        ||

        safeText(
          data
        )

        ||

        `HTTP ${response.status}`

      );

    }


    return data;

  }

  catch (
    error
  ) {


    if (
      error?.name ===
      "AbortError"
    ) {

      throw new Error(
        "Market-data request timed out."
      );

    }


    throw new Error(

      safeText(
        error
      )

      ||

      "Unknown market-data error."

    );

  }

  finally {

    clearTimeout(
      timer
    );

  }

}


/* =========================================================
   FETCH MARKET DATA
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
    TF_MAP[
      tf
    ];


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
          CFG.outputSize
        ),

      timezone:
        "UTC",

      format:
        "JSON",

      apikey:
        apiKey

    });


  const data =
    await fetchJson(

      `${BASE_URL}/time_series?${params.toString()}`

    );


  if (
    !Array.isArray(
      data.values
    )
  ) {

    throw new Error(

      `${tf}: no candle values were returned for ${symbol}.`

    );

  }


  const bars =

    data.values

      .map(
        item => ({

          time:
            String(
              item.datetime ||
              ""
            ),

          open:
            Number(
              item.open
            ),

          high:
            Number(
              item.high
            ),

          low:
            Number(
              item.low
            ),

          close:
            Number(
              item.close
            ),

          volume:
            Number(
              item.volume ||
              0
            )

        })
      )

      .filter(
        bar =>
          [
            bar.open,
            bar.high,
            bar.low,
            bar.close
          ].every(
            Number.isFinite
          )
      )

      .sort(
        (
          a,
          b
        ) =>

          timeMs(
            a.time
          )

          -

          timeMs(
            b.time
          )
      );


  if (
    bars.length <
    100
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
  index
) {

  if (
    index <=
    0
  ) {

    return Math.max(

      bars[index].high -
      bars[index].low,

      1e-9

    );

  }


  return Math.max(

    bars[index].high -
    bars[index].low,

    Math.abs(

      bars[index].high -
      bars[index - 1].close

    ),

    Math.abs(

      bars[index].low -
      bars[index - 1].close

    )

  );

}


function atrAt(
  bars,
  index,
  length = CFG.atrLen
) {

  if (
    index <
    length
  ) {

    return NaN;

  }


  const values =
    [];


  for (
    let i =
      index -
      length +
      1;

    i <=
      index;

    i++
  ) {

    values.push(

      trueRange(
        bars,
        i
      )

    );

  }


  return mean(
    values
  );

}


function spreadAt(
  bars,
  index
) {

  return Math.max(

    bars[index].high -
    bars[index].low,

    1e-9

  );

}


function useRealVolume(
  bars
) {

  return bars

    .slice(
      -120
    )

    .some(
      bar =>

        Number.isFinite(
          bar.volume
        )

        &&

        bar.volume >
        0

    );

}


function effortAt(
  bars,
  index,
  useVolume
) {

  return useVolume

    ?

    Math.max(

      Number(
        bars[index].volume
      )
      ||
      0,

      0

    )

    :

    spreadAt(
      bars,
      index
    );

}


function avgEffortAt(
  bars,
  index,
  useVolume,
  length = CFG.effortLen
) {

  if (
    index <
    length -
    1
  ) {

    return NaN;

  }


  const values =
    [];


  for (
    let i =
      index -
      length +
      1;

    i <=
      index;

    i++
  ) {

    values.push(

      effortAt(
        bars,
        i,
        useVolume
      )

    );

  }


  return mean(
    values
  );

}


/* =========================================================
   PIVOTS
========================================================= */

function isPivotLow(
  bars,
  index,
  length = CFG.pivotLen
) {

  if (

    index <
    length

    ||

    index +
    length >=
    bars.length

  ) {

    return false;

  }


  const price =
    bars[index].low;


  for (
    let i =
      index -
      length;

    i <=
      index +
      length;

    i++
  ) {

    if (

      i !==
      index

      &&

      bars[i].low <
      price

    ) {

      return false;

    }

  }


  return true;

}


function isPivotHigh(
  bars,
  index,
  length = CFG.pivotLen
) {

  if (

    index <
    length

    ||

    index +
    length >=
    bars.length

  ) {

    return false;

  }


  const price =
    bars[index].high;


  for (
    let i =
      index -
      length;

    i <=
      index +
      length;

    i++
  ) {

    if (

      i !==
      index

      &&

      bars[i].high >
      price

    ) {

      return false;

    }

  }


  return true;

}


/* =========================================================
   TREND SCORE
========================================================= */

function priorTrendScore(
  bars,
  index,
  length = CFG.trendLen
) {

  const start =
    Math.max(
      0,
      index -
      length
    );


  if (
    index -
    start <
    20
  ) {

    return 0;

  }


  const first =
    bars[start].close;


  const last =
    bars[index].close;


  const atr =

    atrAt(
      bars,
      index
    )

    ||

    spreadAt(
      bars,
      index
    );


  let path =
    0;


  for (
    let i =
      start +
      1;

    i <=
      index;

    i++
  ) {

    path +=

      Math.abs(

        bars[i].close -
        bars[i - 1].close

      );

  }


  const net =
    last -
    first;


  const efficiency =

    path >
    0

      ?

      Math.abs(
        net
      )
      /
      path

      :

      0;


  const displacement =

    clamp(

      net

      /

      Math.max(

        atr

        *

        Math.sqrt(
          index -
          start +
          1
        ),

        1e-9

      ),

      -3,

      3

    )

    *

    18;


  const directional =

    (
      net >=
      0

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
   DISPLAY NAMES
========================================================= */

function phaseName(
  phase
) {

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

  })[
    phase
  ]

  ||

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


/* =========================================================
   EVENTS
========================================================= */

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
   EMPTY RESULT
========================================================= */

function emptyAnalysis(
  reason,
  useVolume = null
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

    trendScore:
      0,

    range:
      null,

    stats:
      {},

    volumeMode:

      useVolume ==
      null

        ?

        null

        :

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
      reason
    ]

  };

}


/* =========================================================
   CLIMAX DETECTION
========================================================= */

function findClimaxes(
  bars,
  useVolume
) {

  const results =
    [];


  const start =
    Math.max(

      CFG.effortLen +
      CFG.extremeLen +
      10,

      bars.length -
      380

    );


  for (
    let i =
      start;

    i <
      bars.length -
      CFG.pivotLen;

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
      )

      ||

      !Number.isFinite(
        avgEffort
      )

      ||

      atr <=
      0

      ||

      avgEffort <=
      0

    ) {

      continue;

    }


    const bar =
      bars[i];


    const spread =
      spreadAt(
        bars,
        i
      );


    const closePos =
      (
        bar.close -
        bar.low
      )
      /
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
          CFG.extremeLen
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
          bar =>
            bar.low
        )
      );


    const priorHigh =
      Math.max(
        ...prior.map(
          bar =>
            bar.high
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
      CFG.climaxEffortMult;


    const spreadHit =
      spread >=
      atr *
      CFG.climaxSpreadMult;


    const sellingClimaxScore =

      (
        trend <=
        -12
          ?
          1
          :
          0
      )

      +

      (
        bar.low <=
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
        closePos >=
        0.32
          ?
          1
          :
          0
      )

      +

      (
        bar.close >=
        bar.open
          ?
          1
          :
          0
      );


    const buyingClimaxScore =

      (
        trend >=
        12
          ?
          1
          :
          0
      )

      +

      (
        bar.high >=
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
        closePos <=
        0.68
          ?
          1
          :
          0
      )

      +

      (
        bar.close <=
        bar.open
          ?
          1
          :
          0
      );


    if (
      sellingClimaxScore >=
      4
    ) {

      results.push({

        side:
          "ACCUM",

        index:
          i,

        score:
          sellingClimaxScore,

        trend,

        atr

      });

    }


    if (
      buyingClimaxScore >=
      4
    ) {

      results.push({

        side:
          "DIST",

        index:
          i,

        score:
          buyingClimaxScore,

        trend,

        atr

      });

    }

  }


  return results;

}


/* =========================================================
   BUILD CAMPAIGN
========================================================= */

function buildCampaign(
  bars,
  candidate,
  useVolume
) {

  const last =
    bars.length -
    1;


  const campaignAge =
    last -
    candidate.index;


  if (
    campaignAge >
    CFG.maxCampaignBars
  ) {

    return null;

  }


  const bullStop =
    candidate.side ===
    "ACCUM";


  const climaxBar =
    bars[
      candidate.index
    ];


  const climaxPrice =
    bullStop
      ?
      climaxBar.low
      :
      climaxBar.high;


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
      2;

    i <=
      Math.min(
        candidate.index +
        CFG.absorptionBars,
        last
      );

    i++

  ) {


    const recent =
      bars.slice(

        candidate.index,

        i +
        1

      );


    const low =
      Math.min(
        ...recent.map(
          bar =>
            bar.low
        )
      );


    const high =
      Math.max(
        ...recent.map(
          bar =>
            bar.high
        )
      );


    if (

      bullStop

      &&

      low >=
      climaxPrice -
      candidate.atr *
      0.65

      &&

      bars[i].close >=
      climaxPrice +
      candidate.atr *
      0.25

    ) {

      absorbed =
        true;

      break;

    }


    if (

      !bullStop

      &&

      high <=
      climaxPrice +
      candidate.atr *
      0.65

      &&

      bars[i].close <=
      climaxPrice -
      candidate.atr *
      0.25

    ) {

      absorbed =
        true;

      break;

    }

  }


  /* =======================================================
     AUTOMATIC RALLY / REACTION
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
      CFG.maxArBars,

      last

    );


  for (
    let i =
      candidate.index +
      1;

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


    if (

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


  const arMoveAtr =

    arIndex >=
    0

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


  const arOk =
    arMoveAtr >=
    CFG.minArAtr;


  let phase =
    1;


  const rangeLow =
    bullStop
      ?
      climaxPrice
      :
      arPrice;


  const rangeHigh =
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

    ||

    rangeHigh <=
    rangeLow

  ) {

    return {

      ...emptyAnalysis(

        "Climax detected; waiting for a valid Automatic Rally/Reaction.",

        useVolume

      ),

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

      confidence:
        10,

      trendScore:
        round(
          candidate.trend,
          1
        ),

      events

    };

  }


  /* =======================================================
     SECONDARY TESTS / PHASE B
  ======================================================= */

  let stIndex =
    -1;


  let stPrice =
    NaN;


  let stCount =
    0;


  let oppositeTests =
    0;


  let traversals =
    0;


  let lastZone =
    0;


  if (

    absorbed

    &&

    arOk

    &&

    arIndex >=
    0

  ) {


    for (

      let i =
        arIndex +
        1;

      i <
        last -
        CFG.pivotLen;

      i++

    ) {


      const atr =

        atrAt(
          bars,
          i
        )

        ||

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
          )
          <=
          atr *
          CFG.boundaryTolAtr

          ||

          bars[i].low <=
          rangeLow +
          height *
          CFG.phaseBZoneFrac;


        const holds =
          bars[i].low >=
          climaxPrice -
          atr *
          CFG.boundaryTolAtr;


        const effortOk =
          effort <=
          climaxEffort *
          1.10;


        const spreadOk =
          spread <=
          climaxSpread *
          1.10;


        if (

          near

          &&

          holds

          &&

          effortOk

          &&

          spreadOk

        ) {

          stCount++;


          stIndex =
            i;


          stPrice =
            bars[i].low;

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
          )
          <=
          atr *
          CFG.boundaryTolAtr

          ||

          bars[i].high >=
          rangeHigh -
          height *
          CFG.phaseBZoneFrac;


        const holds =
          bars[i].high <=
          climaxPrice +
          atr *
          CFG.boundaryTolAtr;


        const effortOk =
          effort <=
          climaxEffort *
          1.10;


        const spreadOk =
          spread <=
          climaxSpread *
          1.10;


        if (

          near

          &&

          holds

          &&

          effortOk

          &&

          spreadOk

        ) {

          stCount++;


          stIndex =
            i;


          stPrice =
            bars[i].high;

        }

      }


      if (
        stCount >
        0
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
          CFG.boundaryTolAtr

        ) {

          oppositeTests++;

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
          CFG.boundaryTolAtr

        ) {

          oppositeTests++;

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
        CFG.phaseBZoneFrac

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
        CFG.phaseBZoneFrac

      ) {

        zone =
          1;

      }


      if (

        zone

        &&

        lastZone

        &&

        zone !==
        lastZone

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
    stIndex >=
    0
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


  const phaseBAge =

    stIndex >=
    0

      ?

      last -
      stIndex

      :

      0;


  const rangeAtr =

    (
      rangeHigh -
      rangeLow
    )

    /

    Math.max(
      candidate.atr,
      1e-9
    );


  const maturePhaseB =

    phase >=
    2

    &&

    stCount >=
    1

    &&

    phaseBAge >=
    CFG.minPhaseBBars

    &&

    (
      oppositeTests >=
      1

      ||

      traversals >=
      1
    )

    &&

    rangeAtr >=
    0.75

    &&

    rangeAtr <=
    14;


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
    maturePhaseB
  ) {


    const start =
      Math.max(

        stIndex +
        1,

        candidate.index +
        8

      );


    for (
      let i =
        start;

      i <=
        last;

      i++
    ) {


      const atr =

        atrAt(
          bars,
          i
        )

        ||

        candidate.atr;


      const spread =
        spreadAt(
          bars,
          i
        );


      const closePosition =
        (
          bars[i].close -
          bars[i].low
        )
        /
        spread;


      const averageEffort =

        avgEffortAt(
          bars,
          i,
          useVolume
        )

        ||

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


      const lowerPenetration =
        rangeLow -
        bars[i].low;


      const upperPenetration =
        bars[i].high -
        rangeHigh;


      const spring =

        lowerPenetration >=
        atr *
        CFG.springMinAtr

        &&

        lowerPenetration <=
        atr *
        CFG.springMaxAtr

        &&

        bars[i].close >
        rangeLow

        &&

        closePosition >=
        0.50

        &&

        effort <=
        averageEffort *
        1.65;


      const utad =

        upperPenetration >=
        atr *
        CFG.springMinAtr

        &&

        upperPenetration <=
        atr *
        CFG.springMaxAtr

        &&

        bars[i].close <
        rangeHigh

        &&

        closePosition <=
        0.50

        &&

        effort <=
        averageEffort *
        1.65;


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
     TEST AFTER SPRING / UTAD
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
        CFG.pivotLen;

      i++

    ) {


      const atr =

        atrAt(
          bars,
          i
        )

        ||

        candidate.atr;


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


      const closePosition =
        (
          bars[i].close -
          bars[i].low
        )
        /
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

        bars[i].low <=
        rangeLow +
        atr *
        CFG.testTolAtr

        &&

        bars[i].low >=
        excursion.price -
        atr *
        0.20

        &&

        effort <=
        excursionEffort *
        0.95

        &&

        spread <=
        excursionSpread *
        0.95

        &&

        closePosition >=
        0.45

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
        CFG.testTolAtr

        &&

        bars[i].high <=
        excursion.price +
        atr *
        0.20

        &&

        effort <=
        excursionEffort *
        0.95

        &&

        spread <=
        excursionSpread *
        0.95

        &&

        closePosition <=
        0.55

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
     TERMINAL C TEST
  ======================================================= */

  if (

    maturePhaseB

    &&

    !outcome

  ) {


    const start =
      Math.max(

        stIndex +
        3,

        last -
        90

      );


    for (

      let i =
        start;

      i <
        last -
        CFG.pivotLen;

      i++

    ) {


      const atr =

        atrAt(
          bars,
          i
        )

        ||

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
        CFG.testTolAtr

        &&

        bars[i].low >=
        rangeLow -
        atr *
        0.25

        &&

        effort <=
        avgEffort *
        0.95

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
        CFG.testTolAtr

        &&

        bars[i].high <=
        rangeHigh +
        atr *
        0.25

        &&

        effort <=
        avgEffort *
        0.95

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
     PHASE D
  ======================================================= */

  let strength =
    null;


  if (

    phase >=
    3

    &&

    outcome

  ) {


    const anchor =

      test?.index

      ??

      excursion?.index

      ??

      stIndex;


    const height =
      Math.max(

        rangeHigh -
        rangeLow,

        1e-9

      );


    for (
      let i =
        anchor +
        1;

      i <=
        last;

      i++
    ) {


      const atr =

        atrAt(
          bars,
          i
        )

        ||

        candidate.atr;


      const spread =
        spreadAt(
          bars,
          i
        );


      const closePosition =
        (
          bars[i].close -
          bars[i].low
        )
        /
        spread;


      const avgEffort =

        avgEffortAt(
          bars,
          i,
          useVolume
        )

        ||

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


      const dominanceUp =
        rangeLow +
        height *
        0.62;


      const dominanceDown =
        rangeHigh -
        height *
        0.62;


      const sos =

        outcome ===
        "BULL"

        &&

        (
          bars[i].close >
          rangeHigh +
          atr *
          CFG.breakAtr

          ||

          bars[i].close >=
          dominanceUp
        )

        &&

        effort >=
        avgEffort *
        CFG.strengthEffortMult

        &&

        spread >=
        atr *
        CFG.strengthSpreadAtr

        &&

        closePosition >=
        0.60;


      const sow =

        outcome ===
        "BEAR"

        &&

        (
          bars[i].close <
          rangeLow -
          atr *
          CFG.breakAtr

          ||

          bars[i].close <=
          dominanceDown
        )

        &&

        effort >=
        avgEffort *
        CFG.strengthEffortMult

        &&

        spread >=
        atr *
        CFG.strengthSpreadAtr

        &&

        closePosition <=
        0.40;


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
        CFG.pivotLen;

      i++

    ) {


      const atr =

        atrAt(
          bars,
          i
        )

        ||

        candidate.atr;


      const avgEffort =

        avgEffortAt(
          bars,
          i,
          useVolume
        )

        ||

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


      const closePosition =
        (
          bars[i].close -
          bars[i].low
        )
        /
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
        1.8

        &&

        effort <=
        avgEffort *
        1.05

        &&

        spread <=
        atr *
        1.10

        &&

        closePosition >=
        0.40

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
        1.8

        &&

        effort <=
        avgEffort *
        1.05

        &&

        spread <=
        atr *
        1.10

        &&

        closePosition <=
        0.60

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

    phase >=
    4

    &&

    outcome

  ) {


    let count =
      0;


    const start =
      Math.max(

        strength?.index

        ??

        0,

        last -
        40

      );


    for (
      let i =
        start;

      i <=
        last;

      i++
    ) {


      count =

        outcome ===
        "BULL"

          ?

          (
            bars[i].close >
            rangeHigh

              ?

              count +
              1

              :

              0
          )

          :

          (
            bars[i].close <
            rangeLow

              ?

              count +
              1

              :

              0
          );


      if (
        count >=
        3
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
    phaseEIndex >=
    0
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
     RECENCY CHECK
  ======================================================= */

  const latestEventIndex =
    Math.max(

      ...events.map(
        event =>
          event.index
      )

    );


  const latestEventAge =
    last -
    latestEventIndex;


  if (

    latestEventAge >
    CFG.maxEventAgeBars

    &&

    phase <
    5

  ) {

    return null;

  }


  /* =======================================================
     CONFIDENCE
  ======================================================= */

  let confidence =
    10;


  if (
    absorbed
  ) {

    confidence +=
      15;

  }


  if (
    arOk
  ) {

    confidence +=
      10;

  }


  if (
    stIndex >=
    0
  ) {

    confidence +=
      15;

  }


  if (
    phase >=
    3
  ) {

    confidence +=
      15;

  }


  if (
    strength
  ) {

    confidence +=
      15;

  }


  if (
    lps
  ) {

    confidence +=
      10;

  }


  if (
    phase >=
    5
  ) {

    confidence +=
      10;

  }


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

    absTrend >=
    35

      ?

      10

      :

      absTrend >=
      12

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

    rangeAtr >=
    1

    &&

    rangeAtr <=
    10

      ?

      10

      :

      5;


  validation +=

    stCount >=
    2

      ?

      15

      :

      stCount >=
      1

        ?

        8

        :

        0;


  validation +=

    oppositeTests >=
    1

    ||

    traversals >=
    1

      ?

      10

      :

      0;


  validation +=
    maturePhaseB
      ?
      10
      :
      0;


  validation +=
    phase >=
    3
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
    phase >=
    5
      ?
      5
      :
      0;


  validation =
    clamp(
      validation,
      0,
      100
    );


  /* =======================================================
     DIRECTION / STRUCTURE
  ======================================================= */

  const continuation =

    bullStop

      ?

      candidate.trend >
      12

      :

      candidate.trend <
      -12;


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
    "BULL"

    &&

    phase >=
    3

  ) {

    direction =
      "BUY";

  }


  if (

    outcome ===
    "BEAR"

    &&

    phase >=
    3

  ) {

    direction =
      "SELL";

  }


  /* =======================================================
     ENTRY / SL / TP
  ======================================================= */

  let entry =
    null;


  const trigger =

    lps

    ||

    test

    ||

    strength;


  if (

    trigger

    &&

    direction !==
    "WAIT"

    &&

    confidence >=
    CFG.minConfidence

    &&

    validation >=
    CFG.minValidation

    &&

    last -
    trigger.index <=
    CFG.maxEventAgeBars

  ) {


    const atr =

      atrAt(
        bars,
        last
      )

      ||

      candidate.atr;


    const entryPrice =
      bars[last].close;


    let stop;


    if (
      direction ===
      "BUY"
    ) {


      const hard =
        Math.min(

          rangeLow,

          excursion?.price

          ??

          rangeLow

        );


      stop =
        Math.min(

          hard -
          atr *
          0.20,

          entryPrice -
          atr *
          1.10

        );

    }

    else {


      const hard =
        Math.max(

          rangeHigh,

          excursion?.price

          ??

          rangeHigh

        );


      stop =
        Math.max(

          hard +
          atr *
          0.20,

          entryPrice +
          atr *
          1.10

        );

    }


    const risk =
      Math.max(

        Math.abs(
          entryPrice -
          stop
        ),

        atr *
        0.50

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

          entryPrice

          +

          sign *
          risk *
          CFG.rr1,

          4

        ),

      tp2:
        round(

          entryPrice

          +

          sign *
          risk *
          CFG.rr2,

          4

        ),

      risk:
        round(
          risk,
          4
        ),

      rr1:
        CFG.rr1,

      rr2:
        CFG.rr2

    };

  }


  /* =======================================================
     REASONS
  ======================================================= */

  const reasons =
    [];


  reasons.push(

    bullStop

      ?

      "Selling Climax candidate detected after bearish pressure."

      :

      "Buying Climax candidate detected after bullish pressure."

  );


  reasons.push(

    absorbed

      ?

      "Post-climax absorption confirmed."

      :

      "Post-climax absorption is still weak or incomplete."

  );


  if (
    arOk
  ) {

    reasons.push(

      `Automatic ${bullStop ? "Rally" : "Reaction"} displaced ${round(arMoveAtr, 2)} ATR.`

    );

  }


  if (
    stCount
  ) {

    reasons.push(

      `${stCount} Secondary Test${stCount === 1 ? "" : "s"} detected near the climax side.`

    );

  }


  if (
    oppositeTests

    ||

    traversals
  ) {

    reasons.push(

      `Phase B contains ${oppositeTests} opposite-edge test(s) and ${traversals} traversal(s).`

    );

  }


  if (
    excursion
  ) {

    reasons.push(

      `${excursion.label} broke the range edge and recovered.`

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

      `${lps.label} confirmed a lower-effort pullback after strength.`

    );

  }


  if (
    phase >=
    5
  ) {

    reasons.push(

      "Price achieved multi-bar acceptance outside the trading range."

    );

  }


  if (
    !useVolume
  ) {

    reasons.push(

      "The feed has no usable volume, so candle spread is used as the Wyckoff effort proxy."

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

    trendScore:
      round(
        candidate.trend,
        1
      ),

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
          rangeAtr,
          2
        )

    },

    stats: {

      absorbed,

      arMoveATR:
        round(
          arMoveAtr,
          2
        ),

      stCount,

      oppositeTests,

      traversals,

      phaseBAge,

      latestEventAge,

      maturePhaseB

    },

    volumeMode:

      useVolume

        ?

        "VOLUME"

        :

        "SPREAD_PROXY",

    events,

    entry,

    reasons

  };

}


/* =========================================================
   ANALYZE TIMEFRAME
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

    return emptyAnalysis(

      "Not enough candles to build a Wyckoff campaign."

    );

  }


  const useVolume =
    useRealVolume(
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


    const result =
      emptyAnalysis(

        "No qualifying Selling Climax or Buying Climax was found in the current lookback.",

        useVolume

      );


    if (
      !useVolume
    ) {

      result.reasons.push(

        "No usable volume was returned, so spread is used as effort."

      );

    }


    return result;

  }


  let best =
    null;


  for (
    const candidate
    of climaxes.slice(
      -24
    )
  ) {


    const campaign =
      buildCampaign(

        bars,

        candidate,

        useVolume

      );


    if (
      !campaign
    ) {

      continue;

    }


    const age =

      bars.length -
      1 -
      candidate.index;


    const recency =

      Math.max(

        0,

        CFG.maxCampaignBars -
        age

      )

      /

      CFG.maxCampaignBars;


    const score =

      campaign.phase *
      100

      +

      campaign.validation

      +

      campaign.confidence *
      0.25

      +

      recency *
      18;


    if (

      !best

      ||

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

    best?.campaign

    ||

    emptyAnalysis(

      "No current Wyckoff campaign survived recency and structure checks.",

      useVolume

    )

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
      analysis.phase ||
      0
    )
    *
    10

    +

    (
      analysis.validation ||
      0
    )

    +

    (
      analysis.confidence ||
      0
    )
    *
    0.25;


  if (
    row.tf ===
    requestedTf
  ) {

    score +=
      8;

  }


  if (
    analysis.direction ===
    "WAIT"
  ) {

    score -=
      3;

  }


  if (
    analysis.phase ===
    5
  ) {

    score -=
      4;

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


    const currentUtility =
      utility(
        row,
        requestedTf
      );


    if (

      !best

      ||

      row.analysis.phase >
      best.analysis.phase

      ||

      (
        row.analysis.phase ===
        best.analysis.phase

        &&

        currentUtility >
        best.utility
      )

    ) {

      best = {

        ...row,

        utility:
          currentUtility

      };

    }

  }


  return best;

}


/* =========================================================
   VERCEL HANDLER
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

        queryValue(

          req.query?.symbol,

          "XAU/USD"

        )

      );


    const rawTf =
      String(

        queryValue(

          req.query?.tf,

          "5m"

        )

      );


    const requestedTf =

      TF_CHAIN[
        rawTf
      ]

        ?

        rawTf

        :

        "5m";


    const chain =
      TF_CHAIN[
        requestedTf
      ];


    const rows =
      [];


    const timeframeErrors =
      [];


    /* =====================================================
       LOAD REQUESTED TF + HIGHER TFs
    ===================================================== */

    for (
      const tf
      of chain
    ) {


      try {


        const bars =
          await fetchSeries(

            symbol,

            tf

          );


        rows.push({

          tf,

          bars,

          analysis:
            analyzeBars(
              bars
            )

        });


      }

      catch (
        error
      ) {


        timeframeErrors.push({

          tf,

          error:

            safeText(
              error
            )

            ||

            "Unknown timeframe error"

        });

      }

    }


    /* =====================================================
       EVERYTHING FAILED
    ===================================================== */

    if (
      !rows.length
    ) {


      return res
        .status(502)
        .json({

          ok:
            false,

          engine:
            "MKAYFX WYCKOFF V4.0",

          error:

            timeframeErrors

              .map(
                item =>
                  `${item.tf}: ${item.error}`
              )

              .join(
                " | "
              )

            ||

            "All timeframe requests failed.",

          timeframeErrors

        });

    }


    /* =====================================================
       EFFECTIVE STRUCTURE
    ===================================================== */

    const selected =
      chooseEffective(

        rows,

        requestedTf

      );


    const current =
      selected.bars[
        selected.bars.length -
        1
      ];


    /* =====================================================
       RESPONSE
    ===================================================== */

    return res
      .status(200)
      .json({

        ok:
          true,

        engine:
          "MKAYFX WYCKOFF V4.0",

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
            current.close,
            4
          ),

        analysis:
          selected.analysis,

        timeframes:

          rows.map(

            row => ({

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

        timeframeErrors,

        candles:

          selected.bars

            .slice(
              -220
            )

            .map(

              bar => ({

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


    return res
      .status(500)
      .json({

        ok:
          false,

        engine:
          "MKAYFX WYCKOFF V4.0",

        error:

          safeText(
            error
          )

          ||

          "Unknown Wyckoff API error."

      });

  }

}