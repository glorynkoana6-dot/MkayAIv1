/* =========================================================
   MKAYFX GOLD S&R SCALPER V1
   /api/sr.js

   XAU/USD
   EXECUTION: M1
   CONFIRMATION: M5 + M15

   FEATURES
   --------
   - Confirmed non-future pivots
   - Strong support/resistance scoring
   - Liquidity sweeps
   - Rejection candles
   - Breakout/retest logic
   - EMA trend alignment
   - RSI momentum
   - ATR volatility
   - M5 / M15 confirmation
   - Setup score 0-100
   - Entry / SL / TP1 / TP2
   - Built-in historical backtest
   - Profit factor
   - Expectancy
   - Max drawdown
   - Win rate

   REQUIRED VERCEL ENV:
   TWELVE_DATA_API_KEY
========================================================= */

const API_KEY =
  process.env.TWELVE_DATA_API_KEY;

const BASE_URL =
  "https://api.twelvedata.com";

const SYMBOL =
  "XAU/USD";


/* =========================================================
   CONFIG
========================================================= */

const CFG = {

  M1_BARS: 900,
  M5_BARS: 400,
  M15_BARS: 300,

  ATR_LEN: 14,
  RSI_LEN: 14,

  EMA_FAST: 20,
  EMA_MID: 50,
  EMA_SLOW: 200,

  PIVOT_LEN: 5,

  MAX_LEVELS: 8,

  LEVEL_MERGE_ATR: 0.35,

  TOUCH_ATR: 0.28,

  SWEEP_MIN_ATR: 0.04,
  SWEEP_MAX_ATR: 1.20,

  BREAKOUT_ATR: 0.12,

  STOP_BUFFER_ATR: 0.22,

  MIN_STOP_ATR: 0.75,
  MAX_STOP_ATR: 2.20,

  TP1_R: 1.50,
  TP2_R: 2.20,

  MIN_SIGNAL_SCORE: 68,

  STRONG_SIGNAL_SCORE: 80,

  COOLDOWN_BARS: 6,

  BACKTEST_LOOKBACK: 650,

  BACKTEST_MAX_HOLD: 45,

  BACKTEST_COST_R: 0.05,

  MIN_LEVEL_TOUCHES: 1

};


/* =========================================================
   GENERIC HELPERS
========================================================= */

function num(v) {

  const n =
    Number(v);

  return Number.isFinite(n)
    ? n
    : null;

}


function round(
  value,
  digits = 2
) {

  const n =
    num(value);

  return n === null
    ? null
    : Number(
        n.toFixed(digits)
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


function mean(
  arr
) {

  const values =
    arr.filter(
      Number.isFinite
    );

  if (!values.length) {
    return null;
  }

  return values.reduce(
    (sum, value) =>
      sum + value,
    0
  ) / values.length;

}


function safeError(
  value
) {

  if (value == null) {
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
      String(value)
    );
  }

  if (
    typeof value ===
    "object"
  ) {

    if (
      value.message
    ) {
      return safeError(
        value.message
      );
    }

    try {

      return JSON.stringify(
        value
      );

    } catch {

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
   TIME HELPERS
========================================================= */

function parseTime(
  value
) {

  if (!value) {
    return NaN;
  }

  const clean =
    String(value)
      .trim()
      .replace(
        " ",
        "T"
      );

  return new Date(

    /Z$|[+-]\d\d:\d\d$/.test(
      clean
    )
      ? clean
      : `${clean}Z`

  ).getTime();

}


function minutesOld(
  value
) {

  const t =
    parseTime(value);

  if (
    !Number.isFinite(t)
  ) {
    return null;
  }

  return Math.max(
    0,
    (
      Date.now() -
      t
    ) / 60000
  );

}


/* =========================================================
   FETCH
========================================================= */

async function getJSON(
  url,
  timeout = 18000
) {

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeout
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

    const text =
      await response.text();

    let data =
      {};

    try {

      data =
        text
          ? JSON.parse(text)
          : {};

    } catch {

      throw new Error(
        `Non-JSON provider response: ${text.slice(0, 250)}`
      );

    }

    if (
      !response.ok ||
      data?.status === "error"
    ) {

      throw new Error(
        data?.message ||
        `HTTP ${response.status}`
      );

    }

    return data;

  } catch (error) {

    if (
      error?.name ===
      "AbortError"
    ) {

      throw new Error(
        "Market-data request timed out."
      );

    }

    throw error;

  } finally {

    clearTimeout(
      timer
    );

  }

}


/* =========================================================
   MARKET DATA
========================================================= */

async function fetchSeries(
  interval,
  outputsize
) {

  if (!API_KEY) {

    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel."
    );

  }

  const query =
    new URLSearchParams({

      symbol:
        SYMBOL,

      interval,

      outputsize:
        String(outputsize),

      timezone:
        "UTC",

      format:
        "JSON",

      apikey:
        API_KEY

    });

  const data =
    await getJSON(
      `${BASE_URL}/time_series?${query}`
    );

  if (
    !Array.isArray(
      data.values
    )
  ) {

    throw new Error(
      `${interval}: no candles returned.`
    );

  }

  const bars =
    data.values

      .map(
        x => ({

          time:
            String(
              x.datetime ||
              ""
            ),

          open:
            Number(x.open),

          high:
            Number(x.high),

          low:
            Number(x.low),

          close:
            Number(x.close),

          volume:
            Number(
              x.volume ||
              0
            )

        })
      )

      .filter(
        x =>
          [
            x.open,
            x.high,
            x.low,
            x.close
          ].every(
            Number.isFinite
          )
      )

      .sort(
        (a, b) =>
          parseTime(a.time) -
          parseTime(b.time)
      );

  if (
    bars.length < 100
  ) {

    throw new Error(
      `${interval}: only ${bars.length} usable candles returned.`
    );

  }

  return bars;

}


async function fetchQuote() {

  if (!API_KEY) {

    throw new Error(
      "TWELVE_DATA_API_KEY is missing."
    );

  }

  const query =
    new URLSearchParams({

      symbol:
        SYMBOL,

      apikey:
        API_KEY

    });

  const data =
    await getJSON(
      `${BASE_URL}/quote?${query}`
    );

  const price =
    num(
      data.close ??
      data.price ??
      data.previous_close
    );

  if (
    price === null
  ) {

    throw new Error(
      "Live XAU/USD quote unavailable."
    );

  }

  return {

    price,

    time:
      data.datetime ||
      data.timestamp ||
      null

  };

}


/* =========================================================
   INDICATORS
========================================================= */

function emaSeries(
  values,
  period
) {

  if (!values.length) {
    return [];
  }

  const multiplier =
    2 / (
      period +
      1
    );

  const output =
    [];

  let current =
    values[0];

  output.push(
    current
  );

  for (
    let i = 1;
    i < values.length;
    i++
  ) {

    current =
      values[i] *
      multiplier +
      current *
      (
        1 -
        multiplier
      );

    output.push(
      current
    );

  }

  return output;

}


function emaAt(
  bars,
  index,
  period
) {

  if (
    index < 0
  ) {
    return null;
  }

  const start =
    Math.max(
      0,
      index -
      period *
      5
    );

  const closes =
    bars
      .slice(
        start,
        index + 1
      )
      .map(
        x =>
          x.close
      );

  if (
    closes.length <
    period
  ) {
    return null;
  }

  return emaSeries(
    closes,
    period
  ).at(-1);

}


function trueRange(
  bars,
  index
) {

  if (
    index === 0
  ) {

    return (
      bars[index].high -
      bars[index].low
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
  period = CFG.ATR_LEN
) {

  if (
    index <
    period
  ) {
    return null;
  }

  const values =
    [];

  for (
    let i =
      index -
      period +
      1;
    i <= index;
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


function rsiAt(
  bars,
  index,
  period = CFG.RSI_LEN
) {

  if (
    index <=
    period
  ) {
    return 50;
  }

  let gains =
    0;

  let losses =
    0;

  for (
    let i =
      index -
      period +
      1;
    i <= index;
    i++
  ) {

    const change =
      bars[i].close -
      bars[i - 1].close;

    if (
      change >
      0
    ) {
      gains +=
        change;
    } else {
      losses -=
        change;
    }

  }

  if (
    losses ===
    0
  ) {
    return 100;
  }

  const rs =
    gains /
    Math.max(
      losses,
      1e-9
    );

  return (
    100 -
    100 /
    (
      1 +
      rs
    )
  );

}


/* =========================================================
   PIVOTS
========================================================= */

function pivotLow(
  bars,
  center,
  length
) {

  if (
    center <
    length ||
    center + length >=
    bars.length
  ) {
    return false;
  }

  const price =
    bars[center].low;

  for (
    let i =
      center - length;
    i <=
      center + length;
    i++
  ) {

    if (
      i !== center &&
      bars[i].low <
      price
    ) {
      return false;
    }

  }

  return true;

}


function pivotHigh(
  bars,
  center,
  length
) {

  if (
    center <
    length ||
    center + length >=
    bars.length
  ) {
    return false;
  }

  const price =
    bars[center].high;

  for (
    let i =
      center - length;
    i <=
      center + length;
    i++
  ) {

    if (
      i !== center &&
      bars[i].high >
      price
    ) {
      return false;
    }

  }

  return true;

}


/* =========================================================
   CONFIRMED LEVELS

   IMPORTANT:
   Only pivots whose RIGHT HAND candles already exist
   are allowed.

   This avoids future-data leakage.
========================================================= */

function confirmedLevels(
  bars,
  index,
  atr
) {

  const supports =
    [];

  const resistances =
    [];

  const length =
    CFG.PIVOT_LEN;

  const latestCenter =
    index -
    length;

  const earliest =
    Math.max(
      length,
      latestCenter -
      260
    );

  for (
    let center =
      latestCenter;
    center >= earliest;
    center--
  ) {

    if (
      pivotLow(
        bars,
        center,
        length
      )
    ) {

      supports.push({

        price:
          bars[center].low,

        center,

        time:
          bars[center].time,

        touches:
          1

      });

    }

    if (
      pivotHigh(
        bars,
        center,
        length
      )
    ) {

      resistances.push({

        price:
          bars[center].high,

        center,

        time:
          bars[center].time,

        touches:
          1

      });

    }

  }

  return {

    supports:
      mergeLevels(
        supports,
        atr
      ),

    resistances:
      mergeLevels(
        resistances,
        atr
      )

  };

}


/* =========================================================
   MERGE NEARBY LEVELS

   Levels tested multiple times become stronger.
========================================================= */

function mergeLevels(
  levels,
  atr
) {

  const merged =
    [];

  const tolerance =
    Math.max(
      atr *
      CFG.LEVEL_MERGE_ATR,
      0.01
    );

  for (
    const level
    of levels
  ) {

    let existing =
      merged.find(
        x =>
          Math.abs(
            x.price -
            level.price
          ) <=
          tolerance
      );

    if (
      existing
    ) {

      const oldTouches =
        existing.touches;

      existing.price =
        (
          existing.price *
          oldTouches +
          level.price
        ) /
        (
          oldTouches +
          1
        );

      existing.touches++;

      existing.center =
        Math.max(
          existing.center,
          level.center
        );

    } else {

      merged.push({
        ...level
      });

    }

  }

  merged.sort(
    (a, b) =>
      b.center -
      a.center
  );

  return merged.slice(
    0,
    CFG.MAX_LEVELS
  );

}


/* =========================================================
   NEAREST LEVEL
========================================================= */

function nearestSupport(
  supports,
  price,
  atr
) {

  const below =
    supports

      .filter(
        x =>
          x.price <=
          price +
          atr *
          CFG.TOUCH_ATR
      )

      .sort(
        (a, b) =>
          Math.abs(
            a.price -
            price
          )
          -
          Math.abs(
            b.price -
            price
          )
      );

  return below[0] ||
    null;

}


function nearestResistance(
  resistances,
  price,
  atr
) {

  const above =
    resistances

      .filter(
        x =>
          x.price >=
          price -
          atr *
          CFG.TOUCH_ATR
      )

      .sort(
        (a, b) =>
          Math.abs(
            a.price -
            price
          )
          -
          Math.abs(
            b.price -
            price
          )
      );

  return above[0] ||
    null;

}


/* =========================================================
   CANDLE QUALITY
========================================================= */

function candleStats(
  bar
) {

  const range =
    Math.max(
      bar.high -
      bar.low,
      1e-9
    );

  const body =
    Math.abs(
      bar.close -
      bar.open
    );

  const upperWick =
    bar.high -
    Math.max(
      bar.open,
      bar.close
    );

  const lowerWick =
    Math.min(
      bar.open,
      bar.close
    ) -
    bar.low;

  const closePosition =
    (
      bar.close -
      bar.low
    ) /
    range;

  return {

    range,

    body,

    bodyRatio:
      body /
      range,

    upperWick,

    lowerWick,

    closePosition,

    bullish:
      bar.close >
      bar.open,

    bearish:
      bar.close <
      bar.open

  };

}


/* =========================================================
   HIGHER TIMEFRAME BIAS
========================================================= */

function timeframeSnapshot(
  bars
) {

  const i =
    bars.length -
    1;

  const price =
    bars[i].close;

  const ema20 =
    emaAt(
      bars,
      i,
      20
    );

  const ema50 =
    emaAt(
      bars,
      i,
      50
    );

  const ema200 =
    emaAt(
      bars,
      i,
      200
    );

  const rsi =
    rsiAt(
      bars,
      i
    );

  let score =
    0;

  if (
    ema20 !== null
  ) {

    score +=
      price >
      ema20
        ? 1
        : -1;

  }

  if (
    ema20 !== null &&
    ema50 !== null
  ) {

    score +=
      ema20 >
      ema50
        ? 1
        : -1;

  }

  if (
    ema50 !== null &&
    ema200 !== null
  ) {

    score +=
      ema50 >
      ema200
        ? 1
        : -1;

  }

  if (
    rsi >=
    55
  ) {

    score +=
      1;

  } else if (
    rsi <=
    45
  ) {

    score -=
      1;

  }

  return {

    price:
      round(
        price,
        2
      ),

    ema20:
      round(
        ema20