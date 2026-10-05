/* =========================================================
   MKAYFX SWEEP STRATEGY FRONTEND
========================================================= */


const API =
  "/api/strategy";


const REFRESH_MS =
  60_000;


let loading =
  false;


let latestPayload =
  null;


/* =========================================================
   ELEMENTS
========================================================= */


const $ =
  id =>
    document.getElementById(
      id
    );


const els = {

  refreshBtn:
    $("refreshBtn"),

  statusDot:
    $("statusDot"),

  statusText:
    $("statusText"),

  lastUpdated:
    $("lastUpdated"),

  error:
    $("error"),

  price:
    $("price"),

  dataAge:
    $("dataAge"),

  signal:
    $("signal"),

  stateName:
    $("stateName"),

  confidence:
    $("confidence"),

  confidenceBar:
    $("confidenceBar"),

  thesis:
    $("thesis"),

  notifyBtn:
    $("notifyBtn"),

  focusPool:
    $("focusPool"),

  focusScore:
    $("focusScore"),

  poolLevel:
    $("poolLevel"),

  raidStyle:
    $("raidStyle"),

  likelyEnd:
    $("likelyEnd"),

  sweepZone:
    $("sweepZone"),

  entry:
    $("entry"),

  stop:
    $("stop"),

  tp1:
    $("tp1"),

  tp1Name:
    $("tp1Name"),

  tp2:
    $("tp2"),

  tp2Name:
    $("tp2Name"),

  rr:
    $("rr"),

  riskPoints:
    $("riskPoints"),

  confirmCount:
    $("confirmCount"),

  checklist:
    $("checklist"),

  footprint:
    $("footprint"),

  poolList:
    $("poolList"),

  sessions:
    $("sessions")

};


/* =========================================================
   START
========================================================= */


els.refreshBtn
  .addEventListener(
    "click",
    load
  );


els.notifyBtn
  .addEventListener(
    "click",
    enableNotifications
  );


load();


setInterval(
  load,
  REFRESH_MS
);


/* =========================================================
   LOAD
========================================================= */


async function load() {

  if (
    loading
  ) {

    return;

  }


  loading =
    true;


  setStatus(
    "loading"
  );


  els.refreshBtn.textContent =
    "…";


  try {

    const response =
      await fetch(

        `${API}?t=${Date.now()}`,

        {

          cache:
            "no-store"

        }

      );


    const data =
      await response.json();


    if (
      !response.ok

      ||

      !data?.ok

    ) {

      throw new Error(

        data?.error
        ||
        `HTTP ${response.status}`

      );

    }


    latestPayload =
      data;


    render(
      data
    );


    setStatus(
      "live"
    );


    hideError();


    maybeNotify(
      data
    );


  } catch (
    error
  ) {

    console.error(
      error
    );


    setStatus(
      "error"
    );


    showError(
      error?.message
      ||
      "Unable to load strategy."
    );

  }


  loading =
    false;


  els.refreshBtn.textContent =
    "↻";

}


/* =========================================================
   RENDER
========================================================= */


function render(
  data
) {

  const strategy =
    data.strategy
    ||
    {};


  const intel =
    data.intelligence
    ||
    {};


  renderHero(
    strategy,
    intel
  );


  renderTradePlan(
    strategy
  );


  renderConfirmations(
    strategy
  );


  renderFootprint(
    intel.footprint
    ||
    {}
  );


  renderPools(
    intel.liquidityPools
    ||
    []
  );


  renderSessions(
    intel.sessions
    ||
    []
  );


  els.lastUpdated.textContent =
    formatClock(
      data.generatedAt
    );

}


/* =========================================================
   HERO
========================================================= */


function renderHero(
  strategy,
  intel
) {

  els.price.textContent =
    price(
      intel.price
    );


  els.dataAge.textContent =

    Number.isFinite(
      Number(
        intel.dataAgeSeconds
      )
    )

      ?

      `Market data age: ${intel.dataAgeSeconds}s`

      :

      "Market feed connected";


  const signal =
    strategy.signal
    ||
    "WAIT";


  els.signal.textContent =
    signal;


  els.signal.className =
    "signal " +
    signal.toLowerCase();


  els.stateName.textContent =
    strategy.stateLabel
    ||
    strategy.state
    ||
    "WAIT";


  const confidence =
    Number(
      strategy.confidence
      ||
      0
    );


  els.confidence.textContent =
    `${Math.round(confidence)}%`;


  els.confidenceBar.style.width =
    `${Math.max(0,Math.min(100,confidence))}%`;


  els.thesis.textContent =
    strategy.thesis
    ||
    "Waiting for strategy analysis.";

}


/* =========================================================
   TRADE PLAN
========================================================= */


function renderTradePlan(
  strategy
) {

  const focus =
    strategy.focusPool;


  const sweep =
    strategy.sweep;


  const trade =
    strategy.trade;


  if (
    !focus

    ||

    !sweep

    ||

    !trade
  ) {

    resetTradePlan();

    return;

  }


  els.focusPool.textContent =
    focus.name
    ||
    "—";


  els.focusScore.textContent =

    `${fmt(focus.likelihoodScore,0)} score · ` +

    `${focus.likelihood || "—"}`;


  els.poolLevel.textContent =
    price(
      focus.level
    );


  els.raidStyle.textContent =
    focus.raidStyle
    ||
    "—";


  els.likelyEnd.textContent =
    price(
      sweep.likelyEnd
    );


  els.sweepZone.textContent =

    `${price(sweep.zoneLow)} – ` +

    `${price(sweep.zoneHigh)}`;


  els.entry.textContent =
    price(
      trade.plannedEntry
    );


  els.stop.textContent =
    price(
      trade.stopLoss
    );


  els.tp1.textContent =
    price(
      trade.tp1
    );


  els.tp1Name.textContent =
    trade.tp1Name
    ||
    "Target 1";


  els.tp2.textContent =
    price(
      trade.tp2
    );


  els.tp2Name.textContent =
    trade.tp2Name
    ||
    "Target 2";


  els.rr.textContent =

    `${fmt(trade.rr1,2)}R / ` +

    `${fmt(trade.rr2,2)}R`;


  els.riskPoints.textContent =

    `${fmt(trade.riskPoints,3)} points risk`;

}


/* =========================================================
   RESET PLAN
========================================================= */


function resetTradePlan() {

  [

    "focusPool",
    "focusScore",
    "poolLevel",
    "raidStyle",
    "likelyEnd",
    "sweepZone",
    "entry",
    "stop",
    "tp1",
    "tp1Name",
    "tp2",
    "tp2Name",
    "rr",
    "riskPoints"

  ]
    .forEach(
      key => {

        els[key].textContent =
          "—";

      }
    );

}


/* =========================================================
   CONFIRMATIONS
========================================================= */


function renderConfirmations(
  strategy
) {

  const confirmations =
    strategy.confirmations
    ||
    [];


  els.confirmCount.textContent =

    `${strategy.confirmationCount || 0} reversal confirmations`;


  if (
    !confirmations.length
  ) {

    els.checklist.innerHTML =

      `<div class="check">
        <div class="check-icon">–</div>
        <div>
          <div class="check-title">
            Waiting for setup
          </div>
        </div>
      </div>`;

    return;

  }


  els.checklist.innerHTML =
    confirmations

      .map(
        item => {

          const pass =
            Boolean(
              item.pass
            );


          return `

            <div
              class="check ${pass ? "pass" : ""}"
            >

              <div class="check-icon">
                ${pass ? "✓" : "×"}
              </div>

              <div>

                <div class="check-title">
                  ${escapeHtml(item.label)}
                </div>

                <div class="check-detail">
                  ${escapeHtml(item.detail || "—")}
                </div>

              </div>

            </div>

          `;

        }
      )

      .join(
        ""
      );

}


/* =========================================================
   FOOTPRINT
========================================================= */


function renderFootprint(
  footprint
) {

  const rows = [

    [
      "5M delta",
      footprint.last5?.deltaPct
    ],

    [
      "15M delta",
      footprint.last15?.deltaPct
    ],

    [
      "30M delta",
      footprint.last30?.deltaPct
    ],

    [
      "60M delta",
      footprint.last60?.deltaPct
    ]

  ];


  let html =
    rows

      .map(
        row => {

          const value =
            Number(
              row[1]
              ||
              0
            );


          const cls =

            value > 0

              ?

              "pos"

              :

              value < 0

                ?

                "neg"

                :

                "";


          return `

            <div class="foot-item">

              <div class="label">
                ${row[0]}
              </div>

              <div class="delta ${cls}">
                ${signed(value)}%
              </div>

            </div>

          `;

        }
      )

      .join(
        ""
      );


  html += `

    <div class="foot-item">

      <div class="label">
        Delta divergence
      </div>

      <div
        class="metric-value"
        style="font-size:14px"
      >
        ${escapeHtml(footprint.divergence || "NONE")}
      </div>

    </div>


    <div class="foot-item">

      <div class="label">
        Absorption
      </div>

      <div
        class="metric-value"
        style="font-size:14px"
      >
        ${escapeHtml(footprint.absorption || "NONE")}
      </div>

    </div>


    <div class="foot-item">

      <div class="label">
        CVD proxy
      </div>

      <div class="metric-value">
        ${fmt(footprint.cvd,1)}
      </div>

    </div>


    <div class="foot-item">

      <div class="label">
        Volume source
      </div>

      <div
        class="metric-value"
        style="font-size:12px"
      >
        ${
          escapeHtml(
            footprint.mode
            ||
            "synthetic proxy"
          )
        }
      </div>

    </div>

  `;


  els.footprint.innerHTML =
    html;

}


/* =========================================================
   LIQUIDITY POOLS
========================================================= */


function renderPools(
  pools
) {

  const rows =
    pools.slice(
      0,
      8
    );


  if (
    !rows.length
  ) {

    els.poolList.innerHTML =

      `<div class="card pool">
        No liquidity pools.
      </div>`;

    return;

  }


  els.poolList.innerHTML =
    rows

      .map(
        pool => {

          const projected =
            pool.projectedSweep
            ||
            {};


          const footprint =
            pool.nearLevelFootprint
            ||
            {};


          return `

            <article class="card pool">

              <div class="pool-top">

                <div>

                  <div class="pool-name">
                    ${escapeHtml(pool.name)}
                  </div>

                  <div class="pool-type">
                    ${escapeHtml(pool.type)}
                  </div>

                </div>


                <div class="pool-score">

                  ${fmt(pool.likelihoodScore,0)}

                </div>

              </div>


              <div class="pool-grid">


                <div>

                  <div class="pool-key">
                    Level
                  </div>

                  <div class="pool-value">
                    ${price(pool.level)}
                  </div>

                </div>


                <div>

                  <div class="pool-key">
                    Distance
                  </div>

                  <div class="pool-value">
                    ${fmt(pool.distance,3)}
                  </div>

                </div>


                <div>

                  <div class="pool-key">
                    Likely raid end
                  </div>

                  <div class="pool-value gold">
                    ${price(projected.likelyEnd)}
                  </div>

                </div>


                <div>

                  <div class="pool-key">
                    Overshoot
                  </div>

                  <div class="pool-value">
                    ${fmt(projected.overshoot,3)}
                  </div>

                </div>


                <div>

                  <div class="pool-key">
                    Raid style
                  </div>

                  <div class="pool-value">
                    ${escapeHtml(pool.raidStyle || "—")}
                  </div>

                </div>


                <div>

                  <div class="pool-key">
                    Near-level flow
                  </div>

                  <div class="pool-value">
                    ${
                      escapeHtml(
                        footprint.state
                        ||
                        "NO TEST"
                      )
                    }
                  </div>

                </div>


              </div>

            </article>

          `;

        }
      )

      .join(
        ""
      );

}


/* =========================================================
   SESSIONS
========================================================= */


function renderSessions(
  sessions
) {

  if (
    !sessions.length
  ) {

    els.sessions.innerHTML =
      "";

    return;

  }


  els.sessions.innerHTML =
    sessions

      .map(
        session => {

          const active =
            Boolean(
              session.active
            );


          return `

            <div class="card session">

              <div>

                <div class="session-name">
                  ${escapeHtml(session.name)}
                </div>

                <div class="session-phase">
                  ${escapeHtml(session.phase)}
                </div>

              </div>


              <div class="session-right">

                <div
                  class="${active ? "active" : "closed"}"
                  style="font-weight:850"
                >
                  ${active ? "ACTIVE" : "CLOSED"}
                </div>

                <div class="session-phase">

                  ${escapeHtml(session.localTime || "—")}

                  ·

                  ${
                    session.nextEvent
                    ||
                    "—"
                  }

                </div>

              </div>

            </div>

          `;

        }
      )

      .join(
        ""
      );

}


/* =========================================================
   NOTIFICATIONS
========================================================= */


async function enableNotifications() {

  if (
    !(
      "Notification"
      in
      window
    )
  ) {

    alert(

      "This browser does not support normal web notifications. On iPhone, install the site to your Home Screen for better notification support."

    );

    return;

  }


  try {

    const permission =
      await Notification
        .requestPermission();


    if (
      permission ===
      "granted"
    ) {

      localStorage.setItem(
        "mkayfx_notifications",
        "1"
      );


      els.notifyBtn.textContent =
        "Trade alerts enabled";


    } else {

      localStorage.removeItem(
        "mkayfx_notifications"
      );


      els.notifyBtn.textContent =
        "Notification permission denied";

    }


  } catch (
    error
  ) {

    alert(
      error?.message
      ||
      "Could not enable notifications."
    );

  }

}


function maybeNotify(
  payload
) {

  const strategy =
    payload.strategy;


  if (
    !strategy
  ) {

    return;

  }


  if (
    strategy.signal !==
    "BUY"

    &&

    strategy.signal !==
    "SELL"
  ) {

    return;

  }


  if (
    localStorage.getItem(
      "mkayfx_notifications"
    )

    !==

    "1"
  ) {

    return;

  }


  if (

    !(
      "Notification"
      in
      window
    )

    ||

    Notification.permission !==
    "granted"

  ) {

    return;

  }


  const lastId =
    localStorage.getItem(
      "mkayfx_last_signal_id"
    );


  if (
    lastId ===
    strategy.signalId
  ) {

    return;

  }


  localStorage.setItem(

    "mkayfx_last_signal_id",

    strategy.signalId

  );


  const trade =
    strategy.trade
    ||
    {};


  new Notification(

    `XAU/USD ${strategy.signal}`,

    {

      body:

        `${strategy.focusPool?.name || "Liquidity sweep"}\n` +

        `Entry ${price(trade.plannedEntry)} · ` +

        `SL ${price(trade.stopLoss)} · ` +

        `TP2 ${price(trade.tp2)}`,

      tag:
        strategy.signalId

    }

  );

}


/* =========================================================
   STATUS
========================================================= */


function setStatus(
  state
) {

  els.statusDot.className =
    "dot";


  if (
    state ===
    "live"
  ) {

    els.statusDot.classList.add(
      "live"
    );


    els.statusText.textContent =
      "Live";

  }


  else if (
    state ===
    "error"
  ) {

    els.statusDot.classList.add(
      "error"
    );


    els.statusText.textContent =
      "Feed error";

  }


  else {

    els.statusText.textContent =
      "Analysing…";

  }

}


/* =========================================================
   ERRORS
========================================================= */


function showError(
  message
) {

  els.error.style.display =
    "block";


  els.error.textContent =
    message;

}


function hideError() {

  els.error.style.display =
    "none";


  els.error.textContent =
    "";

}


/* =========================================================
   FORMATTERS
========================================================= */


function price(
  value
) {

  const n =
    Number(
      value
    );


  if (
    !Number.isFinite(
      n
    )
  ) {

    return "—";

  }


  return n.toLocaleString(

    "en-US",

    {

      minimumFractionDigits:
        3,

      maximumFractionDigits:
        3

    }

  );

}


function fmt(
  value,
  decimals = 1
) {

  const n =
    Number(
      value
    );


  if (
    !Number.isFinite(
      n
    )
  ) {

    return "—";

  }


  return n.toFixed(
    decimals
  );

}


function signed(
  value
) {

  const n =
    Number(
      value
    );


  if (
    !Number.isFinite(
      n
    )
  ) {

    return "0.0";

  }


  if (
    n > 0
  ) {

    return (
      "+" +
      n.toFixed(
        1
      )
    );

  }


  return n.toFixed(
    1
  );

}


function formatClock(
  value
) {

  if (
    !value
  ) {

    return "—";

  }


  const date =
    new Date(
      value
    );


  return date.toLocaleTimeString(

    [],

    {

      hour:
        "2-digit",

      minute:
        "2-digit",

      second:
        "2-digit"

    }

  );

}


/* =========================================================
   ESCAPE HTML
========================================================= */


function escapeHtml(
  value
) {

  return String(
    value
    ??
    ""
  )

    .replaceAll(
      "&",
      "&amp;"
    )

    .replaceAll(
      "<",
      "&lt;"
    )

    .replaceAll(
      ">",
      "&gt;"
    )

    .replaceAll(
      '"',
      "&quot;"
    )

    .replaceAll(
      "'",
      "&#039;"
    );

}