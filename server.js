const express = require('express');
const path = require('path');
const { initDB } = require('./db');
const indexRoutes = require('./routes/index');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/', indexRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('404', { url: req.originalUrl });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('服务器内部错误');
});

// Init DB then start server
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`服务器已启动: http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('数据库初始化失败:', err);
  process.exit(1);
});
