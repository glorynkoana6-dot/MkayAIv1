/* ==========================================================
   MKAYFX AI - LIVE MARKET INTELLIGENCE ENGINE

   AI:
   GPT-5.6 SOL

   REASONING:
   MAX

   DATA:
   Twelve Data

   TIMEFRAMES:
   M5
   M15
   H1
========================================================== */


const OPENAI_URL =
    "https://api.openai.com/v1/responses";

const TWELVE_URL =
    "https://api.twelvedata.com/time_series";


/* ==========================================================
   CONFIG
========================================================== */

const MODEL =
    process.env.OPENAI_MODEL ||
    "gpt-5.6-sol";

const REASONING_EFFORT =
    process.env.OPENAI_REASONING_EFFORT ||
    "max";

const MIN_CONFIDENCE = 75;

const MIN_RR = 1.8;

const REQUIRE_H1_ALIGNMENT = true;


/* ==========================================================
   HTTP RESPONSE
========================================================== */

function send(
    res,
    status,
    data
) {

    res.status(status)
        .json(data);
}


/* ==========================================================
   FETCH TWELVE DATA
========================================================== */

async function fetchTimeframe(
    symbol,
    interval,
    outputsize = 120
) {

    const key =
        process.env.TWELVE_DATA_API_KEY;

    if (!key) {
        throw new Error(
            "TWELVE_DATA_API_KEY is missing."
        );
    }

    const params =
        new URLSearchParams({
            symbol,
            interval,
            outputsize:
                String(outputsize),
            format: "JSON",
            apikey: key
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
            `Twelve Data ${interval} failed.`
        );
    }


    /*
      Twelve Data returns newest first.

      Reverse:
      oldest -> newest
    */

    return data.values
        .map(x => ({
            t: x.datetime,
            o: Number(x.open),
            h: Number(x.high),
            l: Number(x.low),
            c: Number(x.close),
            v: Number(x.volume || 0)
        }))
        .reverse();
}


/* ==========================================================
   REMOVE CURRENT FORMING CANDLE
========================================================== */

function completedCandles(
    candles
) {

    if (candles.length < 3) {
        return candles;
    }

    return candles.slice(
        0,
        -1
    );
}


/* ==========================================================
   REDUCE TOKEN USE
========================================================== */

function compactCandles(
    candles,
    amount = 80
) {

    return candles
        .slice(-amount)
        .map(x => [
            x.t,
            x.o,
            x.h,
            x.l,
            x.c,
            x.v
        ]);
}


/* ==========================================================
   STRUCTURED OUTPUT SCHEMA
========================================================== */

const schema = {

    type: "object",

    additionalProperties: false,

    properties: {

        decision: {
            type: "string",
            enum: [
                "BUY",
                "SELL",
                "WAIT"
            ]
        },

        confidence: {
            type: "number",
            minimum: 0,
            maximum: 100
        },

        setup_grade: {
            type: "string",
            enum: [
                "A+",
                "A",
                "B",
                "C",
                "NO TRADE"
            ]
        },

        summary: {
            type: "string"
        },

        market_regime: {
            type: "string"
        },

        structure_summary: {
            type: "string"
        },

        liquidity_summary: {
            type: "string"
        },

        macro_bias: {
            type: "string",
            enum: [
                "BULLISH",
                "BEARISH",
                "NEUTRAL",
                "UNKNOWN"
            ]
        },

        macro_summary: {
            type: "string"
        },

        entry: {
            type: [
                "number",
                "null"
            ]
        },

        stop_loss: {
            type: [
                "number",
                "null"
            ]
        },

        take_profit_1: {
            type: [
                "number",
                "null"
            ]
        },

        take_profit_2: {
            type: [
                "number",
                "null"
            ]
        },

        risk_reward: {
            type: [
                "number",
                "null"
            ]
        },

        invalidation: {
            type: "string"
        },

        next_trigger: {
            type: "string"
        },

        timeframes: {

            type: "object",

            additionalProperties: false,

            properties: {

                m5: {
                    type: "object",

                    additionalProperties:
                        false,

                    properties: {

                        bias: {
                            type: "string",
                            enum: [
                                "BULLISH",
                                "BEARISH",
                                "NEUTRAL"
                            ]
                        },

                        strength: {
                            type: "number",
                            minimum: 0,
                            maximum: 100
                        }
                    },

                    required: [
                        "bias",
                        "strength"
                    ]
                },

                m15: {
                    type: "object",

                    additionalProperties:
                        false,

                    properties: {

                        bias: {
                            type: "string",
                            enum: [
                                "BULLISH",
                                "BEARISH",
                                "NEUTRAL"
                            ]
                        },

                        strength: {
                            type: "number",
                            minimum: 0,
                            maximum: 100
                        }
                    },

                    required: [
                        "bias",
                        "strength"
                    ]
                },

                h1: {
                    type: "object",

                    additionalProperties:
                        false,

                    properties: {

                        bias: {
                            type: "string",
                            enum: [
                                "BULLISH",
                                "BEARISH",
                                "NEUTRAL"
                            ]
                        },

                        strength: {
                            type: "number",
                            minimum: 0,
                            maximum: 100
                        }
                    },

                    required: [
                        "bias",
                        "strength"
                    ]
                }

            },

            required: [
                "m5",
                "m15",
                "h1"
            ]
        },

        reasons: {

            type: "array",

            items: {
                type: "string"
            },

            minItems: 3,

            maxItems: 8
        },

        risks: {

            type: "array",

            items: {
                type: "string"
            },

            minItems: 1,

            maxItems: 6
        }

    },

    required: [

        "decision",
        "confidence",
        "setup_grade",
        "summary",

        "market_regime",
        "structure_summary",
        "liquidity_summary",

        "macro_bias",
        "macro_summary",

        "entry",
        "stop_loss",
        "take_profit_1",
        "take_profit_2",

        "risk_reward",

        "invalidation",
        "next_trigger",

        "timeframes",

        "reasons",
        "risks"
    ]
};


/* ==========================================================
   SYSTEM INSTRUCTIONS
========================================================== */

const instructions = `

You are MKAYFX AI.

You are an institutional-style market analysis engine.

Your job is NOT to produce as many trades as possible.

Your job is to reject weak setups and identify only higher-quality
opportunities.

You receive raw OHLCV candles from:

M5
M15
H1

The current forming candle is not included in your historical analysis.

Perform the technical analysis yourself.

Do NOT rely on conventional indicator signals unless useful.

Analyse:

1. Higher timeframe trend
2. Market structure
3. BOS
4. CHOCH
5. Swing highs
6. Swing lows
7. Liquidity pools
8. Equal highs
9. Equal lows
10. Liquidity sweeps
11. Stop hunts
12. Displacement
13. Fair value gaps
14. Imbalances
15. Premium / discount
16. Support / resistance
17. Supply / demand
18. Breakouts
19. Failed breakouts
20. Momentum
21. Volatility
22. Candle behaviour
23. Multi-timeframe alignment
24. Risk-to-reward quality
25. Whether the market is trending, ranging or unstable

Be skeptical.

A WAIT result is a successful result when conditions are unclear.

Never force BUY or SELL.

BUY rules:

- Prefer H1 bullish alignment.
- Require a clear logical invalidation.
- Entry must be above stop loss.
- TP must be above entry.
- Avoid buying directly into obvious resistance.
- Prefer confirmation from M15 and M5.

SELL rules:

- Prefer H1 bearish alignment.
- Require a clear logical invalidation.
- Entry must be below stop loss.
- TP must be below entry.
- Avoid selling directly into obvious support.
- Prefer confirmation from M15 and M5.

Use realistic price levels.

Do not invent certainty.

Confidence guidance:

90-100:
Exceptional multi-timeframe setup.

80-89:
Strong setup.

75-79:
Tradeable but not exceptional.

Below 75:
Usually WAIT.

Only use A+ for rare setups.

For weak or conflicting conditions:
decision = WAIT.

For WAIT:
entry = null
stop_loss = null
take_profit_1 = null
take_profit_2 = null
risk_reward = null

Think deeply before producing the final structured result.

Do not output anything outside the requested JSON schema.

`;


/* ==========================================================
   EXTRACT TEXT FROM RESPONSES API
========================================================== */

function extractOutputText(
    response
) {

    if (typeof response.output_text === "string") {
        return response.output_text;
    }

    if (!Array.isArray(response.output)) {
        return null;
    }

    for (const item of response.output) {

        if (!Array.isArray(item.content)) {
            continue;
        }

        for (const content of item.content) {

            if (
                content.type === "output_text" &&
                typeof content.text === "string"
            ) {

                return content.text;
            }
        }
    }

    return null;
}


/* ==========================================================
   CALL GPT
========================================================== */

async function askAI(
    symbol,
    currentPrice,
    m5,
    m15,
    h1
) {

    const apiKey =
        process.env.OPENAI_API_KEY;

    if (!apiKey) {

        throw new Error(
            "OPENAI_API_KEY is missing."
        );
    }


    const payload = {

        model: MODEL,

        reasoning: {
            effort:
                REASONING_EFFORT
        },

        instructions,

        input: `

MARKET:
${symbol}

CURRENT LIVE PRICE:
${currentPrice}

SERVER TIME UTC:
${new Date().toISOString()}

IMPORTANT:

Each candle array is:

[
 timestamp,
 open,
 high,
 low,
 close,
 volume
]

==============================
M5 COMPLETED CANDLES
==============================

${JSON.stringify(
    compactCandles(m5, 90)
)}

==============================
M15 COMPLETED CANDLES
==============================

${JSON.stringify(
    compactCandles(m15, 80)
)}

==============================
H1 COMPLETED CANDLES
==============================

${JSON.stringify(
    compactCandles(h1, 70)
)}

Analyse the market carefully.

Do not assume there must be a trade.

Return WAIT when quality is insufficient.

`,

        text: {

            format: {

                type: "json_schema",

                name:
                    "market_analysis",

                strict: true,

                schema

            }

        }

    };


    /*
      Optional macro web intelligence.

      Set ENABLE_WEB_SEARCH=true in Vercel
      if you want the AI to use current web information.
    */

    if (
        process.env.ENABLE_WEB_SEARCH ===
        "true"
    ) {

        payload.tools = [
            {
                type:
                    "web_search"
            }
        ];
    }


    const response =
        await fetch(
            OPENAI_URL,
            {

                method:
                    "POST",

                headers: {

                    "Authorization":
                        `Bearer ${apiKey}`,

                    "Content-Type":
                        "application/json"

                },

                body:
                    JSON.stringify(
                        payload
                    )

            }
        );


    const data =
        await response.json();


    if (!response.ok) {

        console.error(
            JSON.stringify(
                data,
                null,
                2
            )
        );

        throw new Error(
            data?.error?.message ||
            "OpenAI request failed."
        );
    }


    const text =
        extractOutputText(
            data
        );


    if (!text) {

        throw new Error(
            "AI returned no structured response."
        );
    }


    return JSON.parse(
        text
    );
}


/* ==========================================================
   RISK GUARDRAILS
========================================================== */

function applyGuardrails(
    analysis,
    currentPrice
) {

    let note =
        "AI signal passed quality filters.";


    /*
      Already WAIT
    */

    if (
        analysis.decision ===
        "WAIT"
    ) {

        analysis.setup_grade =
            "NO TRADE";

        return {
            analysis,
            note:
                "AI rejected the setup. Waiting for better conditions."
        };
    }


    /*
      Confidence filter
    */

    if (
        Number(
            analysis.confidence
        ) < MIN_CONFIDENCE
    ) {

        analysis.decision =
            "WAIT";

        analysis.setup_grade =
            "NO TRADE";

        return {

            analysis,

            note:
                `Blocked: AI confidence below ${MIN_CONFIDENCE}%.`
        };
    }


    const entry =
        Number(
            analysis.entry
        );

    const sl =
        Number(
            analysis.stop_loss
        );

    const tp1 =
        Number(
            analysis.take_profit_1
        );


    if (
        !Number.isFinite(entry) ||
        !Number.isFinite(sl) ||
        !Number.isFinite(tp1)
    ) {

        analysis.decision =
            "WAIT";

        analysis.setup_grade =
            "NO TRADE";

        return {

            analysis,

            note:
                "Blocked: AI produced incomplete trade levels."
        };
    }


    let risk;
    let reward;


    /*
      BUY validation
    */

    if (
        analysis.decision ===
        "BUY"
    ) {

        if (
            sl >= entry ||
            tp1 <= entry
        ) {

            analysis.decision =
                "WAIT";

            analysis.setup_grade =
                "NO TRADE";

            return {

                analysis,

                note:
                    "Blocked: invalid BUY price structure."
            };
        }

        risk =
            entry - sl;

        reward =
            tp1 - entry;


        if (
            REQUIRE_H1_ALIGNMENT &&
            analysis.timeframes.h1.bias !==
            "BULLISH"
        ) {

            analysis.decision =
                "WAIT";

            analysis.setup_grade =
                "NO TRADE";

            return {

                analysis,

                note:
                    "Blocked: BUY was not aligned with H1 AI bias."
            };
        }
    }


    /*
      SELL validation
    */

    if (
        analysis.decision ===
        "SELL"
    ) {

        if (
            sl <= entry ||
            tp1 >= entry
        ) {

            analysis.decision =
                "WAIT";

            analysis.setup_grade =
                "NO TRADE";

            return {

                analysis,

                note:
                    "Blocked: invalid SELL price structure."
            };
        }

        risk =
            sl - entry;

        reward =
            entry - tp1;


        if (
            REQUIRE_H1_ALIGNMENT &&
            analysis.timeframes.h1.bias !==
            "BEARISH"
        ) {

            analysis.decision =
                "WAIT";

            analysis.setup_grade =
                "NO TRADE";

            return {

                analysis,

                note:
                    "Blocked: SELL was not aligned with H1 AI bias."
            };
        }
    }


    /*
      Risk / reward
    */

    const calculatedRR =
        reward / risk;


    analysis.risk_reward =
        Number(
            calculatedRR.toFixed(2)
        );


    if (
        calculatedRR <
        MIN_RR
    ) {

        analysis.decision =
            "WAIT";

        analysis.setup_grade =
            "NO TRADE";

        return {

            analysis,

            note:
                `Blocked: risk/reward ${calculatedRR.toFixed(2)} is below required ${MIN_RR}.`
        };
    }


    /*
      Prevent ridiculous stale entries.

      Entry must be reasonably near live price.
    */

    const distance =
        Math.abs(
            entry -
            currentPrice
        ) /
        currentPrice;


    if (
        distance >
        0.006
    ) {

        analysis.decision =
            "WAIT";

        analysis.setup_grade =
            "NO TRADE";

        return {

            analysis,

            note:
                "Blocked: suggested entry is too far from the live market price."
        };
    }


    return {
        analysis,
        note
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


        /*
          Fetch market data simultaneously
        */

        const [
            m5Raw,
            m15Raw,
            h1Raw
        ] =
        await Promise.all([

            fetchTimeframe(
                symbol,
                "5min",
                120
            ),

            fetchTimeframe(
                symbol,
                "15min",
                120
            ),

            fetchTimeframe(
                symbol,
                "1h",
                120
            )

        ]);


        /*
          Current price comes from latest
          available M5 candle.
        */

        const currentPrice =
            m5Raw[
                m5Raw.length - 1
            ].c;


        /*
          Remove forming candles before
          sending history to AI.
        */

        const m5 =
            completedCandles(
                m5Raw
            );

        const m15 =
            completedCandles(
                m15Raw
            );

        const h1 =
            completedCandles(
                h1Raw
            );


        /*
          AI THINKING
        */

        let analysis =
            await askAI(
                symbol,
                currentPrice,
                m5,
                m15,
                h1
            );


        /*
          Strict validation
        */

        const guarded =
            applyGuardrails(
                analysis,
                currentPrice
            );


        analysis =
            guarded.analysis;


        /*
          Return data to dashboard
        */

        return send(
            res,
            200,
            {

                success: true,

                symbol,

                current_price:
                    currentPrice,

                model:
                    MODEL,

                reasoning_effort:
                    REASONING_EFFORT,

                analysis,

                guardrail_note:
                    guarded.note,

                chart:
                    m5Raw
                    .slice(-60),

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
                    error.message ||
                    "Unknown server error."

            }
        );
    }
}