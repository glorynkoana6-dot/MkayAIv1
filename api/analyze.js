/* ==========================================================
   MKAYFX - FREE PLAN LIVE MARKET ENGINE

   - ONE Twelve Data request per refresh
   - M15 and H1 are built locally from M5
   - 55-second cache prevents repeated button taps burning credits
   - Works without an OpenAI API key using local technical analysis
========================================================== */

const TWELVE_URL = "https://api.twelvedata.com/time_series";

const CACHE_MS = 55_000;
const OUTPUT_SIZE = 1000;

const marketCache = new Map();
const inFlight = new Map();


/* ==========================================================
   RESPONSE
========================================================== */

function send(res, status, data) {
    return res
        .status(status)
        .json(data);
}


/* ==========================================================
   HELPERS
========================================================== */

function clamp(value, min, max) {
    return Math.max(
        min,
        Math.min(max, value)
    );
}


function round(value, digits = 2) {

    if (!Number.isFinite(Number(value))) {
        return null;
    }

    return Number(
        Number(value)
            .toFixed(digits)
    );
}


function parseUtc(datetime) {

    const clean =
        String(datetime || "")
            .trim()
            .replace(" ", "T");

    const withZone =
        /Z$|[+-]\d\d:\d\d$/.test(clean)
            ? clean
            : `${clean}Z`;

    return new Date(withZone)
        .getTime();
}


/* ==========================================================
   TWELVE DATA
========================================================== */

async function requestM5(symbol) {

    const key =
        process.env.TWELVE_DATA_API_KEY;

    if (!key) {

        throw new Error(
            "TWELVE_DATA_API_KEY is missing in Vercel."
        );
    }


    const params =
        new URLSearchParams({

            symbol,

            interval:
                "5min",

            outputsize:
                String(OUTPUT_SIZE),

            timezone:
                "UTC",

            format:
                "JSON",

            apikey:
                key
        });


    const response =
        await fetch(
            `${TWELVE_URL}?${params}`
        );


    const data =
        await response.json();


    if (
        !response.ok ||
        data.status === "error" ||
        !Array.isArray(data.values)
    ) {

        throw new Error(
            data.message ||
            "Twelve Data request failed."
        );
    }


    const candles =
        data.values

        .map(x => ({

            t:
                x.datetime,

            o:
                Number(x.open),

            h:
                Number(x.high),

            l:
                Number(x.low),

            c:
                Number(x.close),

            v:
                Number(
                    x.volume || 0
                )

        }))

        .filter(
            x =>
                [
                    x.o,
                    x.h,
                    x.l,
                    x.c
                ]
                .every(
                    Number.isFinite
                )
        )

        .reverse();


    if (
        candles.length < 120
    ) {

        throw new Error(
            "Not enough market data returned for analysis."
        );
    }


    return candles;
}


/* ==========================================================
   CACHE

   Prevents every button tap from using another Twelve Data
   credit.
========================================================== */

async function getM5Cached(symbol) {

    const key =
        symbol.toUpperCase();

    const now =
        Date.now();

    const cached =
        marketCache.get(key);


    if (
        cached &&
        now - cached.time <
        CACHE_MS
    ) {

        return {

            candles:
                cached.candles,

            cacheHit:
                true
        };
    }


    if (
        inFlight.has(key)
    ) {

        const candles =
            await inFlight.get(key);

        return {

            candles,

            cacheHit:
                true
        };
    }


    const pending =

        requestM5(key)

        .then(candles => {

            marketCache.set(
                key,
                {
                    time:
                        Date.now(),

                    candles
                }
            );

            return candles;

        })

        .finally(() => {

            inFlight.delete(key);

        });


    inFlight.set(
        key,
        pending
    );


    const candles =
        await pending;


    return {

        candles,

        cacheHit:
            false
    };
}


/* ==========================================================
   REMOVE FORMING CANDLE
========================================================== */

function completedM5(candles) {

    return candles.length > 2

        ? candles.slice(
            0,
            -1
        )

        : candles;
}


/* ==========================================================
   CREATE M15 / H1 FROM M5

   No additional Twelve Data requests.
========================================================== */

function resample(
    candles,
    minutes,
    expectedBars
) {

    const bucketMs =
        minutes *
        60_000;


    const buckets =
        new Map();


    for (
        const candle
        of candles
    ) {

        const ms =
            parseUtc(
                candle.t
            );


        if (
            !Number.isFinite(ms)
        ) {
            continue;
        }


        const bucketStart =
            Math.floor(
                ms /
                bucketMs
            ) *
            bucketMs;


        const existing =
            buckets.get(
                bucketStart
            );


        if (!existing) {

            buckets.set(
                bucketStart,
                {

                    start:
                        bucketStart,

                    count:
                        1,

                    o:
                        candle.o,

                    h:
                        candle.h,

                    l:
                        candle.l,

                    c:
                        candle.c,

                    v:
                        candle.v || 0

                }
            );

        }

        else {

            existing.count += 1;

            existing.h =
                Math.max(
                    existing.h,
                    candle.h
                );

            existing.l =
                Math.min(
                    existing.l,
                    candle.l
                );

            existing.c =
                candle.c;

            existing.v +=
                candle.v || 0;
        }
    }


    return [
        ...buckets.values()
    ]

    .filter(
        x =>
            x.count >=
            expectedBars
    )

    .sort(
        (a, b) =>
            a.start -
            b.start
    )

    .map(x => ({

        t:
            new Date(
                x.start
            )
            .toISOString()
            .replace(
                "T",
                " "
            )
            .slice(
                0,
                19
            ),

        o:
            x.o,

        h:
            x.h,

        l:
            x.l,

        c:
            x.c,

        v:
            x.v

    }));
}


/* ==========================================================
   EMA
========================================================== */

function ema(
    values,
    period
) {

    if (
        !values.length
    ) {

        return null;
    }


    const k =
        2 /
        (period + 1);


    let value =
        values[0];


    for (
        let i = 1;
        i < values.length;
        i++
    ) {

        value =
            values[i] *
            k +
            value *
            (1 - k);
    }


    return value;
}


/* ==========================================================
   ATR
========================================================== */

function atr(
    candles,
    period = 14
) {

    if (
        candles.length < 2
    ) {

        return 0;
    }


    const ranges =
        [];


    for (
        let i = 1;
        i < candles.length;
        i++
    ) {

        const cur =
            candles[i];

        const prev =
            candles[i - 1];


        ranges.push(

            Math.max(

                cur.h -
                cur.l,

                Math.abs(
                    cur.h -
                    prev.c
                ),

                Math.abs(
                    cur.l -
                    prev.c
                )
            )
        );
    }


    const use =
        ranges.slice(
            -period
        );


    return (
        use.reduce(
            (a, b) =>
                a + b,
            0
        )
        /
        Math.max(
            1,
            use.length
        )
    );
}


/* ==========================================================
   HIGHEST / LOWEST
========================================================== */

function highest(
    candles,
    amount = 20
) {

    const slice =
        candles.slice(
            -amount
        );


    return slice.length

        ? Math.max(
            ...slice.map(
                x => x.h
            )
        )

        : null;
}


function lowest(
    candles,
    amount = 20
) {

    const slice =
        candles.slice(
            -amount
        );


    return slice.length

        ? Math.min(
            ...slice.map(
                x => x.l
            )
        )

        : null;
}


/* ==========================================================
   TIMEFRAME ANALYSIS
========================================================== */

function timeframeRead(
    candles
) {

    if (
        candles.length < 30
    ) {

        return {

            bias:
                "NEUTRAL",

            strength:
                30,

            structure:
                "INSUFFICIENT DATA",

            atr:
                0,

            close:
                candles.at(-1)?.c ??
                null,

            recentHigh:
                highest(
                    candles,
                    20
                ),

            recentLow:
                lowest(
                    candles,
                    20
                )
        };
    }


    const closes =
        candles.map(
            x => x.c
        );


    const close =
        closes.at(-1);


    const e20 =
        ema(
            closes.slice(-120),
            20
        );


    const e50 =
        ema(
            closes.slice(-180),
            50
        );


    const a =
        atr(
            candles,
            14
        )
        ||
        Math.max(
            close *
            0.0005,
            0.01
        );


    const recent =
        candles.slice(
            -20
        );


    const previous =
        candles.slice(
            -40,
            -20
        );


    const recentHigh =
        Math.max(
            ...recent.map(
                x => x.h
            )
        );


    const recentLow =
        Math.min(
            ...recent.map(
                x => x.l
            )
        );


    const prevHigh =
        previous.length

        ? Math.max(
            ...previous.map(
                x => x.h
            )
        )

        : recentHigh;


    const prevLow =
        previous.length

        ? Math.min(
            ...previous.map(
                x => x.l
            )
        )

        : recentLow;


    let structure =
        "RANGE";


    if (
        recentHigh >
        prevHigh &&
        recentLow >
        prevLow
    ) {

        structure =
            "HH / HL";
    }


    if (
        recentHigh <
        prevHigh &&
        recentLow <
        prevLow
    ) {

        structure =
            "LH / LL";
    }


    let bias =
        "NEUTRAL";


    if (
        close > e20 &&
        e20 > e50
    ) {

        bias =
            "BULLISH";
    }

    else if (
        close < e20 &&
        e20 < e50
    ) {

        bias =
            "BEARISH";
    }


    const momentumLookback =
        Math.min(
            10,
            closes.length - 1
        );


    const oldClose =
        closes[
            closes.length -
            1 -
            momentumLookback
        ];


    const momentum =
        oldClose

        ? Math.abs(
            close -
            oldClose
        )
        /
        a

        : 0;


    const separation =
        Math.abs(
            e20 -
            e50
        )
        /
        a;


    let strength =

        38 +

        separation *
        18 +

        momentum *
        7;


    if (
        structure ===
        "HH / HL" &&
        bias ===
        "BULLISH"
    ) {

        strength += 8;
    }


    if (
        structure ===
        "LH / LL" &&
        bias ===
        "BEARISH"
    ) {

        strength += 8;
    }


    if (
        bias ===
        "NEUTRAL"
    ) {

        strength =
            Math.min(
                strength,
                55
            );
    }


    strength =
        Math.round(
            clamp(
                strength,
                25,
                95
            )
        );


    return {

        bias,

        strength,

        structure,

        atr:
            a,

        close,

        recentHigh,

        recentLow
    };
}


/* ==========================================================
   SIGNAL ENGINE
========================================================== */

function makeLocalAnalysis(
    symbol,
    currentPrice,
    m5,
    m15,
    h1
) {

    const r5 =
        timeframeRead(m5);

    const r15 =
        timeframeRead(m15);

    const r1 =
        timeframeRead(h1);


    let buyScore =
        0;

    let sellScore =
        0;


    const scoreBias =
        (
            read,
            weight
        ) => {

            if (
                read.bias ===
                "BULLISH"
            ) {

                buyScore +=
                    weight;
            }


            if (
                read.bias ===
                "BEARISH"
            ) {

                sellScore +=
                    weight;
            }
        };


    scoreBias(
        r1,
        38
    );

    scoreBias(
        r15,
        28
    );

    scoreBias(
        r5,
        20
    );


    if (
        r1.structure ===
        "HH / HL"
    ) {

        buyScore += 8;
    }


    if (
        r1.structure ===
        "LH / LL"
    ) {

        sellScore += 8;
    }


    if (
        r15.structure ===
        "HH / HL"
    ) {

        buyScore += 6;
    }


    if (
        r15.structure ===
        "LH / LL"
    ) {

        sellScore += 6;
    }


    let decision =
        "WAIT";


    const best =
        Math.max(
            buyScore,
            sellScore
        );


    const difference =
        Math.abs(
            buyScore -
            sellScore
        );


    if (
        buyScore >= 70 &&
        difference >= 18 &&
        r1.bias ===
        "BULLISH"
    ) {

        decision =
            "BUY";
    }


    else if (
        sellScore >= 70 &&
        difference >= 18 &&
        r1.bias ===
        "BEARISH"
    ) {

        decision =
            "SELL";
    }


    const confidence =

        decision ===
        "WAIT"

        ?

        Math.round(
            clamp(
                45 +
                difference *
                0.25,

                45,
                69
            )
        )

        :

        Math.round(
            clamp(
                best,
                70,
                92
            )
        );


    const m5Atr =
        r5.atr ||
        currentPrice *
        0.001;


    const riskDistance =
        Math.max(

            m5Atr *
            1.25,

            currentPrice *
            0.0007
        );


    let entry =
        null;

    let stop =
        null;

    let tp1 =
        null;

    let tp2 =
        null;

    let rr =
        null;


    /* ======================================================
       BUY LEVELS
    ====================================================== */

    if (
        decision ===
        "BUY"
    ) {

        entry =
            currentPrice;


        const swingStop =
            Number.isFinite(
                r5.recentLow
            )

            ?

            r5.recentLow -
            m5Atr *
            0.15

            :

            entry -
            riskDistance;


        stop =
            Math.min(

                entry -
                riskDistance,

                swingStop
            );


        const risk =
            entry -
            stop;


        tp1 =
            entry +
            risk *
            1.8;


        tp2 =
            entry +
            risk *
            2.5;


        rr =
            1.8;
    }


    /* ======================================================
       SELL LEVELS
    ====================================================== */

    if (
        decision ===
        "SELL"
    ) {

        entry =
            currentPrice;


        const swingStop =
            Number.isFinite(
                r5.recentHigh
            )

            ?

            r5.recentHigh +
            m5Atr *
            0.15

            :

            entry +
            riskDistance;


        stop =
            Math.max(

                entry +
                riskDistance,

                swingStop
            );


        const risk =
            stop -
            entry;


        tp1 =
            entry -
            risk *
            1.8;


        tp2 =
            entry -
            risk *
            2.5;


        rr =
            1.8;
    }


    /* ======================================================
       MARKET REGIME
    ====================================================== */

    const aligned =
        [
            r5.bias,
            r15.bias,
            r1.bias
        ]

        .filter(
            x =>
                x !==
                "NEUTRAL"
        );


    const allBull =

        aligned.length === 3 &&

        aligned.every(
            x =>
                x ===
                "BULLISH"
        );


    const allBear =

        aligned.length === 3 &&

        aligned.every(
            x =>
                x ===
                "BEARISH"
        );


    const regime =

        allBull

        ?

        "BULLISH TREND"

        :

        allBear

        ?

        "BEARISH TREND"

        :

        "MIXED / RANGE";


    /* ======================================================
       SETUP GRADE
    ====================================================== */

    let setupGrade =
        "NO TRADE";


    if (
        decision !==
        "WAIT"
    ) {

        setupGrade =

            confidence >= 88
            ? "A+"

            :

            confidence >= 82
            ? "A"

            :

            confidence >= 75
            ? "B"

            :

            "C";
    }


    /* ======================================================
       REASONING
    ====================================================== */

    const reasons = [

        `H1 bias: ${r1.bias} (${r1.strength}%), structure ${r1.structure}.`,

        `M15 bias: ${r15.bias} (${r15.strength}%), structure ${r15.structure}.`,

        `M5 bias: ${r5.bias} (${r5.strength}%), structure ${r5.structure}.`,

        `Directional score: BUY ${buyScore} vs SELL ${sellScore}.`

    ];


    if (
        decision ===
        "WAIT"
    ) {

        reasons.push(

            "The engine requires stronger H1 alignment and a clearer multi-timeframe advantage before issuing a trade."
        );
    }

    else {

        reasons.push(

            `${decision} passed the higher-timeframe alignment filter and minimum score threshold.`
        );
    }


    const high =
        round(
            r15.recentHigh,
            2
        );


    const low =
        round(
            r15.recentLow,
            2
        );


    /* ======================================================
       FINAL RESULT
    ====================================================== */

    return {

        decision,

        confidence,

        setup_grade:
            setupGrade,


        summary:

            decision ===
            "WAIT"

            ?

            `${symbol} does not currently have enough multi-timeframe alignment for a high-quality entry.`

            :

            `${decision} setup detected on ${symbol} with H1, M15 and M5 technical confirmation.`,


        market_regime:
            regime,


        structure_summary:

            `H1 ${r1.structure}; M15 ${r15.structure}; M5 ${r5.structure}.`,


        liquidity_summary:

            `Recent M15 range: high ${high ?? "n/a"}, low ${low ?? "n/a"}.`,


        macro_bias:
            "UNKNOWN",


        macro_summary:

            "Macro/news data is not included in free local mode; this verdict is technical only.",


        entry:
            round(
                entry,
                2
            ),


        stop_loss:
            round(
                stop,
                2
            ),


        take_profit_1:
            round(
                tp1,
                2
            ),


        take_profit_2:
            round(
                tp2,
                2
            ),


        risk_reward:
            rr,


        invalidation:

            decision ===
            "BUY"

            ?

            `Bullish setup invalid below ${round(stop, 2)}.`

            :

            decision ===
            "SELL"

            ?

            `Bearish setup invalid above ${round(stop, 2)}.`

            :

            "Wait until H1 direction and lower-timeframe structure align more clearly.",


        next_trigger:

            decision ===
            "WAIT"

            ?

            "H1 + M15 directional alignment with M5 confirmation."

            :

            `Watch for price to hold the ${
                decision === "BUY"
                    ? "bullish"
                    : "bearish"
            } M5 structure.`,


        timeframes: {

            m5: {

                bias:
                    r5.bias,

                strength:
                    r5.strength
            },


            m15: {

                bias:
                    r15.bias,

                strength:
                    r15.strength
            },


            h1: {

                bias:
                    r1.bias,

                strength:
                    r1.strength
            }
        },


        reasons,


        risks: [

            "This is a technical estimate, not a guaranteed outcome.",

            "Fast news, spreads and slippage can invalidate levels before the next refresh.",

            "Macro/news confirmation is not included in free local mode."

        ]
    };
}


/* ==========================================================
   VERCEL ENDPOINT
========================================================== */

export default async function handler(
    req,
    res
) {

    res.setHeader(
        "Cache-Control",
        "no-store"
    );


    if (
        req.method !==
        "POST"
    ) {

        return send(
            res,
            405,
            {
                error:
                    "Use POST."
            }
        );
    }


    try {

        const symbol =
            String(

                req.body?.symbol ||
                "XAU/USD"

            )
            .trim()
            .toUpperCase();


        if (!symbol) {

            return send(
                res,
                400,
                {
                    error:
                        "Symbol is required."
                }
            );
        }


        /* ==================================================
           ONLY ONE TWELVE DATA REQUEST
        ================================================== */

        const {

            candles:
                m5Raw,

            cacheHit

        } =

        await getM5Cached(
            symbol
        );


        const currentPrice =
            m5Raw.at(-1).c;


        /* ==================================================
           COMPLETED M5
        ================================================== */

        const m5 =
            completedM5(
                m5Raw
            );


        /* ==================================================
           BUILD M15 LOCALLY
        ================================================== */

        const m15 =
            resample(
                m5,
                15,
                3
            );


        /* ==================================================
           BUILD H1 LOCALLY
        ================================================== */

        const h1 =
            resample(
                m5,
                60,
                12
            );


        if (
            m15.length < 30 ||
            h1.length < 30
        ) {

            throw new Error(

                "Not enough completed candles to build M15/H1 analysis yet."
            );
        }


        /* ==================================================
           RUN LOCAL ANALYSIS
        ================================================== */

        const analysis =
            makeLocalAnalysis(

                symbol,

                currentPrice,

                m5,

                m15,

                h1
            );


        /* ==================================================
           RETURN TO DASHBOARD
        ================================================== */

        return send(
            res,
            200,
            {

                success:
                    true,


                symbol,


                current_price:
                    currentPrice,


                model:
                    "local-technical-engine",


                reasoning_effort:
                    "deterministic",


                analysis,


                guardrail_note:

                    cacheHit

                    ?

                    "Free-plan mode: reused cached market data, so this refresh used 0 new Twelve Data credits."

                    :

                    "Free-plan mode: 1 Twelve Data request used. M15 and H1 were built locally from M5 data.",


                chart:
                    m5Raw.slice(
                        -60
                    ),


                data_mode:

                    "1-credit M5 + local M15/H1 aggregation",


                cache_hit:
                    cacheHit,


                timestamp:

                    new Date()
                    .toISOString()

            }
        );

    }


    catch (error) {

        console.error(
            error
        );


        return send(
            res,
            500,
            {

                success:
                    false,


                error:

                    error?.message ||

                    "Unknown server error."

            }
        );
    }
}