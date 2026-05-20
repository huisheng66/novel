const express = require('express');
const path = require('path');
const { initDB } = require('./db');
const indexRoutes = require('./routes/index');
const adminRoutes = require('./routes/admin');
const pageViewQueue = require('./lib/pageViewQueue');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  etag: true
}));

app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

app.use('/admin', adminRoutes);
app.use('/', indexRoutes);

app.use((req, res) => {
  res.status(404).render('404', { url: req.originalUrl });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Server internal error');
});

initDB().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`Server started: http://localhost:${PORT}`);
  });

  async function shutdown(signal) {
    console.log(`${signal} received, flushing page view queue`);
    server.close(async () => {
      try {
        await pageViewQueue.flushAll();
      } catch (err) {
        console.error('Failed to flush page view queue:', err);
      } finally {
        process.exit(0);
      }
    });
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}).catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
