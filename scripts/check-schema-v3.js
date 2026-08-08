const { initDB, pool } = require('../db');

initDB()
  .then(async () => {
    const [r] = await pool.execute(
      'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
    );
    console.log('schema_version', r);
    const [tables] = await pool.execute("SHOW TABLES LIKE 'users'");
    console.log('users_table', tables.length > 0);
    const [cols] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'novels'
         AND COLUMN_NAME IN ('status','updated_at','last_chapter_number','last_chapter_title')`
    );
    console.log('novel_cols', cols.map(c => c.COLUMN_NAME));
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
