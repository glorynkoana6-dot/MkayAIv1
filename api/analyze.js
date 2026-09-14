/* ==========================================================
   MKAYFX V3 - SMART MONEY / MARKET STRUCTURE ENGINE

   FREE PLAN SAFE:
   - 1 Twelve Data request
   - M15 + H1 created from M5
   - 55 second market-data cache

   ANALYSIS:
   - Swing highs / lows
   - BOS
   - CHOCH
   - Liquidity sweeps
   - Fair Value Gaps
   - Displacement
   - Premium / Discount
   - Multi-timeframe alignment
   - Tighter dynamic SL / TP
========================================================== */

const TWELVE_URL =
    "https://api.twelvedata.com/time_series";

const CACHE_MS = 55_000;

const OUTPUT_SIZE = 1000;

const marketCache =
    new Map();

const inFlight =
    new Map();


/* ==========================================================
   RESPONSE
========================================================== */

function send(
    res,
    status,
    data
) {

    return res
        .status(status)
        .json(data);
}


/* ==========================================================
   BASIC HELPERS
========================================================== */

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

    if (
        value === null ||
        value === undefined ||
        !Number.isFinite(
            Number(value)
        )
    ) {

        return null;
    }


    return Number(
        Number(value)
            .toFixed(digits)
    );
}


function average(
    values
) {

    if (
        !values.length
    ) {

        return 0;
    }


    return (
        values.reduce(
            (a, b) =>
                a + b,
            0
        )
        /
        values.length
    );
}


function parseUtc(
    datetime
) {

    const clean =
        String(
            datetime || ""
        )
        .trim()
        .replace(
            " ",
            "T"
        );


    const zoned =

        /Z$|[+-]\d\d:\d\d$/
        .test(clean)

        ?

        clean

        :

        `${clean}Z`;


    return new Date(
        zoned
    )
    .getTime();
}


/* ==========================================================
   TWELVE DATA
========================================================== */

async function requestM5(
    symbol
) {

    const key =
        process.env
            .TWELVE_DATA_API_KEY;


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
                String(
                    OUTPUT_SIZE
                ),

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
        data.status ===
        "error" ||
        !Array.isArray(
            data.values
        )
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
                Number(
                    x.open
                ),

            h:
                Number(
                    x.high
                ),

            l:
                Number(
                    x.low
                ),

            c:
                Number(
                    x.close
                ),

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
        candles.length <
        200
    ) {

        throw new Error(
            "Not enough market data returned."
        );
    }


    return candles;
}


/* ==========================================================
   CACHE
========================================================== */

async function getM5Cached(
    symbol
) {

    const key =
        symbol
        .toUpperCase();


    const now =
        Date.now();


    const cached =
        marketCache.get(
            key
        );


    if (
        cached &&
        now -
        cached.time <
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
        inFlight.has(
            key
        )
    ) {

        const candles =
            await inFlight.get(
                key
            );


        return {

            candles,

            cacheHit:
                true
        };
    }


    const pending =

        requestM5(
            key
        )

        .then(
            candles => {

                marketCache.set(
                    key,
                    {

                        time:
                            Date.now(),

                        candles
                    }
                );


                return candles;
            }
        )

        .finally(
            () => {

                inFlight.delete(
                    key
                );
            }
        );


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
   COMPLETED CANDLES
========================================================== */

function completedCandles(
    candles
) {

    if (
        candles.length <= 2
    ) {

        return candles;
    }


    return candles.slice(
        0,
        -1
    );
}


/* ==========================================================
   RESAMPLE M5 -> M15 / H1
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


        const start =
            Math.floor(
                ms /
                bucketMs
            )
            *
            bucketMs;


        const existing =
            buckets.get(
                start
            );


        if (!existing) {

            buckets.set(
                start,
                {

                    start,

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

            existing.count +=
                1;


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

    .map(
        x => ({

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
        })
    );
}


/* ==========================================================
   VOLATILITY
========================================================== */

function trueRange(
    current,
    previous
) {

    return Math.max(

        current.h -
        current.l,

        Math.abs(
            current.h -
            previous.c
        ),

        Math.abs(
            current.l -
            previous.c
        )
    );
}


function volatility(
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

        ranges.push(

            trueRange(
                candles[i],
                candles[i - 1]
            )
        );
    }


    return average(
        ranges.slice(
            -period
        )
    );
}


/* ==========================================================
   SWING DETECTION
========================================================== */

function detectSwings(
    candles,
    width = 2
) {

    const highs =
        [];

    const lows =
        [];


    for (
        let i = width;
        i <
        candles.length -
        width;
        i++
    ) {

        const current =
            candles[i];


        let isHigh =
            true;

        let isLow =
            true;


        for (
            let j =
                i - width;
            j <=
                i + width;
            j++
        ) {

            if (
                j === i
            ) {

                continue;
            }


            if (
                candles[j].h >=
                current.h
            ) {

                isHigh =
                    false;
            }


            if (
                candles[j].l <=
                current.l
            ) {

                isLow =
                    false;
            }
        }


        if (
            isHigh
        ) {

            highs.push({

                index:
                    i,

                price:
                    current.h,

                time:
                    current.t
            });
        }


        if (
            isLow
        ) {

            lows.push({

                index:
                    i,

                price:
                    current.l,

                time:
                    current.t
            });
        }
    }


    return {

        highs,

        lows
    };
}


/* ==========================================================
   MARKET STRUCTURE
========================================================== */

function getStructure(
    candles
) {

    const swings =
        detectSwings(
            candles,
            2
        );


    const highs =
        swings.highs.slice(
            -3
        );


    const lows =
        swings.lows.slice(
            -3
        );


    let bias =
        "NEUTRAL";


    let structure =
        "RANGE";


    if (
        highs.length >= 2 &&
        lows.length >= 2
    ) {

        const highUp =
            highs.at(-1).price >
            highs.at(-2).price;


        const lowUp =
            lows.at(-1).price >
            lows.at(-2).price;


        const highDown =
            highs.at(-1).price <
            highs.at(-2).price;


        const lowDown =
            lows.at(-1).price <
            lows.at(-2).price;


        if (
            highUp &&
            lowUp
        ) {

            bias =
                "BULLISH";

            structure =
                "HH / HL";
        }


        else if (
            highDown &&
            lowDown
        ) {

            bias =
                "BEARISH";

            structure =
                "LH / LL";
        }
    }


    return {

        bias,

        structure,

        swingHigh:
            highs.at(-1) ||
            null,

        previousSwingHigh:
            highs.at(-2) ||
            null,

        swingLow:
            lows.at(-1) ||
            null,

        previousSwingLow:
            lows.at(-2) ||
            null,

        highs,

        lows
    };
}


/* ==========================================================
   BOS / CHOCH
========================================================== */

function detectBreak(
    candles,
    structure
) {

    const last =
        candles.at(-1);


    if (!last) {

        return {

            type:
                "NONE",

            direction:
                "NONE"
        };
    }


    const previousHigh =
        structure
            .previousSwingHigh
            ?.price;


    const previousLow =
        structure
            .previousSwingLow
            ?.price;


    if (
        Number.isFinite(
            previousHigh
        ) &&
        last.c >
        previousHigh
    ) {

        return {

            type:
                structure.bias ===
                "BEARISH"

                ?

                "CHOCH"

                :

                "BOS",

            direction:
                "BULLISH"
        };
    }


    if (
        Number.isFinite(
            previousLow
        ) &&
        last.c <
        previousLow
    ) {

        return {

            type:
                structure.bias ===
                "BULLISH"

                ?

                "CHOCH"

                :

                "BOS",

            direction:
                "BEARISH"
        };
    }


    return {

        type:
            "NONE",

        direction:
            "NONE"
    };
}


/* ==========================================================
   LIQUIDITY SWEEP
========================================================== */

function detectLiquiditySweep(
    candles
) {

    if (
        candles.length <
        25
    ) {

        return {

            direction:
                "NONE"
        };
    }


    const last =
        candles.at(-1);


    const previous =
        candles.slice(
            -21,
            -1
        );


    const previousHigh =
        Math.max(
            ...previous.map(
                x => x.h
            )
        );


    const previousLow =
        Math.min(
            ...previous.map(
                x => x.l
            )
        );


    if (
        last.h >
        previousHigh &&
        last.c <
        previousHigh
    ) {

        return {

            direction:
                "BEARISH",

            level:
                previousHigh,

            sweptPrice:
                last.h
        };
    }


    if (
        last.l <
        previousLow &&
        last.c >
        previousLow
    ) {

        return {

            direction:
                "BULLISH",

            level:
                previousLow,

            sweptPrice:
                last.l
        };
    }


    return {

        direction:
            "NONE"
    };
}


/* ==========================================================
   FAIR VALUE GAP
========================================================== */

function findRecentFVG(
    candles
) {

    const search =
        candles.slice(
            -50
        );


    let latestBullish =
        null;

    let latestBearish =
        null;


    for (
        let i = 2;
        i < search.length;
        i++
    ) {

        const a =
            search[i - 2];

        const c =
            search[i];


        if (
            c.l >
            a.h
        ) {

            latestBullish = {

                direction:
                    "BULLISH",

                low:
                    a.h,

                high:
                    c.l,

                time:
                    c.t
            };
        }


        if (
            c.h <
            a.l
        ) {

            latestBearish = {

                direction:
                    "BEARISH",

                low:
                    c.h,

                high:
                    a.l,

                time:
                    c.t
            };
        }
    }


    return {

        bullish:
            latestBullish,

        bearish:
            latestBearish
    };
}


/* ==========================================================
   DISPLACEMENT
========================================================== */

function detectDisplacement(
    candles
) {

    if (
        candles.length <
        15
    ) {

        return {

            direction:
                "NONE",

            strength:
                0
        };
    }


    const recent =
        candles.slice(
            -15
        );


    const last =
        recent.at(-1);


    const body =
        Math.abs(
            last.c -
            last.o
        );


    const averageBody =
        average(

            recent
            .slice(
                0,
                -1
            )
            .map(
                x =>
                    Math.abs(
                        x.c -
                        x.o
                    )
            )
        );


    if (
        averageBody <= 0
    ) {

        return {

            direction:
                "NONE",

            strength:
                0
        };
    }


    const ratio =
        body /
        averageBody;


    if (
        ratio >= 1.6
    ) {

        return {

            direction:
                last.c >
                last.o

                ?

                "BULLISH"

                :

                "BEARISH",

            strength:
                round(
                    ratio,
                    2
                )
        };
    }


    return {

        direction:
            "NONE",

        strength:
            round(
                ratio,
                2
            )
    };
}


/* ==========================================================
   PREMIUM / DISCOUNT
========================================================== */

function getDealingRange(
    candles
) {

    const recent =
        candles.slice(
            -40
        );


    const high =
        Math.max(
            ...recent.map(
                x => x.h
            )
        );


    const low =
        Math.min(
            ...recent.map(
                x => x.l
            )
        );


    const midpoint =
        (
            high +
            low
        )
        /
        2;


    const close =
        candles.at(-1).c;


    return {

        high,

        low,

        midpoint,

        zone:
            close >
            midpoint

            ?

            "PREMIUM"

            :

            "DISCOUNT"
    };
}


/* ==========================================================
   TIMEFRAME ANALYSIS
========================================================== */

function analyseTimeframe(
    candles
) {

    const structure =
        getStructure(
            candles
        );


    const breakInfo =
        detectBreak(
            candles,
            structure
        );


    const sweep =
        detectLiquiditySweep(
            candles
        );


    const fvg =
        findRecentFVG(
            candles
        );


    const displacement =
        detectDisplacement(
            candles
        );


    const range =
        getDealingRange(
            candles
        );


    const vol =
        volatility(
            candles,
            14
        );


    let bullish =
        0;

    let bearish =
        0;


    if (
        structure.bias ===
        "BULLISH"
    ) {

        bullish +=
            35;
    }


    if (
        structure.bias ===
        "BEARISH"
    ) {

        bearish +=
            35;
    }


    if (
        breakInfo.direction ===
        "BULLISH"
    ) {

        bullish +=

            breakInfo.type ===
            "CHOCH"

            ?

            22

            :

            18;
    }


    if (
        breakInfo.direction ===
        "BEARISH"
    ) {

        bearish +=

            breakInfo.type ===
            "CHOCH"

            ?

            22

            :

            18;
    }


    if (
        sweep.direction ===
        "BULLISH"
    ) {

        bullish +=
            18;
    }


    if (
        sweep.direction ===
        "BEARISH"
    ) {

        bearish +=
            18;
    }


    if (
        displacement.direction ===
        "BULLISH"
    ) {

        bullish +=
            12;
    }


    if (
        displacement.direction ===
        "BEARISH"
    ) {

        bearish +=
            12;
    }


    if (
        range.zone ===
        "DISCOUNT"
    ) {

        bullish +=
            5;
    }


    if (
        range.zone ===
        "PREMIUM"
    ) {

        bearish +=
            5;
    }


    let bias =
        "NEUTRAL";


    if (
        bullish -
        bearish >=
        12
    ) {

        bias =
            "BULLISH";
    }


    if (
        bearish -
        bullish >=
        12
    ) {

        bias =
            "BEARISH";
    }


    const strength =
        Math.round(

            clamp(

                Math.max(
                    bullish,
                    bearish
                ),

                30,

                95
            )
        );


    return {

        bias,

        strength,

        bullishScore:
            bullish,

        bearishScore:
            bearish,

        structure,

        breakInfo,

        sweep,

        fvg,

        displacement,

        range,

        volatility:
            vol
    };
}


/* ==========================================================
   CREATE TRADE LEVELS
========================================================== */

function buildLevels(
    decision,
    currentPrice,
    m5Analysis
) {

    const vol =
        Math.max(

            m5Analysis
                .volatility,

            currentPrice *
            0.0003
        );


    const minimumRisk =
        vol *
        0.65;


    const maximumRisk =
        vol *
        1.5;


    if (
        decision ===
        "BUY"
    ) {

        let logicalStop =

            m5Analysis
                .structure
                .swingLow
                ?.price

            ??

            currentPrice -
            vol;


        if (
            m5Analysis
                .sweep
                .direction ===
            "BULLISH"
        ) {

            logicalStop =
                Math.min(

                    logicalStop,

                    m5Analysis
                        .sweep
                        .sweptPrice
                );
        }


        let risk =
            currentPrice -
            logicalStop;


        risk =
            clamp(

                risk,

                minimumRisk,

                maximumRisk
            );


        const stop =
            currentPrice -
            risk;


        return {

            entry:
                round(
                    currentPrice,
                    2
                ),

            stop_loss:
                round(
                    stop,
                    2
                ),

            take_profit_1:
                round(
                    currentPrice +
                    risk *
                    1.5,
                    2
                ),

            take_profit_2:
                round(
                    currentPrice +
                    risk *
                    2.0,
                    2
                ),

            risk_reward:
                1.5
        };
    }


    if (
        decision ===
        "SELL"
    ) {

        let logicalStop =

            m5Analysis
                .structure
                .swingHigh
                ?.price

            ??

            currentPrice +
            vol;


        if (
            m5Analysis
                .sweep
                .direction ===
            "BEARISH"
        ) {

            logicalStop =
                Math.max(

                    logicalStop,

                    m5Analysis
                        .sweep
                        .sweptPrice
                );
        }


        let risk =
            logicalStop -
            currentPrice;


        risk =
            clamp(

                risk,

                minimumRisk,

                maximumRisk
            );


        const stop =
            currentPrice +
            risk;


        return {

            entry:
                round(
                    currentPrice,
                    2
                ),

            stop_loss:
                round(
                    stop,
                    2
                ),

            take_profit_1:
                round(
                    currentPrice -
                    risk *
                    1.5,
                    2
                ),

            take_profit_2:
                round(
                    currentPrice -
                    risk *
                    2.0,
                    2
                ),

            risk_reward:
                1.5
        };
    }


    return {

        entry:
            null,

        stop_loss:
            null,

        take_profit_1:
            null,

        take_profit_2:
            null,

        risk_reward:
            null
    };
}


/* ==========================================================
   MASTER SIGNAL ENGINE
========================================================== */

function createAnalysis(
    symbol,
    currentPrice,
    m5,
    m15,
    h1
) {

    const M5 =
        analyseTimeframe(
            m5
        );


    const M15 =
        analyseTimeframe(
            m15
        );


    const H1 =
        analyseTimeframe(
            h1
        );


    let buyScore =
        0;


    let sellScore =
        0;


    /* ======================================================
       H1 STRUCTURE
    ====================================================== */

    if (
        H1.bias ===
        "BULLISH"
    ) {

        buyScore +=
            35;
    }


    if (
        H1.bias ===
        "BEARISH"
    ) {

        sellScore +=
            35;
    }


    /* ======================================================
       M15 CONFIRMATION
    ====================================================== */

    if (
        M15.bias ===
        "BULLISH"
    ) {

        buyScore +=
            25;
    }


    if (
        M15.bias ===
        "BEARISH"
    ) {

        sellScore +=
            25;
    }


    /* ======================================================
       M5 ENTRY
    ====================================================== */

    if (
        M5.bias ===
        "BULLISH"
    ) {

        buyScore +=
            15;
    }


    if (
        M5.bias ===
        "BEARISH"
    ) {

        sellScore +=
            15;
    }


    /* ======================================================
       M5 LIQUIDITY SWEEP
    ====================================================== */

    if (
        M5.sweep.direction ===
        "BULLISH"
    ) {

        buyScore +=
            10;
    }


    if (
        M5.sweep.direction ===
        "BEARISH"
    ) {

        sellScore +=
            10;
    }


    /* ======================================================
       M5 BOS / CHOCH
    ====================================================== */

    if (
        M5.breakInfo.direction ===
        "BULLISH"
    ) {

        buyScore +=

            M5.breakInfo.type ===
            "CHOCH"

            ?

            12

            :

            8;
    }


    if (
        M5.breakInfo.direction ===
        "BEARISH"
    ) {

        sellScore +=

            M5.breakInfo.type ===
            "CHOCH"

            ?

            12

            :

            8;
    }


    /* ======================================================
       DISPLACEMENT
    ====================================================== */

    if (
        M5.displacement.direction ===
        "BULLISH"
    ) {

        buyScore +=
            5;
    }


    if (
        M5.displacement.direction ===
        "BEARISH"
    ) {

        sellScore +=
            5;
    }


    /* ======================================================
       PREMIUM / DISCOUNT
    ====================================================== */

    if (
        M15.range.zone ===
        "DISCOUNT"
    ) {

        buyScore +=
            5;
    }


    if (
        M15.range.zone ===
        "PREMIUM"
    ) {

        sellScore +=
            5;
    }


    let decision =
        "WAIT";


    const difference =
        Math.abs(
            buyScore -
            sellScore
        );


    /* ======================================================
       STRICT ENTRY RULES
    ====================================================== */

    if (
        buyScore >= 70 &&
        difference >= 20 &&
        H1.bias ===
        "BULLISH" &&
        M15.bias !==
        "BEARISH"
    ) {

        decision =
            "BUY";
    }


    if (
        sellScore >= 70 &&
        difference >= 20 &&
        H1.bias ===
        "BEARISH" &&
        M15.bias !==
        "BULLISH"
    ) {

        decision =
            "SELL";
    }


    const winningScore =
        Math.max(
            buyScore,
            sellScore
        );


    const confidence =

        decision ===
        "WAIT"

        ?

        Math.round(
            clamp(

                45 +
                difference *
                0.3,

                45,
                69
            )
        )

        :

        Math.round(
            clamp(

                winningScore,

                70,
                92
            )
        );


    const levels =
        buildLevels(
            decision,
            currentPrice,
            M5
        );


    let setupGrade =
        "NO TRADE";


    if (
        decision !==
        "WAIT"
    ) {

        if (
            confidence >= 88
        ) {

            setupGrade =
                "A+";
        }

        else if (
            confidence >= 82
        ) {

            setupGrade =
                "A";
        }

        else {

            setupGrade =
                "B";
        }
    }


    const reasons =
        [];


    reasons.push(
        `H1: ${H1.bias} ${H1.strength}% | ${H1.structure.structure}.`
    );


    reasons.push(
        `M15: ${M15.bias} ${M15.strength}% | ${M15.structure.structure}.`
    );


    reasons.push(
        `M5: ${M5.bias} ${M5.strength}% | ${M5.structure.structure}.`
    );


    reasons.push(
        `M5 structure event: ${M5.breakInfo.type} ${M5.breakInfo.direction}.`
    );


    reasons.push(
        `M5 liquidity sweep: ${M5.sweep.direction}.`
    );


    reasons.push(
        `M5 displacement: ${M5.displacement.direction}.`
    );


    reasons.push(
        `M15 price location: ${M15.range.zone}.`
    );


    reasons.push(
        `Score: BUY ${buyScore} vs SELL ${sellScore}.`
    );


    const bullishFVG =
        M5.fvg.bullish;


    const bearishFVG =
        M5.fvg.bearish;


    let liquiditySummary =
        "No immediate liquidity sweep detected.";


    if (
        M5.sweep.direction !==
        "NONE"
    ) {

        liquiditySummary =
            `${M5.sweep.direction} liquidity sweep detected near ${round(M5.sweep.level, 2)}.`;
    }


    let fvgText =
        "No recent M5 imbalance.";


    if (
        decision ===
        "BUY" &&
        bullishFVG
    ) {

        fvgText =
            `Bullish FVG ${round(bullishFVG.low, 2)} - ${round(bullishFVG.high, 2)}.`;
    }


    if (
        decision ===
        "SELL" &&
        bearishFVG
    ) {

        fvgText =
            `Bearish FVG ${round(bearishFVG.low, 2)} - ${round(bearishFVG.high, 2)}.`;
    }


    return {

        decision,

        confidence,

        setup_grade:
            setupGrade,


        summary:

            decision ===
            "WAIT"

            ?

            `${symbol} has no high-quality entry yet. Waiting for stronger smart-money confirmation.`

            :

            `${decision} setup detected with higher-timeframe structure and M5 confirmation.`,


        market_regime:

            H1.bias ===
            "BULLISH"

            ?

            "BULLISH STRUCTURE"

            :

            H1.bias ===
            "BEARISH"

            ?

            "BEARISH STRUCTURE"

            :

            "RANGING / UNCLEAR",


        structure_summary:

            `H1 ${H1.structure.structure} | M15 ${M15.structure.structure} | M5 ${M5.structure.structure}. ${fvgText}`,


        liquidity_summary:
            liquiditySummary,


        macro_bias:
            "UNKNOWN",


        macro_summary:

            "Macro/news confirmation is not included in this free technical engine.",


        entry:
            levels.entry,


        stop_loss:
            levels.stop_loss,


        take_profit_1:
            levels.take_profit_1,


        take_profit_2:
            levels.take_profit_2,


        risk_reward:
            levels.risk_reward,


        invalidation:

            decision ===
            "BUY"

            ?

            `Bullish setup invalid below ${levels.stop_loss}.`

            :

            decision ===
            "SELL"

            ?

            `Bearish setup invalid above ${levels.stop_loss}.`

            :

            "Wait for H1/M15 alignment plus M5 BOS, CHOCH or liquidity confirmation.",


        next_trigger:

            decision ===
            "WAIT"

            ?

            "Wait for liquidity sweep + structure confirmation on M5."

            :

            `Monitor M5 for failure of the ${decision} structure.`,


        timeframes: {

            m5: {

                bias:
                    M5.bias,

                strength:
                    M5.strength
            },


            m15: {

                bias:
                    M15.bias,

                strength:
                    M15.strength
            },


            h1: {

                bias:
                    H1.bias,

                strength:
                    H1.strength
            }
        },


        reasons,


        risks: [

            "Structure can change quickly after high-impact economic news.",

            "Liquidity sweeps can become genuine breakouts.",

            "Spread and slippage may change actual entry and exit prices.",

            "WAIT is intentional when the timeframes do not align."

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


        const m5 =
            completedCandles(
                m5Raw
            );


        const m15 =
            resample(
                m5,
                15,
                3
            );


        const h1 =
            resample(
                m5,
                60,
                12
            );


        if (
            m15.length < 40 ||
            h1.length < 30
        ) {

            throw new Error(
                "Not enough completed candles for multi-timeframe analysis."
            );
        }


        const analysis =
            createAnalysis(

                symbol,

                currentPrice,

                m5,

                m15,

                h1
            );


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
                    "MKAYFX-SMC-V3",


                reasoning_effort:
                    "market-structure",


                analysis,


                guardrail_note:

                    cacheHit

                    ?

                    "Smart-money V3: cached market data used. 0 new Twelve Data credits."

                    :

                    "Smart-money V3: 1 Twelve Data request used. M15 and H1 were generated locally.",


                chart:
                    m5Raw.slice(
                        -60
                    ),


                data_mode:
                    "1-credit M5 + locally generated M15/H1",


                cache_hit:
                    cacheHit,


                timestamp:
                    new Date()
                    .toISOString()

            }
        );
    }


    catch (
        error
    ) {

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