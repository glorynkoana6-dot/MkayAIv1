import {
  neon
} from "@neondatabase/serverless";


let sqlClient =
  null;


let schemaReady =
  false;


/* =========================================================
   DATABASE CONFIG
========================================================= */

export function dbEnabled() {

  return Boolean(
    String(
      process.env
        .DATABASE_URL ||
      ""
    ).trim()
  );
}


function databaseUrl() {

  const value =
    String(
      process.env
        .DATABASE_URL ||
      ""
    ).trim();


  if (!value) {
    return null;
  }


  /*
    This catches common Vercel mistakes such as:

    DATABASE_URL="postgresql://..."

    where the quotation marks were accidentally
    included in the actual environment value.
  */

  if (
    !/^postgres(?:ql)?:\/\//i.test(
      value
    )
  ) {

    throw new Error(
      "DATABASE_URL is invalid. It must begin with postgres:// or postgresql://. Copy the connection string directly from Neon without surrounding quotes."
    );

  }


  return value;
}


function sql() {

  const connectionString =
    databaseUrl();


  if (!connectionString) {
    return null;
  }


  if (
    !sqlClient
  ) {

    sqlClient =
      neon(
        connectionString
      );

  }


  return sqlClient;
}


/* =========================================================
   SCHEMA
========================================================= */

export async function ensureSchema() {

  if (
    !dbEnabled() ||
    schemaReady
  ) {
    return;
  }


  const db =
    sql();


  await db.query(`
    CREATE TABLE IF NOT EXISTS market_states
    (
      id BIGSERIAL PRIMARY KEY,

      symbol TEXT NOT NULL,

      timeframe TEXT NOT NULL
        DEFAULT '5min',

      candle_time TIMESTAMPTZ
        NOT NULL,

      session TEXT,

      regime TEXT,

      vector JSONB NOT NULL,

      features JSONB NOT NULL,

      future_path JSONB,

      resolved BOOLEAN NOT NULL
        DEFAULT FALSE,

      created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

      UNIQUE(
        symbol,
        timeframe,
        candle_time
      )
    )
  `);


  await db.query(`
    CREATE INDEX IF NOT EXISTS
      idx_market_states_symbol_resolved

    ON market_states
    (
      symbol,
      resolved,
      candle_time DESC
    )
  `);


  await db.query(`
    CREATE INDEX IF NOT EXISTS
      idx_market_states_symbol_regime

    ON market_states
    (
      symbol,
      regime,
      resolved,
      candle_time DESC
    )
  `);


  await db.query(`
    CREATE TABLE IF NOT EXISTS signal_records
    (
      signal_id TEXT PRIMARY KEY,

      created_at TIMESTAMPTZ
        NOT NULL,

      symbol TEXT NOT NULL,

      state TEXT NOT NULL,

      direction TEXT,

      edge_score
        DOUBLE PRECISION,

      regime TEXT,

      session TEXT,

      setup TEXT,

      entry
        DOUBLE PRECISION,

      stop_loss
        DOUBLE PRECISION,

      take_profit
        DOUBLE PRECISION,

      take_profit2
        DOUBLE PRECISION,

      payload JSONB NOT NULL
    )
  `);


  schemaReady =
    true;
}


/* =========================================================
   UPSERT CURRENT STATE
========================================================= */

export async function upsertMarketState(
  state
) {

  if (
    !dbEnabled() ||
    !state ||
    !state.symbol
  ) {
    return;
  }


  await ensureSchema();


  const db =
    sql();


  await db.query(
    `
      INSERT INTO market_states
      (
        symbol,
        timeframe,
        candle_time,
        session,
        regime,
        vector,
        features,
        resolved
      )

      VALUES
      (
        $1,
        '5min',
        $2,
        $3,
        $4,
        $5::jsonb,
        $6::jsonb,
        FALSE
      )

      ON CONFLICT
      (
        symbol,
        timeframe,
        candle_time
      )

      DO UPDATE SET

        session =
          EXCLUDED.session,

        regime =
          EXCLUDED.regime,

        vector =
          EXCLUDED.vector,

        features =
          EXCLUDED.features
    `,
    [
      state.symbol,

      state.candleTime,

      state.session,

      state.regime,

      JSON.stringify(
        state.vector
      ),

      JSON.stringify(
        state.features
      )
    ]
  );
}


/* =========================================================
   BULK MEMORY
========================================================= */

export async function bulkUpsertStates(
  states
) {

  if (
    !dbEnabled() ||
    !Array.isArray(
      states
    ) ||
    !states.length
  ) {
    return 0;
  }


  await ensureSchema();


  const db =
    sql();


  const payload =
    states
      .filter(
        x =>
          x &&
          x.symbol &&
          x.candleTime
      )
      .map(
        x => ({

          symbol:
            x.symbol,

          timeframe:
            x.timeframe ||
            "5min",

          candle_time:
            x.candleTime,

          session:
            x.session,

          regime:
            x.regime,

          vector:
            x.vector,

          features:
            x.features,

          future_path:
            x.futurePath ??
            null,

          resolved:
            Boolean(
              x.futurePath
            )

        })
      );


  if (
    !payload.length
  ) {
    return 0;
  }


  await db.query(
    `
      WITH rows AS
      (
        SELECT
          value AS j

        FROM
          jsonb_array_elements(
            $1::jsonb
          )
      )

      INSERT INTO market_states
      (
        symbol,
        timeframe,
        candle_time,
        session,
        regime,
        vector,
        features,
        future_path,
        resolved
      )

      SELECT

        j->>'symbol',

        COALESCE(
          j->>'timeframe',
          '5min'
        ),

        (
          j->>'candle_time'
        )::timestamptz,

        j->>'session',

        j->>'regime',

        COALESCE(
          j->'vector',
          '[]'::jsonb
        ),

        COALESCE(
          j->'features',
          '{}'::jsonb
        ),

        CASE

          WHEN
            j->'future_path'
            IS NULL

            OR

            j->'future_path' =
            'null'::jsonb

          THEN
            NULL

          ELSE
            j->'future_path'

        END,

        COALESCE(
          (
            j->>'resolved'
          )::boolean,
          FALSE
        )

      FROM rows

      ON CONFLICT
      (
        symbol,
        timeframe,
        candle_time
      )

      DO UPDATE SET

        session =
          EXCLUDED.session,

        regime =
          EXCLUDED.regime,

        vector =
          EXCLUDED.vector,

        features =
          EXCLUDED.features,

        future_path =
          COALESCE(
            EXCLUDED.future_path,
            market_states.future_path
          ),

        resolved =
          market_states.resolved
          OR
          EXCLUDED.resolved
    `,
    [
      JSON.stringify(
        payload
      )
    ]
  );


  return payload.length;
}


/* =========================================================
   HISTORICAL MEMORY

   IMPORTANT:
   SYMBOL FILTERING IS NOW BUILT INTO DATABASE QUERY.
========================================================= */

export async function loadResolvedStates({
  symbol = null,
  regime = null,
  limit = 1800
} = {}) {

  if (
    !dbEnabled()
  ) {
    return [];
  }


  await ensureSchema();


  const db =
    sql();


  const safeLimit =
    Math.max(
      1,
      Math.min(
        10000,
        Math.round(
          Number(
            limit
          ) ||
          1800
        )
      )
    );


  /*
    SYMBOL + REGIME
  */

  if (
    symbol &&
    regime
  ) {

    const sameRegime =
      await db.query(
        `
          SELECT
            symbol,
            timeframe,
            candle_time,
            session,
            regime,
            vector,
            features,
            future_path

          FROM
            market_states

          WHERE
            resolved = TRUE

            AND symbol = $1

            AND regime = $2

          ORDER BY
            candle_time DESC

          LIMIT $3
        `,
        [
          symbol,
          regime,
          safeLimit
        ]
      );


    /*
      Enough matching-regime memory:
      return it directly.
    */

    if (
      sameRegime.length >=
      Math.min(
        150,
        safeLimit
      )
    ) {

      return sameRegime;

    }


    /*
      Not enough same-regime history.
      Expand search, BUT remain on the same symbol.
    */

    return await db.query(
      `
        SELECT
          symbol,
          timeframe,
          candle_time,
          session,
          regime,
          vector,
          features,
          future_path

        FROM
          market_states

        WHERE
          resolved = TRUE

          AND symbol = $1

        ORDER BY
          candle_time DESC

        LIMIT $2
      `,
      [
        symbol,
        safeLimit
      ]
    );

  }


  /*
    SYMBOL ONLY
  */

  if (
    symbol
  ) {

    return await db.query(
      `
        SELECT
          symbol,
          timeframe,
          candle_time,
          session,
          regime,
          vector,
          features,
          future_path

        FROM
          market_states

        WHERE
          resolved = TRUE

          AND symbol = $1

        ORDER BY
          candle_time DESC

        LIMIT $2
      `,
      [
        symbol,
        safeLimit
      ]
    );

  }


  /*
    REGIME ONLY
    Backward compatibility.
  */

  if (
    regime
  ) {

    return await db.query(
      `
        SELECT
          symbol,
          timeframe,
          candle_time,
          session,
          regime,
          vector,
          features,
          future_path

        FROM
          market_states

        WHERE
          resolved = TRUE

          AND regime = $1

        ORDER BY
          candle_time DESC

        LIMIT $2
      `,
      [
        regime,
        safeLimit
      ]
    );

  }


  /*
    ALL MARKETS.
    Used only when no symbol is supplied.
  */

  return await db.query(
    `
      SELECT
        symbol,
        timeframe,
        candle_time,
        session,
        regime,
        vector,
        features,
        future_path

      FROM
        market_states

      WHERE
        resolved = TRUE

      ORDER BY
        candle_time DESC

      LIMIT $1
    `,
    [
      safeLimit
    ]
  );
}


/* =========================================================
   SAVE SIGNAL
========================================================= */

export async function saveSignalRecord(
  signal
) {

  if (
    !dbEnabled() ||
    !signal?.signalId
  ) {
    return;
  }


  await ensureSchema();


  const db =
    sql();


  await db.query(
    `
      INSERT INTO signal_records
      (
        signal_id,
        created_at,
        symbol,
        state,
        direction,
        edge_score,
        regime,
        session,
        setup,
        entry,
        stop_loss,
        take_profit,
        take_profit2,
        payload
      )

      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14::jsonb
      )

      ON CONFLICT
      (
        signal_id
      )

      DO NOTHING
    `,
    [
      signal.signalId,

      signal.createdAt,

      signal.symbol,

      signal.signal,

      signal.candidateDirection,

      signal.edgeScore,

      signal.marketRegime
        ?.type ||
      null,

      signal.session,

      signal.setupType,

      signal.entry,

      signal.stopLoss,

      signal.takeProfit,

      signal.takeProfit2,

      JSON.stringify(
        signal
      )
    ]
  );
}


/* =========================================================
   MEMORY COUNT

   Can return:
   - counts for one market
   - counts across all markets
========================================================= */

export async function memoryCount(
  symbol = null
) {

  if (
    !dbEnabled()
  ) {

    return {
      total:0,
      resolved:0
    };

  }


  await ensureSchema();


  const db =
    sql();


  let rows;


  if (
    symbol
  ) {

    rows =
      await db.query(
        `
          SELECT

            COUNT(*)::int
              AS total,

            COUNT(*)
            FILTER(
              WHERE resolved
            )::int
              AS resolved

          FROM
            market_states

          WHERE
            symbol = $1
        `,
        [
          symbol
        ]
      );

  }
  else{

    rows =
      await db.query(`
        SELECT

          COUNT(*)::int
            AS total,

          COUNT(*)
          FILTER(
            WHERE resolved
          )::int
            AS resolved

        FROM
          market_states
      `);

  }


  return rows[0] || {
    total:0,
    resolved:0
  };
}