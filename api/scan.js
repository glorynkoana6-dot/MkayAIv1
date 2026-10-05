/* =========================================================
   MKAYFX XAU PUSHOVER BACKGROUND SCANNER
   /api/scan.js
========================================================= */

export default async function handler(req, res) {

  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );


  /* =====================================================
     CHECK CRON SECRET
  ===================================================== */

  const secret =
    process.env.CRON_SECRET;


  if (secret) {

    const auth =
      req.headers.authorization;


    if (
      auth !==
      `Bearer ${secret}`
    ) {

      return res.status(401).json({

        ok: false,

        error: "Unauthorized"

      });

    }

  }


  /* =====================================================
     ENVIRONMENT VARIABLES
  ===================================================== */

  const userKey =
    process.env.PUSHOVER_USER_KEY;


  const appToken =
    process.env.PUSHOVER_APP_TOKEN;


  if (
    !userKey ||
    !appToken
  ) {

    return res.status(500).json({

      ok: false,

      error:
        "Missing Pushover environment variables"

    });

  }


  try {

    /* =====================================================
       GET CURRENT DOMAIN
    ===================================================== */

    const protocol =
      req.headers["x-forwarded-proto"]
      ||
      "https";


    const host =
      req.headers.host;


    const baseUrl =
      `${protocol}://${host}`;


    /* =====================================================
       CALL YOUR XAU ENGINE
    ===================================================== */

    const response =
      await fetch(

        `${baseUrl}/api/xau?balance=200`,

        {

          headers: {

            "Cache-Control":
              "no-cache"

          }

        }

      );


    const data =
      await response.json();


    if (
      !response.ok ||
      !data.ok
    ) {

      throw new Error(

        data?.error
        ||
        "XAU analysis failed"

      );

    }


    const live =
      data.liveSignal;


    if (!live) {

      throw new Error(
        "No liveSignal returned"
      );

    }


    /* =====================================================
       WAIT = NO NOTIFICATION
    ===================================================== */

    if (
      live.signal !== "BUY" &&
      live.signal !== "SELL"
    ) {

      return res.status(200).json({

        ok: true,

        sent: false,

        signal:
          "WAIT",

        buyScore:
          live.buyScore,

        sellScore:
          live.sellScore,

        blockedBy:
          live.blockedBy || []

      });

    }


    /* =====================================================
       BUILD PUSHOVER MESSAGE
    ===================================================== */

    const buy =
      live.signal ===
      "BUY";


    const emoji =
      buy
        ? "🟢"
        : "🔴";


    const title =
      `${emoji} MKAYFX GOLD — ${live.signal}`;


    const message = [

      `XAU/USD ${live.signal}`,

      ``,

      `Score: ${live.score}/100`,

      `Entry: ${price(live.entry)}`,

      `SL: ${price(live.stopLoss)}`,

      `TP1: ${price(live.tp1)} (1.5R / 50%)`,

      `TP2: ${price(live.tp2)} (2.7R / 50%)`,

      ``,

      `M5: ${live.confirmation?.m5 || "-"}`,

      `M15: ${live.confirmation?.m15 || "-"}`,

      `H1: ${live.confirmation?.h1 || "-"}`,

      ``,

      `Risk: ${live.account?.riskPct || 7}%`,

      `Max Risk: R${live.account?.maxRiskZar || 14}`,

      live.liquidityTarget?.name
        ?
        `Target: ${live.liquidityTarget.name}`
        :
        "",

      ``,

      `Signal ID: ${live.signalId}`

    ]

      .filter(Boolean)

      .join("\n");


    /* =====================================================
       SEND PUSHOVER
    ===================================================== */

    const pushResponse =
      await fetch(

        "https://api.pushover.net/1/messages.json",

        {

          method:
            "POST",

          headers: {

            "Content-Type":
              "application/json"

          },

          body:
            JSON.stringify({

              token:
                appToken,

              user:
                userKey,

              title,

              message,

              priority:
                1,

              sound:
                "cashregister"

            })

        }

      );


    const push =
      await pushResponse.json();


    if (
      !pushResponse.ok ||
      push.status !== 1
    ) {

      throw new Error(

        push?.errors?.join(", ")
        ||
        "Pushover failed"

      );

    }


    /* =====================================================
       SUCCESS
    ===================================================== */

    return res.status(200).json({

      ok: true,

      sent: true,

      signal:
        live.signal,

      signalId:
        live.signalId,

      score:
        live.score,

      entry:
        live.entry,

      stopLoss:
        live.stopLoss,

      tp1:
        live.tp1,

      tp2:
        live.tp2,

      pushoverRequest:
        push.request

    });


  } catch (error) {

    console.error(
      "MKAYFX background scan:",
      error
    );


    return res.status(500).json({

      ok: false,

      sent: false,

      error:
        error?.message
        ||
        "Unknown error"

    });

  }

}


/* =========================================================
   PRICE FORMATTER
========================================================= */

function price(value) {

  const n =
    Number(value);


  if (
    !Number.isFinite(n)
  ) {

    return "-";

  }


  return n.toFixed(3);

}