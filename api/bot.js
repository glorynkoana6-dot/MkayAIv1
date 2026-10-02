const API_KEY = process.env.TWELVE_DATA_API_KEY;
const BASE = "https://api.twelvedata.com";

const MARKETS = {
  "XAU/USD": {
    name: "Gold",
    decimals: 2,
    minStopPct: 0.0010,
    atrMult: 1.15
  },

  "BTC/USD": {
    name: "Bitcoin",
    decimals: 2,
    minStopPct: 0.0018,
    atrMult: 1.25
  }
};

const cache = new Map();


/* =========================================================
   BASIC HELPERS
========================================================= */

function n(v, fallback = null) {
  const x = Number(v);

  return Number.isFinite(x)
    ? x
    : fallback;
}


function round(v, d = 2) {
  const x = Number(v);

  return Number.isFinite(x)
    ? Number(x.toFixed(d))
    : null;
}


function clamp(v, lo, hi) {
  return Math.max(
    lo,
    Math.min(
      hi,
      v
    )
  );
}


function avg(a) {
  const v =
    a.filter(
      Number.isFinite
    );

  return v.length
    ? v.reduce(
        (s, x) =>
          s + x,
        0
      ) / v.length
    : 0;
}


function sd(a) {
  if (!a.length) {
    return 0;
  }

  const m =
    avg(a);

  return Math.sqrt(
    avg(
      a.map(
        x =>
          (x - m) ** 2
      )
    )
  );
}


function errorText(v) {
  if (!v) {
    return "Unknown error.";
  }

  if (
    typeof v === "string"
  ) {
    return v;
  }

  if (
    v instanceof Error
  ) {
    return (
      v.message ||
      "Unknown error."
    );
  }

  if (
    typeof v === "object"
  ) {
    if (
      typeof v.message ===
      "string"
    ) {
      return v.message;
    }

    if (
      typeof v.error ===
      "string"
    ) {
      return v.error;
    }

    try {
      return JSON.stringify(v);
    } catch {}
  }

  return String(v);
}


function bodyOf(req) {
  if (
    req.body &&
    typeof req.body ===
    "object"
  ) {
    return req.body;
  }

  if (
    typeof req.body ===
    "string"
  ) {
    try {
      return JSON.parse(
        req.body
      );
    } catch {
      return {};
    }
  }

  return {};
}


function symbolOf(
  req,
  body
) {
  const symbol =
    body.symbol ||
    req.query?.symbol ||
    "XAU/USD";

  if (!MARKETS[symbol]) {
    throw new Error(
      "Unsupported market. Use XAU/USD or BTC/USD."
    );
  }

  return symbol;
}


/* =========================================================
   API URL
========================================================= */

function queryURL(
  path,
  params
) {
  const q =
    Object.entries(params)
      .map(
        ([k, v]) =>
          `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
      )
      .join("&");

  return (
    `${BASE}${path}?${q}`
  );
}


/* =========================================================
   FETCH + CACHE
========================================================= */

async function fetchJSON(
  url,
  ttlMs = 0
) {
  const now =
    Date.now();

  const hit =
    cache.get(url);

  if (
    ttlMs &&
    hit &&
    now - hit.time < ttlMs
  ) {
    return hit.data;
  }


  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      18000
    );


  try {
    const response =
      await fetch(
        url,
        {
          method: "GET",

          cache: "no-store",

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


    let data;


    try {
      data =
        JSON.parse(raw);
    } catch {
      throw new Error(
        "Market-data provider returned invalid JSON."
      );
    }


    if (
      !response.ok ||
      data?.status === "error"
    ) {
      throw new Error(
        errorText(
          data?.message ||
          data?.error ||
          `HTTP ${response.status}`
        )
      );
    }


    if (ttlMs) {
      cache.set(
        url,
        {
          time:
            now,

          data
        }
      );
    }


    return data;

  } catch (e) {
    if (
      e?.name ===
      "AbortError"
    ) {
      throw new Error(
        "Market-data request timed out."
      );
    }

    throw e;

  } finally {
    clearTimeout(
      timer
    );
  }
}


/* =========================================================
   MARKET DATA
========================================================= */

async function candles(
  symbol,
  interval,
  outputsize
) {
  if (!API_KEY) {
    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel."
    );
  }


  const url =
    queryURL(
      "/time_series",
      {
        symbol,
        interval,
        outputsize,
        timezone:
          "UTC",
        format:
          "JSON",
        apikey:
          API_KEY
      }
    );


  const data =
    await fetchJSON(
      url,
      45000
    );


  if (
    !Array.isArray(
      data.values
    )
  ) {
    throw new Error(
      `No ${interval} candles returned for ${symbol}.`
    );
  }


  const out =
    data.values
      .map(
        x => ({
          time:
            String(
              x.datetime ||
              ""
            ),

          open:
            Number(
              x.open
            ),

          high:
            Number(
              x.high
            ),

          low:
            Number(
              x.low
            ),

          close:
            Number(
              x.close
            ),

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
      .reverse();


  if (
    out.length <
    30
  ) {
    throw new Error(
      `Not enough ${interval} candles for ${symbol}.`
    );
  }


  return out;
}


async function livePrice(
  symbol
) {
  if (!API_KEY) {
    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel."
    );
  }


  const url =
    queryURL(
      "/price",
      {
        symbol,

        apikey:
          API_KEY
      }
    );


  const data =
    await fetchJSON(
      url,
      12000
    );


  const price =
    Number(
      data.price
    );


  if (
    !Number.isFinite(
      price
    )
  ) {
    throw new Error(
      `Live ${symbol} price unavailable.`
    );
  }


  return price;
}


/* =========================================================
   TIME + RESAMPLING
========================================================= */

function parseTime(v) {
  let s =
    String(
      v ||
      ""
    )
    .trim()
    .replace(
      " ",
      "T"
    );


  if (
    !s.endsWith("Z") &&
    !/[+-]\d\d:\d\d$/.test(
      s
    )
  ) {
    s += "Z";
  }


  return Date.parse(
    s
  );
}


function resample(
  cs,
  minutes
) {
  const step =
    minutes *
    60000;


  const m =
    new Map();


  for (
    const c
    of cs
  ) {
    const t =
      parseTime(
        c.time
      );


    if (
      !Number.isFinite(
        t
      )
    ) {
      continue;
    }


    const b =
      Math.floor(
        t / step
      ) *
      step;


    const key =
      String(b);


    if (
      !m.has(
        key
      )
    ) {
      m.set(
        key,
        {
          time:
            new Date(b)
              .toISOString(),

          open:
            c.open,

          high:
            c.high,

          low:
            c.low,

          close:
            c.close,

          volume:
            c.volume ||
            0
        }
      );

    } else {
      const x =
        m.get(key);


      x.high =
        Math.max(
          x.high,
          c.high
        );


      x.low =
        Math.min(
          x.low,
          c.low
        );


      x.close =
        c.close;


      x.volume +=
        c.volume ||
        0;
    }
  }


  return [
    ...m.values()
  ].sort(
    (a, b) =>
      parseTime(a.time) -
      parseTime(b.time)
  );
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


  const k =
    2 /
    (
      period +
      1
    );


  const out =
    [
      values[0]
    ];


  for (
    let i = 1;
    i < values.length;
    i++
  ) {
    out.push(
      values[i] *
      k +
      out[i - 1] *
      (
        1 -
        k
      )
    );
  }


  return out;
}


function ema(
  values,
  period
) {
  const s =
    emaSeries(
      values,
      period
    );

  return (
    s.at(-1) ??
    0
  );
}


function rsi(
  values,
  p = 14
) {
  if (
    values.length <=
    p
  ) {
    return 50;
  }


  let g = 0;
  let l = 0;


  for (
    let i =
      values.length -
      p;

    i <
      values.length;

    i++
  ) {
    const d =
      values[i] -
      values[i - 1];


    if (
      d >= 0
    ) {
      g += d;
    } else {
      l -= d;
    }
  }


  if (
    l === 0
  ) {
    return 100;
  }


  const rs =
    (
      g /
      p
    )
    /
    (
      l /
      p
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


function atr(
  cs,
  p = 14
) {
  if (
    cs.length <
    2
  ) {
    return 0;
  }


  const tr = [];


  for (
    let i = 1;
    i < cs.length;
    i++
  ) {
    tr.push(
      Math.max(
        cs[i].high -
        cs[i].low,

        Math.abs(
          cs[i].high -
          cs[i - 1].close
        ),

        Math.abs(
          cs[i].low -
          cs[i - 1].close
        )
      )
    );
  }


  return avg(
    tr.slice(
      -p
    )
  );
}


function macd(
  values
) {
  if (
    values.length <
    35
  ) {
    return {
      line: 0,
      signal: 0,
      hist: 0
    };
  }


  const e12 =
    emaSeries(
      values,
      12
    );


  const e26 =
    emaSeries(
      values,
      26
    );


  const line =
    values.map(
      (_, i) =>
        e12[i] -
        e26[i]
    );


  const sig =
    emaSeries(
      line,
      9
    );


  return {
    line:
      line.at(-1),

    signal:
      sig.at(-1),

    hist:
      line.at(-1) -
      sig.at(-1)
  };
}


function bollinger(
  values,
  p = 20,
  mult = 2
) {
  const w =
    values.slice(
      -p
    );


  const mid =
    avg(w);


  const s =
    sd(w);


  return {
    mid,

    upper:
      mid +
      mult *
      s,

    lower:
      mid -
      mult *
      s,

    width:
      mid
        ? (
            2 *
            mult *
            s
          ) /
          mid
        : 0
  };
}


function stochastic(
  cs,
  p = 14
) {
  const w =
    cs.slice(
      -p
    );


  const h =
    Math.max(
      ...w.map(
        x =>
          x.high
      )
    );


  const l =
    Math.min(
      ...w.map(
        x =>
          x.low
      )
    );


  const c =
    cs.at(-1)
      ?.close ??
    0;


  return h === l
    ? 50
    : (
        (
          c -
          l
        )
        /
        (
          h -
          l
        )
      ) *
      100;
}


function adx(
  cs,
  p = 14
) {
  if (
    cs.length <
    p +
    2
  ) {
    return 20;
  }


  let trs = [];
  let plus = [];
  let minus = [];


  for (
    let i = 1;
    i < cs.length;
    i++
  ) {
    const up =
      cs[i].high -
      cs[i - 1].high;


    const dn =
      cs[i - 1].low -
      cs[i].low;


    plus.push(
      up > dn &&
      up > 0
        ? up
        : 0
    );


    minus.push(
      dn > up &&
      dn > 0
        ? dn
        : 0
    );


    trs.push(
      Math.max(
        cs[i].high -
        cs[i].low,

        Math.abs(
          cs[i].high -
          cs[i - 1].close
        ),

        Math.abs(
          cs[i].low -
          cs[i - 1].close
        )
      )
    );
  }


  const tr =
    avg(
      trs.slice(
        -p
      )
    );


  if (!tr) {
    return 20;
  }


  const pdi =
    100 *
    avg(
      plus.slice(
        -p
      )
    )
    /
    tr;


  const mdi =
    100 *
    avg(
      minus.slice(
        -p
      )
    )
    /
    tr;


  return (
    pdi +
    mdi
  )
    ? 100 *
      Math.abs(
        pdi -
        mdi
      )
      /
      (
        pdi +
        mdi
      )
    : 20;
}


function roc(
  values,
  p = 10
) {
  if (
    values.length <=
    p
  ) {
    return 0;
  }


  const prev =
    values.at(
      -1 -
      p
    );


  return prev
    ? (
        (
          values.at(-1) -
          prev
        )
        /
        prev
      ) *
      100
    : 0;
}


/* =========================================================
   VOLATILITY
========================================================= */

function percentileRank(
  arr,
  value
) {
  if (!arr.length) {
    return 50;
  }


  return (
    100 *
    arr.filter(
      x =>
        x <= value
    ).length
    /
    arr.length
  );
}


function volatilityRegime(
  cs
) {
  const ats = [];


  for (
    let i = 30;
    i < cs.length;
    i += 3
  ) {
    ats.push(
      atr(
        cs.slice(
          0,
          i + 1
        ),
        14
      )
    );
  }


  const current =
    atr(
      cs,
      14
    );


  const pct =
    percentileRank(
      ats.filter(
        Number.isFinite
      ),
      current
    );


  return {
    atr:
      current,

    percentile:
      pct,

    label:
      pct >= 75
        ? "HIGH"
        : pct <= 30
        ? "LOW"
        : "NORMAL"
  };
}


/* =========================================================
   SESSION
========================================================= */

function session(
  symbol
) {
  if (
    symbol ===
    "BTC/USD"
  ) {
    return "24/7 CRYPTO";
  }


  const h =
    (
      new Date()
        .getUTCHours()
      +
      2
    )
    %
    24;


  if (
    h >= 8 &&
    h < 11
  ) {
    return "LONDON OPEN";
  }


  if (
    h >= 11 &&
    h < 14
  ) {
    return "LONDON";
  }


  if (
    h >= 14 &&
    h < 18
  ) {
    return "LONDON / NEW YORK";
  }


  if (
    h >= 18 &&
    h < 23
  ) {
    return "NEW YORK";
  }


  return "ASIA / TRANSITION";
}


/* =========================================================
   SWINGS
========================================================= */

function pivots(
  cs,
  left = 2,
  right = 2
) {
  const highs = [];
  const lows = [];


  for (
    let i = left;
    i <
      cs.length -
      right;
    i++
  ) {
    let hi =
      true;

    let lo =
      true;


    for (
      let j =
        i -
        left;

      j <=
        i +
        right;

      j++
    ) {
      if (
        j === i
      ) {
        continue;
      }


      if (
        cs[j].high >=
        cs[i].high
      ) {
        hi = false;
      }


      if (
        cs[j].low <=
        cs[i].low
      ) {
        lo = false;
      }
    }


    if (hi) {
      highs.push({
        i,

        price:
          cs[i].high,

        time:
          cs[i].time
      });
    }


    if (lo) {
      lows.push({
        i,

        price:
          cs[i].low,

        time:
          cs[i].time
      });
    }
  }


  return {
    highs,
    lows
  };
}


/* =========================================================
   MARKET STRUCTURE
========================================================= */

function structure(
  cs
) {
  const p =
    pivots(
      cs.slice(
        -120
      )
    );


  const h =
    p.highs.slice(
      -2
    );


  const l =
    p.lows.slice(
      -2
    );


  const last =
    cs.at(-1);


  let score = 0;

  let label =
    "RANGE";

  let detail =
    "No confirmed structure break.";


  if (
    h.length >= 2 &&
    l.length >= 2
  ) {
    const hh =
      h[1].price >
      h[0].price;


    const hl =
      l[1].price >
      l[0].price;


    const lh =
      h[1].price <
      h[0].price;


    const ll =
      l[1].price <
      l[0].price;


    if (
      hh &&
      hl
    ) {
      score += 2;

      label =
        "HH / HL";

      detail =
        "Bullish market structure.";
    }


    if (
      lh &&
      ll
    ) {
      score -= 2;

      label =
        "LH / LL";

      detail =
        "Bearish market structure.";
    }


    if (
      last.close >
      h.at(-1).price
    ) {
      score += 1.5;

      label =
        "BOS UP";

      detail =
        "Bullish break of structure.";
    }


    if (
      last.close <
      l.at(-1).price
    ) {
      score -= 1.5;

      label =
        "BOS DOWN";

      detail =
        "Bearish break of structure.";
    }
  }


  return {
    score,
    label,
    detail,

    swingHigh:
      h.at(-1)
        ?.price ??
      Math.max(
        ...cs
          .slice(-20)
          .map(
            x =>
              x.high
          )
      ),

    swingLow:
      l.at(-1)
        ?.price ??
      Math.min(
        ...cs
          .slice(-20)
          .map(
            x =>
              x.low
          )
      )
  };
}


/* =========================================================
   LIQUIDITY
========================================================= */

function liquidity(
  cs
) {
  const latest =
    cs.at(-1);


  const prev =
    cs.slice(
      -18,
      -1
    );


  const high =
    Math.max(
      ...prev.map(
        x =>
          x.high
      )
    );


  const low =
    Math.min(
      ...prev.map(
        x =>
          x.low
      )
    );


  if (
    latest.low <
    low &&
    latest.close >
    low
  ) {
    return {
      score: 2,

      label:
        "SELL-SIDE SWEEP",

      detail:
        "Sell-side liquidity swept and reclaimed."
    };
  }


  if (
    latest.high >
    high &&
    latest.close <
    high
  ) {
    return {
      score: -2,

      label:
        "BUY-SIDE SWEEP",

      detail:
        "Buy-side liquidity swept and rejected."
    };
  }


  return {
    score: 0,

    label:
      "NO SWEEP",

    detail:
      "No confirmed external liquidity sweep."
  };
}


/* =========================================================
   FAIR VALUE GAP
========================================================= */

function fvg(
  cs
) {
  if (
    cs.length <
    4
  ) {
    return {
      score: 0,
      label: "NONE",
      detail: "No FVG."
    };
  }


  const a =
    cs.at(-3);


  const c =
    cs.at(-1);


  if (
    c.low >
    a.high
  ) {
    return {
      score: 1,

      label:
        "BULLISH FVG",

      detail:
        `Bullish imbalance ${round(a.high, 2)}-${round(c.low, 2)}.`
    };
  }


  if (
    c.high <
    a.low
  ) {
    return {
      score: -1,

      label:
        "BEARISH FVG",

      detail:
        `Bearish imbalance ${round(c.high, 2)}-${round(a.low, 2)}.`
    };
  }


  return {
    score: 0,

    label:
      "NONE",

    detail:
      "No fresh three-candle imbalance."
  };
}


/* =========================================================
   ORDER BLOCK
========================================================= */

function orderBlock(
  cs
) {
  for (
    let i =
      cs.length -
      3;

    i >=
      Math.max(
        2,
        cs.length -
        15
      );

    i--
  ) {
    const a =
      cs[i - 1];


    const b =
      cs[i];


    const c =
      cs[i + 1];


    if (
      a.close <
      a.open &&
      b.close >
      b.open &&
      c.close >
      b.high
    ) {
      return {
        score: 1,

        label:
          "BULLISH OB",

        zoneLow:
          a.low,

        zoneHigh:
          a.high,

        detail:
          "Bullish displacement from last bearish candle."
      };
    }


    if (
      a.close >
      a.open &&
      b.close <
      b.open &&
      c.close <
      b.low
    ) {
      return {
        score: -1,

        label:
          "BEARISH OB",

        zoneLow:
          a.low,

        zoneHigh:
          a.high,

        detail:
          "Bearish displacement from last bullish candle."
      };
    }
  }


  return {
    score: 0,

    label:
      "NONE",

    zoneLow:
      null,

    zoneHigh:
      null,

    detail:
      "No clean nearby order block."
  };
}


/* =========================================================
   PREMIUM / DISCOUNT
========================================================= */

function premiumDiscount(
  cs
) {
  const w =
    cs.slice(
      -60
    );


  const h =
    Math.max(
      ...w.map(
        x =>
          x.high
      )
    );


  const l =
    Math.min(
      ...w.map(
        x =>
          x.low
      )
    );


  const mid =
    (
      h +
      l
    )
    /
    2;


  const c =
    cs.at(-1)
      .close;


  return c <
    mid
    ? {
        score: 0.75,

        label:
          "DISCOUNT",

        midpoint:
          mid,

        detail:
          "Price is below recent range equilibrium."
      }
    : {
        score: -0.75,

        label:
          "PREMIUM",

        midpoint:
          mid,

        detail:
          "Price is above recent range equilibrium."
      };
}


/* =========================================================
   CANDLE PATTERN
========================================================= */

function candlePattern(
  cs
) {
  const a =
    cs.at(-2);


  const b =
    cs.at(-1);


  if (
    !a ||
    !b
  ) {
    return {
      score: 0,

      label:
        "NONE"
    };
  }


  const bullEngulf =
    a.close <
    a.open &&
    b.close >
    b.open &&
    b.open <=
    a.close &&
    b.close >=
    a.open;


  const bearEngulf =
    a.close >
    a.open &&
    b.close <
    b.open &&
    b.open >=
    a.close &&
    b.close <=
    a.open;


  const body =
    Math.abs(
      b.close -
      b.open
    );


  const range =
    Math.max(
      b.high -
      b.low,
      1e-9
    );


  const eff =
    body /
    range;


  if (
    bullEngulf
  ) {
    return {
      score: 1,

      label:
        "BULLISH ENGULF",

      efficiency:
        eff
    };
  }


  if (
    bearEngulf
  ) {
    return {
      score: -1,

      label:
        "BEARISH ENGULF",

      efficiency:
        eff
    };
  }


  if (
    eff > 0.72 &&
    b.close >
    b.open
  ) {
    return {
      score: 0.75,

      label:
        "BULL DISPLACEMENT",

      efficiency:
        eff
    };
  }


  if (
    eff > 0.72 &&
    b.close <
    b.open
  ) {
    return {
      score: -0.75,

      label:
        "BEAR DISPLACEMENT",

      efficiency:
        eff
    };
  }


  return {
    score: 0,

    label:
      "NEUTRAL",

    efficiency:
      eff
  };
}


/* =========================================================
   TIMEFRAME SNAPSHOT
========================================================= */

function snapshot(
  cs
) {
  const closes =
    cs.map(
      x =>
        x.close
    );


  const last =
    cs.at(-1);


  const e20 =
    ema(
      closes,
      20
    );


  const e50 =
    ema(
      closes,
      50
    );


  const e200 =
    closes.length >=
    210
      ? ema(
          closes,
          200
        )
      : ema(
          closes,
          Math.max(
            50,
            Math.floor(
              closes.length *
              0.65
            )
          )
        );


  const R =
    rsi(
      closes
    );


  const M =
    macd(
      closes
    );


  const B =
    bollinger(
      closes
    );


  const S =
    stochastic(
      cs
    );


  const A =
    adx(
      cs
    );


  const R10 =
    roc(
      closes,
      10
    );


  let score = 0;


  score +=
    last.close >
    e20
      ? 1
      : -1;


  score +=
    e20 >
    e50
      ? 1
      : -1;


  score +=
    e50 >
    e200
      ? 1
      : -1;


  if (
    R > 55
  ) {
    score += 0.8;
  } else if (
    R < 45
  ) {
    score -= 0.8;
  }


  if (
    M.hist > 0
  ) {
    score += 0.8;
  } else if (
    M.hist < 0
  ) {
    score -= 0.8;
  }


  if (
    R10 > 0
  ) {
    score += 0.5;
  } else if (
    R10 < 0
  ) {
    score -= 0.5;
  }


  if (
    last.close >
    B.mid
  ) {
    score += 0.4;
  } else {
    score -= 0.4;
  }


  return {
    score,

    bias:
      score >= 2
        ? "BULLISH"
        : score <= -2
        ? "BEARISH"
        : "NEUTRAL",

    ema20:
      e20,

    ema50:
      e50,

    ema200:
      e200,

    rsi:
      R,

    macd:
      M.hist,

    bollinger:
      B,

    stochastic:
      S,

    adx:
      A,

    roc:
      R10,

    atr:
      atr(
        cs,
        14
      ),

    close:
      last.close
  };
}


/* =========================================================
   MASTER SIGNAL ENGINE
========================================================= */

function buildSignal(
  symbol,
  frames,
  options
) {
  const market =
    MARKETS[symbol];


  const T = {
    M1:
      snapshot(
        frames.m1
      ),

    M5:
      snapshot(
        frames.m5
      ),

    M15:
      snapshot(
        frames.m15
      ),

    H1:
      snapshot(
        frames.h1
      ),

    H4:
      snapshot(
        frames.h4
      )
  };


  const ST =
    structure(
      frames.m5
    );


  const LQ =
    liquidity(
      frames.m5
    );


  const FVG =
    fvg(
      frames.m5
    );


  const OB =
    orderBlock(
      frames.m5
    );


  const PD =
    premiumDiscount(
      frames.m15
    );


  const CP =
    candlePattern(
      frames.m1
    );


  const VR =
    volatilityRegime(
      frames.m5
    );


  const regime =
    T.M5.adx >=
    25
      ? "TRENDING"
      : "RANGING";


  let raw =
      T.M1.score *
      0.6

    +
      T.M5.score *
      1.15

    +
      T.M15.score *
      1.55

    +
      T.H1.score *
      2.0

    +
      T.H4.score *
      1.5

    +
      ST.score *
      1.25

    +
      LQ.score *
      1.35

    +
      FVG.score *
      0.8

    +
      OB.score *
      0.9

    +
      PD.score *
      0.7

    +
      CP.score *
      0.8;


  if (
    regime ===
    "TRENDING"
  ) {
    raw +=
      Math.sign(raw) *
      0.75;
  }


  if (
    VR.label ===
    "HIGH"
  ) {
    raw *=
      0.92;
  }


  const direction =
    raw >= 0
      ? "BUY"
      : "SELL";


  const sign =
    direction ===
    "BUY"
      ? 1
      : -1;


  const agreement =
    [
      T.M1,
      T.M5,
      T.M15,
      T.H1,
      T.H4
    ]
    .filter(
      x =>
        direction ===
        "BUY"
          ? x.score > 0
          : x.score < 0
    )
    .length;


  const featureAgree =
    [
      ST.score,
      LQ.score,
      FVG.score,
      OB.score,
      PD.score,
      CP.score
    ]
    .filter(
      x =>
        direction ===
        "BUY"
          ? x > 0
          : x < 0
    )
    .length;


  const margin =
    Math.abs(
      raw
    );


  let confidence =
      48

    +
      agreement *
      5

    +
      featureAgree *
      2.5

    +
      Math.min(
        18,
        margin *
        1.15
      )

    +
      Math.min(
        6,
        T.M5.adx /
        10
      );


  confidence =
    Math.round(
      clamp(
        confidence,
        50,
        95
      )
    );


  const minConfidence =
    clamp(
      n(
        options.minConfidence,
        62
      ),
      50,
      90
    );


  const allowWait =
    Boolean(
      options.allowWait
    );


  const tradeable =
    confidence >=
    minConfidence &&
    margin >=
    4.5;


  const signal =
    allowWait &&
    !tradeable
      ? "WAIT"
      : direction;


  const entry =
    frames.m1
      .at(-1)
      .close;


  const a5 =
    Math.max(
      T.M5.atr,

      entry *
      market.minStopPct
    );


  let stopDistance =
    Math.max(
      a5 *
      market.atrMult,

      entry *
      market.minStopPct
    );


  if (
    direction ===
    "BUY" &&
    ST.swingLow <
    entry
  ) {
    stopDistance =
      Math.max(
        stopDistance,

        entry -
        ST.swingLow +
        a5 *
        0.1
      );
  }


  if (
    direction ===
    "SELL" &&
    ST.swingHigh >
    entry
  ) {
    stopDistance =
      Math.max(
        stopDistance,

        ST.swingHigh -
        entry +
        a5 *
        0.1
      );
  }


  stopDistance =
    Math.min(
      stopDistance,
      a5 *
      2.75
    );


  const rr =
    clamp(
      n(
        options.rr,
        2
      ),
      1,
      5
    );


  const sl =
    entry -
    sign *
    stopDistance;


  const tp =
    entry +
    sign *
    stopDistance *
    rr;


  const tp2 =
    entry +
    sign *
    stopDistance *
    (
      rr +
      1
    );


  const riskR =
    Math.abs(
      entry -
      sl
    );


  const breakeven =
    entry +
    sign *
    riskR;


  const trailTrigger =
    entry +
    sign *
    riskR *
    1.5;


  const quality =
    confidence >= 82
      ? "A+"
      : confidence >= 74
      ? "A"
      : confidence >= 66
      ? "B"
      : "C";


  const reasons = [
    `${direction} directional bias from weighted M1/M5/M15/H1/H4 confluence.`,

    `${regime} regime · ADX ${round(T.M5.adx, 1)} · volatility ${VR.label} (${round(VR.percentile, 0)}th percentile).`,

    `${ST.label}: ${ST.detail}`,

    `${LQ.label}: ${LQ.detail}`,

    `${OB.label}: ${OB.detail}`,

    `${FVG.label}: ${FVG.detail}`,

    `${PD.label}: ${PD.detail}`,

    `${CP.label} · M5 RSI ${round(T.M5.rsi, 1)} · MACD ${round(T.M5.macd, 4)} · Stoch ${round(T.M5.stochastic, 1)}.`,

    `Risk plan uses M5 ATR + swing structure with ${rr.toFixed(2)}R primary target.`
  ];


  return {
    signal,

    directionalBias:
      direction,

    confidence,

    quality,

    tradeable,

    score:
      raw,

    entry,

    stopLoss:
      sl,

    takeProfit:
      tp,

    takeProfit2:
      tp2,

    breakeven,

    trailTrigger,

    rr,

    regime,

    volatility:
      VR,

    session:
      session(
        symbol
      ),

    timeframeBias:
      Object.fromEntries(
        Object.entries(T)
          .map(
            ([k, v]) =>
              [
                k,
                v.bias
              ]
          )
      ),

    features: {
      structure:
        ST,

      liquidity:
        LQ,

      fvg:
        FVG,

      orderBlock:
        OB,

      premiumDiscount:
        PD,

      candlePattern:
        CP
    },

    indicators: {
      M1:
        T.M1,

      M5:
        T.M5,

      M15:
        T.M15,

      H1:
        T.H1,

      H4:
        T.H4
    },

    reasons
  };
}


/* =========================================================
   OPTIONAL TELEGRAM
========================================================= */

async function maybeTelegram(
  payload
) {
  const token =
    process.env
      .TELEGRAM_BOT_TOKEN;


  const chat =
    process.env
      .TELEGRAM_CHAT_ID;


  if (
    !token ||
    !chat
  ) {
    return {
      configured:
        false,

      sent:
        false
    };
  }


  try {
    const text =
      `MKAYFX ${payload.symbol} ${payload.signal}\n`
      +
      `Entry: ${payload.entry}\n`
      +
      `SL: ${payload.stopLoss}\n`
      +
      `TP: ${payload.takeProfit}\n`
      +
      `Confidence: ${payload.confidence}%\n`
      +
      `Quality: ${payload.quality}`;


    const url =
      `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;


    const r =
      await fetch(
        url,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              chat_id:
                chat,

              text
            })
        }
      );


    return {
      configured:
        true,

      sent:
        r.ok
    };

  } catch {
    return {
      configured:
        true,

      sent:
        false
    };
  }
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


  try {
    if (!API_KEY) {
      throw new Error(
        "TWELVE_DATA_API_KEY is missing in Vercel Environment Variables."
      );
    }


    const body =
      bodyOf(
        req
      );


    const symbol =
      symbolOf(
        req,
        body
      );


    const market =
      MARKETS[symbol];


    const mode =
      String(
        req.query?.mode ||
        ""
      )
      .toLowerCase();


    /* =====================================================
       HEALTH
    ===================================================== */

    if (
      req.method ===
      "GET" &&
      mode ===
      "health"
    ) {
      return res
        .status(200)
        .json({
          success:
            true,

          service:
            "MKAYFX OMEGA",

          apiKeyConfigured:
            Boolean(
              API_KEY
            ),

          telegramConfigured:
            Boolean(
              process.env
                .TELEGRAM_BOT_TOKEN &&
              process.env
                .TELEGRAM_CHAT_ID
            ),

          supported:
            Object.keys(
              MARKETS
            )
        });
    }


    /* =====================================================
       LIVE PRICE
    ===================================================== */

    if (
      req.method ===
      "GET" &&
      mode ===
      "price"
    ) {
      const price =
        await livePrice(
          symbol
        );


      return res
        .status(200)
        .json({
          success:
            true,

          symbol,

          price:
            round(
              price,
              market.decimals
            ),

          timestamp:
            new Date()
              .toISOString()
        });
    }


    if (
      req.method !==
      "POST"
    ) {
      return res
        .status(405)
        .json({
          success:
            false,

          error:
            "Use POST for analysis, or GET with mode=price/health."
        });
    }


    /* =====================================================
       FETCH M1 / M5 / H1
    ===================================================== */

    const [
      m1,
      m5,
      h1
    ] =
      await Promise.all([
        candles(
          symbol,
          "1min",
          320
        ),

        candles(
          symbol,
          "5min",
          650
        ),

        candles(
          symbol,
          "1h",
          360
        )
      ]);


    const m15 =
      resample(
        m5,
        15
      );


    const h4 =
      resample(
        h1,
        240
      );


    if (
      m15.length <
      50 ||
      h4.length <
      40
    ) {
      throw new Error(
        "Not enough multi-timeframe history returned."
      );
    }


    const result =
      buildSignal(
        symbol,
        {
          m1,
          m5,
          m15,
          h1,
          h4
        },
        body
      );


    const equity =
      clamp(
        n(
          body.equityZAR,
          200
        ),
        1,
        100000000
      );


    const riskPct =
      clamp(
        n(
          body.riskPercent,
          0.5
        ),
        0.1,
        5
      );


    const riskZAR =
      equity *
      riskPct /
      100;


    const payload = {
      success:
        true,

      model:
        "MKAYFX OMEGA V1",

      symbol,

      marketName:
        market.name,

      signalId:
        `OM-${Date.now()}-${symbol.replace("/", "")}-${result.signal}`,

      createdAt:
        new Date()
          .toISOString(),

      ...result,

      entry:
        round(
          result.entry,
          market.decimals
        ),

      stopLoss:
        round(
          result.stopLoss,
          market.decimals
        ),

      takeProfit:
        round(
          result.takeProfit,
          market.decimals
        ),

      takeProfit2:
        round(
          result.takeProfit2,
          market.decimals
        ),

      breakeven:
        round(
          result.breakeven,
          market.decimals
        ),

      trailTrigger:
        round(
          result.trailTrigger,
          market.decimals
        ),

      currentPrice:
        round(
          result.entry,
          market.decimals
        ),

      account: {
        equityZAR:
          round(
            equity,
            2
          ),

        riskPercent:
          round(
            riskPct,
            2
          ),

        maxRiskZAR:
          round(
            riskZAR,
            2
          )
      },

      chart:
        m1
          .slice(-120)
          .map(
            c => ({
              time:
                c.time,

              open:
                round(
                  c.open,
                  market.decimals
                ),

              high:
                round(
                  c.high,
                  market.decimals
                ),

              low:
                round(
                  c.low,
                  market.decimals
                ),

              close:
                round(
                  c.close,
                  market.decimals
                )
            })
          )
    };


    if (
      body.sendTelegram
    ) {
      payload.telegram =
        await maybeTelegram(
          payload
        );
    }


    return res
      .status(200)
      .json(
        payload
      );

  } catch (e) {
    console.error(
      "MKAYFX OMEGA ERROR:",
      e
    );


    return res
      .status(500)
      .json({
        success:
          false,

        error:
          errorText(e)
      });
  }
}