const TD_BASE =
  "https://api.twelvedata.com";

const FRED_BASE =
  "https://api.stlouisfed.org/fred";

const CFTC_DATASET =
  "72hh-3qpy";

const GOLD_CFTC_CODE =
  "088691";



/* =========================================================
   BASIC HELPERS
========================================================= */

const clamp = (
  n,
  min,
  max
) =>
  Math.max(
    min,
    Math.min(
      max,
      n
    )
  );


const round = (
  n,
  d = 2
) =>

  Number.isFinite(n)

    ? Number(
        n.toFixed(d)
      )

    : null;


const num = (
  value
) => {

  const n =
    Number(
      String(
        value ?? ""
      )
      .replace(
        /,/g,
        ""
      )
      .trim()
    );


  return Number.isFinite(n)
    ? n
    : null;

};


const safeDiv = (
  a,
  b
) =>

  Number.isFinite(a) &&
  Number.isFinite(b) &&
  b !== 0

    ? a / b

    : null;



const mean = (
  values
) => {

  if (
    !values.length
  ) {

    return null;

  }


  return (
    values.reduce(
      (
        sum,
        value
      ) =>
        sum + value,
      0
    ) /
    values.length
  );

};



const median = (
  values
) => {

  const array =
    values
      .filter(
        Number.isFinite
      )
      .slice()
      .sort(
        (
          a,
          b
        ) =>
          a - b
      );


  if (
    !array.length
  ) {

    return null;

  }


  const middle =
    Math.floor(
      array.length / 2
    );


  return (
    array.length % 2

      ? array[
          middle
        ]

      : (
          array[
            middle - 1
          ] +
          array[
            middle
          ]
        ) / 2
  );

};



const stdev = (
  values
) => {

  const array =
    values.filter(
      Number.isFinite
    );


  if (
    array.length < 2
  ) {

    return null;

  }


  const m =
    mean(
      array
    );


  return Math.sqrt(

    array.reduce(
      (
        sum,
        value
      ) =>

        sum +
        (
          value -
          m
        ) ** 2,

      0

    ) /
    (
      array.length -
      1
    )

  );

};



const percentileRank = (
  value,
  values
) => {

  const array =
    values
      .filter(
        Number.isFinite
      )
      .sort(
        (
          a,
          b
        ) =>
          a - b
      );


  if (
    !array.length ||
    !Number.isFinite(
      value
    )
  ) {

    return null;

  }


  let below =
    0;


  for (
    const v
    of array
  ) {

    if (
      v <= value
    ) {

      below++;

    }

  }


  return (
    100 *
    below /
    array.length
  );

};



const pearson = (
  xs,
  ys
) => {

  const pairs =
    xs
      .map(
        (
          x,
          i
        ) =>
          [
            x,
            ys[i]
          ]
      )
      .filter(
        (
          [
            x,
            y
          ]
        ) =>
          Number.isFinite(x) &&
          Number.isFinite(y)
      );


  if (
    pairs.length < 8
  ) {

    return null;

  }


  const ax =
    pairs.map(
      p =>
        p[0]
    );


  const ay =
    pairs.map(
      p =>
        p[1]
    );


  const mx =
    mean(
      ax
    );


  const my =
    mean(
      ay
    );


  let numerator =
    0;

  let dx =
    0;

  let dy =
    0;


  for (
    let i = 0;
    i < pairs.length;
    i++
  ) {

    const a =
      ax[i] -
      mx;


    const b =
      ay[i] -
      my;


    numerator +=
      a * b;


    dx +=
      a * a;


    dy +=
      b * b;

  }


  return (
    dx &&
    dy

      ? numerator /
        Math.sqrt(
          dx * dy
        )

      : null
  );

};



/* =========================================================
   DATE / API
========================================================= */

function tdDate(
  value
) {

  if (
    !value
  ) {

    return null;

  }


  const string =
    String(
      value
    )
    .trim();


  const iso =
    string.includes(
      "T"
    )

      ? string

      : string.replace(
          " ",
          "T"
        );


  const date =
    new Date(

      iso.endsWith(
        "Z"
      )

        ? iso

        : `${iso}Z`

    );


  return Number.isNaN(
    date.getTime()
  )

    ? null

    : date;

}



async function fetchJson(
  url,
  timeout = 10000,
  headers = {}
) {

  const response =
    await fetch(
      url,
      {

        headers: {

          Accept:
            "application/json",

          ...headers

        },

        signal:
          AbortSignal.timeout(
            timeout
          )

      }
    );


  if (
    !response.ok
  ) {

    throw new Error(

      `HTTP ${response.status} from ${
        new URL(
          url
        ).hostname
      }`

    );

  }


  return response.json();

}



/* =========================================================
   TWELVE DATA
========================================================= */

function parseTwelveSeries(
  payload
) {

  if (
    !payload ||
    payload.status === "error" ||
    !Array.isArray(
      payload.values
    )
  ) {

    throw new Error(

      payload?.message ||
      "Invalid Twelve Data time-series response."

    );

  }


  return payload
    .values

    .map(
      value => ({

        time:
          tdDate(
            value.datetime
          )
          ?.getTime() ??
          null,

        datetime:
          value.datetime,

        open:
          num(
            value.open
          ),

        high:
          num(
            value.high
          ),

        low:
          num(
            value.low
          ),

        close:
          num(
            value.close
          ),

        volume:
          num(
            value.volume
          )

      })
    )

    .filter(
      value =>

        value.time &&

        [
          value.open,
          value.high,
          value.low,
          value.close
        ]
        .every(
          Number.isFinite
        )
    )

    .sort(
      (
        a,
        b
      ) =>
        a.time -
        b.time
    );

}



async function tdSeries(
  apiKey,
  interval,
  outputsize
) {

  const url =
    new URL(
      `${TD_BASE}/time_series`
    );


  url.searchParams.set(
    "symbol",
    "XAU/USD"
  );


  url.searchParams.set(
    "interval",
    interval
  );


  url.searchParams.set(
    "outputsize",
    String(
      outputsize
    )
  );


  url.searchParams.set(
    "timezone",
    "UTC"
  );


  url.searchParams.set(
    "apikey",
    apiKey
  );


  const json =
    await fetchJson(
      url.toString(),
      12000
    );


  return parseTwelveSeries(
    json
  );

}



/* =========================================================
   RESAMPLING
========================================================= */

function resample(
  bars,
  minutes
) {

  const step =
    minutes *
    60_000;


  const map =
    new Map();


  for (
    const bar
    of bars
  ) {

    const bucket =
      Math.floor(
        bar.time /
        step
      ) *
      step;


    const current =
      map.get(
        bucket
      );


    if (
      !current
    ) {

      map.set(
        bucket,
        {

          time:
            bucket,

          open:
            bar.open,

          high:
            bar.high,

          low:
            bar.low,

          close:
            bar.close,

          volume:
            Number.isFinite(
              bar.volume
            )

              ? bar.volume

              : null

        }
      );

    }

    else {

      current.high =
        Math.max(
          current.high,
          bar.high
        );


      current.low =
        Math.min(
          current.low,
          bar.low
        );


      current.close =
        bar.close;


      if (
        Number.isFinite(
          current.volume
        ) &&
        Number.isFinite(
          bar.volume
        )
      ) {

        current.volume +=
          bar.volume;

      }

      else {

        current.volume =
          null;

      }

    }

  }


  return [
    ...map.values()
  ]
  .sort(
    (
      a,
      b
    ) =>
      a.time -
      b.time
  );

}



/* =========================================================
   INDICATORS
========================================================= */

function ema(
  values,
  period
) {

  if (
    !values.length
  ) {

    return [];

  }


  const k =
    2 /
    (
      period +
      1
    );


  const output =
    [];


  let value =
    values[0];


  for (
    const price
    of values
  ) {

    value =
      price *
      k +
      value *
      (
        1 -
        k
      );


    output.push(
      value
    );

  }


  return output;

}



function rsiSeries(
  values,
  period = 14
) {

  const output =
    Array(
      values.length
    )
    .fill(
      null
    );


  if (
    values.length <=
    period
  ) {

    return output;

  }


  let gain =
    0;

  let loss =
    0;


  for (
    let i = 1;
    i <= period;
    i++
  ) {

    const difference =
      values[i] -
      values[
        i - 1
      ];


    if (
      difference >= 0
    ) {

      gain +=
        difference;

    }

    else {

      loss -=
        difference;

    }

  }


  let averageGain =
    gain /
    period;


  let averageLoss =
    loss /
    period;


  output[
    period
  ] =

    averageLoss === 0

      ? 100

      : 100 -
        100 /
        (
          1 +
          averageGain /
          averageLoss
        );


  for (
    let i =
      period + 1;

    i <
      values.length;

    i++
  ) {

    const difference =
      values[i] -
      values[
        i - 1
      ];


    const g =
      Math.max(
        0,
        difference
      );


    const l =
      Math.max(
        0,
        -difference
      );


    averageGain =
      (
        averageGain *
        (
          period -
          1
        ) +
        g
      ) /
      period;


    averageLoss =
      (
        averageLoss *
        (
          period -
          1
        ) +
        l
      ) /
      period;


    output[i] =

      averageLoss === 0

        ? 100

        : 100 -
          100 /
          (
            1 +
            averageGain /
            averageLoss
          );

  }


  return output;

}



function atrSeries(
  bars,
  period = 14
) {

  const trueRange =
    [];


  for (
    let i = 0;
    i < bars.length;
    i++
  ) {

    const bar =
      bars[i];


    const previousClose =

      i

        ? bars[
            i - 1
          ].close

        : bar.close;


    trueRange.push(

      Math.max(

        bar.high -
        bar.low,

        Math.abs(
          bar.high -
          previousClose
        ),

        Math.abs(
          bar.low -
          previousClose
        )

      )

    );

  }


  const output =
    Array(
      bars.length
    )
    .fill(
      null
    );


  if (
    bars.length <
    period
  ) {

    return output;

  }


  let atr =
    mean(
      trueRange.slice(
        0,
        period
      )
    );


  output[
    period - 1
  ] =
    atr;


  for (
    let i =
      period;

    i <
      trueRange.length;

    i++
  ) {

    atr =
      (
        atr *
        (
          period -
          1
        ) +
        trueRange[i]
      ) /
      period;


    output[i] =
      atr;

  }


  return output;

}



/* =========================================================
   PIVOTS / STRUCTURE
========================================================= */

function pivots(
  bars,
  span = 2
) {

  const highs =
    [];

  const lows =
    [];


  for (
    let i = span;
    i <
      bars.length -
      span;
    i++
  ) {

    let pivotHigh =
      true;

    let pivotLow =
      true;


    for (
      let j =
        i - span;

      j <=
        i + span;

      j++
    ) {

      if (
        j === i
      ) {

        continue;

      }


      if (
        bars[j].high >=
        bars[i].high
      ) {

        pivotHigh =
          false;

      }


      if (
        bars[j].low <=
        bars[i].low
      ) {

        pivotLow =
          false;

      }

    }


    if (
      pivotHigh
    ) {

      highs.push({

        index:
          i,

        time:
          bars[i].time,

        price:
          bars[i].high

      });

    }


    if (
      pivotLow
    ) {

      lows.push({

        index:
          i,

        time:
          bars[i].time,

        price:
          bars[i].low

      });

    }

  }


  return {

    highs,

    lows

  };

}



function structureState(
  bars
) {

  const pivot =
    pivots(
      bars.slice(
        -160
      ),
      2
    );


  const highs =
    pivot.highs.slice(
      -2
    );


  const lows =
    pivot.lows.slice(
      -2
    );


  if (
    highs.length <
      2 ||
    lows.length <
      2
  ) {

    return "MIXED";

  }


  if (
    highs[1].price >
      highs[0].price &&
    lows[1].price >
      lows[0].price
  ) {

    return "HH / HL";

  }


  if (
    highs[1].price <
      highs[0].price &&
    lows[1].price <
      lows[0].price
  ) {

    return "LH / LL";

  }


  return "MIXED";

}



/* =========================================================
   TIMEFRAME ANALYSIS
========================================================= */

function timeframeState(
  bars,
  label
) {

  const clean =
    bars.filter(
      bar =>
        Number.isFinite(
          bar.close
        )
    );


  if (
    clean.length <
    55
  ) {

    return {

      label,

      available:
        false

    };

  }


  const closes =
    clean.map(
      bar =>
        bar.close
    );


  const ema20 =
    ema(
      closes,
      20
    );


  const ema50 =
    ema(
      closes,
      50
    );


  const rsi =
    rsiSeries(
      closes,
      14
    );


  const atr =
    atrSeries(
      clean,
      14
    );


  const i =
    clean.length -
    1;


  const close =
    closes[i];


  const change1 =
    i >= 1

      ? 100 *
        (
          close /
          closes[
            i - 1
          ] -
          1
        )

      : null;


  const change5 =
    i >= 5

      ? 100 *
        (
          close /
          closes[
            i - 5
          ] -
          1
        )

      : null;


  const recent =
    clean.slice(
      -20
    );


  const high =
    Math.max(
      ...recent.map(
        bar =>
          bar.high
      )
    );


  const low =
    Math.min(
      ...recent.map(
        bar =>
          bar.low
      )
    );


  const rangePosition =
    high !== low

      ? 100 *
        (
          close -
          low
        ) /
        (
          high -
          low
        )

      : 50;


  const atrHistory =
    atr
      .slice(
        -80
      )
      .filter(
        Number.isFinite
      );


  const atrMedian =
    median(
      atrHistory
    );


  const expansion =
    atrMedian

      ? atr[i] /
        atrMedian

      : null;


  let trend =
    "NEUTRAL";


  if (
    close >
      ema20[i] &&
    ema20[i] >
      ema50[i]
  ) {

    trend =
      "UP";

  }

  else if (
    close <
      ema20[i] &&
    ema20[i] <
      ema50[i]
  ) {

    trend =
      "DOWN";

  }


  let momentum =
    "BALANCED";


  if (
    rsi[i] >= 60 &&
    change5 > 0
  ) {

    momentum =
      "STRONG UP";

  }

  else if (
    rsi[i] <= 40 &&
    change5 < 0
  ) {

    momentum =
      "STRONG DOWN";

  }

  else if (
    rsi[i] > 52
  ) {

    momentum =
      "UP";

  }

  else if (
    rsi[i] < 48
  ) {

    momentum =
      "DOWN";

  }


  return {

    label,

    available:
      true,

    price:
      round(
        close,
        2
      ),

    change1BarPct:
      round(
        change1,
        3
      ),

    change5BarPct:
      round(
        change5,
        3
      ),

    ema20:
      round(
        ema20[i],
        2
      ),

    ema50:
      round(
        ema50[i],
        2
      ),

    rsi14:
      round(
        rsi[i],
        1
      ),

    atr14:
      round(
        atr[i],
        2
      ),

    atrExpansion:
      round(
        expansion,
        2
      ),

    rangePosition20:
      round(
        rangePosition,
        1
      ),

    trend,

    momentum,

    structure:
      structureState(
        clean
      )

  };

}



/* =========================================================
   TIME KEYS
========================================================= */

function utcDayKey(
  ms
) {

  return new Date(
    ms
  )
  .toISOString()
  .slice(
    0,
    10
  );

}



function monthKey(
  ms
) {

  return new Date(
    ms
  )
  .toISOString()
  .slice(
    0,
    7
  );

}



function weekStartKey(
  ms
) {

  const date =
    new Date(
      ms
    );


  const day =
    date.getUTCDay() ||
    7;


  date.setUTCDate(

    date.getUTCDate() -
    day +
    1

  );


  return date
    .toISOString()
    .slice(
      0,
      10
    );

}



/* =========================================================
   GROUPING
========================================================= */

function aggregateGroup(
  bars,
  keyFunction
) {

  const map =
    new Map();


  for (
    const bar
    of bars
  ) {

    const key =
      keyFunction(
        bar.time
      );


    const current =
      map.get(
        key
      );


    if (
      !current
    ) {

      map.set(
        key,
        {

          key,

          time:
            bar.time,

          open:
            bar.open,

          high:
            bar.high,

          low:
            bar.low,

          close:
            bar.close

        }
      );

    }

    else {

      current.high =
        Math.max(
          current.high,
          bar.high
        );


      current.low =
        Math.min(
          current.low,
          bar.low
        );


      current.close =
        bar.close;

    }

  }


  return [
    ...map.values()
  ]
  .sort(
    (
      a,
      b
    ) =>
      a.time -
      b.time
  );

}



/* =========================================================
   SESSION
========================================================= */

function currentSession(
  minuteBars
) {

  const now =
    Date.now();


  const currentDay =
    utcDayKey(
      now
    );


  const today =
    minuteBars.filter(
      bar =>
        utcDayKey(
          bar.time
        ) ===
        currentDay
    );


  const hour =
    new Date(
      now
    )
    .getUTCHours();


  let name =
    "OFF / ROLLOVER";

  let start =
    21;

  let end =
    24;


  if (
    hour < 7
  ) {

    name =
      "ASIA";

    start =
      0;

    end =
      7;

  }

  else if (
    hour < 13
  ) {

    name =
      "LONDON";

    start =
      7;

    end =
      13;

  }

  else if (
    hour < 21
  ) {

    name =
      "NEW YORK";

    start =
      13;

    end =
      21;

  }


  const sessionBars =
    today.filter(
      bar => {

        const h =
          new Date(
            bar.time
          )
          .getUTCHours();


        return (
          h >= start &&
          h < end
        );

      }
    );


  return {

    name,

    high:
      sessionBars.length

        ? round(
            Math.max(
              ...sessionBars.map(
                bar =>
                  bar.high
              )
            ),
            2
          )

        : null,

    low:
      sessionBars.length

        ? round(
            Math.min(
              ...sessionBars.map(
                bar =>
                  bar.low
              )
            ),
            2
          )

        : null,

    open:
      sessionBars.length

        ? round(
            sessionBars[0].open,
            2
          )

        : null,

    note:
      "Session windows are approximate UTC market windows."

  };

}



/* =========================================================
   FAIR VALUE GAPS
========================================================= */

function fvgZones(
  bars,
  currentPrice
) {

  const recent =
    bars.slice(
      -250
    );


  const zones =
    [];


  for (
    let i = 2;
    i < recent.length;
    i++
  ) {

    const first =
      recent[
        i - 2
      ];


    const third =
      recent[i];


    if (
      third.low >
      first.high
    ) {

      const low =
        first.high;


      const high =
        third.low;


      let filled =
        false;


      for (
        let j =
          i + 1;

        j <
          recent.length;

        j++
      ) {

        if (
          recent[j].low <=
          low
        ) {

          filled =
            true;

          break;

        }

      }


      if (
        !filled
      ) {

        zones.push({

          type:
            "BULLISH FVG",

          low,

          high,

          created:
            third.time

        });

      }

    }


    if (
      third.high <
      first.low
    ) {

      const low =
        third.high;


      const high =
        first.low;


      let filled =
        false;


      for (
        let j =
          i + 1;

        j <
          recent.length;

        j++
      ) {

        if (
          recent[j].high >=
          high
        ) {

          filled =
            true;

          break;

        }

      }


      if (
        !filled
      ) {

        zones.push({

          type:
            "BEARISH FVG",

          low,

          high,

          created:
            third.time

        });

      }

    }

  }


  return zones

    .map(
      zone => ({

        ...zone,

        distance:
          Math.min(

            Math.abs(
              currentPrice -
              zone.low
            ),

            Math.abs(
              currentPrice -
              zone.high
            )

          )

      })
    )

    .sort(
      (
        a,
        b
      ) =>
        a.distance -
        b.distance
    )

    .slice(
      0,
      8
    )

    .map(
      zone => ({

        type:
          zone.type,

        low:
          round(
            zone.low,
            2
          ),

        high:
          round(
            zone.high,
            2
          ),

        distance:
          round(
            zone.distance,
            2
          ),

        created:
          new Date(
            zone.created
          )
          .toISOString()

      })
    );

}



/* =========================================================
   EQUAL HIGHS / LOWS
========================================================= */

function equalLevels(
  bars,
  atr
) {

  const pivot =
    pivots(
      bars.slice(
        -300
      ),
      2
    );


  const tolerance =
    Math.max(

      (
        atr ||
        1
      ) *
      0.18,

      0.5

    );


  const cluster = (
    points,
    type
  ) => {

    const output =
      [];


    for (
      let i = 0;
      i < points.length;
      i++
    ) {

      for (
        let j =
          i + 1;

        j <
          points.length;

        j++
      ) {

        if (
          Math.abs(
            points[i].price -
            points[j].price
          ) <=
          tolerance
        ) {

          output.push({

            type,

            price:
              (
                points[i].price +
                points[j].price
              ) /
              2,

            touches:
              2,

            time:
              Math.max(
                points[i].time,
                points[j].time
              )

          });

        }

      }

    }


    return output;

  };


  return [

    ...cluster(
      pivot.highs.slice(
        -20
      ),
      "EQUAL HIGHS"
    ),

    ...cluster(
      pivot.lows.slice(
        -20
      ),
      "EQUAL LOWS"
    )

  ]

  .sort(
    (
      a,
      b
    ) =>
      b.time -
      a.time
  )

  .slice(
    0,
    6
  )

  .map(
    level => ({

      ...level,

      price:
        round(
          level.price,
          2
        ),

      time:
        new Date(
          level.time
        )
        .toISOString()

    })
  );

}



/* =========================================================
   LIQUIDITY MODEL
========================================================= */

function liquidityModel(
  minuteBars,
  dailyBars,
  m15Bars,
  price
) {

  const byDay =
    aggregateGroup(
      minuteBars,
      utcDayKey
    );


  const currentDay =
    byDay.at(
      -1
    );


  const previousDay =
    byDay.length >
      1

      ? byDay.at(
          -2
        )

      : null;


  const weekly =
    aggregateGroup(
      dailyBars,
      weekStartKey
    );


  const monthly =
    aggregateGroup(
      dailyBars,
      monthKey
    );


  const currentWeek =
    weekly.at(
      -1
    );


  const previousWeek =
    weekly.length >
      1

      ? weekly.at(
          -2
        )

      : null;


  const currentMonth =
    monthly.at(
      -1
    );


  const pivot =
    pivots(
      m15Bars.slice(
        -240
      ),
      2
    );


  const swingLevels =
    [

      ...pivot.highs
        .slice(
          -12
        )
        .map(
          level => ({

            type:
              "SWING HIGH",

            price:
              level.price,

            time:
              level.time

          })
        ),

      ...pivot.lows
        .slice(
          -12
        )
        .map(
          level => ({

            type:
              "SWING LOW",

            price:
              level.price,

            time:
              level.time

          })
        )

    ];


  const above =
    swingLevels
      .filter(
        level =>
          level.price >
          price
      )
      .sort(
        (
          a,
          b
        ) =>
          a.price -
          b.price
      )
      .slice(
        0,
        4
      );


  const below =
    swingLevels
      .filter(
        level =>
          level.price <
          price
      )
      .sort(
        (
          a,
          b
        ) =>
          b.price -
          a.price
      )
      .slice(
        0,
        4
      );


  const m15Atr =
    atrSeries(
      m15Bars,
      14
    )
    .at(
      -1
    );


  return {

    dayOpen:
      round(
        currentDay?.open,
        2
      ),

    previousDayHigh:
      round(
        previousDay?.high,
        2
      ),

    previousDayLow:
      round(
        previousDay?.low,
        2
      ),

    weekOpen:
      round(
        currentWeek?.open,
        2
      ),

    previousWeekHigh:
      round(
        previousWeek?.high,
        2
      ),

    previousWeekLow:
      round(
        previousWeek?.low,
        2
      ),

    monthOpen:
      round(
        currentMonth?.open,
        2
      ),

    session:
      currentSession(
        minuteBars
      ),

    nearestAbove:
      above.map(
        level => ({

          type:
            level.type,

          price:
            round(
              level.price,
              2
            ),

          distance:
            round(
              level.price -
              price,
              2
            ),

          time:
            new Date(
              level.time
            )
            .toISOString()

        })
      ),

    nearestBelow:
      below.map(
        level => ({

          type:
            level.type,

          price:
            round(
              level.price,
              2
            ),

          distance:
            round(
              price -
              level.price,
              2
            ),

          time:
            new Date(
              level.time
            )
            .toISOString()

        })
      ),

    equalLevels:
      equalLevels(
        m15Bars,
        m15Atr
      ),

    fairValueGaps:
      fvgZones(

        resample(
          minuteBars,
          5
        ),

        price

      )

  };

}



/* =========================================================
   VOLATILITY MODEL
========================================================= */

function volatilityModel(
  minuteBars,
  dailyBars
) {

  const daily =
    dailyBars.slice(
      -400
    );


  const atr =
    atrSeries(
      daily,
      14
    );


  const i =
    daily.length -
    1;


  const adr20 =
    mean(

      daily
        .slice(
          -20
        )
        .map(
          bar =>
            bar.high -
            bar.low
        )

    );


  const today =
    aggregateGroup(
      minuteBars,
      utcDayKey
    )
    .at(
      -1
    );


  const todayRange =
    today

      ? today.high -
        today.low

      : null;


  const dailyReturns =
    [];


  for (
    let k = 1;
    k < daily.length;
    k++
  ) {

    dailyReturns.push(

      Math.log(

        daily[k].close /
        daily[
          k - 1
        ].close

      )

    );

  }


  const rv20 =
    stdev(
      dailyReturns.slice(
        -20
      )
    );


  const annualized =
    Number.isFinite(
      rv20
    )

      ? rv20 *
        Math.sqrt(
          252
        ) *
        100

      : null;


  const atrPercentValues =
    atr
      .map(
        (
          value,
          index
        ) =>

          Number.isFinite(
            value
          )

            ? 100 *
              value /
              daily[index].close

            : null
      )
      .filter(
        Number.isFinite
      );


  const currentAtrPct =
    Number.isFinite(
      atr[i]
    )

      ? 100 *
        atr[i] /
        daily[i].close

      : null;


  const percentile =
    percentileRank(

      currentAtrPct,

      atrPercentValues
        .slice(
          -252
        )

    );


  let regime =
    "NORMAL";


  if (
    percentile >= 90
  ) {

    regime =
      "EXTREME";

  }

  else if (
    percentile >= 70
  ) {

    regime =
      "ELEVATED";

  }

  else if (
    percentile <= 25
  ) {

    regime =
      "LOW";

  }


  return {

    atr14Daily:
      round(
        atr[i],
        2
      ),

    atrPctOfPrice:
      round(
        currentAtrPct,
        2
      ),

    atrPercentile252d:
      round(
        percentile,
        1
      ),

    adr20:
      round(
        adr20,
        2
      ),

    todayRange:
      round(
        todayRange,
        2
      ),

    todayRangeVsAdrPct:
      round(

        safeDiv(
          todayRange,
          adr20
        ) *
        100,

        1

      ),

    realizedVol20AnnualizedPct:
      round(
        annualized,
        1
      ),

    regime

  };

}



/* =========================================================
   HISTORICAL ANALOG ENGINE
========================================================= */

function featureRows(
  daily
) {

  const closes =
    daily.map(
      bar =>
        bar.close
    );


  const ema20 =
    ema(
      closes,
      20
    );


  const rsi =
    rsiSeries(
      closes,
      14
    );


  const atr =
    atrSeries(
      daily,
      14
    );


  const rows =
    [];


  for (
    let i = 25;
    i < daily.length;
    i++
  ) {

    const recent =
      daily.slice(

        Math.max(
          0,
          i - 19
        ),

        i + 1

      );


    const high =
      Math.max(
        ...recent.map(
          bar =>
            bar.high
        )
      );


    const low =
      Math.min(
        ...recent.map(
          bar =>
            bar.low
        )
      );


    rows.push({

      i,

      time:
        daily[i].time,

      f: [

        Math.log(
          daily[i].close /
          daily[
            i - 1
          ].close
        ),

        Math.log(
          daily[i].close /
          daily[
            i - 5
          ].close
        ),

        (
          daily[i].close /
          ema20[i] -
          1
        ),

        (
          rsi[i] -
          50
        ) /
        50,

        atr[i] /
        daily[i].close,

        high !== low

          ? (
              daily[i].close -
              low
            ) /
            (
              high -
              low
            )

          : 0.5

      ]

    });

  }


  return rows;

}



function historicalAnalog(
  dailyBars
) {

  const daily =
    dailyBars.slice(
      -1000
    );


  const rows =
    featureRows(
      daily
    );


  if (
    rows.length <
    100
  ) {

    return {
      available:
        false
    };

  }


  const current =
    rows.at(
      -1
    );


  const history =
    rows.slice(
      0,
      -10
    );


  const means =
    current.f.map(
      (
        _,
        j
      ) =>
        mean(
          history.map(
            row =>
              row.f[j]
          )
        )
    );


  const standardDeviations =
    current.f.map(
      (
        _,
        j
      ) =>
        stdev(
          history.map(
            row =>
              row.f[j]
          )
        ) ||
        1
    );


  const closest =
    history

      .filter(
        row =>
          row.i +
          5 <
          daily.length
      )

      .map(
        row => ({

          ...row,

          distance:
            Math.sqrt(

              row.f.reduce(
                (
                  sum,
                  value,
                  j
                ) =>

                  sum +
                  (
                    (
                      value -
                      current.f[j]
                    ) /
                    standardDeviations[j]
                  ) ** 2,

                0

              ) /
              current.f.length

            )

        })
      )

      .sort(
        (
          a,
          b
        ) =>
          a.distance -
          b.distance
      )

      .slice(
        0,
        40
      );


  const horizon = (
    days
  ) => {

    const outcomes =
      closest

        .map(
          row => {

            const entry =
              daily[
                row.i
              ].close;


            const future =
              daily.slice(

                row.i +
                1,

                row.i +
                days +
                1

              );


            if (
              future.length <
              days
            ) {

              return null;

            }


            const exit =
              future.at(
                -1
              ).close;


            return {

              ret:
                100 *
                (
                  exit /
                  entry -
                  1
                ),

              mfe:
                100 *
                (
                  Math.max(
                    ...future.map(
                      bar =>
                        bar.high
                    )
                  ) /
                  entry -
                  1
                ),

              mae:
                100 *
                (
                  Math.min(
                    ...future.map(
                      bar =>
                        bar.low
                    )
                  ) /
                  entry -
                  1
                )

            };

          }
        )

        .filter(
          Boolean
        );


    return {

      positivePct:
        round(

          100 *
          outcomes.filter(
            outcome =>
              outcome.ret >
              0
          ).length /
          outcomes.length,

          1

        ),

      medianReturnPct:
        round(
          median(
            outcomes.map(
              outcome =>
                outcome.ret
            )
          ),
          2
        ),

      medianMfePct:
        round(
          median(
            outcomes.map(
              outcome =>
                outcome.mfe
            )
          ),
          2
        ),

      medianMaePct:
        round(
          median(
            outcomes.map(
              outcome =>
                outcome.mae
            )
          ),
          2
        )

    };

  };


  return {

    available:
      true,

    sampleSize:
      closest.length,

    averageDistance:
      round(
        mean(
          closest.map(
            row =>
              row.distance
          )
        ),
        2
      ),

    oneDay:
      horizon(
        1
      ),

    threeDay:
      horizon(
        3
      ),

    fiveDay:
      horizon(
        5
      ),

    note:
      "Nearest-neighbour comparison of daily XAU states. Descriptive history, not a forecast."

  };

}



/* =========================================================
   FRED
========================================================= */

async function fredSeries(
  apiKey,
  id,
  limit = 260
) {

  const url =
    new URL(
      `${FRED_BASE}/series/observations`
    );


  url.searchParams.set(
    "series_id",
    id
  );


  url.searchParams.set(
    "api_key",
    apiKey
  );


  url.searchParams.set(
    "file_type",
    "json"
  );


  url.searchParams.set(
    "sort_order",
    "desc"
  );


  url.searchParams.set(
    "limit",
    String(
      limit
    )
  );


  const data =
    await fetchJson(
      url.toString(),
      10000
    );


  return (
    data.observations ||
    []
  )

  .map(
    observation => ({

      date:
        observation.date,

      value:
        num(
          observation.value
        )

    })
  )

  .filter(
    observation =>
      Number.isFinite(
        observation.value
      )
  )

  .reverse();

}



function changeMetrics(
  observations
) {

  if (
    !observations?.length
  ) {

    return null;

  }


  const latest =
    observations.at(
      -1
    );


  const previous =
    observations.length >=
      2

      ? observations.at(
          -2
        )

      : null;


  const five =
    observations.length >=
      6

      ? observations.at(
          -6
        )

      : observations[0];


  const twenty =
    observations.length >=
      21

      ? observations.at(
          -21
        )

      : observations[0];


  return {

    value:
      latest.value,

    date:
      latest.date,

    change1:
      previous

        ? latest.value -
          previous.value

        : null,

    change5:
      five

        ? latest.value -
          five.value

        : null,

    change20:
      twenty

        ? latest.value -
          twenty.value

        : null,

    pctChange5:
      five &&
      five.value !== 0

        ? 100 *
          (
            latest.value /
            five.value -
            1
          )

        : null

  };

}



/* =========================================================
   MACRO CONFIG
========================================================= */

const MACRO_CONFIG = {

  DFII10: {

    label:
      "10Y real yield",

    unit:
      "%",

    effect:
      -1,

    weight:
      1.0,

    mode:
      "difference"

  },


  DGS10: {

    label:
      "US 10Y yield",

    unit:
      "%",

    effect:
      -1,

    weight:
      0.65,

    mode:
      "difference"

  },


  DGS2: {

    label:
      "US 2Y yield",

    unit:
      "%",

    effect:
      -1,

    weight:
      0.5,

    mode:
      "difference"

  },


  T10YIE: {

    label:
      "10Y breakeven inflation",

    unit:
      "%",

    effect:
      0.45,

    weight:
      0.35,

    mode:
      "difference"

  },


  DTWEXBGS: {

    label:
      "Broad USD index",

    unit:
      "index",

    effect:
      -1,

    weight:
      1.0,

    mode:
      "percent"

  },


  VIXCLS: {

    label:
      "VIX",

    unit:
      "index",

    effect:
      0.3,

    weight:
      0.25,

    mode:
      "percent"

  },


  DFF: {

    label:
      "Effective Fed funds",

    unit:
      "%",

    effect:
      -0.2,

    weight:
      0.15,

    mode:
      "difference"

  }

};



const FUNDAMENTAL_CONFIG = {

  CPIAUCSL: {

    label:
      "CPI",

    unit:
      "index",

    frequency:
      "Monthly"

  },


  CPILFESL: {

    label:
      "Core CPI",

    unit:
      "index",

    frequency:
      "Monthly"

  },


  PCEPI: {

    label:
      "PCE price index",

    unit:
      "index",

    frequency:
      "Monthly"

  },


  PCEPILFE: {

    label:
      "Core PCE",

    unit:
      "index",

    frequency:
      "Monthly"

  },


  PAYEMS: {

    label:
      "Nonfarm payrolls",

    unit:
      "thousands",

    frequency:
      "Monthly"

  },


  UNRATE: {

    label:
      "Unemployment rate",

    unit:
      "%",

    frequency:
      "Monthly"

  },


  CES0500000003: {

    label:
      "Average hourly earnings",

    unit:
      "USD/hour",

    frequency:
      "Monthly"

  },


  RSAFS: {

    label:
      "Retail sales",

    unit:
      "USD millions",

    frequency:
      "Monthly"

  },


  INDPRO: {

    label:
      "Industrial production",

    unit:
      "index",

    frequency:
      "Monthly"

  },


  GDPC1: {

    label:
      "Real GDP",

    unit:
      "USD billions",

    frequency:
      "Quarterly"

  }

};



/* =========================================================
   MACRO PRESSURE
========================================================= */

function macroPressure(
  seriesMap
) {

  const drivers =
    [];


  let weighted =
    0;


  let weightTotal =
    0;


  for (
    const [
      id,
      config
    ]
    of Object.entries(
      MACRO_CONFIG
    )
  ) {

    const observations =
      seriesMap[id];


    if (
      !observations?.length
    ) {

      continue;

    }


    const metrics =
      changeMetrics(
        observations
      );


    const deltas =
      [];


    for (
      let i = 5;
      i < observations.length;
      i++
    ) {

      const difference =

        config.mode ===
        "percent"

          ? 100 *
            (
              observations[i].value /
              observations[
                i - 5
              ].value -
              1
            )

          : observations[i].value -
            observations[
              i - 5
            ].value;


      if (
        Number.isFinite(
          difference
        )
      ) {

        deltas.push(
          difference
        );

      }

    }


    const current =

      config.mode ===
      "percent"

        ? metrics.pctChange5

        : metrics.change5;


    const sd =
      stdev(
        deltas.slice(
          -160
        )
      ) ||
      1;


    const z =
      clamp(
        current / sd,
        -3,
        3
      );


    const contribution =
      z *
      config.effect *
      config.weight;


    weighted +=
      contribution;


    weightTotal +=
      Math.abs(
        config.weight
      );


    let impact =
      "NEUTRAL";


    if (
      contribution >
      0.3
    ) {

      impact =
        "SUPPORTIVE";

    }


    if (
      contribution >
      0.9
    ) {

      impact =
        "STRONGLY SUPPORTIVE";

    }


    if (
      contribution <
      -0.3
    ) {

      impact =
        "NEGATIVE";

    }


    if (
      contribution <
      -0.9
    ) {

      impact =
        "STRONGLY NEGATIVE";

    }


    drivers.push({

      id,

      label:
        config.label,

      unit:
        config.unit,

      value:
        round(
          metrics.value,
          3
        ),

      date:
        metrics.date,

      change1:
        round(
          metrics.change1,
          3
        ),

      change5:
        round(
          metrics.change5,
          3
        ),

      impact,

      z5:
        round(
          z,
          2
        )

    });

  }


  const score =
    weightTotal

      ? clamp(

          100 *
          weighted /
          (
            weightTotal *
            1.6
          ),

          -100,
          100

        )

      : null;


  return {

    score:
      round(
        score,
        0
      ),

    drivers

  };

}



/* =========================================================
   FUNDAMENTALS
========================================================= */

function latestFundamentals(
  seriesMap
) {

  return Object
    .entries(
      FUNDAMENTAL_CONFIG
    )

    .flatMap(
      (
        [
          id,
          config
        ]
      ) => {

        const observations =
          seriesMap[id];


        if (
          !observations?.length
        ) {

          return [];

        }


        const latest =
          observations.at(
            -1
          );


        const previous =
          observations.length >
            1

            ? observations.at(
                -2
              )

            : null;


        const yearAgo =
          observations.length >
            12

            ? observations.at(
                -13
              )

            : null;


        return [
          {

            id,

            label:
              config.label,

            unit:
              config.unit,

            frequency:
              config.frequency,

            date:
              latest.date,

            value:
              round(
                latest.value,
                3
              ),

            previous:
              previous

                ? round(
                    previous.value,
                    3
                  )

                : null,

            change:
              previous

                ? round(
                    latest.value -
                    previous.value,
                    3
                  )

                : null,

            yoyPct:
              yearAgo &&
              yearAgo.value !==
                0

                ? round(

                    100 *
                    (
                      latest.value /
                      yearAgo.value -
                      1
                    ),

                    2

                  )

                : null

          }
        ];

      }
    );

}



/* =========================================================
   FORWARD FILL
========================================================= */

function forwardFill(
  series,
  dates
) {

  let index =
    0;


  let last =
    null;


  const output =
    new Map();


  for (
    const date
    of dates
  ) {

    while (
      index <
        series.length &&
      series[index].date <=
        date
    ) {

      last =
        series[index].value;


      index++;

    }


    if (
      Number.isFinite(
        last
      )
    ) {

      output.set(
        date,
        last
      );

    }

  }


  return output;

}



/* =========================================================
   LINEAR ALGEBRA
========================================================= */

function solveLinear(
  A,
  b
) {

  const n =
    A.length;


  const matrix =
    A.map(
      (
        row,
        i
      ) =>
        [
          ...row,
          b[i]
        ]
    );


  for (
    let i = 0;
    i < n;
    i++
  ) {

    let maxRow =
      i;


    for (
      let k =
        i + 1;

      k < n;

      k++
    ) {

      if (
        Math.abs(
          matrix[k][i]
        ) >
        Math.abs(
          matrix[
            maxRow
          ][i]
        )
      ) {

        maxRow =
          k;

      }

    }


    [
      matrix[i],
      matrix[maxRow]
    ] =
    [
      matrix[maxRow],
      matrix[i]
    ];


    if (
      Math.abs(
        matrix[i][i]
      ) <
      1e-10
    ) {

      return null;

    }


    const pivot =
      matrix[i][i];


    for (
      let j = i;
      j <= n;
      j++
    ) {

      matrix[i][j] /=
        pivot;

    }


    for (
      let k = 0;
      k < n;
      k++
    ) {

      if (
        k === i
      ) {

        continue;

      }


      const factor =
        matrix[k][i];


      for (
        let j = i;
        j <= n;
        j++
      ) {

        matrix[k][j] -=
          factor *
          matrix[i][j];

      }

    }

  }


  return matrix.map(
    row =>
      row[n]
  );

}



function ridgeRegression(
  X,
  y,
  lambda = 0.25
) {

  const p =
    X[0].length;


  const A =
    Array.from(
      {
        length:
          p
      },
      () =>
        Array(
          p
        )
        .fill(
          0
        )
    );


  const b =
    Array(
      p
    )
    .fill(
      0
    );


  for (
    let row = 0;
    row < X.length;
    row++
  ) {

    for (
      let i = 0;
      i < p;
      i++
    ) {

      b[i] +=
        X[row][i] *
        y[row];


      for (
        let j = 0;
        j < p;
        j++
      ) {

        A[i][j] +=
          X[row][i] *
          X[row][j];

      }

    }

  }


  for (
    let i = 1;
    i < p;
    i++
  ) {

    A[i][i] +=
      lambda;

  }


  return solveLinear(
    A,
    b
  );

}



/* =========================================================
   FAIR VALUE MODEL
========================================================= */

function fairValueModel(
  dailyBars,
  seriesMap
) {

  const ids =
    [
      "DFII10",
      "DGS10",
      "T10YIE",
      "DTWEXBGS",
      "VIXCLS"
    ];


  if (
    ids.some(
      id =>
        !seriesMap[id]?.length
    )
  ) {

    return {
      available:
        false
    };

  }


  const gold =
    dailyBars.slice(
      -320
    );


  const dates =
    gold.map(
      bar =>
        utcDayKey(
          bar.time
        )
    );


  const maps =
    Object.fromEntries(

      ids.map(
        id =>
          [
            id,
            forwardFill(
              seriesMap[id],
              dates
            )
          ]
      )

    );


  const rows =
    [];


  for (
    const bar
    of gold
  ) {

    const date =
      utcDayKey(
        bar.time
      );


    const x =
      ids.map(
        id =>
          maps[id].get(
            date
          )
      );


    if (
      x.every(
        Number.isFinite
      )
    ) {

      rows.push({

        date,

        price:
          bar.close,

        x

      });

    }

  }


  if (
    rows.length <
    100
  ) {

    return {
      available:
        false
    };

  }


  const train =
    rows.slice(
      -220
    );


  const means =
    ids.map(
      (
        _,
        j
      ) =>
        mean(
          train.map(
            row =>
              row.x[j]
          )
        )
    );


  const sds =
    ids.map(
      (
        _,
        j
      ) =>
        stdev(
          train.map(
            row =>
              row.x[j]
          )
        ) ||
        1
    );


  const X =
    train.map(
      row =>
        [
          1,

          ...row.x.map(
            (
              value,
              j
            ) =>
              (
                value -
                means[j]
              ) /
              sds[j]
          )

        ]
    );


  const y =
    train.map(
      row =>
        Math.log(
          row.price
        )
    );


  const beta =
    ridgeRegression(
      X,
      y,
      1.0
    );


  if (
    !beta
  ) {

    return {
      available:
        false
    };

  }


  const predictions =
    X.map(
      row =>
        row.reduce(
          (
            sum,
            value,
            j
          ) =>
            sum +
            value *
            beta[j],
          0
        )
    );


  const residuals =
    y.map(
      (
        value,
        i
      ) =>
        value -
        predictions[i]
    );


  const residualSd =
    stdev(
      residuals
    ) ||
    1;


  const currentX =
    X.at(
      -1
    );


  const predictedLog =
    currentX.reduce(
      (
        sum,
        value,
        j
      ) =>
        sum +
        value *
        beta[j],
      0
    );


  const fairValue =
    Math.exp(
      predictedLog
    );


  const actual =
    train.at(
      -1
    ).price;


  const residual =
    Math.log(
      actual
    ) -
    predictedLog;


  return {

    available:
      true,

    fairValue:
      round(
        fairValue,
        2
      ),

    actual:
      round(
        actual,
        2
      ),

    premiumDiscountPct:
      round(

        100 *
        (
          actual /
          fairValue -
          1
        ),

        2

      ),

    residualZ:
      round(
        residual /
        residualSd,
        2
      ),

    sampleSize:
      train.length,

    inputs:
      ids,

    note:
      "Experimental ridge model of daily log gold price versus macro levels; use as context, not intrinsic value."

  };

}



/* =========================================================
   CORRELATIONS
========================================================= */

function correlationModel(
  dailyBars,
  seriesMap
) {

  const configs =
    [

      [
        "DFII10",
        "10Y real yield",
        "difference"
      ],

      [
        "DGS10",
        "US 10Y yield",
        "difference"
      ],

      [
        "DGS2",
        "US 2Y yield",
        "difference"
      ],

      [
        "T10YIE",
        "10Y breakeven",
        "difference"
      ],

      [
        "DTWEXBGS",
        "Broad USD",
        "percent"
      ],

      [
        "VIXCLS",
        "VIX",
        "percent"
      ]

    ];


  const gold =
    dailyBars.slice(
      -140
    );


  const dates =
    gold.map(
      bar =>
        utcDayKey(
          bar.time
        )
    );


  const goldReturns =
    gold.map(
      (
        bar,
        i
      ) =>

        i

          ? 100 *
            (
              bar.close /
              gold[
                i - 1
              ].close -
              1
            )

          : null
    );


  const output =
    [];


  for (
    const [
      id,
      label,
      mode
    ]
    of configs
  ) {

    const series =
      seriesMap[id];


    if (
      !series?.length
    ) {

      continue;

    }


    const map =
      forwardFill(
        series,
        dates
      );


    const values =
      dates.map(
        date =>
          map.get(
            date
          )
      );


    const changes =
      values.map(
        (
          value,
          i
        ) => {

          if (
            !i ||
            !Number.isFinite(
              value
            ) ||
            !Number.isFinite(
              values[
                i - 1
              ]
            )
          ) {

            return null;

          }


          return (
            mode === "percent"

              ? 100 *
                (
                  value /
                  values[
                    i - 1
                  ] -
                  1
                )

              : value -
                values[
                  i - 1
                ]
          );

        }
      );


    output.push({

      id,

      label,

      correlation20d:
        round(

          pearson(

            goldReturns.slice(
              -21
            ),

            changes.slice(
              -21
            )

          ),

          2

        ),

      correlation60d:
        round(

          pearson(

            goldReturns.slice(
              -61
            ),

            changes.slice(
              -61
            )

          ),

          2

        )

    });

  }


  return output;

}



/* =========================================================
   CFTC COT
========================================================= */

async function fetchCftc() {

  const url =
    new URL(

      `https://publicreporting.cftc.gov/resource/${CFTC_DATASET}.json`

    );


  url.searchParams.set(
    "$limit",
    "170"
  );


  url.searchParams.set(
    "$order",
    "report_date_as_yyyy_mm_dd DESC"
  );


  url.searchParams.set(

    "$where",

    `cftc_contract_market_code='${GOLD_CFTC_CODE}'`

  );


  const rows =
    await fetchJson(

      url.toString(),

      12000,

      {
        "User-Agent":
          "MKAYFX-Gold-Intelligence/1.0"
      }

    );


  if (
    !Array.isArray(
      rows
    ) ||
    !rows.length
  ) {

    throw new Error(
      "No CFTC gold rows returned."
    );

  }


  const parsed =
    rows

      .map(
        row => {

          const long =
            num(
              row.m_money_positions_long_all
            ) ||
            0;


          const short =
            num(
              row.m_money_positions_short_all
            ) ||
            0;


          const producerLong =
            num(

              row.prod_merc_positions_long_all ??
              row.prod_merc_positions_long

            ) ||
            0;


          const producerShort =
            num(

              row.prod_merc_positions_short_all ??
              row.prod_merc_positions_short

            ) ||
            0;


          const swapLong =
            num(
              row.swap_positions_long_all
            ) ||
            0;


          const swapShort =
            num(
              row.swap__positions_short_all
            ) ||
            0;


          return {

            date:
              String(
                row.report_date_as_yyyy_mm_dd ||
                ""
              )
              .slice(
                0,
                10
              ),

            openInterest:
              num(
                row.open_interest_all
              ),

            mmLong:
              long,

            mmShort:
              short,

            mmNet:
              long -
              short,

            producerNet:
              producerLong -
              producerShort,

            swapNet:
              swapLong -
              swapShort

          };

        }
      )

      .filter(
        row =>
          row.date
      );


  const latest =
    parsed[0];


  const previous =
    parsed[1];


  const nets =
    parsed
      .slice(
        0,
        156
      )
      .map(
        row =>
          row.mmNet
      );


  const min =
    Math.min(
      ...nets
    );


  const max =
    Math.max(
      ...nets
    );


  const index =
    max !== min

      ? 100 *
        (
          latest.mmNet -
          min
        ) /
        (
          max -
          min
        )

      : 50;


  return {

    reportDate:
      latest.date,

    openInterest:
      latest.openInterest,

    managedMoneyLong:
      latest.mmLong,

    managedMoneyShort:
      latest.mmShort,

    managedMoneyNet:
      latest.mmNet,

    managedMoneyWeeklyChange:
      previous

        ? latest.mmNet -
          previous.mmNet

        : null,

    cotIndex3y:
      round(
        index,
        1
      ),

    producerNet:
      latest.producerNet,

    swapDealerNet:
      latest.swapNet,

    state:

      index >= 90

        ? "CROWDED LONG"

        : index <= 10

          ? "CROWDED SHORT"

          : index >= 70

            ? "LONG-HEAVY"

            : index <= 30

              ? "SHORT-HEAVY"

              : "MID-RANGE",

    history:
      parsed
        .slice(
          0,
          12
        )
        .reverse()
        .map(
          row => ({

            date:
              row.date,

            net:
              row.mmNet

          })
        )

  };

}



/* =========================================================
   FRED ECONOMIC EVENTS
========================================================= */

async function fetchFredEvents(
  apiKey
) {

  const start =
    new Date();


  const end =
    new Date(
      Date.now() +
      21 *
      86400000
    );


  const url =
    new URL(
      `${FRED_BASE}/releases/dates`
    );


  url.searchParams.set(
    "api_key",
    apiKey
  );


  url.searchParams.set(
    "file_type",
    "json"
  );


  url.searchParams.set(

    "realtime_start",

    start
      .toISOString()
      .slice(
        0,
        10
      )

  );


  url.searchParams.set(

    "realtime_end",

    end
      .toISOString()
      .slice(
        0,
        10
      )

  );


  url.searchParams.set(

    "include_release_dates_with_no_data",

    "true"

  );


  url.searchParams.set(
    "sort_order",
    "asc"
  );


  url.searchParams.set(
    "limit",
    "1000"
  );


  const data =
    await fetchJson(
      url.toString(),
      10000
    );


  const patterns =
    [

      [
        /Consumer Price Index/i,
        "HIGH"
      ],

      [
        /Employment Situation/i,
        "HIGH"
      ],

      [
        /Personal Income and Outlays/i,
        "HIGH"
      ],

      [
        /Gross Domestic Product/i,
        "HIGH"
      ],

      [
        /Producer Price Index/i,
        "HIGH"
      ],

      [
        /Retail and Food Services/i,
        "MEDIUM"
      ],

      [
        /Job Openings/i,
        "MEDIUM"
      ],

      [
        /Industrial Production/i,
        "MEDIUM"
      ],

      [
        /FOMC|Federal Open Market/i,
        "HIGH"
      ]

    ];


  const seen =
    new Set();


  return (
    data.release_dates ||
    []
  )

  .flatMap(
    event => {

      const match =
        patterns.find(
          (
            [
              regex
            ]
          ) =>
            regex.test(
              event.release_name ||
              ""
            )
        );


      if (
        !match
      ) {

        return [];

      }


      const key =
        `${event.date}|${event.release_name}`;


      if (
        seen.has(
          key
        )
      ) {

        return [];

      }


      seen.add(
        key
      );


      return [
        {

          date:
            event.date,

          name:
            event.release_name,

          impact:
            match[1],

          releaseId:
            event.release_id

        }
      ];

    }
  )

  .slice(
    0,
    15
  );

}



/* =========================================================
   NEWS
========================================================= */

async function fetchNews() {

  const query =
    '(gold OR XAUUSD OR "Federal Reserve" OR "US dollar" OR "Treasury yields")';


  const url =
    new URL(
      "https://api.gdeltproject.org/api/v2/doc/doc"
    );


  url.searchParams.set(
    "query",
    query
  );


  url.searchParams.set(
    "mode",
    "ArtList"
  );


  url.searchParams.set(
    "maxrecords",
    "18"
  );


  url.searchParams.set(
    "format",
    "json"
  );


  url.searchParams.set(
    "sort",
    "HybridRel"
  );


  const data =
    await fetchJson(
      url.toString(),
      12000
    );


  return (
    data.articles ||
    []
  )
  .slice(
    0,
    12
  )
  .map(
    article => ({

      title:
        article.title ||
        "Untitled",

      url:
        article.url ||
        null,

      domain:
        article.domain ||
        null,

      sourceCountry:
        article.sourcecountry ||
        null,

      seenDate:
        article.seendate ||
        null

    })
  );

}



/* =========================================================
   PRESSURE MAP
========================================================= */

function buildPressureMap(
  timeframes,
  macro,
  volatility,
  liquidity,
  cot
) {

  const values =
    Object
      .values(
        timeframes
      )
      .filter(
        timeframe =>
          timeframe.available
      );


  const trendScore =
    mean(

      values.map(
        timeframe =>

          timeframe.trend ===
          "UP"

            ? 1

            : timeframe.trend ===
              "DOWN"

              ? -1

              : 0
      )

    ) ||
    0;


  const momentumScore =
    mean(

      values.map(
        timeframe =>

          timeframe.momentum.includes(
            "UP"
          )

            ? 1

            : timeframe.momentum.includes(
                "DOWN"
              )

              ? -1

              : 0
      )

    ) ||
    0;


  const structureScore =
    mean(

      values.map(
        timeframe =>

          timeframe.structure ===
          "HH / HL"

            ? 1

            : timeframe.structure ===
              "LH / LL"

              ? -1

              : 0
      )

    ) ||
    0;


  const price =
    values[0]?.price;


  let liquidityScore =
    0;


  if (
    Number.isFinite(
      price
    )
  ) {

    const above =
      liquidity
        .nearestAbove
        ?.[0]
        ?.distance;


    const below =
      liquidity
        .nearestBelow
        ?.[0]
        ?.distance;


    if (
      Number.isFinite(
        above
      ) &&
      Number.isFinite(
        below
      )
    ) {

      liquidityScore =
        clamp(

          (
            below -
            above
          ) /
          Math.max(
            above,
            below,
            1
          ),

          -1,
          1

        );

    }

  }


  const cotScore =

    cot?.cotIndex3y !=
    null

      ? clamp(

          (
            cot.cotIndex3y -
            50
          ) /
          50,

          -1,
          1

        )

      : null;


  return {

    trend:
      round(
        trendScore *
        100,
        0
      ),

    momentum:
      round(
        momentumScore *
        100,
        0
      ),

    structure:
      round(
        structureScore *
        100,
        0
      ),

    macro:
      macro?.score ??
      null,

    liquiditySkew:
      round(
        liquidityScore *
        100,
        0
      ),

    positioning:
      cotScore ==
      null

        ? null

        : round(
            cotScore *
            100,
            0
          ),

    volatility:
      volatility?.regime ||
      null,

    note:
      "Independent context gauges. They are intentionally not combined into a trade signal."

  };

}



/* =========================================================
   SNAPSHOT
========================================================= */

function dailySnapshot(
  dailyBars,
  minuteBars
) {

  const price =

    minuteBars.at(
      -1
    )?.close ??

    dailyBars.at(
      -1
    )?.close;


  const currentDay =
    aggregateGroup(
      minuteBars,
      utcDayKey
    )
    .at(
      -1
    );


  const previous =
    dailyBars.length >
      1

      ? dailyBars.at(
          -2
        )

      : null;


  const week =
    aggregateGroup(
      dailyBars,
      weekStartKey
    )
    .at(
      -1
    );


  const month =
    aggregateGroup(
      dailyBars,
      monthKey
    )
    .at(
      -1
    );


  return {

    price:
      round(
        price,
        2
      ),

    dayChangePct:
      previous

        ? round(

            100 *
            (
              price /
              previous.close -
              1
            ),

            2

          )

        : null,

    fromDayOpenPct:
      currentDay

        ? round(

            100 *
            (
              price /
              currentDay.open -
              1
            ),

            2

          )

        : null,

    fromWeekOpenPct:
      week

        ? round(

            100 *
            (
              price /
              week.open -
              1
            ),

            2

          )

        : null,

    fromMonthOpenPct:
      month

        ? round(

            100 *
            (
              price /
              month.open -
              1
            ),

            2

          )

        : null,

    dayHigh:
      round(
        currentDay?.high,
        2
      ),

    dayLow:
      round(
        currentDay?.low,
        2
      )

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
    "Content-Type",
    "application/json; charset=utf-8"
  );


  res.setHeader(
    "Cache-Control",
    "s-maxage=240, stale-while-revalidate=180"
  );


  const twelveDataKey =
    process.env
      .TWELVE_DATA_API_KEY;


  const fredKey =
    process.env
      .FRED_API_KEY;


  if (
    !twelveDataKey
  ) {

    return res
      .status(500)
      .json({

        ok:
          false,

        error:
          "Missing TWELVE_DATA_API_KEY in Vercel."

      });

  }


  const health =
    {};


  try {

    const macroIds =
      [

        ...Object.keys(
          MACRO_CONFIG
        ),

        ...Object.keys(
          FUNDAMENTAL_CONFIG
        )

      ];


    const macroPromise =

      fredKey

        ? Promise.allSettled(

            macroIds.map(
              async id => [

                id,

                await fredSeries(

                  fredKey,

                  id,

                  FUNDAMENTAL_CONFIG[id]

                    ? 40

                    : 300

                )

              ]
            )

          )

        : Promise.resolve(
            []
          );


    const [

      minuteResult,

      dailyResult,

      macroResults,

      cftcResult,

      eventResult,

      newsResult

    ] =

      await Promise
        .allSettled(
          [

            tdSeries(
              twelveDataKey,
              "1min",
              5000
            ),

            tdSeries(
              twelveDataKey,
              "1day",
              1000
            ),

            macroPromise,

            fetchCftc(),

            fredKey

              ? fetchFredEvents(
                  fredKey
                )

              : Promise.resolve(
                  []
                ),

            fetchNews()

          ]
        );


    if (
      minuteResult.status !==
      "fulfilled"
    ) {

      throw minuteResult.reason;

    }


    if (
      dailyResult.status !==
      "fulfilled"
    ) {

      throw dailyResult.reason;

    }


    const minuteBars =
      minuteResult.value;


    const dailyBars =
      dailyResult.value;


    health.xau =
      "OK";


    const seriesMap =
      {};


    if (
      macroResults.status ===
        "fulfilled" &&
      Array.isArray(
        macroResults.value
      )
    ) {

      for (
        const result
        of macroResults.value
      ) {

        if (
          result.status ===
          "fulfilled"
        ) {

          const [
            id,
            observations
          ] =
            result.value;


          seriesMap[id] =
            observations;

        }

      }


      health.fred =

        fredKey

          ? Object.keys(
              seriesMap
            ).length

            ? "OK"

            : "ERROR"

          : "NOT CONFIGURED";

    }

    else {

      health.fred =
        fredKey

          ? "ERROR"

          : "NOT CONFIGURED";

    }


    const m5 =
      resample(
        minuteBars,
        5
      );


    const m15 =
      resample(
        minuteBars,
        15
      );


    const h1 =
      resample(
        minuteBars,
        60
      );


    const h4 =
      resample(
        minuteBars,
        240
      );


    const timeframes =
      {

        M1:
          timeframeState(
            minuteBars,
            "M1"
          ),

        M5:
          timeframeState(
            m5,
            "M5"
          ),

        M15:
          timeframeState(
            m15,
            "M15"
          ),

        H1:
          timeframeState(
            h1,
            "H1"
          ),

        H4:
          timeframeState(
            h4,
            "H4"
          ),

        D1:
          timeframeState(
            dailyBars,
            "D1"
          )

      };


    const snapshot =
      dailySnapshot(
        dailyBars,
        minuteBars
      );


    const liquidity =
      liquidityModel(
        minuteBars,
        dailyBars,
        m15,
        snapshot.price
      );


    const volatility =
      volatilityModel(
        minuteBars,
        dailyBars
      );


    const analog =
      historicalAnalog(
        dailyBars
      );


    const macro =

      Object.keys(
        seriesMap
      ).length

        ? macroPressure(
            seriesMap
          )

        : {
            score:
              null,
            drivers:
              []
          };


    const fundamentals =

      Object.keys(
        seriesMap
      ).length

        ? latestFundamentals(
            seriesMap
          )

        : [];


    const fairValue =

      Object.keys(
        seriesMap
      ).length

        ? fairValueModel(
            dailyBars,
            seriesMap
          )

        : {
            available:
              false
          };


    const correlations =

      Object.keys(
        seriesMap
      ).length

        ? correlationModel(
            dailyBars,
            seriesMap
          )

        : [];


    const cot =

      cftcResult.status ===
      "fulfilled"

        ? cftcResult.value

        : null;


    health.cftc =
      cot

        ? "OK"

        : "ERROR";


    const events =

      eventResult.status ===
      "fulfilled"

        ? eventResult.value

        : [];


    health.events =

      fredKey

        ? eventResult.status ===
          "fulfilled"

          ? "OK"

          : "ERROR"

        : "NOT CONFIGURED";


    const news =

      newsResult.status ===
      "fulfilled"

        ? newsResult.value

        : [];


    health.news =

      newsResult.status ===
      "fulfilled"

        ? "OK"

        : "ERROR";


    const pressure =
      buildPressureMap(

        timeframes,

        macro,

        volatility,

        liquidity,

        cot

      );


    const volumeAvailable =
      minuteBars.some(
        bar =>
          Number.isFinite(
            bar.volume
          ) &&
          bar.volume >
          0
      );


    return res
      .status(200)
      .json({

        ok:
          true,

        symbol:
          "XAU/USD",

        generatedAt:
          new Date()
            .toISOString(),

        snapshot,

        pressure,

        timeframes,

        liquidity,

        volatility,

        macro,

        fundamentals,

        correlations,

        fairValue,

        cot,

        analog,

        events,

        news,

        marketDataNotes:
          {

            volumeAvailable,

            volumeMessage:

              volumeAvailable

                ? "Volume field is available from the selected feed."

                : "No centralized spot-gold volume is supplied by this feed; the terminal does not invent volume data.",

            sessionMessage:
              "Asia/London/New York ranges use approximate UTC session windows.",

            cotMessage:
              "CFTC positioning is weekly and refers to COMEX Gold futures, not spot XAU/USD."

          },

        chart:
          dailyBars
            .slice(
              -140
            )
            .map(
              bar => ({

                date:
                  utcDayKey(
                    bar.time
                  ),

                close:
                  round(
                    bar.close,
                    2
                  )

              })
            ),

        health

      });

  }

  catch (
    error
  ) {

    health.xau =
      health.xau ||
      "ERROR";


    return res
      .status(502)
      .json({

        ok:
          false,

        error:
          error?.message ||
          "Gold intelligence request failed.",

        health

      });

  }

}