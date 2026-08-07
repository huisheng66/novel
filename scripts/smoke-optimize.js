const { initDB, pool } = require('../db');
const { getTokenUsers } = require('../routes/admin/lib/tokens');
const { getDashboardMetrics } = require('../routes/admin/lib/metrics');
const analytics = require('../lib/analytics');

(async () => {
  await initDB();

  const [cols] = await pool.execute(
    "SHOW COLUMNS FROM access_tokens WHERE Field IN ('total_views','last_seen_at')"
  );
  console.log('token cols', cols.map(c => c.Field));

  const [ver] = await pool.execute('SELECT version FROM schema_version ORDER BY version DESC');
  console.log('schema', ver);

  await analytics.refreshLifetimeTotals();
  const [totals] = await pool.execute('SELECT * FROM analytics_totals WHERE id = 1');
  console.log('analytics_totals', totals[0]);

  const [tokens] = await pool.execute(
    'SELECT id, name, total_views, last_seen_at FROM access_tokens ORDER BY total_views DESC LIMIT 5'
  );
  console.log('tokens sample', tokens);

  const users = await getTokenUsers();
  console.log(
    'token users',
    users.length,
    users[0] && {
      name: users[0].name,
      total: users[0].total_views,
      v5: users[0].views_5m,
      ips: users[0].ip_count
    }
  );

  const m = await getDashboardMetrics();
  console.log('summary', m.summary);

  require('../routes/source');
  console.log('source routes ok');

  await pool.end();
  console.log('SMOKE OK');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
